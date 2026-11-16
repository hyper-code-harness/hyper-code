import {test,expect} from 'bun:test';
import configured from './configuredHubs';
import save from './saveHubs';
import page from './configPage';
import post from './$route_config_POST';
import publicOrigin from '../../../../src/http/publicOrigin';
const http={publicOrigin:(o:any)=>publicOrigin({state:{}} as any,null,o)};
const origin='https://registry.example';
test('empty or saved-empty hub list means no hubs; disabled hubs are kept',async()=>{let raw='';const ctx={fns:{settings:{get:async()=>raw}}} as any;expect(await configured(ctx,null,{})).toEqual([]);raw='[]';expect(await configured(ctx,null,{})).toEqual([]);raw=JSON.stringify([{label:'Disabled',origin,enabled:false}]);expect((await configured(ctx,null,{}))[0]?.enabled).toBe(false);});
test('save normalizes and rejects secrets, duplicates and more than eight hubs',async()=>{let value='';const ctx={fns:{settings:{set:async(o:any)=>{value=o.value;}}}} as any;await save(ctx,null,{hubs:[{label:'Hub',origin:origin+'/',enabled:true}]});expect(JSON.parse(value)[0].origin).toBe(origin);for(const bad of ['http://x','https://x:SECRET@x','https://x/a','https://x/?secret','https://x/#secret'])await expect(save(ctx,null,{hubs:[{label:'Hub',origin:bad,enabled:true}]})).rejects.toThrow();await expect(save(ctx,null,{hubs:Array.from({length:9},()=>({label:'Hub',origin,enabled:true}))})).rejects.toThrow();await expect(save(ctx,null,{hubs:[{label:'A',origin,enabled:true},{label:'B',origin:origin+'/',enabled:false}]})).rejects.toThrow();});
test('config form is escaped and posts explicitly',async()=>{const ctx={fns:{hyperhub:{configuredHubs:async()=>[{label:'<script>',origin,enabled:true}]}}} as any;const html=await page(ctx,null,{});expect(html).toContain('&lt;script&gt;');expect(html).toContain('method="POST"');expect(html).toContain('Remove on save');expect(html).toContain('Add hub');});
test('config rejects cross-origin and accepts explicit removal/add/edit with disabled hubs',async()=>{for(const headers of [{},{origin:'https://evil.example'},{origin:'https://hyper.example','sec-fetch-site':'cross-site'}])expect((await post({fns:{http}} as any,null,{req:new Request('https://hyper.example/hyperhub/config',{method:'POST',headers}),params:{}})).status).toBe(403);let received:any;const ctx={fns:{http,hyperhub:{saveHubs:async(o:any)=>{received=o.hubs;}}}} as any;const req=new Request('https://hyper.example/hyperhub/config',{method:'POST',headers:{origin:'https://hyper.example'},body:new URLSearchParams({origin0:origin,remove0:'on',origin1:'https://new.example',label1:'New',repo1:'tenant/plugins'})});expect((await post(ctx,null,{req,params:{}})).status).toBe(303);expect(received).toEqual([{label:'New',origin:'https://new.example',repo:'tenant/plugins',enabled:false}]);});
// Behind the network's hub the browser's Origin is the public address while the process sees its own: the form
// compares with http.publicOrigin (forwarded headers count only from a loopback peer), like the plugin forms of core.
test('config form works behind the hub and still refuses another site',async()=>{
 let peer='127.0.0.1';let saved=0;
 const ctx={state:{procs:{http:{server:{server:{requestIP:()=>({address:peer})}}}}},fns:{hyperhub:{saveHubs:async()=>{saved++;}}}} as any;
 ctx.fns.http={publicOrigin:(o:any)=>publicOrigin(ctx,null,o)};
 const send=(headers:Record<string,string>)=>post(ctx,null,{req:new Request('http://127.0.0.1:3050/hyperhub/config',{method:'POST',headers,body:new URLSearchParams({origin0:'https://new.example',label0:'New'})}),params:{}});
 const viaHub={origin:'https://hyper.team.in.mesh.test','x-forwarded-proto':'https','x-forwarded-host':'hyper.team.in.mesh.test'};
 expect((await send(viaHub)).status).toBe(303);expect(saved).toBe(1);
 expect((await send({...viaHub,origin:'https://evil.test'})).status).toBe(403);
 expect((await send({origin:'https://hyper.team.in.mesh.test'})).status).toBe(403);
 peer='10.77.2.9';expect((await send(viaHub)).status).toBe(403);
 expect(saved).toBe(1);
});
