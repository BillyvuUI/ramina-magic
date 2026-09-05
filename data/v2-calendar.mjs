import { familyDate, calendarKeys, addDays } from './v2-model.mjs';
export const FAMILY_TIME_ZONE = 'Asia/Almaty';
export const familyToday = instant => familyDate(instant, FAMILY_TIME_ZONE);
export function endedWeeks(instant, count = 4) {
  if (!Number.isInteger(count) || count < 1 || count > 4) throw new Error('Catch-up is limited to four weeks');
  const monday = calendarKeys(familyToday(instant)).weekStart;
  return Array.from({ length: count }, (_, i) => addDays(monday, -7 * (i + 1)));
}
