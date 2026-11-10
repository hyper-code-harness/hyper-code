import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

async function opSecret(ctx: Context, ref: string) {
    const name = ref.includes("session.txt") ? "session" : ref.includes("config.json") ? "config" : new Bun.CryptoHasher("sha256").update(ref).digest("hex").slice(0, 32);
    const value = await ctx.fns.secrets.get({ ref, namespace: "telegram", name });
    if (!value) throw new Error("Telegram credential is not configured");
    return value;
}

type TelegramClientSingleton = { client?: TelegramClient; connecting?: Promise<TelegramClient> | null };
const telegramClientKey = Symbol.for("hyper-code2.telegram.client.singleton");

async function connected(ctx: Context) {
    const root = globalThis as typeof globalThis & { [telegramClientKey]?: TelegramClientSingleton };
    const cache = (root[telegramClientKey] ??= {});
    // Adopt a pre-singleton client once during hot reload instead of opening the
    // same persisted StringSession a second time in this process.
    const legacy = (ctx.state as any).telegram;
    if (!cache.client?.connected && legacy?.client?.connected) cache.client = legacy.client;
    if (cache.client?.connected) return cache.client;
    if (cache.connecting) return await cache.connecting;
    cache.connecting = (async () => {
        const [configRaw, sessionString] = await Promise.all([
            opSecret(ctx, "op://hyper/telegram config.json/value"),
            opSecret(ctx, "op://hyper/telegram session.txt/value"),
        ]);
        if (!configRaw || !sessionString) throw new Error("Telegram credentials are not configured in 1Password");
        const config = JSON.parse(configRaw);
        const client = new TelegramClient(new StringSession(sessionString.trim()), config.apiId, String(config.apiHash), { connectionRetries: 5 });
        await client.connect();
        if (!(await client.checkAuthorization())) throw new Error("Telegram session is no longer authorized");
        cache.client = client;
        return client;
    })();
    try { return await cache.connecting; } finally { cache.connecting = null; }
}

/**
 * Read the current state and vote counts of a Telegram poll message.
 *
 * Use after telegram.sendPoll to see how a person or group answered. Returns per-option vote counts, the
 * options the account itself chose, total voters and, for public polls, recent voter ids.
 *
 * @param ctx Runtime context.
 * @param session Active session, when available.
 * @param opts Poll message location.
 * @returns Question, options with votes, total voters, closed flag.
 */
export default async function (ctx: Context, session: Session | null, opts: {
        /** Chat identifier or @username. */
        chat: string | number;
        /** Message id of the poll (returned by telegram.sendPoll). */
        id: number;
    }): Promise<{ question: string; closed: boolean; quiz: boolean; multiple: boolean; totalVoters: number; options: Array<{ index: number; text: string; voters: number; chosen: boolean; correct: boolean }>; recentVoters: string[] }> {
    if (opts?.chat === undefined || opts?.chat === null) throw new Error("pollResults: opts.chat required");
    if (!Number.isInteger(opts?.id) || opts.id <= 0) throw new Error("pollResults: opts.id must be a positive message id");
    const client = await connected(ctx);
    const [msg]: any[] = await client.getMessages(String(opts.chat), { ids: [opts.id] });
    const media = msg?.media;
    if (!media || media.className !== "MessageMediaPoll") throw new Error("pollResults: message is not a poll");
    const poll = media.poll, res = media.results ?? {};
    const txt = (t: any) => typeof t === "string" ? t : t?.text ?? "";
    const byOpt = new Map<string, any>((res.results ?? []).map((r: any) => [Buffer.from(r.option).toString("hex"), r]));
    return {
        question: txt(poll.question),
        closed: !!poll.closed,
        quiz: !!poll.quiz,
        multiple: !!poll.multipleChoice,
        totalVoters: res.totalVoters ?? 0,
        options: poll.answers.map((a: any, index: number) => {
            const r = byOpt.get(Buffer.from(a.option).toString("hex"));
            return { index, text: txt(a.text), voters: r?.voters ?? 0, chosen: !!r?.chosen, correct: !!r?.correct };
        }),
        recentVoters: (res.recentVoters ?? []).map((p: any) => String(p.userId ?? p)),
    };
}
