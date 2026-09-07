const CACHE="guidatv-shell-v4";
const SHELL=["./","./index.html","./app.js?v=4","./manifest.webmanifest","./icon-192.png","./icon-512.png","./icon-maskable-512.png"];

self.addEventListener("install",e=>{
  e.waitUntil(
    caches.open(CACHE)
      .then(c=>c.addAll(SHELL))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener("activate",e=>{
  e.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener("fetch",e=>{
  const u=new URL(e.request.url);
  if(u.origin!==self.location.origin) return;

  if(u.pathname.endsWith("/tv.json")){
    e.respondWith(
      fetch(e.request,{cache:"no-store"})
        .then(r=>{
          const copy=r.clone();
          caches.open(CACHE).then(c=>c.put("./tv.json",copy));
          return r;
        })
        .catch(()=>caches.match("./tv.json"))
    );
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then(r=>{
        if(e.request.method==="GET"){
          const copy=r.clone();
          caches.open(CACHE).then(c=>c.put(e.request,copy));
        }
        return r;
      })
      .catch(()=>caches.match(e.request))
  );
});
