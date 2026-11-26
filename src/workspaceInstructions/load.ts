/**
 * Loads bounded AGENTS.md and CLAUDE.md instructions from global and scoped workspace directories.
 *
 * Use before assembling workspace context. Discovers the nearest lexical .git boundary and tracked nested directories; keeps directory scopes, deduplicates trimmed content only within one directory and scope, budgets specific instructions first and returns broad-to-specific sources. Reads regular UTF-8 files asynchronously with a 1 MiB source cap, separate 64 KiB global/project budgets, 32 warnings and 256 KiB result cap. Instruction symlinks may target only files within their canonical directory scope; target identity is checked after opening. Remote hosts require python3 and one bounded SSH request; failures never fall back to local files. Missing optional files are ignored; I/O, malformed text, truncation and omission produce diagnostics without file contents.
 * @param opts.dir Workspace directory, resolved lexically without following symlinks for ancestor boundaries. Supports ~ and ~/; at most 4096 UTF-8 bytes.
 * @param opts.host SSH host alias; omitted or empty means local. Remote globals use the remote HOME.
 * @param opts.paths Previously successful absolute read/write/edit file paths under dir. First 64 paths add ancestor directory scopes; outside paths and nested symlink directories are ignored.
 * @param opts.maxBytes Included UTF-8 text budget for each of the global and project chains, allocated most specific first. @default 65536 @minimum 0 @maximum 65536
 * @param opts.globalDir Global instruction directory override, resolved on the selected host. Defaults to ~/.hyper; accepts only AGENTS.md and CLAUDE.md.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Workspace directory, resolved lexically without following symlinks for ancestor boundaries. Supports ~ and ~/; at most 4096 UTF-8 bytes. */
        dir: string;
        /** SSH host alias; omitted or empty means local. Remote globals use the remote HOME. */
        host?: string;
        /** Previously successful absolute read/write/edit file paths under dir. First 64 paths add ancestor directory scopes; outside paths and nested symlink directories are ignored. */
        paths?: string[];
        /** Included UTF-8 text budget for each of the global and project chains, allocated most specific first. @default 65536 @minimum 0 @maximum 65536 */
        maxBytes?: number;
        /** Global instruction directory override, resolved on the selected host. Defaults to ~/.hyper; accepts only AGENTS.md and CLAUDE.md. */
        globalDir?: string;
    },
): Promise<types.workspaceInstructions.InstructionsSnapshot> {
    const fs = await import("node:fs/promises");
    const { constants } = await import("node:fs");
    const path = await import("node:path");
    const { homedir } = await import("node:os");
    const LIMIT = 65536, SOURCE_LIMIT = 1048576, OUTPUT_LIMIT = 262144;
    const NAMES = ["AGENTS.md", "CLAUDE.md"];
    const budget = opts.maxBytes ?? LIMIT;
    if (!Number.isInteger(budget) || budget < 0 || budget > LIMIT) throw new TypeError("maxBytes must be an integer between 0 and 65536");
    if (typeof opts.dir !== "string" || !opts.dir || Buffer.byteLength(opts.dir) > 4096 || opts.dir.includes("\0")) throw new TypeError("dir must be a nonempty path of at most 4096 UTF-8 bytes without NUL");
    if (opts.globalDir !== undefined && (typeof opts.globalDir !== "string" || !opts.globalDir || Buffer.byteLength(opts.globalDir) > 4096 || opts.globalDir.includes("\0"))) throw new TypeError("globalDir must be a nonempty path of at most 4096 UTF-8 bytes without NUL");
    if (opts.host !== undefined && (typeof opts.host !== "string" || Buffer.byteLength(opts.host) > 256 || (opts.host !== "" && !/^[A-Za-z0-9._@-]+$/.test(opts.host)))) throw new TypeError("host must be an SSH alias of at most 256 bytes");
    const suppliedPaths = opts.paths ?? [];
    const inputPaths = suppliedPaths.slice(0, 64).filter(p => typeof p === "string" && Buffer.byteLength(p) <= 4096 && !p.includes("\0"));
    const initialWarnings: string[] = [];
    if (suppliedPaths.length > 64) initialWarnings.push("Tracked paths capped at 64; additional paths were omitted.");
    if (inputPaths.length !== Math.min(suppliedPaths.length, 64)) initialWarnings.push("Invalid or overlong tracked paths were omitted (4096-byte path limit).");
    const warn = (snapshot: types.workspaceInstructions.InstructionsSnapshot, text: string) => {
        const bounded = Buffer.byteLength(text) > 1024 ? new TextDecoder().decode(Buffer.from(text).subarray(0, 1000), { stream: true }) + "… (warning shortened)" : text;
        if (snapshot.warnings.length < 31) snapshot.warnings.push(bounded);
        else if (snapshot.warnings.length === 31) snapshot.warnings.push("Additional instruction warnings omitted (32-warning limit).");
    };
    const empty = (): types.workspaceInstructions.InstructionsSnapshot => ({ dir: opts.dir, host: opts.host ?? "", root: opts.dir, sources: [], warnings: [...initialWarnings] });

    // Fixed code only, isolated Python (-I): never import repository modules or PYTHONPATH.
    // User paths are JSON on stdin, never interpolated into shell/Python source.
    // Python performs discovery, bounded reads and budgeting remotely; there is no local fallback.
    const python = String.raw`
    import os,sys,json,stat,time,re
    x=json.load(sys.stdin)
    NAMES=('AGENTS.md','CLAUDE.md'); FILE=1048576; OUT=262144
    budget=x['maxBytes']; deadline=time.monotonic()+12
    s={'dir':os.path.abspath(os.path.expanduser(x['dir'])),'host':x['host'],'root':'','sources':[],'warnings':x['warnings']}
    s['root']=s['dir']
    def warn(message):
        if len(message.encode('utf-8'))>1024:message=message.encode('utf-8')[:1000].decode('utf-8',errors='ignore')+'… (warning shortened)'
        if len(s['warnings'])<31:s['warnings'].append(message)
        elif len(s['warnings'])==31:s['warnings'].append('Additional instruction warnings omitted (32-warning limit).')
    def error(action,p,e):
        warn(action+' '+p+' ('+str(getattr(e,'errno',None) or type(e).__name__)+'); check permissions and the path.')
    def check():
        if time.monotonic()>deadline:raise TimeoutError('instruction discovery deadline')
    def meta(p):
        check()
        try:return os.lstat(p)
        except FileNotFoundError:return None
        except OSError as e:error('Cannot inspect',p,e);return None
    def within(p,base):return p==base or p.startswith(base.rstrip('/')+'/')
    def depth(p):return len([v for v in p.split('/') if v])
    def trim(t):return re.sub(r'^[\u0009-\u000d \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\u0009-\u000d \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$','',t)
    def read(p):
        m=meta(p)
        if m is None:return None
        if not (stat.S_ISREG(m.st_mode) or stat.S_ISLNK(m.st_mode)):
            warn('Omitted non-regular instruction file '+p+'; use a regular UTF-8 file.');return ('',None)
        fd=None
        try:
            check();scope=os.path.realpath(os.path.dirname(p));target=os.path.realpath(p)
            if not within(target,scope):
                warn('Omitted '+p+'; symlink target escapes its instruction directory. Keep instruction links inside this scope.');return ('',None)
            expected=os.stat(target)
            fd=os.open(target,os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW)
            before=os.fstat(fd)
            if (expected.st_dev,expected.st_ino)!=(before.st_dev,before.st_ino) or os.path.realpath(target)!=target:
                warn('Omitted '+p+'; instruction target changed while opening. Retry after saving.');return ('',None)
            if not stat.S_ISREG(before.st_mode):
                warn('Omitted non-regular instruction file '+p+'; use a regular UTF-8 file.');return ('',None)
            if before.st_size>FILE:
                warn('Omitted '+p+'; source exceeds 1 MiB. Split or shorten the file.');return ('',None)
            chunks=[];total=0
            while total<=FILE:
                check();chunk=os.read(fd,min(65536,FILE+1-total))
                if not chunk:break
                chunks.append(chunk);total+=len(chunk)
            after=os.fstat(fd)
            if total>FILE:
                warn('Omitted '+p+'; source exceeds 1 MiB. Split or shorten the file.');return ('',None)
            if before.st_size!=after.st_size or before.st_mtime_ns!=after.st_mtime_ns:
                warn('Omitted '+p+'; file changed while reading. Retry after saving.');return ('',None)
            try:text=trim(b''.join(chunks).decode('utf-8'))
            except UnicodeDecodeError:
                warn('Omitted '+p+'; invalid UTF-8. Save the file as UTF-8.');return ('',None)
            return (text,str(after.st_dev)+':'+str(after.st_ino))
        except OSError as e:error('Cannot read',p,e);return ('',None)
        finally:
            if fd is not None:os.close(fd)
    def collect():
        dirs=[];cur=s['dir'];chain=[]
        for i in range(128):
            check();chain.append(cur);marker=meta(os.path.join(cur,'.git'))
            if marker and (stat.S_ISREG(marker.st_mode) or stat.S_ISDIR(marker.st_mode)):
                s['root']=cur;dirs=list(reversed(chain));break
            parent=os.path.dirname(cur)
            if parent==cur:break
            cur=parent
        else:warn('Ancestor discovery stopped at depth 128; only the workspace directory is used without a known .git boundary.')
        if not dirs:dirs=[s['dir']]
        seen=set(dirs)
        for raw in x['paths']:
            check()
            if not os.path.isabs(raw):continue
            target=os.path.normpath(raw)
            if not within(target,s['dir']) or target==s['dir']:continue
            cur=s['dir'];parts=os.path.relpath(os.path.dirname(target),cur).split(os.sep)
            if parts==['.']:continue
            if len(parts)>128:
                warn('Nested path omitted beyond depth 128: '+target);continue
            for part in parts:
                cur=os.path.join(cur,part)
                if cur in seen:continue
                if len(dirs)>=128:
                    warn('Instruction directories capped at 128; additional nested directories omitted.');break
                m=meta(cur)
                if not m:break
                if stat.S_ISLNK(m.st_mode):
                    warn('Nested symlink directory omitted: '+cur+'; use its workspace path directly.');break
                if not stat.S_ISDIR(m.st_mode):break
                seen.add(cur);dirs.append(cur)
        dirs.sort(key=lambda d:(depth(d),d))
        groups=[('global',[os.path.abspath(os.path.expanduser(x.get('globalDir') or '~/.hyper'))]),('project',dirs)]
        for scope,group in groups:
            remaining=budget;records={}
            for directory in reversed(group):
                prior=[];rows=[]
                for name in NAMES:
                    p=os.path.join(directory,name);result=read(p)
                    if result is None:continue
                    text,identity=result
                    row={'path':p,'scope':scope,'directory':directory,'content':'','status':'omitted','bytes':0};rows.append(row)
                    if identity is None:continue
                    duplicate=next((old[2] for old in prior if old[0]==identity or old[1]==text),None)
                    if duplicate:
                        row['status']='duplicate';row['duplicateOf']=duplicate;continue
                    prior.append((identity,text,p));raw=text.encode('utf-8')
                    if len(raw)<=remaining:
                        row['status']='loaded';row['content']=text;row['bytes']=len(raw)
                    elif remaining>0:
                        prefix=raw[:remaining].decode('utf-8',errors='ignore')
                        row['status']='truncated' if prefix else 'omitted';row['content']=prefix;row['bytes']=len(prefix.encode('utf-8'))
                        warn('Truncated '+p+' to the '+str(budget)+'-byte '+scope+' instruction budget; shorten broader instructions.')
                    else:warn('Omitted '+p+'; '+scope+' instruction budget of '+str(budget)+' bytes is exhausted.')
                    remaining-=row['bytes']
                records[directory]=rows
            for directory in group:s['sources'].extend(records[directory])
    try:collect()
    except (OSError,TimeoutError) as e:warn('Instruction discovery stopped; check filesystem availability and retry ('+type(e).__name__+').')
    def packet():return json.dumps({'version':1,'snapshot':s},ensure_ascii=False,separators=(',',':')).encode('utf-8')
    data=packet()
    if len(data)>OUT:
        warn('Instruction output capped at 256 KiB; broader content or source records were omitted.')
        for row in s['sources']:
            if len(packet())<=OUT:break
            if row['content']:row['content']='';row['bytes']=0;row['status']='omitted'
        while s['sources'] and len(packet())>OUT:s['sources'].pop(0)
        data=packet()
    sys.stdout.buffer.write(data)
    `.replace(/^    /gm, "");
    if (opts.host) {
        const snapshot = empty();
        try {
            const command = "python3 -I -c '" + python.replaceAll("'", "'\\''") + "'";
            const response = await ctx.fns.remote.exec({ host: opts.host, command, stdin: JSON.stringify({ dir: opts.dir, host: opts.host, paths: inputPaths, globalDir: opts.globalDir, maxBytes: budget, warnings: initialWarnings }), timeout: 15, maxOutput: OUTPUT_LIMIT });
            if (response.timedOut) { warn(snapshot, "Remote instruction discovery timed out after 15 seconds; check SSH and filesystem availability."); return snapshot; }
            if (response.exitCode !== 0) { warn(snapshot, "Remote instruction discovery failed; check SSH access and that python3 is installed on the remote host. No local instructions were loaded."); return snapshot; }
            if (Buffer.byteLength(response.stdout) > OUTPUT_LIMIT) throw new Error("protocol output limit");
            const packet = JSON.parse(response.stdout) as { version?: number; snapshot?: types.workspaceInstructions.InstructionsSnapshot };
            const value = packet.snapshot;
            if (packet.version !== 1 || !value || typeof value.dir !== "string" || !path.posix.isAbsolute(value.dir) || typeof value.root !== "string" || !path.posix.isAbsolute(value.root) || value.host !== opts.host || !Array.isArray(value.sources) || value.sources.length > 258 || !Array.isArray(value.warnings) || value.warnings.length > 32 || !value.warnings.every(w => typeof w === "string" && Buffer.byteLength(w) <= 1024)) throw new Error("protocol shape");
            const totals = { global: 0, project: 0 };
            for (const source of value.sources) {
                if (!source || !["global", "project"].includes(source.scope) || typeof source.path !== "string" || typeof source.directory !== "string" || !path.posix.isAbsolute(source.directory) || !NAMES.some(name => source.path === path.posix.join(source.directory, name)) || typeof source.content !== "string" || !["loaded", "duplicate", "omitted", "truncated"].includes(source.status) || source.bytes !== Buffer.byteLength(source.content) || ((source.status === "duplicate" || source.status === "omitted") && source.content !== "") || (source.status === "duplicate" && (typeof source.duplicateOf !== "string" || !NAMES.some(name => source.duplicateOf === path.posix.join(source.directory, name))))) throw new Error("protocol source");
                totals[source.scope] += source.bytes;
            }
            if (totals.global > budget || totals.project > budget) throw new Error("protocol budget");
            return value;
        } catch {
            warn(snapshot, "Remote instruction discovery unavailable or returned an invalid bounded response; check SSH and python3. No local instructions were loaded.");
            return snapshot;
        }
    }

    const expand = (p: string) => path.resolve(p === "~" ? homedir() : p.startsWith("~/") ? path.join(homedir(), p.slice(2)) : p);
    const snapshot = empty(); snapshot.dir = expand(opts.dir); snapshot.root = snapshot.dir;
    const deadline = Date.now() + 12000;
    const check = () => { if (Date.now() > deadline) throw new Error("instruction discovery deadline"); };
    const code = (error: unknown) => error && typeof error === "object" && "code" in error ? String(error.code).slice(0, 40) : "I/O error";
    const ioWarn = (action: string, p: string, error: unknown) => warn(snapshot, `${action} ${p} (${code(error)}); check permissions and the path.`);
    const meta = async (p: string) => {
        check();
        try { return await fs.lstat(p); }
        catch (error) { if (code(error) !== "ENOENT") ioWarn("Cannot inspect", p, error); return null; }
    };
    const read = async (p: string): Promise<{ content: string; identity: string | null } | null> => {
        const m = await meta(p); if (!m) return null;
        const omitted = { content: "", identity: null };
        if (!m.isFile() && !m.isSymbolicLink()) { warn(snapshot, `Omitted non-regular instruction file ${p}; use a regular UTF-8 file.`); return omitted; }
        let fd: Awaited<ReturnType<typeof fs.open>> | undefined;
        try {
            check();
            const scope = await fs.realpath(path.dirname(p)), target = await fs.realpath(p);
            const relative = path.relative(scope, target);
            if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
                warn(snapshot, `Omitted ${p}; symlink target escapes its instruction directory. Keep instruction links inside this scope.`); return omitted;
            }
            const expected = await fs.stat(target);
            fd = await fs.open(target, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
            const before = await fd.stat();
            if (expected.dev !== before.dev || expected.ino !== before.ino || await fs.realpath(target) !== target) {
                warn(snapshot, `Omitted ${p}; instruction target changed while opening. Retry after saving.`); return omitted;
            }
            if (!before.isFile()) { warn(snapshot, `Omitted non-regular instruction file ${p}; use a regular UTF-8 file.`); return omitted; }
            if (before.size > SOURCE_LIMIT) { warn(snapshot, `Omitted ${p}; source exceeds 1 MiB. Split or shorten the file.`); return omitted; }
            const bytes = Buffer.allocUnsafe(SOURCE_LIMIT + 1); let total = 0;
            while (total <= SOURCE_LIMIT) {
                check(); const result = await fd.read(bytes, total, Math.min(65536, SOURCE_LIMIT + 1 - total), total);
                if (!result.bytesRead) break;
                total += result.bytesRead;
            }
            const after = await fd.stat();
            if (total > SOURCE_LIMIT) { warn(snapshot, `Omitted ${p}; source exceeds 1 MiB. Split or shorten the file.`); return omitted; }
            if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) { warn(snapshot, `Omitted ${p}; file changed while reading. Retry after saving.`); return omitted; }
            let content: string;
            try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, total)).trim(); }
            catch { warn(snapshot, `Omitted ${p}; invalid UTF-8. Save the file as UTF-8.`); return omitted; }
            return { content, identity: `${after.dev}:${after.ino}` };
        } catch (error) { ioWarn("Cannot read", p, error); return omitted; }
        finally { if (fd) await fd.close().catch(error => ioWarn("Cannot close", p, error)); }
    };
    try {
        let dirs: string[] = [], current = snapshot.dir;
        const chain: string[] = [];
        for (let i = 0; i < 128; i++) {
            check(); chain.push(current);
            const marker = await meta(path.join(current, ".git"));
            if (marker && (marker.isFile() || marker.isDirectory())) { snapshot.root = current; dirs = chain.reverse(); break; }
            const parent = path.dirname(current); if (parent === current) break;
            current = parent;
            if (i === 127) warn(snapshot, "Ancestor discovery stopped at depth 128; only the workspace directory is used without a known .git boundary.");
        }
        if (!dirs.length) dirs = [snapshot.dir];
        const seen = new Set(dirs);
        for (const raw of inputPaths) {
            check(); if (!path.isAbsolute(raw)) continue;
            const target = path.normalize(raw), relative = path.relative(snapshot.dir, target);
            if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) continue;
            const nested = path.relative(snapshot.dir, path.dirname(target));
            if (!nested) continue;
            const parts = nested.split(path.sep);
            if (parts.length > 128) { warn(snapshot, `Nested path omitted beyond depth 128: ${target}`); continue; }
            let directory = snapshot.dir;
            for (const part of parts) {
                directory = path.join(directory, part); if (seen.has(directory)) continue;
                if (dirs.length >= 128) { warn(snapshot, "Instruction directories capped at 128; additional nested directories omitted."); break; }
                const m = await meta(directory); if (!m) break;
                if (m.isSymbolicLink()) { warn(snapshot, `Nested symlink directory omitted: ${directory}; use its workspace path directly.`); break; }
                if (!m.isDirectory()) break;
                seen.add(directory); dirs.push(directory);
            }
        }
        const depth = (p: string) => p.split(path.sep).filter(Boolean).length;
        dirs.sort((a, b) => depth(a) - depth(b) || (a < b ? -1 : a > b ? 1 : 0));
        const groups: Array<{ scope: "global" | "project"; dirs: string[] }> = [{ scope: "global", dirs: [expand(opts.globalDir ?? "~/.hyper")] }, { scope: "project", dirs }];
        for (const group of groups) {
            let remaining = budget;
            const records = new Map<string, types.workspaceInstructions.InstructionSource[]>();
            for (const directory of [...group.dirs].reverse()) {
                const prior: Array<{ identity: string; content: string; path: string }> = [], rows: types.workspaceInstructions.InstructionSource[] = [];
                for (const name of NAMES) {
                    const p = path.join(directory, name), result = await read(p); if (!result) continue;
                    const row: types.workspaceInstructions.InstructionSource = { path: p, directory, scope: group.scope, content: "", status: "omitted", bytes: 0 }; rows.push(row);
                    if (result.identity === null) continue;
                    const duplicate = prior.find(old => old.identity === result.identity || old.content === result.content);
                    if (duplicate) { row.status = "duplicate"; row.duplicateOf = duplicate.path; continue; }
                    prior.push({ ...result, identity: result.identity, path: p });
                    const bytes = Buffer.from(result.content);
                    if (bytes.byteLength <= remaining) { row.status = "loaded"; row.content = result.content; row.bytes = bytes.byteLength; }
                    else if (remaining > 0) {
                        row.content = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, remaining), { stream: true }); row.bytes = Buffer.byteLength(row.content); row.status = row.bytes ? "truncated" : "omitted";
                        warn(snapshot, `Truncated ${p} to the ${budget}-byte ${group.scope} instruction budget; shorten broader instructions.`);
                    } else warn(snapshot, `Omitted ${p}; ${group.scope} instruction budget of ${budget} bytes is exhausted.`);
                    remaining -= row.bytes;
                }
                records.set(directory, rows);
            }
            for (const directory of group.dirs) snapshot.sources.push(...(records.get(directory) ?? []));
        }
    } catch {
        warn(snapshot, "Instruction discovery stopped; check filesystem availability and retry.");
    }
    const packetSize = () => Buffer.byteLength(JSON.stringify({ version: 1, snapshot }));
    if (packetSize() > OUTPUT_LIMIT) {
        warn(snapshot, "Instruction output capped at 256 KiB; broader content or source records were omitted.");
        for (const row of snapshot.sources) {
            if (packetSize() <= OUTPUT_LIMIT) break;
            if (row.content) { row.content = ""; row.bytes = 0; row.status = "omitted"; }
        }
        while (snapshot.sources.length && packetSize() > OUTPUT_LIMIT) snapshot.sources.shift();
    }
    return snapshot;
}
