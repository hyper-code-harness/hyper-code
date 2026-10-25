import { describe, expect, test } from 'bun:test';
import render from '../src/knowledge/renderBacklinks';

function mock(rows: object[] = [], fail = false) {
    const calls: Array<{ sql: string; params: string[] }> = [];
    const ctx = { fns: { procs: {
        ui: { escape: ({ text }: { text: string }) => Bun.escapeHTML(text) },
        db: { select: async (opts: { sql: string; params: string[] }) => { calls.push(opts); if (fail) throw new Error('offline'); return rows; } },
    }, w: { escape: ({ text }: { text: string }) => Bun.escapeHTML(text) } } };
    return { ctx: ctx as never, calls };
}

describe('Knowledge message backlinks (isolated mocks)', () => {
    test('groups five observations across canonical and legacy links, batches metadata including archived chats', async () => {
        const { ctx, calls } = mock([{ agent: 'ab', idx: 3, title: '<Archived chat>', ts: 1704067200000 }]);
        const provenance = ['a', 'b', 'c', 'd', 'e'].map((attribute, i) => ({ attribute, url: i % 2 ? 'hyper://agent/ab/message/003' : '/agent/ab/message/3', evidence: '<script>alert(1)</script>' }));
        const result = await render(ctx, null, { provenance });
        expect(result.count).toBe(1);
        expect(result.html.match(/<article /g)?.length).toBe(1);
        expect(result.html).toContain('&lt;Archived chat&gt;');
        expect(result.html).toContain('&lt;script&gt;');
        expect(result.html).not.toContain('<script>');
        expect(result.html).toContain('2024-01-01');
        expect(result.html).toContain('href="/agent/ab/message/3"');
        for (const attribute of ['a', 'b', 'c', 'd', 'e']) expect(result.html).toContain('>' + attribute + '</span>');
        expect(calls.length).toBe(1);
        expect(JSON.parse(calls[0]!.params[0]!)).toEqual([{ agent: 'ab', idx: 3 }]);
        expect(calls[0]!.sql).not.toContain('archived');
    });
    test('rejects unsafe or non-chat URLs and never invents sources', async () => {
        const { ctx, calls } = mock();
        const urls = [undefined, 'javascript:alert(1)', 'https://example.com', '//evil/message/1', '/agent/%22onclick%3Dx/message/1', '/agent/%2F/message/1', '/agent/%ZZ/message/1', '/agent/ab/message/1?x=1', '/agent/ab/message/999999999999999999999'];
        const result = await render(ctx, null, { provenance: urls.map(url => ({ attribute: 'x', url })) });
        expect(result.count).toBe(0);
        expect(result.html).toContain('No chat message sources recorded');
        expect(result.html).not.toContain('href=');
        expect(calls).toHaveLength(0);
    });
    test('missing metadata keeps separate persisted links, escapes chips and truncates quotes', async () => {
        const { ctx, calls } = mock([], true);
        const result = await render(ctx, null, { provenance: [
            { attribute: '<img>', url: '/agent/ab/message/1', evidence: 'x'.repeat(500) },
            { attribute: '<img>', url: '/agent/ab/message/2' },
            { attribute: 'title', url: '/agent/cd/message/1' },
        ] });
        expect(result.count).toBe(3);
        expect(result.html).toContain('>ab</a>');
        expect(result.html).toContain('>cd</a>');
        expect(result.html).toContain('&lt;img&gt;');
        expect(result.html).toContain('x'.repeat(239) + '…');
        expect(result.html).not.toContain('<time');
        expect(calls).toHaveLength(1);
    });
});
