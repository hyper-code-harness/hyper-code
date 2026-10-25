// The plain kind: a file that is a function. Ships with the framework the same
// way a module's loader ships with a module — a row in the same table, not a
// special case in the parser.
//
// A loader IS a function, like everything else here: it takes the entries of its
// kind and does what it likes with them.
import { bindSelf, dottedName, setPath, source } from "./boot/load";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Load loader fn declarations into the runtime.
 * @param opts.entries The loader entries to register.
 */
export default async function (ctx: Context, _session: Session | null, opts: { entries: any[] }): Promise<void> {
    // hyper-code2: the compiler is imported only when some file actually has to be parsed — with the
    // on-disk cache below a boot of unchanged files parses nothing and never loads it (~60 MB).
    // The live cache outlives a hot reload of this loader; a changed parser must not serve metadata the old one
    // made. Checked before the disk cache, which then loads only if it was written by this same parser.
    if ((globalThis as any).__hyperReflectVersion !== version()) {
        reflectCache.clear();
        (globalThis as any).__hyperReflectVersion = version();
        (globalThis as any).__hyperReflectDiskLoaded = false;
    }
    loadDiskCache();
    const ts = opts.entries.some((e: any) => e.source || !reflectCache.has(cacheKey(e))) ? await import("typescript") : null;
    const parsedBefore = parsedCount;
    const loaded: any[] = [];
    for (const entry of opts.entries) {
        // Imported once by the bootstrap; on a hot reload there is no entry.fn
        // and the file is read again, cache-busted.
        const fn = entry.fn ?? (await import(entry.abs + `?t=${Date.now()}`)).default;
        if (typeof fn !== "function") continue;
        // Like metadata on a Clojure var: docs, arg schema and source travel with
        // the live function and are replaced atomically on hot reload.
        const parsed = reflectCached(ts, entry);
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
    if (parsedCount !== parsedBefore) saveDiskCache();
}

// Parsing every file with the TypeScript compiler is most of a boot's cost after the imports; a test file
// builds a fresh ctx per test in one process. Same file, same mtime → same metadata, so it is kept per process.
// Entries that carry their own source (bundles, hot reload with text) are always parsed.
// On globalThis: boot imports this loader cache-busted, so a module-level Map would start empty every boot.
const reflectCache: Map<string, any> = ((globalThis as any).__hyperReflectCache ??= new Map());
let parsedCount = 0;
function cacheKey(entry: any): string {
    try { const st = statSync(entry.abs); return `${entry.abs}:${st.mtimeMs}:${st.size}`; } catch { return ""; }
}
function reflectCached(ts: any, entry: any): any {
    if (entry.source) return reflectSource(ts, entry);
    const key = cacheKey(entry);
    if (!key) return reflectSource(ts, entry);
    const hit = reflectCache.get(key);
    if (hit) return structuredClone(hit);
    const parsed = reflectSource(ts, entry);
    reflectCache.set(key, parsed);
    parsedCount++;
    return structuredClone(parsed);
}

// hyper-code2: the same cache on disk, so a restart does not parse every function file again. Parsing all
// ~2000 of them cost seconds of boot and ~300 MB the allocator never gave back. The version is this file's
// own source: any change to the parser below throws the whole cache away. Keys carry mtime and size, so an
// edited file misses; entries of deleted files are dropped when the file is written back.
const DISK = join(import.meta.dir, "../../.runtime/reflect-cache.json");
let VERSION = "";
function version(): string {
    if (!VERSION) { try { VERSION = String(Bun.hash(readFileSync(import.meta.path))); } catch { VERSION = "unknown"; } }
    return VERSION;
}
function loadDiskCache(): void {
    if ((globalThis as any).__hyperReflectDiskLoaded) return;
    (globalThis as any).__hyperReflectDiskLoaded = true;
    try {
        const disk = JSON.parse(readFileSync(DISK, "utf8"));
        if (disk?.version !== version()) return;
        for (const [k, v] of Object.entries(disk.entries ?? {})) if (!reflectCache.has(k)) reflectCache.set(k, v);
    } catch { /* no cache yet, or unreadable: parse */ }
}
function saveDiskCache(): void {
    try {
        const entries: Record<string, any> = {};
        for (const [k, v] of reflectCache) {
            const abs = k.slice(0, k.lastIndexOf(":", k.lastIndexOf(":") - 1));
            if (cacheKey({ abs }) === k) entries[k] = v;   // only files as they are on disk now
        }
        mkdirSync(join(DISK, ".."), { recursive: true });
        const tmp = `${DISK}.${process.pid}.tmp`;
        writeFileSync(tmp, JSON.stringify({ version: version(), entries }));
        renameSync(tmp, DISK);
    } catch { /* a cache that cannot be written only costs the next boot its parse */ }
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
        // Function tags: every JSDoc block tag that is not standard JSDoc (@param, @default, @see, …) is kept as
        // `tags: { name: [values] }` — `@view` → { view: [] }, `@live memory` → { live: ["memory"] }. Which tags
        // exist is declared by `$tag_<name>.ts` files (docs/function-tags.md); the loader keeps what is written
        // and code.quality reports tags nobody declared, so a typo is named instead of silently ignored.
        const tags = functionTags(ts, decl);
        // The three framework tags stay readable as plain fields, derived from `tags` (one source):
        // `@canvas <kind>` — shows its result on that canvas tab kind (takes `canvas: true`);
        // `@view` — only reads and returns a page, so it opens by address (GET /rpc/<fn>?<json>, canvas view tab);
        // `@live <topic>` — that page re-fetches itself when the server refreshes the topic.
        const canvas = tags.canvas?.[0];
        const view = !!tags.view;
        const live = tags.live?.[0];
        // `@deprecated <what to use instead>` — still works, but new code must not call it; code.quality reports
        // every call from outside the function's own module (rule `deprecated`).
        const dep = (ts.getJSDocTags(decl) as any[]).find(t => String(t.tagName?.text ?? "") === "deprecated");
        const deprecated = dep ? (commentText(dep.comment).trim() || "deprecated") : undefined;
        return {
            summary: firstLine(doc), doc,
            signature: `(${optsType}) => ${returnType}`,
            optsType, paramsSchema, returnType, tags, ...(canvas ? { canvas } : {}), ...(view ? { view: true } : {}), ...(live ? { live } : {}), ...(deprecated ? { deprecated } : {}),
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

// Standard JSDoc/TSDoc block tags: documentation, not function tags. Everything else is a function tag.
const STANDARD_TAGS = new Set([
    "param", "arg", "argument", "returns", "return", "default", "minimum", "maximum", "example", "deprecated", "see",
    "throws", "exception", "template", "type", "typedef", "callback", "property", "prop", "since", "author", "version",
    "link", "linkcode", "linkplain", "internal", "private", "public", "protected", "readonly", "override", "remarks",
    "privateRemarks", "inheritDoc", "module", "file", "fileoverview", "license", "copyright", "todo", "async", "yields",
    "satisfies", "this", "enum", "class", "constructor", "augments", "extends", "implements", "abstract", "category",
    "packageDocumentation", "defaultValue", "experimental", "beta", "alpha", "summary", "description", "format", "pattern",
    "minLength", "maxLength", "minItems", "maxItems", "multipleOf", "exclusiveMinimum", "exclusiveMaximum", "nullable",
]);
function functionTags(ts: any, decl: any): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    const text: string = decl.getSourceFile().text;
    for (const tag of ts.getJSDocTags(decl) as any[]) {
        const name = String(tag.tagName?.text ?? "");
        if (!name || STANDARD_TAGS.has(name)) continue;
        // Only a tag that opens its own line counts. TypeScript also reads "the @mentions badge" in the middle
        // of a sentence as a tag; nobody wrote that as one.
        const at = tag.getStart();
        const lineStart = text.lastIndexOf("\n", at - 1) + 1;
        if (!/^\s*\*?\s*$/.test(text.slice(lineStart, at))) continue;
        const value = commentText(tag.comment).trim().split(/\s+/)[0] ?? "";
        const values = (out[name] ??= []);
        if (value) values.push(value);
    }
    return out;
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
