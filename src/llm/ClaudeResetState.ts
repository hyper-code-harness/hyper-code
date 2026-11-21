/** Fresh, credential-free Claude reset eligibility for a single OAuth organization. */
export type ClaudeResetState = {
    organizationId: string;
    resetCredits: NonNullable<types.llm.UsageSnapshot["resetCredits"]>;
    nextGrantId: string | null;
    cooldownUntil: number | null;
};
