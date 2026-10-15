/**
 * Persist immutable full tool output before publishing its message reference
 *
 * Writes a private JSON result file under the instance root with exclusive temporary creation, file and directory sync and atomic publication. Returns a verified content reference; throws on failure so callers must publish an honest storage-failure preview.
 * @param opts.ownerAgentId Agent owning this new tool output; restricted to safe identifier characters.
 * @param opts.kind Tool operation label stored as metadata.
 * @param opts.text Full unparsed tool output string; maximum UTF-8 size is 32 MiB.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Agent owning this new tool output; restricted to safe identifier characters. */
        ownerAgentId: string;
        /** Tool operation label stored as metadata. */
        kind: string;
        /** Full unparsed tool output string; maximum UTF-8 size is 32 MiB. */
        text: string;
    },
): Promise<types.agent.ResultRef> {
    const { mkdir, open, rename, unlink, lstat, realpath } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { createHash, randomUUID } = await import('node:crypto');
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(opts.ownerAgentId)) throw new Error('invalid ownerAgentId');
    const bytes = Buffer.byteLength(opts.text, 'utf8');
    if (bytes > 32 * 1024 * 1024 || opts.kind.length > 1024) throw new Error('too_large');
    const root = await ctx.fns.resultStore.root({});
    await mkdir(root, {recursive:true, mode:0o700});
    // The configured root is trusted instance configuration; child directories must stay inside its canonical target.
    const canonicalRoot = await realpath(root);
    const dir = join(canonicalRoot, opts.ownerAgentId);
    await mkdir(dir, {recursive:true, mode:0o700});
    if ((await lstat(dir)).isSymbolicLink() || await realpath(dir) !== dir) throw new Error('invalid owner directory');
    const id = randomUUID();
    const ref: types.agent.ResultRef = {version:1,id,ownerAgentId:opts.ownerAgentId,bytes,sha256:createHash('sha256').update(opts.text).digest('hex'),kind:opts.kind};
    const tmp = join(dir, '.' + id + '.tmp');
    const final = join(dir, id + '.json');
    let published = false;
    try {
     const file = await open(tmp, 'wx', 0o600);
     try { await file.writeFile(JSON.stringify({version:1,id,ownerAgentId:opts.ownerAgentId,createdAt:Date.now(),kind:opts.kind,text:opts.text})); await file.sync(); } finally { await file.close(); }
     await rename(tmp, final); published = true;
     const directory = await open(dir, 'r'); try {await directory.sync();} finally {await directory.close();}
     return ref;
    } finally {if (!published) await unlink(tmp).catch((error: NodeJS.ErrnoException) => {if (error.code !== 'ENOENT') console.warn('result temp cleanup failed', error.message);});}
}
