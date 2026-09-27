/** GET /whisper — microphone test bench for local whisper.cpp transcription. */
export default async function (ctx: Context, _session: Session | null, _opts: { req: Request; params: Record<string, string> }) {
    const { models } = await ctx.fns.whisper.models({});
    const esc = (s: string) => Bun.escapeHTML(s);
    const opt = models.map((m) => `<option value="${esc(m.name)}"${m.name === "large-v3-turbo" ? " selected" : ""}>${esc(m.name)} · ${m.sizeMb} MB</option>`).join("");
    const input = "rounded-lg border border-line bg-transparent px-3 py-2 text-sm";
    const prompt = "hyper, agent, procs.db.select, git commit, steer, delegate, Claude, Postgres";
    return {
        title: "Whisper",
        main: `<div class="mx-auto w-full max-w-3xl p-5 sm:p-8">
<div class="mb-2 text-xs font-medium uppercase tracking-[.18em] text-primary">Local speech-to-text</div>
<h1 class="text-3xl font-semibold">Whisper</h1>
<p class="mt-2 text-sm text-subtle">whisper.cpp on Metal. Hold <b>Space</b> (or the button) to talk, release to transcribe. Nothing leaves this machine.</p>
<div class="mt-6 grid gap-3 sm:grid-cols-3">
 <label class="text-xs text-faint">Model<select id="w-model" class="${input} mt-1 w-full">${opt}</select></label>
 <label class="text-xs text-faint">Language<select id="w-lang" class="${input} mt-1 w-full"><option value="auto">auto</option><option value="ru">ru</option><option value="en">en</option><option value="pt">pt</option></select></label>
 <label class="text-xs text-faint">Compare<select id="w-cmp" class="${input} mt-1 w-full"><option value="">— single model —</option><option value="all">all models</option></select></label>
</div>
<label class="mt-3 block text-xs text-faint">Vocabulary prompt<input id="w-prompt" class="${input} mt-1 w-full" value="${esc(prompt)}"></label>
<div class="mt-6 flex items-center gap-4">
 <button id="w-rec" type="button" class="btn btn-primary select-none px-6 py-3 text-base">🎙 Hold to talk</button>
 <span id="w-status" class="text-sm text-faint">idle</span>
</div>
<div id="w-out" class="mt-6 space-y-3"></div>
</div>
<script>(function(){
const $=id=>document.getElementById(id), btn=$('w-rec'), st=$('w-status'), out=$('w-out');
const models=${JSON.stringify(models.map((m) => m.name))};
let rec=null, chunks=[], stream=null, t0=0, busy=false;
async function start(){ if(rec||busy) return;
  try{ stream=stream||await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}}); }
  catch(e){ st.textContent='mic error: '+e.message; return; }
  chunks=[]; rec=new MediaRecorder(stream); rec.ondataavailable=e=>e.data.size&&chunks.push(e.data);
  rec.onstop=send; rec.start(); t0=Date.now(); st.textContent='● recording…'; btn.classList.add('ring-4','ring-red-500'); }
function stop(){ if(!rec) return; rec.stop(); rec=null; btn.classList.remove('ring-4','ring-red-500'); }
async function one(blob, model){
  const fd=new FormData(); fd.append('audio',blob,'a.webm'); fd.append('model',model);
  fd.append('language',$('w-lang').value); fd.append('prompt',$('w-prompt').value);
  const t=performance.now(); const r=await fetch('/whisper/transcribe',{method:'POST',body:fd}); const j=await r.json();
  j.totalMs=Math.round(performance.now()-t); return j; }
function card(j){ const d=document.createElement('div'); d.className='rounded-xl border border-line p-4';
  const meta=document.createElement('div'); meta.className='mb-1 text-xs text-faint';
  meta.textContent=j.error? 'error' : j.model+' · '+j.audioSec+'s audio · whisper '+j.whisperMs+' ms · total '+j.totalMs+' ms';
  const tx=document.createElement('div'); tx.className=j.error?'text-sm text-danger':'text-lg'; tx.textContent=j.error||j.text||'(empty)';
  d.append(meta,tx); return d; }
async function send(){ const blob=new Blob(chunks,{type:chunks[0]?.type||'audio/webm'});
  if(Date.now()-t0<300){ st.textContent='too short'; return; }
  busy=true; st.textContent='transcribing…';
  const list=$('w-cmp').value==='all'?models:[$('w-model').value];
  const group=document.createElement('div'); group.className='space-y-2'; out.prepend(group);
  for(const m of list){ try{ group.append(card(await one(blob,m))); }catch(e){ group.append(card({error:String(e)})); } }
  busy=false; st.textContent='idle'; }
btn.addEventListener('pointerdown',e=>{e.preventDefault();start()});
btn.addEventListener('pointerup',stop); btn.addEventListener('pointerleave',stop);
document.addEventListener('keydown',e=>{ if(e.code==='Space'&&!e.repeat&&!/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)){e.preventDefault();start()} });
document.addEventListener('keyup',e=>{ if(e.code==='Space'&&!/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)){e.preventDefault();stop()} });
})();</script>`,
    };
}
