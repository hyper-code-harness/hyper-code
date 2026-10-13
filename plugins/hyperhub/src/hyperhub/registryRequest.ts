/**
 * Fetches bounded JSON metadata from a credential-free HTTPS registry
 *
 * Registry client using existing network identity, no secret values. Repository status is read-only; createRepo requires explicit confirmation and uses the idempotent empty-body repository API. Enforces a 15-second total timeout, 2,000,000-byte streamed body cap, no redirects, JSON media type and object response; never executes plugin code.
 * @param opts.baseUrl HTTPS origin without path, credentials, query or fragment.
 * @param opts.action Metadata lookup, repository status, or explicitly confirmed repository creation.
 * @param opts.repo Repository; required except for search.
 * @param opts.name Plugin name; required for get/resolve.
 * @param opts.commit Full 40 or 64 hex commit for resolve.
 * @param opts.q Search query text.
 * @param opts.limit Maximum search results; omitted uses the server default. @minimum 1 @maximum 200
 * @param opts.confirmed Explicit human authorization for createRepo. @default false
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** HTTPS origin without path, credentials, query or fragment. */
        baseUrl: string;
        /** Metadata lookup, repository status, or explicitly confirmed repository creation. */
        action: "search" | "get" | "resolve" | "repoStatus" | "createRepo";
        /** Repository; required except for search. */
        repo?: string;
        /** Plugin name; required for get/resolve. */
        name?: string;
        /** Full 40 or 64 hex commit for resolve. */
        commit?: string;
        /** Search query text. */
        q?: string;
        /** Maximum search results; omitted uses the server default. @minimum 1 @maximum 200 */
        limit?: number;
        /** Explicit human authorization for createRepo. @default false */
        confirmed?: boolean;
    },
): Promise<Record<string, unknown>> {
    let base: URL;
    try { base = new URL(opts.baseUrl); } catch { throw new Error('Use a credential-free HTTPS origin'); }
    if(base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || opts.baseUrl.includes('?') || opts.baseUrl.includes('#')) throw new Error('Use a credential-free HTTPS origin');
    if(!['search','get','resolve','repoStatus','createRepo'].includes(opts.action)) throw new Error('Invalid registry action');
    if(['get','resolve'].includes(opts.action) && (!opts.repo?.trim() || !opts.name?.trim())) throw new Error('Registry repo and name are required');
    if(opts.commit !== undefined && !/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(opts.commit)) throw new Error('Registry commit must be full hexadecimal commit');
    const repositoryAction = opts.action === 'repoStatus' || opts.action === 'createRepo';
    if(repositoryAction && (!opts.repo || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9._-]*)*$/.test(opts.repo) || opts.repo.length > 240)) throw new Error('Invalid repo');
    if(opts.action === 'createRepo' && opts.confirmed !== true) throw new Error('Repository creation requires explicit confirmation');
    const url = new URL(opts.action === 'createRepo' ? '/api/repos/'+opts.repo : opts.action === 'repoStatus' ? '/git/'+opts.repo+'.git/info/refs?service=git-upload-pack' : '/api/registry/'+opts.action,base);
    const keys = opts.action === 'search' ? ['repo','q'] as const : opts.action === 'resolve' ? ['repo','name','commit'] as const : ['repo','name'] as const;
    if(!repositoryAction) for(const key of keys) { const value = opts[key]; if(value !== undefined) url.searchParams.set(key, key === 'commit' ? value.toLowerCase() : value); }
    if(opts.limit !== undefined && (!Number.isInteger(opts.limit) || opts.limit < 1 || opts.limit > 200)) throw new Error('Registry limit must be an integer between 1 and 200');
    if(opts.action === 'search' && opts.limit !== undefined) url.searchParams.set('limit', String(opts.limit));
    const signal = AbortSignal.timeout(15_000);
    let cleanup: (() => Promise<void>) | undefined;
    let abortListener: (() => void) | undefined;
    const deadline = new Promise<never>((_,reject) => { abortListener = () => reject(new Error('Registry request timed out')); signal.addEventListener('abort',abortListener,{once:true}); });
    try {
     const response = await Promise.race([fetch(url,{method:opts.action === 'createRepo' ? 'POST' : 'GET',redirect:'error',credentials:'omit',headers:{Accept:opts.action === 'repoStatus' ? 'application/x-git-upload-pack-advertisement' : 'application/json'},signal}),deadline]);
     cleanup = async () => { await response.body?.cancel(); };
     if(opts.action === 'repoStatus') {
         if(response.redirected) throw new Error('Registry redirect rejected');
         if(response.status === 404) return {exists:false};
         if(response.status !== 200) throw new Error('Registry HTTP '+response.status);
         if(response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/x-git-upload-pack-advertisement') throw new Error('Invalid Git discovery response');
         return {exists:true};
     }
     if(!response.ok || response.redirected) throw new Error('Registry HTTP '+response.status);
     if(response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw new Error('Registry response must be application/json');
     const length = response.headers.get('content-length');
     if(length !== null && /^\d+$/.test(length) && Number(length)>2_000_000) throw new Error('Registry response too large');
     if(!response.body) throw new Error('Invalid registry response: missing body');
     const reader = response.body.getReader();
     cleanup = async () => { try { await reader.cancel(); } finally { reader.releaseLock(); } };
     const chunks: Uint8Array[] = []; let size=0;
     while(true) { const {done,value}=await Promise.race([reader.read(),deadline]); if(done)break; size+=value.byteLength; if(size>2_000_000)throw new Error('Registry response too large'); chunks.push(value); }
     const bytes=new Uint8Array(size); let offset=0; for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
     let data: unknown;
     try { data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); } catch { throw new Error('Invalid registry response: malformed JSON or UTF-8'); }
     if(!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid registry response: expected object');
     return data as Record<string,unknown>;
    } finally {
     if(abortListener)signal.removeEventListener('abort',abortListener);
     if(cleanup)void cleanup().catch(() => { /* Cleanup must not replace the original error or extend the deadline. */ });
    }
}
