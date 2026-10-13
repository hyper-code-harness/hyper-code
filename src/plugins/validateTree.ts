/**
 * Validates bounded plugin trees and computes provenance-independent content SHA256
 *
 * Read-only structural safety validation for managed plugin copies. No code execution or dependency installation; this is not a sandbox.
 * @param opts.dir Absolute local metadata file or plugin tree path.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Absolute local metadata file or plugin tree path. */
        dir: string;
    },
): Promise<{name:string;src:string;files:string[];digest:string}> {
    const fs=await import('node:fs/promises'); const path=await import('node:path');
            if(!path.isAbsolute(opts.dir))throw new Error('Absolute directory required'); const root=await fs.realpath(opts.dir); const files:string[]=[]; let bytes=0; let entries=0; let actualBytes=0;const hash=new Bun.CryptoHasher('sha256');
            async function walk(dir:string,rel:string){ for(const entry of await fs.readdir(dir,{withFileTypes:true})){ if(++entries>2500 || rel.split('/').length>20 || /[\\\x00-\x1f\x7f]/.test(entry.name))throw new Error('Unsafe or excessive tree entries'); const item=rel?rel+'/'+entry.name:entry.name; if(entry.name.toLowerCase()==='.git' || entry.name.toLowerCase()==='node_modules')throw new Error('Embedded repository or node_modules is not allowed'); if(entry.name.startsWith('.env') || /(?:^id_rsa$|\.pem$|\.key$)/i.test(entry.name))throw new Error('Potential credential file: '+item); const full=path.join(dir,entry.name); const stat=await fs.lstat(full); if(stat.isSymbolicLink() || (!stat.isDirectory()&&!stat.isFile()))throw new Error('Only regular files and directories allowed: '+item); if(stat.isDirectory())await walk(full,item); else { if(stat.size>2_000_000 || (bytes+=stat.size)>20_000_000 || files.length>=2000)throw new Error('Plugin exceeds file/size limits'); if(item!=='.hyperhub-lock.json' && item!=='.plugin-lock.json')files.push(item); } } }
            await walk(root,''); const locks=await Promise.all(['.hyperhub-lock.json','.plugin-lock.json'].map(file=>fs.lstat(path.join(root,file)).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;})));if(locks.every(Boolean))throw new Error('Conflicting provenance files');const constants=(await import('node:fs')).constants;let manifest='';files.sort();for(const file of files){const full=path.join(root,file);if(await fs.realpath(full)!==full)throw new Error('Tree path changed');const handle=await fs.open(full,constants.O_RDONLY|constants.O_NOFOLLOW);let data:Buffer;try{const st=await handle.stat();if(!st.isFile()||st.size>2_000_000)throw new Error('Tree file changed');data=await handle.readFile();}finally{await handle.close();}if(data.length>2_000_000 || (actualBytes+=data.length)>20_000_000)throw new Error('Plugin changed beyond size limits');hash.update(file+'\0');hash.update(data);hash.update('\0');if(file==='package.json')manifest=data.toString('utf8');}
            if(!files.includes('package.json')||!files.includes('SKILL.md'))throw new Error('package.json and SKILL.md are required');
            const pkg=JSON.parse(manifest);if(typeof pkg.name!=='string'|| !/^[a-z][a-z0-9-]{0,63}$/.test(pkg.name))throw new Error('MVP plugin name must be an unscoped lowercase basename');if(!pkg.procs || typeof pkg.procs!=='object'||Array.isArray(pkg.procs))throw new Error('Plugin needs a procs manifest');if(pkg.procs.modules || pkg.procs.path || pkg.procs.registry || pkg.proc)throw new Error('Host or multi-plugin manifest cannot be installed as a plugin');
            for(const key of ['dependencies','devDependencies','optionalDependencies','peerDependencies','scripts'])if(pkg[key] && Object.keys(pkg[key]).length)throw new Error('Managed copies do not support dependencies or package scripts; use configured local mounts instead');
            const src=pkg.procs.src??'src';if(typeof src!=='string'|| !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(src))throw new Error('Unsafe procs.src');if(!files.some(file=>file.startsWith(src+'/')))throw new Error('Plugin source directory missing or empty');return {name:pkg.name,src,files,digest:hash.digest('hex')};
}
