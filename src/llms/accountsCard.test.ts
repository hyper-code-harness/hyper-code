import { expect, test } from "bun:test";
import accountsCard from "./accountsCard";

const ctx: any = { fns: {
    procs: { ui: {
        escape: ({ text }: any) => String(text),
        row: (o: any) => JSON.stringify(o),
        heading: ({ title }: any) => title,
        empty: () => "empty",
        button: (o: any) => JSON.stringify(o),
        toolbar: () => "toolbar",
    } },
    w: {
        button: (o: any) => JSON.stringify(o), empty: () => "empty", escape: ({ text }: any) => String(text),
        record: (o: any) => JSON.stringify(o), heading: ({ title, actions }: any) => title + (actions ?? ""),
        card: ({ body }: any) => body, box: ({ body }: any) => body, badge: ({ text }: any) => `badge:${text}`, kbd: ({ keys }: any) => keys,
    },
    ui: {
        modelLogo: () => "logo",
        popup: (o: any) => JSON.stringify(o),
        live: ({ html }: any) => html,
    },
} };

test("accounts card groups consistently by provider and renders plan/storage metadata", () => {
    const html = accountsCard(ctx, null, { accounts: [
        { provider: "codex", account: "default", label: "codex", model: "codex:gpt", source: "file", available: true, usedPercent: 12, planType: "team", resetsAt: null, resetCredits: { availableCount: 3 }, parkedAgents: 0 },
        { provider: "anthropic-oauth", account: "pro", label: "pro", model: "anthropic-oauth/pro:claude", source: "oauth", available: true, usedPercent: 22, planType: "max", resetsAt: null, parkedAgents: 0 },
        { provider: "xai", account: "default", label: "Grok managed", model: "xai:grok", source: "oauth", available: true, usedPercent: null, planType: null, resetsAt: null, parkedAgents: 0 },
    ] });
    expect(html).toContain('data-provider="codex"');
    expect(html).toContain('data-provider="claude"');
    expect(html).toContain('"role":"plan","html":"badge:Team"');
    expect(html).toContain('data-provider="grok"');
    expect(html).toContain('"id":"xai/default"');
    expect(html).toContain('"role":"plan","html":"badge:Max"');
    expect(html).toContain('"role":"storage","text":"CLI storage"');
    expect(html).toContain('"role":"storage","text":"Encrypted by Hyper"');
    expect(html).toContain("/llms/codex/reset");
    expect(html).toContain("3 resets");
    expect(html).toContain("Reset limit");
    expect(html).not.toContain("Accounts from filesystem");
    expect(html).not.toContain("Managed by Hyper");
});

test("shows a reconnect action only on the broken account", () => {
    const html = accountsCard(ctx, null, { accounts: [
        { provider: "codex", account: "persona", label: "persona", model: "codex/persona:gpt", source: "file", available: true, usedPercent: 10, planType: "team", resetsAt: null, parkedAgents: 1, needsReconnect: true },
        { provider: "codex", account: "healthy", label: "healthy", model: "codex/healthy:gpt", source: "file", available: true, usedPercent: 20, planType: "team", resetsAt: null, parkedAgents: 0, needsReconnect: false },
    ] });
    expect(html).toContain("authentication required");
    expect(html).toContain("llms.loginPopupFor");
    expect(html).toContain('\\"account\\":\\"persona\\"');
    expect(html).not.toContain('llms.loginPopupFor\\",\\"params\\":{\\"provider\\":\\"codex\\",\\"account\\":\\"healthy\\"');
});
