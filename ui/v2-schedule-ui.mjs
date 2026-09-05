import { addDays, calendarKeys, familyDate } from '../data/v2-model.mjs';
import { CATEGORY_LABELS, PROPOSED_TIME_ZONE, weeklyGrid, migrationPreview } from '../data/v2-schedule.mjs';
import { createScheduleService } from '../data/v2-schedule-service.mjs';
import { v2Progress } from '../data/v2-optimistic.mjs';

export const escapeText = (value = '') => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const prettyDate = date => `${date.slice(8, 10)}.${date.slice(5, 7)}`;
const id = () => crypto.randomUUID();

export function gridMarkup(category, weekStart, today, assignments, parent = false, facts = [], protectedMode = null) {
  const completed = new Set(facts.filter(f => f.done).map(f => f.assignmentId));
  return `<div class="section-head"><div><div class="eyebrow">МОЯ НЕДЕЛЯ</div><h2>${category === 'sport' ? '🌟 Спорт' : '🌷 Дом'}</h2></div>
    ${parent ? '<button class="btn" data-v2-action="lock">Готово</button>' : ''}</div>
    <div class="week-navigation"><button class="btn" data-v2-action="previous" aria-label="Предыдущая неделя">←</button>
    <div><strong>${prettyDate(weekStart)} — ${prettyDate(addDays(weekStart, 6))}</strong><div class="tiny">${weekStart.slice(0, 4)}</div></div>
    <button class="btn" data-v2-action="next" aria-label="Следующая неделя">→</button></div>
    <button class="week-today" data-v2-action="current">Текущая неделя</button>
    <p class="schedule-note">${protectedMode ? (parent ? 'Режим исправления: можно менять прошлые и сегодняшние отметки.' : 'Отмечай задания на сегодня. Один раз — одна звезда.') : 'Знакомимся с расписанием. Отмечать задания здесь можно будет позже.'}</p>
    ${parent && !protectedMode ? '<p class="draft-note">Черновик на этом устройстве. Изменения не отправляются в Firebase и исчезнут после перезагрузки.</p>' : ''}
    <div class="week-grid">${weeklyGrid(weekStart, today, category, assignments).map(day => `
      <section class="week-day ${day.isToday ? 'is-today' : ''}" ${day.isToday ? 'aria-current="date"' : ''}>
        <div class="week-day-head"><h3>${weekdays[day.weekday - 1]} <span>${prettyDate(day.date)}</span></h3>${day.isToday ? '<span class="today-dot">Сегодня</span>' : ''}</div>
        ${day.assignments.filter(a => parent || a.status !== 'cancelled').map(a => `<div class="schedule-task ${a.status === 'cancelled' ? 'is-cancelled' : ''}">
          <label class="completion-target"><input type="checkbox" ${!protectedMode?.ready || a.status !== 'scheduled' || (parent ? day.isFuture : !day.isToday) || protectedMode?.pending(a.id) ? 'disabled' : ''} data-v2-completion="${escapeText(a.id)}"
            ${protectedMode?.pending(a.id) ? 'aria-busy="true"' : ''} ${completed.has(a.id) ? 'checked' : ''}
            aria-label="${escapeText(a.taskTitleSnapshot)}${protectedMode ? '' : ' — отметки пока недоступны'}">
          <span>${escapeText(a.taskTitleSnapshot)}${a.status === 'cancelled' ? '<small>Отменено</small>' : ''}</span></label>
          ${parent && a.status !== 'cancelled' ? `<button class="cancel-assignment" data-v2-action="cancel" data-id="${escapeText(a.id)}" aria-label="Отменить ${escapeText(a.taskTitleSnapshot)}">×</button>` : ''}</div>`).join('') || '<div class="week-empty">Свободный день ✨</div>'}
        ${parent ? `<button class="add-assignment" data-v2-action="add" data-date="${day.date}">＋ Добавить</button>` : ''}
      </section>`).join('')}</div>`;
}

export function createScheduleUI({ document, store, getLegacyTasks = () => [], clock = () => new Date(), onSelectWeek = () => {}, protectedService = null, completionState = null, onError = () => {} }) {
  const timeZone = PROPOSED_TIME_ZONE;
  const today = () => familyDate(clock(), timeZone);
  let selectedWeek = calendarKeys(today()).weekStart, parent = false, onBack = () => {};
  const service = protectedService ?? createScheduleService(store.adapter, { today });
  const roots = Object.fromEntries(['sport', 'home'].map(category => [category, document.getElementById(`${category}Schedule`)]));
  const overlay = document.getElementById('v2ModalOverlay'), card = document.getElementById('v2ModalCard');
  const choices = {};
  let lastToday = today();
  function render() {
    for (const [category, root] of Object.entries(roots)) {
      const status = completionState ? { ready: completionState.ready(), pending: id => completionState.pending(id) } : null;
      const progress = completionState ? v2Progress(completionState.visible(), today(), selectedWeek) : null;
      const html = (progress ? `<p class="draft-note" aria-live="polite">Сегодня: ${progress.todayCompleted}/${progress.todayScheduled} · Звёзды месяца: ${progress.monthStars} · Неделя: ${progress.weekCompleted}/${progress.weekScheduled}</p>` : '')
        + gridMarkup(category, selectedWeek, today(), store.list('assignments'), parent, store.list('completionFacts'), status);
      if (root.innerHTML !== html) root.innerHTML = html;
    }
  }
  function show(html) {
    card.innerHTML = `${html}<p class="form-error" role="alert" data-form-error></p>`;
    overlay.classList.remove('hidden');
    card.querySelector('input,select,button')?.focus();
  }
  function close() { overlay.classList.add('hidden'); }
  function button(action, label, extra = '') { return `<button type="button" class="btn" data-modal-action="${action}" ${extra}>${label}</button>`; }
  function backButtons() { return `<div class="modal-actions">${button('library', '← Библиотека')}${button('close', 'Закрыть')}</div>`; }
  function formAction(callback) {
    let busy = false;
    card.querySelector('form').onsubmit = async event => {
      event.preventDefault();
      if (busy) return;
      busy = true;
      const form = event.currentTarget, submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      const data = new FormData(form);
      try { await callback(data); }
      catch (error) { card.querySelector('[data-form-error]').textContent = error.message; }
      finally { busy = false; submit.disabled = false; }
    };
  }
  function taskOptions(selected = '') {
    return store.list('libraryTasks').filter(task => task.active !== false || task.id === selected).map(task =>
      `<option value="${escapeText(task.id)}" ${task.id === selected ? 'selected' : ''}>${escapeText(task.title)} · ${CATEGORY_LABELS[task.category] ?? '—'}${task.active === false ? ' · неактивно' : ''}</option>`).join('');
  }
  function openLibrary() {
    show(`<h3>Библиотека заданий 📚</h3><p class="draft-note">${protectedService ? 'Семейное расписание · изменения сохраняются после проверки прав родителя.' : 'Локальный черновик · без записи в Firebase · до перезагрузки.'}</p>
      <div class="parent-tools">${button('new-task', '＋ Новое задание')}${button('rules', 'Повторения')}${protectedService ? '' : button('migration', 'Старые задания')}${button('timezone', 'Календарь')}</div>
      ${Object.entries(CATEGORY_LABELS).map(([category, label]) => `<h4>${label}</h4>${store.list('libraryTasks').filter(task => task.category === category).map(task => `
        <div class="manager-row"><span class="grow">${escapeText(task.icon || '✨')} ${escapeText(task.title)}${task.active === false ? '<small class="tiny"> · Неактивно</small>' : ''}</span>
        ${button('edit-task', 'Изменить', `data-id="${escapeText(task.id)}"`)}</div>`).join('') || '<p class="tiny">Пока нет заданий</p>'}`).join('')}
      <h4>Расписание</h4><div class="parent-tools">${button('manage-sport', '🌟 Спорт')}${button('manage-home', '🌷 Дом')}</div>
      <div class="modal-actions">${button('back-parent', '← Родительское меню')}${button('close', 'Закрыть')}</div>`);
  }
  function openTask(task = null, date = null) {
    const taskId = task?.id ?? id(), operationId = id(), assignmentId = id();
    show(`<h3>${task ? 'Изменить задание' : 'Новое задание'}</h3><form>
      <label>Название<input class="field" name="title" maxlength="120" required value="${escapeText(task?.title ?? '')}" placeholder="Например: Убрать игрушки"></label>
      <label>Раздел<select class="field" name="category" required><option value="">Выберите раздел</option>${Object.entries(CATEGORY_LABELS).map(([key, label]) => `<option value="${key}" ${task?.category === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <label>Иконка<input class="field" name="icon" maxlength="24" value="${escapeText(task?.icon ?? '✨')}"></label>
      <label class="check-label"><input type="checkbox" name="active" ${task?.active !== false ? 'checked' : ''}> Активное задание</label>
      <p class="tiny">${date ? `После сохранения добавим на ${prettyDate(date)}. ` : ''}Задание останется в библиотеке для следующих недель.</p>
      <button class="btn primary" type="submit">${date ? 'Сохранить и назначить' : protectedService ? 'Сохранить' : 'Сохранить в черновик'}</button></form>${backButtons()}`);
    formAction(async data => {
      await service.saveLibrary({ id: taskId, operationId, expectedRevision: task ? task.revision ?? 0 : null,
        input: { title: data.get('title'), category: data.get('category'), icon: data.get('icon'), active: data.has('active') } });
      if (date) { await service.assign({ id: assignmentId, libraryTaskId: taskId, date }); close(); }
      else openLibrary();
    });
  }
  function openAdd(date) {
    const assignmentId = id();
    show(`<h3>Добавить на ${prettyDate(date)}</h3><form><label>Из библиотеки<select class="field" name="libraryTaskId" required><option value="">Выберите задание</option>${taskOptions()}</select></label>
      <div class="modal-actions"><button class="btn primary" type="submit">Добавить на этот день</button></div></form>
      <div class="parent-tools">${button('new-for-day', '＋ Создать новое задание', `data-date="${date}"`)}${button('repeat-for-day', 'Настроить повторение', `data-date="${date}"`)}</div>${backButtons()}`);
    formAction(async data => { await service.assign({ id: assignmentId, libraryTaskId: data.get('libraryTaskId'), date }); close(); });
  }
  function openRules() {
    show(`<h3>Повторяющиеся задания</h3><p class="tiny">Подготавливаем текущую неделю и две следующие. Уже назначенные дни меняются только через явную отмену.</p>
      ${button('new-rule', '＋ Новое повторение')}${store.list('scheduleRules').map(rule => `<div class="manager-row"><span class="grow">
        ${escapeText(store.read(`libraryTasks/${rule.libraryTaskId}`)?.title ?? 'Задание')}
        <small class="tiny">${rule.weekdays.map(day => weekdays[day - 1]).join(', ')} · ${rule.active ? 'активно' : 'остановлено'}</small></span>
        ${button('edit-rule', 'Изменить', `data-id="${escapeText(rule.id)}"`)}</div>`).join('')}
      <div class="modal-actions">${button('generate', 'Обновить ближайшие 3 недели')}</div>${backButtons()}`);
  }
  function openRule(rule = null, date = today(), selectedTask = '') {
    const ruleId = rule?.id ?? id(), operationId = id();
    const earliest = rule ? [addDays(today(), 1), addDays(rule.materializedThrough ?? today(), 1)].sort().at(-1) : today();
    show(`<h3>${rule ? 'Изменить повторение' : 'Новое повторение'}</h3><form>
      <label>Задание<select class="field" name="libraryTaskId" required><option value="">Выберите задание</option>${taskOptions(rule?.libraryTaskId ?? selectedTask)}</select></label>
      <fieldset class="weekday-choices"><legend>Повторять</legend>${weekdays.map((label, index) => `<label><input type="checkbox" name="weekday" value="${index + 1}" ${rule?.weekdays.includes(index + 1) ? 'checked' : ''}>${label}</label>`).join('')}</fieldset>
      <label>Начиная с<input class="field" type="date" name="startDate" required value="${escapeText(rule?.startDate ?? date)}"></label>
      <label>До даты (необязательно)<input class="field" type="date" name="endDate" value="${escapeText(rule?.endDate ?? '')}"></label>
      <label class="check-label"><input type="checkbox" name="active" ${rule?.active !== false ? 'checked' : ''}> Повторение активно</label>
      <p class="tiny">${rule ? `Новые условия — не раньше ${prettyDate(earliest)}.${earliest.slice(0, 4)}. ` : ''}Уже созданные назначения сохранятся. Их можно отменить в расписании.</p>
      <button class="btn primary" type="submit">Сохранить повторение</button></form>${backButtons()}`);
    formAction(async data => {
      await service.saveRule({ id: ruleId, operationId, expectedRevision: rule?.revision ?? null, input: {
        libraryTaskId: data.get('libraryTaskId'), weekdays: data.getAll('weekday').map(Number), startDate: data.get('startDate'),
        endDate: data.get('endDate') || null, active: data.has('active')
      } });
      await service.materializeRule(ruleId);
      openRules();
    });
  }
  function openMigration() {
    const rows = migrationPreview(getLegacyTasks(), choices);
    show(`<h3>Предпросмотр старых заданий</h3><p class="draft-note">Импорт не выполняется. Выберите раздел для каждого задания. Старые выполнения и баланс сохраняются.</p>
      ${rows.map(row => `<div class="migration-row"><strong>${escapeText(row.legacy.icon)} ${escapeText(row.legacy.title)}</strong>
        <div class="tiny">ID: ${escapeText(row.legacy.id)} · ${row.legacy.active ? 'активно' : 'неактивно'} · ${escapeText(row.legacy.reward)} Крузейриков в старой версии</div>
        <p class="tiny">В библиотеке: то же название, иконка и ID. Денежная награда не переносится.</p>
        <label>Новый раздел<select class="field" data-migration-id="${escapeText(row.legacy.id)}"><option value="">Не назначен</option>${Object.entries(CATEGORY_LABELS).map(([key, label]) => `<option value="${key}" ${row.proposed.category === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div>`).join('') || '<p>Старых заданий пока нет.</p>'}${backButtons()}`);
    card.querySelectorAll('[data-migration-id]').forEach(select => select.onchange = () => { choices[select.dataset.migrationId] = select.value; });
  }
  function openTimezone() {
    show(`<h3>Семейный календарь</h3><p>Астана · <b>${escapeText(timeZone)}</b>.</p>
      <p class="tiny">Семейный часовой пояс утверждён. Часовой пояс устройства не меняет даты заданий.</p>${backButtons()}`);
  }
  function selectWeek(weekStart) { selectedWeek = weekStart; render(); onSelectWeek(weekStart); }
  for (const root of Object.values(roots)) root.onclick = async event => {
    const checkbox = event.target.closest('[data-v2-completion]');
    if (checkbox && completionState && !checkbox.disabled) {
      try { await completionState.setCompletion(checkbox.dataset.v2Completion, checkbox.checked, parent); }
      catch (error) { onError(error); render(); }
      return;
    }
    const target = event.target.closest('[data-v2-action]');
    if (!target) return;
    const action = target.dataset.v2Action;
    if (action === 'previous') selectWeek(addDays(selectedWeek, -7));
    if (action === 'next') selectWeek(addDays(selectedWeek, 7));
    if (action === 'current') selectWeek(calendarKeys(today()).weekStart);
    if (action === 'lock') { parent = false; render(); }
    if (!parent) return;
    if (action === 'add') openAdd(target.dataset.date);
    if (action === 'cancel') {
      const assignment = store.read(`assignments/${target.dataset.id}`);
      show(`<h3>Отменить задание?</h3><p>${escapeText(assignment.taskTitleSnapshot)} · ${prettyDate(assignment.date)}</p><p class="tiny">Запись останется в истории черновика.</p>
        <form><button type="submit" class="btn danger">Отменить назначение</button></form>${button('close', 'Оставить')}`);
      formAction(async () => { await service.cancel({ id: target.dataset.id, weekStart: assignment.weekStart }); close(); });
    }
  };
  card.onclick = async event => {
    const target = event.target.closest('[data-modal-action]');
    if (!target) return;
    const action = target.dataset.modalAction;
    if (action === 'library') openLibrary();
    if (action === 'close') close();
    if (action === 'back-parent') { close(); onBack(); }
    if (action === 'new-task') openTask();
    if (action === 'edit-task') openTask({ ...store.read(`libraryTasks/${target.dataset.id}`), id: target.dataset.id });
    if (action === 'new-for-day') openTask(null, target.dataset.date);
    if (action === 'rules') openRules();
    if (action === 'new-rule') openRule();
    if (action === 'edit-rule') openRule({ ...store.read(`scheduleRules/${target.dataset.id}`), id: target.dataset.id });
    if (action === 'repeat-for-day') openRule(null, target.dataset.date, card.querySelector('[name="libraryTaskId"]').value);
    if (action === 'migration') openMigration();
    if (action === 'timezone') openTimezone();
    if (action.startsWith('manage-')) {
      close(); const category = action.slice(7);
      document.querySelector(`[data-tab="${category}"]`).click(); render();
    }
    if (action === 'generate') {
      target.disabled = true;
      try { for (const rule of store.list('scheduleRules')) await service.materializeRule(rule.id); openRules(); }
      catch (error) { card.querySelector('[data-form-error]').textContent = error.message; target.disabled = false; }
    }
  };
  overlay.onkeydown = event => { if (event.key === 'Escape') close(); };
  const unsubscribe = store.subscribe(render);
  render();
  return {
    selectedWeek: () => selectedWeek,
    openParent(options = {}) { parent = true; onBack = options.onBack ?? (() => {}); render(); openLibrary(); },
    updateSettings(settings) {
      if (settings?.timeZone && settings.timeZone !== timeZone) onError(new Error('Семейный timezone должен быть Asia/Almaty'));
    },
    refreshDate() {
      const current = today();
      if (current === lastToday) return;
      const wasCurrent = selectedWeek === calendarKeys(lastToday).weekStart;
      lastToday = current;
      if (wasCurrent) selectWeek(calendarKeys(current).weekStart); else render();
    },
    destroy() { unsubscribe(); }
  };
}
