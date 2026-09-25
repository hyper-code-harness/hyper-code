import { expect, test } from "bun:test";
import { Glob } from "bun";

// Markup must use the semantic design tokens from $style_app.css so every screen
// follows the selected theme and the same small scale of sizes and text tones.
const root = new URL("../../../", import.meta.url).pathname;
const banned: Array<[RegExp, string]> = [
    [/(?<![\w-])text-base-content\/\d+/, "use text-muted / text-subtle / text-faint"],
    [/(?<![\w-])text-\[\d+(?:\.\d+)?px\]/, "use text-micro / text-3xs / text-2xs / text-xs"],
    [/(?<![\w-])(?:text|bg|border|divide|ring)-(?:gray|slate|zinc|neutral|stone)-\d+/, "use base-* / ui-border / muted tokens"],
    [/(?<![\w-])(?:bg|border)-white(?![\w\/-])/, "use bg-base-100 / border-ui-border"],
];

test("markup uses semantic design tokens only", async () => {
    const offenders: string[] = [];
    for (const dir of ["src", "plugins"]) {
        for (const rel of new Glob("**/*.{ts,js}").scanSync({ cwd: `${root}${dir}` })) {
            if (rel.includes("node_modules") || rel.includes(".test.")) continue;
            const text = await Bun.file(`${root}${dir}/${rel}`).text();
            for (const [re, hint] of banned) {
                const m = text.match(re);
                if (m) offenders.push(`${dir}/${rel}: ${m[0]} — ${hint}`);
            }
        }
    }
    expect(offenders).toEqual([]);
});
