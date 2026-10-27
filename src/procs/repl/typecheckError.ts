// The message of a failed eval typecheck, with the real signature of every ctx.fns function the failing lines
// call. The usual failure is a call written from memory or from a stale doc (`zulip.creds({ list: true })` from
// an old SKILL.md): the compiler says `list` is unknown, the caller then spends a turn finding the right shape.
// The shape is on the function object already (the fn loader's meta), so it goes into the same message — with the
// source path, since guessing that path from `rel` is the next mistake.
import { getPath } from "../boot/load";

const MAX_FNS = 4;
const MAX_SIGNATURE = 1200;

/**
 * Builds the error text for a failed eval typecheck: the compiler errors, then the signature and source of each ctx.fns function called on a failing line.
 * @param opts.code The evaluated code the line numbers refer to.
 * @param opts.errors Compiler errors as `line:col message`.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** The evaluated code the line numbers refer to. */
    code: string;
    /** Compiler errors as `line:col message`. */
    errors: string[];
}): string {
    const head = `eval: typecheck failed:\n${opts.errors.map(e => `  ${e}`).join("\n")}`;
    const lines = opts.code.split("\n");
    const failing = new Set<number>();
    for (const e of opts.errors) {
        const m = /^\s*(\d+):\d+\s/.exec(e);
        if (m) failing.add(Number(m[1]));
    }
    // Lines the errors point at; with no position (a config error) there is nothing to point to.
    const text = [...failing].map(n => lines[n - 1] ?? "").join("\n");
    const names: string[] = [];
    for (const m of text.matchAll(/\bfns\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\s*\(/g)) {
        if (!names.includes(m[1]!)) names.push(m[1]!);
    }
    const hints: string[] = [];
    for (const name of names.slice(0, MAX_FNS)) {
        const fn = getPath(ctx.state.registry, name.split("."));
        const meta = typeof fn === "function" ? (fn as any).meta : null;
        if (!meta?.signature) continue;
        const sig = String(meta.signature);
        const where = meta.abs ? `\n    source: ${meta.abs}` : "";
        hints.push(`  ctx.fns.${name}${sig.length > MAX_SIGNATURE ? `${sig.slice(0, MAX_SIGNATURE)} …` : sig}${where}`.replace(/\n(?!    source:)/g, "\n  "));
    }
    if (!hints.length) return head;
    const many = hints.length > 1;
    return `${head}\n\nThe real signature${many ? "s" : ""} (trust ${many ? "them" : "it"} over any doc or example):\n${hints.join("\n")}`;
}
