/**
 * Checks whether the other party replied in a Telegram chat after a given message id; wake predicate shape
 *
 * Polls the latest messages of one Telegram chat and reports { ready: true, result } when at least one message with id greater than `afterId` was sent by someone other than me. Designed for agent.wakeUpWhen({ predicate: 'runtime.fn' }): returns { ready: false } otherwise. Use to wait for a person's answer without polling manually.
 * @param opts.chat Chat identifier or username.
 * @param opts.afterId Only messages with a greater Telegram message id count as replies. @minimum 0
 * @param opts.max How many latest messages to inspect. @default 10 @minimum 1 @maximum 50
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Chat identifier or username. */
        chat: string | number;
        /** Only messages with a greater Telegram message id count as replies. @minimum 0 */
        afterId: number;
        /** How many latest messages to inspect. @default 10 @minimum 1 @maximum 50 */
        max?: number;
    },
): Promise<{ ready: boolean; result?: { replies: Array<{ id: number; date: string; sender: string; text: string }> } }> {
    const me: any = await (ctx.fns as any).telegram.me({}).catch(() => null);
        const myId = me?.id != null ? String(me.id) : null;
        const myName = [me?.firstName, me?.lastName].filter(Boolean).join(" ") || null;
        const list: any[] = await (ctx.fns as any).telegram.messages({ chat: opts.chat, max: Math.min(50, Math.max(1, opts.max ?? 10)) });
        const replies = (Array.isArray(list) ? list : []).filter(m => Number(m.id) > opts.afterId && !m.out && !(myId && String(m.senderId ?? "") === myId) && !(myName && String(m.sender ?? "") === myName))
            .map(m => ({ id: Number(m.id), date: String(m.date ?? ""), sender: String(m.sender ?? ""), text: String(m.text ?? "").slice(0, 2000) }));
        return replies.length ? { ready: true, result: { replies } } : { ready: false };
}
