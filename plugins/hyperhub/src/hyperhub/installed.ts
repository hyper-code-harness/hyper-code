/**
 * Lists installed user plugins and offline provenance or drift status
 *
 * Reads only local plugin directories without executing plugin code or contacting registries. Legacy locks lacking contentDigest are not trusted for automatic updates.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {},
): Promise<{plugins:Array<{name:string;baseUrl?:string;repo?:string;commit?:string;version?:string;previousCommit?:string;modified?:boolean;managed:boolean;status:string}>;errors:string[]}> {
    return await ctx.fns.plugins.installed({});
}
