/**
 * Creates a native server-side Claude compaction block for a transcript
 *
 * Sends a transcript to the Anthropic Messages API with the compact-2026-09-04 beta `compaction: {type:"summarize"}` parameter and returns the signed compaction block (readable summary plus signature). Works for anthropic API keys and claude-code / anthropic-oauth subscriptions. Callers must replay the block byte-for-byte as the FIRST content block of the first message, with the same beta header. Throws when the model does not support it or returns no block.
 * @param opts.model Provider-qualified Claude model, e.g. claude-code:claude-opus-5 or anthropic:claude-opus-5.
 * @param opts.instructions Effective system prompt of the compacted agent.
 * @param opts.focus Optional user focus for the summary; wrapped into a full handoff prompt.
 * @param opts.messages Canonical transcript messages to compact, oldest first.
 * @param opts.maxTokens Output budget for the summary; too small a budget yields an empty result. @default 32000 @minimum 4096 @maximum 128000
 * @param opts.signal Optional cancellation signal.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Provider-qualified Claude model, e.g. claude-code:claude-opus-5 or anthropic:claude-opus-5. */
        model: string;
        /** Effective system prompt of the compacted agent. */
        instructions?: string;
        /** Optional user focus for the summary; wrapped into a full handoff prompt. */
        focus?: string;
        /** Canonical transcript messages to compact, oldest first. */
        messages: any[];
        /** Output budget for the summary; too small a budget yields an empty result. @default 32000 @minimum 4096 @maximum 128000 */
        maxTokens?: number;
        /** Optional cancellation signal. */
        signal?: AbortSignal;
    },
): Promise<{ block: { type: "compaction"; content: string; signature: string; [key: string]: unknown }; stopReason: string; usage: { prompt_tokens: number; completion_tokens: number } }> {
    const ep = await ctx.fns.llm.resolveEndpoint({ model: opts.model });
    const upstream = ep.provider === "hyper" ? String(ep.upstream ?? "") : ep.provider;
    if (ep.api !== "anthropic" || !["anthropic", "claude-code", "anthropic-oauth"].includes(upstream)) throw new Error(`server compaction is not supported for ${ep.provider}`);
    let apiKey = ep.apiKey;
    if (ep.provider === "claude-code") apiKey = (await ctx.fns.llm.refreshClaudeCode({ account: ep.account })) ?? apiKey;
    else if (ep.provider === "anthropic-oauth") apiKey = await ctx.fns.llm.getAnthropicOAuthToken({ account: ep.account });
    if (!apiKey) throw new Error(`${ep.provider}: no credentials`);
    const subscription = upstream === "claude-code" || upstream === "anthropic-oauth";
    const headers: Record<string, string> = { "content-type": "application/json", "anthropic-version": "2023-06-01" };
    if (subscription || ep.provider === "hyper") headers.authorization = `Bearer ${apiKey}`; else headers["x-api-key"] = apiKey;
    headers["anthropic-beta"] = [...(subscription ? ["claude-code-20250219", "oauth-2025-04-20"] : []), "compact-2026-09-04"].join(",");
    if (subscription) {
        headers["user-agent"] = ctx.env.CLAUDE_CODE_USER_AGENT ?? `claude-cli/${await ctx.fns.llm.claudeCodeCliVersion({})} (external, sdk-cli)`;
        headers["x-app"] = "cli";
        headers["anthropic-dangerous-direct-browser-access"] = "true";
    }
    const system: any[] = subscription ? [{ type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." }] : [];
    if (opts.instructions?.trim()) system.push({ type: "text", text: opts.instructions });
    const messages = ctx.fns.llm.toAnthropicMessages({ messages: opts.messages.filter((m: any) => m?.role !== "system") });
    // compaction.instructions REPLACES the server summarization prompt, so a focus
    // is wrapped into a full handoff prompt rather than sent alone.
    const focus = opts.focus?.trim();
    const compaction: any = { type: "summarize" };
    if (focus) compaction.instructions = ("Summarize this conversation into a handoff checkpoint so another model can seamlessly continue: goal, progress, decisions, constraints, exact identifiers/paths/errors, and next steps.\n\nFocus: " + focus).slice(0, 16384);
    const body: any = { model: ep.modelId, max_tokens: opts.maxTokens ?? 32000, messages, compaction };
    if (system.length) body.system = system;
    const res = await fetch(ep.url, { method: "POST", headers, body: JSON.stringify(body), signal: opts.signal });
    if (!res.ok) throw new Error(`anthropic compaction ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const raw: any = await res.json();
    const block = (raw.content ?? []).find((b: any) => b?.type === "compaction");
    const iteration = (raw.usage?.iterations ?? []).find((i: any) => i?.type === "compaction") ?? {};
    // Output cut off, refusal or context overflow all return 200 with empty content.
    if (!block || typeof block.content !== "string" || !block.signature) throw new Error(`anthropic compaction returned no block (stop_reason ${raw.stop_reason})`);
    return { block, stopReason: String(raw.stop_reason ?? ""), usage: { prompt_tokens: Number(iteration.input_tokens ?? 0), completion_tokens: Number(iteration.output_tokens ?? 0) } };
}
