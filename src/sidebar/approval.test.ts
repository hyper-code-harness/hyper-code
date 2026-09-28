import { expect, test } from 'bun:test';
import approval from './approval';

test('approval requires existing Hyper session when password configured',async()=>{
 const ctx:any={state:{procs:{http:{server:{server:{requestIP:()=>({address:'127.0.0.1'})}}}}},fns:{auth:{oidcOnly:async()=>false,password:async()=> 'configured'},procs:{auth:{authenticate:async()=>null}}}};
 const r=await approval(ctx,null,{req:new Request('http://localhost:3010/sidebar/approve/123')});
 expect(r.status).toBe(303);expect(r.headers.get('location')).toStartWith('/auth/login?next=');
});

test('approval rejects remote peers before any authentication or DB access',async()=>{
 const ctx:any={state:{procs:{http:{server:{server:{requestIP:()=>({address:'192.168.1.12'})}}}}},fns:{}};
 const r=await approval(ctx,null,{req:new Request('http://localhost:3010/sidebar/approve/123')});
 expect(r.status).toBe(403);expect(r.headers.get('x-frame-options')).toBe('DENY');
});
