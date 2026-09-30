// A function's tier — who owns the file it lives in. `root` already says which
// scan root shipped it, but not whether that root is code this repository
// commits or code that only exists on this machine. Boundary checking needs the
// second question, so it is stored next to the first rather than re-derived from
// a mount table that may have changed since the index was written.
//
//   core      src/ and .hyper/ of this repository
//   official  plugins/* — shipped and committed here
//   user      ~/.hyper/user/* — private, mounted per machine, NOT in this repo
//   external  cloned from a git url
const upSql = `
ALTER TABLE code_functions ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'core';
CREATE INDEX IF NOT EXISTS code_functions_tier_idx ON code_functions(tier);
`;

/** Adds `tier` to code_functions: who owns the file — core, official, user or external. */
export default {
    up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: upSql }); },
    down: async (ctx: Context) => {
        await ctx.fns.procs.db.exec({ sql: "ALTER TABLE code_functions DROP COLUMN IF EXISTS tier;" });
    },
};
