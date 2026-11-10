/**
 * Reads a plugin package that bun installed and checks it is a single safe Hyper plugin
 *
 * Use on node_modules/<name> of a staged plugin host before activation. Checks the manifest (lowercase unscoped name,
 * procs block, safe procs.src, no install lifecycle scripts, procs.requires naming other plugins), refuses symlinks, special files, credential-like files and
 * excessive trees, and returns namespaces, files and a content SHA-256. npm dependencies are allowed — bun installs
 * them beside the plugin with scripts disabled — so node_modules, .git and bun's .bun-tag marker are not read.
 * Structural only: it is not a sandbox and does not audit code.
 * @param opts.dir Absolute directory of the installed package.
 */
export default async function (ctx: Context, session: Session | null, opts: {
    /** Absolute directory of the installed package. */
    dir: string;
}): Promise<types.plugins.PackageInspection> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    if (!path.isAbsolute(opts.dir)) throw new Error('Absolute directory required');
    const root = opts.dir;
    if ((await fs.lstat(root)).isSymbolicLink()) throw new Error('Linked package is not a managed plugin');
    const SKIP = new Set(['node_modules', '.git', '.bun-tag']);
    const files: string[] = [];
    let bytes = 0;
    async function walk(dir: string, rel: string): Promise<void> {
        for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
            if (!rel && SKIP.has(entry.name)) continue;
            const item = rel ? rel + '/' + entry.name : entry.name;
            if (/[\\\x00-\x1f\x7f]/.test(entry.name) || item.split('/').length > 20)
                throw new Error('Unsafe path: ' + item);
            if (entry.name.startsWith('.env') || /(?:^id_rsa$|\.pem$|\.key$)/i.test(entry.name))
                throw new Error('Potential credential file: ' + item);
            const stat = await fs.lstat(path.join(dir, entry.name));
            if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
                throw new Error('Only regular files and directories allowed: ' + item);
            if (stat.isDirectory()) {
                await walk(path.join(dir, entry.name), item);
                continue;
            }
            if (stat.size > 2_000_000 || (bytes += stat.size) > 20_000_000 || files.length >= 2000)
                throw new Error('Plugin exceeds file/size limits');
            files.push(item);
        }
    }
    await walk(root, '');
    files.sort();
    if (!files.includes('package.json')) throw new Error('package.json is required');
    const hash = new Bun.CryptoHasher('sha256');
    for (const file of files) hash.update(file + '\0').update(await fs.readFile(path.join(root, file))).update('\0');
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    if (typeof pkg.name !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(pkg.name))
        throw new Error('Plugin name must be lowercase and unscoped');
    const procs = pkg.procs;
    if (!procs || typeof procs !== 'object' || Array.isArray(procs) || pkg.proc)
        throw new Error('Plugin needs a procs manifest');
    if (procs.modules || procs.path || procs.registry || procs.plugins)
        throw new Error('Host or multi-plugin manifest cannot be installed as a plugin');
    const lifecycle = ['preinstall', 'install', 'postinstall', 'prepare', 'preprepare', 'postprepare', 'prepack', 'postpack', 'prepublish'];
    if (Object.keys(pkg.scripts ?? {}).some(k => lifecycle.includes(k)))
        throw new Error('Install lifecycle scripts are not allowed');
    const requires = procs.requires ?? [];
    if (!Array.isArray(requires) || requires.some((r: unknown) => typeof r !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(r) || r === pkg.name))
        throw new Error('procs.requires must list other plugin names');
    const src = procs.src ?? 'src';
    if (typeof src !== 'string' || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(src))
        throw new Error('Unsafe procs.src');
    const namespaces = [...new Set(files.filter(f => f.startsWith(src + '/')).map(f => f.slice(src.length + 1).split('/')))]
        .filter(parts => parts.length > 1).map(parts => parts[0]!);
    const unique = [...new Set(namespaces)].sort();
    if (!unique.length) throw new Error('Plugin source directory missing or empty');
    for (const ns of unique)
        if (!/^[a-zA-Z_$][\w$]*$/.test(ns) || ns === 'procs') throw new Error('Invalid or reserved namespace: ' + ns);
    const dependencies: Record<string, string> = {};
    for (const [name, spec] of Object.entries(pkg.dependencies ?? {})) dependencies[name] = String(spec);
    return {
        name: pkg.name,
        ...(typeof pkg.version === 'string' ? { version: pkg.version } : {}),
        src, namespaces: unique, files, dependencies, requires: [...new Set(requires as string[])].sort(), digest: hash.digest('hex'),
    };
}
