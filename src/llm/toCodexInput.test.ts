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
