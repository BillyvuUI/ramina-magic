import { addDays, calendarKeys, makeAssignment } from './v2-model.mjs';
import { recurrenceId } from './v2-schedule.mjs';
import { fail, integer } from './v2-spark-security.mjs';

export function weekChange(week = {}, scheduledDelta = 0, completedDelta = 0) {
  const scheduledCount = integer((week.scheduledCount ?? 0) + scheduledDelta, 'scheduled count');
  const completedCount = integer((week.completedCount ?? 0) + completedDelta, 'completed count');
  if (completedCount > scheduledCount) fail('failed-precondition', 'Invalid week aggregate');
  return { scheduledCount, completedCount, revision: integer((week.revision ?? 0) + 1, 'week revision'),
    evaluationStatus: 'stale', currentPerfect: false, perfect: false };
}
export function recurrencePlan(versions, monday) {
  if (calendarKeys(monday).weekStart !== monday) fail('invalid-argument', 'Week must start Monday');
  const ids = [...new Set(versions.map(v => v.ruleId))];
  const plan = [];
  for (let day = 0; day < 7; day++) {
    const date = addDays(monday, day);
    for (const ruleId of ids) {
      const version = versions.filter(v => v.ruleId === ruleId && v.effectiveFrom <= date)
        .sort((a, b) => b.revision - a.revision)[0];
      if (!version || !version.active || date < version.startDate || (version.endDate && date > version.endDate)
          || !version.weekdays.includes(day + 1)) continue;
      plan.push({ id: recurrenceId(ruleId, date), date, version });
    }
  }
  let hash=2166136261;for(const ch of JSON.stringify(plan.map(p=>[p.id,p.version.revision]).sort()))hash=Math.imul(hash^ch.charCodeAt(0),16777619)>>>0;
  const digest=hash.toString(16).padStart(8,'0');
  return { plan, digest };
}
export async function loadWeekPlan(c, monday) {
  // Coordinator read conflicts with concurrent new rule versions (including query phantoms).
  await c.read('scheduleControl/main');
  const versions = await c.list('scheduleRuleVersions');
  const assignments = await c.list('assignments', 'weekStart', monday);
  const week = await c.read(`weeks/${monday}`) ?? {};
  return { ...recurrencePlan(versions, monday), assignments, week };
}
export async function materializeWeek(c, monday) {
  const current = calendarKeys(c.today).weekStart;
  if (monday < addDays(current, -28) || monday > addDays(current, 14)) fail('invalid-argument', 'Materialization window is four past and three current/future weeks');
  const { plan, digest, assignments, week } = await loadWeekPlan(c, monday);
  const rules = await c.list('scheduleRules');
  const through = addDays(monday, 6);
  for (const rule of rules) if (!rule.materializedThrough || rule.materializedThrough < through) {
    c.set(`scheduleRules/${rule.id}`, { materializedThrough: through });
  }
  const existing = new Set(assignments.map(a => a.id));
  const missing = plan.filter(p => !existing.has(p.id));
  for (const p of missing) c.set(`assignments/${p.id}`, {
    ...makeAssignment({ id: p.id, libraryTask: p.version.taskSnapshot, date: p.date, at: c.at, seriesId: p.version.ruleId }),
    ruleRevision: p.version.revision, revision: 1
  });
  const coverage = { state: 'complete', throughDate: addDays(monday, 6), planHash: digest, generatorVersion: 1 };
  if (!missing.length && week.scheduleCoverage?.state === 'complete' && week.scheduleCoverage.planHash === digest
      && week.scheduleCoverage.throughDate === coverage.throughDate) return { weekStart: monday, created: 0, coverage };
  c.set(`weeks/${monday}`, { ...weekChange(week, missing.length), scheduleCoverage: coverage });
  return { weekStart: monday, created: missing.length, coverage };
}
export async function evaluateEndedWeek(c, monday) {
  if (c.today <= addDays(monday, 6)) fail('failed-precondition', 'Week has not ended in Asia/Almaty');
  if (monday < c.settings.effectiveDate) return { status: 'NOT_READY', reason: 'BEFORE_FULL_V2_WEEK', weekStart: monday };
  const { plan, digest, assignments, week } = await loadWeekPlan(c, monday);
  const existing = new Set(assignments.map(a => a.id));
  const coverage = week.scheduleCoverage;
  if (coverage?.state !== 'complete' || coverage.throughDate !== addDays(monday, 6)
      || coverage.planHash !== digest || plan.some(p => !existing.has(p.id))) return { status: 'NOT_READY', weekStart: monday };
  const scheduled = assignments.filter(a => a.status === 'scheduled');
  if (scheduled.length !== (week.scheduledCount ?? 0)) fail('failed-precondition', 'Schedule aggregate requires repair');
  integer(week.completedCount ?? 0, 'completed count', 0, scheduled.length);
  if (week.lastEvaluatedRevision === week.revision) return { status: 'UNCHANGED', weekStart: monday, revision: week.revision, perfect: week.currentPerfect };
  const perfect = scheduled.length > 0 && scheduled.length === (week.completedCount ?? 0);
  c.set(`weeks/${monday}`, { evaluationStatus: 'evaluated', currentPerfect: perfect, perfect,
    lastEvaluatedRevision: week.revision ?? 0, evaluatedAt: c.at });
  // No worldUnlockId, world documents, profile or financial ledger changes.
  return { status: 'EVALUATED', weekStart: monday, revision: week.revision ?? 0, perfect };
}
