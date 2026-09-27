// A remote agent workspace (agent.workspaceHost) against the docker sshd fixture
// (test/ssh): tools, git and the Files UI act on the host without an explicit
// `host`, relative to the workspace dir; host "local" and other aliases override;
// forks and delegated children inherit the host. Skipped without Docker.
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkTestCtx } from "../_testCtx.entry";
import { startSshFixture, dockerAvailable, type SshFixture } from "../../test/ssh/fixture";

const enabled = process.env.HYPER_SKIP_DOCKER_TESTS !== "1" && await dockerAvailable();

let fx: SshFixture | null = null;
let ctx: any;
let agent: any;
let actx: any;          // ctx whose session is the remote-workspace agent
let home = "";          // remote home, e.g. /home/tester
let localDir = "";

describe.skipIf(!enabled)("remote workspace (agent.workspaceHost)", () => {
    beforeAll(async () => {
        fx = await startSshFixture();
        if (!fx) throw new Error("ssh fixture unavailable");
        ctx = await mkTestCtx({ env: fx.env });
        ctx.fns.agent.renderEventHtml = async () => "";
        await ctx.fns.procs.http.loadRoutes({});
        home = (await ctx.fns.remote.exec({ host: "plain", command: "echo $HOME" })).stdout.trim();
        await ctx.fns.remote.exec({ host: "plain", command: "mkdir -p proj && cd proj && git init -q && git config user.email t@t && git config user.name t" });
        agent = await ctx.fns.agent.start({ model: "mock:echo", title: "remote ws" });
        await ctx.fns.session.save({ agent });
        actx = Object.create(ctx);
        actx.session = ctx.fns.session.forAgent({ agent });
        localDir = mkdtempSync(join(tmpdir(), "hyper-remote-ws-"));
    }, 240_000);

    afterAll(async () => {
        await fx?.stop();
        if (localDir) rmSync(localDir, { recursive: true, force: true });
    }, 60_000);

    test("workspace.set resolves the dir on the host and stores host + absolute path", async () => {
        expect(await actx.fns.workspace.set({ host: "plain", dir: "~/proj" })).toBe(`plain:${home}/proj`);
        expect(actx.fns.workspace.get({})).toMatchObject({ host: "plain", dir: `${home}/proj` });
        const row = (await ctx.fns.procs.db.select({ sql: "SELECT workspace_host, workspace_dir FROM agents WHERE id = ?", params: [agent.id] }))[0];
        expect(row).toEqual({ workspace_host: "plain", workspace_dir: `${home}/proj` });
        await expect(actx.fns.workspace.set({ host: "plain", dir: "~/missing" })).rejects.toThrow("workspace directory not found");
        expect(agent.workspaceHost).toBe("plain"); // a failed set changes nothing
    });

    test("workspace.target: the one rule every tool follows", () => {
        expect(actx.fns.workspace.target({ path: "a b/x.ts" })).toMatchObject({ host: "plain", path: `${home}/proj/a b/x.ts` });
        expect(actx.fns.workspace.target({ path: "/etc/hosts" })).toMatchObject({ host: "plain", path: "/etc/hosts" });
        expect(actx.fns.workspace.target({ path: "~/x" })).toMatchObject({ host: "plain", path: "~/x" });
        expect(actx.fns.workspace.target({ host: "plain", path: "x" })).toMatchObject({ host: "plain", path: `${home}/proj/x` });
        expect(actx.fns.workspace.target({ host: "rg", path: "x" })).toMatchObject({ host: "rg", path: "x" });
        expect(actx.fns.workspace.target({ host: "local", path: "/tmp/x" })).toMatchObject({ host: null, path: "/tmp/x" });
    });

    test("tools without host act in the remote workspace", async () => {
        const T = actx.fns.tools;
        expect(await T.write({ path: "src/a b.ts", content: "export const a = 1;\nexport const b = 2;\n" })).toStartWith(`wrote plain:${home}/proj/src/a b.ts`);
        await T.edit({ path: "src/a b.ts", edits: [{ oldText: "b = 2", newText: "b = 42" }] });
        expect(await T.read({ path: "src/a b.ts" })).toBe("export const a = 1;\nexport const b = 42;\n");
        expect(await T.bash({ command: "pwd" })).toEqual({ output: `${home}/proj\n`, isError: false });
        expect((await T.bash({ command: "pwd", cwd: "src" })).output).toBe(`${home}/proj/src\n`);
        expect(await T.grep({ pattern: "b = 42", literal: true })).toContain(`src/a b.ts:2:14:`);
        expect(await T.find({ pattern: "*.ts" })).toContain("a b.ts");
        // proof it did not touch this machine
        expect((await ctx.fns.remote.exec({ host: "plain", command: "cat 'proj/src/a b.ts'" })).stdout).toContain("b = 42");
    });

    test("host overrides: another alias uses its home, \"local\" acts on this machine", async () => {
        const T = actx.fns.tools;
        await T.write({ host: "rg", path: "other.txt", content: "on rg\n" });
        expect((await ctx.fns.remote.exec({ host: "rg", command: "cat ~/other.txt" })).stdout).toBe("on rg\n");
        const local = join(localDir, "local.txt");
        await T.write({ host: "local", path: local, content: "here\n" });
        expect(await Bun.file(local).text()).toBe("here\n");
        // local bash sees this machine's filesystem, the containers do not
        expect((await T.bash({ host: "local", command: `cat ${local}` })).output.trim()).toBe("here");
        expect((await T.bash({ command: `test -e ${local} && echo yes || echo no` })).output).toBe("no\n");
    });

    test("git follows the remote workspace", async () => {
        expect((await actx.fns.git.status({})).untracked).toEqual(["src/"]);
        const r = await actx.fns.git.stageCommitPush({ paths: ["src"], message: "it's remote", push: false });
        expect(r.committed.ok).toBe(true);
        expect((await actx.fns.git.run({ args: ["log", "--format=%s"] })).stdout.trim()).toBe("it's remote");
        expect((await actx.fns.git.status({})).clean).toBe(true);
        const failed = await actx.fns.git.run({ args: ["checkout", "nope"], allowFailure: true });
        expect(failed.ok).toBe(false);
        await expect(actx.fns.git.run({ args: ["checkout", "nope"] })).rejects.toThrow("did not match");
        // host "local" is this machine's git
        expect((await actx.fns.git.run({ host: "local", args: ["--version"] })).stdout).toContain("git version");
    });

    test("forks and delegated children inherit the remote workspace; save/load round-trips", async () => {
        const fork = await ctx.fns.session.fork({ id: agent.id });
        expect([fork.workspaceHost, fork.workspaceDir]).toEqual(["plain", `${home}/proj`]);
        await ctx.fns.session.save({ agent });
        delete ctx.state.agent[agent.id];
        const loaded = await ctx.fns.session.load({ id: agent.id });
        expect([loaded.workspaceHost, loaded.workspaceDir]).toEqual(["plain", `${home}/proj`]);
        ctx.state.agent[agent.id] = agent;
        // starting a child from a stored remote workspace needs no ssh round-trip for an absolute dir
        const child = await ctx.fns.agent.start({ model: "mock:echo", workspaceHost: "plain", workspaceDir: `${home}/proj` });
        expect([child.workspaceHost, child.workspaceDir]).toEqual(["plain", `${home}/proj`]);
    });

    test("the system prompt names the remote workspace", async () => {
        const prompt = String(await ctx.fns.agent.fullSystemPrompt({ agent }));
        expect(prompt).toContain(`workspace: plain:${home}/proj — REMOTE, on SSH host plain`);
    });

    test("Files UI: directory, file, raw media and saving on the host", async () => {
        const R = ctx.fns.remote;
        await R.exec({ host: "plain", command: "mkdir -p 'proj/docs sp' && printf '# Title\\n' > 'proj/docs sp/readme.md' && printf '\\x89PNG\\r\\n\\x1a\\n' > proj/dot.png" });
        const d = (url: string, accept = "text/html") => ctx.fns.procs.http.dispatch({ url, headers: { accept } });

        expect(await ctx.fns.files.browserUrl({ path: `${home}/proj/docs sp`, host: "plain" })).toBe(`/files/remote/plain${home}/proj/docs%20sp`);
        const dir = await d(`/files/remote/plain${home}/proj`);
        expect(dir.status).toBe(200);
        const dirHtml = await dir.text();
        expect(dirHtml).toContain("docs sp");
        expect(dirHtml).toContain(`/files/remote/plain${home}/proj/docs%20sp`);

        const page = await d(`/files/remote/plain${home}/proj/docs%20sp/readme.md`);
        expect(page.status).toBe(200);
        expect(await page.text()).toContain("Title");

        const img = await d(`/files/remote/plain${home}/proj/dot.png`, "image/png");
        expect(img.status).toBe(200);
        expect(img.headers.get("content-type")).toBe("image/png");
        expect(new Uint8Array(await img.arrayBuffer())).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

        const embed = await d(`/files/remote/embed/plain${home}/proj`);
        expect(embed.status).toBe(200);
        expect(await embed.text()).toContain(`/files/remote/embed/plain${home}/proj/docs%20sp`);

        const put = await ctx.fns.procs.http.dispatch({ url: `/files?path=${encodeURIComponent(`${home}/proj/saved.txt`)}&host=plain`, method: "PUT", body: "from the editor" });
        expect(put.status).toBe(200);
        expect((await R.exec({ host: "plain", command: "cat proj/saved.txt" })).stdout).toBe("from the editor");

        expect((await d(`/files/remote/evil${home}/proj`)).status).toBe(404);
        expect((await ctx.fns.procs.http.dispatch({ url: `/files?path=/etc/passwd&host=evil`, headers: { accept: "text/html" } })).status).toBe(400);
        expect((await d(`/files/remote/plain${home}/proj/missing.txt`)).status).toBe(404);
    });

    test("ui.previewFile and the chat header open the remote view", async () => {
        const rpc = Object.create(actx);
        rpc.session = { ...actx.session, url: new URL("http://localhost/rpc") };
        const html = String(await rpc.fns.ui.previewFile({ path: "docs sp/readme.md" }));
        expect(html).toContain(`src="/files/remote/embed/plain${home}/proj/docs%20sp/readme.md"`);
        const header = String(await ctx.fns.ui.chatColumn({ agentId: agent.id }));
        expect(header).toContain(`Remote files · plain:${home}/proj`);
    });

    test("remote.list / stat / readBytes", async () => {
        const R = ctx.fns.remote;
        expect((await R.list({ host: "plain", path: "proj" })).map((e: any) => e.name)).toEqual(expect.arrayContaining(["docs sp", "src", "dot.png", "saved.txt"]));
        expect(await R.stat({ host: "plain", path: "proj/saved.txt" })).toMatchObject({ isDir: false, size: 15 });
        expect(await R.stat({ host: "plain", path: "proj/none" })).toBeNull();
        expect((await R.readBytes({ host: "plain", path: "proj/dot.png" })).length).toBe(8);
        await expect(R.readBytes({ host: "plain", path: "proj/saved.txt", maxBytes: 4 })).rejects.toThrow("too large");
    });

    test("review: relative remote paths in the Files UI resolve to absolute links", async () => {
        const dir = await ctx.fns.procs.http.dispatch({ url: `/files?host=plain&path=proj`, headers: { accept: "text/html" } });
        expect(dir.status).toBe(303);
        expect(dir.headers.get("location")).toBe(`/files/remote/plain${home}/proj`);
        const file = await ctx.fns.procs.http.dispatch({ url: `/files?host=plain&path=${encodeURIComponent("~/proj/saved.txt")}&tab=code&embed=1`, headers: { accept: "text/html" } });
        expect(file.headers.get("location")).toBe(`/files/remote/embed/plain${home}/proj/saved.txt?tab=code`);
        const rpc = Object.create(actx);
        rpc.session = { ...actx.session, url: new URL("http://localhost/rpc") };
        const html = String(await rpc.fns.ui.previewFile({ host: "rg", path: "~" }));
        expect(html).toContain(`src="/files/remote/embed/rg/home/tester"`);
    });

    test("review: remote HTML preview assets come back raw, not as UI pages", async () => {
        await ctx.fns.remote.exec({ host: "plain", command: "printf 'console.log(1)\\n' > proj/app.js && printf 'body{}\\n' > proj/style.css" });
        const js = await ctx.fns.procs.http.dispatch({ url: `/files/remote/plain${home}/proj/app.js`, headers: { accept: "*/*", "sec-fetch-dest": "script" } });
        expect(js.headers.get("content-type")).toContain("javascript");
        expect(await js.text()).toBe("console.log(1)\n");
        const css = await ctx.fns.procs.http.dispatch({ url: `/files/remote/plain${home}/proj/style.css`, headers: { accept: "text/css,*/*;q=0.1" } });
        expect(css.headers.get("content-type")).toContain("text/css");
    });

    test("review: readBytes refuses files over the limit", async () => {
        const R = ctx.fns.remote;
        await R.writeFile({ host: "plain", path: "proj/big.bin", content: "y".repeat(300_000) });
        await expect(R.readBytes({ host: "plain", path: "proj/big.bin", maxBytes: 100_000 })).rejects.toThrow("too large");
        expect((await R.readBytes({ host: "plain", path: "proj/big.bin", maxBytes: 400_000 })).length).toBe(300_000);
    });

    test("workspace.set without host makes the workspace local again", async () => {
        expect(await actx.fns.workspace.set({ dir: localDir })).toBe(localDir);
        expect(actx.fns.workspace.get({})).toMatchObject({ host: "", dir: localDir });
        expect(actx.fns.workspace.target({ path: "x" })).toMatchObject({ host: null, path: join(localDir, "x") });
    });
});
