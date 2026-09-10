// Convert our canonical transcript → OpenAI Responses API `input` items.
// System messages are pulled out and returned as `instructions` (the Responses
// API takes them at the top level).
//
// The Responses API has no message with a tool field: a call is its own
// `function_call` ITEM and its answer is a `function_call_output` item, paired
// by call_id. So an assistant turn that both talked and called tools becomes
// several items, in order.
/** Performs the llm.toCodexInput runtime operation. */
/**
 * Convert our canonical transcript → OpenAI Responses API `input` items.
 * @param opts.messages Conversation messages to convert.
 */
export default function (
    _ctx: Context,
    _session: Session | null,
    opts: {
        /** Conversation messages to convert. */ messages: { role: string; content?: any; tool_calls?: any[]; tool_call_id?: string; message_type?: string }[] },
): { instructions: string; input: any[] } {
    const messages = opts.messages;
    let instructions = "";
    const input: any[] = [];

    for (const m of messages) {
        if (m.message_type === "codex_compaction") {
            let checkpoint: any = null;
            try { checkpoint = typeof m.content === "string" ? JSON.parse(m.content) : m.content; } catch {}
            if (checkpoint?.type === "compaction" && typeof checkpoint.encrypted_content === "string") {
                input.push({ type: "compaction", ...(checkpoint.id ? { id: checkpoint.id } : {}), encrypted_content: checkpoint.encrypted_content });
            }
            continue;
        }
        if (m.role === "system") {
            instructions = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
            continue;
        }
        if (m.role === "tool") {
            const content = parts(m.content);
            const text = asText(content).join("\n");
            input.push({ type: "function_call_output", call_id: m.tool_call_id, output: text || "(image attached below)" });
            for (const part of content) if (part.type === "image") {
                input.push({ type: "message", role: "user", content: [{ type: "input_image", detail: "auto", image_url: `data:${part.mimeType};base64,${part.data}` }] });
            }
            continue;
        }
        if (m.role === "user") {
            const content: any[] = parts(m.content).flatMap<any>((part: any): any[] => part.type === "image"
                ? [{ type: "input_image", detail: "auto", image_url: `data:${part.mimeType};base64,${part.data}` }]
                : part.type === "document"
                    ? [{ type: "input_text", text: asText([part])[0] }]
                    : [{ type: "input_text", text: part.text }]);
            if (content.length) input.push({ type: "message", role: "user", content });
            continue;
        }
        if (m.role === "assistant") {
            const text = typeof m.content === "string" ? m.content : "";
            if (text) input.push({ type: "message", role: "assistant", content: [{ type: "output_text", text }] });
            for (const call of m.tool_calls ?? []) {
                input.push({
                    type: "function_call",
                    call_id: call.id,
                    name: call.name,
                    arguments: JSON.stringify(call.args ?? {}),
                });
            }
            continue;
        }
    }
    return { instructions, input };
}

function parts(content: any): types.tools.Content[] {
    if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
    if (!Array.isArray(content)) return content == null ? [] : [{ type: "text", text: JSON.stringify(content) }];
    return content.filter((p: any) => p?.type === "text" && typeof p.text === "string"
        || p?.type === "image" && typeof p.data === "string" && typeof p.mimeType === "string"
        || p?.type === "document" && typeof p.fileName === "string");
}

function asText(parts: types.tools.Content[]): string[] {
    return parts.flatMap((p: any) => p.type === "text" ? [p.text]
        : p.type === "document" ? [`[Attached PDF: ${p.fileName}${p.path ? `\nLocal path: ${p.path}` : ""}]${p.extractedText ? `\n\n${p.extractedText}` : ""}`]
        : []);
}
