import { expect, test } from "bun:test";
import { testCtx } from "../../$test";

const ctx = await testCtx();
const ui = ctx.fns.procs.ui;

test("respond carries oob fragments, toast and triggers as htmx headers", async () => {
    const res = ui.respond({ html: "<p>ok</p>", oob: { counter: "3" }, toast: { message: "Saved" }, trigger: ["nav-refresh"] });
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(JSON.parse(res.headers.get("HX-Trigger")!)).toEqual({ "nav-refresh": true, "hyper-toast": { message: "Saved", level: "info" } });
    expect(await res.text()).toBe(`<p>ok</p><div id="counter" hx-swap-oob="innerHTML">3</div>`);
    const nav = ui.respond({ location: "/tasks/1" });
    expect(JSON.parse(nav.headers.get("HX-Location")!)).toEqual({ path: "/tasks/1", target: "#main", swap: "innerHTML" });
});

test("region combines lazy, polling and event triggers", () => {
    const html = ui.region({ id: "stats", src: "/x/stats", lazy: true, pollSeconds: 30, on: ["stats-changed"] });
    expect(html).toContain(`hx-trigger="revealed, every 30s, stats-changed from:body"`);
    expect(html).toContain(`data-section="stats"`);
    expect(ui.region({ id: "s", src: "/s", body: "x" })).not.toContain("hx-get");
});

test("dialog is opened by data attribute and submits with htmx", () => {
    const html = ui.dialog({ id: "d1", title: "New <x>", post: "/things", body: "<input name=a>" });
    expect(html).toContain(`<dialog id="d1" class="ui-dialog"`);
    expect(html).toContain(`hx-post="/things"`);
    expect(html).toContain("data-dialog-form");
    expect(html).toContain("New &lt;x&gt;");
    expect(ui.dialogButton({ dialog: "d1", label: "Open" })).toContain(`data-dialog-open="d1"`);
});

test("listPage shows the empty state when there are no rows", () => {
    const html = ui.listPage({ page: "things", title: "Things", rows: "", empty: { title: "No things" } });
    expect(html).toContain(`data-page="things"`);
    expect(html).toContain("No things");
    const withRows = ui.listPage({ page: "things", title: "Things", rows: ui.listItem({ entity: "thing", id: "1", title: "One", href: "/things/1", meta: ["a", "b"] }) });
    expect(withRows).toContain(`data-entity="thing" data-id="1"`);
    expect(withRows).toContain("a · b");
});

test("tabs mark the current tab and filterBar debounces search", () => {
    const tabs = ui.tabs({ current: "b", items: [{ value: "a", label: "A", href: "/?v=a" }, { value: "b", label: "B", href: "/?v=b", count: 2 }] });
    expect(tabs.match(/aria-current="page"/g)?.length).toBe(1);
    expect(ui.filterBar({ href: "/t", q: "x", hidden: { view: "open" } })).toContain("delay:300ms");
});

test("detailPage renders back link, id and aside panels", () => {
    const html = ui.detailPage({ page: "task", title: "T", id: "abc", back: { href: "/t", label: "Back" }, main: "body", aside: [{ title: "Status", body: "s" }] });
    expect(html).toContain("#abc");
    expect(html).toContain(`data-action="back"`);
    expect(html).toContain(`data-section="status"`);
});
