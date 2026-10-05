import { expect, test } from "bun:test";
import render from "./inplacePopup";
import { renderCtx } from "./testRender.entry";

const ctx = await renderCtx();

test("renders a top-layer panel anchored to its trigger", async () => {
    const html = await render(ctx, null, {
        id: "compact-a",
        triggerHtml: "Open",
        contentHtml: "Panel",
        triggerAttrs: 'title="Compact"',
    });
    expect(html).toContain('popovertarget="compact-a"');
    expect(html).toContain('anchor-name:--inplace-compact-a');
    expect(html).toContain('position-anchor:--inplace-compact-a');
    expect(html).toContain('class="inplace-popup-panel"');
});

test("adds accessible popover semantics and disambiguates sanitized IDs", async () => {
    const first = await render(ctx, null, { id: "agent/a", triggerHtml: "Open", contentHtml: "Panel" });
    const second = await render(ctx, null, { id: "agent-a", triggerHtml: "Open", contentHtml: "Panel" });
    expect(first).toContain('aria-haspopup="dialog"');
    expect(first).not.toContain('popovertarget="agent-a"');
    expect(first).not.toContain('id="agent/a"');
    expect(second).toContain('popovertarget="agent-a"');
});

test("escapes the generated DOM ID", async () => {
    const html = await render(ctx, null, { id: 'a"b', triggerHtml: "Open", contentHtml: "Panel" });
    expect(html).not.toContain('id="a"b"');
    expect(html).not.toContain('popovertarget="a"b"');
});
