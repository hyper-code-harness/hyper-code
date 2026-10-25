import { describe, expect, test } from 'bun:test';
import renderHistory from '../src/knowledge/renderHistory';

const change = (overrides: Record<string, unknown> = {}) => ({ id: 1, attribute: 'role', operation: 'correct', before_value: 'Engineer', after_value: 'Lead', source_agent_id: 'ab', source_message_idx: 7, url: '/agent/ab/message/7', evidence: 'I became Lead.', changed_at: '2026-07-01T12:00:00.000Z', ...overrides });
async function render(rows: ReturnType<typeof change>[] = [], id = 'Person/example') {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const ctx = { fns: { procs: { ui: { escape: ({ text }: { text: string }) => Bun.escapeHTML(text) }, db: { select: async (args: { sql: string; params: unknown[] }) => { calls.push(args); return rows; } } }, w: { escape: ({ text }: { text: string }) => Bun.escapeHTML(text) } } };
    return { ...await renderHistory(ctx as never, null, { id }), calls };
}

describe('durable entity history (isolated mocks only)', () => {
    test('correction includes before/after, UTC date, original message and collapsed escaped evidence', async () => {
        const { html, count } = await render([change({ evidence: '<script>alert("x")</script>' })]);
        expect(count).toBe(1);
        for (const text of ['History', 'role', 'Engineer', '→', 'Lead', 'Corrected', 'datetime="2026-07-01T12:00:00.000Z"', 'href="/agent/ab/message/7"', '<summary', '&lt;script&gt;', 'Before: ', 'After: ']) expect(html).toContain(text);
        expect(html).not.toContain('<script>');
        expect(html).not.toMatch(/<details[^>]*\sopen[\s=>]/);
        expect(html.indexOf('</summary>')).toBeLessThan(html.indexOf('&lt;script&gt;'));
    });
    test('create/add null before is added, distinct from empty string, array, object and null after', async () => {
        const { html } = await render([
            change({ operation: 'create', before_value: null, after_value: 'New' }),
            change({ operation: 'add', before_value: null, after_value: '' }),
            change({ before_value: '', after_value: [] }),
            change({ before_value: {}, after_value: null }),
            change({ before_value: false, after_value: 0 }),
        ]);
        for (const text of ['Not set (added)', 'Added', 'empty string', 'empty array', '{}', '>null<', 'false', '0']) expect(html).toContain(text);
        expect(html.match(/Not set \(added\)/g)).toHaveLength(2);
    });
    test('references and arrays are readable and link safe canonical targets', async () => {
        const { html } = await render([change({ before_value: 'Organization/old', after_value: ['Organization/new', '<img src=x>', { title: '<unsafe>' }] })]);
        expect(html).toContain('href="/knowledge/Organization/old"');
        expect(html).toContain('href="/knowledge/Organization/new"');
        expect(html).toContain('&lt;img src=x&gt;');
        expect(html).toContain('&lt;unsafe&gt;');
        expect(html).not.toContain('<img');
    });
    test('unsafe URL cannot become a link; source identity is encoded and all fields escaped', async () => {
        const { html } = await render([change({ attribute: '<svg onload=x>', before_value: '<b>', after_value: 'javascript:alert(1)', source_agent_id: 'a/"<x>', url: 'javascript:alert(1)' })]);
        expect(html).toContain('href="/agent/a%2F%22%3Cx%3E/message/7"');
        expect(html).toContain('&lt;svg onload=x&gt;');
        expect(html).not.toContain('href="javascript:');
        expect(html).not.toContain('<svg');
        const invalid = await render([change({ source_message_idx: -1 })]);
        expect(invalid.html).toContain('Source message unavailable');
        expect(invalid.html).not.toContain('href="/agent/');
    });
    test('empty journal explicitly does not reconstruct earlier observations', async () => {
        const { html, count, hasMore } = await render();
        expect(count).toBe(0); expect(hasMore).toBe(false);
        expect(html).toContain('since the journal was enabled');
        expect(html).toContain('No recorded canonical changes');
        expect(html).toContain('not reconstructed as history');
    });
    test('bounded parameterized newest-first query with deterministic id tie-break and latest-30 notice', async () => {
        const rows = Array.from({ length: 31 }, (_, i) => change({ id: 100 - i, attribute: `field-${100 - i}` }));
        const id = "Person/x' OR 1=1 --";
        const result = await render(rows, id);
        expect(result.calls).toHaveLength(1);
        expect(result.calls[0]!.params).toEqual([id, 31]);
        expect(result.calls[0]!.sql).toContain('WHERE subject = ? ORDER BY changed_at DESC, id DESC LIMIT ?');
        expect(result.calls[0]!.sql).not.toContain(id);
        expect(result.count).toBe(30); expect(result.hasMore).toBe(true);
        expect(result.html).toContain('latest 30 changes; older changes are not shown');
        expect(result.html).not.toContain('field-70');
        expect(result.html.indexOf('field-100')).toBeLessThan(result.html.indexOf('field-99'));
        const exact = await render(rows.slice(0, 30));
        expect(exact.hasMore).toBe(false);
    });
});
