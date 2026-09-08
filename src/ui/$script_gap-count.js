// Read-only aggregate updates reuse the shared SSE stream; polling only reads cache.
(() => {
 if(window.__gapCountInstalled)return;window.__gapCountInstalled=true;
 let pending=false;
 async function refresh(){
  if(pending || !document.getElementById('gap-count-badge'))return;
  pending=true;
  try{const response=await fetch('/ui/gap-count',{cache:'no-store'});if(response.ok){const html=await response.text();const badge=document.getElementById('gap-count-badge');if(badge)badge.outerHTML=html;}}catch{}finally{pending=false;}
 }
 document.addEventListener('hyper-events',event=>{if(event.detail?.type==='flow.count')refresh();});
 document.addEventListener('htmx:load',refresh);
 setInterval(refresh,300000);
 refresh();
})();
