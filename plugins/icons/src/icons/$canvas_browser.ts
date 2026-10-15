export const hint = 'Search and preview the local Lucide SVG catalogue, inspect tags and download icons — args `{}`; English name and tag search.';

export default {
    icon: "shapes",
    async prepare(_ctx: Context, _opts: { agentId: string; args: Record<string, any> }) {
        return { args: {}, title: "Lucide Icons" };
    },
    async render(ctx: Context, _opts: { agentId: string; item: types.canvas.Item }) {
        const html = await ctx.fns.icons.browserHtml({});
        return `<iframe title="Lucide icon search" sandbox="allow-scripts allow-downloads" referrerpolicy="no-referrer" class="block h-full w-full border-0" srcdoc="${Bun.escapeHTML(html)}"></iframe>`;
    },
    describe() {
        return "Local Lucide catalogue with English name/tag search, SVG previews and downloads";
    },
} satisfies types.canvas.Kind;
