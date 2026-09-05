import { homeState, escapeHTML as esc, monthName, visibleStars, giftCount } from '../data/v2-home.mjs';
import { CHESTS, chestState, eventIds } from '../data/v2-model.mjs';
import { familyToday } from '../data/v2-calendar.mjs';
import { sceneMarkup } from './v2-scene.mjs';
import { friendlyError, mergeHistory } from '../data/v2-release.mjs';
const coin = '<span aria-hidden="true">✦</span>';
const chestIcon = '<svg viewBox="0 0 100 80" aria-hidden="true"><path d="M12 33Q12 9 36 9H64Q88 9 88 33V65Q88 72 80 72H20Q12 72 12 65Z" fill="currentColor"/><path d="M13 35H87M29 12V72M71 12V72" stroke="#fff1c7" stroke-width="7"/><rect x="42" y="29" width="16" height="20" rx="5" fill="#fff1c7"/><path d="M50 34V42" stroke="#aa8299" stroke-width="3"/></svg>';
export function homeMarkup(h, pending = () => false) {
  const next = h.next, progress = next ? Math.min(100, h.stars / next.threshold * 100) : 100;
  return `<div class="world-heading"><div><p class="eyebrow">ТВОЙ МАЛЕНЬКИЙ ВОЛШЕБНЫЙ МИР</p><h1>Привет, Рамина!</h1></div><div class="month-stars"><small>${esc(monthName(h.monthKey))}</small><strong data-month-stars>${h.stars} <span>★</span></strong></div></div>
    <div class="world-frame">${sceneMarkup(h.unlocked)}<div class="world-caption">С добрыми делами здесь расцветает волшебство</div><span class="world-count">${giftCount(h.unlocked.length)} в мире</span></div>
    <section class="chest-section" aria-label="Месячные ящики"><div class="progress-heading"><h2>${next ? `До ящика — ещё ${next.threshold - h.stars} ★` : 'Все ящики этого месяца доступны!'}</h2><span>${h.stars} ★</span></div><div class="star-track" role="progressbar" aria-label="Прогресс месяца" aria-valuenow="${Math.min(h.stars, next?.threshold ?? 160)}" aria-valuemin="0" aria-valuemax="${next?.threshold ?? 160}"><i style="width:${progress}%"></i></div>
    <div class="chest-row">${h.chests.map(c => `<button class="chest ${c.state}" data-chest="${c.threshold}" data-state="${c.state}" ${c.state !== 'available' ? 'disabled' : ''} aria-label="Ящик ${c.threshold}: ${{locked:'пока закрыт',available:'открыть',pending:'открываем',opened:'открыт'}[c.state]}">${chestIcon}<strong>${c.threshold} ★</strong><span>${{locked:`+${c.reward} Крузейрика`,available:'Открыть подарок',pending:'Открываем…',opened:'✓ Открыт'}[c.state]}</span></button>`).join('')}</div>
    ${h.extraEntitlement > h.extraClaimed ? `<button class="extra-claim" data-extra="${h.extraClaimed + 1}" ${pending(eventIds.extra(h.monthKey,h.extraClaimed+1)) ? 'disabled' : ''}>${pending(eventIds.extra(h.monthKey,h.extraClaimed+1)) ? 'Получаем…' : `Ещё подарок! +1 ${coin}`} <small>Доступно: ${h.extraEntitlement - h.extraClaimed}</small></button>` : h.stars >= 160 ? `<p class="gentle-note">Ещё ${Math.max(5 - (h.stars - 160) % 5, 160 + (h.extraClaimed + 1) * 5 - h.stars)} ★ до следующего +1 Крузейрика</p>` : ''}</section>
    <div class="small-progress"><div><span>☀ Сегодня</span><strong data-today-count>${h.todayCompleted}/${h.todayScheduled}</strong><small>добрых дел</small></div><div><span>✧ Эта неделя</span><strong>${h.week.completedCount ?? 0}/${h.week.scheduledCount ?? 0}</strong><small>заданий выполнено</small></div><div><span>♡ Идеальные недели</span><strong>${h.perfectCount}</strong><small>подарков получено</small></div></div>
    ${h.perfectWeeks.map(w => `<button class="perfect-claim" data-perfect="${w.id}" ${pending(eventIds.perfect(w.id)) ? 'disabled' : ''}><span>✨ Идеальная неделя!</span><strong>${pending(eventIds.perfect(w.id)) ? 'Открываем волшебство…' : 'Посмотреть награду'}</strong><small>Неделя с ${w.id.split('-').reverse().join('.')}</small></button>`).join('')}
    ${!h.perfectWeeks.length ? '<p class="gentle-note">После воскресенья посмотрим, какое волшебство принесла неделя ♡</p>' : ''}`;
}
export function activityMarkup(rows, parent = false) {
  if (!rows.length) return '<p class="empty-note">Здесь будут появляться твои добрые дела и подарки.</p>';
  return `<ol class="activity-list">${rows.map(row => {
    const result = parent ? row.result ?? {} : row;
    const delta = row.balanceDelta ?? result.balanceDelta ?? 0, stars = row.starDelta ?? result.delta ?? 0;
    return `<li><div><strong>${esc(row.title ?? row.type)}</strong><small>${esc(row.date ?? row.intent?.monthKey ?? result.weekStart ?? '')}</small>${result.threshold ? `<span>Ящик ${result.threshold} ★</span>` : ''}${result.elementId ? `<span>Подарок за идеальную неделю</span>` : ''}${result.status ? `<span>${esc(({pending:'Ждёт решения',approved:'Одобрено',rejected:'Отклонено'})[result.status] ?? result.status)}</span>` : ''}</div><b>${delta ? `${delta > 0 ? '+' : ''}${delta} ✦` : stars ? `${stars > 0 ? '+' : ''}${stars} ★` : '♡'}</b>${parent ? `<details><summary>Полная запись</summary><pre>${esc(JSON.stringify(row,null,2))}</pre></details>` : ''}</li>`;
  }).join('')}</ol>`;
}

export function createGameUI({ document, store, clock, rewards, schedule, loadHistory, ready = () => true, onError = () => {} }) {
  const root = document.getElementById('gameHome'), dialog = document.getElementById('gameDialog'), ceremony = document.getElementById('rewardCeremony');
  let screen = null, parentOpen = false, historyRows = [], historyCursor = null, historyParent = false, historyMore = false;
  const today = () => familyToday(clock());
  const fail = error => {
    const message = friendlyError(error);
    document.getElementById('gameMessage').textContent = message;
    if (dialog.open) dialog.querySelector('[data-dialog-error]').textContent = message;
    onError(error);
  };
  const attempt = fn => Promise.resolve().then(fn).catch(fail);
  function open(title, body, kind = null) {
    screen = kind;
    dialog.innerHTML = `<button class="dialog-close" aria-label="Закрыть">×</button><h2>${esc(title)}</h2><div class="dialog-content">${body}</div><p data-dialog-error role="alert"></p>`;
    dialog.querySelector('.dialog-close').onclick = () => dialog.close();
    if (!dialog.open) dialog.showModal();
  }
  const run = (key, name, data, parent = false) => rewards.run(key, name, data, parent);
  function render() {
    if (!ready()) { root.innerHTML = '<p class="gentle-note" role="status">Собираем твой волшебный мир…</p>'; return; }
    const h = homeState(store, today(), rewards);
    // Receipts are server confirmations, including a response that beats its listener.
    for (const record of rewards.export()) if (record.result) {
      if (record.name === 'claimPerfectWorldReward' && !h.unlocked.some(u => u.elementId === record.result.elementId)) h.unlocked.push(record.result);
      if (record.name === 'claimExtra' && record.data.monthKey === h.monthKey) h.extraClaimed = Math.max(h.extraClaimed, record.data.tranche);
    }
    h.perfectWeeks = h.perfectWeeks.filter(w => !rewards.get(eventIds.perfect(w.id))?.result);
    root.innerHTML = homeMarkup(h, rewards.pending);
    root.querySelectorAll('[data-chest]').forEach(button => button.onclick = () => attempt(() => run(eventIds.chest(h.monthKey,+button.dataset.chest),'openChest',{ monthKey:h.monthKey,threshold:+button.dataset.chest })));
    root.querySelectorAll('[data-extra]').forEach(button => button.onclick = () => attempt(() => run(eventIds.extra(h.monthKey,+button.dataset.extra),'claimExtra',{ monthKey:h.monthKey,tranche:+button.dataset.extra })));
    root.querySelectorAll('[data-perfect]').forEach(button => button.onclick = () => attempt(() => run(eventIds.perfect(button.dataset.perfect),'claimPerfectWorldReward',{ weekStart:button.dataset.perfect })));
    if (screen === 'shop' && dialog.open) shop();
    if (screen === 'archive' && dialog.open) archive();
    if (screen === 'parent' && dialog.open) updatePurchases();
    if (screen === 'manage-shop' && dialog.open) manageShop();
    showCeremony();
  }
  function showCeremony() {
    if (ceremony.open || dialog.open || document.getElementById('parentGate').open) return;
    const record = rewards.ceremonies()[0]; if (!record) return;
    const r = record.result, world = record.name === 'claimPerfectWorldReward', month = record.name === 'finalizeMonth';
    ceremony.innerHTML = `<div class="ceremony-art">${world ? '✧' : month ? '☾' : '🎁'}</div><p class="eyebrow">${world ? 'ИДЕАЛЬНАЯ НЕДЕЛЯ!' : month ? esc(monthName(r.monthKey)) : 'ТВОЙ ПОДАРОК'}</p><h2>${world ? 'В мире появилось волшебство!' : month ? 'Месяц завершён' : record.name === 'claimExtra' ? 'Подарок за новые звёзды!' : 'Ура! Ящик открыт!'}</h2><p>${world ? `Ты открыла: <strong>${esc(r.title)}</strong>` : r.balanceDelta ? `Твоя награда: <strong>+${r.balanceDelta} Крузейрика</strong>` : 'Твои добрые дела сохранены. Впереди новый месяц!'}</p>${month ? `<p class="gentle-note">${r.settlement.starsSnapshot} ★ за месяц · заработанные ящики можно открыть в архиве</p>` : ''}<button class="game-primary" data-ack>${world ? 'Посмотреть' : 'Здорово!'}</button>`;
    ceremony.querySelector('[data-ack]').onclick = () => { ceremony.close(); rewards.acknowledge(record.key); render(); };
    ceremony.showModal();
  }
  ceremony.addEventListener('cancel', event => event.preventDefault());
  dialog.addEventListener('close', () => { screen = null; parentOpen = false; showCeremony(); });
  function shop() {
    const purchases = store.list('purchases');
    open('Магазин желаний', `<p class="gentle-note">Выбери желание. Родитель подтвердит покупку.</p><div class="shop-list">${store.list('rewards').filter(r => r.active).map(r => {
      const waiting = purchases.some(p => p.rewardId === r.id && p.status === 'pending') || rewards.export().some(op => op.name === 'childRequestPurchase' && op.data.rewardId === r.id && (['pending','uncertain'].includes(op.state) || (op.result && !purchases.some(p => p.id === op.data.id))));
      return `<article><div><span class="shop-icon">${esc(r.icon ?? '🎀')}</span><h3>${esc(r.title)}</h3><p>${r.price} Крузейриков</p></div><button class="game-primary" data-wish="${esc(r.id)}" ${waiting ? 'disabled' : ''}>${waiting ? 'Ждём решения' : 'Хочу!'}</button></article>`;
    }).join('') || '<p>Желания скоро появятся.</p>'}</div><h3>Мои пожелания</h3>${purchases.map(p => `<p>${esc(p.rewardTitle ?? p.rewardId)} · ${esc(({pending:'ждёт решения',approved:'одобрено',rejected:'обсудим другое желание'})[p.status])}</p>`).join('')}`, 'shop');
    dialog.querySelectorAll('[data-wish]').forEach(button => button.onclick = () => attempt(async () => {
      const rewardId = button.dataset.wish;
      const existing = rewards.export().find(r => r.name === 'childRequestPurchase' && r.data.rewardId === rewardId && ['pending','uncertain'].includes(r.state));
      const id = existing?.data.id ?? crypto.randomUUID();
      button.disabled = true;
      await run(`purchase:${id}`, 'childRequestPurchase', { id, rewardId }); shop();
    }));
  }
  function archive() {
    open('Книга месяцев', store.list('months').sort((a,b) => b.id.localeCompare(a.id)).map(m => `<article class="month-card"><h3>${esc(monthName(m.id))}</h3><p>${visibleStars(m)} ★ · идеальных недель: ${store.list('weeks').filter(w => w.id.startsWith(m.id) && w.currentPerfect && w.lastEvaluatedRevision === w.revision).length} · получено ${m.currencyEarned ?? 0} ✦</p><p>${m.settlement ? `Месяц закрыт: ${m.settlement.starsSnapshot} ★, итоговая выплата +${m.settlement.partialAmount} ✦` : 'Месяц ещё не закрыт'}</p><div class="archive-chests">${CHESTS.map(c => {
      const key = eventIds.chest(m.id,c.threshold), state = chestState(visibleStars(m),c.threshold,m.chests?.[c.threshold] ?? rewards.get(key)?.result ?? null,m.settlement ?? null);
      return `<button data-old-chest="${m.id}:${c.threshold}" ${!state.available || rewards.pending(key) ? 'disabled' : ''}>${c.threshold} ★ · ${state.opened ? '✓ открыт' : rewards.pending(key) ? 'открываем…' : state.available ? 'открыть' : 'закрыт'}</button>`;
    }).join('')}</div>${(m.settlement?.extraEntitlement ?? 0) > (m.extrasClaimedThrough ?? 0) ? `<button data-old-extra="${m.id}:${(m.extrasClaimedThrough ?? 0)+1}">Получить extra +1 ✦</button>` : ''}</article>`).join('') || '<p>Здесь будет твоя книга добрых дел.</p>', 'archive');
    dialog.querySelectorAll('[data-old-chest]').forEach(b => b.onclick = () => attempt(async () => { const [monthKey,t] = b.dataset.oldChest.split(':'); dialog.close(); await run(eventIds.chest(monthKey,+t),'openChest',{ monthKey,threshold:+t }); }));
    dialog.querySelectorAll('[data-old-extra]').forEach(b => b.onclick = () => attempt(async () => { const [monthKey,t] = b.dataset.oldExtra.split(':'); dialog.close(); await run(eventIds.extra(monthKey,+t),'claimExtra',{ monthKey,tranche:+t }); }));
  }
  async function history(isParent = false, more = false) {
    if (!more) { historyRows = []; historyCursor = null; historyParent = isParent; }
    const page = await loadHistory(historyParent, historyCursor);
    historyRows = mergeHistory(historyRows,page.rows); historyCursor = page.cursor; historyMore = page.more;
    open(historyParent ? 'Полный аудит' : 'История волшебства', `${activityMarkup(historyRows,historyParent)}${historyMore ? '<button data-more>Показать ещё</button>' : ''}`,'history');
    dialog.querySelector('[data-more]')?.addEventListener('click', () => attempt(() => history(historyParent,true)));
  }
  function updatePurchases() {
    const target = dialog.querySelector('[data-parent-purchases]'); if (!target) return;
    target.innerHTML = store.list('purchases').filter(p => p.status === 'pending').map(p => `<article><p>${esc(p.rewardTitle ?? p.rewardId)} · ${p.price} ✦</p><button data-approve="${esc(p.id)}">Одобрить</button><button data-reject="${esc(p.id)}">Отклонить</button></article>`).join('') || '<p>Ожидающих покупок нет.</p>';
    for (const action of ['approve','reject']) target.querySelectorAll(`[data-${action}]`).forEach(b => b.onclick = () => attempt(async () => {
      const id = b.dataset[action]; b.disabled = true;
      await run(`decision:${id}:${action}`, 'parentApprovePurchase', { id, approve: action === 'approve' }, true);
    }));
  }
  function adjustments(kind) {
    const star = kind === 'stars', name = star ? 'parentManualStarAdjustment' : 'parentManualBalanceAdjustment';
    const pending = rewards.export().find(r => r.name === name && ['pending','uncertain'].includes(r.state));
    const operationKey = pending?.key ?? `adjustment:${crypto.randomUUID()}`;
    open(star ? 'Уточнить звёзды' : 'Уточнить баланс', `<form id="adjustForm">${star ? `<label>Месяц<input name="monthKey" type="month" value="${esc(pending?.data.monthKey ?? today().slice(0,7))}" required></label>` : ''}<label>Изменение (+ или −)<input name="delta" type="number" step="1" value="${pending?.data.delta ?? ''}" required></label><label>Причина<textarea name="reason" minlength="3" maxlength="300" required>${esc(pending?.data.reason ?? '')}</textarea></label><p class="gentle-note">${star ? 'Это меняет только месячные звёзды. Идеальные недели зависят от заданий.' : 'Изменение баланса не затрагивает звёзды и подарки мира.'}</p><button class="game-primary">${pending ? 'Проверить сохранение' : 'Сохранить'}</button></form>`,'adjustment');
    if (pending) dialog.querySelectorAll('input,textarea').forEach(input => input.disabled = true);
    dialog.querySelector('form').onsubmit = event => { event.preventDefault(); const form = event.currentTarget; attempt(async () => {
      const previous = rewards.get(operationKey);
      const data = previous?.state === 'uncertain' ? previous.data : pending?.data ?? { delta:+form.elements.delta.value, reason:form.elements.reason.value, ...(star ? { monthKey:form.elements.monthKey.value } : {}) };
      form.querySelector('button').disabled = true;
      try { await run(operationKey,name,data,true); dialog.close(); document.getElementById('gameMessage').textContent = 'Изменение подтверждено'; }
      finally {
        form.querySelector('button').disabled = false;
        if (rewards.get(operationKey)?.state === 'uncertain') {
          form.querySelectorAll('input,textarea').forEach(input => input.disabled = true);
          form.querySelector('button').textContent = 'Проверить сохранение';
        }
      }
    }); };
  }
  function manageShop() {
    open('Награды магазина', `<button data-new-reward>＋ Добавить награду</button>${store.list('rewards').map(r=>`<article><p>${esc(r.icon)} ${esc(r.title)} · ${r.price} ✦${r.active?'':' · скрыта'}</p><button data-edit-reward="${esc(r.id)}">Изменить</button></article>`).join('')||'<p>Магазин пока пуст. Добавьте первое желание.</p>'}<button data-back-parent>Назад</button>`, 'manage-shop');
    dialog.querySelector('[data-new-reward]').onclick=()=>editReward();
    dialog.querySelectorAll('[data-edit-reward]').forEach(b=>b.onclick=()=>editReward(store.read(`rewards/${b.dataset.editReward}`)));
    dialog.querySelector('[data-back-parent]').onclick=openParent;
  }
  function editReward(reward=null) {
    const pending=rewards.export().find(r=>r.name==='parentSaveShopReward'&&['pending','uncertain'].includes(r.state)&&(reward?r.data.id===reward.id:r.data.expectedRevision===null));
    const id=pending?.data.id??reward?.id??crypto.randomUUID(),key=pending?.key??`shop:${crypto.randomUUID()}`,input=pending?.data.input??reward??{title:'',icon:'🎀',price:1,active:true};
    open(reward?'Изменить награду':'Добавить награду',`<form><label>Название<input name="title" maxlength="120" required value="${esc(input.title)}"></label><label>Значок<input name="icon" maxlength="32" value="${esc(input.icon)}"></label><label>Цена в Крузейриках<input name="price" type="number" min="1" step="1" required value="${input.price}"></label><label>Показывать в магазине<input name="active" type="checkbox" ${input.active?'checked':''}></label><button class="game-primary">${pending?'Проверить сохранение':'Сохранить'}</button></form><button data-back-shop>Назад</button>`,'edit-shop');
    const form=dialog.querySelector('form');
    if(pending)form.querySelectorAll('input').forEach(e=>e.disabled=true);
    dialog.querySelector('[data-back-shop]').onclick=manageShop;
    form.onsubmit=event=>{event.preventDefault();attempt(async()=>{
      const data=pending?.data??{id,expectedRevision:reward?.revision??null,input:{title:form.elements.title.value,icon:form.elements.icon.value,price:Number(form.elements.price.value),active:form.elements.active.checked}};
      form.querySelector('button').disabled=true;
      try{await run(key,'parentSaveShopReward',data,true);manageShop();}
      finally{form.querySelector('button').disabled=false;if(rewards.get(key)?.state==='uncertain'){form.querySelectorAll('input').forEach(e=>e.disabled=true);form.querySelector('button').textContent='Проверить сохранение';}}
    });};
  }
  function openParent() {
    parentOpen = true;
    open('Родительский режим', '<div class="parent-actions"><button data-parent-action="schedule">Библиотека и расписание</button><button data-parent-action="shop">Награды магазина</button><button data-parent-action="stars">Уточнить звёзды</button><button data-parent-action="balance">Уточнить баланс</button><button data-parent-action="audit">Полный аудит</button></div><h3>Покупки на подтверждение</h3><div data-parent-purchases></div>', 'parent');
    dialog.querySelectorAll('[data-parent-action]').forEach(b => b.onclick = () => {
      if (!parentOpen) return;
      const action = b.dataset.parentAction;
      if (action === 'schedule') { dialog.close(); schedule.openParent({onBack:openParent}); }
      else if (action === 'shop') manageShop();
      else if (action === 'audit') attempt(() => history(true));
      else adjustments(action);
    });
    updatePurchases(); rewards.retry(true).then(render);
  }
  document.querySelectorAll('[data-game-action]').forEach(b => b.onclick = () => {
    const action = b.dataset.gameAction;
    if (action === 'shop') shop(); else if (action === 'archive') archive(); else attempt(() => history());
  });
  const stopStore = store.subscribe(render), stopRewards = rewards.subscribe(render);
  render();
  return { render, openParent, destroy() { stopStore(); stopRewards(); } };
}
