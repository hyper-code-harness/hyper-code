import { test, expect } from "bun:test";

const raw = async (path: string) => (await import(path)).default;

async function fixture() {
    const ctx: any = { fns: { mattpocockSkills: {} } };
    const list = await raw("./src/mattpocockSkills/list.ts");
    const get = await raw("./src/mattpocockSkills/get.ts");
    const about = await raw("./src/mattpocockSkills/about.ts");
    ctx.fns.mattpocockSkills.list = (o: any) => list(ctx, null, o);
    ctx.fns.mattpocockSkills.get = (o: any) => get(ctx, null, o);
    ctx.fns.mattpocockSkills.about = (o: any) => about(ctx, null, o);
    return ctx.fns.mattpocockSkills;
}

test("list returns the promoted skills with invocation kind and calls", async () => {
    const f = await fixture();
    const { skills, total } = await f.list({});
    expect(total).toBeGreaterThanOrEqual(25);
    const by = Object.fromEntries(skills.map((s: any) => [s.name, s]));
    expect(by.grilling.invocation).toBe("model");
    expect(by["grill-me"].invocation).toBe("user");
    expect(by["grill-me"].calls).toEqual(["grilling"]);
    expect(by["grill-with-docs"].calls).toEqual(["grilling", "domain-modeling"]);
    expect(by.tdd.files).toEqual(["mocking.md", "tests.md"]);
    expect(skills.every((s: any) => s.description.length > 0)).toBe(true);
});

test("list filters by invocation, bucket and query", async () => {
    const f = await fixture();
    expect((await f.list({ invocation: "user" })).skills.every((s: any) => s.invocation === "user")).toBe(true);
    expect((await f.list({ bucket: "productivity" })).skills.map((s: any) => s.name)).toContain("handoff");
    expect((await f.list({ query: "red-green" })).skills.map((s: any) => s.name)).toEqual(["tdd"]);
});

test("get returns verbatim text, followed skills, companion files and the Hyper map", async () => {
    const f = await fixture();
    const g = await f.get({ name: "grill-with-docs" });
    expect(g.markdown).toContain('Call the Skill tool twice, for "grilling" and "domain-modeling".');
    expect(g.called.map((c: any) => c.name)).toEqual(["grilling", "domain-modeling"]);
    expect(g.called[0].markdown).toContain("design tree");
    expect(g.hyper).toContain("agent.delegate");
    const t = await f.get({ name: "tdd", include: ["*"], follow: false });
    expect(t.files.map((x: any) => x.path)).toEqual(["mocking.md", "tests.md"]);
    expect(t.called).toEqual([]);
    await expect(f.get({ name: "nope" })).rejects.toThrow("no skill");
    await expect(f.get({ name: "tdd", include: ["x.md"] })).rejects.toThrow("has no file");
});

test("about reports the MIT pin", async () => {
    const f = await fixture();
    const a = await f.about({});
    expect(a.license).toBe("MIT");
    expect(a.author).toBe("Matt Pocock");
    expect(a.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(a.credit).toContain("mattpocock/skills");
});
