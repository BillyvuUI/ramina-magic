// Shared V2 model. Currency/completion handlers are not connected to the live app.
export const CHESTS = Object.freeze([
  Object.freeze({ threshold: 70, reward: 3 }),
  Object.freeze({ threshold: 120, reward: 7 }),
  Object.freeze({ threshold: 160, reward: 15 })
]);

function integer(value, name, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`Invalid ${name}`);
  return value;
}

function dateValue(date) {
  if (typeof date !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('Invalid calendar date');
  }
  const value = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== date) {
    throw new Error('Invalid calendar date');
  }
  return value;
}

function monthKey(month) {
  dateValue(`${month}-01`);
  return month;
}

function segment(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new Error('Invalid ID segment');
  }
  return value;
}

export function calendarKeys(date) {
  const monday = dateValue(date);
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  return { monthKey: date.slice(0, 7), weekStart: monday.toISOString().slice(0, 10) };
}

export function addDays(date, days) {
  const value = dateValue(date);
  if (!Number.isSafeInteger(days)) throw new Error('Invalid day offset');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function familyDate(instant, timeZone) {
  if (!timeZone) throw new Error('Family timezone is required');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(instant);
  const part = type => parts.find(value => value.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function weekDays(weekStart, today) {
  eventIds.perfect(weekStart);
  dateValue(today);
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index);
    return { date, weekday: index + 1, isToday: date === today, isPast: date < today, isFuture: date > today };
  });
}

export function weekState(weekStart, aggregate, today) {
  eventIds.perfect(weekStart);
  dateValue(today);
  const scheduledCount = integer(aggregate.scheduledCount ?? 0, 'scheduled count');
  const completedCount = integer(aggregate.completedCount ?? 0, 'completed count');
  const revision = integer(aggregate.revision ?? 0, 'week revision');
  if (completedCount > scheduledCount) throw new Error('Invalid week counts');
  const ended = today > addDays(weekStart, 6);
  const allCompleted = scheduledCount > 0 && scheduledCount === completedCount;
  const eligible = ended && allCompleted;
  const evaluated = ended && aggregate.lastEvaluatedRevision === revision;
  const worldUnlockId = aggregate.worldUnlockId ?? null;
  return {
    weekStart, scheduledCount, completedCount, revision, ended, allCompleted, eligible, evaluated,
    perfect: evaluated && eligible, ceremonyAvailable: evaluated && eligible && worldUnlockId === null,
    claimed: worldUnlockId !== null, worldUnlockId
  };
}

export function evaluateWeek(weekStart, aggregate, today) {
  const state = weekState(weekStart, aggregate, today);
  if (!state.ended) throw new Error('Week has not ended');
  return { evaluationStatus: 'evaluated', perfect: state.eligible, lastEvaluatedRevision: state.revision };
}

export const eventIds = Object.freeze({
  chest(month, threshold) {
    if (!CHESTS.some(chest => chest.threshold === threshold)) throw new Error('Invalid chest');
    return `chest:${monthKey(month)}:${threshold}`;
  },
  extra: (month, tranche) => `extra:${monthKey(month)}:${integer(tranche, 'tranche', 1)}`,
  finalize: month => `finalize:${monthKey(month)}`,
  perfect(weekStart) {
    if (calendarKeys(weekStart).weekStart !== weekStart) throw new Error('Week must start Monday');
    return `perfect:${weekStart}`;
  },
  purchase: id => `purchase:${segment(id)}`,
  adjustment: id => `adjustment:${segment(id)}`,
  completion: id => `completion:${segment(id)}`
});

// A new occurrence gets an independent ID; repeating rules must reuse their occurrence ID on retry.
export function makeAssignment({ id, libraryTask, date, at, seriesId = null }) {
  segment(id);
  segment(libraryTask.id);
  if (!libraryTask.title?.trim() || !['sport', 'home'].includes(libraryTask.category)) {
    throw new Error('Task needs a title and an explicit category');
  }
  if (libraryTask.active === false) throw new Error('Task is inactive');
  if (at == null) throw new Error('Timestamp required');
  return {
    id, schemaVersion: 2, libraryTaskId: libraryTask.id, date, ...calendarKeys(date),
    taskTitleSnapshot: libraryTask.title, categorySnapshot: libraryTask.category,
    starValue: 1, status: 'scheduled', seriesId, createdAt: at, updatedAt: at
  };
}

// This is a domain validation, NOT server-side authorization or a trusted clock.
export function makeCompletion(assignment, { done, actorRole, today, at }) {
  dateValue(today);
  if (assignment.schemaVersion !== 2 || assignment.status !== 'scheduled') {
    throw new Error('A scheduled V2 assignment is required');
  }
  if (typeof done !== 'boolean' || !['child', 'parent'].includes(actorRole)) {
    throw new Error('Invalid completion intent');
  }
  if (actorRole === 'child' && assignment.date !== today) throw new Error('Child can edit only today');
  if (actorRole === 'parent' && assignment.date > today) throw new Error('Cannot complete future tasks');
  if (at == null) throw new Error('Timestamp required');
  return {
    schemaVersion: 2, assignmentId: assignment.id, date: assignment.date,
    ...calendarKeys(assignment.date), done, starValue: 1,
    taskTitleSnapshot: assignment.taskTitleSnapshot,
    categorySnapshot: assignment.categorySnapshot, updatedAt: at
  };
}

// Input is the latest document per assignment, not a list of completion events.
export function monthlyProgress(month, facts, starAdjustments = []) {
  monthKey(month);
  const seen = new Set();
  let completionStars = 0;
  for (const fact of facts) {
    if (fact.schemaVersion !== 2 || fact.monthKey !== month) continue;
    if (seen.has(fact.assignmentId)) throw new Error('Duplicate completion fact');
    seen.add(fact.assignmentId);
    if (fact.done) completionStars++;
  }
  let manualStars = 0;
  const adjustmentIds = new Set();
  for (const adjustment of starAdjustments) {
    if (adjustment.monthKey !== month) continue;
    if (!adjustment.id || adjustmentIds.has(adjustment.id)) throw new Error('Duplicate/missing adjustment ID');
    adjustmentIds.add(adjustment.id);
    manualStars += integer(adjustment.starDelta, 'star delta', -Number.MAX_SAFE_INTEGER);
  }
  const rawStars = integer(completionStars + manualStars, 'star total', -Number.MAX_SAFE_INTEGER);
  return { completionStars, manualStars, rawStars, stars: Math.max(0, rawStars) };
}

export function weeklyProgress(weekStart, assignments, facts, { today, worldUnlockId = null, revision = 0, lastEvaluatedRevision = null }) {
  eventIds.perfect(weekStart);
  const completed = new Set(facts.filter(f => f.schemaVersion === 2 && f.done).map(f => f.assignmentId));
  const scheduled = assignments.filter(a => a.weekStart === weekStart && a.status === 'scheduled');
  if (new Set(scheduled.map(a => a.id)).size !== scheduled.length) throw new Error('Duplicate assignment');
  const scheduledCount = scheduled.length;
  const completedCount = scheduled.filter(a => completed.has(a.id)).length;
  return weekState(weekStart, { scheduledCount, completedCount, revision, lastEvaluatedRevision, worldUnlockId }, today);
}

export function monthSettlement(stars, openedThresholds = []) {
  integer(stars, 'stars');
  for (const threshold of openedThresholds) {
    if (!CHESTS.some(chest => chest.threshold === threshold)) throw new Error('Invalid opened chest');
  }
  const nextIndex = CHESTS.findIndex(chest => stars < chest.threshold);
  const next = CHESTS[nextIndex];
  const previousThreshold = nextIndex > 0 ? CHESTS[nextIndex - 1].threshold : 0;
  return {
    policyVersion: 1, starsSnapshot: stars, openedThresholds: [...new Set(openedThresholds)].sort((a, b) => a - b),
    earnedThresholds: CHESTS.filter(chest => stars >= chest.threshold).map(chest => chest.threshold),
    extraEntitlement: Math.floor(Math.max(0, stars - 160) / 5),
    // A historical undo must not pay a partial reward for a chest already paid in full.
    partialAmount: next && !openedThresholds.includes(next.threshold)
      ? Math.round((stars - previousThreshold) * next.reward / (next.threshold - previousThreshold)) : 0
  };
}

export function chestState(stars, threshold, grant = null, settlement = null) {
  integer(stars, 'stars');
  const chest = CHESTS.find(value => value.threshold === threshold);
  if (!chest) throw new Error('Invalid chest');
  const thresholdReached = stars >= threshold;
  const earnedAtClose = settlement?.earnedThresholds.includes(threshold) ?? false;
  return {
    thresholdReached, available: (settlement === null ? thresholdReached : earnedAtClose) && grant === null,
    opened: grant !== null, rewardGranted: grant !== null,
    reward: chest.reward, openedAt: grant?.createdAt ?? null
  };
}

// Capture randomUnit once outside a retryable transaction. Pass the freshly read remaining pool.
export function chooseWorldElement(remainingIds, randomUnit) {
  if (!Number.isFinite(randomUnit) || randomUnit < 0 || randomUnit >= 1) throw new Error('Invalid random sample');
  if (new Set(remainingIds).size !== remainingIds.length) throw new Error('Duplicate world element');
  if (!remainingIds.length) return null;
  return remainingIds[Math.floor(randomUnit * remainingIds.length)];
}
