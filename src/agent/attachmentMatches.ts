/**
 * Matches an external event against an attachment filter
 *
 * Evaluate the small declarative filter language used by durable agent attachments. Use internally before creating a delivery.
 * @param opts.filter Filter whose scalar or array values must match payload fields.
 * @param opts.payload Normalized producer payload.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Filter whose scalar or array values must match payload fields. */
        filter: Record<string, any>;
        /** Normalized producer payload. */
        payload: Record<string, any>;
    },
): Promise<boolean> {
    const filter=opts.filter??{},payload=opts.payload??{};for(const [key,want] of Object.entries(filter)){const got=payload[key];if(Array.isArray(want)){if(!want.map(String).includes(String(got)))return false;}else if(want!==undefined&&String(got)!==String(want))return false;}return true;
}
