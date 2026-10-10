// A real paperclip instead of a grey circle.
//
// A wireframe drawn with placeholder blobs reads as a wireframe of a wireframe.
// Iconify publishes 376k icons from 224 sets as cleaned-up path data behind a
// plain HTTP API, so an icon is one fetch and a <g> — no dependency, no
// megabytes vendored into the repository, no choosing a set in advance.
//
// Two details make this usable rather than a toy:
//   * the body uses `currentColor`, so the colour is set by `fill` on the
//     wrapper and a drawing keeps one palette.
//   * icons are authored on their own grid (Phosphor 256, Tabler 24), so the
//     body is scaled by size/viewBox rather than placed raw — otherwise a
//     Phosphor icon arrives ten times the size of a Tabler one.
//
// Cached in Postgres because a drawing re-renders every time the history is
// reopened, and the second render must not depend on the network.

/** Default set: Phosphor, which the rest of the UI already uses. */
const DEFAULT_SET = "ph";

/**
 * Draws a named icon from the Iconify collections as a positioned SVG node.
 *
 * Use to put a recognisable symbol in a drawing — a paperclip in a composer, a
 * database in an architecture diagram, a brand logo — instead of a placeholder
 * shape. Names follow Iconify: `set` defaults to Phosphor (`ph`), and sets like
 * `tabler`, `lucide`, `mdi`, `material-symbols` and `simple-icons` (brand
 * logos) work the same way. The icon is scaled to `size` from its own grid and
 * placed at x/y as a top-left corner, and `color` fills it, so it matches the
 * drawing's palette. Bodies are cached in Postgres after the first fetch, so
 * re-rendering a drawing never touches the network. An unknown name is an
 * error naming the set, not a silently empty drawing.
 * @param opts.name Icon name, e.g. "paperclip"; "tabler:database" also selects the set.
 * @param opts.set Iconify collection prefix. @default "ph"
 * @param opts.x Left edge of the icon box. @default 0
 * @param opts.y Top edge of the icon box. @default 0
 * @param opts.size Width and height to draw it at, in pixels. @default 16 @minimum 1
 * @param opts.color Fill colour; the icon is authored with currentColor. @default "currentColor"
 * @param opts.opacity Opacity of the icon, 0 to 1. @maximum 1
 * @returns The icon node and the box it occupies, for placing anything next to it.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Icon name, e.g. "paperclip"; "tabler:database" also selects the set. */
    name: string;
    /** Iconify collection prefix. @default "ph" */
    set?: string;
    /** Left edge of the icon box. @default 0 */
    x?: number;
    /** Top edge of the icon box. @default 0 */
    y?: number;
    /** Width and height to draw it at, in pixels. @default 16 @minimum 1 */
    size?: number;
    /** Fill colour; the icon is authored with currentColor. @default "currentColor" */
    color?: string;
    /** Opacity of the icon, 0 to 1. @maximum 1 */
    opacity?: number;
}): Promise<{ node: types.svg.Node; box: { x: number; y: number; w: number; h: number; cx: number; cy: number; right: number; bottom: number } }> {
    const raw = String(opts.name ?? "").trim();
    if (!raw) throw new Error("svg: icon needs a name");
    // "tabler:database" carries its own set, which is how Iconify names icons
    // everywhere else — accepting it saves a second argument.
    const [maybeSet, maybeName] = raw.includes(":") ? raw.split(":", 2) : [null, raw];
    const set = String(maybeSet ?? opts.set ?? DEFAULT_SET).trim();
    const name = String(maybeName).trim();

    const cached = await ctx.fns.procs.db.select({
        sql: "select body, width, height from svg_icons where set_name = ? and name = ?",
        params: [set, name],
    });

    let body: string, width: number, height: number;
    if (cached.length) {
        body = cached[0]!.body;
        width = cached[0]!.width;
        height = cached[0]!.height;
    } else {
        const url = `https://api.iconify.design/${encodeURIComponent(set)}.json?icons=${encodeURIComponent(name)}`;
        const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error(`svg: icon set "${set}" unavailable (${response.status})`);
        const data: any = await response.json();
        const found = data?.icons?.[name];
        if (!found?.body) throw new Error(`svg: no icon "${name}" in set "${set}"`);
        body = String(found.body);
        // Per-icon size wins over the set's default; both are optional and
        // Iconify's own fallback is 16.
        width = Number(found.width ?? data.width ?? 16);
        height = Number(found.height ?? data.height ?? 16);
        await ctx.fns.procs.db.run({
            sql: `insert into svg_icons (set_name, name, body, width, height) values (?, ?, ?, ?, ?)
                  on conflict (set_name, name) do update set body = excluded.body, width = excluded.width, height = excluded.height, fetched_at = now()`,
            params: [set, name, body, width, height],
        });
    }

    const size = Number(opts.size ?? 16);
    const x = Number(opts.x ?? 0), y = Number(opts.y ?? 0);
    const scale = size / Math.max(width, height);

    const node = ctx.fns.svg.element({
        tag: "g",
        props: {
            transform: `translate(${x} ${y}) scale(${Math.round(scale * 10000) / 10000})`,
            // `color`, not just `fill`: the bodies are authored with
            // `fill="currentColor"` (and often `stroke="currentColor"`), and
            // currentColor resolves against the inherited `color` property, not
            // against `fill`. Setting only fill leaves every icon black.
            color: opts.color ?? null,
            fill: opts.color ?? "currentColor",
            opacity: opts.opacity ?? null,
        },
        // The body is Iconify's own cleaned markup; it goes in as a Node so the
        // element factory does not escape it into visible text.
        children: [{ markup: body }],
    });

    return { node, box: { x, y, w: size, h: size, cx: x + size / 2, cy: y + size / 2, right: x + size, bottom: y + size } };
}
