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
    return `<li><div><strong>${esc(row.title ?? row.type)}</strong><small>${esc(row.date ?? row.intent?.monthKey ?? result.weekStart ?? '')}</small>${result.threshold ? `<span>Ящик ${result.threshold} ★</span>` : ''}${result.elementId ? '<span>Подарок за идеальную неделю</span>' : ''}${result.status ? `<span>${esc(({pending:'Ждёт решения',approved:'Одобрено',rejected:'Отклонено'})[result.status] ?? result.status)}</span>` : ''}</div><b>${delta ? `${delta > 0 ? '+' : ''}${delta} ✦` : stars ? `${stars > 0 ? '+' : ''}${stars} ★` : '♡'}</b>${parent ? `<details><summary>Полная запись</summary><pre>${esc(JSON.stringify(row,null,2))}</pre></details>` : ''}</li>`;
  }).join('')}</ol>`;
}

export function shopMarkup(rewardRows, purchases, parent = false, operations = []) {
  if (parent) return `<div class="page-heading"><div><p class="eyebrow">РОДИТЕЛЬСКИЙ РЕЖИМ</p><h1>Магазин</h1></div><button class="game-primary" data-new-reward>＋ Добавить награду</button></div>
    <section class="parent-shop-section"><h2>Награды</h2><div class="shop-manager">${rewardRows.map(reward => `<article><div><span class="shop-icon">${esc(reward.icon ?? '🎀')}</span><h3>${esc(reward.title)}</h3><p>${reward.price} Крузейриков</p><small class="task-status ${reward.active === false ? 'is-inactive' : ''}">Статус: ${reward.active === false ? 'Неактивно' : 'Активно'}</small></div><div><button data-edit-reward="${esc(reward.id)}">Изменить</button><button data-toggle-reward="${esc(reward.id)}">${reward.active === false ? 'Вернуть в магазин' : 'Убрать из магазина'}</button></div></article>`).join('') || '<p>Магазин пока пуст. Добавьте первую награду.</p>'}</div></section>
    <section class="parent-shop-section"><h2>Покупки на подтверждение</h2><div class="pending-purchases">${purchases.filter(p => p.status === 'pending').map(p => `<article><div><strong>${esc(p.rewardTitle ?? p.rewardId)}</strong><small>${p.price} Крузейриков</small></div><div><button data-approve="${esc(p.id)}">Одобрить</button><button data-reject="${esc(p.id)}">Отклонить</button></div></article>`).join('') || '<p>Ожидающих покупок нет.</p>'}</div></section>`;
  return `<div class="page-heading"><div><p class="eyebrow">МАГАЗИН ЖЕЛАНИЙ</p><h1>Выбери награду</h1></div></div><p class="gentle-note">Родитель подтвердит покупку перед списанием Крузейриков.</p><div class="shop-list">${rewardRows.filter(r => r.active).map(r => {
    const waiting = purchases.some(p => p.rewardId === r.id && p.status === 'pending') || operations.some(op => op.name === 'childRequestPurchase' && op.data.rewardId === r.id && (['pending','uncertain'].includes(op.state) || (op.result && !purchases.some(p => p.id === op.data.id))));
    return `<article><div><span class="shop-icon">${esc(r.icon ?? '🎀')}</span><h3>${esc(r.title)}</h3><p>${r.price} Крузейриков</p></div><button class="game-primary" data-wish="${esc(r.id)}" ${waiting ? 'disabled' : ''}>${waiting ? 'Ждём решения' : 'Хочу!'}</button></article>`;
  }).join('') || '<p>Желания скоро появятся.</p>'}</div><section class="purchase-status"><h2>Мои пожелания</h2>${purchases.map(p => `<p>${esc(p.rewardTitle ?? p.rewardId)} · ${esc(({pending:'ждёт решения',approved:'одобрено',rejected:'обсудим другое желание'})[p.status])}</p>`).join('') || '<p>Здесь появятся запросы на покупку.</p>'}</section>`;
}

export function settingsMarkup(parent = false) {
  if (!parent) return '<section class="settings-lock"><div aria-hidden="true">🔒</div><h1>Настройки закрыты</h1><p>Управление заданиями, наградами и балансом доступно только родителю.</p><button type="button" class="game-primary" data-parent-enter>Ввести PIN</button></section>';
  return `<div class="page-heading"><div><p class="eyebrow">РОДИТЕЛЬСКИЙ РЕЖИМ</p><h1>Настройки</h1></div></div><p class="settings-intro">Здесь собраны действия, которые доступны только родителю.</p><div class="settings-actions"><button data-settings-action="stars"><span>★</span><strong>Коррекция звёзд</strong><small>Уточнить месячный итог</small></button><button data-settings-action="balance"><span>✦</span><strong>Коррекция баланса</strong><small>Добавить или списать Крузейрики</small></button><button data-settings-action="audit"><span>☷</span><strong>Полный аудит</strong><small>Открыть подробную историю операций</small></button><button data-settings-action="retry"><span>↻</span><strong>Проверить сохранение</strong><small>Повторить незавершённые операции</small></button></div><p class="gentle-note">Семейный календарь: Asia/Almaty. После перезагрузки для входа снова потребуется PIN.</p>`;
}

export function createGameUI({ document, store, clock, rewards, schedule, loadHistory, navigate = () => {}, retryPending = () => rewards.retry(true), ready = () => true, onError = () => {} }) {
  const root = document.getElementById('gameHome'), shopRoot = document.getElementById('gameShop'), historyRoot = document.getElementById('gameHistory'), settingsRoot = document.getElementById('gameSettings');
  const dialog = document.getElementById('gameDialog'), ceremony = document.getElementById('rewardCeremony');
  let screen = null, parentMode = false, activeTab = 'main', historyRows = [], historyCursor = null, historyParent = false, historyMore = false, historyLoading = false, historyLoaded = false;
  const today = () => familyToday(clock());
  const fail = error => {
    const message = friendlyError(error);
    document.getElementById('gameMessage').textContent = message;
    if (dialog.open) dialog.querySelector('[data-dialog-error]')?.replaceChildren(message);
    onError(error);
  };
  const attempt = fn => Promise.resolve().then(fn).catch(fail);
  const run = (key, name, data, parent = false) => rewards.run(key, name, data, parent);
  function open(title, body, kind = null) {
    screen = kind;
    dialog.innerHTML = `<button class="dialog-close" aria-label="Закрыть">×</button><h2>${esc(title)}</h2><div class="dialog-content">${body}</div><p data-dialog-error role="alert"></p>`;
    dialog.querySelector('.dialog-close').onclick = () => dialog.close();
    if (!dialog.open) dialog.showModal();
  }
  function renderHome() {
    if (!ready()) { root.innerHTML = '<p class="gentle-note" role="status">Собираем твой волшебный мир…</p>'; return; }
    const h = homeState(store, today(), rewards);
    for (const record of rewards.export()) if (record.result) {
      if (record.name === 'claimPerfectWorldReward' && !h.unlocked.some(u => u.elementId === record.result.elementId)) h.unlocked.push(record.result);
      if (record.name === 'claimExtra' && record.data.monthKey === h.monthKey) h.extraClaimed = Math.max(h.extraClaimed, record.data.tranche);
    }
    h.perfectWeeks = h.perfectWeeks.filter(w => !rewards.get(eventIds.perfect(w.id))?.result);
    root.innerHTML = homeMarkup(h, rewards.pending);
    root.querySelectorAll('[data-chest]').forEach(button => button.onclick = () => attempt(() => run(eventIds.chest(h.monthKey,+button.dataset.chest),'openChest',{ monthKey:h.monthKey,threshold:+button.dataset.chest })));
    root.querySelectorAll('[data-extra]').forEach(button => button.onclick = () => attempt(() => run(eventIds.extra(h.monthKey,+button.dataset.extra),'claimExtra',{ monthKey:h.monthKey,tranche:+button.dataset.extra })));
    root.querySelectorAll('[data-perfect]').forEach(button => button.onclick = () => attempt(() => run(eventIds.perfect(button.dataset.perfect),'claimPerfectWorldReward',{ weekStart:button.dataset.perfect })));
  }
  function renderShop() { shopRoot.innerHTML = shopMarkup(store.list('rewards'), store.list('purchases'), parentMode, rewards.export()); }
  function archiveMarkup() {
    return store.list('months').sort((a,b) => b.id.localeCompare(a.id)).map(m => `<article class="month-card"><h3>${esc(monthName(m.id))}</h3><p>${visibleStars(m)} ★ · идеальных недель: ${store.list('weeks').filter(w => w.id.startsWith(m.id) && w.currentPerfect && w.lastEvaluatedRevision === w.revision).length} · получено ${m.currencyEarned ?? 0} ✦</p><p>${m.settlement ? `Месяц закрыт: ${m.settlement.starsSnapshot} ★, итоговая выплата +${m.settlement.partialAmount} ✦` : 'Месяц ещё не закрыт'}</p><div class="archive-chests">${CHESTS.map(c => {
      const key = eventIds.chest(m.id,c.threshold), state = chestState(visibleStars(m),c.threshold,m.chests?.[c.threshold] ?? rewards.get(key)?.result ?? null,m.settlement ?? null);
      return `<button data-old-chest="${m.id}:${c.threshold}" ${!state.available || rewards.pending(key) ? 'disabled' : ''}>${c.threshold} ★ · ${state.opened ? '✓ открыт' : rewards.pending(key) ? 'открываем…' : state.available ? 'открыть' : 'закрыт'}</button>`;
    }).join('')}</div>${(m.settlement?.extraEntitlement ?? 0) > (m.extrasClaimedThrough ?? 0) ? `<button data-old-extra="${m.id}:${(m.extrasClaimedThrough ?? 0)+1}">Получить extra +1 ✦</button>` : ''}</article>`).join('') || '<p>Здесь будет твоя книга добрых дел.</p>';
  }
  function renderHistory() {
    const audit = parentMode && historyParent;
    historyRoot.innerHTML = `<div class="page-heading"><div><p class="eyebrow">${audit ? 'РОДИТЕЛЬСКИЙ РЕЖИМ' : 'ИСТОРИЯ ВОЛШЕБСТВА'}</p><h1>${audit ? 'Полный аудит' : 'История'}</h1></div></div>${parentMode ? `<div class="history-switch"><button data-history-view="child" class="${audit ? '' : 'active'}">История ребёнка</button><button data-history-view="audit" class="${audit ? 'active' : ''}">Полный аудит</button></div>` : ''}<section class="history-section"><h2>${audit ? 'Операции' : 'Добрые дела и подарки'}</h2>${historyLoading ? '<p class="gentle-note">Загружаем историю…</p>' : activityMarkup(historyRows,audit)}${historyMore ? '<button data-more>Показать ещё</button>' : ''}</section>${audit ? '' : `<section class="history-section"><h2>Книга месяцев</h2>${archiveMarkup()}</section>`}`;
  }
  function renderSettings() { settingsRoot.innerHTML = settingsMarkup(parentMode); }
  function render() { renderHome(); renderShop(); renderHistory(); renderSettings(); showCeremony(); }
  function showCeremony() {
    if (ceremony.open || dialog.open || document.getElementById('scheduleDialog')?.open || document.getElementById('parentGate').open) return;
    const record = rewards.ceremonies()[0]; if (!record) return;
    const r = record.result, world = record.name === 'claimPerfectWorldReward', month = record.name === 'finalizeMonth';
    ceremony.innerHTML = `<div class="ceremony-art">${world ? '✧' : month ? '☾' : '🎁'}</div><p class="eyebrow">${world ? 'ИДЕАЛЬНАЯ НЕДЕЛЯ!' : month ? esc(monthName(r.monthKey)) : 'ТВОЙ ПОДАРОК'}</p><h2>${world ? 'В мире появилось волшебство!' : month ? 'Месяц завершён' : record.name === 'claimExtra' ? 'Подарок за новые звёзды!' : 'Ура! Ящик открыт!'}</h2><p>${world ? `Ты открыла: <strong>${esc(r.title)}</strong>` : r.balanceDelta ? `Твоя награда: <strong>+${r.balanceDelta} Крузейрика</strong>` : 'Твои добрые дела сохранены. Впереди новый месяц!'}</p>${month ? `<p class="gentle-note">${r.settlement.starsSnapshot} ★ за месяц · заработанные ящики можно открыть в истории</p>` : ''}<button class="game-primary" data-ack>${world ? 'Посмотреть' : 'Здорово!'}</button>`;
    ceremony.querySelector('[data-ack]').onclick = () => { ceremony.close(); rewards.acknowledge(record.key); render(); };
    ceremony.showModal();
  }
  ceremony.addEventListener('cancel', event => event.preventDefault());
  dialog.addEventListener('close', () => { screen = null; showCeremony(); });

  async function history(isParent = false, more = false) {
    if (isParent && !parentMode) return;
    if (!more) { historyRows = []; historyCursor = null; historyParent = isParent; historyMore = false; }
    historyLoading = true; renderHistory();
    try {
      const page = await loadHistory(historyParent, historyCursor);
      historyRows = mergeHistory(historyRows,page.rows); historyCursor = page.cursor; historyMore = page.more; historyLoaded = true;
    } finally { historyLoading = false; renderHistory(); }
  }
  function adjustments(kind) {
    const star = kind === 'stars', name = star ? 'parentManualStarAdjustment' : 'parentManualBalanceAdjustment';
    const pending = rewards.export().find(r => r.name === name && ['pending','uncertain'].includes(r.state));
    const operationKey = pending?.key ?? `adjustment:${crypto.randomUUID()}`;
    open(star ? 'Коррекция звёзд' : 'Коррекция баланса', `<form id="adjustForm">${star ? `<label>Месяц<input name="monthKey" type="month" value="${esc(pending?.data.monthKey ?? today().slice(0,7))}" required></label>` : ''}<label>Изменение (+ или −)<input name="delta" type="number" step="1" value="${pending?.data.delta ?? ''}" required></label><label>Причина<textarea name="reason" minlength="3" maxlength="300" required>${esc(pending?.data.reason ?? '')}</textarea></label><p class="gentle-note">${star ? 'Это меняет только месячные звёзды. Идеальные недели зависят от заданий.' : 'Изменение баланса не затрагивает звёзды и подарки мира.'}</p><button class="game-primary">${pending ? 'Проверить сохранение' : 'Сохранить'}</button></form>`,'adjustment');
    if (pending) dialog.querySelectorAll('input,textarea').forEach(input => input.disabled = true);
    dialog.querySelector('form').onsubmit = event => { event.preventDefault(); if (!parentMode) return dialog.close(); const form = event.currentTarget; attempt(async () => {
      const previous = rewards.get(operationKey);
      const data = previous?.state === 'uncertain' ? previous.data : pending?.data ?? { delta:+form.elements.delta.value, reason:form.elements.reason.value, ...(star ? { monthKey:form.elements.monthKey.value } : {}) };
      form.querySelector('button').disabled = true;
      try { await run(operationKey,name,data,true); dialog.close(); document.getElementById('gameMessage').textContent = 'Изменение подтверждено'; }
      finally { form.querySelector('button').disabled = false; if (rewards.get(operationKey)?.state === 'uncertain') { form.querySelectorAll('input,textarea').forEach(input => input.disabled = true); form.querySelector('button').textContent = 'Проверить сохранение'; } }
    }); };
  }
  function editReward(reward = null) {
    const pending = rewards.export().find(r => r.name === 'parentSaveShopReward' && ['pending','uncertain'].includes(r.state) && (reward ? r.data.id === reward.id : r.data.expectedRevision === null));
    const id = pending?.data.id ?? reward?.id ?? crypto.randomUUID(), key = pending?.key ?? `shop:${crypto.randomUUID()}`, input = pending?.data.input ?? reward ?? {title:'',icon:'🎀',price:1,active:true};
    open(reward ? 'Изменить награду' : 'Добавить награду', `<form><label>Название<input name="title" maxlength="120" required value="${esc(input.title)}"></label><label>Значок<input name="icon" maxlength="32" value="${esc(input.icon)}"></label><label>Цена в Крузейриках<input name="price" type="number" min="1" step="1" required value="${input.price}"></label>${reward ? `<p class="task-status ${reward.active === false ? 'is-inactive' : ''}">Статус: ${reward.active === false ? 'Неактивно' : 'Активно'}</p>` : '<p class="gentle-note">Новая награда сразу появится в магазине.</p>'}<button class="game-primary">${pending ? 'Проверить сохранение' : 'Сохранить'}</button></form>`,'edit-shop');
    const form = dialog.querySelector('form');
    if (pending) form.querySelectorAll('input').forEach(inputElement => inputElement.disabled = true);
    form.onsubmit = event => { event.preventDefault(); if (!parentMode) return dialog.close(); attempt(async () => {
      const data = pending?.data ?? {id,expectedRevision:reward?.revision??null,input:{title:form.elements.title.value,icon:form.elements.icon.value,price:Number(form.elements.price.value),active:reward ? reward.active !== false : true}};
      form.querySelector('button').disabled = true;
      try { await run(key,'parentSaveShopReward',data,true); dialog.close(); renderShop(); }
      finally { form.querySelector('button').disabled = false; if (rewards.get(key)?.state === 'uncertain') { form.querySelectorAll('input').forEach(inputElement => inputElement.disabled = true); form.querySelector('button').textContent = 'Проверить сохранение'; } }
    }); };
  }
  async function toggleReward(reward) {
    await run(`shop:${crypto.randomUUID()}`,'parentSaveShopReward',{id:reward.id,expectedRevision:reward.revision??0,input:{title:reward.title,icon:reward.icon??'🎀',price:reward.price,active:reward.active===false}},true);
  }

  shopRoot.onclick = event => {
    const target = event.target.closest('button'); if (!target) return;
    if (target.dataset.wish) return attempt(async () => {
      const rewardId = target.dataset.wish;
      const existing = rewards.export().find(r => r.name === 'childRequestPurchase' && r.data.rewardId === rewardId && ['pending','uncertain'].includes(r.state));
      const purchaseId = existing?.data.id ?? crypto.randomUUID(); target.disabled = true;
      await run(`purchase:${purchaseId}`,'childRequestPurchase',{id:purchaseId,rewardId}); renderShop();
    });
    if (!parentMode) return;
    if (target.hasAttribute('data-new-reward')) return editReward();
    if (target.dataset.editReward) return editReward(store.read(`rewards/${target.dataset.editReward}`));
    if (target.dataset.toggleReward) return attempt(async () => { target.disabled = true; await toggleReward(store.read(`rewards/${target.dataset.toggleReward}`)); renderShop(); });
    for (const action of ['approve','reject']) if (target.dataset[action]) return attempt(async () => { const purchaseId = target.dataset[action]; target.disabled = true; await run(`decision:${purchaseId}:${action}`,'parentApprovePurchase',{id:purchaseId,approve:action==='approve'},true); renderShop(); });
  };
  settingsRoot.onclick = event => {
    const target = event.target.closest('[data-settings-action]'); if (!target || !parentMode) return;
    const action = target.dataset.settingsAction;
    if (action === 'stars' || action === 'balance') adjustments(action);
    if (action === 'audit') { navigate('history'); attempt(() => history(true)); }
    if (action === 'retry') attempt(async () => { target.disabled = true; try { await retryPending(); document.getElementById('gameMessage').textContent = 'Сохранение проверено'; } finally { target.disabled = false; } });
  };
  historyRoot.onclick = event => {
    const target = event.target.closest('button'); if (!target) return;
    if (target.dataset.historyView === 'child') return attempt(() => history(false));
    if (target.dataset.historyView === 'audit' && parentMode) return attempt(() => history(true));
    if (target.hasAttribute('data-more')) return attempt(() => history(historyParent,true));
    if (target.dataset.oldChest) return attempt(async () => { const [monthKey,threshold] = target.dataset.oldChest.split(':'); await run(eventIds.chest(monthKey,+threshold),'openChest',{monthKey,threshold:+threshold}); renderHistory(); });
    if (target.dataset.oldExtra) return attempt(async () => { const [monthKey,tranche] = target.dataset.oldExtra.split(':'); await run(eventIds.extra(monthKey,+tranche),'claimExtra',{monthKey,tranche:+tranche}); renderHistory(); });
  };

  const stopStore = store.subscribe(render), stopRewards = rewards.subscribe(render);
  render();
  return {
    render,
    setParentMode(enabled) {
      parentMode = !!enabled;
      if (!parentMode) { historyParent = false; historyRows = []; historyCursor = null; historyMore = false; historyLoaded = false; if (dialog.open) dialog.close(); }
      else rewards.retry(true).then(render).catch(fail);
      render();
      if (activeTab === 'history') attempt(() => history(false));
    },
    onTab(name) { activeTab = name; if (name === 'history' && !historyLoaded && !historyLoading) attempt(() => history(false)); },
    destroy() { stopStore(); stopRewards(); if (dialog.open) dialog.close(); }
  };
}
