import { addDays, calendarKeys, weekDays } from './v2-model.mjs';

export { FAMILY_TIME_ZONE as PROPOSED_TIME_ZONE } from './v2-calendar.mjs'; // Kept as a compatibility export for stage 2.
export const HORIZON_WEEKS = 3; // Current calendar week plus two future weeks.
export const CATEGORY_LABELS = Object.freeze({ sport: 'Спорт', home: 'Дом' });

export function validId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('Некорректный ID');
  return id;
}

export function libraryFields(input) {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title || title.length > 120) throw new Error('Название: от 1 до 120 символов');
  if (!Object.hasOwn(CATEGORY_LABELS, input.category)) throw new Error('Выберите Спорт или Дом');
  const icon = typeof input.icon === 'string' ? input.icon.trim() : '';
  if (icon.length > 24) throw new Error('Иконка слишком длинная');
  if (input.active !== undefined && typeof input.active !== 'boolean') throw new Error('Некорректный статус');
  return { title, icon: icon || '✨', category: input.category, active: input.active ?? true };
}

export function migrationPreview(tasks, choices = {}) {
  return tasks.map(task => ({
    legacy: { id: task.id, title: task.title, icon: task.icon ?? '', active: task.active !== false, reward: task.reward ?? 0 },
    proposed: {
      id: task.id, legacyTaskId: task.id, title: task.title, icon: task.icon ?? '✨', active: task.active !== false,
      category: Object.hasOwn(CATEGORY_LABELS, choices[task.id]) ? choices[task.id] : null
    }
  }));
}

export function ruleFields(input, today, previous = null) {
  calendarKeys(today);
  validId(input.libraryTaskId);
  if (!Array.isArray(input.weekdays) || !input.weekdays.length || input.weekdays.some(day => !Number.isInteger(day) || day < 1 || day > 7)) {
    throw new Error('Выберите дни повторения');
  }
  calendarKeys(input.startDate);
  if (input.endDate) calendarKeys(input.endDate);
  if (input.endDate && input.endDate < input.startDate) throw new Error('Конец повторения раньше начала');
  // An edit affects only unmaterialized future dates. Existing occurrences are immutable.
  const minimum = previous ? [addDays(today, 1), addDays(previous.materializedThrough ?? today, 1)].sort().at(-1) : today;
  const effectiveFrom = [input.startDate, minimum].sort().at(-1);
  return {
    libraryTaskId: input.libraryTaskId, weekdays: [...new Set(input.weekdays)].sort(),
    startDate: input.startDate, endDate: input.endDate || null, effectiveFrom,
    active: input.active !== false
  };
}

export function recurrenceId(ruleId, date) {
  validId(ruleId); calendarKeys(date);
  if (ruleId.length > 100) throw new Error('Rule ID too long');
  return `${ruleId}_${date}`;
}

export function materializationDates(rule, today) {
  const monday = calendarKeys(today).weekStart;
  const horizonEnd = addDays(monday, HORIZON_WEEKS * 7 - 1);
  const dates = [];
  for (let i = 0; i < HORIZON_WEEKS * 7; i++) {
    const date = addDays(monday, i);
    if (rule.active === false || date < today || date < rule.effectiveFrom || date < rule.startDate || (rule.endDate && date > rule.endDate)) continue;
    if (rule.weekdays.includes(i % 7 + 1)) dates.push(date);
  }
  return { dates, horizonEnd };
}

export function weeklyGrid(weekStart, today, category, assignments) {
  if (!Object.hasOwn(CATEGORY_LABELS, category)) throw new Error('Unknown category');
  return weekDays(weekStart, today).map(day => ({
    ...day, assignments: assignments.filter(a => a.date === day.date && a.categorySnapshot === category)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id))
  }));
}
