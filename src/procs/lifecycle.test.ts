// FUNCTIONAL test: src/lifecycle.test.ts ↔ the src/lifecycle/ namespace.
// (We don't run start/stop here — that would boot the http server; the boot
// path is verified live. Here we cover the package.json-driven start order.)
import { test, expect } from "bun:test";
import { testCtx } from "../$test";
import { tmpdir } from "node:os";

const ctx = await testCtx();

test("lifecycle.order reads package.json proc.prod keys (http last)", async () => {
    // the order is package.json's procs.prod, with procs/http moved to the end
    const prod = Object.keys((await Bun.file(new URL("../../package.json", import.meta.url).pathname).json()).procs.prod);
    const order = await ctx.fns.procs.lifecycle.order({});
    expect(order).toEqual([...prod.filter(k => k !== "procs/http"), "procs/http"]);
    expect(order.slice(0, 3)).toEqual(["procs/log", "procs/telemetry", "procs/db"]);
});

// A host mounts modules it did not write. One of them failing to start — a
// workflow engine with no database, a mailer with no key — must leave the host
// running and complain, not take everything down with it.
test("a module that fails to start is skipped and remembered; the core is not", async () => {
    const dir = `${tmpdir()}/procs-lifecycle-${Bun.hash("degraded")}`;
    await Bun.$`rm -rf ${dir}`.quiet();
    await Bun.write(`${dir}/package.json`, JSON.stringify({ name: "host", procs: { prod: { good: {}, bad: {} } } }));
    await Bun.write(`${dir}/src/good/$start.ts`, `export default function () { return { up: true }; }\n`);
    await Bun.write(`${dir}/src/bad/$start.ts`, `export default function () { throw new Error("no database"); }\n`);
    await Bun.write(`${dir}/src/good/ping.ts`, `export default function () { return "pong"; }\n`);

    const host = await testCtx({ root: dir, workdir: dir });
    const result: any = await host.fns.procs.lifecycle.start({});

    expect(result.started).toContain("good");
    expect(result.failed).toMatchObject({ bad: expect.stringContaining("no database") });
    expect(host.state.good).toMatchObject({ up: true });      // the rest of the host is up
    expect((host.fns as any).good.ping({})).toBe("pong");
    await Bun.$`rm -rf ${dir}`.quiet();
});
