/**
 * Keep only bounded identifiers suitable for the metadata-only usage ledger.
 *
 * Use for trusted adapter model/provider/account identifiers and authenticated client IDs. Reject URLs, queries, whitespace and credential-like strings instead of storing arbitrary request metadata.
 * @param opts.value Candidate code-owned or authenticated identifier; never a prompt, URL, header or secret.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Candidate code-owned or authenticated identifier; never a prompt, URL, header or secret. */
        value: string | null | undefined;
    },
): Promise<string | null> {
    const value = opts.value;
    if (typeof value !== "string" || value.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/.test(value)) return null;
    if (value.includes("://") || /^(?:sk-|Bearer|eyJ)/i.test(value)) return null;
    return value;
}
