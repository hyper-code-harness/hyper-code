/**
 * Persists and fans out one external producer event
 *
 * Accept a normalized event from a declared $attach producer, deduplicate it durably, match active subscriptions, and asynchronously wake their agents.
 * @param opts.source Declared producer source.
 * @param opts.eventId Stable source event identifier used for deduplication.
 * @param opts.eventType Normalized event type.
 * @param opts.payload Bounded JSON-compatible event payload.
 * @param opts.occurredAt Source event timestamp in milliseconds.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Declared producer source. */
        source: string;
        /** Stable source event identifier used for deduplication. */
        eventId: string;
        /** Normalized event type. */
        eventType: string;
        /** Bounded JSON-compatible event payload. */
        payload: Record<string, any>;
        /** Source event timestamp in milliseconds. */
        occurredAt?: number;
    },
): Promise<{ duplicate: boolean; deliveries: number }> {
    const source=String(opts.source??"").trim(),eventId=String(opts.eventId??"").trim(),eventType=String(opts.eventType??"").trim();if(!source||!eventId||!eventType)throw new Error("agent.emitAttachment: source, eventId and eventType are required");if(!(ctx.state as any).attachments?.declarations?.[source])throw new Error(`attachment source not found: ${source}`);const json=JSON.stringify(opts.payload??{});if(json.length>65536)throw new Error("attachment payload exceeds 64 KiB");const now=Date.now();const inserted=await ctx.fns.procs.db.select({sql:"INSERT INTO attachment_events(source,event_id,event_type,payload,occurred_at,created_at) VALUES(?,?,?,?::jsonb,?,?) ON CONFLICT(source,event_id) DO NOTHING RETURNING id",params:[source,eventId,eventType,json,Math.floor(opts.occurredAt??now),now]}) as any[];if(!inserted.length)return{duplicate:true,deliveries:0};const eventRowId=Number(inserted[0].id);const subscriptions=await ctx.fns.procs.db.select({sql:"SELECT id,events,filter FROM agent_attachments WHERE source=? AND status='active'",params:[source]}) as any[];let deliveries=0;for(const sub of subscriptions){const events=Array.isArray(sub.events)?sub.events:JSON.parse(sub.events??"[]"),filter=typeof sub.filter==="string"?JSON.parse(sub.filter):sub.filter??{};if(events.length&&!events.includes(eventType))continue;if(!await ctx.fns.agent.attachmentMatches({filter,payload:opts.payload??{}}))continue;const rows=await ctx.fns.procs.db.select({sql:"INSERT INTO attachment_deliveries(event_id,attachment_id,status,created_at,updated_at) VALUES(?,?,'pending',?,?) ON CONFLICT(event_id,attachment_id) DO NOTHING RETURNING id",params:[eventRowId,sub.id,now,now]}) as any[];if(rows[0]){deliveries++;void ctx.fns.agent.dispatchAttachment({deliveryId:Number(rows[0].id)}).catch((e:any)=>console.error("attachment delivery failed:",e));}}return{duplicate:false,deliveries};
}
