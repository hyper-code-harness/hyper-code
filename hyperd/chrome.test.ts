import {test,expect} from 'bun:test';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

for (const hanging of [false,true]) test(`Chrome wrapper ${hanging?'falls back when CDP hangs':'closes through CDP before signalling child'}`,async()=>{
    const root=mkdtempSync(join(tmpdir(),'chrome-wrapper-'));
    const ready=join(root,'ready');
    let childPid=0, closeRequested=false;
    const server=Bun.serve({port:0,fetch(req,server){
        if(new URL(req.url).pathname==='/json/version') return Response.json({webSocketDebuggerUrl:`ws://127.0.0.1:${server.port}/browser`});
        if(server.upgrade(req)) return;
        return new Response('',{status:404});
    },websocket:{message(ws,message){
        expect(JSON.parse(String(message)).method).toBe('Browser.close');closeRequested=true;
        if(!hanging)writeFileSync(join(root,'close'),'close');
    }}});
    const child=join(root,'child.ts');
    writeFileSync(child,`process.on('SIGTERM',()=>process.exit(42));require('node:fs').writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{if(require('node:fs').existsSync(${JSON.stringify(join(root,'close'))}))process.exit(0)},10);`);
    const proc=Bun.spawn([Bun.which('bun') ?? process.execPath,join(import.meta.dir,'chrome.ts'),'--',Bun.which('bun') ?? process.execPath,child],{env:{...process.env,CDP_BROWSER_URL:`http://127.0.0.1:${server.port}`,CHROME_CLOSE_TIMEOUT_MS:'300'},stdout:'pipe',stderr:'pipe'});
    try{
        const deadline=Date.now()+3000;
        while(childPid <= 1){
            if(await Bun.file(ready).exists()) childPid=Number(await Bun.file(ready).text());
            if(Date.now()>deadline)throw new Error('not ready');
            await Bun.sleep(10);
        }
        process.kill(proc.pid,'SIGTERM');
        const code=await Promise.race([proc.exited,Bun.sleep(3000).then(()=>{throw new Error('unbounded stop');})]);
        expect(closeRequested).toBe(true);expect(code).toBe(hanging?42:0);
    }finally{if(proc.exitCode === null)proc.kill();if(childPid){try{process.kill(childPid,'SIGKILL');}catch{}}server.stop(true);rmSync(root,{recursive:true,force:true});}
},5000);
