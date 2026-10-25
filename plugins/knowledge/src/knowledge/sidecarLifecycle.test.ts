import { describe, expect, test } from 'bun:test';
import update from './updateSidecar';
import page from '../../../../src/agent/sourceMessagePage';
import detail from './$route_$type_$slug_GET';

// No runtime bootstrap or DB connection: every dependency is an in-memory mock.
function fixture(failSave = false) {
    const parent: any = { id: 'parent', scratchpad: { knowledgeSidecar: { status: 'error', sourceMessageIdx: 5, lastSuccessfulMessageIdx: 1 } } };
    const child: any = { id: 'child', scratchpad: {} };
    const archived: string[] = [];
    let prompt = '';
    const ctx: any = { fns: { knowledge: { extractionSchema: async () => ({ types: [], attributes: [], vocabularies: {} }) }, procs: { db: { select: async () => [] } }, session: {
        getMessages: async () => [{ idx: 2, role: 'tool', content: 'Company Alpha' }, { idx: 5, role: 'user', content: 'Review Alpha' }],
        fork: async () => child,
        save: async () => { if (failSave) throw new Error('save failed'); },
        archive: async ({id}: any) => { archived.push(id); },
        mutateScratchpad: async ({mutate}: any) => ({result: mutate(parent.scratchpad, 1), scratchpad: parent.scratchpad}),
    }, settings: { getNumber: async () => 1000 }, events: { refreshAgentMeta: () => {} }, agent: {
        run: async ({userText}: any) => { prompt = userText; throw new Error('extraction failed'); },
    } } };
    return { ctx, parent, child, archived, prompt: () => prompt };
}
describe('isolated Knowledge lifecycle', () => {
    test('failed extraction preserves successful watermark and explicitly labels retried sources', async () => {
        const f = fixture();
        expect((await update(f.ctx, null, {agent:f.parent,messageIdx:5})).status).toBe('error');
        expect(f.parent.scratchpad.knowledgeSidecar.lastSuccessfulMessageIdx).toBe(1);
        expect(f.child.scratchpad.sourceMessages.map((m:any)=>m.idx)).toEqual([2,5]);
        expect(f.prompt()).toContain('"idx":2');
        expect(f.archived).toEqual(['child']);
        expect(f.child.scratchpad.knowledgeSidecarExpired).toBe(true);
    });
    test('post-fork save failure archives the child', async () => {
        const f = fixture(true);
        await update(f.ctx, null, {agent:f.parent,messageIdx:5});
        expect(f.archived).toEqual(['child']);
        expect(f.parent.scratchpad.knowledgeSidecar.error).toBe('save failed');
    });
    test('timeout returns even if the runner ignores abort', async () => {
        const f = fixture(); f.ctx.fns.agent.run = async () => new Promise(()=>{});
        const result = await update(f.ctx, null, {agent:f.parent,messageIdx:5});
        expect(result.status).toBe('error'); expect(f.archived).toEqual(['child']);
    });
    test('successful watermark suppresses duplicate extraction', async () => {
        const f = fixture(); f.parent.scratchpad.knowledgeSidecar.lastSuccessfulMessageIdx = 5;
        expect((await update(f.ctx,null,{agent:f.parent,messageIdx:5})).status).toBe('duplicate');
        expect(f.archived).toEqual([]);
    });
});
const esc = ({text}: {text:string}) => Bun.escapeHTML(text);
test('persisted source page uses parameterized lookup and escapes source HTML', async () => {
    let params: any;
    const ctx: any = { fns: { procs: {ui:{escape:esc},db:{select:async(o:any)=>{params=o.params;return [{role:'tool',content:'<script>bad</script>'}];}}}, w: {escape:esc} } };
    const result = await page(ctx,null,{id:'chat',idx:7});
    expect(params).toEqual(['chat',7]);
    expect((result as any).main).toContain('&lt;script&gt;');
    expect((result as any).main).toContain('href="/agent/chat"');
});
test('entity provenance uses accessible real source links and rejects unsafe schemes', async () => {
    const ctx: any = {fns:{procs:{ui:{escape:esc}}, w: {escape:esc},knowledge:{renderHistory:async()=>({html:'',count:0}),renderBacklinks:async()=>({html:'',count:0}),get:async()=>({type:'Organization',data:{title:'Alpha'},relations:{incoming:[],outgoing:[]},provenance:[{url:'hyper://agent/chat/message/7'},{url:'javascript:alert(1)'}]})}}};
    const result = await detail(ctx,null,{req:new Request('http://localhost'),params:{type:'Organization',slug:'alpha'}});
    expect(result.main).toContain('href="/agent/chat/message/7"');
    expect(result.main).toContain('Source chat · message 7');
    expect(result.main).not.toContain('href="javascript:');
});
