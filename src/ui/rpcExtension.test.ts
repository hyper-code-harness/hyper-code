import { expect, test } from 'bun:test';

test('popup RPC extension keeps source HTML compact and uses htmx transport', async () => {
    const source = await Bun.file(new URL('./$script_rpc.js', import.meta.url)).text();
    expect(source).toContain("closest?.('[hx-popup]')");
    expect(source).toContain("htmx.ajax('POST', '/rpc'");
    expect(source).toContain("headers['X-CSRF-Token'] = token");
    // FormData must be captured before loading() replaces the popup body. The
    // detached source element caused login forms to stick on "loading…".
    expect(source).toContain("const values = { method, params: JSON.stringify(params) }");
    expect(source).not.toContain("{ source: elt, target: '#app-popup-body'");
    expect(source).not.toContain("fetch('/rpc'");
    expect(source).not.toContain("setAttribute('hx-post'");
});
