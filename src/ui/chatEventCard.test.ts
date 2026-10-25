import { expect, test } from "bun:test";
import render from "./chatEventCard";

const escape = ({ text }: any) => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const ctx: any = { fns: { procs: { ui: { escape } }, w: { escape } } };

test("chat event card renders one semantic shell for lifecycle events", () => {
    const html = render(ctx, null, { title: "Goal <check>", icon: "target", tone: "success", badge: "<b>done</b>", body: "<p>Verified</p>", details: "<pre>proof</pre>" });
    expect(html).toContain("border-ui-border-strong");
    expect(html).toContain("ph-target");
    expect(html).toContain("Goal &lt;check&gt;");
    expect(html).toContain("<b>done</b>");
    expect(html).toContain("<p>Verified</p>");
    expect(html).toContain("<pre>proof</pre>");
});

test("chat event card supports linked delegated-agent events", () => {
    const html = render(ctx, null, { title: "Agent child", href: "/agent/ab", tone: "info", attrs: 'data-team-update="progress"' });
    expect(html).toContain('<a href="/agent/ab"');
    expect(html).toContain('data-team-update="progress"');
    expect(html).toContain("bg-info/10");
    expect(html).toContain("!text-base-content");
});
