import { expect, test } from "bun:test";
import inspectorSection from "./inspectorSection";
import progressBar from "./progressBar";
import statusBadge from "./statusBadge";

const escape = ({ text }: any) => String(text)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const ctx: any = { fns: { procs: { ui: { escape } }, w: { escape } } };

test("inspector section renders semantic collapsible shell", () => {
    const html = inspectorSection(ctx, null, {
        title: "Plan <unsafe>", html: "<strong>trusted body</strong>", icon: "list-checks",
        badge: "<span>2/3</span>", collapsible: true, open: true,
    });
    expect(html).toContain("<details open");
    expect(html).toContain("border-ui-border");
    expect(html).toContain("bg-transparent");
    expect(html).toContain("bg-base-100/25");
    expect(html).toContain("Plan &lt;unsafe&gt;");
    expect(html).toContain("<strong>trusted body</strong>");
});

test("status badge uses semantic tones and escapes content", () => {
    const html = statusBadge(ctx, null, { label: "needs <user>", tone: "warning", dot: true });
    expect(html).toContain("border-error/30");
    expect(html).toContain("text-error");
    expect(html).toContain("needs &lt;user&gt;");
    expect(html).toContain("bg-current");
});

test("progress bar clamps values and exposes accessible percentage", () => {
    const html = progressBar(ctx, null, { value: 9, max: 4, label: "Build", tone: "success" });
    expect(html).toContain('value="4"');
    expect(html).toContain('max="4"');
    expect(html).toContain("progress-success");
    expect(html).toContain('aria-label="Build: 100%"');
});
