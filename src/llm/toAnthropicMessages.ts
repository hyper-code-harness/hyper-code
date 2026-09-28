// Convert our canonical transcript into Anthropic messages[] form. System
// messages are skipped (Anthropic takes them at the top level as a separate
// `system` field).
//
// Two shapes arrive here. Markers transcripts are plain role/content strings.
// JSON-protocol transcripts additionally carry `tool_calls` on an assistant row
// ([{ id, name, args }]) and `tool_call_id` on a role:"tool" row — Anthropic
// spells those as a `tool_use` content block and a `tool_result` block inside
// the FOLLOWING USER message, since it has no tool role.
//
// Anthropic invariants this guards, so a malformed transcript can never 400:
//   1. Text content blocks must be NON-EMPTY ("text content blocks must be
//      non-empty"). A message whose content is null / "" / whitespace — a
//      legacy null-content row, an empty user POST, a dropped tool turn —
//      would otherwise emit `{type:"text", text:""}` and reject the whole call.
//      → such a message is dropped, unless it carries tool blocks.
//   2. Roles must alternate. Dropping a message can leave two same-role
//      neighbours adjacent, which is also rejected.
//      → consecutive same-role messages are coalesced into one.
//   3. tool_result blocks must lead the user message that answers the calls,
//      and every tool_use needs exactly one result.
//      → consecutive tool results coalesce into a single user message, ahead
//        of any prose the same turn produced.
/** Performs the llm.toAnthropicMessages runtime operation. */
/**
 * Convert our canonical transcript into Anthropic messages[] form. System.
 * @param opts.messages Conversation messages to convert.
 */
export default function (ctx: Context, _session: Session | null, opts: {
        /** Conversation messages to convert. */ messages: any[] }): any[] {
    const out: { role: "user" | "assistant"; content: any[] }[] = [];

    // Screenshot-heavy histories trigger Anthropic's stricter many-image
    // dimension limit. Keep the newest 20 images and summarize older images as
    // text; the durable transcript remains unchanged.
    let imagesToOmit = Math.max(0, opts.messages.reduce((count: number, message: any) => count + toParts(message?.content).filter((part: any) => part.type === "image").length, 0) - 20);
    const push = (role: "user" | "assistant", block: any) => {
        const prev = out.length > 0 ? out[out.length - 1] : undefined;
        if (prev && prev.role === role) {
            const tail = prev.content[prev.content.length - 1];
            // Two text blocks in a row are one paragraph, not two blocks.
            if (block.type === "text" && tail?.type === "text") { tail.text += "\n\n" + block.text; return; }
            // A tool_result always leads its message — prose from the same turn
            // follows it, never the other way round.
            if (block.type === "tool_result") {
                const at = prev.content.findIndex((b: any) => b.type !== "tool_result");
                if (at >= 0) { prev.content.splice(at, 0, block); return; }
            }
            prev.content.push(block);
            return;
        }
        out.push({ role, content: [block] });
    };

    for (const m of opts.messages) {
        const role = m?.role;
        let parts = toParts(m?.content);
        if (imagesToOmit > 0) {
            let omitted = 0;
            parts = parts.filter((part: any) => {
                if (part.type !== "image" || imagesToOmit <= 0) return true;
                imagesToOmit--; omitted++; return false;
            });
            if (omitted) parts.push({ type: "text", text: `[${omitted} earlier image${omitted === 1 ? "" : "s"} omitted from the model request]` });
        }
        const text = parts.filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n");
        const images = parts.filter((p): p is Extract<types.tools.Content, { type: "image" }> => p.type === "image");
        const documents = parts.filter((p): p is Extract<types.tools.Content, { type: "document" }> => p.type === "document");

        if (role === "tool") {
            push("user", {
                type: "tool_result",
                tool_use_id: m.tool_call_id,
                content: text === "" ? "(image attached below)" : text,
                ...(m.isError ? { is_error: true } : {}),
            });
            for (const image of images) push("user", { type: "image", source: { type: "base64", media_type: image.mimeType, data: image.data } });
            for (const document of documents) push("user", { type: "document", source: { type: "base64", media_type: document.mimeType, data: document.data }, title: document.fileName });
            continue;
        }

        if (role !== "user" && role !== "assistant") continue;   // system handled elsewhere

        if (text.trim() !== "") push(role, { type: "text", text });
        for (const image of images) push(role, { type: "image", source: { type: "base64", media_type: image.mimeType, data: image.data } });
        for (const document of documents) push(role, { type: "document", source: { type: "base64", media_type: document.mimeType, data: document.data }, title: document.fileName });
        for (const call of m?.tool_calls ?? []) {
            push("assistant", { type: "tool_use", id: call.id, name: call.name, input: call.args ?? {} });
        }
    }

    // 4. "final assistant content cannot end with trailing whitespace" — a
    //    marker text / prose row usually carries a trailing \n, and when the
    //    transcript happens to end on assistant, the whole call is rejected.
    const last = out[out.length - 1];
    const lastBlock = last?.content[last.content.length - 1];
    if (last?.role === "assistant" && lastBlock?.type === "text") lastBlock.text = lastBlock.text.replace(/\s+$/, "");
    return out;
}

// Local mirror of llm/contentParts — these converters are PURE (tests call
// them with a bare ctx), so content normalization cannot ride ctx.fns.
function toParts(content: any): types.tools.Content[] {
    if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
    if (!Array.isArray(content)) return content == null ? [] : [{ type: "text", text: JSON.stringify(content) }];
    return content.filter((p: any) => p?.type === "text" && typeof p.text === "string"
        || p?.type === "image" && typeof p.data === "string" && typeof p.mimeType === "string"
        || p?.type === "document" && typeof p.data === "string" && p.mimeType === "application/pdf" && typeof p.fileName === "string");
}
