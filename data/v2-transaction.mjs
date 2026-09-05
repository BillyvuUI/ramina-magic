// Inactive internal foundation; no Firebase initialization, listeners, or UI integration.
// Domain services must supply authorization, activation gates and eligibility checks.
const ROOT = ['apps', 'ramina'];
const PROFILE = 'profile/main';

function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  throw new Error('Intent must contain only JSON values');
}

function documentPath(path) {
  if (typeof path !== 'string' || path.split('/').length % 2 !== 0 ||
      path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Expected a relative document path');
  }
  return path;
}

/**
 * adapter = { db, doc, runTransaction, serverTimestamp } from the modular Firestore SDK.
 * decide(read) is synchronous and must be side-effect-free: SDK retries call it again.
 * All readPaths are document paths relative to apps/ramina. No queries inside this primitive.
 * Returns the saved event on replay; reusing an ID with a different intent is an error.
 */
export async function recordEventOnce(adapter, command, decide) {
  const { id, changesBalance = false } = command;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_:-]{1,240}$/.test(id)) throw new Error('Invalid event ID');
  if (typeof changesBalance !== 'boolean') throw new Error('Invalid balance mode');
  const intentKey = canonical(command.intent);
  const intent = JSON.parse(intentKey);
  const eventPath = `ledger/${id}`;
  const paths = [...new Set((command.readPaths ?? []).map(documentPath))];
  if (paths.some(path => path === eventPath || path === PROFILE)) {
    throw new Error('Own receipt and profile reads are managed by recordEventOnce');
  }
  if (changesBalance) paths.push(PROFILE);
  const ref = path => adapter.doc(adapter.db, ...ROOT, ...path.split('/'));
  return adapter.runTransaction(adapter.db, async tx => {
    const refs = [eventPath, ...paths];
    const snapshots = await Promise.all(refs.map(path => tx.get(ref(path))));
    const saved = snapshots[0];
    if (saved.exists()) {
      const event = saved.data();
      if (event.intentKey !== intentKey || event.changesBalance !== changesBalance) {
        throw new Error('Idempotency key reused with different intent');
      }
      return { applied: false, event };
    }
    const documents = new Map(paths.map((path, index) => [path, snapshots[index + 1].data()]));
    const plan = decide(path => {
      if (!documents.has(path)) throw new Error(`Undeclared read: ${path}`);
      return documents.get(path);
    });
    if (!plan || typeof plan.then === 'function' || typeof plan.type !== 'string' || !plan.type) {
      throw new Error('Expected a synchronous event plan');
    }
    const delta = plan.balanceDelta ?? 0;
    if (!Number.isSafeInteger(delta) || (!changesBalance && delta !== 0)) throw new Error('Invalid balance delta');
    const patches = plan.patches ?? [];
    const written = new Set();
    for (const patch of patches) {
      if (!documents.has(patch.path) || patch.path === PROFILE || patch.path.split('/')[0] === 'ledger' || written.has(patch.path) ||
          !patch.data || typeof patch.data !== 'object' || Array.isArray(patch.data)) {
        throw new Error('Each patch needs a distinct, previously read domain document');
      }
      written.add(patch.path);
    }
    const at = adapter.serverTimestamp();
    const event = {
      schemaVersion: 2, type: plan.type, intent, intentKey, changesBalance,
      balanceDelta: delta, details: plan.details ?? {}, createdAt: at
    };
    if (changesBalance) {
      const profile = documents.get(PROFILE);
      const revision = profile?.balanceRevision ?? 0;
      if (!Number.isSafeInteger(profile?.balance) || profile.balance < 0 ||
          !Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid/missing profile');
      const balance = profile.balance + delta;
      if (!Number.isSafeInteger(balance) || balance < 0 || !Number.isSafeInteger(revision + 1)) {
        throw new Error('Invalid resulting balance');
      }
      Object.assign(event, { balanceBefore: profile.balance, balanceAfter: balance, balanceRevision: revision + 1 });
      tx.set(ref(PROFILE), { balance, balanceRevision: revision + 1, updatedAt: at }, { merge: true });
    }
    for (const patch of patches) tx.set(ref(patch.path), { ...patch.data, updatedAt: at }, { merge: true });
    tx.set(ref(eventPath), event);
    return { applied: true, event };
  });
}
