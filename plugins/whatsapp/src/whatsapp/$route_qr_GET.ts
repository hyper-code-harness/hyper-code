import QRCode from "qrcode";

/** Serves a self-refreshing page with the current WhatsApp pairing QR code, or a linked confirmation. */
export default async function (ctx: Context, _session: Session | null, _opts: { /** Incoming HTTP request. */ req: Request }) {
    const c = await ctx.fns.whatsapp.client({ waitMs: 8000 });
    let body: string;
    if (c.status === "open") body = `<h2>✅ WhatsApp linked</h2><p>${Bun.escapeHTML(c.me?.name ?? "")} ${Bun.escapeHTML(c.me?.id ?? "")}</p>`;
    else if (c.qr) body = `<h2>Scan with WhatsApp → Settings → Linked devices → Link a device</h2><img alt="WhatsApp QR" src="${await QRCode.toDataURL(c.qr, { width: 420, margin: 2 })}"><p>The code refreshes automatically.</p>`;
    else body = `<h2>Connecting… (${Bun.escapeHTML(c.status)})</h2>`;
    const refresh = c.status === "open" ? "" : `<meta http-equiv="refresh" content="5">`;
    return new Response(`<!doctype html><html><head><meta charset="utf-8">${refresh}<title>WhatsApp link</title></head><body style="font-family:system-ui;text-align:center;padding:2em">${body}</body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
}
