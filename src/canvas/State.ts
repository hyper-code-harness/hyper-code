// ctx.state.canvas — canvas kinds declared by `$canvas_<name>.ts` files.
export type State = {
    /** Kind name → its definition, prompt hint and declaring file. */
    kinds?: Record<string, types.canvas.Registered>;
};
