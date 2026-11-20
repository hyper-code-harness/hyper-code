import { describe, expect, test, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm, realpath, symlink, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testCtx } from "../$test";
import actRoute from "./$route_act_POST";

// Real git repositories on this machine (hence `.it.test.ts`): a pack shaped like mattpocock/skills — buckets,
// an author's plugin.json that leaves some skills out, a symlink at the repository root — and a temporary Hyper home.
const root = await realpath(await mkdtemp(join(tmpdir(), "skills-install-")));
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

function git(cwd: string, ...args: string[]): string {
    const p = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@l", "-c", "init.defaultBranch=main", ...args], { cwd });
    if (p.exitCode) throw new Error(p.stderr.toString());
    return p.stdout.toString().trim();
}
async function put(dir: string, files: Record<string, string>) {
    for (const [rel, text] of Object.entries(files)) {
        await mkdir(join(dir, rel, ".."), { recursive: true });
        await writeFile(join(dir, rel), text);
    }
}
const md = (name: string, extra = "", body = `# ${name}\n\nDo ${name}.`) => `---\nname: ${name}\ndescription: The ${name} skill. Use for ${name}.\n${extra}---\n\n${body}\n`;

const work = join(root, "work");
await mkdir(work, { recursive: true });
git(work, "init", "-q");
await put(work, {
    "CLAUDE.md": "notes",
    ".claude-plugin/plugin.json": JSON.stringify({ name: "demo-skills", version: "1.0.0", skills: ["./skills/eng/tdd", "./skills/eng/review", "./skills/prod/grill"] }),
    "skills/eng/tdd/SKILL.md": md("tdd"),
    "skills/eng/tdd/tests.md": "good tests",
    "skills/eng/review/SKILL.md": md("review"),
    "skills/eng/review/scripts/check.sh": "#!/bin/sh\necho ok\n",
    "skills/prod/grill/SKILL.md": md("grill", "disable-model-invocation: true\n"),
    "skills/wip/draft/SKILL.md": md("draft"),
});
await symlink("CLAUDE.md", join(work, "AGENTS.md"));   // a link OUTSIDE the skill folders must not block the pack
git(work, "add", "-A"); git(work, "commit", "-qm", "v1"); git(work, "tag", "v1.0.0");
const v1 = git(work, "rev-parse", "HEAD");
await put(work, { "skills/eng/tdd/SKILL.md": md("tdd", "", "# tdd\n\nSecond edition."), "skills/eng/new/SKILL.md": md("new") });
await writeFile(join(work, ".claude-plugin/plugin.json"), JSON.stringify({ name: "demo-skills", version: "2.0.0", skills: ["./skills/eng/tdd", "./skills/eng/new", "./skills/prod/grill"] }));
git(work, "add", "-A"); git(work, "commit", "-qm", "v2"); git(work, "tag", "v2.0.0");
const v2 = git(work, "rev-parse", "HEAD");
const repo = "git+file://" + work;

const home = join(root, "home");
const ctx: any = await testCtx({ env: { HYPER_HOME: home, SKILLS_ROOTS: "" } });
await ctx.fns.procs.migrate.up({});
ctx.fns.embeddings.provider = async () => "off";
const exists = (p: string) => stat(p).then(() => true, () => false);

// ctx.fns calls made on `ctx` carry no agent session — the same position as the person's POST from the chat form.
// asAgent gives the ctx an agent's own calls have (tools.call and eval derive it the same way): every nested
// ctx.fns call then carries the agent's session.
const asAgent = (agent: any) => { const c: any = Object.create(ctx); c.session = ctx.fns.session.forAgent({ agent }); return c; };

describe("skills.install", () => {
    test("preview lists the author's skills and changes nothing", async () => {
        const preview = await ctx.fns.skills.install({ repo, ref: "v1.0.0", as: "demo" });
        expect(preview.status).toBe("preview");
        expect(preview).toMatchObject({ operation: "install", pack: "demo", tag: "v1.0.0", commit: v1, trust: "community", model: false, found: "plugin.json" });
        expect(preview.skills.map((s: any) => s.name)).toEqual(["grill", "review", "tdd"]);        // `draft` is not in plugin.json
        expect(preview.skills.find((s: any) => s.name === "review").executables).toEqual(["scripts/check.sh"]);
        expect(preview.skills.find((s: any) => s.name === "grill").byModel).toBe(false);
        expect(await exists(join(home, "skills", "demo"))).toBe(false);
        expect((await ctx.fns.skills.lockFile({})).lock.packs).toEqual({});
    });

    test("a wrong digest is refused; the right one installs, locks and indexes", async () => {
        const preview = await ctx.fns.skills.install({ repo, ref: "v1.0.0", as: "demo" });
        await expect(ctx.fns.skills.install({ repo, ref: "v1.0.0", as: "demo", confirmed: true, expectedDigest: "0".repeat(64) })).rejects.toThrow("digest mismatch");
        const applied = await ctx.fns.skills.install({ repo, ref: "v1.0.0", as: "demo", confirmed: true, expectedDigest: preview.digest });
        expect(applied.status).toBe("applied");
        expect(await readFile(join(home, "skills", "demo", "skills/eng/tdd/tests.md"), "utf8")).toBe("good tests");
        const entry = (await ctx.fns.skills.lockFile({})).lock.packs.demo;
        expect(entry).toMatchObject({ repo, tag: "v1.0.0", commit: v1, trust: "community", model: false, previous: [] });
        expect(Object.keys(entry.skills).sort()).toEqual(["grill", "review", "tdd"]);
        expect(entry.skills.tdd.hash).toMatch(/^[0-9a-f]{64}$/);
        expect((await ctx.fns.skills.list({ pack: "demo" })).map((s: any) => s.id)).toEqual(["demo:grill", "demo:review", "demo:tdd"]);
        expect(await exists(join(home, ".skills-staging", "demo"))).toBe(false);
        expect(await exists(join(home, ".skills-operation-lock"))).toBe(false);
    });

    test("a community pack is hidden from the model until a person allows it; /name works at once", async () => {
        const agent = await ctx.fns.agent.start({ model: "mock:test", tools: ["skill"] });
        const session = ctx.fns.session.forAgent({ agent });
        const use = (opts: any) => ctx.state.registry.skills.use(ctx, session, opts);
        expect((await use({ query: "tdd" })).output).toContain("you cannot load it");            // found, but marked
        expect((await use({ name: "tdd" })).output).toContain("was NOT loaded: the person has not allowed agents");
        // "the person started it" is not something an agent can just claim
        expect((await use({ name: "grill", via: "user" })).output).toContain("only by the person typing /grill");
        const said = await ctx.fns.session.appendUserMessage({ id: agent.id, text: "/grill my plan", author: "person" });
        expect((await use({ name: "grill", via: "user", messageIdx: said.idx })).output).toContain('<skill_content name="demo:grill">');
        expect((await use({ name: "review", via: "user", messageIdx: said.idx })).isError).toBe(true);   // that message asked for another skill
        // once the person started a skill of the pack, skills of that pack may call each other
        expect((await use({ name: "tdd" })).isError).toBe(false);

        expect(await ctx.fns.skills.allowModel({ name: "demo", allow: true })).toMatchObject({ pack: "demo", model: true, skills: 3 });
        const found = (await use({ query: "tdd" })).output;
        expect(found).toContain("You can load these with skill({ name }):\n- demo:tdd: The tdd skill");
        expect(found).not.toContain("- demo:tdd: The tdd skill. Use for tdd. [you cannot load it");
    });

    test("update shows what changed, keeps the pack's settings and remembers the previous commit", async () => {
        const preview = await ctx.fns.skills.install({ repo });   // newest release
        expect(preview).toMatchObject({ operation: "update", pack: "demo", tag: "v2.0.0", commit: v2, from: v1, model: true });
        expect(Object.fromEntries(preview.skills.map((s: any) => [s.name, s.change]))).toEqual({ grill: "same", new: "added", tdd: "changed" });
        expect(preview.removed).toEqual(["review"]);
        await ctx.fns.skills.install({ repo, confirmed: true, expectedDigest: preview.digest });
        const entry = (await ctx.fns.skills.lockFile({})).lock.packs.demo;
        expect(entry.previous).toEqual([{ tag: "v1.0.0", commit: v1 }]);
        expect((await ctx.fns.skills.list({ pack: "demo" })).map((s: any) => s.name)).toEqual(["grill", "new", "tdd"]);
        expect((await ctx.fns.skills.list({ pack: "demo" })).every((s: any) => s.modelAllowed)).toBe(true);
    });

    test("select narrows a pack by folder glob", async () => {
        const preview = await ctx.fns.skills.install({ repo, as: "narrow", select: ["skills/eng/*"] });
        expect(preview.skills.map((s: any) => s.name)).toEqual(["new", "tdd"]);
    });

    test("uninstall previews, then removes the folder, the lock entry and the index rows", async () => {
        const preview = await ctx.fns.skills.uninstall({ name: "demo" });
        expect(preview).toMatchObject({ status: "preview", skills: ["grill", "new", "tdd"] });
        expect(await exists(join(home, "skills", "demo"))).toBe(true);
        await ctx.fns.skills.uninstall({ name: "demo", confirmed: true, expectedDigest: preview.digest });
        expect(await exists(join(home, "skills", "demo"))).toBe(false);
        expect((await ctx.fns.skills.lockFile({})).lock.packs.demo).toBeUndefined();
        expect(await ctx.fns.skills.list({ pack: "demo" })).toEqual([]);
    });

    test("refuses a symlink inside a skill folder and a repository that is a Hyper plugin", async () => {
        const bad = join(root, "bad");
        await mkdir(bad, { recursive: true });
        git(bad, "init", "-q");
        await put(bad, { "skills/x/SKILL.md": md("x"), "secret.txt": "s" });
        await symlink("../../secret.txt", join(bad, "skills/x/link.txt"));
        git(bad, "add", "-A"); git(bad, "commit", "-qm", "c");
        await expect(ctx.fns.skills.install({ repo: "git+file://" + bad, as: "bad" })).rejects.toThrow("symbolic links are not allowed");

        const plugin = join(root, "plugin");
        await mkdir(plugin, { recursive: true });
        git(plugin, "init", "-q");
        await put(plugin, { "package.json": JSON.stringify({ name: "p", procs: { src: "src" } }), "skills/y/SKILL.md": md("y") });
        git(plugin, "add", "-A"); git(plugin, "commit", "-qm", "c");
        await expect(ctx.fns.skills.install({ repo: "git+file://" + plugin, as: "plug" })).rejects.toThrow("Hyper plugin");
        expect(await exists(join(home, ".skills-operation-lock"))).toBe(false);   // a refused install leaves no mutex behind
    });
});

describe("skills: an agent proposes, a person decides", () => {
    test("an agent cannot confirm an install, remove a pack or allow a pack to the model by itself", async () => {
        const agent = await ctx.fns.agent.start({ model: "mock:test", tools: ["skill"] });
        const a = asAgent(agent);
        const preview = await a.fns.skills.install({ repo, as: "byagent" });     // looking is allowed
        expect(preview.status).toBe("preview");
        await expect(a.fns.skills.install({ repo, as: "byagent", confirmed: true, expectedDigest: preview.digest })).rejects.toThrow("An agent cannot install a skill pack");
        expect((await ctx.fns.skills.lockFile({})).lock.packs.byagent).toBeUndefined();
        await expect(a.fns.skills.allowModel({ name: "x", allow: true })).rejects.toThrow("An agent cannot allow");
        await expect(a.fns.skills.uninstall({ name: "x", confirmed: true, expectedDigest: "0" })).rejects.toThrow("An agent cannot remove");
        await expect(a.fns.skills.lockFile({ lock: { packs: {} } })).rejects.toThrow("An agent cannot change the skills lock");
        await expect(a.fns.skills.act({ op: "install", repo })).rejects.toThrow("An agent cannot change installed skills");
        expect((await a.fns.skills.lockFile({})).lock.packs.byagent).toBeUndefined();              // reading stays open
    });

    test("preview fetches a pack for reading without installing or indexing it; the viewer shows its files", async () => {
        const p = await ctx.fns.skills.preview({ repo, ref: "v1.0.0", as: "look" });
        expect(p.skills.map((s: any) => s.name)).toEqual(["grill", "review", "tdd"]);
        expect(p.skills.every((s: any) => s.change === "new")).toBe(true);
        expect(await exists(join(home, ".skills-staging", "preview", p.id, "repo", "skills/eng/tdd/tests.md"))).toBe(true);
        expect(await ctx.fns.skills.list({ pack: "look" })).toEqual([]);                                   // not indexed
        await expect(ctx.fns.skills.preview({ repo, ref: "v1.0.0", select: ["nosuch"] })).rejects.toThrow("It has: grill, review, tdd");
        expect((await ctx.fns.skills.resolve({ name: "look:tdd" })).skill).toBeNull();                      // not loadable
        expect((await ctx.fns.skills.preview({ repo, ref: "v1.0.0", as: "look" })).createdAt).toBe(p.createdAt);   // reused

        const overview = await ctx.fns.skills.view({ name: "review", preview: p.id });
        expect(overview).toContain("not installed");
        expect(overview).toContain("scripts/check.sh");
        const script = await ctx.fns.skills.view({ name: "review", preview: p.id, file: "scripts/check.sh" });
        expect(script).toContain("echo");
        expect(script).toContain("script");
        expect(await ctx.fns.skills.view({ name: "review", preview: p.id, file: "../../../../CLAUDE.md" })).toContain("is not a file of this skill");
        const page = await ctx.fns.skills.previewPage({ repo, ref: "v1.0.0" });
        expect(page).toContain("Nothing from here is installed");
        expect(page).toContain("The tdd skill");
        expect(page).not.toContain("<table");
    });

    test("propose opens a chat form; Install in it installs exactly what was previewed and tells the agent", async () => {
        const agent = await ctx.fns.agent.start({ model: "mock:test", tools: ["skill"] });
        const a = asAgent(agent);
        const proposed = await a.fns.skills.propose({ repo, ref: "v1.0.0", as: "offered", select: ["tdd", "review"], why: "For the refactoring you asked about." });
        expect(proposed).toMatchObject({ pack: "offered", skills: ["review", "tdd"], scripts: 1, trust: "community" });
        expect((await ctx.fns.skills.lockFile({})).lock.packs.offered).toBeUndefined();                    // proposing installs nothing
        const card = await ctx.fns.input.card({ id: proposed.inputId });
        expect(card).toContain("scripts/check.sh");
        expect(card).toContain("Install");

        // The agent cannot press Install on its own form: the install inside the submit sees the agent's session.
        const self = await a.fns.input.submit({ id: proposed.inputId, values: { decision: "yes" }, actor: `agent:${agent.id}` });
        expect(self.state).toBe("open");
        expect(self.error).toContain("An agent cannot install a skill pack");
        expect((await ctx.fns.skills.lockFile({})).lock.packs.offered).toBeUndefined();

        const out = await ctx.fns.input.submit({ id: proposed.inputId, values: { decision: "yes" }, actor: "person" });
        expect(out.state).toBe("submitted");
        const entry = (await ctx.fns.skills.lockFile({})).lock.packs.offered;
        expect(entry).toMatchObject({ tag: "v1.0.0", commit: v1, model: false });
        expect(Object.keys(entry.skills).sort()).toEqual(["review", "tdd"]);
        const row = await ctx.fns.input.get({ id: proposed.inputId });
        expect(row.result).toMatchObject({ installed: true, pack: "offered", skills: ["review", "tdd"] });
        const told = (await ctx.fns.session.getMessages({ id: agent.id, includeExcluded: true })).find((m: any) => m.message_type === "input");
        expect(String(told?.content)).toContain("installed pack offered");
    });

    test("Decline installs nothing", async () => {
        const agent = await ctx.fns.agent.start({ model: "mock:test", tools: ["skill"] });
        const proposed = await asAgent(agent).fns.skills.propose({ repo, ref: "v1.0.0", as: "refused" });
        await ctx.fns.input.submit({ id: proposed.inputId, values: { decision: "no" }, actor: "person" });
        expect((await ctx.fns.skills.lockFile({})).lock.packs.refused).toBeUndefined();
        expect((await ctx.fns.input.get({ id: proposed.inputId })).result).toEqual({ installed: false });
    });

    test("the collections list is readable and marks nothing as installed here", async () => {
        const hubs = await ctx.fns.skills.hubs({});
        expect(hubs.length).toBeGreaterThanOrEqual(20);
        expect(hubs.filter((h: any) => h.trust === "official").map((h: any) => h.id)).toEqual(["anthropics", "claude-plugins", "openai"]);
        expect(hubs.every((h: any) => /^github:[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(h.repo) && h.about.length > 10)).toBe(true);
        expect(new Set(hubs.map((h: any) => h.repo.toLowerCase())).size).toBe(hubs.length);
    });
});

describe("skills: the buttons of the Skills pages", () => {
    // Earlier tests left packs of this same repository installed under other names; the buttons find a pack by its
    // repository, so start from nothing. The pack is then named after the repository folder: "work".
    test("start clean", async () => {
        for (const name of Object.keys((await ctx.fns.skills.lockFile({})).lock.packs)) await ctx.fns.skills.act({ op: "remove", pack: name });
        expect((await ctx.fns.skills.lockFile({})).lock.packs).toEqual({});
        expect(await ctx.fns.skills.list({})).toEqual([]);
    });

    const names = async (pack: string) => Object.keys((await ctx.fns.skills.lockFile({})).lock.packs[pack]?.skills ?? {}).sort();

    test("install one skill, add another, remove one, remove the last — the pack follows", async () => {
        expect((await ctx.fns.skills.act({ op: "install", repo, skill: "tdd" })).message).toContain("Installed tdd into pack work");
        expect(await names("work")).toEqual(["tdd"]);
        await ctx.fns.skills.act({ op: "install", repo, skill: "grill" });
        expect(await names("work")).toEqual(["grill", "tdd"]);
        expect((await ctx.fns.skills.list({ pack: "work" })).map((s: any) => s.name)).toEqual(["grill", "tdd"]);

        expect((await ctx.fns.skills.act({ op: "remove", pack: "work", skill: "tdd" })).message).toContain("keeps 1 skills");
        expect(await names("work")).toEqual(["grill"]);
        expect((await ctx.fns.skills.resolve({ name: "work:tdd" })).skill).toBeNull();
        expect((await ctx.fns.skills.act({ op: "remove", pack: "work", skill: "grill" })).message).toBe("Removed pack work");
        expect((await ctx.fns.skills.lockFile({})).lock.packs.work).toBeUndefined();
        expect(await exists(join(home, "skills", "work"))).toBe(false);
    });

    test("install all, narrow it, then 'install the rest' brings everything back; allow and deny flip the model flag", async () => {
        await ctx.fns.skills.act({ op: "install", repo });
        expect(await names("work")).toEqual(["grill", "new", "tdd"]);
        await ctx.fns.skills.act({ op: "remove", pack: "work", skill: "new" });
        expect(await names("work")).toEqual(["grill", "tdd"]);
        await ctx.fns.skills.act({ op: "install", pack: "work", all: true });
        expect(await names("work")).toEqual(["grill", "new", "tdd"]);
        expect((await ctx.fns.skills.lockFile({})).lock.packs.work.select).toBeUndefined();

        expect((await ctx.fns.skills.act({ op: "allow", pack: "work" })).message).toContain("Agents may now pick");
        expect((await ctx.fns.skills.lockFile({})).lock.packs.work.model).toBe(true);
        await ctx.fns.skills.act({ op: "deny", pack: "work" });
        expect((await ctx.fns.skills.lockFile({})).lock.packs.work.model).toBe(false);
        await ctx.fns.skills.act({ op: "remove", pack: "work" });
    });

    test("the button block offers what fits the state, and every form posts to /skills/act with the page's CSRF token", async () => {
        const fresh = await ctx.fns.skills.actions({ repo });
        expect(fresh).toContain("Install all");
        expect(fresh).not.toContain("Remove the pack");
        expect(fresh).toContain('hx-post="/skills/act"');
        expect(fresh).toContain("x-csrf-token");
        const one = await ctx.fns.skills.actions({ repo, skill: "tdd", installed: false });
        expect(one).toContain("Install this skill");

        await ctx.fns.skills.act({ op: "install", repo, skill: "tdd" });
        const packBlock = await ctx.fns.skills.actions({ pack: "work" });
        for (const label of ["Remove the pack", "Let agents pick it", "Update / install the rest"]) expect(packBlock).toContain(label);
        expect(await ctx.fns.skills.actions({ pack: "work", skill: "tdd", installed: true })).toContain("Remove this skill");
        expect(await ctx.fns.skills.actions({ repo, skill: "grill", installed: false })).toContain("Add this skill");
        expect(await ctx.fns.skills.view({ name: "work:tdd" })).toContain("Remove this skill");
        expect(await ctx.fns.skills.page({ pack: "work" })).toContain("Remove the pack");
        expect(await ctx.fns.skills.previewPage({ repo })).toContain("Add this skill");
        await ctx.fns.skills.act({ op: "remove", pack: "work" });
    });

    test("POST /skills/act: no CSRF token and an agent's session are refused; a person's post changes the pack", async () => {
        const name = ctx.fns.procs.auth.cookieName({});
        const cookie = `${name}=${await ctx.fns.procs.auth.sign({ sub: "u1", name: "Person", days: 1 })}`;
        const mk = (token: string, body: Record<string, string>) => new Request("http://hyper.local/skills/act", { method: "POST", headers: { cookie, "x-csrf-token": token, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
        const token = await ctx.fns.auth.csrfToken({ req: new Request("http://hyper.local/", { headers: { cookie } }) });
        const post = (session: any, tok: string, body: Record<string, string>) => { const c: any = Object.create(ctx); c.session = session; return actRoute(c, session, { req: mk(tok, body) }); };

        expect((await post({ kind: "http" }, "wrong", { op: "install", repo, skill: "tdd" })).status).toBe(403);
        expect((await post({ kind: "http", agentId: "zz" }, token, { op: "install", repo, skill: "tdd" })).status).toBe(403);
        expect((await ctx.fns.skills.lockFile({})).lock.packs.work).toBeUndefined();

        const ok = await post({ kind: "http" }, token, { op: "install", repo, skill: "tdd" });
        expect(ok.status).toBe(200);
        const html = await ok.text();
        expect(html).toContain("Installed tdd into pack work");
        expect(html).toContain("Remove this skill");
        expect(await names("work")).toEqual(["tdd"]);
        const bad = await post({ kind: "http" }, token, { op: "remove", pack: "nosuch" });
        expect(await bad.text()).toContain("That pack is not installed");
        await ctx.fns.skills.act({ op: "remove", pack: "work" });
    });
});
