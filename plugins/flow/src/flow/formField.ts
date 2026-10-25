/**
 * Render one accessible gap form field with its label and inline error
 *
 * Use inside gap cards for declaration-owned datetime-local and optional text fields with shared Hyper controls. Escapes labels and values, preserves submitted values and links field errors accessibly.
 * @param opts.field Trusted declaration field with label, type and constraints.
 * @param opts.domId Stable card DOM identifier used to scope input and error IDs.
 * @param opts.value Submitted value to preserve instead of the declaration default.
 * @param opts.error Validation error shown below this field.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Trusted declaration field with label, type and constraints. */
        field: types.flow.GapForm["fields"][number];
        /** Stable card DOM identifier used to scope input and error IDs. */
        domId: string;
        /** Submitted value to preserve instead of the declaration default. */
        value?: string;
        /** Validation error shown below this field. */
        error?: string;
    },
): Promise<string> {
    const f = opts.field, id = opts.domId + '-' + f.name, timed = f.type === 'datetime-local';
    const control = ctx.fns.w.input({
        name: 'field.' + f.name, type: f.type, value: opts.value ?? f.value ?? '', label: f.label, id,
        ...(timed ? { step: 60, min: f.min ? f.min + 'T00:00' : undefined, required: true } : { maxlength: f.maxLength, placeholder: 'Необязательно' }),
        ...(opts.error ? { invalid: true, describedBy: id + '-error' } : {}),
    });
    return ctx.fns.w.field({ name: 'field.' + f.name, label: f.label, for: id, note: timed ? f.timezone : undefined, control, error: opts.error, errorId: id + '-error' });
}
