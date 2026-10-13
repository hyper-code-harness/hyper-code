/**
 * Previews a read-only migration from mounted legacy plugins to an ordered path registry
 *
 * Use before opting into workspace pluginRegistry. Projects mounted discovery metadata and on-disk candidates into path/enabled entries without writing configuration, reading settings, executing plugins, installing dependencies, or moving files. Reports blockers for aliases, prefixes, ambiguous roots, unresolved declarations and config that requires manual review. The proposal is diagnostic only, requires restart and is not an apply authorization; keep legacy declarations until their configuration has been reviewed.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {},
): Promise<{ mode: "preview"; readOnly: true; restartRequired: true; ready: boolean; pluginRegistry: { version: 1; entries: Array<{ path: string; enabled: boolean }> }; roots: Array<{ name: string; path: string; enabled: boolean; source: string; order: number; prefix?: string }>; blockers: Array<{ code: string; message: string; name?: string }>; warnings: string[] }> {
    const { resolve, basename } = await import("node:path");
    const { realpath, readdir } = await import("node:fs/promises");
    const blockers: Array<{code:string;message:string;name?:string}> = [];
    const roots: Array<{name:string;path:string;enabled:boolean;source:string;order:number;prefix?:string}> = [];
    const block = (code:string,message:string,name?:string) => { blockers.push({code,message,...(name ? {name} : {})}); };
    const root = ctx.fns.procs.project.projectRoot({});
    const workdir = ctx.fns.procs.project.workdir({});
    const object = (v:unknown): v is Record<string,unknown> => !!v && typeof v === "object" && !Array.isArray(v);
    const readJson = async (path:string, required=false): Promise<Record<string,unknown> | null> => {
     const file = Bun.file(path);
     try { if (!await file.exists()) { if(required) block("missing-manifest","Restore the required host manifest before migration."); return null; } const value:unknown=await file.json(); if(!object(value)) throw new Error("shape"); return value; }
     catch { block("invalid-manifest","Repair an unreadable or malformed discovery manifest before migration."); return null; }
    };
    const pkg = await readJson(resolve(root,"package.json"),true);
    const workspace = await readJson(resolve(workdir,"workspace.json"));
    if(workspace && "pluginRegistry" in workspace) block("registry-present","An explicit registry already exists; this legacy migration preview must not replace it.");
    const host = pkg?.procs ?? pkg?.proc;
    if(host !== undefined && !object(host)) block("invalid-config","Repair the host procs declaration before migration.");
    for(const container of [object(host) ? host.modules : undefined,workspace?.modules ?? workspace?.plugins]) {
     if(container === undefined) continue;
     if(!object(container)) { block("invalid-config","Module declarations must be an object; repair them before migration."); continue; }
     for(const [name,value] of Object.entries(container)) if(value !== false && !object(value)) block("invalid-config","Use false or an object for this module declaration.",name);
    }
    // Do not use discover(): it can log raw unresolved npm/git/path configuration.
    const declared = blockers.some(b=>b.code==="invalid-config" || b.code==="invalid-manifest") ? {} : await ctx.fns.procs.modules.readDeclared({workdir});
    if ((ctx.state.procs?.boot as { baked?: unknown[] } | undefined)?.baked?.length) block("baked-runtime","Use a source runtime: compiled static plugin imports cannot enforce this registry.");
    const mounted = ctx.state.procs?.modules;
    let pluginSeen = false;
    for (const m of mounted ?? []) {
     if (m.self) continue;
     if (m.plugin || m.source === "official" || m.source === "user" || m.source === "external") pluginSeen = true;
     else if (pluginSeen) block("mixed-order","A non-plugin root follows a plugin; review override order before enabling the registry.",m.name);
    }
    if(!Array.isArray(mounted)) block("missing-snapshot","Start the legacy runtime before previewing its mounted plugin order.");
    const seen = new Map<string,string>();
    const names = new Map<string,string>();
    const add = async (name:string,path:string,enabled:boolean,source:string,prefix?:string) => {
     let canonical:string;
     try { canonical=await realpath(path); } catch { block("missing-root","Restore this plugin directory before migration.",name); return; }
     const prior=seen.get(canonical);
     if(prior) { if(prior!==name || enabled) block("duplicate-root","Resolve duplicate mounted identities for the same real directory.",name); return; }
     if(names.has(name) && names.get(name)!==canonical) block("duplicate-name","Resolve competing directories using this mounted name.",name);
     if(basename(canonical)!==name) block("alias","This mounted name differs from its real folder name; preserve its identity manually before migration.",name);
     if(prefix) block("prefix","A path-only entry cannot independently preserve this prefix; review the legacy declaration.",name);
     seen.set(canonical,name); names.set(name,canonical);
     roots.push({name,path:canonical,enabled,source,order:roots.length,...(prefix ? {prefix} : {})});
    };
    for(const m of mounted ?? []) {
     if(m.self || !(m.plugin || m.source==="official" || m.source==="user" || m.source==="external")) continue;
     if(!m.dir) { block("missing-folder","Discovery has no concrete plugin folder; restart legacy discovery before migration.",m.name); continue; }
     const mountedPkg = await readJson(resolve(m.dir,"package.json"));
     const mountedManifest = mountedPkg?.procs ?? mountedPkg?.proc ?? await readJson(resolve(m.dir,"atomic-workspace.json"));
     if (!object(mountedManifest)) block("missing-manifest","Restore this mounted plugin manifest before migration.",m.name);
     else {
      const src = mountedManifest.src ?? "src";
      if (typeof src !== "string" || !await Bun.file(resolve(m.dir,typeof src === "string" ? src : "src")).stat().then(s=>s.isDirectory()).catch(()=>false)) block("missing-source","Restore the plugin source directory before migration.",m.name);
     }
     await add(m.name,m.dir,true,m.source ?? "unknown",m.prefix ?? undefined);
    }
    let paths: Awaited<ReturnType<typeof ctx.fns.procs.modules.paths>> = [];
    try { paths = await ctx.fns.procs.modules.paths({}); }
    catch { block("invalid-discovery-paths","Repair discovery path configuration before migration; raw config values are intentionally omitted."); }
    for(const search of paths) {
     let children:string[];
     try { children=await readdir(search.dir); } catch { block("unreadable-root","Restore access to a configured discovery directory."); continue; }
     for(const name of children) {
      const dir=resolve(search.dir,name);
      const childPkg=await readJson(resolve(dir,"package.json"));
      const manifest=childPkg?.procs ?? childPkg?.proc ?? await readJson(resolve(dir,"atomic-workspace.json"));
      if(!object(manifest)) { if(manifest!==null && manifest!==undefined) block("invalid-manifest","Repair this plugin manifest.",name); continue; }
      if(search.kind==="module" && manifest.plugin!==true && manifest.optional!==true) continue;
      let canonical:string;
      try {canonical=await realpath(dir);} catch { block("missing-root","Restore this candidate directory.",name); continue; }
      if(seen.has(canonical)) { if(seen.get(canonical)!==name) block("alias","Discovery and mounted names differ for the same directory.",name); continue; }
      const enabledByLegacy=declared[name]!==false && (search.kind==="user" || manifest.optional!==true || name in declared || "*" in declared || search.prefixed);
      if(enabledByLegacy) block("runtime-drift","An apparently enabled discovery candidate is absent from the mounted snapshot; restart legacy mode and preview again.",name);
      if(search.kind==="module") block("candidate-source","This disabled module candidate has no reliable mounted source classification; review it manually.",name);
      await add(name,dir,false,search.kind==="module" ? "unknown" : search.kind,search.prefixed ? name : undefined);
     }
    }
    for(const [name,config] of Object.entries(declared)) {
     if(name==="*") { block("wildcard","Review wildcard configuration; a concrete registry will not automatically include future plugins."); continue; }
     if(!names.has(name)) { block("unresolved-declaration","This declaration has no reliably identified plugin folder; resolve it before migration.",name); continue; }
     if(config!==false && Object.keys(config).some(key=>!["path","npm","git"].includes(key))) block("legacy-config","Keep this legacy declaration and review its configuration or overrides; values are intentionally omitted.",name);
    }
    return {mode:"preview",readOnly:true,restartRequired:true,ready:blockers.length===0,pluginRegistry:{version:1,entries:roots.map(({path,enabled})=>({path,enabled}))},roots,blockers,warnings:["No files, settings, dependencies or runtime mounts were changed.","Mounted identity, source and order are diagnostics, not fields in the proposed registry. Keep legacy declarations until reviewed.","Restart is required after a separately reviewed registry change; this preview never applies one.","The registry freezes the candidate inventory; rerun this preview if manifests, paths or mounted plugins change."]};
}
