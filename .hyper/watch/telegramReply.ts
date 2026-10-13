/**
 * Report whether a Telegram chat has a new incoming message after a given time.
 *
 * Durable-watch predicate: ready when the latest messages of the chat contain an incoming (not outgoing) message newer than `after`. Use with agent.watch runtime.fn to wake an agent when a person replies in Telegram.
 * @param opts.chat Telegram chat id or username to poll.
 * @param opts.after ISO timestamp; only incoming messages strictly newer count.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Telegram chat id or username to poll. */
        chat: string;
        /** ISO timestamp; only incoming messages strictly newer count. */
        after: string;
    },
): Promise<{ ready: boolean; result?: { date: string; text: string } }> {
    const m: any = await (ctx.fns as any).telegram.messages({ chat: opts.chat, limit: 5 });
    const arr: any[] = Array.isArray(m) ? m : (m?.messages ?? []);
    const t = Date.parse(opts.after);
    // telegram.messages carries no `out` flag: my own messages are recognised by my display name.
    const me: any = await (ctx.fns as any).telegram.me({});
    const myName = [me?.firstName, me?.lastName].filter(Boolean).join(" ");
    const hit = arr.filter((x: any) => !x.out && x.sender !== myName && Date.parse(x.date) > t).pop();
    return hit ? { ready: true, result: { date: String(hit.date), text: String(hit.text ?? "").slice(0, 500) } } : { ready: false };
}
