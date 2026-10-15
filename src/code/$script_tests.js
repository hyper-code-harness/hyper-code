// Tests page body: draws window.TESTS (code.tests) and drives the Run button.
(() => {
const empty = !window.TESTS;
if (empty) window.TESTS = { top: [], slowTests: [], fails: [], wall: 0, tests: 0, nfiles: 0, failures: 0, skipped: 0, total: 0 };

const KIND = window.TEST_KIND || "fast";
const KINDS = [["fast", "Fast", "*.test.ts"], ["it", "Integration", "*.it.test.ts"], ["live", "Live", "*.live.test.ts"], ["all", "All", "fast + it"]];
const D=window.TESTS, esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const max=D.top[0]?.ms||1, cls=ms=>ms>10000?'very':ms>5000?'hot':'';
const code=x=>x.code?`<div class=code><div class=loc>${esc(x.file)}:${x.code.line}</div>${x.code.html}</div>`:'<div class=nocode>code not found</div>';
const byFile={}; for(const f of D.fails)(byFile[f.file]??=[]).push(f);
app.innerHTML=`<div class=bar-top><h1>Tests</h1><span class=status id=status></span><button class=run id=run>Run ${esc(KINDS.find(k=>k[0]===KIND)[1].toLowerCase())}</button></div>
<div class=kinds>${KINDS.map(([k,l,h])=>`<a href="?kind=${k}" class="${k===KIND?'on':''}" title="${esc(h)}">${l}<small>${esc(h)}</small></a>`).join('')}</div>
<div class=sub>bun run test${KIND==='fast'?'':':'+KIND} · script/test.ts · --parallel=16 --no-isolate · test Postgres :54399</div>
${empty?`<div class=empty>No ${esc(KIND)} run recorded yet — press Run.</div>`:''}
<div class=kpis><div class=k><b>${D.wall.toFixed(0)} s</b><span>run</span></div><div class=k><b>${D.tests}</b><span>tests · ${D.nfiles} files</span></div>
<div class="k ok"><b>${D.tests-D.failures-D.skipped}</b><span>passed</span></div><div class="k bad"><b>${D.failures}</b><span>failed</span></div>
<div class=k><b>${(D.total/1000).toFixed(0)} s</b><span>total file time</span></div></div>
<h2>Top 10 slowest files</h2>${D.top.map(x=>`<details><summary class=row><div class=name title="${esc(x.f)}">${esc(x.f.replace(/^src\//,''))}</div><div><div class="bar ${cls(x.ms)}" style="width:${(x.ms/max*100).toFixed(1)}%"></div></div><div class=v>${(x.ms/1000).toFixed(1)} s</div></summary><div class=sub2>${(x.tests||[]).map(t=>`<details><summary class=row><div class=name>${esc((t.cls?t.cls+' › ':'')+t.name)}</div><div><div class="bar ${cls(t.s*1000)}" style="width:${(t.s/(x.tests[0].s||1)*100).toFixed(1)}%"></div></div><div class=v>${t.s.toFixed(2)} s</div></summary>${code(t)}</details>`).join('')||'<div class=nocode>no tests</div>'}</div></details>`).join('')}
<h2>Top 10 slowest tests</h2>${D.slowTests.map(x=>`<details><summary class=row><div class=name title="${esc(x.file)}">${esc((x.cls?x.cls+' › ':'')+x.name)}</div><div><div class="bar ${cls(x.s*1000)}" style="width:${(x.s/(D.slowTests[0].s||1)*100).toFixed(1)}%"></div></div><div class=v>${x.s.toFixed(1)} s</div></summary>${code(x)}</details>`).join('')}
<h2>Failed · ${D.fails.length}</h2>${Object.entries(byFile).map(([f,l])=>`<div class=grp>${esc(f)}</div>${l.map(x=>`<details class=f><summary><div class=t>${esc((x.cls?x.cls+' › ':'')+x.name)}</div><div class=m>${x.msg}</div></summary>${code(x)}</details>`).join('')}`).join('')}`;

if (empty) document.body.classList.add("norun");
const btn = document.getElementById("run"), st = document.getElementById("status");
btn.dataset.label = btn.textContent;
const prog = document.createElement("div"); prog.id = "prog";
document.querySelector(".kpis").before(prog);
const fmt = ms => Math.round(ms / 1000) + " s";
function show(r) {
    // while a run is going the old report is stale: show only the live progress
    document.body.classList.toggle("running", !!r.running);
    btn.disabled = !!r.running;
    btn.textContent = r.running ? `Running ${r.kind || ""}…` : btn.dataset.label;
    if (!r.running) {
        st.textContent = D.at ? "run " + new Date(D.at).toLocaleString() : "";
        prog.innerHTML = "";
        return;
    }
    const done = r.pass + r.fail + r.skip, exp = Math.max(r.expected || 0, done, 1);
    const w = n => (n / exp * 100).toFixed(2) + "%";
    const el = Date.now() - r.startedAt, eta = done > 20 && r.expected > done ? el / done * (r.expected - done) : 0;
    st.textContent = "running " + (r.kind || "") + " " + fmt(el) + (eta ? " · remaining ~" + fmt(eta) : "");
    prog.innerHTML = `<div class=pbar><i class=pp style="width:${w(r.pass)}"></i><i class=pf style="width:${w(r.fail)}"></i><i class=ps style="width:${w(r.skip)}"></i></div>
<div class=pnum><b class=okc>${r.pass}</b> passed · <b class=badc>${r.fail}</b> failed · ${r.skip} skipped · ${done} / ~${r.expected || "?"} tests · files ${r.files} / ~${r.expectedFiles || "?"}</div>
<div class=pcur>${esc(r.current || "")}</div>
${r.failed.length ? `<div class=pfl>${r.failed.slice(-12).reverse().map(f => `<div>✕ ${esc(f)}</div>`).join("")}</div>` : ""}`;
}
async function poll() {
    const r = await (await fetch("/code/tests/status")).json();
    show(r);
    if (r.running) setTimeout(poll, 500);
    // reload onto the kind that just ran, so its fresh report is what shows
    else if (btn.dataset.waiting) location.href = "?kind=" + (r.kind || KIND);
}
btn.onclick = async () => {
    btn.dataset.waiting = "1";
    show(await (await fetch("/code/tests/run?kind=" + KIND, { method: "POST" })).json());
    poll();
};
if (D.run && D.run.running) { btn.dataset.waiting = "1"; poll(); } else show(D.run || { running: false });
})();
