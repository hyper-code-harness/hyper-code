import { expect, test } from "bun:test";
import collect from "./agentSettingsBlocks";

const mkCtx = (answers: any): any => ({
    fns: {
        procs: {
            hooks: { run: async (_opts: any) => (typeof answers === "function" ? answers(_opts) : answers) },
            log: { warn: () => {} },
        },
    },
});

test("ui.agentSettings answers are collected, trimmed and filtered", async () => {
    const ctx = mkCtx(["  <form id=a></form>  ", "", "   ", null, 42, "<form id=b></form>"]);
    expect(await collect(ctx, null, { agentId: "eh" })).toEqual(["<form id=a></form>", "<form id=b></form>"]);
});

test("the agent id reaches every handler and an empty one asks nobody", async () => {
    let seen: any = null;
    const ctx = mkCtx((opts: any) => { seen = opts; return ["<b>x</b>"]; });
    await collect(ctx, null, { agentId: "eh" });
    expect(seen).toEqual({ name: "ui.agentSettings", opts: { agentId: "eh" } });
    seen = null;
    expect(await collect(ctx, null, { agentId: "  " })).toEqual([]);
    expect(seen).toBeNull();
});

test("a failing point costs its rows, not the panel", async () => {
    const ctx: any = {
        fns: {
            procs: {
                hooks: { run: async () => { throw new Error("plugin exploded"); } },
                log: { warn: () => {} },
            },
        },
    };
    expect(await collect(ctx, null, { agentId: "eh" })).toEqual([]);
});
