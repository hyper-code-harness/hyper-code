/**
 * Renders one multi-hub catalogue or the offline installed inventory.
 *
 * Use for browser discovery; up to eight enabled saved hubs are searched with three workers and the registry client's 15-second request timeout. Displays at most twenty results across all origins without merging provenance. All lifecycle actions are pinned review POSTs.
 * @param opts.action Legacy navigation hint; detail selections now render the catalogue.
 * @param opts.baseUrl Legacy origin hint, ignored; configure hubs on the configuration page.
 * @param opts.repo Legacy repository hint, ignored; scopes belong to hub configuration.
 * @param opts.q Search text or offline inventory filter.
 * @param opts.name Legacy plugin selection, ignored.
 * @param opts.commit Legacy commit selection, ignored.
 * @param opts.tab Catalogue or offline installed inventory. @default catalog
 */
export default async function(ctx: Context, session: Session | null, opts: {
    /** Legacy navigation hint; detail selections now render the catalogue. */
    action?: "search" | "detail";
    /** Legacy origin hint, ignored; configure hubs on the configuration page. */
    baseUrl?: string;
    /** Legacy repository hint, ignored; scopes belong to hub configuration. */
    repo?: string;
    /** Search text or offline inventory filter. */
    q?: string;
    /** Legacy plugin selection, ignored. */
    name?: string;
    /** Legacy commit selection, ignored. */
    commit?: string;
    /** Catalogue or offline installed inventory. @default catalog */
    tab?: "catalog" | "installed";
}): Promise<string> {
    return ctx.fns.plugins.page({q:opts.q,tab:opts.tab,provider:'hyperhub'});
}
