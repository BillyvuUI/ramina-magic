import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import {
  getFirestore, doc, collection, onSnapshot, getDoc, setDoc, addDoc, deleteDoc,
  runTransaction, serverTimestamp, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const BASE = ["apps", "ramina"];
const pdoc = (...parts) => doc(db, ...BASE, ...parts);
const pcol = (...parts) => collection(db, ...BASE, ...parts);
const $ = (id) => document.getElementById(id);
const state = { profile:null, settings:null, tasks:[], rewards:[], completions:new Map(), purchases:[] };
const unsubscribers = [];

function localDateKey(d=new Date()){
  const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function formatDateTime(ts){
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : new Date();
  return d.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
}
function escapeHtml(s=''){return String(s).replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':'&quot;'}[c]))}
function showToast(text){const el=$('toast');el.textContent=text;el.classList.remove('hidden');clearTimeout(showToast.t);showToast.t=setTimeout(()=>el.classList.add('hidden'),2200)}
function showModal(html){$('modalCard').innerHTML=html;$('modalOverlay').classList.remove('hidden')}
function closeModal(){$('modalOverlay').classList.add('hidden');$('modalCard').innerHTML=''}
$('modalOverlay').addEventListener('click',e=>{if(e.target===$('modalOverlay')) closeModal()});

function switchTab(name){
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===name));
  document.querySelectorAll('.tab-panel').forEach(x=>x.classList.remove('active'));
  $(`${name}Tab`).classList.add('active');
}
document.querySelectorAll('.tab').forEach(x=>x.addEventListener('click',()=>switchTab(x.dataset.tab)));

function completedToday(taskId){return state.completions.has(`${localDateKey()}_${taskId}`)}
function render(){
  $('balance').textContent = state.profile?.balance ?? 0;
  const today = new Date().toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'});
  $('todayTitle').textContent = today.charAt(0).toUpperCase()+today.slice(1);

  const activeTasks = state.tasks.filter(t=>t.active!==false).sort((a,b)=>(a.order??0)-(b.order??0));
  const doneCount = activeTasks.filter(t=>completedToday(t.id)).length;
  $('progressBadge').textContent=`${doneCount}/${activeTasks.length}`;
  $('allDone').classList.toggle('hidden',!(activeTasks.length && doneCount===activeTasks.length));
  $('tasksList').innerHTML = activeTasks.length ? activeTasks.map(t=>{
    const done=completedToday(t.id);
    return `<div class="task ${done?'done':''}">
      <div class="task-icon">${escapeHtml(t.icon||'✨')}</div>
      <div class="task-body"><div class="task-title">${escapeHtml(t.title)}</div><div class="task-sub">+${Number(t.reward||0)} Крузейриков</div></div>
      <button class="check" data-task="${t.id}" aria-label="${done?'Снять отметку':'Выполнено'}">${done?'✓':''}</button>
    </div>`
  }).join('') : `<div class="celebration">Заданий пока нет. Родитель может добавить их через 🔐</div>`;
  document.querySelectorAll('[data-task]').forEach(b=>b.addEventListener('click',()=>toggleTask(b.dataset.task)));

  const rewards = state.rewards.filter(r=>r.active!==false).sort((a,b)=>(a.order??0)-(b.order??0));
  $('rewardsList').innerHTML = rewards.length ? rewards.map(r=>`<div class="reward">
    <div class="reward-icon">${escapeHtml(r.icon||'🎁')}</div><div class="reward-title">${escapeHtml(r.title)}</div>
    <div class="price">💖 ${Number(r.price||0)} Крузейриков</div>
    <button class="buy" data-buy="${r.id}" ${Number(state.profile?.balance||0)<Number(r.price||0)?'disabled':''}>Хочу!</button>
  </div>`).join('') : `<div class="celebration">Магазин пока пуст.</div>`;
  document.querySelectorAll('[data-buy]').forEach(b=>b.addEventListener('click',()=>requestPurchase(b.dataset.buy)));

  $('historyList').innerHTML = state.purchases.length ? state.purchases.map(p=>`<div class="history-item">
    <div class="history-top"><div class="history-title">${escapeHtml(p.rewardTitle||'Покупка')}</div><span class="status ${p.status}">${p.status==='pending'?'Ждёт решения':p.status==='approved'?'Одобрено':'Отказано'}</span></div>
    <div class="history-meta">${Number(p.price||0)} Крузейриков · ${formatDateTime(p.createdAt)}</div>
  </div>`).join('') : `<div class="celebration">Покупок пока не было.</div>`;
}

async function toggleTask(taskId){
  const task=state.tasks.find(t=>t.id===taskId); if(!task||!state.profile) return;
  const key=`${localDateKey()}_${taskId}`;
  const completionRef=pdoc('completions',key);
  const profileRef=pdoc('profile','main');
  try{
    await runTransaction(db,async tx=>{
      const [cSnap,pSnap]=await Promise.all([tx.get(completionRef),tx.get(profileRef)]);
      const profile=pSnap.data()||{balance:0};
      let balance=Number(profile.balance||0);
      if(cSnap.exists()){
        tx.delete(completionRef);
        balance=Math.max(0,balance-Number(cSnap.data().reward||task.reward||0));
      }else{
        tx.set(completionRef,{taskId,taskTitle:task.title,reward:Number(task.reward||0),date:localDateKey(),createdAt:serverTimestamp()});
        balance+=Number(task.reward||0);
      }
      tx.set(profileRef,{...profile,name:'Рамина',balance,updatedAt:serverTimestamp()},{merge:true});
    });
  }catch(e){console.error(e);showToast('Не получилось сохранить. Попробуй ещё раз.');}
}

async function requestPurchase(rewardId){
  const reward=state.rewards.find(r=>r.id===rewardId); if(!reward) return;
  if(Number(state.profile?.balance||0)<Number(reward.price||0)){showToast('Пока не хватает Крузейриков 💖');return;}
  showModal(`<div class="center"><div style="font-size:56px">${escapeHtml(reward.icon||'🎁')}</div><h3>${escapeHtml(reward.title)}</h3><p class="muted">Покупка за <b>${Number(reward.price||0)} Крузейриков</b> отправится родителю на подтверждение.</p><div class="modal-actions"><button class="btn grow" id="cancelBuy">Не сейчас</button><button class="btn primary grow" id="confirmBuy">Отправить</button></div></div>`);
  $('cancelBuy').onclick=closeModal;
  $('confirmBuy').onclick=async()=>{
    try{await addDoc(pcol('purchases'),{rewardId,rewardTitle:reward.title,price:Number(reward.price||0),status:'pending',createdAt:serverTimestamp(),updatedAt:serverTimestamp()});closeModal();showToast('Запрос отправлен родителю ✨');switchTab('history');}catch(e){console.error(e);showToast('Не удалось отправить запрос');}
  };
}

async function verifyPin(pin){
  if(!state.settings?.pinHash) return false;
  const bytes=new TextEncoder().encode(pin); const hash=await crypto.subtle.digest('SHA-256',bytes); const hex=[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
  return hex===state.settings.pinHash;
}
async function hashPin(pin){const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(pin));return [...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,'0')).join('')}

$('parentBtn').addEventListener('click',()=>{
  showModal(`<h3>Родительский режим 🔐</h3><p class="muted">Введите 4-значный PIN.</p><input id="pinInput" class="field" inputmode="numeric" maxlength="4" type="password" placeholder="••••"><div class="modal-actions"><button class="btn grow" id="pinCancel">Отмена</button><button class="btn primary grow" id="pinGo">Войти</button></div>`);
  $('pinCancel').onclick=closeModal;
  $('pinGo').onclick=async()=>{if(await verifyPin($('pinInput').value)){openParentPanel()}else showToast('Неверный PIN')};
});

function openParentPanel(){
  const pending=state.purchases.filter(p=>p.status==='pending');
  showModal(`<h3>Для родителей</h3><p class="muted">Баланс Рамины: <b>${state.profile?.balance||0}</b> Крузейриков</p>
  <h4>Ждут подтверждения</h4>${pending.length?pending.map(p=>`<div class="manager-row"><div class="grow"><b>${escapeHtml(p.rewardTitle)}</b><div class="tiny">${p.price} Крузейриков</div></div><button class="btn danger" data-reject="${p.id}">Нет</button><button class="btn primary" data-approve="${p.id}">Да</button></div>`).join(''):'<div class="tiny">Нет ожидающих покупок.</div>'}
  <h4>Задания</h4><div id="manageTasks">${state.tasks.map(t=>`<div class="manager-row"><div class="grow"><b>${escapeHtml(t.icon||'✨')} ${escapeHtml(t.title)}</b><div class="tiny">+${t.reward} Крузейриков</div></div><button class="btn danger" data-del-task="${t.id}">Удалить</button></div>`).join('')}</div>
  <button class="btn primary" id="addTaskBtn">+ Добавить задание</button>
  <h4>Магазин</h4><div>${state.rewards.map(r=>`<div class="manager-row"><div class="grow"><b>${escapeHtml(r.icon||'🎁')} ${escapeHtml(r.title)}</b><div class="tiny">${r.price} Крузейриков</div></div><button class="btn danger" data-del-reward="${r.id}">Удалить</button></div>`).join('')}</div>
  <button class="btn primary" id="addRewardBtn">+ Добавить награду</button>
  <h4>Настройки</h4><button class="btn" id="changePin">Сменить PIN</button><button class="btn" id="closeParent" style="float:right">Закрыть</button>`);
  document.querySelectorAll('[data-approve]').forEach(b=>b.onclick=()=>approvePurchase(b.dataset.approve,true));
  document.querySelectorAll('[data-reject]').forEach(b=>b.onclick=()=>approvePurchase(b.dataset.reject,false));
  document.querySelectorAll('[data-del-task]').forEach(b=>b.onclick=async()=>{if(confirm('Удалить задание?')) await deleteDoc(pdoc('tasks',b.dataset.delTask));});
  document.querySelectorAll('[data-del-reward]').forEach(b=>b.onclick=async()=>{if(confirm('Удалить награду?')) await deleteDoc(pdoc('rewards',b.dataset.delReward));});
  $('addTaskBtn').onclick=openAddTask; $('addRewardBtn').onclick=openAddReward; $('changePin').onclick=openChangePin; $('closeParent').onclick=closeModal;
}

function openAddTask(){showModal(`<h3>Новое задание</h3><input id="tTitle" class="field" placeholder="Например: Почистить зубы"><input id="tIcon" class="field" placeholder="Эмодзи, например 🪥"><input id="tReward" class="field" type="number" min="1" value="10" placeholder="Крузейрики"><div class="modal-actions"><button class="btn grow" id="backParent">Назад</button><button class="btn primary grow" id="saveTask">Добавить</button></div>`);$('backParent').onclick=openParentPanel;$('saveTask').onclick=async()=>{const title=$('tTitle').value.trim();if(!title)return;await addDoc(pcol('tasks'),{title,icon:$('tIcon').value.trim()||'✨',reward:Number($('tReward').value||0),active:true,order:Date.now(),createdAt:serverTimestamp()});openParentPanel()}}
function openAddReward(){showModal(`<h3>Новая награда</h3><input id="rTitle" class="field" placeholder="Например: Мороженое"><input id="rIcon" class="field" placeholder="Эмодзи, например 🍦"><input id="rPrice" class="field" type="number" min="1" value="50" placeholder="Цена"><div class="modal-actions"><button class="btn grow" id="backParent">Назад</button><button class="btn primary grow" id="saveReward">Добавить</button></div>`);$('backParent').onclick=openParentPanel;$('saveReward').onclick=async()=>{const title=$('rTitle').value.trim();if(!title)return;await addDoc(pcol('rewards'),{title,icon:$('rIcon').value.trim()||'🎁',price:Number($('rPrice').value||0),active:true,order:Date.now(),createdAt:serverTimestamp()});openParentPanel()}}
function openChangePin(){showModal(`<h3>Новый PIN</h3><p class="muted">Введите 4 цифры.</p><input id="newPin" class="field" inputmode="numeric" maxlength="4" type="password" placeholder="••••"><div class="modal-actions"><button class="btn grow" id="backParent">Назад</button><button class="btn primary grow" id="savePin">Сохранить</button></div>`);$('backParent').onclick=openParentPanel;$('savePin').onclick=async()=>{const p=$('newPin').value;if(!/^\d{4}$/.test(p)){showToast('Нужно ровно 4 цифры');return;}await setDoc(pdoc('settings','main'),{pinHash:await hashPin(p),updatedAt:serverTimestamp()},{merge:true});closeModal();showToast('PIN изменён')}}

async function approvePurchase(id,approve){
  const purchaseRef=pdoc('purchases',id), profileRef=pdoc('profile','main');
  try{await runTransaction(db,async tx=>{const [pSnap,profSnap]=await Promise.all([tx.get(purchaseRef),tx.get(profileRef)]);if(!pSnap.exists())return;const p=pSnap.data();if(p.status!=='pending')return;let profile=profSnap.data()||{balance:0};if(approve){if(Number(profile.balance||0)<Number(p.price||0)) throw new Error('not-enough');profile={...profile,balance:Number(profile.balance||0)-Number(p.price||0),updatedAt:serverTimestamp()};tx.set(profileRef,profile,{merge:true});tx.update(purchaseRef,{status:'approved',approvedAt:serverTimestamp(),updatedAt:serverTimestamp()});}else tx.update(purchaseRef,{status:'rejected',updatedAt:serverTimestamp()});});openParentPanel();showToast(approve?'Покупка одобрена 💖':'Покупка отклонена');}catch(e){console.error(e);showToast(e.message==='not-enough'?'Не хватает Крузейриков':'Ошибка подтверждения');}
}

let app,auth,db;
async function seedIfNeeded(){
  const profileRef=pdoc('profile','main'), settingsRef=pdoc('settings','main');
  const p=await getDoc(profileRef); if(!p.exists()) await setDoc(profileRef,{name:'Рамина',balance:0,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  const s=await getDoc(settingsRef); if(!s.exists()) await setDoc(settingsRef,{pinHash:await hashPin('2580'),createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  const seedRef=pdoc('settings','seed'); const seed=await getDoc(seedRef); if(seed.exists()) return;
  const taskSeeds=[['🪥','Почистить зубы',10],['🧸','Убрать игрушки',15],['📚','Почитать 15 минут',15],['🌸','Помочь дома',20]];
  for(const [icon,title,reward] of taskSeeds) await addDoc(pcol('tasks'),{icon,title,reward,active:true,order:Date.now()+Math.random(),createdAt:serverTimestamp()});
  const rewardSeeds=[['🍦','Мороженое',50],['🎬','Выбрать мультик',40],['🎁','Маленький сюрприз',150],['👑','Особая награда',250]];
  for(const [icon,title,price] of rewardSeeds) await addDoc(pcol('rewards'),{icon,title,price,active:true,order:Date.now()+Math.random(),createdAt:serverTimestamp()});
  await setDoc(seedRef,{done:true,createdAt:serverTimestamp()});
}
function listen(){
  unsubscribers.push(onSnapshot(pdoc('profile','main'),s=>{state.profile=s.exists()?s.data():null;render()}));
  unsubscribers.push(onSnapshot(pdoc('settings','main'),s=>{state.settings=s.exists()?s.data():null}));
  unsubscribers.push(onSnapshot(pcol('tasks'),s=>{state.tasks=s.docs.map(d=>({id:d.id,...d.data()}));render()}));
  unsubscribers.push(onSnapshot(pcol('rewards'),s=>{state.rewards=s.docs.map(d=>({id:d.id,...d.data()}));render()}));
  unsubscribers.push(onSnapshot(pcol('completions'),s=>{state.completions=new Map(s.docs.map(d=>[d.id,{id:d.id,...d.data()}]));render()}));
  const pq=query(pcol('purchases'),orderBy('createdAt','desc'),limit(50));
  unsubscribers.push(onSnapshot(pq,s=>{state.purchases=s.docs.map(d=>({id:d.id,...d.data()}));render()}));
}
async function start(){
  try{
    if(firebaseConfig.apiKey==='PASTE_HERE') throw new Error('CONFIG_MISSING');
    app=initializeApp(firebaseConfig); auth=getAuth(app); db=getFirestore(app);
    window.db=db;
    await signInAnonymously(auth);
    $('syncText').textContent='Готовлю волшебный мир Рамины';
    await seedIfNeeded();
    listen();
    $('syncOverlay').classList.add('hidden');
    if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.warn);
  }catch(e){
    console.error(e);
    $('syncText').innerHTML = e.message==='CONFIG_MISSING' ? 'Нужно заполнить <b>firebase-config.js</b>. Я покажу, где взять значения.' : `Ошибка подключения: ${escapeHtml(e.message||String(e))}`;
  }
}
start();
