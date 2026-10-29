import { test, expect, describe } from "bun:test";
import convert from "./toOpenAIMessages";

const ctx = {} as Context;
const img = (data: string) => ({ type: "image", mimeType: "image/png", data });
const url = (data: string) => ({ type: "image_url", image_url: { url: `data:image/png;base64,${data}` } });

describe("llm.toOpenAIMessages", () => {
    test("parallel tool results with images keep the tool chain unbroken (issue #21)", () => {
        const out = convert(ctx, null, { messages: [
            { role: "user", content: "look" },
            { role: "assistant", content: "", tool_calls: [
                { id: "a", name: "read", args: { path: "1.png" } },
                { id: "b", name: "read", args: { path: "2.png" } },
                { id: "c", name: "bash", args: { command: "ls" } },
            ] },
            { role: "tool", tool_call_id: "a", content: [img("AAA")] },
            { role: "tool", tool_call_id: "b", content: [{ type: "text", text: "two" }, img("BBB")] },
            { role: "tool", tool_call_id: "c", content: "files" },
            { role: "assistant", content: "done" },
        ] });
        expect(out.map((m: any) => m.role)).toEqual(["user", "assistant", "tool", "tool", "tool", "user", "assistant"]);
        expect(out[2]).toEqual({ role: "tool", tool_call_id: "a", content: "(image attached below)" });
        expect(out[3]).toEqual({ role: "tool", tool_call_id: "b", content: "two" });
        expect(out[5]).toEqual({ role: "user", content: [url("AAA"), url("BBB")] });
    });

    test("images of a trailing tool run are flushed at the end", () => {
        const out = convert(ctx, null, { messages: [
            { role: "assistant", content: "", tool_calls: [{ id: "a", name: "read", args: {} }] },
            { role: "tool", tool_call_id: "a", content: [img("AAA")] },
        ] });
        expect(out.at(-1)).toEqual({ role: "user", content: [url("AAA")] });
        expect(out).toHaveLength(3);
    });

    test("tool results without images add no user message", () => {
        const out = convert(ctx, null, { messages: [
            { role: "assistant", content: "", tool_calls: [{ id: "a", name: "bash", args: {} }] },
            { role: "tool", tool_call_id: "a", content: "ok" },
            { role: "user", content: "next" },
        ] });
        expect(out.map((m: any) => m.role)).toEqual(["assistant", "tool", "user"]);
    });
});
