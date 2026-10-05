import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

describe("secrets.list", () => {
  test("returns references and metadata but never encrypted or plain values", async () => {
    const ctx = await mkTestCtx({ env: { HYPER_OAUTH_ENCRYPTION_KEY: Buffer.alloc(32, 21).toString("base64") } });
    await ctx.fns.secrets.putLocal({ namespace: "service", name: "api-key", value: "super-sensitive-value", source: "test-source" });
    const rows = await ctx.fns.secrets.list({ namespace: "service" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ref: "secret://service/api-key", namespace: "service", name: "api-key", source: "test-source", version: 1 });
    expect(JSON.stringify(rows)).not.toContain("super-sensitive-value");
    expect(Object.keys(rows[0]!)).not.toContain("value");
    expect(Object.keys(rows[0]!)).not.toContain("value_enc");
  });

  test("filters by namespace and escaped case-insensitive query", async () => {
    const ctx = await mkTestCtx({ env: { HYPER_OAUTH_ENCRYPTION_KEY: Buffer.alloc(32, 22).toString("base64") } });
    await ctx.fns.secrets.putLocal({ namespace: "google", name: "Token_A", value: "a" });
    await ctx.fns.secrets.putLocal({ namespace: "github", name: "token-b", value: "b" });
    expect((await ctx.fns.secrets.list({ query: "token_a" })).map((x: any) => x.ref)).toEqual(["secret://google/Token_A"]);
    expect((await ctx.fns.secrets.list({ namespace: "github" })).map((x: any) => x.ref)).toEqual(["secret://github/token-b"]);
  });
});
