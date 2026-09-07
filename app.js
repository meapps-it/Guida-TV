const DATA_URL = "./tv.json";
const FAVORITES_KEY = "guidatv_favorites_v1";
const CACHE_KEY = "guidatv_data_v4";
const IMAGE_CACHE_KEY = "guidatv_images_tvmaze_v2";
const PX_PER_MIN = 1.7;
const CHANNEL_COL = 112;

const state = {
  data: null,
  view: "now",
  query: "",
  favorites: new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]")),
  imageCache: JSON.parse(localStorage.getItem(IMAGE_CACHE_KEY) || "{}"),
  thumbsBusy: false
};

const $ = s => document.querySelector(s);
const content = $("#content");
const statusEl = $("#status");
const updatedEl = $("#updated");
const titleEl = $("#pageTitle");
const drawerOverlay = $("#drawerOverlay");
const modal = $("#detailModal");

let liveTickTimer = null;
let autoRefreshTimer = null;
let thumbTimer = null;

function refreshHeaderClock(){
  updatedEl.textContent = "Palinsesti italiani";
}

function startLiveTimers(){
  if(liveTickTimer) clearInterval(liveTickTimer);
  if(autoRefreshTimer) clearInterval(autoRefreshTimer);
  liveTickTimer = setInterval(()=>{
    if(!state.data) return;
    if(state.view === "timeline" || state.view === "now") render();
  }, 60000);
  autoRefreshTimer = setInterval(()=>{
    if(document.visibilityState === "visible") loadData(true);
  }, 5 * 60 * 1000);
}

function esc(s=""){
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}
function norm(s=""){
  return String(s).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
}
function fmtTime(ms){ return new Intl.DateTimeFormat("it-IT",{hour:"2-digit",minute:"2-digit"}).format(new Date(ms)); }
function fmtDate(d){ return new Intl.DateTimeFormat("it-IT",{weekday:"short",day:"2-digit",month:"2-digit"}).format(d); }
function sameDay(ms,date){ const d=new Date(ms); return d.getFullYear()===date.getFullYear()&&d.getMonth()===date.getMonth()&&d.getDate()===date.getDate(); }
function tomorrowDate(){ const d=new Date(); d.setDate(d.getDate()+1); return d; }
function clamp(n,a,b){ return Math.max(a,Math.min(b,n)); }
function programmeKey(channelId,p){ return `${channelId}|${p.start}|${p.title||""}`; }

function findProgramme(key){
  if(!state.data) return null;
  for(const ch of state.data.channels){
    const p=(state.data.programs[ch.id]||[]).find(x=>programmeKey(ch.id,x)===key);
    if(p) return {channel:ch,p};
  }
  return null;
}

function currentAndNext(programs,now){
  const current=programs.find(p=>p.start<=now&&p.stop>now);
  const next=programs.find(p=>p.start>=(current?current.stop:now));
  return {current,next};
}
function tonight(programs){
  const d=new Date();
  return programs.filter(p=>sameDay(p.start,d)&&new Date(p.start).getHours()>=20).slice(0,8);
}
function forDay(programs,d){ return programs.filter(p=>sameDay(p.start,d)).slice(0,24); }
function matches(channel,programs){
  if(!state.query) return true;
  const q=state.query.toLowerCase();
  return channel.name.toLowerCase().includes(q)||programs.some(p=>`${p.title||""} ${p.description||""} ${p.category||""}`.toLowerCase().includes(q));
}

function categoryTone(category=""){
  const c=category.toLowerCase();
  if(/sport|calcio|basket|tennis|motori|formula|ciclismo|olimpiadi/.test(c)) return "tone-b";
  if(/film|movie|cinema|serie|fiction|dramm|azione|thriller|crime|giallo|biograf/.test(c)) return "tone-c";
  if(/bamb|ragazzi|anim|cartoon|kids|famiglia/.test(c)) return "tone-d";
  if(/news|tg|attual|document|approfond|inform|talk/.test(c)) return "tone-e";
  return "tone-a";
}
function programmeTone(category=""){
  const tone = categoryTone(category);
  return ({"tone-a":"tone-general","tone-b":"tone-sport","tone-c":"tone-movie","tone-d":"tone-kids","tone-e":"tone-news"})[tone] || "tone-general";
}

function cleanTvmazeTitle(title=""){
  return title
    .replace(/\bS\d+\s*E\d+\b/ig,"")
    .replace(/\bSt\.?\s*\d+\s*Ep\.?\s*\d+\b/ig,"")
    .replace(/\bEp\.?\s*\d+\b/ig,"")
    .replace(/\(.*?\)/g,"")
    .replace(/\s+-\s+PrimaTV.*$/i,"")
    .replace(/\s+-\s+St\..*$/i,"")
    .replace(/["'`]/g,"")
    .replace(/\s{2,}/g," ").trim();
}

function getTitleVariants(title=""){
  const cleaned = cleanTvmazeTitle(title);
  const variants = new Set([cleaned]);
  if(cleaned.includes(":")) variants.add(cleaned.split(":")[0].trim());
  if(cleaned.includes(" - ")) variants.add(cleaned.split(" - ")[0].trim());
  if(cleaned.includes(" e poi")) variants.add(cleaned.split(" e poi")[0].trim());
  if(cleaned.includes("...")) variants.add(cleaned.replace(/\.{3,}/g,"").trim());
  return [...variants].filter(Boolean);
}

function getCachedImage(title){
  const key=norm(cleanTvmazeTitle(title));
  const item=state.imageCache[key];
  if(!item) return null;
  if(item.miss) return "";
  return item.url||"";
}

function saveImageCache(){
  const entries=Object.entries(state.imageCache).slice(-260);
  state.imageCache=Object.fromEntries(entries);
  localStorage.setItem(IMAGE_CACHE_KEY,JSON.stringify(state.imageCache));
}

function scoreTitleMatch(query,title){
  const q = norm(query);
  const t = norm(title);
  if(!q || !t) return 0;
  if(q === t) return 120;
  if(q.includes(t) || t.includes(q)) return 90;
  const qWords = new Set(q.split(" ").filter(Boolean));
  const tWords = new Set(t.split(" ").filter(Boolean));
  let overlap = 0;
  qWords.forEach(w=>{ if(tWords.has(w)) overlap++; });
  return overlap * 10;
}

async function fetchTvmazeImage(title){
  const variants = getTitleVariants(title);
  const cacheKey = norm(cleanTvmazeTitle(title));
  if(!cacheKey || cacheKey.length < 3) return "";
  if(state.imageCache[cacheKey]) return state.imageCache[cacheKey].url || "";

  for(const variant of variants){
    try{
      const r=await fetch(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(variant)}`);
      if(!r.ok) throw new Error("TVmaze");
      const rows=await r.json();
      let chosen=null;
      let bestScore=0;
      for(const row of rows.slice(0,8)){
        const show=row?.show;
        if(!show) continue;
        const score=scoreTitleMatch(variant, show.name || "");
        if(score > bestScore){ chosen=show; bestScore=score; }
      }
      const url=chosen?.image?.medium||chosen?.image?.original||"";
      if(url){
        state.imageCache[cacheKey]={url,source:chosen.url||"https://www.tvmaze.com"};
        saveImageCache();
        return url;
      }
    }catch(e){ /* ignore */ }
  }

  state.imageCache[cacheKey]={miss:true};
  saveImageCache();
  return "";
}

async function hydrateThumbnails(limit=24){
  if(state.thumbsBusy) return;
  const els=[...document.querySelectorAll(".thumb[data-title]")].filter(el=>!el.dataset.done).slice(0,limit);
  if(!els.length) return;
  state.thumbsBusy=true;
  for(const el of els){
    el.dataset.done="1";
    const title=el.dataset.title||"";
    let img=getCachedImage(title);
    if(img===null) img=await fetchTvmazeImage(title);
    if(img){
      const image=document.createElement("img");
      image.loading="lazy";
      image.alt="";
      image.src=img;
      image.onerror=()=>image.remove();
      el.prepend(image);
    }
    await new Promise(r=>setTimeout(r,90));
  }
  state.thumbsBusy=false;
  if(document.querySelector(".thumb[data-title]:not([data-done])")) scheduleThumbHydration();
}

function scheduleThumbHydration(){
  clearTimeout(thumbTimer);
  thumbTimer=setTimeout(()=>hydrateThumbnails(24),80);
}

function programmeHTML(channel,p,isNow=false){
  if(!p) return "";
  const key=programmeKey(channel.id,p);
  const pct=isNow?clamp(((Date.now()-p.start)/(p.stop-p.start))*100,0,100):0;
  const tone = programmeTone(p.category||"");
  const fallback=esc((p.category||"TV").split(/[,&]/)[0].trim().slice(0,18)||"TV");
  return `<article class="programme ${tone}" data-programme="${esc(key)}">
    <div class="thumb ${tone}" data-title="${esc(p.title||"")}" ${p.image?'data-done="1"':''}>${p.image?`<img src="${esc(p.image)}" alt="" loading="lazy">`:''}<span class="fallback">${fallback}</span><span class="time-tag">${fmtTime(p.start)}</span></div>
    <div>
      <div class="programme-title">${esc(p.title||"Programma")}</div>
      ${p.description?`<div class="programme-desc">${esc(p.description)}</div>`:""}
      ${p.category?`<span class="category">${esc(p.category)}</span>`:""}
      ${isNow?`<div class="progress"><i style="width:${pct.toFixed(1)}%"></i></div>`:""}
    </div>
  </article>`;
}

function channelCard(channel,programmes){
  const fav=state.favorites.has(channel.id);
  const initials=channel.name.replace(/[^A-Za-z0-9]/g,"").slice(0,4).toUpperCase();
  return `<section class="channel-card">
    <div class="channel-head">
      <div class="channel-logo">${channel.logo?`<img src="${esc(channel.logo)}" alt="">`:esc(initials)}</div>
      <div class="channel-name">${esc(channel.name)}</div>
      <button class="star ${fav?"on":""}" data-fav="${esc(channel.id)}" aria-label="Preferito">${fav?"★":"☆"}</button>
    </div>
    ${programmes.length?programmes.map((p,i)=>programmeHTML(channel,p,state.view==="now"&&i===0)).join(""):`<div class="programme-desc" style="padding:16px">Nessun programma disponibile.</div>`}
  </section>`;
}

function bindCards(){
  document.querySelectorAll("[data-fav]").forEach(btn=>btn.addEventListener("click",e=>{
    e.stopPropagation();
    const id=btn.dataset.fav;
    state.favorites.has(id)?state.favorites.delete(id):state.favorites.add(id);
    localStorage.setItem(FAVORITES_KEY,JSON.stringify([...state.favorites]));
    render();
  }));
  document.querySelectorAll("[data-programme]").forEach(el=>el.addEventListener("click",()=>openDetail(el.dataset.programme)));
  scheduleThumbHydration();
}

function renderCards(){
  const now=Date.now();
  const items=[];
  for(const ch of state.data.channels){
    const all=(state.data.programs[ch.id]||[]).slice().sort((a,b)=>a.start-b.start);
    let progs=[];
    if(state.view==="now"){
      const {current,next}=currentAndNext(all,now); progs=[current,next].filter(Boolean);
    }else if(state.view==="tonight") progs=tonight(all);
    else if(state.view==="today") progs=forDay(all,new Date());
    else if(state.view==="tomorrow") progs=forDay(all,tomorrowDate());
    else if(state.view==="favorites"){
      if(!state.favorites.has(ch.id)) continue;
      const {current,next}=currentAndNext(all,now); progs=[current,next].filter(Boolean);
    }else if(state.view==="channels"){
      const {current,next}=currentAndNext(all,now); progs=[current,next].filter(Boolean);
    }
    if(matches(ch,progs.length?progs:all)) items.push(channelCard(ch,progs));
  }
  content.innerHTML=`<div class="cards">${items.join("")||`<div class="empty">Nessun risultato.</div>`}</div>`;
  bindCards();
}

function timelineBounds(day){
  const start=new Date(day); start.setHours(6,0,0,0);
  const end=new Date(day); end.setDate(end.getDate()+1); end.setHours(2,0,0,0);
  return {start:start.getTime(),end:end.getTime()};
}

function renderTimeline(){
  const day=new Date();
  const {start,end}=timelineBounds(day);
  const totalMin=(end-start)/60000;
  const width=CHANNEL_COL+totalMin*PX_PER_MIN;
  const now=Date.now();
  let timeLabels="";
  for(let t=start;t<=end;t+=30*60000){
    const left=CHANNEL_COL+((t-start)/60000)*PX_PER_MIN;
    timeLabels+=`<div class="time-label" style="left:${left}px;width:${60*PX_PER_MIN}px">${fmtTime(t)}</div>`;
  }
  let rows="";
  state.data.channels.forEach(ch=>{
    const ps=(state.data.programs[ch.id]||[]).filter(p=>p.stop>start&&p.start<end);
    let blocks="";
    ps.forEach(p=>{
      const s=Math.max(p.start,start), e=Math.min(p.stop,end);
      const left=CHANNEL_COL+((s-start)/60000)*PX_PER_MIN;
      const w=Math.max(42,((e-s)/60000)*PX_PER_MIN-4);
      blocks+=`<button class="tl-programme ${categoryTone(p.category)}" data-programme="${esc(programmeKey(ch.id,p))}" style="left:${left}px;width:${w}px"><strong>${esc(p.title||"Programma")}</strong><small>${fmtTime(p.start)}${p.category?` · ${esc(p.category)}`:""}</small></button>`;
    });
    const initials=ch.name.replace(/[^A-Za-z0-9]/g,"").slice(0,4).toUpperCase();
    rows+=`<div class="tl-row" style="width:${width}px"><div class="tl-channel"><div class="tl-channel-box"><div class="tl-channel-badge">${ch.logo?`<img src="${esc(ch.logo)}" alt="${esc(ch.name)}">`:`<span>${esc(initials)}</span>`}</div><div class="tl-channel-name">${esc(ch.name)}</div></div></div>${blocks}</div>`;
  });
  const nowLeft=CHANNEL_COL+((now-start)/60000)*PX_PER_MIN;
  const nowLine=(now>=start&&now<=end)?`<div class="now-line" style="left:${nowLeft}px"></div>`:"";
  content.innerHTML=`<div class="timeline-shell"><div class="timeline-toolbar"><strong>Timeline · ${esc(fmtDate(day))}</strong><span>${state.data.channels.length} canali</span></div><div class="timeline-scroll" id="timelineScroll"><div class="timeline-grid" style="width:${width}px"><div class="time-head" style="width:${width}px">${timeLabels}</div>${nowLine}${rows}</div></div></div>`;
  document.querySelectorAll(".tl-programme").forEach(el=>el.addEventListener("click",()=>openDetail(el.dataset.programme)));
  requestAnimationFrame(()=>{
    const sc=$("#timelineScroll");
    if(sc&&now>=start&&now<=end) sc.scrollLeft=Math.max(0,nowLeft-CHANNEL_COL-170);
  });
}

function render(){
  if(!state.data){ content.innerHTML=""; return; }
  document.querySelectorAll(".chip").forEach(b=>b.classList.toggle("active",b.dataset.view===state.view));
  document.querySelectorAll(".drawer-item").forEach(b=>b.classList.toggle("active",b.dataset.view===state.view));
  const names={now:"In onda",tonight:"Prima serata",timeline:"Timeline",today:"Oggi",tomorrow:"Domani",favorites:"Preferiti",channels:"Canali"};
  titleEl.textContent=names[state.view]||"Guida TV";
  refreshHeaderClock();
  $("#search").style.display=state.view==="timeline"?"none":"block";
  if(state.view==="timeline") renderTimeline(); else renderCards();
}

function openDetail(key){
  const found=findProgramme(key); if(!found) return;
  const {channel,p}=found;
  $("#detailTitle").textContent=p.title||"Programma";
  $("#detailMeta").textContent=`${channel.name} · ${fmtTime(p.start)} - ${fmtTime(p.stop)}${p.category?` · ${p.category}`:""}`;
  $("#detailDesc").textContent=p.description||"Nessuna descrizione disponibile.";
  const hero=$("#detailHero");
  hero.querySelectorAll("img").forEach(x=>x.remove());
  const cached=p.image||getCachedImage(p.title||"");
  if(cached){
    const img=document.createElement("img"); img.src=cached; img.alt=""; hero.prepend(img);
  }else{
    fetchTvmazeImage(p.title||"").then(url=>{
      if(url&&modal.classList.contains("open")&&!hero.querySelector("img")){
        const img=document.createElement("img"); img.src=url; img.alt=""; hero.prepend(img);
      }
    });
  }
  modal.classList.add("open");
  modal.setAttribute("aria-hidden","false");
}

function closeDetail(){
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden","true");
}

function setView(view){
  state.view=view;
  state.query="";
  $("#search").value="";
  drawerOverlay.classList.remove("open");
  render();
}

async function loadData(force=false){
  statusEl.textContent="Aggiornamento palinsesti...";
  try{
    const r=await fetch(DATA_URL+(force?`?t=${Date.now()}`:""),{cache:"no-store"});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    const data=await r.json();
    if(!data.channels?.length) throw new Error("Palinsesto vuoto");
    state.data=data;
    try{ localStorage.setItem(CACHE_KEY,JSON.stringify(data)); }catch(e){}
    refreshHeaderClock();
    statusEl.textContent=`${data.channels.length} canali disponibili`;
    render();
  }catch(err){
    const cached=localStorage.getItem(CACHE_KEY);
    if(cached){
      state.data=JSON.parse(cached);
      statusEl.textContent="Offline: ultimo palinsesto salvato";
      refreshHeaderClock();
      render();
    }else{
      statusEl.textContent="Palinsesti non disponibili.";
      content.innerHTML=`<div class="empty">Aggiorna i palinsesti e riprova.</div>`;
    }
  }
}

$("#menuBtn").addEventListener("click",()=>drawerOverlay.classList.add("open"));
drawerOverlay.addEventListener("click",e=>{ if(e.target===drawerOverlay) drawerOverlay.classList.remove("open"); });
document.querySelectorAll("[data-view]").forEach(btn=>btn.addEventListener("click",()=>setView(btn.dataset.view)));
$("#search").addEventListener("input",e=>{ state.query=e.target.value.trim(); render(); });
$("#refresh").addEventListener("click",()=>loadData(true));
$("#detailClose").addEventListener("click",closeDetail);
modal.addEventListener("click",e=>{ if(e.target===modal) closeDetail(); });
window.addEventListener("scroll",scheduleThumbHydration,{passive:true});
if("serviceWorker" in navigator) window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js?v=4").catch(()=>{}));
startLiveTimers();
document.addEventListener("visibilitychange",()=>{ if(document.visibilityState === "visible") loadData(true); });
loadData(true);
