import QRCode from "qrcode";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Starts linking WhatsApp as a linked device and renders the pairing QR code to a PNG file.
 *
 * Use when whatsapp.status reports the account is not linked. Show the returned image (url or path) to the
 * person; they scan it in WhatsApp → Settings → Linked devices → Link a device. QR codes rotate about every
 * 20 seconds, so call login again for a fresh image if the scan did not happen in time. When the saved session
 * is already linked it returns status "open" without a QR.
 *
 * @param opts.waitMs Maximum time to wait for the QR code or an open session.
 * @param opts.restart Force a new connection to get a fresh QR code.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Maximum time in milliseconds to wait for a QR code or an already linked session. @default 20000 @minimum 1000 @maximum 120000 */
    waitMs?: number;
    /** Restart the connection before waiting, which yields a fresh QR code. @default false */
    restart?: boolean;
}): Promise<{ status: string; linked: boolean; me?: { id: string; name?: string }; qrPath?: string; qrUrl?: string; qrAgeMs?: number }> {
    const c = await ctx.fns.whatsapp.client({ waitMs: opts?.waitMs ?? 20000, restart: opts?.restart ?? false });
    if (c.status === "open") return { status: c.status, linked: true, me: c.me };
    if (c.status === "loggedOut") {
        const again = await ctx.fns.whatsapp.client({ waitMs: opts?.waitMs ?? 20000, restart: true });
        if (again.status === "open") return { status: again.status, linked: true, me: again.me };
        Object.assign(c, again);
    }
    if (!c.qr) return { status: c.status, linked: false };
    const qrPath = join(homedir(), ".hyper", "whatsapp", "qr.png");
    await QRCode.toFile(qrPath, c.qr, { width: 420, margin: 2 });
    return { status: c.status, linked: false, qrPath, qrUrl: `/files/raw?path=${encodeURIComponent(qrPath)}&t=${c.qrAt ?? Date.now()}`, qrAgeMs: c.qrAt ? Date.now() - c.qrAt : undefined };
}
