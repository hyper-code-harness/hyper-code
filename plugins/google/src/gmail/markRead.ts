/**
 * Mark one Gmail message as read.
 *
 * Removes Gmail's system `UNREAD` label from the specified message. Use when
 * the user asks to mark an email or message as read, seen, or no longer unread.
 *
 * @param opts.id Gmail message identifier to mark as read.
 * @param opts.account Google account email; defaults to the configured Google account.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Gmail message identifier to mark as read. */
        id: string;
        /** Google account email; defaults to the configured Google account. */
        account?: string;
    },
): Promise<{ id: string; read: true }> {
    const id = String(opts.id ?? "").trim();
    if (!id) throw new Error("gmail.markRead: id is required");
    await ctx.fns.gmail.modify({ id, remove: ["UNREAD"], account: opts.account });
    return { id, read: true };
}
