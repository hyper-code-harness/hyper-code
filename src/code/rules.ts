import ts from "typescript";

/**
 * Finds the rule violations that are visible in a single file's syntax.
 *
 * Runs against an already-parsed source file during indexing, so the whole
 * project is checked for the price of the parse the indexer was doing anyway.
 * Returns one entry per violation with the line and a human-readable reason.
 * Use it through `code.quality`, which reads the stored results; call it
 * directly only to check text that is not on disk yet.
 *
 * @param opts.text Source of the file to check.
 * @param opts.rel Project-relative path, used for reporting and to skip test files.
 * @returns Violations found in this file, each with line, rule, severity and detail.
 */
export default function (
    ctx: Context,
    session: Session | null,
    opts: { text: string; rel: string },
): Array<{ line: number; rule: string; severity: "error" | "warn"; detail: string }> {
    const out: Array<{ line: number; rule: string; severity: "error" | "warn"; detail: string }> = [];
    const sf = ts.createSourceFile(opts.rel, opts.text, ts.ScriptTarget.Latest, true,
        opts.rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    const add = (n: ts.Node, rule: string, severity: "error" | "warn", detail: string) =>
        out.push({ line: lineOf(n), rule, severity, detail });

    const visit = (node: ts.Node): void => {
        // An error caught and dropped on the floor. Sometimes deliberate — a
        // best-effort cleanup — but then it deserves a word saying so, because
        // the next reader cannot tell "cannot fail" from "nobody looked".
        if (ts.isCatchClause(node) && node.block.statements.length === 0) {
            const before = opts.text.slice(0, node.getStart(sf)).split("\n").slice(-3).join(" ");
            const explained = /ignore|best.effort|never fails|may not exist|optional|cleanup|fine|harmless/i.test(before);
            if (!explained) add(node, "empty-catch", "warn", "catch block swallows the error with no comment saying why");
        }

        // `throw new Error(...)` inside a catch, without passing the original
        // along. The stack that actually explains the failure is discarded, and
        // what reaches the log is a sentence someone wrote months ago.
        if (ts.isThrowStatement(node) && node.expression && ts.isNewExpression(node.expression)) {
            const caught = enclosingCatchVariable(node, sf);
            if (caught) {
                const args = node.expression.arguments ?? ts.factory.createNodeArray();
                const hasCause = args.some(a => ts.isObjectLiteralExpression(a)
                    && a.properties.some(p => p.name?.getText(sf) === "cause"));
                const mentions = args.some(a => a.getText(sf).includes(caught));
                if (!hasCause && !mentions) {
                    add(node, "lost-cause", "warn", `rethrows without the original error: add { cause: ${caught} }`);
                }
            }
        }

        // `String(form.get("x"))` — FormData.get returns string | File, and a
        // File stringifies to "[object Object]". The data is silently replaced
        // by a placeholder instead of failing, which is the worst outcome.
        if (ts.isCallExpression(node) && node.expression.getText(sf) === "String" && node.arguments.length === 1) {
            const inner = node.arguments[0]!.getText(sf);
            if (/\bform(Data)?\b[\s\S]*\.get\(/.test(inner)) {
                add(node, "formdata-to-string", "warn",
                    "FormData.get() may return a File, which becomes \"[object Object]\" — check the type first");
            }
        }

        // A runtime function must take (ctx, session, opts) and nothing else;
        // the Proxy injects the first two. A fourth parameter is dead weight
        // that no caller can ever fill.
        if (ts.isSourceFile(node)) {
            for (const st of node.statements) {
                if (!ts.isFunctionDeclaration(st)) continue;
                const isDefault = st.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword);
                if (!isDefault) continue;
                if (st.parameters.length > 3) {
                    add(st, "extra-parameter", "warn",
                        `a runtime function takes (ctx, session, opts); this one declares ${st.parameters.length} parameters`);
                }
            }
        }

        ts.forEachChild(node, visit);
    };
    visit(sf);
    return out;
}

// The name bound by the nearest enclosing catch clause, if this node is inside
// one. `catch { }` with no binding yields null — nothing was captured to pass on.
function enclosingCatchVariable(node: ts.Node, sf: ts.SourceFile): string | null {
    let cur: ts.Node | undefined = node.parent;
    while (cur) {
        if (ts.isCatchClause(cur)) return cur.variableDeclaration?.name.getText(sf) ?? null;
        if (ts.isFunctionDeclaration(cur) || ts.isMethodDeclaration(cur)) return null;  // left the scope
        cur = cur.parent;
    }
    return null;
}
