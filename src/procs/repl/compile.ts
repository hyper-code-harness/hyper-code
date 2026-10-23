// The eval body as JavaScript: `async function __repl() { CODE }` with the last expression returned
// (Jupyter-style). Shared by procs.repl.eval (runs it here) and background eval (runs it in its own process).
const TS_TRANSPILER = new Bun.Transpiler({ loader: 'ts' });

/**
 * Transpiles an eval body into one JavaScript `async function __repl()` that returns its last expression
 *
 * Use when eval code must run somewhere else than procs.repl.eval — e.g. a background eval in its own bun process.
 * Throws SyntaxError ("eval: parse error: …") when the code does not parse.
 * @param opts.code TypeScript or JavaScript eval body: the body of an async function.
 */
export default function (
    _ctx: Context,
    _session: Session | null,
    opts: {
        /** TypeScript or JavaScript eval body: the body of an async function. */
        code: string;
    },
): string {
    // Bun.Transpiler accepts JS as a subset of TS, so always transpile.
    try {
        return TS_TRANSPILER.transformSync(`async function __repl() {
${withLastExpressionReturn(opts.code)}
}`);
    } catch (e: any) {
        throw new SyntaxError('eval: parse error: ' + (e?.message ?? String(e)));
    }
}

// Leading keywords that make a statement NOT an expression (so we never wrap it
// in `return (...)`). If the last statement is one of these, the REPL returns
// undefined — same as a script.
const STATEMENT_KEYWORD = /^(async\s+function|const|let|var|if|for|while|do|switch|try|catch|finally|return|throw|break|continue|debugger|function|class|import|export|interface|type|enum|namespace|declare)\b/;

// Wrap the last EXPRESSION statement in `return (...)` so the REPL yields its
// value (Jupyter-style). Rather than hand-tokenize JS (regex literals, template
// strings, comments and multiline expressions all make that fragile), we let the
// transpiler be the oracle: try each statement boundary as the split point,
// closest-to-the-end first, and keep the FIRST where `<prefix> return (<tail>)`
// actually parses. Anything that parses is correct by construction; if nothing
// does (e.g. the last statement is a declaration), run the code unchanged.
function withLastExpressionReturn(code: string): string {
    let end = code.length;                                  // last meaningful char (skip trailing space/`;`)
    while (end > 0 && /[\s;]/.test(code[end - 1]!)) end--;
    if (end === 0) return code;

    // Candidate split points: file start + just after every ';' or newline.
    // Deliberately naive about nesting — a split inside a string/object/comment
    // simply fails to parse and we fall through to an earlier one. Largest first
    // so we wrap the LAST statement, not an earlier prefix of the code.
    const starts = [0];
    for (let i = 0; i < end; i++) if (code[i] === ';' || code[i] === '\n') starts.push(i + 1);
    starts.sort((a, b) => b - a);

    for (const start of starts) {
        let s = start;
        while (s < end && /\s/.test(code[s]!)) s++;
        const tail = code.slice(s, end).trim();
        if (!tail || STATEMENT_KEYWORD.test(tail)) continue; // not an expression → don't wrap
        // `)` on its own line so a trailing line-comment in `tail` can't eat it.
        const candidate = `${code.slice(0, s)}return (\n${tail}\n);`;
        try {
            TS_TRANSPILER.transformSync(`async function __r() {\n${candidate}\n}`);
            return candidate;
        } catch { /* invalid split — try an earlier boundary */ }
    }
    return code; // nothing wrapped cleanly (e.g. last statement is a declaration)
}
