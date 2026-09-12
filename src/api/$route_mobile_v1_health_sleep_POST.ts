/** Idempotently ingests bounded HealthKit sleep-day aggregates into healthrepo after normal mobile authentication. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    type Sleep = { recordedAt?: string; sleepStart?: string; sleepEnd?: string; inBedStart?: string; inBedEnd?: string; totalMinutes?: number; deepMinutes?: number; remMinutes?: number; coreMinutes?: number; awakeMinutes?: number; source?: string };
    let body: { sessions?: Sleep[] };
    try { body = await opts.req.json() as { sessions?: Sleep[] }; } catch { return Response.json({ error: "invalid_json", message: "Expected JSON" }, { status: 400 }); }
    const sessions = body.sessions;
    if (!Array.isArray(sessions) || sessions.length < 1 || sessions.length > 90) return Response.json({ error: "invalid_sessions", message: "sessions must contain 1–90 sleep days" }, { status: 400 });
    const minute = (value: unknown) => value == null ? null : Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 1440 ? Number(value) : NaN;
    const date = (value: unknown, required = false) => {
        if (value == null && !required) return null;
        const parsed = new Date(String(value));
        return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
    };
    let inserted = 0, updated = 0;
    const results: Array<{ recordedAt: string; status: "inserted" | "updated" }> = [];
    for (const session of sessions) {
        const recordedAt = date(session.recordedAt, true), sleepStart = date(session.sleepStart), sleepEnd = date(session.sleepEnd), inBedStart = date(session.inBedStart), inBedEnd = date(session.inBedEnd);
        const values = [session.totalMinutes, session.deepMinutes, session.remMinutes, session.coreMinutes, session.awakeMinutes].map(minute);
        if (!recordedAt || values.some(Number.isNaN) || (sleepStart && sleepEnd && sleepStart >= sleepEnd)) return Response.json({ error: "invalid_sleep", message: "Invalid sleep timestamps or minutes" }, { status: 400 });
        const source = String(session.source || "HealthKit iPhone").trim().slice(0, 200) || "HealthKit iPhone";
        const existed = ((await ctx.fns.procs.db.select({ sql: "SELECT 1 FROM healthrepo.mobile_sleep_sessions WHERE recorded_at=?", params: [recordedAt] })) as any[]).length > 0;
        await ctx.fns.procs.db.run({
            sql: `INSERT INTO healthrepo.mobile_sleep_sessions(recorded_at,total_minutes,deep_minutes,rem_minutes,core_minutes,awake_minutes,source,sleep_start,sleep_end,in_bed_start,in_bed_end,payload)
                  VALUES(?,?,?,?,?,?,?,?,?,?,?,?::jsonb) ON CONFLICT(recorded_at) DO UPDATE SET
                  total_minutes=excluded.total_minutes,deep_minutes=excluded.deep_minutes,rem_minutes=excluded.rem_minutes,core_minutes=excluded.core_minutes,awake_minutes=excluded.awake_minutes,
                  source=excluded.source,sleep_start=excluded.sleep_start,sleep_end=excluded.sleep_end,in_bed_start=excluded.in_bed_start,in_bed_end=excluded.in_bed_end,received_at=now(),payload=excluded.payload`,
            params: [recordedAt, ...values, source, sleepStart, sleepEnd, inBedStart, inBedEnd, JSON.stringify(session)],
        });
        if (existed) updated++; else inserted++;
        results.push({ recordedAt, status: existed ? "updated" : "inserted" });
    }
    return Response.json({ version: 1, ok: true, inserted, updated, results });
}
