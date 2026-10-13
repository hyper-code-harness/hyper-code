/**
 * Copies a trusted mounted local source into an inert SHA256-pinned candidate
 *
 * Revalidates configured mounted source identity and content before and after bounded no-follow reads. Rejects dependency or script trees. Copies into an empty external staging directory, never loads or changes source mounts.
 * @param opts.selection Filesystem selection with canonical source.path and content SHA256 revision.
 * @param opts.destination Existing empty canonical absolute staging directory outside source and automatic mounts.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Filesystem selection with canonical source.path and content SHA256 revision. */
        selection: types.plugins.ProviderSelection;
        /** Existing empty canonical absolute staging directory outside source and automatic mounts. */
        destination: string;
    },
): Promise<{path:string}> {
    const fs=await import('node:fs/promises');const path=await import('node:path');const constants=(await import('node:fs')).constants;const s=opts.selection;const source=s.source.path;if(s.provider!=='filesystem'||typeof source!=='string'||!path.isAbsolute(source)||await fs.realpath(source)!==source||!/^[0-9a-f]{64}$/.test(s.revision))throw new Error('Invalid pinned local selection');let trusted=false;for(const m of ctx.state.procs.modules){if(m.self)continue;if(await fs.realpath(m.dir)===source)trusted=true;}if(!trusted)throw new Error('Local source is not a trusted mounted root');const destination=opts.destination;if(!path.isAbsolute(destination)||await fs.realpath(destination)!==destination||destination===source||destination.startsWith(source+path.sep)||(await fs.readdir(destination)).length)throw new Error('Empty external canonical stage required');if(ctx.env.USER_PLUGINS){const mount=await fs.realpath(ctx.env.USER_PLUGINS);if(destination===mount||destination.startsWith(mount+path.sep))throw new Error('Candidate must be outside automatic mounts');}const before=await ctx.fns.plugins.validateTree({dir:source});if(before.name!==s.name||before.digest!==s.revision)throw new Error('Local source changed since selection');let total=0;for(const file of before.files){const original=path.join(source,file);if(await fs.realpath(original)!==original)throw new Error('Source path changed');const handle=await fs.open(original,constants.O_RDONLY|constants.O_NOFOLLOW);let data:Buffer;try{const st=await handle.stat();if(!st.isFile()||st.size>2000000)throw new Error('Source file changed');data=await handle.readFile();if(data.length>2000000||(total+=data.length)>20000000)throw new Error('Source exceeds bounds');}finally{await handle.close();}const target=path.join(destination,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,data,{flag:'wx'});}const copied=await ctx.fns.plugins.validateTree({dir:destination});const after=await ctx.fns.plugins.validateTree({dir:source});if(copied.digest!==s.revision||after.digest!==s.revision)throw new Error('Local source changed while copying');return {path:destination};
}
