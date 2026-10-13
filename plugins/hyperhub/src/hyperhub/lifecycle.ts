/**
 * Stages and approves a pinned installation update or saved-snapshot rollback
 *
 * Shared serialized backend for install, update and rollback. Performs bounded structural validation, destination-bound digest approval and local drift protection. Snapshots live outside automatic mounts. Runtime load failures retain actual installed disk state and report errors; code side effects cannot be undone.
 * @param opts.operation Lifecycle action whose preview must be explicitly approved.
 * @param opts.baseUrl Exact credential-free HTTPS registry origin in provenance.
 * @param opts.repo Exact registry repository identity.
 * @param opts.name Unscoped lowercase installed plugin directory name.
 * @param opts.commit Immutable forty or sixty-four hexadecimal destination commit.
 * @param opts.confirmed True only after explicit human approval to run trusted plugin code. @default false
 * @param opts.expectedDigest Exact destination-bound digest returned by the reviewed preview.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Lifecycle action whose preview must be explicitly approved. */
        operation: 'install'|'update'|'rollback';
        /** Exact credential-free HTTPS registry origin in provenance. */
        baseUrl: string;
        /** Exact registry repository identity. */
        repo: string;
        /** Unscoped lowercase installed plugin directory name. */
        name: string;
        /** Immutable forty or sixty-four hexadecimal destination commit. */
        commit: string;
        /** True only after explicit human approval to run trusted plugin code. @default false */
        confirmed?: boolean;
        /** Exact destination-bound digest returned by the reviewed preview. */
        expectedDigest?: string;
    },
): Promise<{name:string;src:string;files:string[];digest:string;commit:string;activated:boolean;destination:string;previousCommit?:string;diff:{added:string[];removed:string[];changed:string[]};loadError?:string;status:string;review:{files:Array<{path:string;text:string;truncated:boolean}>;truncated:boolean}}> {
    const origin=new URL(opts.baseUrl);
    if(origin.protocol!=='https:'||origin.username||origin.password||origin.href!==origin.origin+'/')throw new Error('Credential-free HTTPS origin required');
    if(!/^[a-z][a-z0-9-]{0,63}$/.test(opts.name)||opts.repo.length>240||!/^[a-zA-Z0-9][a-zA-Z0-9_-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9._-]*)*$/.test(opts.repo)||!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(opts.commit))throw new Error('Unsafe name, repo or commit');
    let source:Record<string,string>={baseUrl:opts.baseUrl,repo:opts.repo};
    if(opts.operation!=='install'){
        const inventory=await ctx.fns.plugins.installed({});
        const current=inventory.plugins.find(p=>p.name===opts.name)?.selection;
        if(current?.provider==='hyperhub'&&current.source.baseUrl===opts.baseUrl&&current.source.repo===opts.repo)source={...current.source};
    }
    return await ctx.fns.plugins.lifecycle({operation:opts.operation,selection:{provider:'hyperhub',name:opts.name,revision:opts.commit,source},confirmed:opts.confirmed,expectedDigest:opts.expectedDigest});
}
