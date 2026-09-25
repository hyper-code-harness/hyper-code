import { expect, test } from "bun:test";
import renderSection from "./agentMetaSection";

const escape = ({ text }: any) => String(text).replaceAll("&", "&amp;").replaceAll('"', "&quot;");
const button = (o: any) => `<button type="${o.type ?? "button"}"${o.action ? ` data-action="${o.action}"` : ""}${o.attrs?.popovertarget ? ` popovertarget="${o.attrs.popovertarget}"` : ""}>${o.html ?? o.label ?? ""}</button>`;

test("Automation add trigger uses a native popover target", () => {
  const ctx: any = { fns: { procs: { ui: { escape, button } }, ui: {
    statusBadge: ({ label }: any) => label,
    inspectorSection: ({ title, html }: any) => `<section>${title}${html}</section>`,
    toggle: () => "",
  } } };
  const html = renderSection(ctx, null, { agent: { id: "aa", scratchpad: {} } as any, section: "automation", triggers: [] });
  expect(html).toContain('popovertarget="agent-trigger-add-aa"');
  expect(html).toContain('id="agent-trigger-add-aa" popover');
  expect(html).toContain("Wake-up");
  expect(html).toContain("Schedule");
  expect(html).toContain("Watch condition");
});
