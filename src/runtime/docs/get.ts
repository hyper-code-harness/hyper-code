/**
 * Returns runtime documentation for one loaded function.
 *
 * Metadata is attached to the live function by the function loader, so this
 * describes the currently running image rather than a stale documentation DB.
 */
import { getPath } from "../../procs/boot/load";

/** Returns detailed documentation for one loaded runtime function. */
export default function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Dotted function name, for example `agent.compact`. */
        name: string;
    },
): Record<string, any> {
    const fn = getPath(ctx.state.registry, String(opts.name ?? "").split("."));
    if (typeof fn !== "function") throw new Error(`no such function: ${opts.name}`);
    const meta = (fn as any).meta;
    if (!meta) throw new Error(`${opts.name} has no runtime metadata`);
    return meta;
}
