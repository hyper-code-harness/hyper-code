/** Aggregate-only LLM accounting result; no prompts, completions, credentials or raw response data. */
export type AccountingReport = {
    enabled: boolean;
    available: boolean;
    reason: "disabled" | "not-migrated" | null;
    filters: { from: number; to: number; source?: "local" | "node"; clientId?: string | null; agentId?: string | null; provider?: string | null; account?: string | null; model?: string | null; groupBy: "provider" | "model" | "account" | "client" | "agent" };
    /** All token values are non-overlapping; null means no reported value, not zero. */
    totals: { calls: number; remoteCalls: number; success: number; errors: number; cancelled: number; pending: number; attempts: number; completedAttempts: number; extraAttempts: number; inputTokens: number | null; outputTokens: number | null; cacheReadTokens: number | null; cacheWriteTokens: number | null; known: number; partial: number; unknown: number };
    /** Buckets use the call start time in UTC, matching the report period. */
    trend: Array<{ at: number; calls: number; attempts: number; inputTokens: number | null; outputTokens: number | null; cacheReadTokens: number | null; cacheWriteTokens: number | null }>;
    /** Ranked groups are bounded independently of totals; groups may share a retried call. */
    groups: Array<{ key: string; label: string; calls: number; attempts: number; inputTokens: number | null; outputTokens: number | null; cacheReadTokens: number | null; cacheWriteTokens: number | null }>;
};
