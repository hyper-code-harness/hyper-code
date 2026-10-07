/**
 * Lists saved Excalidraw drawings with previews and links to the editor.
 * @param opts.req Incoming HTTP request.
 */
export default async function (ctx: Context, _session: Session | null, _opts: { /** Incoming HTTP request. */ req: Request }) {
    const esc = (s: string) => Bun.escapeHTML(s);
    const items = await ctx.fns.excalidraw.list({});
    const cards = items.map(d => `<a href="${esc(d.url)}" class="block rounded-lg border border-base-300 p-3 hover:bg-base-200/50"><div class="font-medium">${esc(d.name)}</div><div class="text-xs text-subtle">${new Date(d.updatedAt).toLocaleString("ru-RU")}${d.preview ? "" : " · без превью"}</div></a>`).join("");
    return { title: "Excalidraw", main: `<main class="mx-auto max-w-4xl p-6"><h1 class="text-lg font-semibold mb-4">Excalidraw</h1><form class="mb-4 flex gap-2" onsubmit="location.href='/excalidraw/'+encodeURIComponent(this.n.value);return false"><input name="n" class="input input-sm input-bordered" placeholder="имя нового рисунка" pattern="[A-Za-z0-9_-]+" required><button class="btn btn-sm">Открыть</button></form><div class="grid gap-2 sm:grid-cols-3">${cards || '<p class="text-subtle">Пока нет рисунков.</p>'}</div></main>` };
}
