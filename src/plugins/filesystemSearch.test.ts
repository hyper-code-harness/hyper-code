import { expect, test } from 'bun:test';
import search from './filesystemSearch';

test('mounted discovery uses display metadata, not managed-install validation', async () => {
    const ctx: any = {
        state: { procs: { modules: [{ name: 'example', dir: '/tmp', label: 'Fallback', description: 'Fallback description', icon: 'ph-folder' }] } },
        fns: { plugins: {
            readMetadata: async () => ({ name: 'example', version: '1.2.3', dependencies: { example: '*' }, scripts: { build: 'example' }, procs: { label: 'Example App', description: 'Search saved documents.', icon: 'ph-book' } }),
            validateTree: async () => { throw new Error('Discovery must not validate installable trees'); },
        } },
    };
    const result = await search(ctx, null, { q: 'documents' });
    expect(result.errors).toEqual([]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ label: 'Example App', description: 'Search saved documents.', icon: 'ph-book', version: '1.2.3' });
    expect(result.items[0].selection.revision).toMatch(/^mounted:[0-9a-f]{64}$/);
    expect((await search(ctx, null, { q: 'absent' })).items).toEqual([]);
    ctx.fns.plugins.readMetadata = async () => ({ name: 'example' });
    const minimal = await search(ctx, null, {});
    expect(minimal.items[0]).not.toHaveProperty('version');
    expect(minimal.items[0].description).toBe('Fallback description');
});
