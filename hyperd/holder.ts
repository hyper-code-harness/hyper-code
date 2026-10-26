// holder: one per process run (the dtach idea). Started detached (own session) by hyperd, so a restart of
// hyperd or hyper does not touch the process. It owns the PTY or pipes, appends all output to out.log,
// serves pty.sock (bytes in = input, output streamed to every connected client) and writes exit.json.
//
//   bun hyperd/holder.ts <runDir>
//
// runDir/launch.json  { cmd: string[], cwd, pty: false | { cols, rows } }   (kept)
// runDir/env.json     { ...env }                                          (deleted right after reading: secrets)
// runDir/holder.pid, child.pid, out.log, pty.sock, exit.json { code, signal, at }
import { existsSync, rmSync, unlinkSync, writeFileSync, renameSync } from "node:fs";
import { rotatingAppender } from "./rotate.ts";

const dir = process.argv[2];
if (!dir) { console.error("usage: holder.ts <runDir>"); process.exit(2); }
const launch = JSON.parse(await Bun.file(`${dir}/launch.json`).text()) as { cmd: string[]; cwd?: string; pty: false | { cols: number; rows: number }; stdin?: "pipe" | "ignore" };
let env: Record<string, string> = {};
if (existsSync(`${dir}/env.json`)) { env = JSON.parse(await Bun.file(`${dir}/env.json`).text()); unlinkSync(`${dir}/env.json`); }

const log = `${dir}/out.log`;
const sockPath = `${dir}/pty.sock`;
writeFileSync(`${dir}/holder.pid`, String(process.pid));
const clients = new Set<any>();
// out.log is size-bounded: past HYPERD_LOG_MAX_BYTES it becomes out.log.1 and a fresh out.log starts
const appendLog = rotatingAppender(log);
const out = (d: Uint8Array | string) => {
    appendLog(d);
    for (const c of clients) { try { c.write(d); } catch { clients.delete(c); } }
};
const fullEnv = { ...process.env, ...env, ...(launch.pty ? { TERM: env.TERM ?? "xterm-256color" } : {}) } as Record<string, string>;
delete fullEnv.HYPERD_HOLDER_PARENT;

let proc: any;
let pumps: Promise<void>[] = [];
let writeInput: (d: Uint8Array | string) => void;
try {
    if (launch.pty) {
        proc = Bun.spawn(launch.cmd, { cwd: launch.cwd, env: fullEnv, terminal: { cols: launch.pty.cols, rows: launch.pty.rows, data(_t: any, d: Uint8Array) { out(d); } } } as any);
        writeInput = (d) => proc.terminal.write(d);
    } else {
        // Own process group, so hyperd can signal the whole tree with kill(-pid).
        const stdin = launch.stdin ?? "pipe";
        proc = Bun.spawn(launch.cmd, { cwd: launch.cwd, env: fullEnv, stdin, stdout: "pipe", stderr: "pipe", detached: true } as any);
        const pump = async (s: ReadableStream<Uint8Array>) => { for await (const chunk of s) out(chunk); };
        pumps = [pump(proc.stdout), pump(proc.stderr)];
        writeInput = stdin === "pipe" ? (d) => { proc.stdin.write(d); proc.stdin.flush(); } : () => { throw new Error("no stdin"); };
    }
} catch (error: any) {
    out(`hyperd: could not start ${JSON.stringify(launch.cmd)}: ${error?.message ?? error}\n`);
    writeFileSync(`${dir}/exit.tmp`, JSON.stringify({ code: 127, signal: null, at: Date.now(), error: String(error?.message ?? error) }));
    renameSync(`${dir}/exit.tmp`, `${dir}/exit.json`);
    process.exit(0);
}
writeFileSync(`${dir}/child.pid`, String(proc.pid));

try { rmSync(sockPath, { force: true }); } catch {}
const server = Bun.listen({
    unix: sockPath,
    socket: {
        open(s) { clients.add(s); },
        close(s) { clients.delete(s); },
        error(s) { clients.delete(s); },
        data(_s, d) { try { writeInput(d); } catch {} },
    },
});

const code = await proc.exited;
const signal = proc.signalCode ?? null;
// the leader is gone; whatever it left in its group (grandchildren) goes too, so a restart never runs next to them
try { process.kill(-proc.pid, "SIGKILL"); } catch {}
// let the last output land: it is often the whole result of a task
await Promise.race([Promise.allSettled(pumps), Bun.sleep(2000)]);
await Bun.sleep(launch.pty ? 50 : 0);
writeFileSync(`${dir}/exit.tmp`, JSON.stringify({ code: signal ? null : code, signal, at: Date.now() }));
renameSync(`${dir}/exit.tmp`, `${dir}/exit.json`);
for (const c of clients) { try { c.end(); } catch {} }
server.stop(true);
try { rmSync(sockPath, { force: true }); } catch {}
process.exit(0);
