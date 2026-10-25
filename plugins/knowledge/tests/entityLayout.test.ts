import { describe, expect, test } from 'bun:test';
import route from '../src/knowledge/$route_$type_$slug_GET';

async function render(provenance: object[] = [], missing = false) {
    const ctx = { fns: { procs: { ui: { escape: ({ text }: { text: string }) => Bun.escapeHTML(text) } }, w: { escape: ({ text }: { text: string }) => Bun.escapeHTML(text) }, knowledge: {
        get: async () => missing ? null : ({ type: 'Person', data: { title: 'Example', body: 'Notes retained', role: 'Engineer' }, provenance, relations: { outgoing: [{ predicate: 'worksAt', object: 'Organization/example' }], incoming: [{ predicate: 'knows', subject: 'Person/other' }] } }),
        renderBacklinks: async () => ({ html: '<section>Mentioned in</section>', count: 1 }),
        renderHistory: async ({ id }: { id: string }) => { expect(id).toBe('Person/example'); return { html: '<section>History</section>', count: 0, hasMore: false }; },
    } } };
    return route(ctx as never, null, { req: new Request('http://localhost/knowledge/Person/example'), params: { type: 'Person', slug: 'example' } });
}

describe('Knowledge entity layout (isolated mocks, no database)', () => {
    test('wide balanced layout preserves facts, notes, backlinks and both relation directions', async () => {
        const { main } = await render();
        for (const text of ['max-w-7xl', 'lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]', 'lg:col-span-2', 'Canonical facts', 'Notes retained', 'History', 'Mentioned in', 'worksAt', 'Organization/example', 'knows', 'Person/other', 'No observations']) expect(main).toContain(text);
        expect(main.indexOf('</aside>')).toBeLessThan(main.indexOf('>Provenance'));
    });
    test('observations are collapsed compact rows with accessible fields and expanded evidence', async () => {
        const { main } = await render([{ attribute: 'role', source: 'chat', value: { title: '<Engineer>' }, status: 'verified', evidence: '<script>unsafe</script>', url: 'hyper://agent/ab/message/3' }]);
        expect(main.match(/<details /g)).toHaveLength(1);
        expect(main).not.toMatch(/<details[^>]*\sopen[\s=>]/);
        for (const text of ['<summary', 'grid-cols-2', 'Attribute: ', 'Source: ', 'Value: ', 'Status: ', 'verified', '&lt;Engineer&gt;', '&lt;script&gt;', 'href="/agent/ab/message/3"', 'focus-visible:outline']) expect(main).toContain(text);
        expect(main).not.toContain('<script>');
        expect(main.indexOf('</summary>')).toBeLessThan(main.indexOf('&lt;script&gt;'));
    });
    test('source links retain safe HTTP URLs and reject unsafe schemes', async () => {
        const { main } = await render([{ attribute: 'x', value: 'a', source: '<img>', status: 'pending', url: 'javascript:alert(1)' }, { attribute: 'y', value: 'b', source: 'web', status: 'verified', url: 'https://example.com/?q="bad"&x=1' }]);
        expect(main).not.toContain('href="javascript:');
        expect(main).toContain('&lt;img&gt;');
        expect(main).toContain('href="https://example.com/?q=&quot;bad&quot;&amp;x=1"');
    });
    test('missing entity retains 404 response', async () => {
        expect((await render([], true)).status).toBe(404);
    });
});
