// Production V2 candidate. It is intentionally not selected by the deployed shell yet.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import { getAuth, setPersistence, browserLocalPersistence, signInAnonymously, getIdTokenResult, signOut } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import { getFirestore, collection, doc, onSnapshot, onSnapshotsInSync, query, where, orderBy, documentId, limit, startAfter, getDocs, getDoc, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import { createSparkClient } from '../data/v2-spark-client.mjs';
import { createSparkDispatcher } from '../data/v2-spark-dispatcher.mjs';
import { createV2CompletionState } from '../data/v2-optimistic.mjs';
import { subscribeV2Confirmed } from '../data/v2-listeners.mjs';
import { ensureDeviceSession } from '../data/v2-auth.mjs';
import { familyToday } from '../data/v2-calendar.mjs';
import { calendarKeys, addDays } from '../data/v2-model.mjs';
import { createScheduleUI } from './v2-schedule-ui.mjs';
import { createRewardState } from '../data/v2-reward-state.mjs';
import { validateReleaseConfig, assertV2Runtime, friendlyError, mergeHistory, operationPending } from '../data/v2-release.mjs';
import { unlockPin } from '../data/v2-pin.mjs';

export async function startV2App(config, {configure = () => {}, worker = true} = {}) {
async function firebase(name) {
  const app = initializeApp(config, name), auth = getAuth(app), db = getFirestore(app);
  await configure({auth,db});
  await setPersistence(auth, browserLocalPersistence);
  return { auth, db };
}
const child = await firebase('v2-child');
const status = document.getElementById('status');
const report = error => { status.textContent = friendlyError(error); console.error('Ramina V2 operation failed', error); };
let anchor = Date.now(), elapsed = performance.now(), ui, game, connected = false, evaluatedWeek = null, activeTab = 'main';
let updateFrozen = false;
const beforeMutation = () => { if (updateFrozen) throw Object.assign(Error('UPDATE_REQUIRED'), {details:{retryable:true}}); };
const clock = () => new Date(anchor + performance.now() - elapsed);
const environment={db:child.db,auth:child.auth,doc,collection,query,where,limit,getDocs,getDoc,runTransaction,serverTimestamp};
const dispatcher=createSparkDispatcher(environment,{clock});
const childClient=createSparkClient({dispatcher,today:()=>familyToday(clock()),beforeMutation});
await ensureDeviceSession({auth: child.auth, signInAnonymously, signOut});
await dispatcher.initialize();
const principal = child, primaryClient = childClient, parentClient = childClient;
// This is deliberately tab-memory only. Reloading always returns to child mode.
let parentMode = false, childStatus = 'Подключение…';
const outboxKey = `ramina-v2-outbox:${config.projectId}:${principal.auth.currentUser.uid}`;
const rewardKey = `ramina-v2-rewards:${config.projectId}:${principal.auth.currentUser.uid}`;
const rewards = createRewardState({
  restored: JSON.parse(localStorage.getItem(rewardKey) ?? '[]'),
  save: records => localStorage.setItem(rewardKey, JSON.stringify(records)),
  send: (name, data, isParent) => (isParent ? parentClient : primaryClient).call(name, data), onError:report
});
const completion = createV2CompletionState({
  send: async data => {
    const result = await (data.parent ? parentClient : primaryClient).completion(data);
    if (game && data.parent && familyToday(clock()) > addDays(result.weekStart,6)) {
      primaryClient.call('evaluateWeek',{weekStart:result.weekStart}).catch(report);
    }
    return result;
  }, onError: report,
  savePending: operations => localStorage.setItem(outboxKey, JSON.stringify(operations))
});
const extras = new Map(), listeners = new Set();
const notify = () => listeners.forEach(fn => fn());
const store = {
  list(name) { return [...(completion.visible()[name] ?? extras.get(name) ?? new Map()).values()]; },
  read(path) { const [name, id] = path.split('/'); return this.list(name).find(item => item.id === id); },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
};
completion.subscribe(notify);
const unsubscribe = [];
let connectionPromise;
function connect() {
  if (!connectionPromise) connectionPromise = connectSession().finally(() => { connectionPromise = null; });
  return connectionPromise;
}
async function connectSession() {
  await getIdTokenResult(principal.auth.currentUser, true);
  const session = await primaryClient.session();
  assertV2Runtime(session);
  document.getElementById('enrollment').hidden = true;
  anchor = Date.parse(session.serverTime); elapsed = performance.now();
  if (!connected) {
    connected = true;
    const saved = JSON.parse(localStorage.getItem(outboxKey) ?? '[]');
    ui = createScheduleUI({ document, store, clock, protectedService: parentClient.schedule, completionState: completion, onError: report });
    if (document.getElementById('gameHome')) {
      const { createGameUI } = await import('./v2-game-ui.mjs');
      game = createGameUI({ document, store, clock, rewards, schedule: ui, ready:completion.ready, onError: report,
        navigate: activateTab,
        retryPending: async () => { await completion.retryPending(); await rewards.retry(true); },
        async loadHistory(isParent, cursor) {
          if (isParent && !parentMode) throw new Error('Неверный PIN');
          const database = principal.db, name = isParent ? 'ledger' : 'activity';
          const page = await getDocs(query(collection(database,'apps','ramina',name),orderBy('createdAt','desc'),orderBy(documentId(),'desc'),...(cursor ? [startAfter(cursor.createdAt,cursor.id)] : []),limit(50)));
          const rows=page.docs.map(d => ({...d.data(),id:d.id})),last=rows.at(-1);
          return { rows,cursor:last?{createdAt:last.createdAt,id:last.id}:null,more:page.size === 50 };
        }
      });
    }
    ui.setParentMode(parentMode);
    game?.setParentMode(parentMode);
    game?.onTab(activeTab);
    completion.restore(saved);
    unsubscribe.push(subscribeV2Confirmed({ db: principal.db, collection, onSnapshot, onSnapshotsInSync }, completion, report));
    for (const name of ['libraryTasks', 'scheduleRules', ...(game ? ['worldUnlocks','rewards','purchases'] : [])]) unsubscribe.push(onSnapshot(collection(principal.db, 'apps', 'ramina', name), snapshot => {
      extras.set(name, new Map(snapshot.docs.map(d => [d.id, { ...d.data(), id: d.id }]))); notify();
    }, report));
    unsubscribe.push(onSnapshot(doc(principal.db, 'apps', 'ramina', 'profile', 'main'), snapshot => {
      if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      const profile = snapshot.data();
      const previous = extras.get('profile')?.get('main');
      if (profile && (profile.balanceRevision ?? 0) >= (previous?.balanceRevision ?? 0)) {
        extras.set('profile', new Map([['main',{...profile,id:'main'}]]));
        document.getElementById('balance').textContent = profile.balance;
      }
    }, report));
    assertV2Runtime(session);
    await completion.retryPending();
    if (game) await rewards.retry(true);
  }
  const week = calendarKeys(session.today).weekStart;
  if (session.mode === 'active' && evaluatedWeek !== week) {
    await primaryClient.call('evaluateRecentlyEndedWeeks'); evaluatedWeek = week;
  }
  ui.refreshDate();
  if (game && session.mode === 'active') {
    const [year, month] = session.today.split('-').map(Number);
    for (let i = 0; i < 3; i++) {
      const monthKey = new Date(Date.UTC(year, month - 2 - i, 1)).toISOString().slice(0,7);
      if (monthKey >= session.effectiveDate.slice(0,7)) await rewards.run(`finalize:${monthKey}`,'finalizeMonth',{monthKey});
    }
    game.render();
  }
  childStatus = session.mode === 'maintenance' ? 'Идёт безопасное обновление приложения' : `Синхронизация включена · Алматы · ${session.today}`;
  status.textContent = parentMode ? 'Родительский режим' : childStatus;
  document.getElementById('partialStart').textContent = session.effectiveDate?.slice(8) !== '01' ? `В первом месяце считаются добрые дела с ${session.effectiveDate ?? 'даты начала'}.` : '';
}
document.getElementById('connect').onclick = () => connect().catch(error => { document.getElementById('enrollment').hidden = false; report(error); });
document.getElementById('retry').onclick = async () => { await completion.retryPending(); if (game) await rewards.retry(true); };
const parentHelp=document.createElement('p');
document.getElementById('parentForm').querySelector('h2').after(parentHelp);
function openParentGate() {
  document.getElementById('parentForm').reset();
  parentHelp.textContent = 'Введите родительский PIN.';
  document.getElementById('parentGate').showModal();
}
function setParentMode(enabled) {
  parentMode = !!enabled;
  document.getElementById('appShell').classList.toggle('is-parent-mode', parentMode);
  document.getElementById('parentModeBar').hidden = !parentMode;
  ui?.setParentMode(parentMode);
  game?.setParentMode(parentMode);
  status.textContent = parentMode ? 'Родительский режим' : childStatus;
}
document.getElementById('parentForm').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget, button = form.querySelector('button[type="submit"]');
  if (button.disabled) return;
  button.disabled = true;
  try {
    if (!await unlockPin(localStorage, 'ramina-v2-parent-pin', form.elements.pin.value)) throw new Error('Неверный PIN');
    if (!ui) await connect();
    document.getElementById('parentGate').close();
    form.elements.pin.value = '';
    setParentMode(true);
    activateTab('settings');
  } catch (error) { parentHelp.textContent = friendlyError(error); }
  finally { button.disabled = false; }
};
function activateTab(name) {
  const button = document.querySelector(`[data-tab="${name}"]`);
  if (!button) return;
  activeTab = name;
  document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === `${name}Tab`));
  document.querySelectorAll('[data-tab]').forEach(tab => { tab.classList.toggle('active',tab === button); tab.setAttribute('aria-current',tab === button ? 'page' : 'false'); });
  game?.onTab(name);
}
document.querySelectorAll('[data-tab]').forEach(button => button.onclick = () => activateTab(button.dataset.tab));
document.getElementById('appShell').addEventListener('click', event => {
  if (event.target.closest('[data-parent-enter]')) openParentGate();
  if (event.target.closest('[data-parent-exit]')) setParentMode(false);
});
window.addEventListener('focus', () => { if (connected) connect().catch(report); });
if (worker) setupWorkerUpdate();
function setupWorkerUpdate() {
  if (!('serviceWorker' in navigator)) return;
  const wasControlled = !!navigator.serviceWorker.controller;
  const hasPending = () => operationPending(JSON.parse(localStorage.getItem(outboxKey)??'[]'),rewards.export());
  navigator.serviceWorker.addEventListener('message',event=>{
    if(event.data?.type==='CHECK_RELEASE_UPDATE') {
      updateFrozen=true;
      event.source.postMessage({type:'RELEASE_UPDATE_STATUS',token:event.data.token,pending:hasPending()});
    }
    if(event.data?.type==='RELEASE_UPDATE_ABORTED') {
      updateFrozen=false;status.textContent='Сначала проверьте сохранение во всех открытых вкладках и закройте старые версии приложения.';
    }
  });
  navigator.serviceWorker.register('./v2-release-sw.js').then(reg => {
    const show = worker => {
      const banner=document.getElementById('updateBanner'); if(!worker||!banner)return; banner.hidden=false;
      banner.querySelector('button').onclick=()=>{
        const pending=operationPending(JSON.parse(localStorage.getItem(outboxKey)??'[]'),rewards.export());
        if(pending){status.textContent='Сначала нажмите «Проверить сохранение» — действие не будет потеряно.';return;}
        worker.postMessage({type:'ACTIVATE_RELEASE'});
      };
    };
    show(reg.waiting); reg.addEventListener('updatefound',()=>{const installing=reg.installing;installing?.addEventListener('statechange',()=>{if(installing.state==='installed'&&navigator.serviceWorker.controller)show(reg.waiting);});});
    navigator.serviceWorker.addEventListener('controllerchange',()=>{
      if(!wasControlled)return;
      if(hasPending()){updateFrozen=false;status.textContent='Новая версия готова. Сначала проверим сохранение текущего действия.';return;}
      location.reload();
    });
  }).catch(report);
}
const timer = setInterval(() => { if (connected) connect().catch(report); }, 60000);
window.addEventListener('pagehide', event => { if (!event.persisted) { unsubscribe.forEach(fn => fn()); clearInterval(timer); ui?.destroy(); game?.destroy(); } });
connect().catch(error => { document.getElementById('enrollment').hidden = false; report(error); });

}
