/**
 * Evaluates and finalizes one claimed durable agent trigger
 *
 * Process an agent trigger already atomically claimed by pollTriggers. Handles one-shot time triggers, recurring cron, once and edge condition watches, timeout prompts, durable run history, and bounded retry after errors.
 * @param opts.triggerId Claimed trigger identifier.
 * @param opts.claimToken Claim ownership token.
 * @param opts.now Evaluation timestamp; defaults to now.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Claimed trigger identifier. */
        triggerId: string;
        /** Claim ownership token. */
        claimToken: string;
        /** Evaluation timestamp; defaults to now. */
        now?: number;
    },
): Promise<{ outcome: string }> {
    const now=Math.floor(opts.now??Date.now());const row=(await ctx.fns.procs.db.select({sql:"SELECT * FROM agent_triggers WHERE id=? AND status='checking' AND claim_token=?",params:[opts.triggerId,opts.claimToken]}))[0] as any;if(!row)return{outcome:"missing"};const config=typeof row.config==="string"?JSON.parse(row.config):row.config;const interval=Math.max(5000,Number(config?.everyMs??300000));let outcome="waiting",result:any=null,error:string|null=null,prompt:string|null=null,nextAt:number|null=null,status="active",lastReady=!!row.last_ready;
    try{if(row.kind==="at"){outcome="fired";prompt=row.prompt;status="completed";}else if(row.kind==="cron"){outcome="fired";prompt=row.prompt;nextAt=await ctx.fns.agent.nextCronAt({expression:String(config.expression),timezone:String(row.timezone),after:now});}else if(row.timeout_at!=null&&now>=Number(row.timeout_at)){outcome="timed_out";status="timed_out";prompt=config.onTimeoutPrompt?String(config.onTimeoutPrompt):null;}else{const checked=await ctx.fns.agent.watchPredicate({predicate:String(config.predicate),opts:config.opts??{}});result=checked.result??null;const ready=!!checked.ready;if(row.mode==="once"&&ready){outcome="fired";prompt=row.prompt;status="completed";lastReady=true;}else if(row.mode==="edge"&&ready&&!lastReady){outcome="fired";prompt=row.prompt;nextAt=now+interval;lastReady=true;}else{outcome=(!ready&&lastReady)?"rearmed":"waiting";lastReady=ready;nextAt=now+interval;}}if(prompt){const delivered=await ctx.fns.agent.deliverTriggerPrompt({triggerId:row.id,claimToken:opts.claimToken,prompt,now});if(!delivered)return{outcome:"cancelled"};}}catch(e:any){outcome="error";error=String(e?.message??e).slice(0,1000);nextAt=now+Math.min(15*60000,Math.max(60000,60000*Math.pow(2,Math.min(Number(row.attempts??0),4))));status="active";}
    const final=await ctx.fns.procs.db.run({sql:"UPDATE agent_triggers SET status=?,next_at=?,last_ready=?,attempts=attempts+1,last_error=?,claim_token=NULL,claimed_at=NULL,updated_at=?,finished_at=CASE WHEN ? IN ('completed','timed_out') THEN ? ELSE finished_at END WHERE id=? AND status='checking' AND claim_token=?",params:[status,nextAt,lastReady,error,now,status,now,row.id,opts.claimToken]});if(final.changes===0)return{outcome:"cancelled"};let resultJson="null";try{resultJson=JSON.stringify(result??null).slice(0,16000);}catch{}await ctx.fns.procs.db.run({sql:"INSERT INTO agent_trigger_runs(trigger_id,scheduled_at,outcome,result,error,created_at) VALUES(?,?,?,?::jsonb,?,?) ON CONFLICT DO NOTHING",params:[row.id,Number(row.next_at??now),outcome,resultJson,error,now]});return{outcome};
}
