/**
 * How much of a subscription's quota is spent, as last reported by the
 * provider. Recorded by llm.recordUsage from response headers, stream payloads,
 * and the explicit provider refresh performed for the /llms page.
 */
export type UsageSnapshot = {
    /** Provider name, e.g. "codex". */
    provider: string;
    /** Credential account within the provider, "default" when unnamed. */
    account: string;
    /** Rolling windows: primary is the short one (5h), secondary the long one (7d). */
    windows: {
        primary?: types.llm.UsageWindow;
        secondary?: types.llm.UsageWindow;
    };
    /** Subscription plan reported by the provider, e.g. "prolite". */
    planType?: string | null;
    /** Provider-reported one-shot resets, separate from automatic quota-window reset times. Null count means the provider did not expose availability, not zero resets. */
    resetCredits?: {
        availableCount: number | null;
        /** Time this reset availability was explicitly checked; ordinary model responses do not refresh it. */
        checkedAt?: number;
        /** Safe provider availability reason, never a transport error or credential. */
        unavailableReason?: "surface" | "unavailable" | "invalid-response";
        credits?: Array<{
            id: string;
            resetType?: string;
            status?: string;
            grantedAt?: string | number;
            expiresAt?: string | number | null;
            title?: string | null;
            description?: string | null;
            /** Remaining uses of a Claude grant; Codex credit rows represent one use each. */
            remainingCount?: number;
            /** Whether the provider currently allows use; display-only, never automatic redemption. */
            usableNow?: boolean;
        }>;
    } | null;
    /** When this snapshot was taken, ms epoch. */
    updatedAt: number;
    /** Where the numbers came from. */
    source: "headers" | "stream" | "error";
    /** When a threshold warning last fired for the current window, ms epoch. */
    warnedAt?: number | null;
};
