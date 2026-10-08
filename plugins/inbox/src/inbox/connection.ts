import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/**
 * Internal: the relay connection of this Hyper — its identity plus its secret key from encrypted local secrets
 * (secret://inbox/nsec). Used by the other inbox functions; never print, log or hand its sk to a model.
 * Returns null when no key exists yet (call inbox.register first). Cached in ctx.state.inbox.
 * @param opts.create Generate and store a new key when there is none. @default false
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Generate and store a new key when there is none. @default false */
    create?: boolean;
}): Promise<{ conn: types.inbox.Conn; identity: types.inbox.Self } | null> {
    const state = ((ctx.state as any).inbox ??= {});
    if (state.conn && state.identity) return { conn: state.conn, identity: state.identity };
    const identity = await ctx.fns.inbox.whoami({});
    let sk = await ctx.fns.secrets.getLocal({ namespace: "inbox", name: "nsec" });
    if (!sk) {
        if (!opts.create) return null;
        sk = bytesToHex(schnorr.utils.randomSecretKey());
        await ctx.fns.secrets.putLocal({ namespace: "inbox", name: "nsec", value: sk, source: "inbox.register" });
    }
    const conn: types.inbox.Conn = { base: identity.relay, sk, npub: bytesToHex(schnorr.getPublicKey(Buffer.from(sk, "hex"))), fetch: state.fetch, cache: new Map() };
    state.conn = conn; state.identity = identity;
    return { conn, identity };
}
