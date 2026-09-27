/** GET /whisper — live microphone transcription page: partial text updates while speaking, finalized per pause. */
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
<p class="mt-2 text-sm text-subtle">Turn the mic on and talk. Gray text is the running guess, it becomes final after a short pause. <b>Clap</b> to start a new block.</p>
<div class="mt-5 grid gap-3 sm:grid-cols-[1fr_1fr_3fr]">
 <label class="text-xs text-faint">Model<select id="l-model" class="${input} mt-1 w-full">${opt}</select></label>
 <label class="text-xs text-faint">Language<select id="l-lang" class="${input} mt-1 w-full"><option value="auto">auto</option><option value="ru" selected>ru</option><option value="en">en</option><option value="pt">pt</option></select></label>
 <label class="text-xs text-faint">Vocabulary prompt<input id="l-prompt" class="${input} mt-1 w-full" value="hyper, agent, procs.db.select, git commit, steer, delegate, Claude, Postgres"></label>
</div>
<div class="mt-5 flex flex-wrap items-center gap-4">
 <button id="l-btn" type="button" class="btn btn-primary px-6 py-3 text-base">🎙 Start</button>
 <button id="l-clear" type="button" class="btn">Clear</button>
 <div class="h-2 w-40 overflow-hidden rounded bg-black/10"><div id="l-lvl" class="h-full w-0 bg-green-500 transition-[width] duration-75"></div></div>
 <label class="text-xs text-faint">Clap sensitivity <input id="l-clap" type="range" min="0.1" max="0.8" step="0.05" value="0.2" class="align-middle"></label>
 <span id="l-clapdbg" class="font-mono text-xs text-faint"></span>
 <span id="l-clapflash" class="rounded-full px-2 py-1 text-xs opacity-0 transition-opacity duration-300 bg-yellow-400 text-black">👏 new block</span>
 <span id="l-st" class="text-sm text-faint">off</span>
</div>
<div id="l-blocks" class="mt-6 space-y-3"></div>
</div>
<script>(function(){
const $=id=>document.getElementById(id), btn=$('l-btn'), st=$('l-st'), blocks=$('l-blocks');
let ac=null, stream=null, node=null, on=false;
let buf=[], len=0, speech=false, silentMs=0, speechMs=0, inflight=false, lastSend=0, gen=0;
const SR=16000, SIL_RMS=0.012, END_SIL=700, MAX_SEC=25, PARTIAL_EVERY=600;
let cur=null, n=0;
function newBlock(){ n++; const d=document.createElement('div'); d.className='rounded-2xl border border-line p-5';
  d.innerHTML='<div class="mb-2 flex justify-between text-xs text-faint"><span>block '+n+'</span><span>'+new Date().toLocaleTimeString()+'</span></div><div class="text-xl leading-relaxed"><span data-f></span> <span data-p class="text-faint"></span></div>';
  if(cur) cur.classList.add('opacity-70'); blocks.prepend(d); cur=d; }
const F=()=>cur.querySelector('[data-f]'), P=()=>cur.querySelector('[data-p]');
newBlock();
function wav(chunks,n){ const b=new ArrayBuffer(44+n*2), v=new DataView(b); const w=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i))};
  w(0,'RIFF');v.setUint32(4,36+n*2,true);w(8,'WAVE');w(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
  v.setUint32(24,SR,true);v.setUint32(28,SR*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);w(36,'data');v.setUint32(40,n*2,true);
  let o=44; for(const c of chunks) for(let i=0;i<c.length;i++){const s=Math.max(-1,Math.min(1,c[i]));v.setInt16(o,s<0?s*0x8000:s*0x7fff,true);o+=2} return b; }
async function ask(chunks,n){ const q=new URLSearchParams({model:$('l-model').value,language:$('l-lang').value,prompt:$('l-prompt').value});
  const r=await fetch('/whisper/live?'+q,{method:'POST',headers:{'content-type':'audio/wav'},body:wav(chunks,n)}); return r.json(); }
const junk=t=>!t||/^[\\s.,!?…-]*$/.test(t)||/^\\[.*\\]$|^\\(.*\\)$|^\\*.*\\*$/.test(t)||/Продолжение следует|Субтитры|Thank you for watching|аплодисмент|applause/i.test(t);
async function partial(){ if(inflight||!len) return; inflight=true; const my=gen, t=performance.now();
  try{ const j=await ask(buf.slice(),len); if(my===gen&&!j.error){ P().textContent=junk(j.text)?'':j.text; st.textContent='listening · '+Math.round(performance.now()-t)+' ms'; } if(j.error) st.textContent=j.error; }
  catch(e){ st.textContent=String(e) } finally{ inflight=false } }
function reset(){ buf=[];len=0;speech=false;silentMs=0;speechMs=0; gen++; }
async function finalize(){ const chunks=buf, cnt=len; reset(); const my=gen, blk=cur;
  const f=blk.querySelector('[data-f]'), p=blk.querySelector('[data-p]');
  if(cnt<SR*0.3){ p.textContent=''; return; }
  p.textContent=(p.textContent||'')+' …';
  try{ const j=await ask(chunks,cnt); if(!junk(j.text)) f.textContent+=((f.textContent?' ':'')+j.text); }
  catch(e){ st.textContent=String(e) } if(my===gen||blk!==cur) p.textContent=''; }
// clap: sudden loud peak (≥ threshold, far above recent level) that decays within ~150 ms
let env=0.01, envPk=0.02, clapCand=null, clapCooldown=0, maxPk=0, maxT=0;
let decT=0; function dbg(t,d){ if(d) decT=performance.now(); else if(performance.now()-decT<2500) return; $('l-clapdbg').textContent=t; }
function clap(){ const fl=$('l-clapflash'); fl.style.opacity='1'; setTimeout(()=>fl.style.opacity='0',900);
  // drop audio around the clap, finalize what came before it, then open a new block
  const pre=clapCand.preChunks, preLen=clapCand.preLen; buf=pre; len=preLen;
  if(speech&&preLen>SR*0.3) finalize(); else { reset(); if(cur) cur.querySelector('[data-p]').textContent=''; }
  newBlock(); clapCooldown=SR*0.8; }
function onAudio(e){ const x=e.inputBuffer.getChannelData(0); const L=x.length;
  // analyse in 256-sample (16 ms) frames for transient detection
  const th=+$('l-clap').value;
  for(let o=0;o<L;o+=256){ let pk=0,s=0; for(let i=o;i<o+256&&i<L;i++){const a=Math.abs(x[i]); if(a>pk)pk=a; s+=a*a;} const r=Math.sqrt(s/256);
    if(clapCooldown>0){ clapCooldown-=256; continue; }
    if(pk>maxPk||performance.now()-maxT>1500){ maxPk=pk; maxT=performance.now(); }
    if(clapCand){ clapCand.after+=256;
      if(clapCand.after<=SR*0.03){ clapCand.peakRms=Math.max(clapCand.peakRms,r); }
      else if(clapCand.after<SR*0.16){ clapCand.tail+=r; clapCand.tailN++; }
      else { const ratio=Math.max(0,clapCand.tail/clapCand.tailN-clapCand.bg)/Math.max(1e-6,clapCand.peakRms-clapCand.bg); const c=clapCand; clapCand=null;
        dbg('peak '+c.pk.toFixed(2)+' · decay '+ratio.toFixed(2)+(ratio<0.4?' → 👏':' → speech'),1);
        if(ratio<0.4){ clapCand=c; clap(); clapCand=null; return; } } }
    else if(pk>th && pk>envPk*5){ clapCand={pk,bg:env,peakRms:r,after:0,tail:0,tailN:0,preChunks:buf.slice(),preLen:len}; }
    if(!clapCand){ env=env*0.95+r*0.05; envPk=envPk*0.9+pk*0.1; } }
  if(!clapCand) dbg('max peak '+maxPk.toFixed(2)+' / threshold '+th);
  let s=0; for(let i=0;i<L;i++) s+=x[i]*x[i]; const rms=Math.sqrt(s/L);
  $('l-lvl').style.width=Math.min(100,rms*800)+'%'; const ms=L/SR*1000;
  if(rms>SIL_RMS){ speech=true; silentMs=0; speechMs+=ms } else silentMs+=ms;
  if(!speech){ buf=[new Float32Array(x)]; len=L; return; }
  buf.push(new Float32Array(x)); len+=L;
  if(clapCand) return; // wait until clap decision before finalizing/partials
  if((silentMs>END_SIL&&speechMs>200) || len>SR*MAX_SEC) { finalize(); return; }
  const now=performance.now(); if(now-lastSend>PARTIAL_EVERY){ lastSend=now; partial(); } }
async function start(){ try{ stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1}}); }
  catch(e){ st.textContent='mic error: '+e.message; return; }
  ac=new AudioContext({sampleRate:SR}); const src=ac.createMediaStreamSource(stream); node=ac.createScriptProcessor(2048,1,1);
  node.onaudioprocess=onAudio; src.connect(node); node.connect(ac.destination); on=true; btn.textContent='■ Stop'; st.textContent='warming up model…';
  ask([new Float32Array(SR/2)],SR/2).then(()=>{ if(on) st.textContent='listening' }); }
function stop(){ on=false; if(len&&speech) finalize(); node&&node.disconnect(); ac&&ac.close(); stream&&stream.getTracks().forEach(t=>t.stop()); btn.textContent='🎙 Start'; st.textContent='off'; $('l-lvl').style.width='0'; }
btn.onclick=()=>on?stop():start(); $('l-clear').onclick=()=>{ blocks.innerHTML=''; cur=null; n=0; newBlock(); };
})();</script>`,
    };
}
