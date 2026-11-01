// Convert our canonical transcript into OpenAI chat-completions messages[].
//
// Markers transcripts pass through unchanged (role/content strings). A
// JSON-protocol transcript carries `tool_calls` as [{ id, name, args }] on the
// assistant row and `tool_call_id` on the answer; OpenAI wants the call's
// arguments as a JSON *string* inside a `function` wrapper, and the answer as
// its own `role: "tool"` message.
//
// An assistant message that only called tools has no content — OpenAI accepts
// null there, and some proxies reject "" — so the field is omitted rather than
// sent empty.
/** Performs the llm.toOpenAIMessages runtime operation. */
/**
 * Convert our canonical transcript into OpenAI chat-completions messages[].
 * @param opts.messages Conversation messages to convert.
 */
export default function (ctx: Context, _session: Session | null, opts: {
        /** Conversation messages to convert. */ messages: any[] }): any[] {
    const out: any[] = [];
    // Images from a run of consecutive tool results. Chat-completions tool
    // messages carry text only, so images ride a follow-up user message —
    // but only AFTER the last tool result of the run: a user message between
    // parallel tool results breaks the tool_call chain (Claude behind
    // LiteLLM answers 400). See issue #21.
    let pendingImages: any[] = [];
    const flushImages = () => {
        if (pendingImages.length) out.push({ role: "user", content: pendingImages });
        pendingImages = [];
    };

    for (const m of opts.messages) {
        if (m?.role === "tool") {
            const parts = toParts(m.content);
            const text = textParts(parts).join("\n");
            out.push({ role: "tool", tool_call_id: m.tool_call_id, content: text || "(image attached below)" });
            pendingImages.push(...parts.filter((p: any) => p.type === "image").map((p: any) => ({ type: "image_url", image_url: { url: `data:${p.mimeType};base64,${p.data}` } })));
            continue;
        }
        flushImages();

        const parts = toParts(m?.content);
        const text = textParts(parts).join("\n");
        const images = parts.filter((p: any) => p.type === "image").map((p: any) => ({ type: "image_url", image_url: { url: `data:${p.mimeType};base64,${p.data}` } }));
        const calls = m?.tool_calls ?? [];
        if (!calls.length) {
            if (m?.role) out.push({ role: m.role, content: images.length ? [...(text ? [{ type: "text", text }] : []), ...images] : text });
            continue;
        }

        const msg: any = { role: "assistant", tool_calls: calls.map((c: any) => ({
            id: c.id,
            type: "function",
            function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
        })) };
        if (text.trim() !== "") msg.content = text;
        out.push(msg);
    }
    flushImages();

    return out;
}

// Local mirror of llm/contentParts — these converters are PURE (tests call
// them with a bare ctx), so content normalization cannot ride ctx.fns.
function toParts(content: any): types.tools.Content[] {
    if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
    if (!Array.isArray(content)) return content == null ? [] : [{ type: "text", text: JSON.stringify(content) }];
    return content.filter((p: any) => p?.type === "text" && typeof p.text === "string"
        || p?.type === "image" && typeof p.data === "string" && typeof p.mimeType === "string"
        || p?.type === "document" && typeof p.fileName === "string");
}

// Chat-completions has no portable PDF block. Preserve the local path and
// bounded extracted text so the model can reason now and inspect with tools.
function textParts(parts: types.tools.Content[]): string[] {
    return parts.flatMap((p: any) => p.type === "text" ? [p.text]
        : p.type === "document" ? [`[Attached PDF: ${p.fileName}${p.path ? `\nLocal path: ${p.path}` : ""}]${p.extractedText ? `\n\n${p.extractedText}` : ""}`]
        : []);
}
