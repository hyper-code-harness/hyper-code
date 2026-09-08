---
name: flow
description: Compute current attention gaps from source facts, review them at /gaps, and explicitly apply one revision-bound action with a durable verification receipt.
---
# Gaps / flow

Canonical declarations are **`$gap_<name>.ts`**, plain async functions anywhere in mounted `src/` or `.hyper/` roots. Namespace `flow` is the generic runner, not a workflow engine. Open **/gaps** (global navigation: **Gaps**) to see all current needs, source rules, actions and isolated check errors. GET calls preview only. Full-page GET and POST use Hyper's shared `{title, main}` layout contract with its global navigation/styles; no standalone shell. POST submits one flow/id/revision, rediscovers before apply, verifies afterwards and displays a receipt. No gaps table, private scheduler, notifications, medication schedule, task waits or automatic actions exist here.

Use `flow.list({})` for the aggregated list, `flow.reconcile({flow,mode:'preview'})`, or `mode:'explain', target:{id,revision}` for the current rationale. Apply requires an explicit target and current revision. A disappeared target or changed revision is `stale` without an action. Successful verification is `closed` only when the selected need disappeared; an effect such as a reminder can succeed while status remains `remains`. `verified` distinguishes actual verification from failures, `converged` means no remaining gaps following discovery. Apply errors and an initial pending attempt are stored in `flow.receipts`; a crash or failed receipt update leaves an indeterminate attempt, never a proven success.

## Cached left-navigation count

The shared **left quick-access rail** links to `/gaps` with a circular count only when positive. Layout and `/ui/gap-count` read `ctx.state.flow.countCache` only: no discovery during shared rendering. `flow.refreshCount({})` coalesces concurrent read-only `flow.list` previews with a five-minute attempt TTL; `{force:true}` bypasses TTL. Existing cron declaration `flow-count` refreshes every **5m** (immediate on first registration); the boot hook initializes the in-memory cache after restart. No new worker or scheduler is introduced. Form submit and apply routes refresh after an attempt; the shared SSE `flow.count` event redraws only the badge, with a five-minute cache-only browser poll as fallback. Source changes outside these routes appear on the next cron preview.

Only aggregate count/timestamps/freshness are retained, never gap payloads. Any isolated rule failure makes the whole aggregate incomplete: preserve the last complete count and mark its tooltip stale rather than publish a partial lower bound as a total. First failure leaves the badge hidden/unknown, not zero. Successful zero hides it. Overdue checks also carry a stale tooltip. The cache is process-local, resets on restart, and is optional when Flow is unloaded; declaration rescans preserve it. Cron must be enabled for unattended refresh (`CRON_WORKER=off` disables it). Private declarations remain outside this plugin and must keep preview read-only.

## Author a trusted declaration

Put private rules in `.hyper/myRules/$gap_intake.ts` (small project-local procedure) or a user plugin's `src/myRules/$gap_intake.ts` (substantial integration). Do not put personal health information into this official plugin. After adding/changing declarations, run `procs.dev.genTypes({})` and **`plugins.reload({})`**; `repl.load({name:'flow'})` reloads ordinary functions only, not custom declaration loaders. `flow.list` and apply also call `flow.refresh` to rescan declarations, including clearing removed last rules (the core boot skips loaders with zero entries). Import/invalid-export errors become isolated rule errors. The scanner loads src before .hyper, and later declarations override the same name. `$flow_` object/step declarations are deliberately not supported.

Template only — replace the fact/action procedures with your own trusted integration; this is not installed or auto-running:

```ts
// .hyper/myRules/$gap_intake.ts
export default async function(ctx:Context, session:Session|null, opts:types.flow.FlowRequest):Promise<types.flow.FlowOutput> {
  const fact = await ctx.fns.myFacts.readIntake({now:opts.now});
  const gaps:types.flow.Gap[] = fact.complete ? [] : [{
    id:`intake:${fact.id}`, revision:fact.revision,
    summary:'Intake is incomplete', will:'Open intake request',
  }];
  if(opts.mode==='preview') return {gaps};
  const gap=gaps.find(g=>g.id===opts.target.id && g.revision===opts.target.revision);
  if(!gap) throw new Error('Target changed');
  if(opts.mode==='explain') return {explanation:gap.summary};
  // This action must atomically recheck facts and use a unique business key.
  const effect=await ctx.fns.myFacts.openIntake({id:fact.id, revision:gap.revision, idempotencyKey:gap.id});
  return {effects:[{reference:effect.id}]};
}
```

The runner does not accept arbitrary action input. `id` and `revision` are nonempty bounded strings, and preview IDs must be unique within a rule. IDs describe stable business needs; revisions change when relevant facts/action semantics change. Single-action `will` is optional: absent means informational only. Preview/explain purity is a trusted-code contract, **not sandbox enforcement**. Explain uses the fresh preview rationale without invoking declaration explain. Apply is not a transaction spanning facts, external effects and receipts: the declaration/action owns atomic rechecks, authorization and idempotency under concurrent/repeated submissions. Never infer adherence or medical completion from a notification receipt. Discovery has no timeout sandbox; slow trusted rules delay the page. Receipts contain gap summaries: keep sensitive data minimal and use the host's access controls.

## Declaration-owned forms and targeted responses

A gap may return `form: {id, label, fields:[{name,type:'datetime-local',label,timezone,value?,min?}]}` instead of legacy `will`. Only datetime-local is supported; timezone is trusted IANA configuration, `min` an optional source date, and an omitted value requires user entry. No client function name, executable code, schema or source identifier is accepted. Without either action the gap remains informational. Existing apply/explain contracts are unchanged.

`flow.card` renders a stable `gap-<hash(rule:id)>` article. `/gaps/submit` requires same-origin URL-encoded POST, unique bounded allowlisted fields and a UUID submission identity. HTMX swaps **only this article** using outerHTML; other cards and their edits are preserved. Native POST uses the shared Hyper layout. Invalid and ambiguous/nonexistent DST timestamps are rejected without an effect; ambiguous times require an external explicit-offset recording path rather than a guessed offset.

`flow.submit` refreshes declarations, rediscovers the exact target/revision/form schema and reserves an idempotent receipt before calling the same trusted declaration with `{mode:'submit', now, target, action, values, submissionId}`. The rule executes the effect, independently recomputes its gap and returns `{html}`: the full replacement article, usually via `flow.card`, with its own substantive confirmation/errors/remains form. It must escape untrusted values and never replace the shared shell. The generic runner does not substitute a closed/remains label for the handler's presentation. An unchanged completed retry returns the saved HTML; pending/interrupted attempts are never blindly rerun. The action must additionally implement source-level idempotency and rechecks (a receipt alone is not an atomic fact transaction). No live personal writes for smoke tests.


## Pleasant cards and forms

`$gap_` returns a list of gaps/cards, not a whole page. Each card owns its `display` and optional `form`; `/gaps` renders a flat kanban-like board on a subtle gray dotted canvas. Never wrap each source in another bordered container. Do not invent workflow columns or drag/drop state for computed gaps.

Use these reusable components through `ctx.fns`:
- `flow.card({flow,gap,message?,errors?,values?,closed?,submissionId?})`: stable card shell, subtle border, rounded corners and shadow; also the exact replacement returned after submit.
- `flow.formField({field,domId,value?,error?})`: visible label, timezone for local datetime, accessible input and field-level error. Uses the shared `procs.ui.field` control.
- `procs.ui.button({type:'submit',label,tone:'primary',size:'sm'})`: one clear primary action, shared Hyper styling. Do not create bespoke button CSS.

Keep the hierarchy simple: small source/status line → short title → dose or subtitle → useful context such as last recorded action → fields → one primary button. Avoid internal IDs, raw source paths, repeated panels, long instructions and redundant headings. `display.title`, `subtitle`, `status`, and `detail` must be plain text; components escape them.

Supported form fields are `datetime-local` and optional `text`. Use concise labels, editable useful defaults, and optional comments (with an explicit `maxLength`). Local datetime defaults should use the declared IANA timezone and current render time, never invent a scheduled time. Defaults are suggestions requiring user submission, not recorded facts; exclude a changing default from the business revision. Preserve user-entered values on validation errors. Example fields:

```ts
fields: [
  { name: 'occurredAt', type: 'datetime-local', label: 'Когда',
    timezone: 'Europe/Lisbon', value: localNow },
  { name: 'comment', type: 'text', label: 'Комментарий', maxLength: 1000 },
]
```

Submission updates only its own card with `hx-target="#gap-…"` and `hx-swap="outerHTML"`. The trusted action handler returns `{html}` using `flow.card`, preserving the stable article ID. Render success in that card, or show the form with inline errors; do not refresh the board and discard other forms. If a saved historical record does not close today's gap, say so explicitly. Legacy non-form apply remains a separate board-refresh path; use form actions for targeted interactions. Full-page fallback always uses Hyper's shared layout. Never interpolate unescaped comments or user values into handler HTML.

Before shipping, inspect the actual authenticated browser: desktop and narrow viewport, shared navigation, dotted background, card shadows, readable contrast, labels, defaults, comments, disabled submit during request and targeted replacement. Test invalid/stale/double submissions on synthetic data only; never create a personal medical record as a smoke test.
