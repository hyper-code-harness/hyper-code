/**
 * Read and verify an authorized immutable result through bounded TTL LRU memory
 *
 * Storage primitive that independently authorizes references against the calling agent's visible history before every cache access. Verifies metadata, UTF-8 bytes and SHA-256, limits serialized reads to 200 MiB, and deduplicates concurrent loads. Cache is process state only; two-minute idle TTL, 64 MiB accounting and 8 MiB per entry, never scratchpad.
 * @param opts.ref Optional expected reference; all metadata must match durable authorization.
 * @param opts.id Result UUID resolved from visible messages or owned trigger runs.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Optional expected reference; all metadata must match durable authorization. */
        ref?: types.agent.ResultRef;
        /** Result UUID resolved from visible messages or owned trigger runs. */
        id?: string;
    },
): Promise<{text:string;totalChars:number}> {
    const { LRUCache } = await import('lru-cache');
    const { open, realpath } = await import('node:fs/promises');
    const { join, sep } = await import('node:path');
    const { createHash } = await import('node:crypto');
    const validate = (ref: types.agent.ResultRef) => {
        if (ref.version !== 1 || !/^[a-zA-Z0-9_-]{1,128}$/.test(ref.ownerAgentId) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(ref.id) || !/^[a-f0-9]{64}$/.test(ref.sha256) || !Number.isSafeInteger(ref.bytes) || ref.bytes < 0) throw new Error('corrupt');
        if (ref.bytes > 32 * 1024 * 1024) throw new Error('too_large');
    };
    if (opts.ref) validate(opts.ref);
    const id = opts.id ?? opts.ref?.id;
    if (!id || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw new Error('not_found');
    let caller;
    try { caller = await ctx.fns.agent.current({}); } catch { throw new Error('forbidden'); }
    const matches = (ref: types.agent.ResultRef) => !opts.ref || (ref.version === opts.ref.version && ref.id === opts.ref.id && ref.ownerAgentId === opts.ref.ownerAgentId && ref.sha256 === opts.ref.sha256 && ref.bytes === opts.ref.bytes && ref.kind === opts.ref.kind);
    const messages = await ctx.fns.session.getFullMessages({id:caller.id});
    let ref = messages.find(message => message.result_ref?.id === id && matches(message.result_ref))?.result_ref;
    if (!ref) {
        // Resolve ownership on every read before cache or pending-load lookup.
        const rows = await ctx.fns.procs.db.select({sql:`SELECT to_jsonb(r)->'result_ref' AS ref FROM agent_trigger_runs r JOIN agent_triggers t ON t.id=r.trigger_id WHERE t.agent_id=? AND to_jsonb(r)->'result_ref'->>'id'=? LIMIT 1`,params:[caller.id,id]});
        const candidate = rows[0]?.ref as types.agent.ResultRef | undefined;
        if (candidate?.ownerAgentId === caller.id && matches(candidate)) ref = candidate;
    }
    if (!ref) throw new Error('not_found');
    validate(ref);
    const root = await ctx.fns.resultStore.root({});
    const state = ctx.state.resultStore ??= {};
    state.cache ??= new LRUCache<string,{text:string;totalChars:number}>({maxSize:64*1024*1024,maxEntrySize:8*1024*1024,ttl:120000,ttlAutopurge:true,updateAgeOnGet:true,sizeCalculation:(value,key)=>value.text.length*2+key.length*2+256});
    state.pending ??= new Map();
    const key = JSON.stringify([root,ref]);
    const cached = state.cache.get(key); if (cached) return cached;
    const pending = state.pending.get(key); if (pending) return pending;
    const load = (async () => {
     const path = join(root,ref.ownerAgentId,ref.id+'.json');
     let handle;
     try {
     const canonicalRoot = await realpath(root);
     const canonicalPath = await realpath(path);
     if (!canonicalPath.startsWith(canonicalRoot+sep) || canonicalPath !== join(canonicalRoot,ref.ownerAgentId,ref.id+'.json')) throw new Error('corrupt');
     const fs = await import('node:fs');
     handle = await open(path,fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
     const stat = await handle.stat();
     if (!stat.isFile()) throw new Error('corrupt');
     if (stat.size > 200*1024*1024) throw new Error('too_large');
     const source = await handle.readFile('utf8');
     let data; try {data=JSON.parse(source);} catch (cause) {throw new Error('corrupt', {cause});}
     if (data.version!==1 || data.id!==ref.id || data.ownerAgentId!==ref.ownerAgentId || data.kind!==ref.kind || typeof data.text!=='string' || !Number.isFinite(data.createdAt)) throw new Error('corrupt');
     if (Buffer.byteLength(data.text,'utf8')!==ref.bytes || createHash('sha256').update(data.text).digest('hex')!==ref.sha256) throw new Error('corrupt');
     const result = {text:data.text,totalChars:data.text.length};
     state.cache!.set(key,result); return result;
     } catch (error) {if ((error as NodeJS.ErrnoException).code==='ENOENT') throw new Error('not_found'); throw error;}
     finally {await handle?.close();}
    })();
    state.pending.set(key,load);
    try {return await load;} finally {state.pending.delete(key);}
}
