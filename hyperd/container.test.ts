import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolated daemon; never touches the user's live supervisor.
test("container opt-in drains dependents before database and waits for graceful exit", async () => {
    const root = mkdtempSync(join(tmpdir(), "hyperd-container-"));
    const home = join(root, "state"), units = join(root, "units"), log = join(root, "order");
    mkdirSync(units);
    const script = join(root, "service.ts");
    writeFileSync(script, `const [name, log] = process.argv.slice(2); process.on("SIGTERM", async () => { await Bun.sleep(name === "db" ? 500 : 100); require("node:fs").appendFileSync(log, name + "\\n"); process.exit(0); }); console.log("ready"); setInterval(() => {}, 1000);`);
    for (const name of ["db", "app"]) writeFileSync(join(units, name + ".json"), JSON.stringify({name, cmd:[process.execPath, script, name, log], after:name === "app" ? ["db"] : [], ready:{log:"ready"}, stop:{timeoutMs:2000}, restart:{policy:"always",maxRestarts:2}}));
    writeFileSync(join(units, "crash.json"), JSON.stringify({name:"crash",cmd:[process.execPath,"-e",'console.log("ready"); setTimeout(()=>process.exit(1),150)'],ready:{log:"ready"},restart:{policy:"always",maxRestarts:2,backoffMs:[20,40]}}));
    let daemon = Bun.spawn([process.execPath, join(import.meta.dir, "main.ts")], {env:{...process.env,HYPERD_HOME:home,HYPERD_UNITS:units,HYPERD_SHUTDOWN:"stop",HYPERD_TICK_MS:"20"}, stdout:"ignore",stderr:"inherit"});
    let pids:number[] = [];
    try {
        const end = Date.now() + 8000;
        while (true) {
            try {
                const response = await fetch("http://hyperd/status", {unix:join(home,"hyperd.sock")} as any);
                const status:any = await response.json();
                pids = status.units.map((s:any) => s.pid).filter(Boolean);
                if (status.units.length === 3 && status.units.every((s:any) => s.name === "crash" ? s.state === "failed" && s.run === 3 : s.state === "ready")) break;
            } catch {}
            if (Date.now() > end) throw new Error("readiness timeout");
            await Bun.sleep(25);
        }
        daemon.kill("SIGTERM");
        expect(await Promise.race([daemon.exited, Bun.sleep(8000).then(()=>{throw new Error("shutdown timeout");})])).toBe(0);
        expect(readFileSync(log,"utf8")).toBe("app\ndb\n");
        for (const pid of pids) expect(() => process.kill(pid,0)).toThrow();
        const events = readFileSync(join(home,"events.ndjson"),"utf8");
        expect(events).toContain('"services_stopped"');
        daemon = Bun.spawn([process.execPath, join(import.meta.dir, "main.ts")], {env:{...process.env,HYPERD_HOME:home,HYPERD_UNITS:units,HYPERD_SHUTDOWN:"stop",HYPERD_TICK_MS:"20"},stdout:"ignore",stderr:"inherit"});
        const recoveredBy = Date.now()+5000;
        while (true) {
            const state:any = await fetch("http://hyperd/status",{unix:join(home,"hyperd.sock")} as any).then(r=>r.json()).catch(()=>({units:[]}));
            if(state.units.length===3 && state.units.filter((s:any)=>s.name!=="crash").every((s:any)=>s.state==="ready" && s.run===2)) break;
            if(Date.now()>recoveredBy) throw new Error("drained services did not restart");
            await Bun.sleep(25);
        }
        await fetch("http://hyperd/units/app/stop",{unix:join(home,"hyperd.sock"),method:"POST",body:"{}"} as any);
        await Bun.sleep(300);
        daemon.kill("SIGTERM"); await daemon.exited;
        daemon = Bun.spawn([process.execPath, join(import.meta.dir, "main.ts")], {env:{...process.env,HYPERD_HOME:home,HYPERD_UNITS:units,HYPERD_SHUTDOWN:"stop",HYPERD_TICK_MS:"20"},stdout:"ignore",stderr:"inherit"});
        await Bun.sleep(500);
        const manual:any = await (await fetch("http://hyperd/status",{unix:join(home,"hyperd.sock")} as any)).json();
        expect(manual.units.find((s:any)=>s.name==="app").state).toBe("exited");
        expect(manual.units.find((s:any)=>s.name==="app").run).toBe(2);
        daemon.kill("SIGTERM"); await daemon.exited;
    } finally {
        daemon.kill("SIGKILL");
        for (const pid of pids) { try { process.kill(-pid,"SIGKILL"); } catch {} }
        rmSync(root,{recursive:true,force:true});
    }
}, 20000);
