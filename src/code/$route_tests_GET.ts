/** GET /code/tests?kind=fast|it|live|all[&picked=1] — the last run of that kind of tests (code.tests), or of the last picked files, as a page with kind tabs, a Run button and a file picker; the Tests canvas frames it. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request }) {
    const q = new URL(opts.req.url).searchParams.get("kind") ?? "fast";
    const kind = (["fast", "it", "live", "all"].includes(q) ? q : "fast") as types.code.TestKind;
    const picked = new URL(opts.req.url).searchParams.get("picked") === "1";
    const data = await ctx.fns.code.tests({ kind, picked });
    const json = JSON.stringify(data ?? null).replace(/</g, "\\u003c");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Tests</title><style>${CSS}</style></head>
<body><div id=app></div><script>window.TESTS=${json};window.TEST_KIND=${JSON.stringify(kind)};window.TEST_PICKED=${picked};</script><script src="/code/tests.js"></script></body></html>`;
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
.kinds{display:flex;gap:4px;margin:0 0 10px}.kinds a{border:1px solid #e5e7eb;border-radius:8px;padding:4px 10px;color:#374151;text-decoration:none;font-size:12px}
.kinds a.on{background:#111827;border-color:#111827;color:#fff}.kinds a small{color:#9ca3af;margin-left:4px}.kinds a.on small{color:#d1d5db}
.empty{color:#6b7280;padding:24px 0}
.rerun{border:1px solid #d1d5db;border-radius:6px;padding:1px 7px;background:#fff;font:500 11px system-ui;color:#374151;cursor:pointer;margin-left:6px;text-transform:none;letter-spacing:0}
.kinds .sep{flex:1}.kinds button{border:1px solid #e5e7eb;border-radius:8px;padding:4px 10px;background:#fff;font-size:12px;cursor:pointer}
.kinds button.on{background:#eff6ff;border-color:#93c5fd}
#pick{border:1px solid #e5e7eb;border-radius:10px;padding:10px;margin:0 0 12px;display:none}#pick.open{display:block}
#pick .ptools{display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap}
#pick input[type=search]{flex:1;min-width:200px;border:1px solid #d1d5db;border-radius:6px;padding:4px 8px;font-size:12px}
#pick .ptools button{border:1px solid #d1d5db;border-radius:6px;padding:3px 8px;background:#fff;font-size:12px;cursor:pointer}
#pick .ptools .go{background:#2563eb;border-color:#2563eb;color:#fff}#pick .ptools .go:disabled{opacity:.5}
#pick .plist{max-height:320px;overflow:auto;font:12px ui-monospace,monospace}
#pick label{display:grid;grid-template-columns:18px 1fr 60px 60px;gap:6px;padding:2px 4px;border-radius:4px;cursor:pointer}
#pick label:hover{background:#f9fafb}#pick label .fl{color:#dc2626}#pick label .n{color:#9ca3af;text-align:right}
body.norun .kpis,body.norun h2,body.norun details{display:none}body.running .empty{display:none}
body.running .kpis,body.running h2,body.running details,body.running .grp,body.running .f{display:none}
#prog:not(:empty){margin:4px 0 14px;padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px;background:#f9fafb}
.pbar{display:flex;height:14px;border-radius:7px;background:#e5e7eb;overflow:hidden}.pbar i{display:block;height:100%;transition:width .4s}
.pp{background:#22c55e}.pf{background:#ef4444}.ps{background:#9ca3af}
.pnum{margin-top:6px;font-size:12px;color:#374151;font-variant-numeric:tabular-nums}.okc{color:#16a34a}.badc{color:#dc2626}
.pcur{font:11px ui-monospace,Menlo,monospace;color:#6b7280;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pfl{margin-top:6px;font:11px ui-monospace,Menlo,monospace;color:#b91c1c;max-height:160px;overflow:auto}
`;
