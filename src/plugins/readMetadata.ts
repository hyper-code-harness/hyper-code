/**
 * Reads bounded regular-file JSON metadata without following links
 *
 * Read-only structural safety validation for managed plugin copies. No code execution or dependency installation; this is not a sandbox.
 * @param opts.path Absolute local metadata file or plugin tree path.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Absolute local metadata file or plugin tree path. */
        path: string;
    },
): Promise<Record<string, types.plugins.LifecycleJson>> {
    const fs=await import('node:fs/promises');const constants=(await import('node:fs')).constants;
        const handle=await fs.open(opts.path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=await handle.stat();if(!stat.isFile()||stat.size>65536)throw new Error('Invalid metadata file');const data=await handle.readFile();if(data.length>65536)throw new Error('Metadata too large');const parsed=JSON.parse(data.toString());if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('Invalid metadata');return parsed;}finally{await handle.close();}
}
