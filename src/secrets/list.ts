/**
 * Lists stored secret references and safe metadata without decrypting values
 *
 * Returns secret:// references, source, version and timestamps from encrypted local storage. Use to discover whether credentials already exist before asking a human. Never reads, decrypts or returns secret values or ciphertext.
 * @param opts.namespace Optional exact namespace filter, such as google.
 * @param opts.query Optional case-insensitive substring matched against namespace and name.
 * @param opts.limit Maximum entries returned. @default 100 @minimum 1 @maximum 500
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Optional exact namespace filter, such as google. */
        namespace?: string;
        /** Optional case-insensitive substring matched against namespace and name. */
        query?: string;
        /** Maximum entries returned. @default 100 @minimum 1 @maximum 500 */
        limit?: number;
    },
): Promise<Array<{ ref: string; namespace: string; name: string; source: string; version: number; createdAt: number; updatedAt: number }>> {
    const namespace = String(opts.namespace ?? "").trim();
    const query = String(opts.query ?? "").trim().toLowerCase();
    if (namespace && !/^[A-Za-z0-9][\w.-]*$/.test(namespace)) throw new Error("invalid secret namespace");
    const limit = Math.max(1, Math.min(500, Math.floor(opts.limit ?? 100)));
    const rows = await ctx.fns.procs.db.select({
      sql: `SELECT namespace,name,source,version,created_at AS "createdAt",updated_at AS "updatedAt"
            FROM local_secrets
            WHERE (? = '' OR namespace = ?)
              AND (? = '' OR lower(namespace || '/' || name) LIKE ? ESCAPE '\\')
            ORDER BY namespace,name LIMIT ?`,
      params: [namespace, namespace, query, query ? `%${query.replace(/[\%_]/g, "\\$&")}%` : "", limit],
    }) as any[];
    return rows.map(row => ({ ref: `secret://${row.namespace}/${row.name}`, namespace: String(row.namespace), name: String(row.name), source: String(row.source), version: Number(row.version), createdAt: Number(row.createdAt), updatedAt: Number(row.updatedAt) }));
}
