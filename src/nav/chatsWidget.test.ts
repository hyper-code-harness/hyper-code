import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";
import widget from "./$widget_chats";

test("chats widget: a chat in a project carries the project title as its grey hint; others carry none", async () => {
    const ctx: any = await mkTestCtx();
    ctx.fns.project.list = async () => [{ id: "a", slug: "hyperDesign", title: "hyper-design", defaultDir: "/x", defaultHost: "" }];
    ctx.fns.nav.agents = async () => [
        { id: "p1", title: "in project", model: "m", runState: "idle", hasUnread: false },
        { id: "m1", title: "loose", model: "m", runState: "idle", hasUnread: false },
    ];
    ctx.fns.mentions.list = async () => [];
    ctx.fns.auth.pinnedIds = async () => new Set<string>();
    ctx.fns.procs.db.select = async () => [{ id: "p1", project_id: "a" }];
    const out: any = await widget.render(ctx, null, { size: "tall", config: {} });
    const rows = out.sections.at(-1).items;
    expect(rows.find((r: any) => r.id === "agent:p1").hint).toBe("hyper-design");
    expect(rows.find((r: any) => r.id === "agent:m1").hint).toBeUndefined();
    const html = await ctx.fns.nav.rows({ items: rows });
    expect(html).toContain('<span class="w-row-hint">hyper-design</span>');
});
