---
name: diagrams
description: "Compose typed interaction scenarios with synchronous helpers, phases and actor actions; render standalone sequence SVG with default or IBM-inspired geometry."
---

# Diagrams

High-level interaction models, validation, construction, layout and SVG serialization live here. No dependency on `svg` (or any private plugin). Use `svg tsx` as an optional presentation surface, or use the returned standalone SVG directly.

## Helper-first scenario

```svg tsx
const { actor, request, reply, action, phase } = await ctx.fns.diagrams.scenarioHelpers({});
const app = actor('app', 'Application'), idp = actor('idp', 'Identity provider');
function exchange() { return [request(app, idp, 'Code + PKCE verifier'), reply(idp, app, 'Tokens')]; }
return (await ctx.fns.diagrams.scenarioDiagram({
  theme: 'ibm-inspired',
  model: { actors: [app, idp], steps: [phase('Token exchange', [action(app, 'Validate state'), ...exchange()])] }
})).svg;
```

`scenarioHelpers({})` returns synchronous functions: actor(id,label), request/reply/send/redirect(from,to,label,{id}?), action(actor,label,{id}?), phase(title,steps,{id}?). Actor handles serialize to IDs; explicit actors list is required. Shared per-factory counter allocates step IDs. Reusable fragments are `types.diagrams.Step[]`; do not merge independent factories without stable IDs.

`scenarioValidate({model})` validates strict JSON: at most 30 actors, 200 steps, eight phase levels, unique IDs and known actor references. `scenarioDiagram({model,theme?})` returns SVG, dimensions and actor/message/action/phase/lifeline geometry. `sequenceDiagram({participants,messages,title?,theme?})` is the lower-level interaction renderer: ordered directed messages, dashed returns and self-messages, no phases/actions. Models are descriptive, not executable or security-verified.

## Themes and evidence

Both interaction renderers accept `default` (unchanged) or `ibm-inspired`. Flow remains `ctx.fns.svg.flowDiagram` with `svg.flowHelpers`; it also supports `ibm-inspired`, existing `d2-inspired`, compact, columns 3/5, mainPath and bundle.

IBM inspiration: [official technical-diagram guidance](https://www.ibm.com/design/language/infographics/technical-diagrams/design/), reviewed 2026-05-12: 8px construction grid, 48px starting node height, 1px node outline, 8px radius, 16px large-node padding, 14/18 primary type, 12/16 connector labels and orthogonal connector recommendation. Our presets use 8px **size increments**, geometry-aware padding, restrained blue/purple/green and orthogonal flow routing. This is an independent interpretation, not copied branded assets or exact IBM compliance: ELK coordinates/message rows are not universally snapped; flow labels use 12/16, interaction labels retain 14/18 for readability. IBM Plex Sans is a font preference with Arial fallback, not bundled or guaranteed installed. Text metrics are estimates.

## Ownership and compatibility

Actual implementations moved here: scenarioHelpers, scenarioValidate, scenarioDiagram, sequenceDiagram; types Scenario, Actor, Step, ScenarioConstructors. Old `ctx.fns.svg.*` names and `types.svg.*` aliases are documented compatibility forwarders. Existing saved SVG TSX fences continue to work when both official plugins are mounted. Install/mount `diagrams` when using old interaction APIs.

Deliberately limited first extraction: flow/ER/state/architecture/Gantt and low-level geometry remain in SVG. Moving flow now would introduce diagrams → svg.measureText → (namespace compatibility) diagrams; no duplicate metric table or runtime cycle was added. A future broader extraction should put shared text/geometry in a neutral lower layer first. Tests retain the old facade and exercise new implementations independently. No wrappers-only extraction: all interaction validation, layout, drawing and helper allocation now execute here.

Visual examples: `plugins/svg/fixtures/ibm-failover.svg` and `ibm-oidc.svg`. These are illustrative diagrams, not operational failover or authentication specifications.
