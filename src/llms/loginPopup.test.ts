import { describe, expect, test } from "bun:test";
import popup from "./loginPopup";

const button = ({ label, tone = "default", class: cls = "" }: any) => `<button type="submit" class="${cls} ui-button ui-button--sm ui-button--${tone}">${label}</button>`;
const ctx: any = { fns: { procs: { ui: { escape: ({ text }: any) => String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"), button } }, llms: { popupButton: button }, w: { escape: ({ text }: any) => String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"), button: ({ label, tone = "neutral" }: any) => `<a class="w-btn" data-tone="${tone}">${label}</a>` } } };

describe("llms.loginPopup", () => {
    test("Claude offers managed OAuth and CLI as separate explicit choices", () => {
        const html = popup(ctx, null, { provider: "claude-code" });
        expect(html).toContain('hx-popup="llms.startClaudeManagedOAuth"');
        expect(html).toContain("Managed OAuth");
        expect(html).toContain("recommended");
        expect(html).toContain('hx-popup="llms.startLoginFromPopup"');
        expect(html).toContain("Claude Code CLI");
        expect(html).not.toContain("accessToken");
        expect(html).not.toContain("refreshToken");
    });

    test("Codex uses only its typed device login flow", () => {
        const html = popup(ctx, null, { provider: "codex" });
        expect(html).toContain('hx-popup="llms.startLoginFromPopup"');
        expect(html).toContain("Start Codex login");
        expect(html).not.toContain("Managed OAuth");
    });

    test("pending Claude CLI can accept a one-time code without echoing it", () => {
        const html = popup(ctx, null, { provider: "claude-code", flow: { account: "work", status: "pending", verificationUri: "https://claude.test/auth", userCode: null, error: null } });
        expect(html).toContain('hx-popup="llms.submitLoginCode"');
        expect(html).toContain("One-time code from Claude");
        expect(html).toContain("never stored");
    });
    test("Grok starts managed device OAuth and renders only safe public metadata", () => {
        const start = popup(ctx, null, { provider: "xai" });
        expect(start).toContain('hx-popup="llms.startLoginFromPopup"');
        expect(start).toContain("Start Grok login");
        const progress = popup(ctx, null, { provider: "xai", flow: { account: "work", status: "pending", verificationUri: "https://accounts.x.ai/activate", userCode: "ABCD-EFGH", error: null } });
        expect(progress).toContain("Open authorization page");
        expect(progress).toContain("ABCD-EFGH");
        expect(progress).not.toContain("accessToken");
        expect(progress).not.toContain("refreshToken");
    });


});
