import { describe, expect, test } from "bun:test";
import convert from "./toCodexInput";

describe("llm.toCodexInput native compaction", () => {
    test("replays an opaque Codex checkpoint as a compaction input item", () => {
        const checkpoint = { type: "compaction", id: "cmp_1", encrypted_content: "opaque-secret" };
        const result = convert({} as Context, null, { messages: [
            { role: "user", content: JSON.stringify(checkpoint), message_type: "codex_compaction" },
            { role: "user", content: "continue" },
        ] });
        expect(result.input).toEqual([
            checkpoint,
            { type: "message", role: "user", content: [{ type: "input_text", text: "continue" }] },
        ]);
    });

    test("does not leak malformed checkpoint JSON as a user message", () => {
        const result = convert({} as Context, null, { messages: [{ role: "user", content: "broken", message_type: "codex_compaction" }] });
        expect(result.input).toEqual([]);
    });
});

describe("llm.toCodexInput tool images", () => {
    test("images ride inside function_call_output, parallel outputs stay adjacent (issue #21)", () => {
        const img = (data: string) => ({ type: "image", mimeType: "image/png", data });
        const result = convert({} as Context, null, { messages: [
            { role: "assistant", content: "", tool_calls: [{ id: "a", name: "read", args: {} }, { id: "b", name: "read", args: {} }] },
            { role: "tool", tool_call_id: "a", content: [img("AAA")] },
            { role: "tool", tool_call_id: "b", content: [{ type: "text", text: "two" }, img("BBB")] },
            { role: "tool", tool_call_id: "c", content: "plain" },
        ] });
        expect(result.input.slice(2)).toEqual([
            { type: "function_call_output", call_id: "a", output: [{ type: "input_image", detail: "auto", image_url: "data:image/png;base64,AAA" }] },
            { type: "function_call_output", call_id: "b", output: [{ type: "input_text", text: "two" }, { type: "input_image", detail: "auto", image_url: "data:image/png;base64,BBB" }] },
            { type: "function_call_output", call_id: "c", output: "plain" },
        ]);
    });
});
