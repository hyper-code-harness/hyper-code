import { expect, test } from "bun:test";
import render from "./toggle";

const ctx: any = { fns: { procs: { ui: { escape: ({ text }: any) => String(text).replaceAll('<', '&lt;') } }, w: { escape: ({ text }: any) => String(text).replaceAll('<', '&lt;') } } };

test("toggle keeps its thumb within a 36x20 track", () => {
    const html = render(ctx, null, { name: "sleep", enabled: true, label: "Sleep", hint: "Idle" });
    expect(html).toContain("ui-toggle-input");
    expect(html).toContain("ui-toggle-track");
    expect(html).toContain("ui-toggle-thumb");
    expect(html).toContain("checked");
});
