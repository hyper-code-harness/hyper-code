import { beforeAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testCtx } from "../../$test";
import loadTags from "./$loader_tag";
import loadFns from "../../procs/$loader_fn";

// Function tags end to end on the real index: `$tag_` declarations, `meta.tags` from JSDoc, the `tags` column,
// runtime.docs.search({ tag, tagValue }) in every mode, runtime.docs.tags and the code.quality rules.
const ctx = await testCtx({ env: { PROCS_PLUGINS: "./plugins" } });

// Functions written for this file, loaded into the registry the way boot loads any function.
const dir = mkdtempSync(join(tmpdir(), "tags-test-"));
function fnEntry(module: string, name: string, source: string): any {
    mkdirSync(join(dir, module), { recursive: true });
    const abs = join(dir, module, `${name}.ts`);
    writeFileSync(abs, source);
    return { kind: "fn", abs, rel: `${module}/${name}.ts`, moduleDir: module, runtimeName: name, namespace: module, fileName: `${name}.ts` };
}
const page = (doc: string) => `/**\n * ${doc}\n */\nexport default function (ctx: any, session: any, opts: {}): string { return "<p>x</p>"; }\n`;

beforeAll(async () => {
    await ctx.fns.settings.set({ module: "embeddings", scopeType: "global", key: "provider", value: "off" });
    await loadFns(ctx, null, { entries: [
        fnEntry("tagdemo", "zebraBoard", page("Shows the zebra crossing board as a page.\n * @view\n * @live zebra")),
        fnEntry("tagdemo", "zebraTable", page("Lists zebra crossings with their state.\n * @canvas zebras\n * @canvas extra")),
        fnEntry("tagdemo", "zebraTypo", page("Zebra report with a misspelt tag.\n * @veiw\n * @view now")),
        fnEntry("tagdemo", "zebraProse", page("Reads the @mentions badge of a zebra; not a tag in the middle of a sentence.")),
        fnEntry("project_nobodyHere", "zebraSecret", page("Private zebra page of a project nobody may call.\n * @view")),
    ] });
    await ctx.fns.runtime.docs.index({ localize: false });
});

test("the three framework tags are declared by $tag_ files with their owners", async () => {
    const tags = await ctx.fns.runtime.docs.tags({});
    const byName = Object.fromEntries(tags.map(t => [t.name, t]));
    expect(Object.keys(byName)).toEqual(expect.arrayContaining(["view", "canvas", "live"]));
    expect(byName.view).toMatchObject({ module: "rpc", rel: expect.stringContaining("$tag_view.ts") });
    expect(byName.canvas?.arg).toBe("kind");
    expect(byName.live?.arg).toBe("topic");
    expect(byName.view!.count).toBeGreaterThan(5);
});

test("meta.tags keeps line-opening tags only; view/live/canvas are derived from it", () => {
    const board = ctx.fns.runtime.docs.get({ name: "tagdemo.zebraBoard" });
    expect(board.tags).toEqual({ view: [], live: ["zebra"] });
    expect(board.view).toBe(true);
    expect(board.live).toBe("zebra");
    expect(ctx.fns.runtime.docs.get({ name: "tagdemo.zebraTable" }).canvas).toBe("zebras");
    expect(ctx.fns.runtime.docs.get({ name: "tagdemo.zebraProse" }).tags).toEqual({});
    // Standard JSDoc stays documentation.
    expect(Object.keys(ctx.fns.runtime.docs.get({ name: "memory.view" }).tags)).toEqual(expect.arrayContaining(["view", "live"]));
    expect(ctx.fns.runtime.docs.get({ name: "runtime.docs.search" }).tags).toEqual({});
});

test("search by tag alone lists the tagged functions; with a query it ranks inside them", async () => {
    const views = (await ctx.fns.runtime.docs.search({ tag: "view", limit: 50 })).map(r => r.name);
    expect(views).toContain("tagdemo.zebraBoard");
    expect(views).toContain("gcal.dayPage");
    expect(views).not.toContain("tagdemo.zebraTable");
    const ranked = await ctx.fns.runtime.docs.search({ query: "calendar day page", tag: "view" });
    expect(ranked[0]?.name).toBe("gcal.dayPage");
    expect(ranked.every(r => views.includes(r.name))).toBe(true);
});

test("tagValue narrows a tag with an argument; every mode applies the same filter", async () => {
    const live = await ctx.fns.runtime.docs.search({ query: "zebra", tag: "live", tagValue: "zebra" });
    expect(live.map(r => r.name)).toEqual(["tagdemo.zebraBoard"]);
    expect(await ctx.fns.runtime.docs.search({ query: "zebra", tag: "live", tagValue: "memory" })).toEqual([]);
    for (const mode of ["bm25", "lexical", "hybrid"] as const) {
        const names = (await ctx.fns.runtime.docs.search({ query: "zebra crossings", tag: "canvas", mode })).map(r => r.name);
        expect(names).toEqual(["tagdemo.zebraTable"]);
    }
    expect((await ctx.fns.runtime.docs.search({ query: "zebra", tag: "canvas", tagValue: "extra", mode: "lexical" })).map(r => r.name)).toEqual(["tagdemo.zebraTable"]);
});

test("an unknown tag is an error naming the known ones, in every mode", async () => {
    for (const mode of ["hybrid", "lexical"] as const) {
        await expect(ctx.fns.runtime.docs.search({ query: "zebra", tag: "veiw", mode })).rejects.toThrow(/unknown tag "veiw".*view/);
    }
    await expect(ctx.fns.runtime.docs.search({ query: "zebra", tagValue: "x" })).rejects.toThrow(/tagValue needs tag/);
});

test("functions of a memory level the caller may not run are left out of search and counts", async () => {
    // A request ctx carries its session to every ctx.fns call (procs/boot/requestCtx).
    const asAgent: any = Object.create(ctx);
    asAgent.session = { kind: "agent", agentId: "nobody-agent" };
    const names = (await asAgent.fns.runtime.docs.search({ tag: "view", limit: 50 })).map((r: any) => r.name);
    expect(names).toContain("gcal.dayPage");
    expect(names).not.toContain("project_nobodyHere.zebraSecret");
    const lexical = (await asAgent.fns.runtime.docs.search({ query: "private zebra page", mode: "lexical" })).map((r: any) => r.name);
    expect(lexical).not.toContain("project_nobodyHere.zebraSecret");
    const counted = (await asAgent.fns.runtime.docs.tags({})).find((t: any) => t.name === "view").count;
    // The count is what this caller can see: exactly what the listing shows, fewer than the server sees.
    expect(counted).toBe(names.length);
    expect(counted).toBeLessThan((await ctx.fns.runtime.docs.tags({})).find(t => t.name === "view")!.count);
    // The server itself (no session) sees everything, and the index stays global.
    expect((await ctx.fns.runtime.docs.search({ tag: "view", limit: 50 })).map(r => r.name)).toContain("project_nobodyHere.zebraSecret");
});

test("re-indexing unchanged functions writes nothing; a changed tag is written", async () => {
    const before = await ctx.fns.procs.db.select({ sql: "SELECT name, updated_at, tags FROM functions ORDER BY name", params: [] });
    await ctx.fns.runtime.docs.index({ localize: false });
    const after = await ctx.fns.procs.db.select({ sql: "SELECT name, updated_at, tags FROM functions ORDER BY name", params: [] });
    expect(after).toEqual(before);
    await ctx.fns.procs.db.run({ sql: "UPDATE functions SET tags = '{}'::jsonb WHERE name = 'tagdemo.zebraBoard'", params: [] });
    await ctx.fns.runtime.docs.index({ localize: false });
    const row: any = (await ctx.fns.procs.db.select({ sql: "SELECT tags FROM functions WHERE name = 'tagdemo.zebraBoard'", params: [] }))[0];
    expect(row.tags).toEqual({ live: ["zebra"], view: [] });
});

test("code.quality names undeclared tags and tags used against their declaration", async () => {
    const q = await ctx.fns.code.quality({ include: ["tags"], limit: 500 });
    const mine = q.findings.filter(f => f.name.startsWith("tagdemo."));
    expect(mine).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "unknown-tag", name: "tagdemo.zebraTypo", detail: expect.stringContaining("@veiw") }),
        expect.objectContaining({ kind: "tag-arg", name: "tagdemo.zebraTypo", detail: expect.stringContaining("takes no argument") }),
        expect.objectContaining({ kind: "tag-arg", name: "tagdemo.zebraTable", detail: expect.stringContaining("not repeatable") }),
    ]));
    expect(mine.some(f => f.name === "tagdemo.zebraBoard")).toBe(false);
});

test("$tag_ declarations: a second module may not redeclare a tag; the same file reloads in place", async () => {
    const decl = (body: string) => { const abs = join(dir, `decl-${Math.random().toString(36).slice(2)}.ts`); writeFileSync(abs, `export default ${body};\n`); return abs; };
    await expect(loadTags(ctx, null, { entries: [{ name: "view", abs: decl(`{ summary: "mine" }`), rel: "zebra/$tag_view.ts", moduleDir: "zebra" }] })).rejects.toThrow(/already declared by .*\$tag_view\.ts/);
    const own = (ctx.state as any).tags.view.rel;
    await loadTags(ctx, null, { entries: [{ name: "view", abs: decl(`{ summary: "Read-only page by address, reloaded" }`), rel: own, moduleDir: "rpc" }] });
    expect((ctx.state as any).tags.view.summary).toContain("reloaded");
    await expect(loadTags(ctx, null, { entries: [{ name: "bad_name", abs: decl(`{ summary: "x" }`), rel: "zebra/$tag_bad_name.ts", moduleDir: "zebra" }] })).rejects.toThrow(/name must/);
    await expect(loadTags(ctx, null, { entries: [{ name: "nosummary", abs: decl(`{}`), rel: "zebra/$tag_nosummary.ts", moduleDir: "zebra" }] })).rejects.toThrow(/needs a summary/);
    rmSync(dir, { recursive: true, force: true });
});
