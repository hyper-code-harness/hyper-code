/**
 * Serializes a JSON value with object keys sorted at every depth, so equal values give equal text.
 *
 * Use where a value becomes an identity: the query of a `/rpc/<fn>?<json>` address, a canvas tab's args.
 * Undefined object members are dropped, as JSON.stringify does.
 * @param opts.value Any JSON-serializable value.
 */
export default function (_ctx: Context, _session: Session | null, opts: {
    /** Any JSON-serializable value. */
    value: unknown;
}): string {
    const sort = (v: unknown): unknown => {
        if (Array.isArray(v)) return v.map(sort);
        if (v && typeof v === "object") {
            const out: Record<string, unknown> = {};
            for (const k of Object.keys(v as object).sort()) {
                const x = (v as Record<string, unknown>)[k];
                if (x !== undefined) out[k] = sort(x);
            }
            return out;
        }
        return v;
    };
    return JSON.stringify(sort(opts.value)) ?? "null";
}
