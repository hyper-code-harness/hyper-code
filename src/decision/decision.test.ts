import { test, expect, describe, afterEach } from "bun:test";
import ask from "./ask";
import post from "./post";
import engineJev from "./engineJev";
import engineOpenai from "./engineOpenai";

// Offline: both engines are exercised against a mocked fetch, so the suite never
// touches OpenRouter or api.openai.com. What is asserted is the translation in
// both directions — our portable map of questions onto each vendor's wire shape,
// and each vendor's answers back onto one normalized Answer.

type Captured = { url: string; body: any };

function mkCtx(settings: Record<string, string>, captured: Captured[]): Context {
    const ctx: any = { state: {}, env: {} };
    ctx.fns = {
        settings: {
            getString: async (o: any) => settings[`${o.module}.${o.key}`] ?? null,
        },
        secrets: {
            resolveSetting: async (o: any) => settings[`secret:${o.module}.${o.key}`] ?? "test-key",
        },
        decision: {
            post: (o: any) => post(ctx, null, o),
            engineJev: (o: any) => engineJev(ctx, null, o),
            engineOpenai: (o: any) => engineOpenai(ctx, null, o),
        },
    };
    ctx.captured = captured;
    return ctx as unknown as Context;
}

function jsonFetch(captured: Captured[], payload: any, status = 200) {
    return async (url: any, init: any): Promise<Response> => {
        captured.push({ url: String(url), body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
    };
}

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

describe("decision.ask — engine abstraction", () => {
    test("jev engine keeps the map contract and renames predicate to noul", async () => {
        const captured: Captured[] = [];
        globalThis.fetch = jsonFetch(captured, {
            model: "typesafe/jev-1.13",
            answers: {
                relevant: { type: "noul", noul: 0.91 },
                topic: { type: "choice", choice: "ai", probabilities: { ai: 0.97, other: 0.03 }, confidence: 0.97 },
            },
            usage: { input_tokens: 120, output_tokens: 0 },
        }) as any;

        const out = await ask(mkCtx({ "jev.endpoint": "https://openrouter.ai/api/v1/systemone", "jev.model": "typesafe/jev-1.13" }, captured), null, {
            state: "A post about a new model release.",
            questions: {
                relevant: { type: "predicate", instructions: "Is this about AI?" },
                topic: { type: "choice", instructions: "Topic?", criteria: { ai: "AI or ML", other: null } },
            },
        });

        expect(captured[0]!.url).toBe("https://openrouter.ai/api/v1/systemone");
        // Jev takes a map keyed by question id and its own name for the primitive.
        expect(captured[0]!.body.state).toContain("new model release");
        expect(captured[0]!.body.questions.relevant.type).toBe("noul");
        expect(Array.isArray(captured[0]!.body.questions)).toBe(false);

        expect(out.engine).toBe("jev");
        expect(out.answers.relevant).toMatchObject({ type: "noul", noul: 0.91, probability: 0.91 });
        expect(out.answers.topic).toMatchObject({ type: "choice", choice: "ai", confidence: 0.97 });
        expect(out.usage.inputTokens).toBe(120);
    });

    test("openai engine converts questions to an array and answers back to a map", async () => {
        const captured: Captured[] = [];
        globalThis.fetch = jsonFetch(captured, {
            model: "gpt-6-luna",
            answers: [
                { type: "predicate", name: "relevant", probability: 1 },
                { type: "choice", name: "dept", choice: "billing", probabilities: [{ value: "billing", probability: 0.95 }, { value: "other", probability: 0.05 }], confidence: 0.95 },
                {
                    type: "score", name: "severity", score: 1.1, confidence: 0.55,
                    probabilities: [
                        { value: 0, label: "Cosmetic", probability: 0.1 },
                        { value: 1, label: "Workaround", probability: 0.7 },
                        { value: 2, label: "Blocked", probability: 0.2 },
                    ],
                },
                { type: "refusal", name: "unsafe" },
            ],
            usage: { input_tokens: 300, output_tokens: 0 },
        }) as any;

        const out = await ask(mkCtx({ "decision.engine": "openai" }, captured), null, {
            state: "I was charged twice.",
            questions: {
                relevant: { type: "noul", instructions: "Is this a complaint?", criteria: { true: "a complaint", false: "not a complaint" } },
                dept: { type: "choice", instructions: "Which department?", criteria: { billing: "Payments", other: "Anything else" } },
                severity: { type: "score", instructions: "How severe?", criteria: ["Cosmetic", "Workaround", "Blocked"] },
                unsafe: { type: "noul", instructions: "Is this disallowed?" },
            },
        });

        const body = captured[0]!.body;
        expect(captured[0]!.url).toBe("https://api.openai.com/v1/decisions");
        expect(body.model).toBe("gpt-6-luna");
        // OpenAI takes a bare string input and an array of named questions.
        expect(body.input).toBe("I was charged twice.");
        expect(body.questions.map((q: any) => [q.name, q.type])).toEqual([
            ["relevant", "predicate"], ["dept", "choice"], ["severity", "score"], ["unsafe", "predicate"],
        ]);
        // noul criteria have no wire slot there, so they are folded into instructions.
        expect(body.questions[0].instructions).toContain("Yes means: a complaint");
        expect(body.questions[1].choices).toEqual([
            { value: "billing", description: "Payments" }, { value: "other", description: "Anything else" },
        ]);
        expect(body.questions[2].levels).toEqual([{ label: "Cosmetic" }, { label: "Workaround" }, { label: "Blocked" }]);

        expect(out.engine).toBe("openai");
        expect(out.answers.relevant).toMatchObject({ type: "noul", noul: 1, probability: 1 });
        expect(out.answers.dept).toMatchObject({ type: "choice", choice: "billing", probabilities: { billing: 0.95, other: 0.05 } });
        expect(out.answers.severity).toMatchObject({ type: "score", score: 1.1, legend: ["Cosmetic", "Workaround", "Blocked"], probabilities: { "0": 0.1, "1": 0.7, "2": 0.2 } });
        // A refusal is reported as an unestablished condition, not an exception.
        expect(out.answers.unsafe).toMatchObject({ type: "noul", noul: 0 });
        // Only input tokens are billed: 300 * $0.10/1M.
        expect(out.usage.cost).toBeCloseTo(0.00003, 8);
    });

    test("images force the openai engine and the message input form", async () => {
        const captured: Captured[] = [];
        globalThis.fetch = jsonFetch(captured, {
            model: "gpt-6-luna",
            answers: [{ type: "predicate", name: "damage", probability: 0.92 }],
            usage: { input_tokens: 500 },
        }) as any;

        const out = await ask(mkCtx({ "decision.engine": "jev" }, captured), null, {
            state: "Inspect the product.",
            images: ["QUJD"],
            questions: { damage: { type: "predicate", instructions: "Visible damage?" } },
        });

        expect(out.engine).toBe("openai");
        const content = captured[0]!.body.input[0].content;
        expect(content[0]).toEqual({ type: "input_text", text: "Inspect the product." });
        expect(content[1]).toEqual({ type: "input_image", image_url: "data:image/png;base64,QUJD" });
        expect(out.answers.damage).toMatchObject({ noul: 0.92 });
    });

    test("malformed questions are rejected before any request is made", async () => {
        const captured: Captured[] = [];
        globalThis.fetch = (() => { throw new Error("must not be called"); }) as any;
        const ctx = mkCtx({}, captured);

        await expect(ask(ctx, null, { state: "x", questions: {} })).rejects.toThrow("must not be empty");
        await expect(ask(ctx, null, {
            state: "x", questions: { q: { type: "choice", instructions: "pick", criteria: { only: null } } },
        })).rejects.toThrow("at least 2 options");
        await expect(ask(ctx, null, {
            state: "x", questions: { q: { type: "score", instructions: "rate", criteria: ["one"] } },
        })).rejects.toThrow("at least 2 levels");
        expect(captured).toHaveLength(0);
    });

    test("post retries a 429 and gives up with the last status", async () => {
        const captured: Captured[] = [];
        const ctx = mkCtx({}, captured);
        let calls = 0;
        globalThis.fetch = (async (_url: any, init: any) => {
            calls++;
            captured.push({ url: String(_url), body: JSON.parse(String(init.body)) });
            if (calls === 1) return new Response("slow down", { status: 429, headers: { "retry-after": "0" } });
            return new Response(JSON.stringify({ answers: {} }), { status: 200 });
        }) as any;

        const ok = await post(ctx, null, { url: "http://mock/d", apiKey: "k", body: { a: 1 }, label: "t", retries: 2 });
        expect(ok.json).toEqual({ answers: {} });
        expect(calls).toBe(2);

        // A 4xx that is not 429 is our own bad request: raised at once, never retried.
        calls = 0;
        globalThis.fetch = (async () => { calls++; return new Response("bad shape", { status: 400 }); }) as any;
        await expect(post(ctx, null, { url: "http://mock/d", apiKey: "k", body: {}, label: "t", retries: 3 }))
            .rejects.toThrow("t: 400 bad shape");
        expect(calls).toBe(1);
    });
});
