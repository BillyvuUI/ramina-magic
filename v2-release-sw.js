const CACHE='ramina-magic-v2-spark-20260905-1';
const SHELL=["./","./styles.css","./ui/v2-game.css","./manifest.webmanifest","./icon.svg","./icon-maskable.svg","./ui/v2-production-entry.mjs","./release-config.js","./data/v2-release.mjs","./ui/v2-app.mjs","./data/v2-spark-client.mjs","./data/v2-model.mjs","./data/v2-spark-dispatcher.mjs","./data/v2-spark-commands.mjs","./data/v2-spark-transaction.mjs","./data/v2-spark-security.mjs","./data/v2-calendar.mjs","./data/v2-spark-activity.mjs","./data/v2-schedule.mjs","./data/v2-spark-schedule.mjs","./data/v2-spark-rewards.mjs","./data/v2-world-catalog.mjs","./data/v2-optimistic.mjs","./data/v2-listeners.mjs","./data/v2-auth.mjs","./ui/v2-schedule-ui.mjs","./data/v2-schedule-service.mjs","./data/v2-transaction.mjs","./data/v2-reward-state.mjs","./data/v2-pin.mjs","./ui/v2-game-ui.mjs","./data/v2-home.mjs","./ui/v2-scene.mjs"];
const SDK=['app','auth','firestore'].map(name=>`https://www.gstatic.com/firebasejs/12.18.0/firebase-${name}.js`);
const ASSETS=[...SHELL,...SDK];
const base=new URL('./',self.location.href),allowed=new Set(ASSETS.map(path=>new URL(path,base).href));
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
let handshake=null;
self.addEventListener('message',event=>{
  if(event.data?.type==='ACTIVATE_RELEASE') event.waitUntil(checkAllClients());
  if(event.data?.type==='RELEASE_UPDATE_STATUS'&&handshake?.token===event.data.token&&handshake.pending.has(event.source?.id)){
    handshake.pending.delete(event.source.id);
    if(event.data.pending)handshake.finish(false);
    else if(!handshake.pending.size)handshake.finish(true);
  }
});
async function checkAllClients(){
  if(handshake)return;
  const clients=(await self.clients.matchAll({type:'window',includeUncontrolled:true})).filter(c=>c.url.startsWith(base.href));
  if(!clients.length){await self.skipWaiting();return;}
  const token=Date.now().toString();
  const safe=await new Promise(resolve=>{
    const timer=setTimeout(()=>handshake?.finish(false),5000);
    handshake={token,pending:new Set(clients.map(c=>c.id)),finish(ok){clearTimeout(timer);resolve(ok);}};
    for(const client of clients)client.postMessage({type:'CHECK_RELEASE_UPDATE',token});
  });
  handshake=null;
  if(safe)await self.skipWaiting();
  else for(const client of clients)client.postMessage({type:'RELEASE_UPDATE_ABORTED'});
}
self.addEventListener('activate',event=>event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('ramina-magic-')&&k!==CACHE).map(k=>caches.delete(k)))),self.clients.claim()])));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(url.origin===base.origin&&url.pathname===base.pathname+'index.html')url.pathname=base.pathname;if(event.request.method!=='GET'||url.search||!allowed.has(url.href))return;event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(url.href))??fetch(event.request)));});
