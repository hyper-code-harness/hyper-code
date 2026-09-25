/**
 * Records manual blood pressure and optional pulse measurements in the private Apple Health staging store
 *
 * Use when the user explicitly reports a manual blood pressure reading with an optional pulse and asks to place it in Apple Health tables. Writes idempotent staged samples through applehealth.ingest, labels the source as manual, and never claims to write back to the iPhone Health app.
 * @param opts.recordedAt ISO-8601 timestamp for the measurement.
 * @param opts.systolic Systolic blood pressure in mmHg. @minimum 40 @maximum 300
 * @param opts.diastolic Diastolic blood pressure in mmHg. @minimum 20 @maximum 200
 * @param opts.pulse Optional pulse in beats per minute. @minimum 20 @maximum 300
 * @param opts.id Optional stable identifier used for idempotent retries.
 * @param opts.source Measurement source label. @default Manual entry
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** ISO-8601 timestamp for the measurement. */
        recordedAt: string;
        /** Systolic blood pressure in mmHg. @minimum 40 @maximum 300 */
        systolic: number;
        /** Diastolic blood pressure in mmHg. @minimum 20 @maximum 200 */
        diastolic: number;
        /** Optional pulse in beats per minute. @minimum 20 @maximum 300 */
        pulse?: number;
        /** Optional stable identifier used for idempotent retries. */
        id?: string;
        /** Measurement source label. @default Manual entry */
        source?: string;
    },
): Promise<{bloodPressure:{inserted:number;updated:number};heartRate?:{inserted:number;updated:number};ids:{bloodPressure:string;heartRate?:string}}> {
    const base = opts.id ?? crypto.randomUUID();
    if (!/^[0-9a-f-]{16,}$/i.test(base)) throw new Error("id must be a UUID-like identifier with at least 16 hexadecimal or hyphen characters");
    const bloodPressureId = `${base.replace(/-/g, "").slice(0, 28)}b001`;
    const heartRateId = `${base.replace(/-/g, "").slice(0, 28)}a001`;
    const source = opts.source ?? "Manual entry";
    const bloodPressure = await ctx.fns.applehealth.ingest({ kind: "blood_pressure", samples: [{ id: bloodPressureId, recordedAt: opts.recordedAt, value: { systolic: opts.systolic, diastolic: opts.diastolic }, source }] });
    if (opts.pulse == null) return { bloodPressure, ids: { bloodPressure: bloodPressureId } };
    const heartRate = await ctx.fns.applehealth.ingest({ kind: "heart_rate", samples: [{ id: heartRateId, recordedAt: opts.recordedAt, value: { bpm: opts.pulse }, source }] });
    return { bloodPressure, heartRate, ids: { bloodPressure: bloodPressureId, heartRate: heartRateId } };
}
