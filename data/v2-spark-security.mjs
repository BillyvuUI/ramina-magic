import { FAMILY_TIME_ZONE, familyToday } from './v2-calendar.mjs';
import { calendarKeys } from './v2-model.mjs';

export const fail = (code, message, details) => {
  throw Object.assign(new Error(message), {code: `firestore/${code}`, details});
};
export function integer(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail('invalid-argument', `Invalid ${label}`);
  return value;
}
export function authorize(auth) {
  if (!auth?.uid) fail('unauthenticated', 'Firebase anonymous authentication required');
  return 'family';
}
export function settingsGate(settings, now, active, { readOnly = false, writerVersion } = {}) {
  if (settings?.authMode !== 'anonymous-family-spark' || settings?.schemaVersion !== 2 || settings.policyVersion !== 1 || 'rewardPolicyVersion' in settings
      || !Number.isSafeInteger(settings.minimumWriterVersion) || settings.minimumWriterVersion < 2) {
    fail('failed-precondition', 'Invalid canonical V2 settings');
  }
  if (settings?.timeZone !== FAMILY_TIME_ZONE) fail('failed-precondition', 'Family timezone must be Asia/Almaty');
  if (!['draft', 'maintenance', 'active'].includes(settings.mode)) fail('failed-precondition', 'V2 is disabled');
  if (!readOnly && settings.mode === 'maintenance') fail('unavailable', 'MAINTENANCE', { retryable: true });
  if (!readOnly && (!Number.isSafeInteger(writerVersion) || writerVersion < settings.minimumWriterVersion)) {
    fail('failed-precondition', 'UPDATE_REQUIRED', { retryable: true });
  }
  const today = familyToday(now);
  if (active) {
    if (settings.mode !== 'active' || !settings.effectiveDate) fail('failed-precondition', 'V2 cutover is not active');
    calendarKeys(settings.effectiveDate);
    if (today < settings.effectiveDate) fail('failed-precondition', 'V2 effective date has not arrived');
  }
  return today;
}
export const canonical = value => JSON.stringify(value, function(key, item) {
  return item && !Array.isArray(item) && typeof item === 'object'
    ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]])) : item;
});

