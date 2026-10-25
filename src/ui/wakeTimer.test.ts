import { expect, test } from "bun:test";
import render from "./wakeTimer";

const ctx: any = { fns: { procs: { ui: { escape: ({ text }: any) => String(text) } }, w: { escape: ({ text }: any) => String(text) } } };

test("wake timer renders seconds and polls every second", () => {
    const realNow = Date.now;
    Date.now = () => 1_000_000;
    try {
        const html = render(ctx, null, { agent: { id: "eh", wakeAt: 1_065_000 } as any });
        expect(html).toContain("1m 05s");
        expect(html).toContain('data-wake-at="1065000"');
        expect(html).not.toContain('hx-get');
        expect(html).toContain("tabular-nums");
        expect(html).toContain("w-[5.5rem]");
        expect(html).toContain("text-right");
    } finally { Date.now = realNow; }
});
