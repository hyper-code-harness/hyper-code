/**
 * Reports whether desktop control is permitted and describes the connected screens.
 *
 * Checks macOS Accessibility (needed for UI tree, element actions, mouse and keyboard) and Screen Recording (needed for screenshots) permissions of the Hyper server process, and lists screens with point sizes and backing scale. Set prompt to true to open the system permission dialogs. Call first when any desktop function fails.
 * @param opts.prompt Ask macOS to show the permission prompts for missing permissions. @default false
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Ask macOS to show the permission prompts for missing permissions. @default false */
        prompt?: boolean;
    },
): Promise<{ accessibility: boolean; screenRecording: boolean; screens: Array<{ x: number; y: number; w: number; h: number; scale: number }>; hint?: string }> {
    const r = await ctx.fns.desktop.helper({ args: opts.prompt ? ["check", "prompt"] : ["check"] }) as { accessibility: boolean; screenRecording: boolean; screens: Array<{ x: number; y: number; w: number; h: number; scale: number }> };
    const missing = [!r.accessibility && "Accessibility", !r.screenRecording && "Screen Recording"].filter(Boolean);
    return missing.length
        ? { ...r, hint: `Grant ${missing.join(" and ")} in System Settings → Privacy & Security to the app that runs the Hyper server (the bun binary or its terminal), then restart the server.` }
        : r;
}
