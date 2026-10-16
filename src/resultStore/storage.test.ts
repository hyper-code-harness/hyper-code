import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, readFile, writeFile, readdir, stat, symlink, mkdir, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import write from './write';
import read from './read';
import root from './root';
import readResult from '../agent/readResult';
import getFullMessages from '../session/getFullMessages';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
async function fixture() {
    const instance = await mkdtemp(join(tmpdir(), 'hyper-result-test-')); dirs.push(instance);
    const caller = { id: 'owner', scratchpad: { plan: { title: 'unchanged' } } };
    const messages: Record<string, any[]> = { owner: [] };
    const agents: Record<string, any> = { owner: { id: 'owner' } };
    const ctx: any = { state: { agent: { owner: caller } }, fns: {
        settings: { getString: async () => instance },
        agent: { current: async () => caller },
        session: { getMessages: async ({ id }: any) => messages[id] ?? [] },
        procs: { db: { select: async ({ sql, params }: any) => sql.includes('agent_trigger_runs') ? [] : agents[params[0]] ? [agents[params[0]]] : [] } },
        resultStore: {},
    } };
    ctx.fns.resultStore.root = (o: any) => root(ctx, null, o);
    ctx.fns.resultStore.read = (o: any) => read(ctx, null, o);
    ctx.fns.session.getFullMessages = (o: any) => getFullMessages(ctx, null, o);
    const put = async (text = 'hello', ownerAgentId = 'owner') => {
        const ref = await write(ctx, null, { ownerAgentId, kind: 'test', text });
        (messages[ownerAgentId] ??= []).push({ role: 'tool', result_ref: ref });
        return ref;
    };
    const path = (ref: any) => join(instance, '.hyper/results', ref.ownerAgentId, ref.id + '.json');
    return { instance, ctx, caller, messages, agents, put, path, get: (ref: any) => read(ctx, null, { ref }), api: (opts: any) => readResult(ctx, null, opts) };
}

test('trigger ownership is rechecked on cache hit without messages', async () => {
    const f = await fixture();
    const ref = await f.put('trigger data');
    f.messages.owner = [];
    let linked = true;
    const original = f.ctx.fns.procs.db.select;
    f.ctx.fns.procs.db.select = async (o: any) => o.sql.includes('agent_trigger_runs')
        ? linked && o.params[0] === 'owner' && (o.params[1] === ref.id || o.params[1] === JSON.stringify(ref)) ? [{ref}] : []
        : original(o);
    expect(await f.api({id:ref.id})).toMatchObject({ok:true,text:'trigger data'});
    f.caller.id = 'foreign';
    expect(await f.api({id:ref.id})).toEqual({ok:false,error:'not_found'});
    await expect(f.get(ref)).rejects.toThrow('not_found');
    f.caller.id = 'owner'; linked = false;
    expect(await f.api({id:ref.id})).toEqual({ok:false,error:'not_found'});
    await expect(f.get(ref)).rejects.toThrow('not_found');
    f.messages.owner = [{result_ref:ref}];
    expect(await f.api({id:ref.id})).toMatchObject({ok:true,text:'trigger data'});
});

describe('private immutable result storage', () => {
    test('root is absolute, instance based and independent of workspace/remote host', async () => {
        const f = await fixture();
        f.ctx.state.workspace = { dir: '/other', host: 'remote' };
        expect(await root(f.ctx, null, {})).toBe(join(f.instance, '.hyper/results'));
        for (const value of ['', 'relative/path']) {
            f.ctx.fns.settings.getString = async () => value;
            await expect(root(f.ctx, null, {})).rejects.toThrow('absolute local directory');
        }
    });
    test('atomic publication returns complete JSON, private modes, UTF-8 SHA and unique immutable ids', async () => {
        const f = await fixture();
        const text = 'Привет 🌍\n\u0000e\u0301';
        const refs = await Promise.all(Array.from({ length: 12 }, () => f.put(text)));
        expect(new Set(refs.map(r => r.id)).size).toBe(12);
        for (const ref of refs) {
            expect(ref).toMatchObject({ version: 1, ownerAgentId: 'owner', kind: 'test', bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex') });
            const data = JSON.parse(await readFile(f.path(ref), 'utf8'));
            expect(data).toMatchObject({ id: ref.id, text, ownerAgentId: 'owner', version: 1 });
            expect(Number.isFinite(data.createdAt)).toBe(true);
            expect((await stat(f.path(ref))).mode & 0o777).toBe(0o600);
            expect(await f.get(ref)).toEqual({ text, totalChars: text.length });
        }
        const ownerDir = join(f.instance, '.hyper/results/owner');
        expect((await stat(ownerDir)).mode & 0o777).toBe(0o700);
        expect((await stat(join(f.instance, '.hyper/results'))).mode & 0o777).toBe(0o700);
        expect((await readdir(ownerDir)).sort()).toEqual(refs.map(r => r.id + '.json').sort());
        const snapshot = await readFile(f.path(refs[0]), 'utf8');
        await f.put('different');
        expect(await readFile(f.path(refs[0]), 'utf8')).toBe(snapshot);
    });
    test('empty output and maximum 32 MiB are accepted; UTF-8 overflow rejected before creating files', async () => {
        const f = await fixture();
        expect(await f.get(await f.put(''))).toEqual({ text: '', totalChars: 0 });
        const text = 'x'.repeat(32 * 1024 * 1024);
        expect((await f.get(await f.put(text))).text.length).toBe(text.length);
        await expect(f.put(text + 'x')).rejects.toThrow('too_large');
        await expect(f.put('🌍'.repeat(8 * 1024 * 1024 + 1))).rejects.toThrow('too_large');
        expect((await readdir(join(f.instance, '.hyper/results/owner'))).length).toBe(2);
    });
    test('malicious owners and ids and invalid references never resolve paths', async () => {
        const f = await fixture(); const ref = await f.put();
        for (const ownerAgentId of ['../escape', '/tmp', '.', '', 'a/b', 'a\\b', 'x'.repeat(129)]) {
            await expect(f.put('x', ownerAgentId)).rejects.toThrow('invalid ownerAgentId');
            await expect(f.get({ ...ref, ownerAgentId })).rejects.toThrow('corrupt');
        }
        for (const patch of [{ id: '../escape' }, { id: '' }, { version: 2 }, { sha256: 'wrong' }, { bytes: -1 }, { bytes: 0.1 }, { bytes: NaN }]) {
            await expect(f.get({ ...ref, ...patch })).rejects.toThrow('corrupt');
        }
        await expect(f.get({ ...ref, bytes: 32 * 1024 * 1024 + 1 })).rejects.toThrow('too_large');
    });
    test('missing files, malformed JSON, metadata and digest/byte corruption fail closed', async () => {
        const f = await fixture(); const ref = await f.put(); const source = await readFile(f.path(ref), 'utf8');
        const data = JSON.parse(source);
        for (const patch of [{ version: 2 }, { id: 'wrong' }, { ownerAgentId: 'other' }, { kind: 'wrong' }, { text: 12 }, { text: 'jello' }, { text: 'longer' }, { createdAt: null }]) {
            await writeFile(f.path(ref), JSON.stringify({ ...data, ...patch }));
            await expect(f.get(ref)).rejects.toThrow('corrupt');
            expect(f.ctx.state.resultStore.pending.size).toBe(0);
        }
        await writeFile(f.path(ref), '{'); await expect(f.get(ref)).rejects.toThrow('corrupt');
        await writeFile(f.path(ref), source); expect((await f.get(ref)).text).toBe('hello');
        f.ctx.state.resultStore.cache.clear();
        await rm(f.path(ref)); await expect(f.get(ref)).rejects.toThrow('not_found');
        await mkdir(f.path(ref)); await expect(f.get(ref)).rejects.toThrow('corrupt');
        expect(f.ctx.state.resultStore.pending.size).toBe(0);
    });
    test('oversized serialized file is rejected from stat without loading it', async () => {
        const f = await fixture(); const ref = await f.put();
        await truncate(f.path(ref), 200 * 1024 * 1024 + 1);
        await expect(f.get(ref)).rejects.toThrow('too_large');
    });
    test('owner and result symlinks cannot escape or alias result paths', async () => {
        const f = await fixture(); const ref = await f.put();
        const outside = join(f.instance, 'outside'); await mkdir(outside);
        await symlink(outside, join(f.instance, '.hyper/results/evil'));
        await expect(f.put('x', 'evil')).rejects.toThrow('invalid owner directory');
        const saved = await readFile(f.path(ref)); await rm(f.path(ref));
        const target = join(outside, 'payload'); await writeFile(target, saved); await symlink(target, f.path(ref));
        await expect(f.get(ref)).rejects.toThrow('corrupt');
        await rm(f.path(ref));
        const sibling = await f.put('hello'); await symlink(f.path(sibling), f.path(ref));
        await expect(f.get(ref)).rejects.toThrow('corrupt');
    });
});

describe('bounded process-only result cache', () => {
    test('concurrent loads deduplicate, hits avoid disk, failures do not poison retry, scratchpad stays untouched', async () => {
        const f = await fixture(); const before = JSON.stringify(f.caller); const ref = await f.put('body not in scratchpad');
        const results = await Promise.all(Array.from({ length: 20 }, () => f.get(ref)));
        for (const result of results) expect(result).toBe(results[0]!);
        expect(f.ctx.state.resultStore.pending.size).toBe(0);
        expect(f.ctx.state.resultStore.cache.size).toBe(1);
        await rm(f.path(ref)); expect(await f.get(ref)).toBe(results[0]!);
        expect(JSON.stringify(f.caller)).toBe(before);
        expect(JSON.stringify(f.caller.scratchpad)).not.toContain('body not in scratchpad');
        f.ctx.state.resultStore.cache.clear();
        const failed = await Promise.allSettled([f.get(ref), f.get(ref)]);
        expect(failed.every(r => r.status === 'rejected')).toBe(true);
        expect(f.ctx.state.resultStore.pending.size).toBe(0);
    });
    test('cache configuration, idle TTL expiry and refresh', async () => {
        const f = await fixture(); const ref = await f.put(); await f.get(ref);
        const cache = f.ctx.state.resultStore.cache;
        expect(cache.maxSize).toBe(64 * 1024 * 1024); expect(cache.maxEntrySize).toBe(8 * 1024 * 1024);
        expect(cache.ttl).toBe(120000); expect(cache.updateAgeOnGet).toBe(true);
        const [key] = [...cache.keys()]; const value = cache.get(key);
        cache.set(key, value, { ttl: 80 });
        await Bun.sleep(45); expect(await f.get(ref)).toBe(value);
        await Bun.sleep(45); expect(await f.get(ref)).toBe(value);
        await rm(f.path(ref)); await Bun.sleep(100);
        await expect(f.get(ref)).rejects.toThrow('not_found');
    });
    test('large individual entries bypass cache and aggregate cache evicts least recently used', async () => {
        const f = await fixture(); const large = await f.put('x'.repeat(4 * 1024 * 1024));
        await f.get(large); expect(f.ctx.state.resultStore.cache.size).toBe(0);
        const refs = [];
        for (let i = 0; i < 16; i++) { const ref = await f.put('x'.repeat(2 * 1024 * 1024)); refs.push(ref); await f.get(ref); }
        const cache = f.ctx.state.resultStore.cache;
        expect(cache.calculatedSize).toBeLessThanOrEqual(64 * 1024 * 1024);
        expect(cache.size).toBe(15);
        await f.get(refs[1]);
        const newest = await f.put('y'.repeat(2 * 1024 * 1024)); await f.get(newest);
        const ids = [...cache.keys()].join(' ');
        expect(ids).toContain(refs[1]!.id); expect(ids).not.toContain(refs[0]!.id); expect(ids).not.toContain(refs[2]!.id);
    });
});

describe('agent.readResult authorization and ranges', () => {
    test('storage primitive authorizes complete metadata before every cache hit', async () => {
        const f = await fixture(); const ref = await f.put('private'); await f.get(ref);
        for (const patch of [{ ownerAgentId: 'other' }, { kind: 'other' }, { bytes: ref.bytes + 1 }, { sha256: 'a'.repeat(64) }]) {
            await expect(f.get({ ...ref, ...patch })).rejects.toThrow('not_found');
        }
        f.messages.owner = [];
        await expect(f.get(ref)).rejects.toThrow('not_found');
        f.messages.owner = [{ result_ref: ref }];
        expect((await f.get(ref)).text).toBe('private');
        f.caller.id = 'stranger';
        await expect(f.get(ref)).rejects.toThrow('not_found');
    });
    test('foreign/unknown/malicious ids stay not_found; missing caller forbidden; legacy unavailable', async () => {
        const f = await fixture(); const ref = await f.put(); f.messages.owner = [];
        expect(await f.api({ id: ref.id })).toEqual({ ok: false, error: 'not_found' });
        expect(await f.api({ id: '../secret' })).toEqual({ ok: false, error: 'not_found' });
        expect(await f.api({ id: 'r12' })).toEqual({ ok: false, error: 'legacy_unavailable' });
        f.ctx.fns.agent.current = async () => { throw new Error('no agent'); };
        expect(await f.api({ id: ref.id })).toEqual({ ok: false, error: 'forbidden' });
    });
    test('inherited multi-level fork boundaries authorize only visible refs, including on cache hit', async () => {
        const f = await fixture(); const a = await f.put('inherited'); const b = await f.put('after fork');
        f.messages.owner = [{ role: 'tool', result_ref: a, excluded_from_cursor: true }, { role: 'tool', result_ref: b }];
        f.agents.child = { id: 'child', parent_id: 'owner', fork_offset: 1 };
        f.agents.grandchild = { id: 'grandchild', parent_id: 'child', fork_offset: 1 };
        f.caller.id = 'grandchild';
        expect(await f.api({ id: a.id })).toMatchObject({ ok: true, text: 'inherited' });
        f.caller.id = 'owner'; await f.get(b); f.caller.id = 'grandchild'; // prewarm as authorized owner
        expect(await f.api({ id: b.id })).toEqual({ ok: false, error: 'not_found' });
        f.agents.grandchild.fork_offset = 0;
        expect(await f.api({ id: a.id })).toEqual({ ok: false, error: 'not_found' });
        f.caller.id = 'stranger'; f.agents.stranger = { id: 'stranger' };
        expect(await f.api({ id: a.id })).toEqual({ ok: false, error: 'not_found' });
    });
    test('range defaults, clamps, non-finite values, UTF-16 offsets and truncation', async () => {
        const f = await fixture(); const text = '🌍' + 'a'.repeat(20000); const ref = await f.put(text);
        f.messages.owner = [{ role: 'tool', result_ref: ref }];
        expect(await f.api({ id: ref.id })).toEqual({ ok: true, text: text.slice(0, 4000), totalChars: text.length, offset: 0, truncated: true });
        for (const [offset, limit, start, count] of [[-3, 0, 0, 1], [2.9, 3.9, 2, 3], [0, 99999, 0, 16000], [Infinity, NaN, 0, 4000], [99999, 20, text.length, 0], [0, 1, 0, 1]] as const) {
            const expected = text.slice(start, start + count);
            expect(await f.api({ id: ref.id, offset, limit })).toEqual({ ok: true, text: expected, totalChars: text.length, offset: start, truncated: start + expected.length < text.length });
        }
    });
    test('authorized storage errors map to stable public codes', async () => {
        const f = await fixture(); const ref = await f.put(); f.messages.owner = [{ result_ref: ref }];
        for (const [message, error] of [['not_found', 'not_found'], ['too_large', 'too_large'], ['corrupt', 'corrupt'], ['EACCES /private/path', 'corrupt']] as const) {
            f.ctx.fns.resultStore.read = async () => { throw new Error(message); };
            expect(await f.api({ id: ref.id })).toEqual({ ok: false, error });
        }
    });
});

test('UUID API authorizes once per read, including cold cache and revoked warm cache',async()=>{
    const f=await fixture();const ref=await f.put('visible');
    let lookups=0;const original=f.ctx.fns.session.getFullMessages;
    f.ctx.fns.session.getFullMessages=async(o:any)=>{lookups++;return original(o);};
    expect(await f.api({id:ref.id})).toMatchObject({ok:true,text:'visible'});
    expect(lookups).toBe(1);
    f.ctx.state.resultStore.cache.clear();
    expect(await f.api({id:ref.id})).toMatchObject({ok:true,text:'visible'});
    expect(lookups).toBe(2);
    f.messages.owner=[];
    expect(await f.api({id:ref.id})).toEqual({ok:false,error:'not_found'});
    expect(lookups).toBe(3);
});

test('foreign trigger UUID stays inaccessible on cold cache',async()=>{
    const f=await fixture();const ref=await f.put('private','foreign');
    let reads=0;
    f.ctx.fns.procs.db.select=async(o:any)=>{
        if(o.sql.includes('agent_trigger_runs')){reads++;expect(o.params[0]).toBe('owner');return [{ref}];}
        return [];
    };
    expect(await f.api({id:ref.id})).toEqual({ok:false,error:'not_found'});
    expect(reads).toBe(1);expect(f.ctx.state.resultStore?.cache).toBeUndefined();
});
