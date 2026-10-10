// Icon bodies are immutable and tiny, and the network is the slow part of
// drawing. Cache them next to everything else rather than in a file: a drawing
// re-renders on every read of the history, and the second render must not go
// out to the internet.

export default {
    async up(ctx: Context) {
        await ctx.fns.procs.db.exec({
            sql: `create table if not exists svg_icons (
                set_name text not null,
                name text not null,
                body text not null,
                width int not null default 24,
                height int not null default 24,
                fetched_at timestamptz not null default now(),
                primary key (set_name, name)
            )`,
        });
    },
    async down(ctx: Context) {
        await ctx.fns.procs.db.exec({ sql: `drop table if exists svg_icons` });
    },
};
