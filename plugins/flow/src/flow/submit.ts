/**
 * Submit one freshly rediscovered declaration form and return its card HTML
 *
 * Use only behind a same-origin POST route. Validates allowlisted fields, binds a durable idempotency receipt to the exact payload, rejects stale cards, and invokes only the owning trusted declaration in submit mode. Completed retries return the original HTML; interrupted attempts never rerun blindly.
 * @param opts.fields Parsed unique form fields, including identity and field-prefixed values.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Parsed unique form fields, including identity and field-prefixed values. */
        fields: Record<string,string>;
    },
): Promise<string> {
    const f=opts.fields,flow=f.flow??'',target={id:f.id??'',revision:f.revision??''};
    if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(flow)||!target.id||target.id.length>1024||!target.revision||target.revision.length>1024||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(f.submissionId??''))throw new Error('Invalid form identity');
    const payload=JSON.stringify(Object.entries(f).sort(([a],[b])=>a.localeCompare(b)));
    const prior=await ctx.fns.procs.db.select({sql:'SELECT result FROM flow.receipts WHERE id=?',params:[f.submissionId]});
    const retry=(r:{payload?:string;html?:string})=>{if(r.payload!==payload)throw new Error('Submission identity already used with different values');return r.html;};
    if(prior.length){const html=retry(prior[0].result);if(html)return html;return await ctx.fns.flow.card({flow,gap:{...target,summary:'Результат предыдущей отправки ещё не подтверждён.'},message:'Не отправляйте повторно. Обновите список и проверьте запись.',closed:true});}
    await ctx.fns.flow.refresh({});const now=new Date().toISOString();
    const gap=(await ctx.fns.flow.discover({flow,now})).find(g=>g.id===target.id);
    if(!gap||gap.revision!==target.revision)return await ctx.fns.flow.card({flow,gap:gap??{...target,summary:'Карточка больше не актуальна.'},message:'Данные изменились. Ничего не записано. Проверьте актуальную карточку.',closed:!gap});
    if(!gap.form||gap.form.id!==f.action)throw new Error('Form action unavailable');
    const allowed=new Set(['flow','id','revision','action','submissionId',...gap.form.fields.map(x=>'field.'+x.name)]);
    if(Object.keys(f).some(k=>!allowed.has(k)))throw new Error('Unexpected form field');
    const values:Record<string,string>={},errors:Record<string,string>={};
    for(const field of gap.form.fields){const value=f['field.'+field.name]??'';values[field.name]=value;if(field.type==='text'){if(value.length>field.maxLength||value.includes('\0'))errors[field.name]='Комментарий: не более '+field.maxLength+' символов, без нулевых символов.';}else{const checked=await ctx.fns.flow.localInstant({value,timezone:field.timezone,now,min:field.min});if(checked.error)errors[field.name]=checked.error;}}
    if(Object.keys(errors).length)return await ctx.fns.flow.card({flow,gap,errors,values,submissionId:f.submissionId});
    const claimed=await ctx.fns.procs.db.select({sql:'INSERT INTO flow.receipts(id,flow,result) VALUES (?,?,?::jsonb) ON CONFLICT(id) DO NOTHING RETURNING id',params:[f.submissionId,flow,JSON.stringify({payload,status:'pending'})]});
    if(!claimed.length){const row=await ctx.fns.procs.db.select({sql:'SELECT result FROM flow.receipts WHERE id=?',params:[f.submissionId]});return retry(row[0].result)??await ctx.fns.flow.card({flow,gap,message:'Отправка уже обрабатывается. Не повторяйте действие; обновите список.',closed:true});}
    let html:string;
    try{const output=await ctx.state.flow.declarations[flow]!.fn(ctx,session,{mode:'submit',now,target,action:gap.form.id,values,submissionId:f.submissionId!});if(typeof output.html!=='string')throw new Error('Handler did not return card HTML');html=output.html;}catch(error){html=await ctx.fns.flow.card({flow,gap,message:'Результат не подтверждён: '+String(error instanceof Error?error.message:error)+'. Обновите список перед повторной записью.',closed:true});}
    await ctx.fns.procs.db.run({sql:'UPDATE flow.receipts SET result=?::jsonb WHERE id=?',params:[JSON.stringify({payload,status:'completed',html}),f.submissionId]});return html;
}
