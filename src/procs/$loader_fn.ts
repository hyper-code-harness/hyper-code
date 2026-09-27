// The plain kind: a file that is a function. Ships with the framework the same
// way a module's loader ships with a module — a row in the same table, not a
// special case in the parser.
//
// A loader IS a function, like everything else here: it takes the entries of its
// kind and does what it likes with them.
import { bindSelf, dottedName, setPath, source } from "./boot/load";
import { readFileSync } from "node:fs";

/**
 * Load loader fn declarations into the runtime.
 * @param opts.entries The loader entries to register.
 */
export default async function (ctx: Context, _session: Session | null, opts: { entries: any[] }): Promise<void> {
    const ts = await import("typescript");
    const loaded: any[] = [];
    for (const entry of opts.entries) {
        // Imported once by the bootstrap; on a hot reload there is no entry.fn
        // and the file is read again, cache-busted.
        const fn = entry.fn ?? (await import(entry.abs + `?t=${Date.now()}`)).default;
        if (typeof fn !== "function") continue;
        // Like metadata on a Clojure var: docs, arg schema and source travel with
        // the live function and are replaced atomically on hot reload.
        const parsed = reflectSource(ts, entry);
        (fn as any).meta = {
            name: dottedName(entry),
            module: entry.moduleDir.replaceAll("/", "."),
            fn: entry.runtimeName,
            rel: entry.projectRel ?? entry.rel,
            abs: entry.abs,
            ...parsed,
        };
        if (entry.moduleDir === ".") {
            console.warn(`[fns] ${entry.rel}: a function at the src root has no name — put it in a module`);
            continue;
        }
        setPath(ctx.state.registry, [...entry.moduleDir.split("/"), entry.runtimeName], bindSelf(fn, entry.namespace));
        loaded.push(entry);
    }
    // Logged after the loop: `log.debug` calls `log.emit`, and readdir order is
    // filesystem-specific (APFS alphabetical, ext4 hash) — debug may be
    // registered before emit exists.
    for (const entry of loaded) (ctx.fns as any).procs?.log?.debug?.({ event: "load.fn", msg: dottedName(entry), from: source(entry) });
}

function reflectSource(ts: any, entry: any): any {
    const text = String(entry.source || readFile(entry.abs));
    const fallback = leadingComment(text);
    try {
        const sf = ts.createSourceFile(entry.abs, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        let decl: any;
        for (const statement of sf.statements) {
            if (ts.isFunctionDeclaration(statement) && statement.modifiers?.some((m: any) => m.kind === ts.SyntaxKind.DefaultKeyword)) {
                decl = statement;
                break;
            }
        }
        if (!decl) return { summary: firstLine(fallback), doc: fallback, signature: "", optsType: "", paramsSchema: emptySchema(), returnType: "", line: 1 };
        const doc = jsDoc(ts, decl) || fallback;
        const opts = decl.parameters[2];
        const optsType = opts?.type?.getText(sf) ?? "unknown";
        const returnType = decl.type?.getText(sf) ?? "unknown";
        const paramsSchema = opts?.type ? schemaOf(ts, opts.type, sf, paramDocs(decl, sf)) : emptySchema();
        return {
            summary: firstLine(doc), doc,
            signature: `(${optsType}) => ${returnType}`,
            optsType, paramsSchema, returnType,
            line: sf.getLineAndCharacterOfPosition(decl.getStart(sf)).line + 1,
        };
    } catch {
        return { summary: firstLine(fallback), doc: fallback, signature: "", optsType: "", paramsSchema: emptySchema(), returnType: "", line: 1 };
    }
}

function schemaOf(ts: any, node: any, sf: any, docs: Record<string, string> = {}): any {
    if (ts.isParenthesizedTypeNode(node)) return schemaOf(ts, node.type, sf, docs);
    if (node.kind === ts.SyntaxKind.StringKeyword) return { type: "string" };
    if (node.kind === ts.SyntaxKind.NumberKeyword) return { type: "number" };
    if (node.kind === ts.SyntaxKind.BooleanKeyword) return { type: "boolean" };
    if (node.kind === ts.SyntaxKind.NullKeyword) return { type: "null" };
    if (node.kind === ts.SyntaxKind.AnyKeyword || node.kind === ts.SyntaxKind.UnknownKeyword) return {};
    if (ts.isLiteralTypeNode(node)) return { const: literalValue(ts, node.literal) };
    if (ts.isArrayTypeNode(node)) return { type: "array", items: schemaOf(ts, node.elementType, sf) };
    if (ts.isUnionTypeNode(node)) {
        const members = node.types.map((n: any) => schemaOf(ts, n, sf));
        const values = members.map((m: any) => m.const);
        return members.every((m: any) => Object.hasOwn(m, "const")) ? { enum: values } : { anyOf: members };
    }
    if (ts.isTypeLiteralNode(node)) {
        const properties: any = {}, required: string[] = [];
        for (const member of node.members) {
            if (!ts.isPropertySignature(member) || !member.type || !member.name) continue;
            const name = propertyName(member.name);
            if (!name) continue;
            const schema = schemaOf(ts, member.type, sf);
            const description = jsDoc(ts, member) || docs[name] || "";
            if (description) schema.description = description;
            applyTags(schema, member);
            properties[name] = schema;
            if (!member.questionToken) required.push(name);
        }
        return { type: "object", properties, required, additionalProperties: false };
    }
    if (ts.isTypeReferenceNode(node)) {
        const name = node.typeName.getText(sf);
        if ((name === "Array" || name === "ReadonlyArray") && node.typeArguments?.[0]) {
            return { type: "array", items: schemaOf(ts, node.typeArguments[0], sf) };
        }
        return { "x-typescript-type": node.getText(sf) };
    }
    return { "x-typescript-type": node.getText(sf) };
}

function jsDoc(ts: any, node: any): string {
    const blocks = (node as any).jsDoc ?? [];
    return blocks.map((block: any) => commentText(block.comment)).filter(Boolean).join("\n\n").trim();
}

function paramDocs(decl: any, sf: any): Record<string, string> {
    const out: Record<string, string> = {};
    for (const block of decl.jsDoc ?? []) for (const tag of block.tags ?? []) {
        if (String(tag.tagName?.text ?? "") !== "param") continue;
        const raw = String(tag.name?.getText(sf) ?? "");
        const name = raw.replace(/^opts\??\./, "");
        if (name && !name.includes(".")) out[name] = commentText(tag.comment).trim();
    }
    return out;
}


function applyTags(schema: any, node: any): void {
    for (const block of (node as any).jsDoc ?? []) for (const tag of block.tags ?? []) {
        const name = String(tag.tagName?.text ?? "");
        const value = commentText(tag.comment).trim();
        if (name === "default" && value) schema.default = scalar(value);
        if ((name === "minimum" || name === "maximum") && Number.isFinite(Number(value))) schema[name] = Number(value);
        if (name === "deprecated") schema.deprecated = true;
    }
}

function commentText(value: any): string {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map((x: any) => typeof x === "string" ? x : x.text ?? "").join("");
    return value?.text ? String(value.text) : "";
}

function propertyName(node: any): string { return String(node.text ?? node.escapedText ?? ""); }
function literalValue(ts: any, node: any): any {
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    return node.text;
}
function scalar(value: string): any {
    if (value === "true") return true;
    if (value === "false") return false;
    if (value === "null") return null;
    return value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : value;
}
function leadingComment(text: string): string {
    const out: string[] = [];
    for (const line of text.split("\n")) {
        const match = /^\s*\/\/ ?(.*)$/.exec(line);
        if (!match) break;
        out.push(match[1]!);
    }
    return out.join("\n").trim();
}
function firstLine(doc: string): string { return doc.split(/\n|\.(?:\s|$)/)[0]?.trim() ?? ""; }
function emptySchema(): any { return { type: "object", properties: {}, required: [], additionalProperties: false }; }
function readFile(abs: string): string { try { return readFileSync(abs, "utf8"); } catch { return ""; } }
