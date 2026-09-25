/**
 * Checks whether a Circleback meeting recording matching a title pattern exists after a given timestamp
 *
 * Watch-compatible probe for the Circleback meeting mirror. Queries the Circleback remote Postgres for a meeting whose name matches a SQL ILIKE pattern and whose meeting_date is at or after a given ISO timestamp, optionally requiring generated notes to be present. Returns { ready, result } so it can be used directly as the runtime.fn predicate of agent.watch when waiting for a specific meeting transcript to land.
 * @param opts.pattern SQL ILIKE pattern matched against the Circleback meeting name, for example '%Daniil%'.
 * @param opts.since ISO 8601 timestamp; only meetings at or after this moment are considered.
 * @param opts.requireNotes Require generated notes to be present before reporting readiness. @default true
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** SQL ILIKE pattern matched against the Circleback meeting name, for example '%Daniil%'. */
        pattern: string;
        /** ISO 8601 timestamp; only meetings at or after this moment are considered. */
        since: string;
        /** Require generated notes to be present before reporting readiness. @default true */
        requireNotes?: boolean;
    },
): Promise<{ ready: boolean; result?: { id: number; name: string; meetingDate: string; durationSeconds: number | null; hasNotes: boolean } }> {
    const pattern = String(opts.pattern ?? "").trim();
        if (!pattern) throw new Error("skill.circlebackMeetingReady: pattern is required");
        const since = String(opts.since ?? "").trim();
        if (!since) throw new Error("skill.circlebackMeetingReady: since is required");
        const requireNotes = opts.requireNotes !== false;
        const rows: any[] = await ctx.fns.circleback.sql({
            query: "select id, name, meeting_date, duration, (notes is not null and length(notes) > 0) as has_notes from meetings where name ilike $1 and meeting_date >= $2::timestamptz order by meeting_date desc limit 5",
            params: [pattern, since],
        }) as any;
        const hit = rows.find((r: any) => (requireNotes ? r.has_notes === true : true));
        if (!hit) return { ready: false };
        return {
            ready: true,
            result: {
                id: Number(hit.id),
                name: String(hit.name),
                meetingDate: new Date(hit.meeting_date).toISOString(),
                durationSeconds: hit.duration == null ? null : Number(hit.duration),
                hasNotes: hit.has_notes === true,
            },
        };
}
