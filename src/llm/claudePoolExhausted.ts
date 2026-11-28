/**
 * Raise a parkable failure when every shared Claude subscription is exhausted
 *
 * Use only after the enabled Claude pool has no account with remaining quota. Workers recognize the synthetic claude-pool provider and wait all local Claude chats until the first usable account resets; relay converts the same failure to a quota HTTP response.
 * @param opts.resetsAt Earliest time in epoch milliseconds at which a pool account can be used again; null means unknown.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Earliest time in epoch milliseconds at which a pool account can be used again; null means unknown. */
        resetsAt: number | null;
    },
): Promise<never> {
    const message = `All Claude subscription accounts are exhausted.${opts.resetsAt ? ` Next quota reset: ${new Date(opts.resetsAt).toISOString()}.` : " Reset time unknown."}`;
    throw Object.assign(new Error(message), { failure: { kind: "usage_limit", provider: "claude-pool", account: "default", resetsAt: opts.resetsAt, status: 429, retryable: false, message } satisfies types.llm.FailureInfo });
}
