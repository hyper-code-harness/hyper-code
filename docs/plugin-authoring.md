# Plugin authoring

The canonical guide is [src/plugins/SKILL.md](../src/plugins/SKILL.md), owned by the core `plugins` module.

Agents can read the same guide independently of their current workspace with:

```ts
await ctx.fns.plugins.authoring({});
```

Keep authoring instructions in that canonical file; this page is only a navigation link.
