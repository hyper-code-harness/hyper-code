/**
 * Previews or publishes one validated plugin at plugins/<name>/, preserving all root and sibling files.
 * Use preview first, then confirm its digest: it binds source path/content, target subtree, creation intent, remote main commit/tree and exact subtree removals. Only confirmed calls can create a repository or push; staging never touches the source parent. Updates preserve history with ordinary fast-forward pushes, never force. Legacy standalone root plugins remain readable but publishing into them is rejected: migrate explicitly outside this operation.
 * @param opts.dir Absolute local plugin directory containing the complete replacement snapshot.
 * @param opts.baseUrl Credential-free HTTPS Hyper-git origin.
 * @param opts.repo Hyper-git repository identifier.
 * @param opts.confirmed Explicit human approval of this preview. @default false
 * @param opts.expectedDigest Reviewed preview digest, required for publication.
 * @param opts.createRepo Allow creating a missing repository after confirmation. @default false
 */
export default async function (ctx: Context, session: Session | null, opts: {
    /** Absolute local plugin directory containing the complete replacement snapshot. */
    dir: string;
    /** Credential-free HTTPS Hyper-git origin. */
    baseUrl: string;
    /** Hyper-git repository identifier. */
    repo: string;
    /** Explicit human approval of this preview. @default false */
    confirmed?: boolean;
    /** Reviewed preview digest, required for publication. */
    expectedDigest?: string;
    /** Allow creating a missing repository after confirmation. @default false */
    createRepo?: boolean;
}): Promise<{name:string;files:string[];digest:string;remote:string;branch:string;published:boolean;commit:string|null;baseCommit:string|null;repositoryExists:boolean;createRepo:boolean;removedFiles:string[];targetPath:string;baseTree:string|null}>  {
    const fs = await import('node:fs/promises'), path = await import('node:path'), os = await import('node:os');
    const url = new URL(opts.baseUrl);
    if(url.protocol !== 'https:' || url.username || url.password || opts.baseUrl.includes('?') || opts.baseUrl.includes('#') || url.pathname !== '/') throw new Error('Credential-free HTTPS origin required');
    if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9._-]*)*$/.test(opts.repo) || opts.repo.length > 240) throw new Error('Invalid repo');
    if(!path.isAbsolute(opts.dir) || (await fs.lstat(opts.dir)).isSymbolicLink()) throw new Error('Absolute non-symlink source directory required');
    const source = await fs.realpath(opts.dir), remote = new URL('/git/'+opts.repo+'.git',url).href;
    const v = await ctx.fns.hyperhub.validateTree({dir:source});
    if(!/^[a-z][a-z0-9-]{0,63}$/.test(v.name)) throw new Error('Invalid plugin name');
    const targetPath = 'plugins/'+v.name, prefix = targetPath+'/';
    const status = await ctx.fns.hyperhub.registryRequest({baseUrl:url.origin,action:'repoStatus',repo:opts.repo});
    if(typeof status.exists !== 'boolean') throw new Error('Invalid repository status');
    const repositoryExists = status.exists;
    if(!repositoryExists && !opts.createRepo) throw new Error('Repository missing; preview with createRepo to authorize creation');
    const stage = await fs.mkdtemp(path.join(os.tmpdir(),'hyper-plugin-publish-'));
    try {
        const git = (args:string[],dir=stage) => ctx.fns.hyperhub.command({dir,args});
        const head = async ():Promise<string|null> => {
            const refs = await git(['ls-remote','--heads','--',remote]);
            if(!refs.trim()) return null;
            const lines = refs.trim().split('\n').map(line => line.trim().split(/\s+/));
            if(lines.some(row => row.length !== 2 || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(row[0]!))) throw new Error('Invalid remote refs');
            const main = lines.find(row => row[1] === 'refs/heads/main');
            if(!main) throw new Error('Nonempty repository has no main branch; refusing to replace it');
            return main[0]!;
        };
        const baseCommit = repositoryExists ? await head() : null;
        let removedFiles:string[] = [], baseTree:string|null = null;
        if(baseCommit) {
            const base = path.join(stage,'base');
            await fs.mkdir(base);
            await git(['init','--initial-branch=main'],base);
            await git(['fetch','--no-tags','--',remote,'refs/heads/main'],base);
            if(await git(['rev-parse','FETCH_HEAD'],base) !== baseCommit) throw new Error('Remote changed during preview; review again');
            baseTree = await git(['rev-parse',baseCommit+'^{tree}'],base);
            const tree = (await git(['ls-tree','-r','-z','--name-only',baseCommit],base)).split('\0').filter(Boolean);
            if(tree.includes('package.json') && tree.includes('SKILL.md')) {
                const manifest = JSON.parse(await git(['show',baseCommit+':package.json'],base));
                if(manifest.procs) throw new Error('Legacy root plugin repository: explicit migration required before publishing');
            }
            if(tree.includes('plugins') || tree.includes(targetPath)) throw new Error('Plugin subtree conflicts with a remote file or link');
            if(tree.includes(prefix+'package.json')) {
                const manifest = JSON.parse(await git(['show',baseCommit+':'+prefix+'package.json'],base));
                if(manifest.name !== v.name) throw new Error('Remote plugin subtree manifest name mismatch');
            }
            removedFiles = tree.filter(file => file.startsWith(prefix) && !v.files.includes(file.slice(prefix.length))).sort();
        }
        const digest = new Bun.CryptoHasher('sha256').update(JSON.stringify(['publish-v3',source,remote,'main',v.name,targetPath,v.digest,repositoryExists,baseCommit,baseTree,removedFiles,!!opts.createRepo])).digest('hex');
        const snapshot = path.join(stage,'snapshot');
        await fs.cp(source,snapshot,{recursive:true,dereference:false,filter:entry => entry !== path.join(source,'.hyperhub-lock.json')});
        const copied = await ctx.fns.hyperhub.validateTree({dir:snapshot});
        if(copied.digest !== v.digest) throw new Error('Source changed during preview');
        let commit:string|null = null;
        if(opts.confirmed) {
            if(!opts.expectedDigest || opts.expectedDigest !== digest) throw new Error('Preview digest mismatch; review again');
            if(!repositoryExists) {
                await ctx.fns.hyperhub.registryRequest({baseUrl:url.origin,action:'createRepo',repo:opts.repo,confirmed:true});
                if(await head() !== null) throw new Error('Remote changed after preview; review again');
            }
            const work = path.join(stage,'work');
            await fs.mkdir(work);
            await git(['init','--initial-branch=main'],work);
            if(baseCommit) {
                await git(['fetch','--no-tags','--',remote,'refs/heads/main'],work);
                if(await git(['rev-parse','FETCH_HEAD'],work) !== baseCommit) throw new Error('Remote changed after preview; review again');
                // read-tree carries the parent tree without checking out untrusted remote files.
                await git(['update-ref','refs/heads/main',baseCommit],work);
                await git(['read-tree',baseCommit],work);
            }
            await fs.mkdir(path.join(work,'plugins'),{recursive:true});
            await fs.cp(snapshot,path.join(work,targetPath),{recursive:true,dereference:false});
            // Keep the complete remote index; remove only reviewed paths in this plugin subtree.
            for(const file of removedFiles) await git(['update-index','--force-remove','--',file],work);
            // Bypass ignore rules, clean filters and attributes: publish exactly reviewed bytes.
            for(const file of v.files) {
                const blob = await git(['hash-object','-w','--no-filters','--',prefix+file],work);
                await git(['update-index','--add','--cacheinfo','100644',blob,prefix+file],work);
            }
            // Empty commits still produce an auditable publication receipt.
            await git(['-c','user.name=Hyper Plugin Publisher','-c','user.email=plugins@localhost','-c','commit.gpgsign=false','commit','--allow-empty','-m','Publish plugin '+v.name],work);
            commit = await git(['rev-parse','HEAD'],work);
            if(await head() !== baseCommit) throw new Error('Remote changed after preview; review again');
            await git(['push','--porcelain','--',remote,'HEAD:refs/heads/main'],work);
        }
        return {name:v.name,files:v.files,digest,remote,branch:'main',published:!!opts.confirmed,commit,baseCommit,repositoryExists,createRepo:!!opts.createRepo,removedFiles,targetPath,baseTree};
    } finally { await fs.rm(stage,{recursive:true,force:true}); }
}
