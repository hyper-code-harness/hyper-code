// One turn of a live tour: say a sentence, light the control it names, and
// return at once. The person's answer — Next, their own click on the lit
// control, End tour, or "this page has no such thing" — comes back as
// POST /screen/press and lands in the chat as one line of fact, so the guide's
// next message IS their next move. Guiding is turn-taking, not waiting on a
// wire: play one step per turn and stop talking until the press arrives.
//
//   ctx.fns.screen.step({ say: "Это регистр", open: "/ehr", point: { form: "patient-search" } })
//   ctx.fns.screen.step({ say: "Нажми на строку", click: { entity: "file", id: "CLAUDE.md" } })
/**
 * Plays one turn of an interactive browser tour.
 * @param opts.say Caption for this tour turn.
 * @param opts.open URL or described element to open.
 * @param opts.click Described element to click.
 * @param opts.point Described element to highlight.
 * @param opts.fill Form and values to fill.
 * @param opts.submit Form identifier to submit.
 * @param opts.title Optional tour title.
 */
export default async function (ctx: Context, _session: Session | null, opts: types.screen.TourStep & { title?: string }) {
    return await ctx.fns.screen.eval({ code: `return window.page.step(${JSON.stringify(opts)})`, timeoutMs: 20_000 });
}
