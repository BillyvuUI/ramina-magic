// Separate from the V1 currency overlay. Input is a coherent, confirmed listener group.
const groups = ['assignments', 'completionFacts', 'months', 'weeks'];
const empty = () => Object.fromEntries(groups.map(name => [name, new Map()]));
const uncertain=error=>error.details?.retryable===true||['unavailable','deadline-exceeded','internal','unknown'].includes(String(error.code??'').split('/').at(-1));

export function coherentV2(state) {
  const { assignments, completionFacts: facts, months, weeks } = state;
  const monthCounts = new Map(), weekCounts = new Map();
  for (const a of assignments.values()) if (a.status === 'scheduled') {
    const counts = weekCounts.get(a.weekStart) ?? { scheduled: 0, completed: 0 };
    counts.scheduled++; if (facts.get(a.id)?.done) counts.completed++;
    weekCounts.set(a.weekStart, counts);
  }
  for (const f of facts.values()) {
    if (!assignments.has(f.assignmentId)) return false;
    if ((f.monthRevision ?? 0) > (months.get(f.monthKey)?.revision ?? 0)
      || (f.weekRevision ?? 0) > (weeks.get(f.weekStart)?.revision ?? 0)) return false;
    if (f.done) monthCounts.set(f.monthKey, (monthCounts.get(f.monthKey) ?? 0) + 1);
  }
  for (const key of new Set([...months.keys(), ...monthCounts.keys()])) {
    if ((months.get(key)?.completionStars ?? 0) !== (monthCounts.get(key) ?? 0)) return false;
  }
  for (const key of new Set([...weeks.keys(), ...weekCounts.keys()])) {
    const expected = weekCounts.get(key) ?? { scheduled: 0, completed: 0 }, w = weeks.get(key) ?? {};
    if ((w.scheduledCount ?? 0) !== expected.scheduled || (w.completedCount ?? 0) !== expected.completed) return false;
  }
  return true;
}

export function createV2CompletionState({ send, uuid = () => crypto.randomUUID(), onError = () => {}, savePending = () => {} }) {
  let confirmed = empty(), staged = {}, ready = false;
  const pending = new Map(), subscriptions = new Set();
  const notify = () => { savePending([...pending.values()].map(({ promise, ...operation }) => operation)); subscriptions.forEach(fn => fn()); };
  function reconcile() {
    for (const [id, op] of pending) {
      const fact = confirmed.completionFacts.get(id);
      if (fact?.lastOperationId === op.operationId) op.seenRevision = fact.revision;
      if (op.receipt && (fact?.revision ?? 0) >= op.receipt.factRevision
          && (confirmed.months.get(op.receipt.monthKey)?.revision ?? 0) >= op.receipt.monthRevision
          && (confirmed.weeks.get(op.receipt.weekStart)?.revision ?? 0) >= op.receipt.weekRevision) pending.delete(id);
    }
  }
  function visible() {
    const state = Object.fromEntries(groups.map(name => [name, new Map([...confirmed[name]].map(([id, value]) => [id, { ...value }]))]));
    for (const [id, op] of pending) {
      const assignment = state.assignments.get(id), fact = state.completionFacts.get(id);
      if (!assignment || assignment.status !== 'scheduled') continue;
      // A later remote operation wins once our own committed revision has been observed.
      const ownRevision = op.receipt?.factRevision ?? op.seenRevision;
      if (ownRevision && (fact?.revision ?? 0) >= ownRevision) continue;
      const delta = Number(op.done) - Number(fact?.done ?? false);
      state.completionFacts.set(id, { ...(fact ?? assignment), assignmentId: id, done: op.done });
      const month = state.months.get(assignment.monthKey) ?? {};
      state.months.set(assignment.monthKey, { ...month, completionStars: (month.completionStars ?? 0) + delta });
      const week = state.weeks.get(assignment.weekStart) ?? {};
      state.weeks.set(assignment.weekStart, { ...week, completedCount: (week.completedCount ?? 0) + delta });
    }
    return state;
  }
  async function execute(op) {
    const unresolved = op.error === 'uncertain';
    op.error = null;
    try {
      op.receipt = await send({ assignmentId: op.assignmentId, done: op.done, operationId: op.operationId, parent: op.parent });
      reconcile(); notify();
      return op.receipt;
    } catch (error) {
      if (pending.get(op.assignmentId) === op) {
        if (unresolved || uncertain(error)) op.error = 'uncertain';
        else pending.delete(op.assignmentId);
      }
      notify(); onError(error); throw error;
    }
  }
  return {
    stage(name, entries, metadata = {}) {
      if (!groups.includes(name)) throw new Error('Unknown listener group');
      const values = new Map(entries.map(([id, data]) => [id, { ...data, id }]));
      // No V2 hard deletes. Reject an older server delivery in addition to ignoring cache metadata.
      if ([...confirmed[name]].some(([id, old]) => !values.has(id) || (values.get(id).revision ?? 0) < (old.revision ?? 0))) return;
      staged[name] = { values, confirmed: !metadata.fromCache && !metadata.hasPendingWrites };
    },
    flush() {
      if (!groups.every(name => staged[name]?.confirmed)) return false;
      const next = Object.fromEntries(groups.map(name => [name, staged[name].values]));
      if (!coherentV2(next)) return false;
      confirmed = next; ready = true; reconcile(); notify(); return true;
    },
    setCompletion(assignmentId, done, parent = false) {
      if (!ready) return Promise.reject(new Error('Confirmed schedule is not ready'));
      if (pending.has(assignmentId)) return Promise.reject(new Error('Assignment operation is pending'));
      if (typeof done !== 'boolean' || !confirmed.assignments.has(assignmentId)) return Promise.reject(new Error('Invalid completion intent'));
      const op = { assignmentId, done, parent, operationId: uuid(), receipt: null };
      pending.set(assignmentId, op); notify(); // Render before the network request starts.
      return execute(op);
    },
    restore(operations) {
      for (const operation of operations) pending.set(operation.assignmentId, { ...operation, error: 'uncertain' });
      notify();
    },
    retryPending() { return Promise.allSettled([...pending.values()].filter(op => op.error === 'uncertain').map(execute)); },
    visible, confirmed: () => confirmed, pending: id => pending.has(id), ready: () => ready,
    subscribe(callback) { subscriptions.add(callback); return () => subscriptions.delete(callback); }
  };
}

export function v2Progress(state, today, selectedWeek) {
  const todayAssignments = [...state.assignments.values()].filter(a => a.status === 'scheduled' && a.date === today);
  const month = state.months.get(today.slice(0, 7)) ?? {};
  const week = state.weeks.get(selectedWeek) ?? {};
  return {
    todayScheduled: todayAssignments.length,
    todayCompleted: todayAssignments.filter(a => state.completionFacts.get(a.id)?.done).length,
    monthStars: Math.max(0, (month.completionStars ?? 0) + (month.manualStars ?? 0)),
    weekScheduled: week.scheduledCount ?? 0, weekCompleted: week.completedCount ?? 0
  };
}
