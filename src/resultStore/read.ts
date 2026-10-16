/**
 * Read and verify an authorized immutable result through bounded TTL LRU memory
 *
 * Storage primitive that independently authorizes references against the calling agent's visible history before every cache access. Verifies metadata, UTF-8 bytes and SHA-256, limits serialized reads to 200 MiB, and deduplicates concurrent loads. Cache is process state only; two-minute idle TTL, 64 MiB accounting and 8 MiB per entry, never scratchpad.
 * @param opts.ref Already authorized structured message reference. Never accept an untrusted path.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Already authorized structured message reference. Never accept an untrusted path. */
        ref: types.agent.ResultRef;
    },
): Promise<{text:string;totalChars:number}> {
    const { LRUCache } = await import('lru-cache');
    const { open, realpath } = await import('node:fs/promises');
    const { join, sep } = await import('node:path');
    const { createHash } = await import('node:crypto');
    const ref = opts.ref;
    if (ref.version !== 1 || !/^[a-zA-Z0-9_-]{1,128}$/.test(ref.ownerAgentId) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(ref.id) || !/^[a-f0-9]{64}$/.test(ref.sha256) || !Number.isSafeInteger(ref.bytes) || ref.bytes < 0) throw new Error('corrupt');
    if (ref.bytes > 32 * 1024 * 1024) throw new Error('too_large');
    const caller = await ctx.fns.agent.current({});
    const messages = await ctx.fns.session.getFullMessages({id:caller.id});
    let authorized = messages.some((message) => {
        const visible = message.result_ref;
        return visible?.version === ref.version && visible.id === ref.id && visible.ownerAgentId === ref.ownerAgentId && visible.sha256 === ref.sha256 && visible.bytes === ref.bytes && visible.kind === ref.kind;
    });
    if (!authorized && ref.ownerAgentId === caller.id) {
        // Recheck durable ownership before cache/pending lookup; an owner string alone is not a grant.
        const rows = await ctx.fns.procs.db.select({sql:`SELECT 1 FROM agent_trigger_runs r JOIN agent_triggers t ON t.id=r.trigger_id WHERE t.agent_id=? AND to_jsonb(r)->'result_ref'=?::jsonb LIMIT 1`,params:[caller.id,JSON.stringify(ref)]});
        authorized = rows.length > 0;
    }
    if (!authorized) throw new Error('not_found');
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
