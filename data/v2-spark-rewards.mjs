import { createSparkWriter } from './v2-spark-transaction.mjs';
import { fail, integer } from './v2-spark-security.mjs';
import { loadWeekPlan } from './v2-spark-schedule.mjs';
import { CHESTS, eventIds, monthSettlement, addDays, chooseWorldElement } from './v2-model.mjs';
import { WORLD_CATALOG, WORLD_CATALOG_VERSION, expandedPool } from './v2-world-catalog.mjs';

const stars = month => Math.max(0, integer((month.completionStars ?? 0) + (month.manualStars ?? 0), 'stars', -Number.MAX_SAFE_INTEGER));
function period(c, monthKey, ended = false) {
  eventIds.finalize(monthKey);
  if (c.settings.policyVersion !== 1) fail('failed-precondition', 'Unsupported reward policy');
  if (monthKey < c.settings.effectiveDate.slice(0, 7) || monthKey > c.today.slice(0, 7)
      || (ended && monthKey === c.today.slice(0, 7))) fail('failed-precondition', 'Month outside reward period');
}
async function pay(c, amount) {
  const profile = await c.read('profile/main');
  if (!profile) fail('failed-precondition', 'Missing family profile');
  const balanceBefore = integer(profile.balance, 'balance');
  const balanceAfter = integer(balanceBefore + amount, 'balance');
  const balanceRevision = integer((profile.balanceRevision ?? 0) + (amount ? 1 : 0), 'balance revision');
  if (amount) c.set('profile/main', { balance: balanceAfter, balanceRevision });
  return { balanceBefore, balanceAfter, balanceRevision, balanceDelta: amount };
}
function monthPatch(month, amount) {
  return { revision: integer((month.revision ?? 0) + 1, 'month revision'),
    currencyEarned: integer((month.currencyEarned ?? 0) + amount, 'month currency earned') };
}
async function settlement(c, monthKey, month) {
  const receipt = await c.read(`ledger/${eventIds.finalize(monthKey)}`);
  if (month.finalizationId && !receipt) fail('failed-precondition', 'Missing settlement receipt');
  return receipt?.result.settlement ?? null;
}
export function recentMonths(today, effectiveDate, limit = 3) {
  const [year, month] = today.split('-').map(Number);
  return Array.from({ length: limit }, (_, i) => new Date(Date.UTC(year, month - 2 - i, 1)).toISOString().slice(0, 7))
    .filter(key => key >= effectiveDate.slice(0, 7));
}

// One client-side random sample survives all transaction retries.
export function createSparkRewardCommands(environment, clock, { random = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32,
  catalog = WORLD_CATALOG, catalogVersion = WORLD_CATALOG_VERSION } = {}) {
  const write = createSparkWriter(environment, clock);
  const handlers = {};
  handlers.openChest = request => {
    const { monthKey, threshold } = request.data;
    const receiptId = eventIds.chest(monthKey, threshold);
    return write(request, 'openChest', { active: true, receiptId, intent: { monthKey, threshold } }, async c => {
      period(c, monthKey);
      const month = await c.read(`months/${monthKey}`) ?? {};
      const frozen = await settlement(c, monthKey, month);
      if (!(frozen ? frozen.earnedThresholds.includes(threshold) : stars(month) >= threshold)) fail('failed-precondition', 'Chest is locked');
      if (month.chests?.[threshold]) fail('failed-precondition', 'Missing chest receipt');
      const amount = CHESTS.find(chest => chest.threshold === threshold).reward;
      const paid = await pay(c, amount);
      c.set(`months/${monthKey}`, { ...monthPatch(month, amount), chests: {
        ...(month.chests ?? {}), [threshold]: { eventId: receiptId, amount, createdAt: c.at }
      } });
      return { monthKey, threshold, eventId: receiptId, ...paid };
    });
  };
  handlers.claimExtra = request => {
    const { monthKey, tranche } = request.data;
    const receiptId = eventIds.extra(monthKey, tranche);
    return write(request, 'claimExtra', { active: true, receiptId, intent: { monthKey, tranche } }, async c => {
      period(c, monthKey);
      const month = await c.read(`months/${monthKey}`) ?? {};
      const frozen = await settlement(c, monthKey, month);
      const entitlement = frozen?.extraEntitlement ?? Math.floor(Math.max(0, stars(month) - 160) / 5);
      if (tranche > entitlement || tranche !== (month.extrasClaimedThrough ?? 0) + 1) fail('failed-precondition', 'Extra tranche is not available');
      const paid = await pay(c, 1);
      c.set(`months/${monthKey}`, { ...monthPatch(month, 1), extrasClaimedThrough: tranche });
      return { monthKey, tranche, eventId: receiptId, ...paid };
    });
  };
  handlers.finalizeMonth = request => {
    const { monthKey } = request.data;
    const receiptId = eventIds.finalize(monthKey);
    return write(request, 'finalizeMonth', { active: true, receiptId, intent: { monthKey } }, async c => {
      period(c, monthKey, true);
      const month = await c.read(`months/${monthKey}`) ?? {};
      if (month.finalizationId) fail('failed-precondition', 'Missing settlement receipt');
      const opened = [];
      for (const chest of CHESTS) if (await c.read(`ledger/${eventIds.chest(monthKey, chest.threshold)}`)) opened.push(chest.threshold);
      const frozen = monthSettlement(stars(month), opened);
      const paid = await pay(c, frozen.partialAmount);
      c.set(`months/${monthKey}`, { ...monthPatch(month, frozen.partialAmount), finalizationId: receiptId, settlement: frozen, finalizedAt: c.at });
      return { monthKey, eventId: receiptId, settlement: frozen, ...paid };
    });
  };
  handlers.finalizeRecentMonths = async request => {
    const months = await write(request, 'getRecentMonths', { active: true, readOnly: true, intent: {} }, c => recentMonths(c.today, c.settings.effectiveDate));
    const results = [];
    for (const monthKey of months) results.push(await handlers.finalizeMonth({ ...request, data: { ...request.data, monthKey } }));
    return { months: results };
  };
  handlers.claimPerfectWorldReward = request => {
    const { weekStart } = request.data;
    const receiptId = eventIds.perfect(weekStart), sample = random();
    return write(request, 'claimPerfectWorldReward', { active: true, receiptId, intent: { weekStart } }, async c => {
      if (c.settings.policyVersion !== 1 || c.today <= addDays(weekStart, 6) || weekStart < c.settings.effectiveDate) fail('failed-precondition', 'Week is not eligible');
      const { plan, digest, assignments, week } = await loadWeekPlan(c, weekStart);
      const scheduled = assignments.filter(a => a.status === 'scheduled');
      const existing = new Set(assignments.map(a => a.id));
      if (week.worldUnlockId) fail('failed-precondition', 'Missing world receipt');
      if (week.currentPerfect !== true || week.evaluationStatus !== 'evaluated' || week.lastEvaluatedRevision !== week.revision
          || !scheduled.length || scheduled.length !== week.scheduledCount || week.completedCount !== week.scheduledCount
          || week.scheduleCoverage?.state !== 'complete' || week.scheduleCoverage.throughDate !== addDays(weekStart, 6)
          || week.scheduleCoverage.planHash !== digest || plan.some(p => !existing.has(p.id))) fail('failed-precondition', 'Week requires complete, fresh perfect evaluation');
      const previous = await c.read('worldState/main');
      if (!previous && (await c.list('worldUnlocks')).length) fail('failed-precondition', 'World pool requires repair');
      const pool = expandedPool(previous, catalog, catalogVersion);
      const elementId = chooseWorldElement(pool.remainingIds, sample);
      if (!elementId) fail('resource-exhausted', 'WORLD_EXHAUSTED'); // No receipt: expansion can make this week claimable later.
      if (await c.read(`worldUnlocks/${elementId}`)) fail('failed-precondition', 'World pool requires repair');
      c.set('worldState/main', { ...pool, remainingIds: pool.remainingIds.filter(id => id !== elementId), revision: (previous?.revision ?? 0) + 1 });
      c.set(`worldUnlocks/${elementId}`, { elementId, weekStart, eventId: receiptId, catalogVersion, unlockedAt: c.at });
      c.set(`weeks/${weekStart}`, { worldUnlockId: elementId });
      return { eventId: receiptId, weekStart, elementId, title: catalog.find(e => e.id === elementId).title, catalogVersion, balanceDelta: 0 };
    });
  };
  return handlers;
}
