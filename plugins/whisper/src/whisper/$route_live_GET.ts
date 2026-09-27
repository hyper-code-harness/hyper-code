/** GET /whisper/live — live microphone transcription page: partial text updates while speaking, finalized per pause. */
export default async function (ctx: Context, _session: Session | null, _opts: { req: Request; params: Record<string, string> }) {
    const { models } = await ctx.fns.whisper.models({});
    const esc = (s: string) => Bun.escapeHTML(s);
    const opt = models.map((m) => `<option value="${esc(m.name)}"${m.name === "large-v3-turbo" ? " selected" : ""}>${esc(m.name)}</option>`).join("");
    const input = "rounded-lg border border-line bg-transparent px-3 py-2 text-sm";
    return {
        title: "Whisper live",
        main: `<div class="mx-auto w-full max-w-4xl p-5 sm:p-8">
<div class="mb-2 text-xs font-medium uppercase tracking-[.18em] text-primary">Local speech-to-text · live</div>
<h1 class="text-3xl font-semibold">Whisper live</h1>
<p class="mt-2 text-sm text-subtle">Turn the mic on and talk. Gray text is the running guess, it becomes final after a short pause. <a class="text-primary" href="/whisper">push-to-talk bench →</a></p>
<div class="mt-5 grid gap-3 sm:grid-cols-[1fr_1fr_3fr]">
 <label class="text-xs text-faint">Model<select id="l-model" class="${input} mt-1 w-full">${opt}</select></label>
 <label class="text-xs text-faint">Language<select id="l-lang" class="${input} mt-1 w-full"><option value="auto">auto</option><option value="ru" selected>ru</option><option value="en">en</option><option value="pt">pt</option></select></label>
 <label class="text-xs text-faint">Vocabulary prompt<input id="l-prompt" class="${input} mt-1 w-full" value="hyper, agent, procs.db.select, git commit, steer, delegate, Claude, Postgres"></label>
</div>
<div class="mt-5 flex flex-wrap items-center gap-4">
 <button id="l-btn" type="button" class="btn btn-primary px-6 py-3 text-base">🎙 Start</button>
 <button id="l-clear" type="button" class="btn">Clear</button>
 <div class="h-2 w-40 overflow-hidden rounded bg-black/10"><div id="l-lvl" class="h-full w-0 bg-green-500 transition-[width] duration-75"></div></div>
 <span id="l-st" class="text-sm text-faint">off</span>
</div>
<div class="mt-6 min-h-[40vh] rounded-2xl border border-line p-5 text-xl leading-relaxed"><span id="l-final"></span> <span id="l-part" class="text-faint"></span></div>
</div>
<script>(function(){
const $=id=>document.getElementById(id), btn=$('l-btn'), st=$('l-st');
let ac=null, stream=null, node=null, on=false;
let buf=[], len=0, speech=false, silentMs=0, speechMs=0, inflight=false, lastSend=0, gen=0;
const SR=16000, SIL_RMS=0.012, END_SIL=700, MAX_SEC=25, PARTIAL_EVERY=600;
function wav(chunks,n){ const b=new ArrayBuffer(44+n*2), v=new DataView(b); const w=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i))};
  w(0,'RIFF');v.setUint32(4,36+n*2,true);w(8,'WAVE');w(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
  v.setUint32(24,SR,true);v.setUint32(28,SR*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);w(36,'data');v.setUint32(40,n*2,true);
  let o=44; for(const c of chunks) for(let i=0;i<c.length;i++){const s=Math.max(-1,Math.min(1,c[i]));v.setInt16(o,s<0?s*0x8000:s*0x7fff,true);o+=2} return b; }
async function ask(chunks,n){ const q=new URLSearchParams({model:$('l-model').value,language:$('l-lang').value,prompt:$('l-prompt').value});
  const r=await fetch('/whisper/live?'+q,{method:'POST',headers:{'content-type':'audio/wav'},body:wav(chunks,n)}); return r.json(); }
const junk=t=>!t||/^[\\s.,!?…-]*$/.test(t)||/^\\[.*\\]$|^\\(.*\\)$/.test(t)||/Продолжение следует|Субтитры|Thank you for watching/i.test(t);
async function partial(){ if(inflight||!len) return; inflight=true; const my=gen; const t=performance.now();
  try{ const j=await ask(buf.slice(),len); if(my===gen&&!j.error) { $('l-part').textContent=junk(j.text)?'':j.text; st.textContent='listening · '+Math.round(performance.now()-t)+' ms'; } if(j.error) st.textContent=j.error; }
  catch(e){ st.textContent=String(e) } finally{ inflight=false } }
async function finalize(){ const chunks=buf, n=len; buf=[];len=0;speech=false;silentMs=0;speechMs=0; gen++; const my=gen;
  if(n<SR*0.3) { $('l-part').textContent=''; return; }
  const part=$('l-part'); part.textContent=(part.textContent||'')+' …';
  try{ const j=await ask(chunks,n); if(!junk(j.text)) $('l-final').textContent+=(($('l-final').textContent?' ':'')+j.text); }
  catch(e){ st.textContent=String(e) } if(my===gen) part.textContent=''; }
function onAudio(e){ const x=e.inputBuffer.getChannelData(0); let s=0; for(let i=0;i<x.length;i++) s+=x[i]*x[i]; const rms=Math.sqrt(s/x.length);
  $('l-lvl').style.width=Math.min(100,rms*800)+'%'; const ms=x.length/SR*1000;
  if(rms>SIL_RMS){ speech=true; silentMs=0; speechMs+=ms } else silentMs+=ms;
  if(!speech){ buf=[new Float32Array(x)]; len=x.length; return; } // keep a little pre-roll
  buf.push(new Float32Array(x)); len+=x.length;
  if((silentMs>END_SIL&&speechMs>200) || len>SR*MAX_SEC) { finalize(); return; }
  const now=performance.now(); if(now-lastSend>PARTIAL_EVERY){ lastSend=now; partial(); } }
async function start(){ try{ stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1}}); }
  catch(e){ st.textContent='mic error: '+e.message; return; }
  ac=new AudioContext({sampleRate:SR}); const src=ac.createMediaStreamSource(stream); node=ac.createScriptProcessor(2048,1,1);
  node.onaudioprocess=onAudio; src.connect(node); node.connect(ac.destination); on=true; btn.textContent='■ Stop'; st.textContent='warming up model…';
  ask([new Float32Array(SR/2)],SR/2).then(()=>{ if(on) st.textContent='listening' }); }
function stop(){ on=false; if(len&&speech) finalize(); node&&node.disconnect(); ac&&ac.close(); stream&&stream.getTracks().forEach(t=>t.stop()); btn.textContent='🎙 Start'; st.textContent='off'; $('l-lvl').style.width='0'; }
btn.onclick=()=>on?stop():start(); $('l-clear').onclick=()=>{ $('l-final').textContent=''; $('l-part').textContent=''; };
})();</script>`,
    };
}
