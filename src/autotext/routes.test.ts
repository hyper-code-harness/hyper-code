import { describe, expect, test } from "bun:test";
import page from "./$route__GET";
import suggest from "./$route_suggest_POST";
import { trimRepeatedPrefix, trimRepeatedSuffix, sentenceTail, rewritePreview } from "./$script_editor";

describe("autotext sandbox", () => {
    test("renders the model chooser and editor", async () => {
        const result = await page({} as any, null, { req: new Request("http://localhost/autotext"), params: {} });
        expect(result.main).toContain("codex:gpt-6-luna");
        expect(result.main).toContain("claude-code:claude-haiku-4-5");
        expect(result.main).toContain("groq:openai/gpt-oss-20b");
        expect(result.main).toContain("groq:openai/gpt-oss-120b");
        expect(result.main).toContain("groq:qwen/qwen3.8-27b");
        expect(result.main).toContain("openrouter:z-ai/glm-5.3-flash");
        expect(result.main).toContain("/autotext/editor.js");
        expect(result.main).toContain('id="autotext-editor"');
        expect(result.main).toMatch(/id="autotext-auto"[^>]*checked/);
        expect(result.main).toContain('id="autotext-request"');
        expect(result.main).toContain('id="autotext-rewrite"');
        expect(result.main).toContain("waits 3 seconds");
    });
    test("editor script bundles CodeMirror with ghost text, Tab, Esc and debounce", async () => {
        const src = await Bun.file(new URL("./$script_editor.js", import.meta.url)).text();
        expect(src).toContain("@codemirror/view");
        expect(src).toContain('key: "Tab"');
        expect(src).toContain('key: "Escape"');
        expect(src).toContain("abort()");
        expect(src).toContain("DEBOUNCE_MS = 3000");
        const out = await Bun.build({ entrypoints: [new URL("./$script_editor.js", import.meta.url).pathname], target: "browser", format: "iife" });
        expect(out.success).toBe(true);
    });
    test("keeps exact model whitespace and avoids partial-word overlap", () => {
        expect(trimRepeatedPrefix("Начало важной статьи", "важной статьи продолжается.")).toBe(" продолжается.");
        expect(trimRepeatedPrefix("Начало важной статьи", " важной статьи продолжается.")).toBe(" продолжается.");
        expect(trimRepeatedPrefix("Тема важна ", " важна для нас.")).toBe(" для нас.");
        expect(trimRepeatedPrefix("Начало важной статьи", "Другая мысль.")).toBe("Другая мысль.");
        expect(trimRepeatedPrefix("Начало важной статьи", "важной статьи")).toBe("");
        expect(trimRepeatedPrefix("про", "продолжение")).toBe("продолжение");
        expect(trimRepeatedPrefix("привет", "ветер")).toBe("ветер");
        expect(trimRepeatedSuffix(" новая фраза дальше", "дальше по тексту")).toBe(" новая фраза ");
        expect(trimRepeatedSuffix(" новый мир", "мир прекрасен")).toBe(" новый мир");
        expect(trimRepeatedSuffix("даль", "дальше")).toBe("даль");
    });
    test("rewrites only the current sentence tail and previews the exact replacement", () => {
        const before = "Первая фраза. Сегонд фрза";
        const tail = sentenceTail(before);
        expect(tail).toEqual({ from: 14, text: "Сегонд фрза" });
        expect(sentenceTail("Заголовок\nНовая фрза")).toEqual({ from: 10, text: "Новая фрза" });
        expect(rewritePreview(before, " Затем идёт текст", tail, "Вторая фраза закончена.")).toEqual({ from: 14, to: before.length, original: "Сегонд фрза", text: "Вторая фраза закончена." });
        expect(rewritePreview(before, "", tail, "")).toBeNull();
    });
    test("rewrite endpoint validates the tail and returns structured replacement", async () => {
        const ctx = { fns: { llm: { call: async (opts: any) => {
            expect(opts.system).toContain("fixing spelling");
            return { text: JSON.stringify({ text: "Вторая фраза закончена." }), model: opts.model };
        } } } } as any;
        const data = { model: "groq:qwen/qwen3.8-27b", before: "Первая фраза. Сегонд фрза", after: "", rewrite: true, tail: "Сегонд фрза" };
        const req = new Request("http://localhost/autotext/suggest", { method: "POST", body: JSON.stringify(data) });
        const res = await suggest(ctx, null, { req });
        expect(res.status).toBe(200);
        expect(await res.json() as any).toMatchObject({ text: "Вторая фраза закончена.", replaceChars: data.tail.length });
        const invalid = new Request("http://localhost/autotext/suggest", { method: "POST", body: JSON.stringify({ ...data, tail: "другая фраза" }) });
        expect((await suggest(ctx, null, { req: invalid })).status).toBe(400);
    });
    test("rejects unlisted model without invoking the provider", async () => {
        const ctx = { fns: { llm: { call: () => { throw new Error("called provider"); } } } } as any;
        const req = new Request("http://localhost/autotext/suggest", { method: "POST", body: JSON.stringify({ model: "evil", before: "hello", after: "" }) });
        const res = await suggest(ctx, null, { req });
        expect(res.status).toBe(400);
        expect((await res.json() as any).error).toBe("Unsupported model");
    });
    test("routes selected Groq model to the same bounded provider call", async () => {
        const ctx = { fns: { llm: { call: async (opts: any) => {
            expect(opts.model).toBe("groq:openai/gpt-oss-20b");
            expect(opts.noFallback).toBe(true);
            expect(opts.max_tokens).toBe(240);
            expect(opts.groqReasoningEffort).toBe("low");
            return { text: " мир", model: opts.model };
        } } } } as any;
        const req = new Request("http://localhost/autotext/suggest", { method: "POST", body: JSON.stringify({ model: "groq:openai/gpt-oss-20b", before: "Привет", after: "" }) });
        const res = await suggest(ctx, null, { req });
        expect(res.status).toBe(200);
        expect((await res.json() as any).text).toBe(" мир");
    });
    test("GLM Flash uses OpenRouter with low reasoning budget", async () => {
        const ctx = { fns: { llm: { call: async (opts: any) => {
            expect(opts.model).toBe("openrouter:z-ai/glm-5.3-flash");
            expect(opts.openrouterReasoningEffort).toBe("low");
            expect(opts.max_tokens).toBe(300);
            return { text: " светятся фонари.", model: opts.model };
        } } } } as any;
        const req = new Request("http://localhost/autotext/suggest", { method: "POST", body: JSON.stringify({ model: "openrouter:z-ai/glm-5.3-flash", before: "Вечером", after: "" }) });
        const res = await suggest(ctx, null, { req });
        expect(res.status).toBe(200);
        expect((await res.json() as any).text).toBe(" светятся фонари.");
    });
    test("returns model output and elapsed time", async () => {
        const ctx = { fns: { llm: { call: async (opts: any) => {
            expect(opts.noFallback).toBe(true);
            expect(opts.max_tokens).toBe(120);
            return { text: " продолжение", model: opts.model };
        } } } } as any;
        const req = new Request("http://localhost/autotext/suggest", { method: "POST", body: JSON.stringify({ model: "codex:gpt-6-luna", before: "Это статья", after: " дальше" }) });
        const res = await suggest(ctx, null, { req });
        expect(res.status).toBe(200);
        const body: any = await res.json();
        expect(body.text).toBe(" продолжение");
        expect(body.ms).toBeGreaterThanOrEqual(0);
    });
    test("suppresses NO_SUGGESTION without losing ordinary whitespace", async () => {
        const ctx = { fns: { llm: { call: async () => ({ text: " NO_SUGGESTION ", model: "codex:gpt-6-luna" }) } } } as any;
        const req = new Request("http://localhost/autotext/suggest", { method: "POST", body: JSON.stringify({ model: "codex:gpt-6-luna", before: "Это статья", after: "" }) });
        const res = await suggest(ctx, null, { req });
        expect((await res.json() as any).text).toBe("");
    });
});
