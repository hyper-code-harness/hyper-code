/**
 * Read a local Lucide SVG with optional circular chat padding
 *
 * Return a bundled SVG without network requests. Padded output centers an 18 by 18 drawing in a 32 by 32 viewBox for chat avatars. Rejects path traversal and unknown names.
 * @param opts.name Exact lowercase kebab-case Lucide name from icons.search.
 * @param opts.padded Apply the standard centered chat avatar padding. @default false
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Exact lowercase kebab-case Lucide name from icons.search. */
        name: string;
        /** Apply the standard centered chat avatar padding. @default false */
        padded?: boolean;
    },
): Promise<{ name: string; svg: string }> {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(opts.name)) throw new Error("Invalid Lucide icon name");
    const { fileURLToPath } = await import("node:url");
    const file = Bun.file(fileURLToPath(new URL("../../assets/icons/" + opts.name + ".svg", import.meta.url)));
    if (!await file.exists()) throw new Error("Unknown Lucide icon: " + opts.name);
    let svg = await file.text();
    if (opts.padded) {
     const inner = svg.replace(/^[\s\S]*?<svg\b[^>]*>/, "").replace(/<\/svg>\s*$/, "");
     svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><g transform="translate(7 7) scale(0.75)">' + inner + '</g></svg>';
    }
    return { name: opts.name, svg };
}
