// Confirmed-first rewards. Outbox contains intents/receipts, never an optimistic balance.
export function createRewardState({ send, save = () => {}, restored = [], uuid = () => crypto.randomUUID(), onError = () => {} }) {
  const records = new Map(restored.map(record => [record.key, record])), flights = new Map(), listeners = new Set();
  const changed = () => {
    // A render/storage failure AFTER commit must never turn a confirmed command into a new UUID.
    try { save([...records.values()]); } catch (error) { onError(error); }
    listeners.forEach(fn => { try { fn(); } catch (error) { onError(error); } });
  };
  function run(key, name, data = {}, parent = false) {
    if (flights.has(key)) return flights.get(key);
    let record = records.get(key);
    if (record?.result) return Promise.resolve(record.result);
    const unresolved = !!record && ['pending','uncertain'].includes(record.state) && (record.attempts ?? 0) > 0;
    if (!record || record.state === 'failed') {
      record = { key, name, data, parent, operationId: uuid(), state: 'pending', seen: false };
      records.set(key, record);
    }
    record.state = 'pending'; record.error = null;
    record.attempts = (record.attempts ?? 0) + 1;
    // Persist UUID and intent BEFORE dispatch. Storage failure leaves the server untouched.
    try { save([...records.values()]); }
    catch (error) { record.state = 'storage-error'; return Promise.reject(error); }
    // Defer dispatch so the flight is registered before observers can click again.
    const flight = Promise.resolve().then(() => send(record.name, { ...record.data, operationId: record.operationId }, record.parent))
      .then(result => {
        record.result = result; record.state = 'confirmed';
        if (record.name === 'finalizeMonth' && result.replayed && record.attempts === 1) record.seen = true;
        changed(); return result;
      })
      .catch(error => {
        record.state = unresolved || error.details?.retryable === true || ['unavailable','deadline-exceeded','internal','unknown'].includes(String(error.code??'').split('/').at(-1)) ? 'uncertain' : 'failed';
        record.error = error.message; changed(); throw error;
      }).finally(() => { flights.delete(key); });
    flights.set(key, flight); changed();
    return flight;
  }
  return {
    run,
    pending: key => ['pending','uncertain'].includes(records.get(key)?.state),
    get: key => records.get(key),
    ceremonies: () => [...records.values()].filter(r => r.result && !r.seen && ['openChest','claimExtra','claimPerfectWorldReward','finalizeMonth'].includes(r.name)),
    acknowledge(key) { const record = records.get(key); if (record) { record.seen = true; changed(); } },
    retry: async (includeParent = false) => Promise.allSettled([...records.values()].filter(r => ['pending','uncertain'].includes(r.state) && (!r.parent || includeParent)).map(r => run(r.key, r.name, r.data, r.parent))),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    export: () => [...records.values()]
  };
}

