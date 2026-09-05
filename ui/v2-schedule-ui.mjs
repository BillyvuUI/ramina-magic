import { addDays, calendarKeys, familyDate } from '../data/v2-model.mjs';
import { CATEGORY_LABELS, PROPOSED_TIME_ZONE, weeklyGrid } from '../data/v2-schedule.mjs';
import { createScheduleService } from '../data/v2-schedule-service.mjs';
import { v2Progress } from '../data/v2-optimistic.mjs';

export const escapeText = (value = '') => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const prettyDate = date => `${date.slice(8, 10)}.${date.slice(5, 7)}`;
const id = () => crypto.randomUUID();

export function gridMarkup(category, weekStart, today, assignments, parent = false, facts = [], protectedMode = null) {
  const completed = new Set(facts.filter(f => f.done).map(f => f.assignmentId));
  return `<div class="section-head"><div><div class="eyebrow">МОЯ НЕДЕЛЯ</div><h2>${category === 'sport' ? '🌟 Спорт' : '🌷 Дом'}</h2></div></div>
    <div class="week-navigation"><button class="btn" data-v2-action="previous" aria-label="Предыдущая неделя">←</button>
    <div><strong>${prettyDate(weekStart)} — ${prettyDate(addDays(weekStart, 6))}</strong><div class="tiny">${weekStart.slice(0, 4)}</div></div>
    <button class="btn" data-v2-action="next" aria-label="Следующая неделя">→</button></div>
    <button class="week-today" data-v2-action="current">Текущая неделя</button>
    <p class="schedule-note">${protectedMode ? (parent ? 'Родитель может исправлять отметки прошлых дней и сегодня. Будущие дни доступны только для просмотра.' : 'Отмечай задания на сегодня. Прошлые и будущие дни доступны только для просмотра.') : 'Знакомимся с расписанием. Отмечать задания здесь можно будет позже.'}</p>
    ${parent ? '<div class="schedule-parent-tools"><strong>Управление расписанием</strong><div><button class="btn" data-v2-action="library">Библиотека заданий</button><button class="btn" data-v2-action="rules">Повторения</button></div></div>' : ''}
    ${parent && !protectedMode ? '<p class="draft-note">Черновик на этом устройстве. Изменения не отправляются в Firebase и исчезнут после перезагрузки.</p>' : ''}
    <div class="week-grid">${weeklyGrid(weekStart, today, category, assignments).map(day => `
      <section class="week-day ${day.isToday ? 'is-today' : ''}" ${day.isToday ? 'aria-current="date"' : ''}>
        <div class="week-day-head"><h3>${weekdays[day.weekday - 1]} <span>${prettyDate(day.date)}</span></h3>${day.isToday ? '<span class="today-dot">Сегодня</span>' : ''}</div>
        ${day.assignments.filter(a => parent || a.status !== 'cancelled').map(a => `<div class="schedule-task ${a.status === 'cancelled' ? 'is-cancelled' : ''}">
          <label class="completion-target"><input type="checkbox" ${!protectedMode?.ready || a.status !== 'scheduled' || (parent ? day.isFuture : !day.isToday) || protectedMode?.pending(a.id) ? 'disabled' : ''} data-v2-completion="${escapeText(a.id)}"
            ${protectedMode?.pending(a.id) ? 'aria-busy="true"' : ''} ${completed.has(a.id) ? 'checked' : ''}
            aria-label="${escapeText(a.taskTitleSnapshot)}${protectedMode ? '' : ' — отметки пока недоступны'}">
          <span>${escapeText(a.taskTitleSnapshot)}${a.status === 'cancelled' ? '<small>Назначение снято</small>' : ''}</span></label>
          ${parent ? `<div class="assignment-actions"><button type="button" data-v2-action="edit-assignment-task" data-task-id="${escapeText(a.libraryTaskId)}" aria-label="Открыть задание ${escapeText(a.taskTitleSnapshot)}">Изменить</button>${a.status !== 'cancelled' ? `<button type="button" class="cancel-assignment" data-v2-action="cancel" data-id="${escapeText(a.id)}">Снять</button>` : ''}</div>` : ''}</div>`).join('') || '<div class="week-empty">Свободный день ✨</div>'}
        ${parent ? `<button class="add-assignment" data-v2-action="add" data-date="${day.date}">＋ Добавить задание</button>` : ''}
      </section>`).join('')}</div>`;
}

export function libraryMarkup(tasks) {
  return `<section class="schedule-parent-workspace" aria-label="Библиотека заданий"><div class="parent-workspace-head"><div><p class="eyebrow">РОДИТЕЛЬСКИЙ РЕЖИМ</p><h3>Библиотека заданий</h3></div><button class="btn primary" data-v2-action="new-task">＋ Новое задание</button></div>
    ${Object.entries(CATEGORY_LABELS).map(([category, label]) => `<h4>${label}</h4>${tasks.filter(task => task.category === category).map(task => `
      <article class="manager-row"><span class="grow">${escapeText(task.icon || '✨')} <strong>${escapeText(task.title)}</strong><small class="task-status ${task.active === false ? 'is-inactive' : ''}">Статус: ${task.active === false ? 'Неактивно' : 'Активно'}</small></span>
      <button class="btn" data-v2-action="edit-task" data-id="${escapeText(task.id)}">Открыть</button></article>`).join('') || '<p class="tiny">Пока нет заданий</p>'}`).join('')}</section>`;
}

export function rulesMarkup(rules, tasks) {
  const byId = new Map(tasks.map(task => [task.id, task]));
  return `<section class="schedule-parent-workspace" aria-label="Повторяющиеся задания"><div class="parent-workspace-head"><div><p class="eyebrow">РОДИТЕЛЬСКИЙ РЕЖИМ</p><h3>Повторения</h3></div><button class="btn primary" data-v2-action="new-rule">＋ Новое повторение</button></div>
    <p class="tiny">Изменения действуют только для ещё не созданных назначений. Прошлые записи сохраняются без изменений.</p>
    ${rules.map(rule => `<article class="manager-row"><span class="grow"><strong>${escapeText(byId.get(rule.libraryTaskId)?.title ?? 'Задание')}</strong><small class="tiny">${rule.weekdays.map(day => weekdays[day - 1]).join(', ')} · ${rule.active ? 'активно' : 'остановлено'}</small></span><button class="btn" data-v2-action="edit-rule" data-id="${escapeText(rule.id)}">Открыть</button></article>`).join('') || '<p class="tiny">Повторений пока нет.</p>'}
    <button class="btn" data-v2-action="generate">Обновить ближайшие 3 недели</button></section>`;
}

export function taskEditorMarkup(task = null, date = null, protectedService = true) {
  const active = task?.active !== false;
  return `<button type="button" class="dialog-close" data-dialog-action="close" aria-label="Закрыть">×</button><h2>${task ? 'Изменить задание' : 'Новое задание'}</h2><form>
    <label>Название<input class="field" name="title" maxlength="120" required value="${escapeText(task?.title ?? '')}" placeholder="Например: Убрать игрушки"></label>
    <label>Раздел<select class="field" name="category" required><option value="">Выберите раздел</option>${Object.entries(CATEGORY_LABELS).map(([key, label]) => `<option value="${key}" ${task?.category === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
    <label>Иконка<input class="field" name="icon" maxlength="24" value="${escapeText(task?.icon ?? '✨')}"></label>
    ${task ? `<p class="task-status ${active ? '' : 'is-inactive'}">Статус: ${active ? 'Активно' : 'Неактивно'}</p>` : '<p class="tiny">Новое задание сразу появится в списке активных.</p>'}
    <p class="tiny">${date ? `После сохранения задание будет назначено на ${prettyDate(date)}. ` : ''}Прошлые назначения и история сохранят прежние название и раздел.</p>
    <button class="btn primary" type="submit">${date ? 'Сохранить и назначить' : protectedService ? 'Сохранить' : 'Сохранить в черновик'}</button></form>
    ${task ? `<button type="button" class="btn ${active ? 'danger' : ''}" data-dialog-action="toggle-task" data-id="${escapeText(task.id)}">${active ? 'Убрать из активных' : 'Вернуть в активные'}</button>` : ''}<p class="form-error" role="alert" data-form-error></p>`;
}

export function createScheduleUI({ document, store, clock = () => new Date(), onSelectWeek = () => {}, protectedService = null, completionState = null, onError = () => {} }) {
  const timeZone = PROPOSED_TIME_ZONE;
  const today = () => familyDate(clock(), timeZone);
  let selectedWeek = calendarKeys(today()).weekStart, parentMode = false, workspace = null, lastToday = today();
  const service = protectedService ?? createScheduleService(store.adapter, { today });
  const roots = Object.fromEntries(['sport', 'home'].map(category => [category, document.getElementById(`${category}Schedule`)]));
  const dialog = document.getElementById('scheduleDialog');

  function render() {
    for (const [category, root] of Object.entries(roots)) {
      const status = completionState ? { ready: completionState.ready(), pending: assignmentId => completionState.pending(assignmentId) } : null;
      const progress = completionState ? v2Progress(completionState.visible(), today(), selectedWeek) : null;
      const parentWorkspace = !parentMode ? '' : workspace === 'library' ? libraryMarkup(store.list('libraryTasks')) : workspace === 'rules' ? rulesMarkup(store.list('scheduleRules'), store.list('libraryTasks')) : '';
      const html = (progress ? `<p class="draft-note" aria-live="polite">Сегодня: ${progress.todayCompleted}/${progress.todayScheduled} · Звёзды месяца: ${progress.monthStars} · Неделя: ${progress.weekCompleted}/${progress.weekScheduled}</p>` : '')
        + gridMarkup(category, selectedWeek, today(), store.list('assignments'), parentMode, store.list('completionFacts'), status) + parentWorkspace;
      if (root.innerHTML !== html) root.innerHTML = html;
    }
  }
  function show(html) {
    dialog.innerHTML = html;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector('input,select,button')?.focus();
  }
  function close() { if (dialog.open) dialog.close(); }
  function formAction(callback) {
    let busy = false;
    dialog.querySelector('form').onsubmit = async event => {
      event.preventDefault();
      if (busy || !parentMode) return;
      busy = true;
      const form = event.currentTarget, submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try { await callback(new FormData(form)); }
      catch (error) { dialog.querySelector('[data-form-error]').textContent = error.message; }
      finally { busy = false; submit.disabled = false; }
    };
  }
  function taskOptions(selected = '') {
    return store.list('libraryTasks').filter(task => task.active !== false || task.id === selected).map(task =>
      `<option value="${escapeText(task.id)}" ${task.id === selected ? 'selected' : ''}>${escapeText(task.title)} · ${CATEGORY_LABELS[task.category] ?? '—'}${task.active === false ? ' · неактивно' : ''}</option>`).join('');
  }
  function openTask(task = null, date = null) {
    const taskId = task?.id ?? id(), operationId = id(), assignmentId = id();
    show(taskEditorMarkup(task, date, !!protectedService));
    formAction(async data => {
      await service.saveLibrary({ id: taskId, operationId, expectedRevision: task ? task.revision ?? 0 : null,
        input: { title: data.get('title'), category: data.get('category'), icon: data.get('icon'), active: task ? task.active !== false : true } });
      if (date) await service.assign({ id: assignmentId, libraryTaskId: taskId, date });
      workspace = 'library'; close(); render();
    });
  }
  function openAdd(date) {
    const assignmentId = id();
    show(`<button type="button" class="dialog-close" data-dialog-action="close" aria-label="Закрыть">×</button><h2>Добавить на ${prettyDate(date)}</h2><form><label>Из библиотеки<select class="field" name="libraryTaskId" required><option value="">Выберите задание</option>${taskOptions()}</select></label><button class="btn primary" type="submit">Добавить на этот день</button></form><div class="parent-tools"><button class="btn" data-dialog-action="new-for-day" data-date="${date}">＋ Создать новое задание</button><button class="btn" data-dialog-action="repeat-for-day" data-date="${date}">Настроить повторение</button></div><p class="form-error" role="alert" data-form-error></p>`);
    formAction(async data => { await service.assign({ id: assignmentId, libraryTaskId: data.get('libraryTaskId'), date }); close(); render(); });
  }
  function openRule(rule = null, date = today(), selectedTask = '') {
    const ruleId = rule?.id ?? id(), operationId = id();
    const earliest = rule ? [addDays(today(), 1), addDays(rule.materializedThrough ?? today(), 1)].sort().at(-1) : today();
    show(`<button type="button" class="dialog-close" data-dialog-action="close" aria-label="Закрыть">×</button><h2>${rule ? 'Изменить повторение' : 'Новое повторение'}</h2><form>
      <label>Задание<select class="field" name="libraryTaskId" required><option value="">Выберите задание</option>${taskOptions(rule?.libraryTaskId ?? selectedTask)}</select></label>
      <fieldset class="weekday-choices"><legend>Повторять</legend>${weekdays.map((label, index) => `<label><input type="checkbox" name="weekday" value="${index + 1}" ${rule?.weekdays.includes(index + 1) ? 'checked' : ''}>${label}</label>`).join('')}</fieldset>
      <label>Начиная с<input class="field" type="date" name="startDate" required value="${escapeText(rule?.startDate ?? date)}"></label>
      <label>До даты (необязательно)<input class="field" type="date" name="endDate" value="${escapeText(rule?.endDate ?? '')}"></label>
      <label class="check-label"><input type="checkbox" name="active" ${rule?.active !== false ? 'checked' : ''}> Повторение активно</label>
      <p class="tiny">${rule ? `Новые условия — не раньше ${prettyDate(earliest)}.${earliest.slice(0, 4)}. ` : ''}Уже созданные назначения сохранятся без изменений.</p>
      <button class="btn primary" type="submit">Сохранить повторение</button></form><p class="form-error" role="alert" data-form-error></p>`);
    formAction(async data => {
      await service.saveRule({ id: ruleId, operationId, expectedRevision: rule?.revision ?? null, input: {
        libraryTaskId: data.get('libraryTaskId'), weekdays: data.getAll('weekday').map(Number), startDate: data.get('startDate'), endDate: data.get('endDate') || null, active: data.has('active')
      } });
      await service.materializeRule(ruleId); workspace = 'rules'; close(); render();
    });
  }
  function selectWeek(weekStart) { selectedWeek = weekStart; render(); onSelectWeek(weekStart); }

  for (const root of Object.values(roots)) root.onclick = async event => {
    const checkbox = event.target.closest('[data-v2-completion]');
    if (checkbox && completionState && !checkbox.disabled) {
      try { await completionState.setCompletion(checkbox.dataset.v2Completion, checkbox.checked, parentMode); }
      catch (error) { onError(error); render(); }
      return;
    }
    const target = event.target.closest('[data-v2-action]');
    if (!target) return;
    const action = target.dataset.v2Action;
    if (action === 'previous') return selectWeek(addDays(selectedWeek, -7));
    if (action === 'next') return selectWeek(addDays(selectedWeek, 7));
    if (action === 'current') return selectWeek(calendarKeys(today()).weekStart);
    if (!parentMode) return;
    if (action === 'library') { workspace = workspace === 'library' ? null : 'library'; return render(); }
    if (action === 'rules') { workspace = workspace === 'rules' ? null : 'rules'; return render(); }
    if (action === 'new-task') return openTask();
    if (action === 'edit-task' || action === 'edit-assignment-task') {
      const taskId = target.dataset.id ?? target.dataset.taskId;
      const task = store.read(`libraryTasks/${taskId}`);
      if (task) return openTask({ ...task, id: taskId });
    }
    if (action === 'new-rule') return openRule();
    if (action === 'edit-rule') { const rule = store.read(`scheduleRules/${target.dataset.id}`); if (rule) return openRule({ ...rule, id: target.dataset.id }); }
    if (action === 'add') return openAdd(target.dataset.date);
    if (action === 'cancel') {
      const assignment = store.read(`assignments/${target.dataset.id}`);
      show(`<button type="button" class="dialog-close" data-dialog-action="close" aria-label="Закрыть">×</button><h2>Снять назначение?</h2><p>${escapeText(assignment.taskTitleSnapshot)} · ${prettyDate(assignment.date)}</p><p class="tiny">Запись о задании и уже сделанная отметка останутся в истории.</p><form><button type="submit" class="btn danger">Снять назначение</button></form><p class="form-error" role="alert" data-form-error></p>`);
      return formAction(async () => { await service.cancel({ id: target.dataset.id, weekStart: assignment.weekStart }); close(); render(); });
    }
    if (action === 'generate') {
      target.disabled = true;
      try { for (const rule of store.list('scheduleRules')) await service.materializeRule(rule.id); render(); }
      catch (error) { onError(error); target.disabled = false; }
    }
  };

  dialog.onclick = async event => {
    const target = event.target.closest('[data-dialog-action]');
    if (!target) return;
    const action = target.dataset.dialogAction;
    if (action === 'close') return close();
    if (!parentMode) return close();
    if (action === 'new-for-day') return openTask(null, target.dataset.date);
    if (action === 'repeat-for-day') return openRule(null, target.dataset.date, dialog.querySelector('[name="libraryTaskId"]')?.value ?? '');
    if (action === 'toggle-task') {
      const task = store.read(`libraryTasks/${target.dataset.id}`); if (!task) return close();
      target.disabled = true;
      try {
        await service.saveLibrary({ id: task.id, operationId: id(), expectedRevision: task.revision ?? 0,
          input: { title: task.title, category: task.category, icon: task.icon ?? '✨', active: task.active === false } });
        workspace = 'library'; close(); render();
      } catch (error) { dialog.querySelector('[data-form-error]').textContent = error.message; target.disabled = false; }
    }
  };

  const unsubscribe = store.subscribe(render);
  render();
  return {
    selectedWeek: () => selectedWeek,
    setParentMode(enabled) { parentMode = !!enabled; if (!parentMode) { workspace = null; close(); } render(); },
    openLibrary() { if (!parentMode) return; workspace = 'library'; render(); },
    updateSettings(settings) { if (settings?.timeZone && settings.timeZone !== timeZone) onError(new Error('Семейный timezone должен быть Asia/Almaty')); },
    refreshDate() {
      const current = today(); if (current === lastToday) return;
      const wasCurrent = selectedWeek === calendarKeys(lastToday).weekStart; lastToday = current;
      if (wasCurrent) selectWeek(calendarKeys(current).weekStart); else render();
    },
    destroy() { unsubscribe(); close(); }
  };
}
