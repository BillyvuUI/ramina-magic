import { createSparkWriter } from './v2-spark-transaction.mjs';
import { fail, integer, canonical } from './v2-spark-security.mjs';
import { calendarKeys, makeAssignment, makeCompletion, addDays } from './v2-model.mjs';
import { libraryFields, ruleFields, validId } from './v2-schedule.mjs';
import { endedWeeks, FAMILY_TIME_ZONE } from './v2-calendar.mjs';
import { weekChange, materializeWeek, evaluateEndedWeek } from './v2-spark-schedule.mjs';

const requireDoc = (data, name) => data ?? fail('not-found', `${name} not found`);
const expectedRevision = (previous, expected) => {
  if ((previous?.revision ?? null) !== expected) fail('aborted', 'Document changed on another device; reload before editing');
};
const bool = value => typeof value === 'boolean' ? value : fail('invalid-argument', 'Explicit boolean required');
const reason = value => typeof value === 'string' && value.trim().length >= 3 && value.length <= 300
  ? value.trim() : fail('invalid-argument', 'A reason (3–300 characters) is required');

export function createSparkCommands(environment, clock) {
  const writer = createSparkWriter(environment, clock);
  const handlers = {};
  function command(name, options, parse, decide) {
    handlers[name] = request => {
      const intent = parse(request.data ?? {});
      return writer(request, name, { ...options, intent }, c => decide(c, intent));
    };
  }
  command('getV2Session', { readOnly: true }, () => ({}), async c => ({
    uid: c.uid, role: c.role, today: c.today, serverTime: c.now.toISOString(), timeZone: FAMILY_TIME_ZONE,
    mode: c.settings.mode, effectiveDate: c.settings.effectiveDate ?? null,
    schemaVersion: 2, policyVersion: 1, minimumWriterVersion: c.settings.minimumWriterVersion
  }));
  command('getOperationReceipt', { readOnly: true }, d => {
    if (typeof d.targetOperationId !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(d.targetOperationId)) fail('invalid-argument', 'Invalid operation ID');
    if (d.semanticId && !/^(chest:\d{4}-\d{2}:(70|120|160)|extra:\d{4}-\d{2}:\d+|finalize:\d{4}-\d{2}|perfect:\d{4}-\d{2}-\d{2})$/.test(d.semanticId)) fail('invalid-argument', 'Invalid semantic receipt');
    return { targetOperationId: d.targetOperationId, semanticId: d.semanticId ?? null };
  }, async (c, d) => {
    const receipt = await c.read(`ledger/${d.semanticId ?? `${c.uid}_${d.targetOperationId}`}`);
    if (!receipt) return { found: false };
    if (receipt.actorRole === 'parent' && !d.semanticId && !['parent','family'].includes(c.role)) fail('permission-denied', 'Parent receipt');
    return { found: true, type: receipt.type, intent: receipt.intent, result: { ...receipt.result, replayed: true } };
  });
  for (const create of [true, false]) command(create ? 'parentCreateLibraryTask' : 'parentUpdateLibraryTask', { parent: true }, d => ({
    id: validId(d.id), input: libraryFields(d.input ?? {}), expectedRevision: create ? null : integer(d.expectedRevision, 'expected revision', 1)
  }), async (c, d) => {
    const previous = await c.read(`libraryTasks/${d.id}`);
    expectedRevision(previous, d.expectedRevision);
    const revision = (previous?.revision ?? 0) + 1;
    if (previous?.active !== false && d.input.active === false) {
      const rules = (await c.list('scheduleRules')).filter(rule => rule.libraryTaskId === d.id && rule.active);
      const control = await c.read('scheduleControl/main');
      for (const rule of rules) {
        const occurrences = await c.list('assignments', 'seriesId', rule.id);
        const materializedThrough = [rule.materializedThrough ?? '', ...occurrences.map(a => a.date)].sort().at(-1) || undefined;
        const fields = ruleFields({ ...rule, active: false }, c.today, { ...rule, materializedThrough });
        const ruleRevision = rule.revision + 1;
        c.set(`scheduleRules/${rule.id}`, { ...fields, revision: ruleRevision });
        c.set(`scheduleRuleVersions/${rule.id}_${ruleRevision}`, { ...fields, ruleId: rule.id, revision: ruleRevision,
          taskSnapshot: { id: d.id, ...d.input }, createdAt: c.at });
      }
      if (rules.length) c.set('scheduleControl/main', { revision: (control?.revision ?? 0) + 1 });
    }
    c.set(`libraryTasks/${d.id}`, { ...d.input, schemaVersion: 2, revision, ...(create ? { createdAt: c.at } : {}) });
    return { id: d.id, revision };
  });
  command('parentSaveShopReward', {parent:true}, d=>{
    const input=d.input??{};
    if(typeof input.title!=='string'||!input.title.trim()||input.title.length>120||typeof input.icon!=='string'||input.icon.length>32)fail('invalid-argument','Invalid reward title/icon');
    return {id:validId(d.id),expectedRevision:d.expectedRevision===null?null:integer(d.expectedRevision,'expected revision',1),input:{title:input.title.trim(),icon:input.icon,price:integer(input.price,'price',1),active:bool(input.active)}};
  },async(c,d)=>{
    const previous=await c.read(`rewards/${d.id}`);expectedRevision(previous,d.expectedRevision);
    const revision=(previous?.revision??0)+1;
    c.set(`rewards/${d.id}`,{...d.input,schemaVersion:2,revision,...(!previous?{createdAt:c.at}:{})});
    return {id:d.id,revision};
  });
  command('parentCreateAssignment', { parent: true }, d => ({ id: validId(d.id), libraryTaskId: validId(d.libraryTaskId), date: (calendarKeys(d.date), d.date) }), async (c, d) => {
    const previous = await c.read(`assignments/${d.id}`);
    if (previous) fail('already-exists', 'Assignment ID already exists');
    const task = requireDoc(await c.read(`libraryTasks/${d.libraryTaskId}`), 'Library task');
    const assignment = makeAssignment({ id: d.id, libraryTask: { ...task, id: d.libraryTaskId }, date: d.date, at: c.at });
    const week = await c.read(`weeks/${assignment.weekStart}`);
    if (c.settings.mode === 'active' && d.date < c.settings.effectiveDate) fail('failed-precondition', 'Assignment predates cutover');
    c.set(`assignments/${d.id}`, { ...assignment, revision: 1 });
    c.set(`weeks/${assignment.weekStart}`, weekChange(week, 1));
    return { id: d.id, weekStart: assignment.weekStart };
  });
  command('parentCancelAssignment', { parent: true }, d => ({ id: validId(d.id) }), async (c, d) => {
    const assignment = requireDoc(await c.read(`assignments/${d.id}`), 'Assignment');
    const week = await c.read(`weeks/${assignment.weekStart}`);
    const fact = await c.read(`completionFacts/${d.id}`);
    if (assignment.status === 'cancelled') return { id: d.id, changed: false };
    c.set(`assignments/${d.id}`, { status: 'cancelled', revision: (assignment.revision ?? 0) + 1, cancelledAt: c.at });
    c.set(`weeks/${assignment.weekStart}`, weekChange(week, -1, fact?.done ? -1 : 0));
    // Cancellation retains the historical fact/month star; only removes week membership.
    return { id: d.id, changed: true };
  });
  command('parentCreateOrUpdateScheduleRule', { parent: true }, d => ({
    id: validId(d.id), input: d.input, expectedRevision: d.expectedRevision ?? null
  }), async (c, d) => {
    if (d.id.length > 100) fail('invalid-argument', 'Rule ID too long');
    const previous = await c.read(`scheduleRules/${d.id}`);
    expectedRevision(previous, d.expectedRevision);
    const occurrences = previous ? await c.list('assignments', 'seriesId', d.id) : [];
    const materializedThrough = [previous?.materializedThrough ?? '', ...occurrences.map(a => a.date)].sort().at(-1) || undefined;
    const fields = ruleFields(d.input, c.today, previous ? { ...previous, materializedThrough } : null);
    const task = requireDoc(await c.read(`libraryTasks/${fields.libraryTaskId}`), 'Library task');
    if (fields.active && task.active === false) fail('failed-precondition', 'Inactive template');
    const coordinator = await c.read('scheduleControl/main');
    const revision = (previous?.revision ?? 0) + 1;
    c.set(`scheduleRules/${d.id}`, { ...fields, schemaVersion: 2, revision });
    c.set(`scheduleRuleVersions/${d.id}_${revision}`, { ...fields, ruleId: d.id, revision,
      taskSnapshot: { id: fields.libraryTaskId, ...libraryFields(task) }, createdAt: c.at });
    c.set('scheduleControl/main', { revision: (coordinator?.revision ?? 0) + 1 });
    return { id: d.id, revision, effectiveFrom: fields.effectiveFrom };
  });
  for (const parent of [false, true]) command(parent ? 'parentSetHistoricalCompletion' : 'childSetTodayCompletion', { parent, active: true }, d => ({
    assignmentId: validId(d.assignmentId), done: bool(d.done)
  }), async (c, d) => {
    const assignment = requireDoc(await c.read(`assignments/${d.assignmentId}`), 'Assignment');
    if (assignment.date < c.settings.effectiveDate) fail('failed-precondition', 'Assignment predates cutover');
    const fact = makeCompletion({ ...assignment, id: d.assignmentId }, {
      done: d.done, actorRole: parent ? 'parent' : 'child', today: c.today, at: c.at
    });
    const old = await c.read(`completionFacts/${d.assignmentId}`);
    const month = await c.read(`months/${fact.monthKey}`) ?? {};
    const week = await c.read(`weeks/${fact.weekStart}`) ?? {};
    const delta = Number(d.done) - Number(old?.done ?? false);
    const monthRevision = integer((month.revision ?? 0) + 1, 'month revision');
    const changedWeek = weekChange(week, 0, delta);
    const factRevision = integer((old?.revision ?? 0) + 1, 'fact revision');
    c.set(`completionFacts/${d.assignmentId}`, { ...fact, revision: factRevision, lastOperationId: c.operationId, monthRevision, weekRevision: changedWeek.revision });
    c.set(`months/${fact.monthKey}`, { completionStars: integer((month.completionStars ?? 0) + delta, 'completion stars'),
      manualStars: month.manualStars ?? 0, revision: monthRevision });
    c.set(`weeks/${fact.weekStart}`, changedWeek);
    return { assignmentId: d.assignmentId, done: d.done, delta, factRevision, monthRevision,
      weekRevision: changedWeek.revision, monthKey: fact.monthKey, weekStart: fact.weekStart };
  });
  command('parentManualStarAdjustment', { parent: true, active: true }, d => ({
    monthKey: (calendarKeys(`${d.monthKey}-01`), d.monthKey), delta: integer(d.delta, 'star delta', -1000, 1000), reason: reason(d.reason)
  }), async (c, d) => {
    if (d.monthKey > c.today.slice(0, 7) || d.monthKey < c.settings.effectiveDate.slice(0, 7)) fail('failed-precondition', 'Month outside V2 period');
    const month = await c.read(`months/${d.monthKey}`) ?? {};
    const manualStars = integer((month.manualStars ?? 0) + d.delta, 'manual stars', -Number.MAX_SAFE_INTEGER);
    c.set(`months/${d.monthKey}`, { manualStars, revision: (month.revision ?? 0) + 1 });
    return { ...d, manualStars };
  });
  command('parentManualBalanceAdjustment', { parent: true, active: true }, d => ({ delta: integer(d.delta, 'balance delta', -1000000, 1000000), reason: reason(d.reason) }), async (c, d) => {
    const profile = requireDoc(await c.read('profile/main'), 'Profile');
    const balance = integer(integer(profile.balance, 'balance') + d.delta, 'resulting balance');
    c.set('profile/main', { balance, balanceRevision: (profile.balanceRevision ?? 0) + 1 });
    return { ...d, balanceBefore: profile.balance, balanceAfter: balance };
  });
  command('childRequestPurchase', { active: true }, d => ({ id: validId(d.id), rewardId: validId(d.rewardId) }), async (c, d) => {
    const existing = await c.read(`purchases/${d.id}`);
    if (existing) fail('already-exists', 'Purchase ID already exists');
    const reward = requireDoc(await c.read(`rewards/${d.rewardId}`), 'Reward');
    if (reward.active === false) fail('failed-precondition', 'Reward is inactive');
    const price = integer(reward.price, 'stored price', 1);
    c.set(`purchases/${d.id}`, { rewardId: d.rewardId, rewardTitle: reward.title, price, status: 'pending', createdAt: c.at });
    return { id: d.id, status: 'pending', price };
  });
  command('parentApprovePurchase', { parent: true, active: true }, d => ({ id: validId(d.id), approve: bool(d.approve) }), async (c, d) => {
    const purchase = requireDoc(await c.read(`purchases/${d.id}`), 'Purchase');
    const profile = requireDoc(await c.read('profile/main'), 'Profile');
    if (purchase.status !== 'pending') return { id: d.id, status: purchase.status, balanceDelta: 0 };
    const price = integer(purchase.price, 'stored purchase price', 1);
    const balance = integer(profile.balance, 'balance');
    if (d.approve && balance < price) fail('failed-precondition', 'Insufficient balance');
    const status = d.approve ? 'approved' : 'rejected';
    if (d.approve) c.set('profile/main', { balance: balance - price, balanceRevision: (profile.balanceRevision ?? 0) + 1 });
    c.set(`purchases/${d.id}`, { status, ...(d.approve ? { approvedAt: c.at } : {}), decidedBy: c.uid });
    return { id: d.id, status, balanceDelta: d.approve ? -price : 0, balanceBefore: balance, balanceAfter: d.approve ? balance - price : balance };
  });
  command('materializeScheduleWeek', {}, d => ({ weekStart: (calendarKeys(d.weekStart), d.weekStart) }), materializeWeekIntent);
  async function materializeWeekIntent(c, d) { return materializeWeek(c, d.weekStart); }
  command('evaluateWeek', { active: true }, d => ({ weekStart: (calendarKeys(d.weekStart), d.weekStart) }), (c, d) => evaluateEndedWeek(c, d.weekStart));
  // The client selects a bounded set of recently ended weeks from the shared family calendar.
  handlers.evaluateRecentlyEndedWeeks = async request => {
    const session = await handlers.getV2Session({ ...request, data: { operationId: `${request.data.operationId}_session` } });
    const weeks = endedWeeks(new Date(session.serverTime)).filter(week => addDays(week,6) >= session.effectiveDate);
    const results = [];
    for (let i = 0; i < weeks.length; i++) {
      const data = { writerVersion: request.data.writerVersion, weekStart: weeks[i], operationId: `${request.data.operationId}_materialize_${i}` };
      await handlers.materializeScheduleWeek({ ...request, data });
      results.push(await handlers.evaluateWeek({ ...request, data: { ...data, operationId: `${request.data.operationId}_evaluate_${i}` } }));
    }
    return { weeks: results };
  };
  return handlers;
}
