/**
 * Creates a native server-side Codex compaction checkpoint
 *
 * Send a Codex transcript to the ChatGPT Responses endpoint with a compaction_trigger and return the opaque encrypted compaction item. Use only for codex subscription models; callers must persist the returned item and replay it in later Codex input.
 * @param opts.model Provider-qualified codex model identifier.
 * @param opts.sessionId Stable agent/session identifier used by Codex.
 * @param opts.instructions Effective model instructions for the compacted transcript.
 * @param opts.messages Canonical transcript messages to compact.
 * @param opts.signal Optional cancellation signal.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Provider-qualified codex model identifier. */
        model: string;
        /** Stable agent/session identifier used by Codex. */
        sessionId: string;
        /** Effective model instructions for the compacted transcript. */
        instructions: string;
        /** Canonical transcript messages to compact. */
        messages: any[];
        /** Optional cancellation signal. */
        signal?: AbortSignal;
    },
): Promise<{ item: { type: "compaction"; id?: string; encrypted_content: string }; responseId: string; usage: { prompt_tokens: number; completion_tokens: number } }> {
    if (!opts.model.startsWith("codex:" ) && !opts.model.startsWith("codex/")) throw new Error("server compaction is only supported for codex models");
    const ep = await ctx.fns.llm.resolveEndpoint({ model: opts.model });
    if (ep.provider !== "codex") throw new Error("server compaction is only supported for codex models");
    const apiKey = await ctx.fns.llm.refreshCodex({ account: ep.account }) ?? ep.apiKey;
    if (!apiKey) throw new Error("codex: no access_token");
    let accountId = "";
    try { accountId = JSON.parse(Buffer.from(apiKey.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString())?.["https://api.openai.com/auth"]?.chatgpt_account_id ?? ""; } catch {}
    const converted = ctx.fns.llm.toCodexInput({ messages: opts.messages as any });
    const input = [...converted.input, { type: "compaction_trigger" }];
    const compaction = { trigger: "manual", reason: "user_requested", implementation: "remote", phase: "standalone_turn", strategy: "memento" };
    const turnMetadata = JSON.stringify({ session_id: opts.sessionId, thread_id: opts.sessionId, turn_id: crypto.randomUUID(), request_kind: "compaction", compaction });
    const body = { model: ep.modelId, instructions: opts.instructions || converted.instructions, input, tools: [], tool_choice: "auto", parallel_tool_calls: false, reasoning: { effort: "medium", summary: "auto" }, store: false, stream: true, include: [], client_metadata: { session_id: opts.sessionId, thread_id: opts.sessionId, "x-codex-turn-metadata": turnMetadata } };
    const headers = { authorization: `Bearer ${apiKey}`, "chatgpt-account-id": accountId, originator: "codex_cli_rs", version: await ctx.fns.llm.codexCliVersion({}), "OpenAI-Beta": "responses=experimental", accept: "text/event-stream", "content-type": "application/json", session_id: opts.sessionId, "x-codex-turn-metadata": turnMetadata };
    const res = await ctx.fns.llm.connectFetch({ url: ep.url, init: { method: "POST", headers, body: JSON.stringify(body), signal: opts.signal } });
    if (!res.ok) { const text = await res.text(); throw new Error(`codex compaction ${res.status}: ${text.slice(0, 500)}`); }
    if (!res.body) throw new Error("codex compaction returned no stream");
    let item: any = null; let responseId = ""; const usage = { prompt_tokens: 0, completion_tokens: 0 };
    for await (const frame of ctx.fns.llm.parseSSE({ body: res.body })) { if (!frame.data || frame.data === "[DONE]") continue; let ev: any; try { ev = JSON.parse(frame.data); } catch { continue; } if (ev.type === "response.output_item.done" && ev.item?.type === "compaction") { if (item) throw new Error("codex compaction returned multiple checkpoint items"); item = ev.item; } else if (ev.type === "response.completed") { responseId = String(ev.response?.id ?? ev.response_id ?? ""); const u = ev.response?.usage; usage.prompt_tokens = Number(u?.input_tokens ?? 0); usage.completion_tokens = Number(u?.output_tokens ?? 0); } else if (ev.type === "response.failed" || ev.type === "error") throw new Error(`codex compaction failed: ${ev.response?.error?.message ?? ev.error?.message ?? ev.message ?? ev.type}`); }
    if (!item?.encrypted_content) throw new Error("codex compaction returned no checkpoint item");
    if (!responseId) throw new Error("codex compaction stream closed before response.completed");
    return { item: { type: "compaction", ...(item.id ? { id: String(item.id) } : {}), encrypted_content: String(item.encrypted_content) }, responseId, usage };
}
