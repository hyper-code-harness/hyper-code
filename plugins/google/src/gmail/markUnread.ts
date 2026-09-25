/**
 * Mark one Gmail message as unread.
 *
 * Adds Gmail's system `UNREAD` label to the specified message. Use when the
 * user asks to mark an email or message as unread, unseen, or needing attention.
 *
 * @param opts.id Gmail message identifier to mark as unread.
 * @param opts.account Google account email; defaults to the configured Google account.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Gmail message identifier to mark as unread. */
        id: string;
        /** Google account email; defaults to the configured Google account. */
        account?: string;
    },
): Promise<{ id: string; unread: true }> {
    const id = String(opts.id ?? "").trim();
    if (!id) throw new Error("gmail.markUnread: id is required");
    await ctx.fns.gmail.modify({ id, add: ["UNREAD"], account: opts.account });
    return { id, unread: true };
}
