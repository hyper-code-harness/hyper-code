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
 * WRITE: send a native Telegram poll (or quiz) to a chat through the user account.
 *
 * Use to ask a person or group to pick among 2–10 options inside Telegram instead of answering in prose.
 * Supports multiple-choice, public (non-anonymous) voters and quiz mode with one correct option and an
 * explanation. Read the votes later with telegram.pollResults({ chat, id }).
 * Telegram accepts polls only in groups, channels and Saved Messages ("me"); a one-to-one chat with another
 * user is rejected with MEDIA_INVALID.
 *
 * @param ctx Runtime context.
 * @param session Active session, when available.
 * @param opts Poll options.
 * @returns Sent message id and ISO date.
 */
export default async function (ctx: Context, session: Session | null, opts: {
        /** Chat identifier or @username. */
        chat: string | number;
        /** Poll question, 1–255 characters. */
        question: string;
        /** Answer options, 2–10 items, each 1–100 characters. */
        options: string[];
        /** Allow choosing several options (not with quiz). @default false */
        multiple?: boolean;
        /** Show who voted for what (non-anonymous). @default false */
        publicVoters?: boolean;
        /** Zero-based index of the correct option; turns the poll into a quiz. */
        correctOption?: number;
        /** Explanation shown after a quiz answer, up to 200 characters. */
        solution?: string;
        /** Auto-close the poll after this many seconds. @minimum 5 @maximum 600 */
        closePeriod?: number;
        /** Whether the caller confirmed the write operation. */
        confirm?: boolean;
    }): Promise<{ id: number; date: string }> {
    if (opts?.chat === undefined || opts?.chat === null) throw new Error("sendPoll: opts.chat required");
    const question = String(opts?.question ?? "").trim();
    if (!question || question.length > 255) throw new Error("sendPoll: question must be 1–255 characters");
    const options = (opts?.options ?? []).map((o) => String(o).trim());
    if (options.length < 2 || options.length > 10) throw new Error("sendPoll: options must have 2–10 items");
    if (options.some((o) => !o || o.length > 100)) throw new Error("sendPoll: each option must be 1–100 characters");
    const quiz = opts.correctOption !== undefined;
    if (quiz && (!Number.isInteger(opts.correctOption) || opts.correctOption! < 0 || opts.correctOption! >= options.length)) throw new Error("sendPoll: correctOption out of range");
    if (quiz && opts.multiple) throw new Error("sendPoll: quiz cannot be multiple-choice");
    if (opts.solution !== undefined && !quiz) throw new Error("sendPoll: solution needs correctOption");
    if (opts.confirm !== true) throw new Error("telegram.sendPoll is a real write; repeat with confirm: true after explicit user approval");
    const { Api } = await import("telegram");
    const bigInt = (await import("big-integer")).default;
    const client = await connected(ctx);
    const text = (t: string) => new Api.TextWithEntities({ text: t, entities: [] });
    const poll = new Api.Poll({
        id: bigInt(Date.now()),
        question: text(question),
        answers: options.map((o, i) => new Api.PollAnswer({ text: text(o), option: Buffer.from([i]) })),
        multipleChoice: opts.multiple || undefined,
        publicVoters: opts.publicVoters || undefined,
        quiz: quiz || undefined,
        closePeriod: opts.closePeriod,
    });
    const media = new Api.InputMediaPoll({
        poll,
        correctAnswers: quiz ? [Buffer.from([opts.correctOption!])] : undefined,
        solution: opts.solution,
        solutionEntities: opts.solution ? [] : undefined,
    });
    let result: any;
    try { result = await client.sendMessage(String(opts.chat), { message: "", file: media }); }
    catch (e: any) {
        if (String(e?.message ?? e).includes("MEDIA_INVALID")) throw new Error("sendPoll: Telegram rejected the poll (MEDIA_INVALID) — polls work only in groups, channels and Saved Messages, not in one-to-one chats");
        throw e;
    }
    return { id: result.id, date: new Date(result.date * 1000).toISOString() };
}
