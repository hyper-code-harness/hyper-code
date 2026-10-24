// A declared function tag as runtime.docs keeps it in ctx.state.tags: the `$tag_<name>.ts` declaration plus who declared it.

/** A declared tag as registered: the declaration plus who declared it. */
export type RegisteredTag = types.runtime.docs.Tag & {
    /** Tag name, without the `@`. */
    name: string;
    /** Module that declared it (`rpc`, `canvas`, a plugin's module). */
    module: string;
    /** Project-relative file of the declaration. */
    rel: string;
};
