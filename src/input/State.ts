// ctx.state.input — chat input kinds declared by `$input_<kind>.ts` files.
export type State = {
    /** Kind name → its definition, prompt hint and declaring file. */
    kinds?: Record<string, types.input.Registered>;
};
