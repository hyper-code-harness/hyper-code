import { test, expect, describe } from "bun:test";
import classify from "./classifyError";

const ctx: any = {};
const NOW = 1_786_900_000_000;
const call = (opts: any) => classify(ctx, null, { now: NOW, ...opts });

// The real body observed from chatgpt.com/backend-api/codex when the plan is spent.
const CODEX_LIMIT = JSON.stringify({
    error: {
        type: "usage_limit_reached",
        message: "The usage limit has been reached",
        plan_type: "prolite",
        resets_at: 1787219899,
        eligible_promo: null,
        resets_in_seconds: 319357,
    },
});

describe("llm.classifyError", () => {
    test("codex usage limit → park, not retry, with reset time", () => {
        const info = call({ provider: "codex", kind: "subscription", status: 429, body: CODEX_LIMIT });
        expect(info.kind).toBe("usage_limit");
        expect(info.retryable).toBe(false);
        expect(info.resetsAt).toBe(1787219899000);
        expect(info.planType).toBe("prolite");
        expect(info.message).toContain("prolite");
        expect(info.message).not.toContain("{");
    });

    test("resets_in_seconds is used when resets_at is absent", () => {
        const body = JSON.stringify({ error: { type: "usage_limit_reached", resets_in_seconds: 600 } });
        const info = call({ provider: "codex", kind: "subscription", status: 429, body });
        expect(info.resetsAt).toBe(NOW + 600_000);
    });

    test("anthropic subscription reads the unified reset header", () => {
        const info = call({
            provider: "claude-code",
            kind: "subscription",
            status: 429,
            body: JSON.stringify({ error: { type: "rate_limit_error", message: "usage limit reached" } }),
            headers: { "anthropic-ratelimit-unified-5h-reset": "1787000000" },
        });
        expect(info.kind).toBe("usage_limit");
        expect(info.resetsAt).toBe(1787000000000);
    });

    test("generic subscription rate_limit_error remains throttling when quota is not identified", () => {
        const info = call({
            provider: "claude-code",
            kind: "subscription",
            status: 429,
            body: JSON.stringify({ error: { type: "rate_limit_error", message: "Error" } }),
        });
        expect(info.kind).toBe("rate_limit");
        expect(info.retryable).toBe(true);
    });

    test("subscription 429 with Retry-After is throttling, not an exhausted plan", () => {
        const info = call({
            provider: "claude-code",
            kind: "subscription",
            status: 429,
            body: "{}",
            headers: { "retry-after": "30" },
        });
        expect(info.kind).toBe("rate_limit");
        expect(info.retryAfterMs).toBe(30_000);
        expect(info.retryable).toBe(true);
    });

    test("same 429 on a pay-per-token provider stays retryable", () => {
        const info = call({ provider: "openai", kind: "api", status: 429, body: "Rate limit reached" });
        expect(info.kind).toBe("rate_limit");
        expect(info.retryable).toBe(true);
    });

    test("unlabelled xAI subscription 429 remains throttling", () => {
        const info = call({ provider: "xai", kind: "subscription", status: 429, body: "{}" });
        expect(info.kind).toBe("rate_limit");
        expect(info.retryable).toBe(true);
    });

    test("explicit xAI quota exhaustion still parks", () => {
        const info = call({ provider: "xai", kind: "subscription", status: 429, body: JSON.stringify({ error: { type: "quota_exceeded", message: "quota exceeded" } }) });
        expect(info.kind).toBe("usage_limit");
        expect(info.retryable).toBe(false);
    });


    test("insufficient_quota is fatal — money, not a window", () => {
        const body = JSON.stringify({ error: { type: "insufficient_quota", message: "You exceeded your current quota" } });
        const info = call({ provider: "openai", kind: "api", status: 429, body });
        expect(info.kind).toBe("fatal");
        expect(info.retryable).toBe(false);
    });

    test("401 → auth, naming the account", () => {
        const info = call({ provider: "codex", account: "personal", kind: "subscription", status: 401, body: "" });
        expect(info.kind).toBe("auth");
        expect(info.account).toBe("personal");
        expect(info.message).toContain("codex/personal");
    });

    test("context overflow is recognised from the message", () => {
        const info = call({ provider: "anthropic", kind: "api", status: 400, body: "prompt is too long: 213462 tokens > 200000 maximum" });
        expect(info.kind).toBe("overflow");
    });

    test("5xx and dropped connections are transient", () => {
        expect(call({ provider: "codex", kind: "subscription", status: 503, body: "" }).kind).toBe("transient");
        expect(call({ provider: "codex", kind: "subscription", status: 0, body: "Connection closed" }).kind).toBe("transient");
    });

    test("Retry-After as an HTTP date becomes a delay", () => {
        const info = call({
            provider: "openai",
            kind: "api",
            status: 429,
            body: "",
            headers: { "retry-after": new Date(NOW + 45_000).toUTCString() },
        });
        expect(info.retryAfterMs).toBeGreaterThan(43_000);
        expect(info.retryAfterMs).toBeLessThanOrEqual(45_000);
    });

    test("unknown reset time is stated honestly, not invented", () => {
        const body = JSON.stringify({ error: { type: "usage_limit_reached" } });
        const info = call({ provider: "kimi-coding", kind: "subscription", status: 429, body });
        expect(info.kind).toBe("usage_limit");
        expect(info.resetsAt).toBeNull();
        expect(info.message).toContain("unknown");
    });
});
