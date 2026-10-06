import { expect, test } from 'bun:test';
import route from './$route__POST';

const ctx: any = { fns: {
    auth: { verifyCsrf: ({ token }: any) => token === 'valid', currentUser: async () => ({ user: { id: 'test', name: 'Test' }, required: true }) },
    demo: { hello: ({ name }: any) => `<b>Hello ${name}</b>` },
    procs: {
        log: { info: () => {}, warn: () => {} },
        http: { toResponse: ({ value }: any) => new Response(value, { headers: { 'content-type': 'text/html' } }) },
    },
} };
const call = (body: any, headers: any = {}) => route(ctx, null, { req: new Request('http://localhost/rpc', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-csrf-token': 'valid', ...headers } }) });

test('authenticated csrf-protected rpc dispatches ctx.fns with an opts object', async () => {
    const res = await call({ method: 'demo.hello', params: { name: 'Ada' } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<b>Hello Ada</b>');
});
test('rpc requires authentication and a valid cookie-bound csrf token', async () => {
    const currentUser = ctx.fns.auth.currentUser;
    ctx.fns.auth.currentUser = async () => ({ user: null, required: true });
    try { expect((await call({ method: 'demo.hello', params: {} })).status).toBe(401); }
    finally { ctx.fns.auth.currentUser = currentUser; }
    expect((await call({ method: 'demo.hello', params: {} }, { 'x-csrf-token': 'forged' })).status).toBe(403);
    expect((await call({ method: 'demo.hello', params: {} }, { 'x-csrf-token': '' })).status).toBe(403);
});

test('rpc is independent of origin and rejects prototype paths', async () => {
    expect((await call({ method: 'demo.hello', params: { name: 'UI' } }, { origin: 'https://any-public-origin.example', 'sec-fetch-site': 'cross-site' })).status).toBe(200);
    expect((await call({ method: 'demo.__proto__.x', params: {} })).status).toBe(400);
    expect((await call({ method: 'missing.fn', params: {} })).status).toBe(404);
});
