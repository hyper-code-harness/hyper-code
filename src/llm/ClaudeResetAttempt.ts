/** Durable one-use confirmation ticket. Contains no bearer tokens or provider response bodies. */
export type ClaudeResetAttempt = {
    id: string;
    provider: "claude-code" | "anthropic-oauth";
    account: string;
    organizationId: string;
    grantId: string;
    grantTitle: string;
    clears: string;
    remainingCount: number;
    grantExpiresAt: number;
    createdAt: number;
    expiresAt: number;
    state: "prepared" | "sending" | "done";
    outcome?: "reset" | "already_used" | "not_limited" | "cooldown" | "ineligible" | "unavailable" | "changed" | "busy" | "uncertain";
    usageRefreshed?: boolean;
};
