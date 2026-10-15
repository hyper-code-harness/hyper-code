/** GET /code/tests — the last test run (code.tests) as a page with a Run button; the Tests canvas frames it. */
export default async function (ctx: Context, _session: Session | null, _opts: { req: Request }) {
    const data = await ctx.fns.code.tests({});
    const json = JSON.stringify(data ?? null).replace(/</g, "\\u003c");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Tests</title><style>${CSS}</style></head>
<body><div id=app></div><script>window.TESTS=${json};</script><script src="/code/tests.js"></script></body></html>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

const CSS = `
body{font:13px/1.4 Inter,system-ui,sans-serif;margin:0;padding:16px 20px;color:#1f2937;background:#fff}
h1{font-size:17px;margin:0 0 4px} .sub{color:#6b7280;font-size:12px;margin-bottom:14px}
.kpis{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px}.k{border:1px solid #e5e7eb;border-radius:10px;padding:6px 10px;min-width:70px}.k b{display:block;font-size:20px}.k span{color:#6b7280;font-size:11px}
.k.bad b{color:#dc2626}.k.ok b{color:#16a34a}
h2{font-size:13px;margin:18px 0 8px;color:#374151;text-transform:uppercase;letter-spacing:.04em}
.row{display:grid;grid-template-columns:minmax(0,1fr) 48px;gap:2px 8px;align-items:center;padding:4px 0}.row .name{grid-column:1/3}
.name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,Menlo,monospace;font-size:12px}
.bar{height:12px;border-radius:4px;background:#3b82f6}.bar.hot{background:#f59e0b}.bar.very{background:#ef4444}
.v{text-align:right;font-variant-numeric:tabular-nums;color:#374151}
.f{border-left:3px solid #ef4444;padding:4px 8px;margin:4px 0;background:#fef2f2;border-radius:4px}
.f .t{font-weight:600}.f .m{color:#6b7280;font-size:12px;font-family:ui-monospace,Menlo,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.grp{color:#6b7280;font-size:12px;margin:8px 0 2px;font-family:ui-monospace,Menlo,monospace}
details>summary{list-style:none;cursor:pointer}details>summary::-webkit-details-marker{display:none}
details[open]>summary .name{color:#2563eb}
.code{margin:4px 0 10px;border:1px solid #e5e7eb;border-radius:6px;overflow:auto;max-height:420px;font-size:11.5px}
.code pre{margin:0;padding:8px 10px}.code .loc{font:11px ui-monospace,Menlo,monospace;color:#6b7280;padding:4px 10px;border-bottom:1px solid #f3f4f6;background:#f9fafb}
.sub2{margin-left:12px;border-left:2px solid #e5e7eb;padding-left:8px}.nocode{color:#9ca3af;font-size:12px;padding:4px 0}


.bar-top{display:flex;align-items:center;gap:10px;margin-bottom:4px}
.run{margin-left:auto;border:1px solid #2563eb;background:#2563eb;color:#fff;border-radius:8px;padding:5px 14px;font:600 12px Inter,system-ui;cursor:pointer}
.run[disabled]{background:#93c5fd;border-color:#93c5fd;cursor:default}
.status{color:#6b7280;font-size:12px}
body.running .kpis,body.running h2,body.running details,body.running .grp,body.running .f{display:none}
#prog:not(:empty){margin:4px 0 14px;padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px;background:#f9fafb}
.pbar{display:flex;height:14px;border-radius:7px;background:#e5e7eb;overflow:hidden}.pbar i{display:block;height:100%;transition:width .4s}
.pp{background:#22c55e}.pf{background:#ef4444}.ps{background:#9ca3af}
.pnum{margin-top:6px;font-size:12px;color:#374151;font-variant-numeric:tabular-nums}.okc{color:#16a34a}.badc{color:#dc2626}
.pcur{font:11px ui-monospace,Menlo,monospace;color:#6b7280;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pfl{margin-top:6px;font:11px ui-monospace,Menlo,monospace;color:#b91c1c;max-height:160px;overflow:auto}
`;
