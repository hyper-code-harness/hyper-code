export const hint = "last project test run of each kind (fast, integration, live) — totals, slowest files and tests, failures with their code, and a Run button — args `{}`";
export default {
    view: "code.testsPage",
    icon: "flask",
    live: true,
    prepare() { return { args: {}, title: "Tests" }; },
    render(_ctx: Context, opts: { agentId: string; item: types.canvas.Item }) {
        return `<iframe data-canvas-frame="${opts.item.id}" src="/code/tests" title="Tests" class="block h-full w-full border-0 bg-base-100" loading="eager"></iframe>`;
    },
    describe() { return "live test-run report per kind (fast / integration / live / all, .runtime/test-report-<kind>.xml) with a Run button"; },
} satisfies types.canvas.Kind;
