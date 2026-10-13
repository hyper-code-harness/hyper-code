import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import readRegistry from "./readPluginRegistry";
import discover from "./discover";
import fetchModules from "./fetch";
import scan from "../project/scan";
import load from "../boot/load";

function fixture() {
    const dir = mkdtempSync(join(tmpdir(), "plugin-registry-"));
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({name:"fixture", procs:{plugins:["./plugins"],path:["./modules"]}}));
    const ctx = {env:{WORKDIR:dir,USER_PLUGINS:join(dir,"user")},state:{root:dir},fns:{}} as any;
    function plugin(path: string, optional = false, plugin = true) {
        const folder=join(dir,path); mkdirSync(join(folder,"src"),{recursive:true});
        writeFileSync(join(folder,"package.json"), JSON.stringify({procs:{src:"src",optional,plugin}}));
        writeFileSync(join(folder,"src","explode.ts"), "throw new Error('MUST NEVER IMPORT'); export default function() {};");
        return folder;
    }
    function config(entries?: Array<{path:string;enabled:boolean}>) {
        writeFileSync(join(dir,"workspace.json"), JSON.stringify(entries === undefined ? {} : {pluginRegistry:{version:1,entries}}));
    }
    return {dir,ctx,plugin,config,close:()=>rmSync(dir,{recursive:true,force:true})};
}

test("absent registry preserves legacy official optional, user auto and core modules",async()=>{
    const f=fixture(); try {
        f.plugin("plugins/optional",true); f.plugin("plugins/always"); f.plugin("user/user-one",true); f.plugin("modules/plain",false,false);
        const roots=await discover(f.ctx,null,{});
        expect(roots.map(r=>r.name)).toContain("always"); expect(roots.map(r=>r.name)).toContain("user-one"); expect(roots.map(r=>r.name)).toContain("plain"); expect(roots.map(r=>r.name)).not.toContain("optional");
    }finally{f.close();}
});
test("empty explicit registry excludes all plugin routes but retains core and nonplugin modules",async()=>{
    const f=fixture();try{
        f.plugin("plugins/always"); f.plugin("user/user-one"); f.plugin("modules/plain",false,false); f.config([]);
        const roots=await discover(f.ctx,null,{});
        expect(roots.some(r=>r.name==="core")).toBe(true);expect(roots.some(r=>r.name==="plain")).toBe(true);
        expect(roots.some(r=>r.source==="official"||r.source==="user"||r.plugin)).toBe(false);
    }finally{f.close();}
});
test("registry orders exact roots, overrides optional/false and preserves user source",async()=>{
    const f=fixture();try{
        f.plugin("plugins/optional",true);f.plugin("user/user-one",true);
        writeFileSync(join(f.dir,"workspace.json"),JSON.stringify({modules:{optional:false},pluginRegistry:{version:1,entries:[{path:"user/user-one",enabled:true},{path:"plugins/optional",enabled:true}]}}));
        const roots=(await discover(f.ctx,null,{})).filter(r=>r.plugin);
        expect(roots.map(r=>r.name)).toEqual(["user-one","optional"]); expect(roots[0].source).toBe("user");expect(roots[1].optional).toBe(true);
    }finally{f.close();}
});
test("disabled concrete roots never enter discovered source roots and missing disabled paths are allowed",async()=>{
    const f=fixture();try{
        f.plugin("user/off");f.config([{path:"user/off",enabled:false},{path:"missing",enabled:false}]);
        expect((await discover(f.ctx,null,{})).some(r=>r.name==="off")).toBe(false);
        const entries = await scan(f.ctx,null,{});
        expect(entries.some(e=>e.abs.startsWith(join(f.dir,"user/off")))).toBe(false);
    }finally{f.close();}
});
test("canonical duplicate paths dedup; conflicting enabled states reject",async()=>{
    const f=fixture();try{
        const path=f.plugin("plugins/a");symlinkSync(path,join(f.dir,"alias"));f.config([{path,enabled:true},{path:"alias",enabled:true}]);
        expect((await readRegistry(f.ctx,null,{}))?.entries).toHaveLength(1);
        f.ctx.state={root:f.dir};f.config([{path,enabled:true},{path:"alias",enabled:false}]);
        await expect(readRegistry(f.ctx,null,{})).rejects.toThrow("Conflicting");
    }finally{f.close();}
});
test("missing enabled, unknown keys, malformed registry and duplicate identities reject",async()=>{
    const f=fixture();try{
        f.config([{path:"missing",enabled:true}]);await expect(readRegistry(f.ctx,null,{})).rejects.toThrow("Invalid pluginRegistry path");
        writeFileSync(join(f.dir,"workspace.json"),JSON.stringify({pluginRegistry:{version:1,entries:[{path:"x",enabled:false,name:"bad"}]}}));await expect(readRegistry(f.ctx,null,{})).rejects.toThrow("concrete path");
        writeFileSync(join(f.dir,"workspace.json"),'{"pluginRegistry":');await expect(readRegistry(f.ctx,null,{})).rejects.toThrow("Invalid workspace");
        f.plugin("one/same");f.plugin("two/same");f.config([{path:"one/same",enabled:true},{path:"two/same",enabled:true}]);await expect(discover(f.ctx,null,{})).rejects.toThrow("Conflicting pluginRegistry name");
    }finally{f.close();}
});
test("legacy malformed workspace retains legacy tolerance",async()=>{
    const f=fixture();try{writeFileSync(join(f.dir,"workspace.json"),'{"modules":');expect(await readRegistry(f.ctx,null,{})).toBeNull();}finally{f.close();}
});
test("changed registry and legacy-to-explicit transitions require restart before discovery",async()=>{
    const f=fixture();try{
        expect(await readRegistry(f.ctx,null,{})).toBeNull();f.config([]);await expect(discover(f.ctx,null,{})).rejects.toThrow("restart required");
        f.ctx.state={root:f.dir,procs:{boot:{entries:[]}}};await expect(readRegistry(f.ctx,null,{})).rejects.toThrow("restart required");
        const priorEntries=f.ctx.state.procs.boot.entries;
        await expect(load(f.ctx,null,{})).rejects.toThrow("restart required");
        expect(f.ctx.state.procs.boot.entries).toBe(priorEntries);
        f.ctx.state={root:f.dir};await readRegistry(f.ctx,null,{});f.config();await expect(readRegistry(f.ctx,null,{})).rejects.toThrow("restart required");
    }finally{f.close();}
});
test("registry fetch returns without resolving declarations, shell or installs",async()=>{
    const f=fixture();try{
        f.config([]);f.ctx.fns={procs:{modules:{readPluginRegistry:()=>readRegistry(f.ctx,null,{}),readDeclared:()=>{throw new Error("declarations must not be read");}}}};
        expect(await fetchModules(f.ctx,null,{})).toEqual({fetched:[]});
    }finally{f.close();}
});
