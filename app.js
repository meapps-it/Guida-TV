const DATA_URL = "./tv.json";
const FAVORITES_KEY = "guidatv_favorites_v1";
const CACHE_KEY = "guidatv_data_v1";

const state = {
  data: null,
  view: "now",
  query: "",
  favorites: new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]"))
};

const $ = s => document.querySelector(s);
const cards = $("#cards");
const statusEl = $("#status");
const updatedEl = $("#updated");

function esc(s=""){
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}
function fmtTime(ms){
  return new Intl.DateTimeFormat("it-IT",{hour:"2-digit",minute:"2-digit"}).format(new Date(ms));
}
function sameDay(ms, date){
  const d=new Date(ms);
  return d.getFullYear()===date.getFullYear() && d.getMonth()===date.getMonth() && d.getDate()===date.getDate();
}
function tomorrowDate(){
  const d=new Date(); d.setDate(d.getDate()+1); return d;
}
function titleOf(p){ return p?.title || "Programma non disponibile"; }

function currentAndNext(programs, now){
  const current = programs.find(p => p.start <= now && p.stop > now);
  const next = programs.find(p => p.start >= (current ? current.stop : now));
  return {current,next};
}
function tonight(programs){
  const d=new Date();
  return programs.filter(p=>{
    if(!sameDay(p.start,d)) return false;
    const x=new Date(p.start);
    return x.getHours()>=20;
  }).slice(0,7);
}
function forDay(programs, d){
  return programs.filter(p=>sameDay(p.start,d)).slice(0,18);
}
function matches(channel, programs){
  if(!state.query) return true;
  const q=state.query.toLowerCase();
  return channel.name.toLowerCase().includes(q) ||
    programs.some(p => `${p.title||""} ${p.description||""}`.toLowerCase().includes(q));
}
function programmeHTML(p, isNow=false){
  if(!p) return "";
  let progress="";
  if(isNow){
    const now=Date.now();
    const pct=Math.max(0,Math.min(100,((now-p.start)/(p.stop-p.start))*100));
    progress=`<div class="progress"><i style="width:${pct.toFixed(1)}%"></i></div>`;
  }
  return `<div class="programme">
    <div class="time">${fmtTime(p.start)}</div>
    <div><div class="title">${esc(titleOf(p))}</div>${p.description?`<div class="desc">${esc(p.description)}</div>`:""}${progress}</div>
  </div>`;
}
function channelCard(channel, programmes){
  const fav=state.favorites.has(channel.id);
  const initials=channel.name.replace(/[^A-Za-z0-9]/g,"").slice(0,4).toUpperCase();
  return `<article class="card">
    <div class="channel-head">
      <div class="badge">${channel.logo?`<img src="${esc(channel.logo)}" alt="">`:esc(initials)}</div>
      <div class="channel-name">${esc(channel.name)}</div>
      <button class="star ${fav?"on":""}" data-fav="${esc(channel.id)}" aria-label="Preferito">${fav?"★":"☆"}</button>
    </div>
    ${programmes.length?programmes.map((p,i)=>programmeHTML(p,state.view==="now"&&i===0)).join(""):`<div class="desc">Nessun programma disponibile.</div>`}
  </article>`;
}

function render(){
  if(!state.data){ cards.innerHTML=""; return; }
  const now=Date.now();
  let items=[];
  for(const ch of state.data.channels){
    const all=(state.data.programs[ch.id]||[]).slice().sort((a,b)=>a.start-b.start);
    let progs=[];
    if(state.view==="now"){
      const {current,next}=currentAndNext(all,now);
      progs=[current,next].filter(Boolean);
    } else if(state.view==="tonight"){
      progs=tonight(all);
    } else if(state.view==="today"){
      progs=forDay(all,new Date());
    } else if(state.view==="tomorrow"){
      progs=forDay(all,tomorrowDate());
    } else if(state.view==="favorites"){
      if(!state.favorites.has(ch.id)) continue;
      const {current,next}=currentAndNext(all,now);
      progs=[current,next].filter(Boolean);
    }
    if(matches(ch,progs.length?progs:all)) items.push(channelCard(ch,progs));
  }
  cards.innerHTML=items.join("") || `<div class="empty">Nessun risultato. La televisione, per una volta, tace.</div>`;
  document.querySelectorAll("[data-fav]").forEach(btn=>btn.addEventListener("click",()=>{
    const id=btn.dataset.fav;
    state.favorites.has(id)?state.favorites.delete(id):state.favorites.add(id);
    localStorage.setItem(FAVORITES_KEY,JSON.stringify([...state.favorites]));
    render();
  }));
}

async function loadData(force=false){
  statusEl.textContent="Aggiornamento palinsesti...";
  try{
    const r=await fetch(DATA_URL+(force?`?t=${Date.now()}`:""),{cache:force?"no-store":"default"});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    const data=await r.json();
    if(!data.channels?.length) throw new Error("Palinsesto vuoto");
    state.data=data;
    localStorage.setItem(CACHE_KEY,JSON.stringify(data));
    const dt=data.updated_at?new Date(data.updated_at):null;
    updatedEl.textContent=dt?`Aggiornato ${new Intl.DateTimeFormat("it-IT",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(dt)}`:"Palinsesti italiani";
    statusEl.textContent=`${data.channels.length} canali disponibili`;
    render();
  }catch(err){
    const cached=localStorage.getItem(CACHE_KEY);
    if(cached){
      state.data=JSON.parse(cached);
      statusEl.textContent="Offline: mostro l'ultimo palinsesto salvato";
      render();
    }else{
      statusEl.textContent="Palinsesti non ancora disponibili.";
      cards.innerHTML=`<div class="empty">Avvia una volta il workflow “Aggiorna palinsesti TV” su GitHub Actions.</div>`;
    }
  }
}

document.querySelectorAll(".tab").forEach(btn=>btn.addEventListener("click",()=>{
  state.view=btn.dataset.view;
  document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x===btn));
  render();
}));
$("#search").addEventListener("input",e=>{state.query=e.target.value.trim();render();});
$("#refresh").addEventListener("click",()=>loadData(true));

if("serviceWorker" in navigator) window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
loadData();
