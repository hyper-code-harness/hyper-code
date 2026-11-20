import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

test("compaction form explains optional focus and queues without interrupting the current turn", async () => {
    const ctx = await mkTestCtx();
    const html = ctx.fns.chat.compactForm({ agentId: "a1" });
    expect(html).toContain('hx-post="/agent/a1/compact"');
    expect(html).toContain('hx-swap="none"');
    expect(html).toContain("Compact context");
    expect(html).toContain('name="instructions"');
    expect(html).toContain('aria-label="Optional focus instructions"');
    expect(html).not.toContain("required");
    expect(html).toContain("Focus is optional; leave blank for the default summary.");
    expect(html).toContain("Compaction is queued after the current turn and does not interrupt it.");
    expect(html).toContain("Queue compaction");
    expect(html).toContain('type="submit"');
    expect(html).toContain('data-action="compact-context"');
});

test("compaction form encodes its agent route parameter", async () => {
    const ctx = await mkTestCtx();
    const html = ctx.fns.chat.compactForm({ agentId: 'a/b"<>' });
    expect(html).toContain('hx-post="/agent/a%2Fb%22%3C%3E/compact"');
});
