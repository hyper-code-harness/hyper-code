import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

function req(cookie: string) { return new Request("http://internal/form", { headers: { cookie } }); }

test("csrf helpers bind a deterministic token to the session cookie", async () => {
  const ctx = await mkTestCtx();
  const name = ctx.fns.procs.auth.cookieName({});
  const request = req(`${name}=signed-session-a`);
  const token = await ctx.fns.auth.csrfToken({ req: request });
  expect(token.length).toBeGreaterThan(20);
  expect(await ctx.fns.auth.verifyCsrf({ req: request, token })).toBe(true);
  expect(await ctx.fns.auth.verifyCsrf({ req: request, token: token.slice(0, -1) + "x" })).toBe(false);
  expect(await ctx.fns.auth.verifyCsrf({ req: req(`${name}=signed-session-b`), token })).toBe(false);
  expect(await ctx.fns.auth.verifyCsrf({ req: req(""), token })).toBe(false);
});

test("csrf form injection is origin independent and avoids duplicate fields", async () => {
  const ctx = await mkTestCtx();
  const name = ctx.fns.procs.auth.cookieName({});
  const request = req(`${name}=signed-session`);
  const html = await ctx.fns.auth.csrfForms({ req: request, html: '<form method="post" action="/x"><button>go</button></form>' });
  expect(html).toContain('name="_csrf"');
  expect((await ctx.fns.auth.csrfForms({ req: request, html })).match(/name="_csrf"/g)).toHaveLength(1);
});
