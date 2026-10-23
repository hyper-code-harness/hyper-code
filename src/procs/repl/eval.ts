// Run TypeScript / JavaScript inside the server process.
// Contract — predictable, Jupyter-style:
//   - Code is the body of `async () => { CODE }`.
//   - In scope: `ctx` (request-scoped, with session), `session`, `console`
//     (captured), `print`. Calls like ctx.fns.x.y({...}) inject ctx/session.
//   - The last expression statement is returned as a JavaScript value.
//   - Errors propagate as exceptions.
type EvalResult = {
    output: string;
    return: any;
};

function formatArg(a: any): string {
    return typeof a === 'string' ? a : Bun.inspect(a);
}

/**
 * Perform eval for the repl subsystem.
 * @param opts.code The code to process.
 * @param opts.bindings The bindings value used by the operation.
 * @param opts.typecheck The typecheck value used by the operation.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: { code: string; bindings?: Record<string, any>; typecheck?: boolean },
): Promise<EvalResult> {
    const code = opts.code;
    const bindings: Record<string, any> = opts.bindings ?? {};
    const configuredTypecheck = opts.typecheck === undefined
        ? await ctx.fns.settings.get({ module: "repl", scopeType: "global", key: "typecheckEval" })
        : undefined;
    const typecheck = opts.typecheck ?? configuredTypecheck;
    if (typecheck !== false) {
        const checked = await ctx.fns.procs.repl.typecheck({ code, bindings });
        if (!checked.ok) throw new TypeError(`eval: typecheck failed:\n${checked.errors.map((e: string) => `  ${e}`).join("\n")}`);
    }
    const buffer: string[] = [];
    const log = (...args: any[]) => {
        buffer.push(args.map(formatArg).join(' '));
    };

    const consoleProxy = {
        log,
        info: log,
        debug: log,
        warn: log,
        error: log,
    };

    // Eval ctx: inherits the caller's ctx; the session flows through.
    const rctx: Context = Object.create(ctx);
    (rctx as any).session = session ?? ctx.session ?? { kind: 'repl' };

    const js = ctx.fns.procs.repl.compile({ code });

    const names = ['ctx', 'session', 'console', 'print', ...Object.keys(bindings)];
    const values: any[] = [rctx, (rctx as any).session, consoleProxy, log, ...Object.values(bindings)];

    const fn = new Function(...names, `${js}\nreturn __repl()`);
    const result = await fn(...values);

    return { output: buffer.join('\n'), return: result };
}
