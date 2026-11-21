import { expect, test } from 'bun:test';
import { mkTestCtx } from '../_testCtx.entry';

const ticket = {id:'6e81f711-65c5-42bd-bd24-26eec23a1f14',provider:'anthropic-oauth',account:'adam',organizationId:'00000000-0000-4000-8000-000000000001',grantId:'full-reset-2611',grantTitle:'Weekly <reset>',clears:'seven_day <unsafe>',remainingCount:2,grantExpiresAt:Date.now()+86400000,createdAt:Date.now(),expiresAt:Date.now()+300000,state:'prepared'};

test('popup only prepares; escaped account, exact scope and cost require a separate unnamed submit', async () => {
    const ctx = await mkTestCtx(); let prepare=0, consume=0;
    ctx.state.registry.llm.prepareClaudeReset = async (_c: unknown,_s: unknown,o: {provider:string;account:string}) => { expect(o).toEqual({provider:'anthropic-oauth',account:'adam'}); prepare++; return ticket; };
    ctx.state.registry.llm.consumeClaudeReset = async () => { consume++; throw new Error('must not spend'); };
    const html=await ctx.fns.llms.claudeResetPopup({provider:'anthropic-oauth',account:'adam'});
    expect(prepare).toBe(1); expect(consume).toBe(0);
    expect(html).toContain('anthropic-oauth/adam'); expect(html).toContain('Weekly &lt;reset&gt;'); expect(html).toContain('seven_day &lt;unsafe&gt;');
    expect(html).toContain('one reset'); expect(html).toContain('2 remaining'); expect(html).toContain('five minutes');
    expect(html).toContain('hx-popup="llms.confirmClaudeReset"'); expect(html).toContain('&quot;confirmed&quot;:true');
    expect(html).toContain('type="submit"'); expect(html).not.toContain('name="submit"'); expect(html).not.toContain('<input');
});

test('unavailable popup has no confirm control and does not leak an exception', async () => {
    const ctx=await mkTestCtx();
    ctx.state.registry.llm.prepareClaudeReset=async()=>{throw new Error('SECRET-TOKEN');};
    const html=await ctx.fns.llms.claudeResetPopup({provider:'anthropic-oauth',account:'adam'});
    expect(html).toContain('No reset was sent'); expect(html).not.toContain('SECRET-TOKEN'); expect(html).not.toContain('llms.confirmClaudeReset');
});

test('confirmed result separates provider success from quota refresh failure and never offers a retry', async () => {
    const ctx=await mkTestCtx();
    ctx.state.registry.llm.consumeClaudeReset=async(_c:unknown,_s:unknown,o:unknown)=>{expect(o).toEqual({ticketId:ticket.id,confirmed:true}); return {...ticket,state:'done',outcome:'reset',usageRefreshed:false};};
    const html=await ctx.fns.llms.confirmClaudeReset({ticketId:ticket.id,confirmed:true});
    expect(html).toContain('One reset was used'); expect(html).toContain('Usage could not be refreshed'); expect(html).not.toContain('<form');
    ctx.state.registry.llm.consumeClaudeReset=async()=>({...ticket,state:'done',outcome:'uncertain'});
    const uncertain=await ctx.fns.llms.confirmClaudeReset({ticketId:ticket.id,confirmed:true});
    expect(uncertain).toContain('may have been applied'); expect(uncertain).toContain('ten minutes'); expect(uncertain).not.toContain('<form');
    ctx.state.registry.llm.consumeClaudeReset=async()=>{throw new Error('SECRET-TOKEN');};
    expect(await ctx.fns.llms.confirmClaudeReset({ticketId:ticket.id,confirmed:false})).not.toContain('SECRET-TOKEN');
});
