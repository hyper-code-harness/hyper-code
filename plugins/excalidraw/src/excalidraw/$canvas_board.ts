// An Excalidraw board as a canvas tab (kind excalidraw.board): the plugin's own editor page for one named
// drawing in a frame. The editor saves the scene and its SVG preview into the drawings directory on every
// change, so the person draws by hand and the agent reads or rewrites the same drawing with excalidraw.read
// and excalidraw.write.

export const hint = "an Excalidraw whiteboard to draw on together — args `{ name }` (letters, digits, - and _; a new name starts a blank board); the person draws by hand, the agent reads it with excalidraw.read({ name }) and redraws it with excalidraw.write";

export default {
    icon: "pencil-simple",
    prepare(_ctx: Context, opts: { agentId: string; args: Record<string, any> }) {
        const name = String(opts.args.name ?? "").trim() || `board-${new Date().toISOString().slice(0, 10)}`;
        if (!/^[A-Za-z0-9_-]{1,80}$/.test(name)) throw new Error("canvas excalidraw.board: args.name may hold only letters, digits, - and _");
        return { args: { name }, title: `Excalidraw · ${name}` };
    },
    render(ctx: Context, opts: { agentId: string; item: types.canvas.Item }) {
        const esc = (text: string) => ctx.fns.w.escape({ text });
        // excalidraw.write bumps state.rev, which changes the src so the editor reloads the rewritten scene.
        const rev = opts.item.state?.rev ? `?rev=${encodeURIComponent(String(opts.item.state.rev))}` : "";
        const src = `/excalidraw/${encodeURIComponent(String(opts.item.args.name))}${rev}`;
        return `<iframe data-canvas-frame="${opts.item.id}" src="${esc(src)}" title="${esc(opts.item.title)}" allow="clipboard-read; clipboard-write" class="block h-full w-full border-0 bg-base-100"></iframe>`;
    },
    describe(_ctx: Context, opts: { item: types.canvas.Item }) {
        return `Excalidraw board "${opts.item.args.name}" — read it with excalidraw.read({ name: "${opts.item.args.name}" }), redraw with excalidraw.write`;
    },
} satisfies types.canvas.Kind;
