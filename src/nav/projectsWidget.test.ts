import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";
import widget from "./$widget_projects";

test("projects widget: one pick and one panel per project plus Misc; panels open with New agent in the project", async () => {
    const ctx: any = await mkTestCtx();
    ctx.fns.project.list = async () => [{ id: "a", slug: "hyperDesign", title: "hyper-design", defaultDir: "/x", defaultHost: "" }];
    ctx.fns.nav.agents = async () => [
        { id: "p1", title: "in project", model: "m", runState: "running", hasUnread: false },
        { id: "m1", title: "loose", model: "m", runState: "idle", hasUnread: true },
    ];
    ctx.fns.procs.db.select = async () => [{ id: "p1", project_id: "a" }];
    const out: any = await widget.render(ctx, null, { size: "wide", config: {} });
    const html: string = out.html;
    expect(html.match(/data-nav-project-pick="[^"]+"/g)).toEqual(['data-nav-project-pick="a"', 'data-nav-project-pick="misc"']);
    const panel = (id: string) => html.split(`data-nav-project-panel="${id}"`)[1]!.split("data-nav-project-panel")[0]!;
    expect(panel("a")).toContain("/agent/new?project=a");
    expect(panel("a")).toContain("in project");
    expect(panel("a")).not.toContain("loose");
    expect(panel("misc")).toContain("loose");
    expect(html).toMatch(/data-nav-project-panel="misc" hidden/);
    expect(html).toContain('href="/project/new"');
    // "+ create" rows open both columns, drawn the same way.
    expect(html.indexOf('href="/project/new"')).toBeLessThan(html.indexOf('data-nav-project-pick'));
    expect(panel("a").indexOf("/agent/new?project=a")).toBeLessThan(panel("a").indexOf("in project"));
});
