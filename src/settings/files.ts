// Instance settings files: `$settings_<module>.json` in one directory per instance (env HYPER_SETTINGS,
// default ~/.hyper/settings). Each file holds values for keys the module declares with `$setting_<key>.ts`.
// The snapshot is cached and re-read when a file's mtime changes (checked at most once a second), so an
// edit applies without a restart. A file that does not parse keeps its last good values and reports an error.
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

type FileValue = { value: any; path: string };
type Snapshot = {
    dir: string | null;
    values: Map<string, FileValue>;
    errors: string[];
    warnings: string[];
};

const NAME = /^\$settings_([A-Za-z0-9][A-Za-z0-9._-]*)\.json$/;

/** Checks one value against its declared descriptor; returns an error message or null. */
function invalid(descriptor: any, value: any): string | null {
    const type = descriptor?.type ?? "string";
    if (type === "secret") return "secret settings never live in files — use encrypted secret storage";
    if (type === "number") return typeof value === "number" && Number.isFinite(value) ? null : "expected a number";
    if (type === "boolean") return typeof value === "boolean" ? null : "expected true or false";
    if (type === "enum") return Array.isArray(descriptor.options) && descriptor.options.includes(value) ? null : `expected one of ${JSON.stringify(descriptor.options ?? [])}`;
    if (type === "string") return typeof value === "string" ? null : "expected a string";
    return value === undefined ? "missing value" : null; // text, json: any JSON value
}

/**
 * Reads the instance settings files and returns validated values keyed `<module>.<key>`, with their file paths.
 *
 * Use it to learn which declared settings are fixed by files of this instance and why a file was ignored.
 * Values for undeclared keys are dropped with a warning; values of the wrong type and secrets are dropped with
 * an error; a file with broken JSON keeps the values it had when it last parsed.
 * @param opts.force Re-read every file now instead of trusting the one-second mtime check. @default false
 */
export default async function (ctx: Context, _session: Session | null, opts: { force?: boolean }): Promise<{
    dir: string | null;
    values: Record<string, FileValue>;
    errors: string[];
    warnings: string[];
}> {
    const st = ((ctx.state as any).settings ??= {});
    const cache = (st.files ??= { checkedAt: 0, mtimes: {} as Record<string, number>, perFile: {} as Record<string, { values: Record<string, any>; error?: string }>, snapshot: null as Snapshot | null });
    const dir = String(ctx.env.HYPER_SETTINGS ?? (ctx.env.HOME ? join(String(ctx.env.HOME), ".hyper", "settings") : "")).trim() || null;
    const now = Date.now();
    if (!opts.force && cache.snapshot && cache.snapshot.dir === dir && now - cache.checkedAt < 1000) return shape(cache.snapshot);
    cache.checkedAt = now;

    const names = dir ? await readdir(dir).catch(() => [] as string[]) : [];
    const files = names.filter(n => NAME.test(n));
    const mtimes: Record<string, number> = {};
    for (const name of files) mtimes[name] = await stat(join(dir!, name)).then(s => s.mtimeMs).catch(() => 0);
    const same = cache.snapshot && cache.snapshot.dir === dir
        && Object.keys(mtimes).length === Object.keys(cache.mtimes).length
        && Object.entries(mtimes).every(([n, m]) => cache.mtimes[n] === m);
    if (same && !opts.force) return shape(cache.snapshot!);

    const registry: Map<string, any> = st.registry ?? new Map();
    const values = new Map<string, FileValue>();
    const errors: string[] = [];
    const warnings: string[] = [];
    for (const name of files) {
        const path = join(dir!, name);
        const module = NAME.exec(name)![1]!;
        let parsed: any;
        try {
            parsed = JSON.parse(await Bun.file(path).text());
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("top level must be an object of { key: value }");
            cache.perFile[name] = { values: parsed };
        } catch (error: any) {
            const kept = cache.perFile[name]?.values;
            errors.push(`${path}: ${error?.message ?? error}${kept ? " — keeping the last good values" : ""}`);
            if (!kept) continue;
            parsed = kept;
        }
        for (const [key, value] of Object.entries(parsed)) {
            const descriptor = registry.get(`${module}.${key}`);
            if (!descriptor) { warnings.push(`${path}: "${module}.${key}" is not declared by any $setting_ file — ignored`); continue; }
            const problem = invalid(descriptor, value);
            if (problem) { errors.push(`${path}: "${module}.${key}" ${problem} — ignored`); continue; }
            values.set(`${module}.${key}`, { value, path });
        }
    }
    for (const n of Object.keys(cache.perFile)) if (!files.includes(n)) delete cache.perFile[n];
    for (const message of errors) ctx.fns.procs.log.warn({ event: "settings.files.error", msg: message });
    cache.mtimes = mtimes;
    cache.snapshot = { dir, values, errors, warnings };
    return shape(cache.snapshot);
}

function shape(s: Snapshot) {
    return { dir: s.dir, values: Object.fromEntries(s.values), errors: s.errors, warnings: s.warnings };
}
