/**
 * Lists current gaps across every loaded declaration with isolated errors
 *
 * Use to build the attention page. Recomputes each rule in preview mode without storing gaps or executing actions; one failing rule does not hide the others.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {},
): Promise<Array<{flow:string; source:string; result:types.flow.ReconcileResult}>> {
    await ctx.fns.flow.refresh({});
    const rows:Array<{flow:string; source:string; result:types.flow.ReconcileResult}>=[];
    const now=new Date().toISOString();
    for(const declaration of Object.values(ctx.state.flow?.declarations??{})) rows.push({flow:declaration.name,source:declaration.source,result:await ctx.fns.flow.reconcile({flow:declaration.name,mode:'preview',now})});
    return rows;
}
