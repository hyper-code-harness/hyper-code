// Run a TSX drawing: transpile with Bun, bind the JSX factory to svg.element,
// hand it ctx, take back markup.
//
// Four things here are not obvious and each one cost a silent blank picture:
//   * the body is wrapped in a function. A bare trailing <svg/> expression is
//     dead code and the transpiler drops it, so the source must `return`.
//   * `jsx: "react"` with an explicit factory is deliberate — the automatic
//     runtime would emit an import of "react/jsx-runtime", which is not here.
//   * the factory is named `__svgElement`, not `h`, because `h` is what anyone
//     drawing calls a height. A shadowed factory fails with "h is not a
//     function" halfway through a drawing that looked fine.
//   * the result is a Node, not a string, because svg.element returns one.
//
// This is NOT a sandbox: the code gets ctx and can do anything a runtime
// function can. The gate is `svg.allowEval`, checked by the caller.

/**
 * Transpiles and runs a TSX drawing, returning its SVG markup.
 *
 * The source is the body of an async function with `ctx` and `session` in
 * scope: compute whatever is needed — including `await ctx.fns...` calls — and
 * `return` a JSX element. JSX is compiled to svg.element, so attributes use JSX
 * spelling (fontSize, viewBox) and arrays of children work. Use for a drawing
 * whose shape depends on data; for a fixed picture write the markup directly
 * and call svg.render. The code is executed with full runtime access and is not
 * sandboxed, so only run source you trust; a syntax error or a throw inside it
 * is reported with its message.
 * @param opts.source TSX source: statements ending in `return <svg>…</svg>`.
 * @returns The rendered SVG markup.
 */
export default async function (ctx: Context, session: Session | null, opts: {
    /** TSX source: statements ending in `return <svg>…</svg>`. */
    source: string;
}): Promise<{ svg: string }> {
    const source = String(opts.source ?? "").trim();
    if (!source) throw new Error("svg: empty drawing");
    if (!/\breturn\b/.test(source)) throw new Error("svg: the drawing must `return` a JSX element");

    const transpiler = new Bun.Transpiler({
        loader: "tsx",
        tsconfig: JSON.stringify({ compilerOptions: { jsx: "react", jsxFactory: "__svgElement", jsxFragmentFactory: "__svgFragment" } }),
    });

    let compiled: string;
    try {
        compiled = await transpiler.transform(`export default async function __draw(__svgElement, __svgFragment, ctx, session) {\n${source}\n}`);
    } catch (error: any) {
        throw new Error(`svg: ${String(error?.message ?? error).split("\n")[0]}`);
    }

    const element = (tag: any, props: any, ...children: unknown[]) =>
        (typeof tag === "function"
            // <Thing/> — a local component, called with its props the way JSX means it.
            ? tag({ ...(props ?? {}), children: children.length === 1 ? children[0] : children })
            : ctx.fns.svg.element({ tag, props, children }));
    // <>…</> groups children without an element of its own, which SVG has no
    // tag for — so the fragment becomes a plain <g>.
    const fragment = (props: any, ...children: unknown[]) => ctx.fns.svg.element({ tag: "g", props, children });

    let draw: (element: unknown, fragment: unknown, c: Context, s: Session | null) => Promise<unknown>;
    try {
        draw = new Function(compiled.replace(/export\s+default\s+/, "return "))();
    } catch (error: any) {
        throw new Error(`svg: ${error?.message ?? error}`);
    }

    const value: any = await draw(element, fragment, ctx, session);
    if (typeof value === "string") return { svg: value };
    if (!value || typeof value.markup !== "string") throw new Error("svg: the drawing must return a JSX element");
    return { svg: value.markup };
}
