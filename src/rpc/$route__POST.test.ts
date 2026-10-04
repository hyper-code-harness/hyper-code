import { expect, test } from 'bun:test';
import route from './$route__POST';

const ctx: any = { fns: {
    demo: { hello: ({ name }: any) => `<b>Hello ${name}</b>` },
    procs: {
        auth: { authenticate: () => ({ sub: 'test', name: 'Test' }) },
        log: { info: () => {}, warn: () => {} },
        http: { toResponse: ({ value }: any) => new Response(value, { headers: { 'content-type': 'text/html' } }) },
    },
} };
const call = (body: any, headers: any = {}) => route(ctx, null, { req: new Request('http://localhost/rpc', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } }) });

test('trusted rpc dispatches ctx.fns with an opts object', async () => {
    const res = await call({ method: 'demo.hello', params: { name: 'Ada' } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<b>Hello Ada</b>');
});

test('rpc rejects an unauthenticated non-browser request but allows same-origin app UI', async () => {
    const authenticate = ctx.fns.procs.auth.authenticate;
    ctx.fns.procs.auth.authenticate = () => null;
    try {
        expect((await call({ method: 'demo.hello', params: {} })).status).toBe(401);
        const res = await call({ method: 'demo.hello', params: { name: 'UI' } }, { origin: 'http://localhost', 'sec-fetch-site': 'same-origin' });
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('<b>Hello UI</b>');
    }
    finally { ctx.fns.procs.auth.authenticate = authenticate; }
});

test('trusted rpc rejects cross-origin and prototype paths', async () => {
    expect((await call({ method: 'demo.hello', params: {} }, { origin: 'https://evil.test' })).status).toBe(403);
    expect((await call({ method: 'demo.__proto__.x', params: {} })).status).toBe(400);
    expect((await call({ method: 'missing.fn', params: {} })).status).toBe(404);
});

test('behind a proxy: the public https origin from X-Forwarded-* is same-origin only when the peer is loopback', async () => {
    const H = 'hyper.niquola.in.hn.hyper-mesh.xyz';
    const req = (peer: string) => {
        const r = new Request(`http://${H}/rpc`, { method: 'POST', body: JSON.stringify({ method: 'demo.hello', params: { name: 'P' } }), headers: {
            'content-type': 'application/json', origin: `https://${H}`, 'sec-fetch-site': 'same-origin', host: H, 'x-forwarded-proto': 'https', 'x-forwarded-host': H } });
        return { r, c: { ...ctx, state: { procs: { http: { server: { server: { requestIP: () => ({ address: peer }) } } } } } } };
    };
    const lo = req('127.0.0.1'); expect((await route(lo.c, null, { req: lo.r })).status).toBe(200);
    const lan = req('192.168.1.7'); expect((await route(lan.c, null, { req: lan.r })).status).toBe(403); // spoofed headers from a non-proxy peer
    const evil = req('127.0.0.1'); evil.r.headers.set('origin', 'https://evil.test');
    expect((await route(evil.c, null, { req: evil.r })).status).toBe(403);
});
