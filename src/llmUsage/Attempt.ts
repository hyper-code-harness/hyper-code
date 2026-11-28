/** One provider submission with only normalized numeric usage and safe identity labels. */
export type Attempt = {
    id: string;
    scope: types.llmUsage.Scope;
    provider: string | null;
    account: string | null;
    model: string | null;
    api: "anthropic" | "responses" | "openai" | "sdk";
    remote: boolean;
    startedAt: number;
    finishedAt: number | null;
    status: "pending" | "success" | "error" | "cancelled";
    httpStatus: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    cacheReadTokens: number | null;
    cacheWriteTokens: number | null;
    usageState: "known" | "partial" | "unknown";
    finalized: boolean;
    persisted: boolean;
};
