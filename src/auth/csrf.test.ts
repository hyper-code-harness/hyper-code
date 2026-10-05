import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

function req(name: string, cookie: string) { return new Request("http://internal/form", { headers: { cookie: `${name}=${cookie}` } }); }

async function sessionToken(ctx: any, jti?: string) {
  return ctx.fns.procs.auth.sign({ sub: "csrf-user", name: "CSRF User", days: 1, ...(jti ? { jti } : {}) });
}

test("csrf helpers bind plain sessions to their signed cookie", async () => {
  const ctx = await mkTestCtx();
  const name = ctx.fns.procs.auth.cookieName({});
  const cookie = await sessionToken(ctx);
  const request = req(name, cookie);
  const token = await ctx.fns.auth.csrfToken({ req: request });
  expect(token.length).toBeGreaterThan(20);
  expect(await ctx.fns.auth.verifyCsrf({ req: request, token })).toBe(true);
  expect(await ctx.fns.auth.verifyCsrf({ req: request, token: token.slice(0, -1) + "x" })).toBe(false);
  const otherCookie = `${cookie.slice(0, cookie.lastIndexOf('.') + 1)}${cookie.slice(cookie.lastIndexOf('.') + 1, -1)}${cookie.endsWith('A') ? 'B' : 'A'}`;
  expect(await ctx.fns.auth.verifyCsrf({ req: req(name, otherCookie), token })).toBe(false);
});

test("csrf token survives OIDC access-cookie renewal with the same session id", async () => {
  const ctx = await mkTestCtx();
  const name = ctx.fns.procs.auth.cookieName({});
  const first = req(name, await sessionToken(ctx, "s_stable"));
  const token = await ctx.fns.auth.csrfToken({ req: first });
  await Bun.sleep(1100);
  const renewed = req(name, await sessionToken(ctx, "s_stable"));
  expect(await ctx.fns.auth.verifyCsrf({ req: renewed, token })).toBe(true);
});

test("csrf form injection is origin independent and avoids duplicate fields", async () => {
  const ctx = await mkTestCtx();
  const name = ctx.fns.procs.auth.cookieName({});
  const request = req(name, await sessionToken(ctx));
  const html = await ctx.fns.auth.csrfForms({ req: request, html: '<form method="post" action="/x"><button>go</button></form>' });
  expect(html).toContain('name="_csrf"');
  expect((await ctx.fns.auth.csrfForms({ req: request, html })).match(/name="_csrf"/g)).toHaveLength(1);
});
