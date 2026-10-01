// Nine call sites use this to attribute work to an agent — including
// secureInput/request.ts, which decides who may answer a secret prompt. The
// behaviour that matters most is the failure: it must throw rather than return a
// blank identity, because a blank id would silently attribute work to nobody.
//
// The session is not a parameter — the ctx.fns Proxy injects it — so each case
// builds a ctx that carries the session it wants, the way a request does.
import { test, expect } from "bun:test";
import { testCtx } from "../$test";
import { makeRequestCtx } from "../$main";

const base = await testCtx();
const as = (session: unknown) => makeRequestCtx(base, session as Session);

test("reads the identity from the session's agent", async () => {
    const ctx = as({ kind: "test", agent: { id: "ab", model: "anthropic:claude-haiku-4-5", title: "Doing a thing", parentId: null, workspaceDir: "/tmp/ws" } });
    expect(await ctx.fns.agent.current({})).toEqual({
        id: "ab",
        model: "anthropic:claude-haiku-4-5",
        title: "Doing a thing",
        parentId: null,
        workspaceDir: "/tmp/ws",
    });
});

test("a fork reports its parent", async () => {
    const ctx = as({ kind: "test", agent: { id: "cd", model: "m", parentId: "ab" } });
    const got = await ctx.fns.agent.current({});
    expect(got.parentId).toBe("ab");
    expect(got.id).toBe("cd");
});

test("missing optional fields become empty strings, not undefined", async () => {
    // Callers interpolate these into prompts and page titles, where `undefined`
    // would be shown to the user verbatim.
    const ctx = as({ kind: "test", agent: { id: "ef" } });
    const got = await ctx.fns.agent.current({});
    expect(got.title).toBe("");
    expect(got.model).toBe("");
    expect(got.workspaceDir).toBe("");
});

test("a call with no agent throws instead of returning a blank identity", async () => {
    await expect(as({ kind: "test" }).fns.agent.current({})).rejects.toThrow("no agent in this call context");
});

test("an agent with no id is not an identity either", async () => {
    // The shape is present but useless; accepting it would attribute work to "".
    await expect(as({ kind: "test", agent: { model: "m" } }).fns.agent.current({})).rejects.toThrow("no agent in this call context");
});

test("a live agent is found by id when the session carries only agentId", async () => {
    (base.state as { agent?: Record<string, unknown> }).agent = {
        ...(base.state as { agent?: Record<string, unknown> }).agent,
        gh: { id: "gh", model: "m2", title: "Live" },
    };
    const got = await as({ kind: "test", agentId: "gh" }).fns.agent.current({});
    expect(got.id).toBe("gh");
    expect(got.model).toBe("m2");
});
