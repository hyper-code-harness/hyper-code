import { describe, expect, test } from "bun:test";
import render from "./render";
import validate from "./validate";
import fence from "./$fence_reladraw";

const SRC = `node app "Web app"
node app.ui  "Interface"
node app.api "API"  below app.ui
node store "Database"  right of app  level with app
edge app.api -> store  "queries"  from: right  to: left`;

const ctx = { fns: { reladraw: { render: (o: any) => render({} as Context, null, o) } } } as unknown as Context;

describe("reladraw", () => {
    test("render returns svg with its size", async () => {
        const r = await render({} as Context, null, { source: SRC });
        expect(r.svg).toContain("<svg");
        expect(r.svg).toContain("Database");
        expect(r.width).toBeGreaterThan(0);
        expect(r.height).toBeGreaterThan(0);
    });
    test("theme option is applied and unknown theme is refused", async () => {
        const light = await render({} as Context, null, { source: SRC, theme: "light" });
        const dark = await render({} as Context, null, { source: SRC });
        expect(light.svg).not.toEqual(dark.svg);
        await expect(render({} as Context, null, { source: SRC, theme: "nope" })).rejects.toThrow(/unknown theme/);
    });
    test("validate reports the failing line", async () => {
        expect(await validate({} as Context, null, { source: SRC })).toEqual({ ok: true, problems: [] });
        const bad = await validate({} as Context, null, { source: 'node a "A"\nnode b "B" right of missing' });
        expect(bad.ok).toBe(false);
        expect(bad.problems[0]!.line).toBe(2);
    });
    test("fence renders responsive inline svg", async () => {
        const html = await fence(ctx, null, { source: SRC, lang: "reladraw", info: "light" });
        expect(html).toStartWith('<div class="reladraw-diagram"');
        expect(html).toMatch(/<svg[^>]*width="\d+"/);
        expect((/<svg\b[^>]*>/.exec(html)![0].match(/\sstyle="/g) ?? []).length).toBeLessThanOrEqual(1);
        expect(html).not.toContain("<?xml");
    });
});
