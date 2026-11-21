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

const claudeAccount = (resetCredits?: types.llm.UsageSnapshot["resetCredits"]) => ({ provider: "anthropic-oauth", account: "adam", label: "Adam", model: "anthropic-oauth/adam:claude", source: "oauth" as const, available: true, usedPercent: 50, planType: "max", resetsAt: null, parkedAgents: 0, resetCredits });
const resetNow = Date.parse("2026-11-21T12:00:00Z");

test("Claude opens a confirmation popup, not an immediate redemption form", () => {
    const html = accountsCard(ctx, null, { now: resetNow, accounts: [claudeAccount({ availableCount: 2, checkedAt: resetNow, credits: [{ id: "weekly", title: "Weekly reset", remainingCount: 2, usableNow: true, expiresAt: resetNow + 86_400_000 }] })] });
    expect(html).toContain("2 resets");
    expect(html).toContain("Weekly reset");
    expect(html).toContain("expires");
    expect(html).toContain("https://claude.ai/settings/usage");
    expect(html).toContain("Last checked");
    expect(html).not.toContain("/llms/codex/reset");
    expect(html).toContain("Reset limit");
    expect(html).toContain("llms.claudeResetPopup");
    expect(html).not.toContain("consumeClaudeReset");
    expect(html).not.toContain("<form");
});

test("Claude unknown is not zero, and expired grants are not offered", () => {
    const unknown = accountsCard(ctx, null, { now: resetNow, accounts: [claudeAccount({ availableCount: null, checkedAt: resetNow, unavailableReason: "surface" })] });
    expect(unknown).toContain("Reset count unavailable");
    expect(unknown).not.toContain("0 resets");
    expect(accountsCard(ctx, null, { now: resetNow, accounts: [claudeAccount()] })).toContain("Resets not checked");
    const expired = accountsCard(ctx, null, { now: resetNow, accounts: [claudeAccount({ availableCount: 1, checkedAt: resetNow - 1000, credits: [{ id: "old", title: "Expired grant", remainingCount: 1, expiresAt: resetNow - 1 }] })] });
    expect(expired).toContain("0 resets");
    expect(expired).not.toContain("Expired grant");
});

test("Claude grant labels are escaped, and restricted grants are labelled", () => {
    const safeCtx = { ...ctx, fns: { ...ctx.fns, w: { ...ctx.fns.w, escape: ({ text }: { text: string }) => Bun.escapeHTML(String(text)) } } };
    const html = accountsCard(safeCtx, null, { now: resetNow, accounts: [claudeAccount({ availableCount: 1, credits: [{ id: "unsafe", title: "<script>bad</script>", description: "<img src=x>", remainingCount: 1, usableNow: false, expiresAt: resetNow + 1000 }] })] });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("currently restricted");
});

test("Claude does not offer reset for restricted, remote or reconnecting accounts", () => {
    const reset = { availableCount: 1, credits: [{ id: "weekly", remainingCount: 1, usableNow: true, expiresAt: resetNow + 10000 }] };
    for (const account of [
        { ...claudeAccount(reset), source: "node" as const },
        { ...claudeAccount(reset), needsReconnect: true },
        claudeAccount({ ...reset, credits: [{ ...reset.credits[0]!, usableNow: false }] }),
    ]) expect(accountsCard(ctx, null, { now: resetNow, accounts: [account] })).not.toContain("llms.claudeResetPopup");
});
