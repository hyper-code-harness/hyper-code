// Profile photo URL for a user, taken from the sign-in ID token's standard `picture` claim
// (Google directly or the Hyper Control Plane). Additive, catalog-only (no DEFAULT), idempotent.
const up_sql = ["SET LOCAL lock_timeout = '3s'", "ALTER TABLE users ADD COLUMN IF NOT EXISTS picture TEXT"];
const down_sql = ["SET LOCAL lock_timeout = '3s'", "ALTER TABLE users DROP COLUMN IF EXISTS picture"];

async function inTransaction(ctx: Context, statements: string[]) {
    const pool: any = await ctx.fns.procs.db.conn();
    await pool.begin(async (tx: any) => { for (const s of statements) await tx.unsafe(s); });
}

export default {
    up: async (ctx: Context) => { await inTransaction(ctx, up_sql); },
    down: async (ctx: Context) => { await inTransaction(ctx, down_sql); },
};
