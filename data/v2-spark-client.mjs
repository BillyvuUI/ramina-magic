import { addDays, calendarKeys } from './v2-model.mjs';
export function createSparkClient({ dispatcher, today, uuid = () => crypto.randomUUID(), beforeMutation = () => {} }) {
  const raw = (name, data) => dispatcher.call(name, data);
  const call = async (name, data = {}) => {
    if (!['getV2Session','getOperationReceipt'].includes(name)) beforeMutation();
    const request = { operationId: uuid(), ...data, writerVersion: 2 };
    try { return await raw(name, request); }
    catch (error) {
      if (name === 'getOperationReceipt' || !error.details?.retryable) throw error;
      const semanticId = name === 'openChest' ? `chest:${data.monthKey}:${data.threshold}`
        : name === 'claimExtra' ? `extra:${data.monthKey}:${data.tranche}`
        : name === 'finalizeMonth' ? `finalize:${data.monthKey}`
        : name === 'claimPerfectWorldReward' ? `perfect:${data.weekStart}` : null;
      const receipt = await raw('getOperationReceipt', { operationId: uuid(), targetOperationId:request.operationId, semanticId });
      if (!receipt.found) throw error;
      if (receipt.type !== name || Object.entries(data).some(([key,value]) => !['operationId','writerVersion'].includes(key) && JSON.stringify(receipt.intent[key]) !== JSON.stringify(value))) {
        throw Object.assign(Error('Operation intent changed'), {code:'firestore/already-exists'});
      }
      return receipt.result;
    }
  };
  return {
    call,
    session: () => call('getV2Session'),
    completion: ({ parent, ...data }) => call(parent ? 'parentSetHistoricalCompletion' : 'childSetTodayCompletion', data),
    schedule: {
      saveLibrary: data => call(data.expectedRevision === null ? 'parentCreateLibraryTask' : 'parentUpdateLibraryTask', data),
      assign: data => call('parentCreateAssignment', { operationId: data.id, ...data }),
      cancel: data => call('parentCancelAssignment', { operationId: `cancel_${data.id}`, ...data }),
      saveRule: data => call('parentCreateOrUpdateScheduleRule', data),
      async materializeRule() {
        const monday = calendarKeys(today()).weekStart;
        for (let i = 0; i < 3; i++) await call('materializeScheduleWeek', { weekStart: addDays(monday, i * 7) });
      }
    }
  };
}
