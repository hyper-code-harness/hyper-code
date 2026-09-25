/**
 * Schedules recurring durable turns for an agent using cron
 *
 * Create a recurring trigger that inserts a prompt into the same agent conversation on a five-field cron schedule. Timezone is explicit so daylight-saving behavior follows the named location. Missed occurrences collapse to one immediate catch-up, then the next future occurrence is calculated.
 * @param opts.id Target agent identifier.
 * @param opts.expression Five-field cron expression.
 * @param opts.timezone IANA timezone such as Europe/Lisbon.
 * @param opts.prompt Prompt inserted on every occurrence.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Target agent identifier. */
        id: string;
        /** Five-field cron expression. */
        expression: string;
        /** IANA timezone such as Europe/Lisbon. */
        timezone: string;
        /** Prompt inserted on every occurrence. */
        prompt: string;
    },
): Promise<{ id: string; nextAt: number }> {
    const id=String(opts.id??"").trim(),prompt=String(opts.prompt??"").trim(),expression=String(opts.expression??"").trim(),timezone=String(opts.timezone??"").trim();if(!id||!prompt||!expression||!timezone)throw new Error("agent.cron: id, expression, timezone and prompt are required");const exists=(await ctx.fns.procs.db.select({sql:"SELECT id FROM agents WHERE id=? AND archived_at IS NULL",params:[id]}))[0];if(!exists)throw new Error(`agent not found: ${id}`);const now=Date.now(),nextAt=await ctx.fns.agent.nextCronAt({expression,timezone,after:now}),triggerId=`tr_${Bun.randomUUIDv7()}`;await ctx.fns.procs.db.run({sql:"INSERT INTO agent_triggers(id,agent_id,kind,prompt,config,timezone,mode,status,next_at,created_at,updated_at) VALUES(?,?,'cron',?,?::jsonb,?,'repeat','active',?,?,?)",params:[triggerId,id,prompt,JSON.stringify({expression}),timezone,nextAt,now,now]});ctx.fns.agent.wakeWorker({});return{id:triggerId,nextAt};
}
