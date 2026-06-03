const invoke = (c, a) => window.__TAURI__.core.invoke(c, a);
const img = document.getElementById("screen"), ph = document.getElementById("ph"),
      frame = document.getElementById("frame"), core = document.getElementById("core"),
      pill = document.getElementById("pill"), pilltext = document.getElementById("pilltext");
let dev = { width: 1080, height: 2400 }, armed = false, live = false;

function toast(m){const t=document.getElementById("toast");t.textContent=m;t.classList.add("show");clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove("show"),1400);}
function setPill(state, txt){pill.className="pill "+state;pilltext.textContent=txt;}

async function pollStatus(){
  try{
    const s = await invoke("boot_status");
    if(s==="ready"){ setPill("ready","ready"); if(!dev._got){ try{dev=await invoke("screen_size");dev._got=true;}catch{} } live=true; }
    else if(s==="booting"){ setPill("booting","booting…"); live=false; }
    else { setPill("off","no device"); live=false; }
  }catch(e){ setPill("off","no device"); live=false; }
}
async function refresh(){
  if(!live){ img.style.display="none"; ph.style.display="flex"; return; }
  try{ const b64 = await invoke("screenshot"); img.src="data:image/png;base64,"+b64; img.style.display="block"; ph.style.display="none"; }
  catch(e){ /* transient */ }
}
function startApp(){ setInterval(pollStatus, 1500); pollStatus(); setInterval(refresh, 800); refresh(); }

// ---- touchscreen ----
function toDevice(e){const r=img.getBoundingClientRect();return{x:Math.round((e.clientX-r.left)/r.width*dev.width),y:Math.round((e.clientY-r.top)/r.height*dev.height),dx:e.clientX-r.left,dy:e.clientY-r.top};}
function ripple(x,y){const s=document.createElement("span");s.className="ripple";s.style.left=x+"px";s.style.top=y+"px";core.appendChild(s);setTimeout(()=>s.remove(),560);}
let down=null;
img.addEventListener("pointerdown",e=>{down=toDevice(e);});
img.addEventListener("pointerup",async e=>{if(!down)return;const up=toDevice(e);ripple(up.dx,up.dy);const d=Math.hypot(up.x-down.x,up.y-down.y);
  try{ if(d>24){await invoke("swipe",{x1:down.x,y1:down.y,x2:up.x,y2:up.y,ms:240});} else {await invoke("tap",{x:up.x,y:up.y});} }catch(err){} down=null;});

// ---- physical keyboard ----
function arm(on){armed=on;frame.classList.toggle("armed",on);
  document.getElementById("hint").innerHTML=on?'keyboard <b>armed</b> — type now · esc to release':'tap the screen to focus — then just <b>type on your keyboard</b>';}
frame.addEventListener("focus",()=>arm(true));
frame.addEventListener("blur",()=>arm(false));
frame.addEventListener("click",()=>frame.focus());
frame.addEventListener("keydown",async e=>{
  if(e.key==="Escape"){frame.blur();return;}
  if(e.metaKey||e.ctrlKey||e.altKey)return;
  try{
    if(e.key==="Enter"){e.preventDefault();await invoke("press_key",{key:"enter"});return;}
    if(e.key==="Backspace"){e.preventDefault();await invoke("press_key",{key:"delete"});return;}
    if(e.key==="Tab"){e.preventDefault();await invoke("press_key",{key:"tab"});return;}
    if(e.key===" "){e.preventDefault();await invoke("press_key",{key:"space"});return;}
    if(e.key.length===1){e.preventDefault();await invoke("type_text",{text:e.key});}
  }catch(err){}
});

// ---- device controls ----
document.getElementById("start").onclick=async()=>{try{const m=await invoke("start_device");toast(m);}catch(e){toast("start failed");}};
document.getElementById("stop").onclick=async()=>{try{await invoke("stop_device");toast("stopped");live=false;}catch(e){}};
document.getElementById("reset").onclick=()=>{dev._got=false;toast("view reset");};
document.querySelectorAll("[data-key]").forEach(b=>b.onclick=async()=>{try{await invoke("press_key",{key:b.dataset.key});toast(b.dataset.key);}catch(e){}});

// ---- launcher ----
document.getElementById("open").onclick=async()=>{const p=document.getElementById("pkg").value.trim();if(p){try{await invoke("open_app",{package:p});toast("run "+p);}catch(e){toast("invalid package");}}};
document.getElementById("pkg").addEventListener("keydown",e=>{if(e.key==="Enter")document.getElementById("open").click();});
document.querySelectorAll("[data-pkg]").forEach(b=>b.onclick=async()=>{try{await invoke("open_app",{package:b.dataset.pkg});toast("run "+b.dataset.pkg);}catch(e){}});

// ---- MCP copy ----
document.querySelectorAll("[data-client]").forEach(b=>b.onclick=async()=>{
  try{ const cfg=await invoke("mcp_config",{client:b.dataset.client}); await navigator.clipboard.writeText(cfg); toast("MCP config copied"); }
  catch(e){ toast("copy failed"); }
});

// ---- first-run setup / bootstrap ----
const ev = window.__TAURI__.event;
const $ = id => document.getElementById(id);
function setProgress(pct, msg){
  if(msg!=null) $("setup-phase").innerHTML = msg;
  if(pct!=null){ const p=Math.max(2,Math.min(100,pct)); $("setup-fill").style.width=p+"%"; $("setup-pct").textContent=Math.round(pct)+"%"; }
}
async function boot(){
  let status = "missing";
  try{ status = await invoke("runtime_status"); }catch(e){}
  if(status === "ready"){ startApp(); return; }
  $("setup").classList.add("show");
  await ev.listen("setup-progress", e=>{ const p=e.payload||{}; setProgress(p.pct, p.msg); });
  await ev.listen("setup-done", ()=>{ setProgress(100, "<b>fertig!</b> starte dein handy…"); });
  try{ await invoke("start_setup"); }
  catch(e){ setProgress(null, "setup-fehler: "+e+" — bitte neu starten"); return; }
  try{ await invoke("start_device"); }catch(e){}
  $("setup").classList.remove("show");
  startApp();
}
boot();
