// One kind of chat input — what a `$input_<kind>.ts` file default-exports.
//
// The framework owns the row (inputs table), the bubble around the form, the
// submit/cancel routes and the message that wakes the agent. A kind owns only
// what is specific to it: how its spec is checked, what the open form looks
// like, how a submission becomes a result, and how the answer looks afterwards.

export type Kind = {
    /** Validate and normalise the spec when the agent opens the input; throw to refuse it. */
    prepare?: (ctx: Context, opts: { spec: Record<string, any> }) => Record<string, any> | Promise<Record<string, any>>;
    /** Form fields of the open input; the framework wraps them in the form with title, buttons and cancel. */
    open: (ctx: Context, opts: { input: types.input.Row; error?: string | null }) => string | Promise<string>;
    /** Turn submitted fields into a result; throw an Error to show its message under the form and keep it open. */
    submit: (ctx: Context, opts: { input: types.input.Row; values: types.input.FormValues }) => types.input.Outcome | Promise<types.input.Outcome>;
    /** The answer, shown in place of the form once submitted. */
    done: (ctx: Context, opts: { input: types.input.Row }) => string | Promise<string>;
    /** Optional extra fragment endpoint, served at GET /input/<id>/part?…, e.g. filtered grid rows. */
    part?: (ctx: Context, opts: { input: types.input.Row; query: URLSearchParams }) => string | Promise<string>;
    /** Submit buttons under the fields; omitted → one primary "Submit" button, "" → none (fields submit themselves). */
    buttons?: (ctx: Context, opts: { input: types.input.Row }) => string | Promise<string>;
    /** Whether the framework shows its own Cancel button. @default true */
    cancel?: boolean;
    /** Phosphor icon name for the bubble header. */
    icon?: string;
};

