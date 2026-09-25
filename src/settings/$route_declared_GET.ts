/** Handles the HTTP route declared GET endpoint. */
export default async function (ctx: Context, _session: Session | null, _opts: {
        /** Incoming HTTP request. */ req: Request;
        /** Route parameters captured from the request path. */ params: Record<string, string> }) {
    const items = await ctx.fns.settings.declared({});
    const form = await ctx.fns.settings.renderDeclaredForm({});
    const main = `
<header class="px-6 py-3 border-b border-ui-border flex items-center gap-3 text-sm">
  <span class="font-semibold text-muted">declared settings</span>
  <span class="text-xs text-faint">${items.length} declared</span>
</header>
${form}`;
    return { title: 'settings', main };
}
