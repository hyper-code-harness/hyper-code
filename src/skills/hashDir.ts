/**
 * Lists the files of one skill folder and computes its content hash in the `computedHash` format of `npx skills`
 *
 * Use to pin an installed skill in the skills lock and to tell later whether its folder changed. The hash is a SHA-256
 * over the files sorted by the bytes of their relative path; each file contributes its path, a NUL, the content length
 * in bytes as decimal text, a NUL, and the content, with CRLF turned into LF in text files (files without a NUL byte).
 * `.git`, `node_modules`, `__pycache__`, `__pypackages__` and `metadata.json` are left out, as that installer does.
 * Symbolic links are not followed: they are returned in `links` for the caller to refuse or ignore.
 * @param opts.dir Absolute folder of the skill.
 */
export default async function (_ctx: Context, _session: Session | null, opts: {
    /** Absolute folder of the skill. */
    dir: string;
}): Promise<{ hash: string; files: string[]; bytes: number; links: string[] }> {
    const fs = await import("node:fs/promises");
    const { join, isAbsolute } = await import("node:path");
    if (!isAbsolute(opts.dir)) throw new Error("skills.hashDir: an absolute folder is required");
    const SKIP = new Set([".git", "node_modules", "__pycache__", "__pypackages__"]);
    const files: string[] = [];
    const links: string[] = [];
    const walk = async (dir: string, rel: string): Promise<void> => {
        for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
            if (SKIP.has(entry.name)) continue;
            const item = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.isSymbolicLink()) { links.push(item); continue; }
            if (entry.isDirectory()) { if (item.split("/").length < 12) await walk(join(dir, entry.name), item); continue; }
            if (!entry.isFile() || entry.name === "metadata.json") continue;
            files.push(item);
            if (files.length > 5000) throw new Error("skills.hashDir: more than 5000 files");
        }
    };
    await walk(opts.dir, "");
    files.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    const hash = new Bun.CryptoHasher("sha256");
    let bytes = 0;
    for (const file of files) {
        let content: Buffer = await fs.readFile(join(opts.dir, file));
        if (!content.includes(0)) content = Buffer.from(content.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
        bytes += content.length;
        hash.update(file).update("\0").update(String(content.length)).update("\0").update(content);
    }
    return { hash: hash.digest("hex"), files, bytes, links: links.sort() };
}
