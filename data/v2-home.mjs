import { CHESTS, chestState, calendarKeys, addDays, eventIds } from './v2-model.mjs';
export const visibleStars = month => Math.max(0, (month?.completionStars ?? 0) + (month?.manualStars ?? 0));
export function giftCount(n) { return `${n} ${n%100>=11 && n%100<=14 ? 'подарков' : n%10===1 ? 'подарок' : n%10>=2 && n%10<=4 ? 'подарка' : 'подарков'}`; }
export function perfectAvailable(week, today) {
  return !!week && today > addDays(week.id, 6) && week.scheduledCount > 0 && week.completedCount === week.scheduledCount
    && week.currentPerfect === true && week.evaluationStatus === 'evaluated' && week.lastEvaluatedRevision === week.revision
    && week.scheduleCoverage?.state === 'complete' && week.scheduleCoverage.throughDate === addDays(week.id, 6) && !week.worldUnlockId;
}
export function homeState(store, today, rewards) {
  const { monthKey, weekStart } = calendarKeys(today);
  const month = store.read(`months/${monthKey}`) ?? {}, week = store.read(`weeks/${weekStart}`) ?? {};
  const stars = visibleStars(month);
  const assignments = store.list('assignments').filter(a => a.date === today && a.status === 'scheduled');
  const completed = new Set(store.list('completionFacts').filter(f => f.done).map(f => f.assignmentId));
  return { monthKey, stars, week, todayCompleted: assignments.filter(a => completed.has(a.id)).length, todayScheduled: assignments.length,
    chests: CHESTS.map(chest => {
      const key = eventIds.chest(monthKey, chest.threshold);
      const receipt = month.chests?.[chest.threshold] ?? rewards.get(key)?.result ?? null;
      const state = chestState(stars, chest.threshold, receipt, month.settlement ?? null);
      return { ...chest, key, state: rewards.pending(key) ? 'pending' : state.opened ? 'opened' : state.available ? 'available' : 'locked' };
    }),
    next: CHESTS.find(chest => stars < chest.threshold),
    extraEntitlement: month.settlement?.extraEntitlement ?? Math.floor(Math.max(0, stars - 160) / 5),
    extraClaimed: month.extrasClaimedThrough ?? 0,
    perfectWeeks: store.list('weeks').filter(w => perfectAvailable(w, today)).sort((a,b) => a.id.localeCompare(b.id)),
    unlocked: store.list('worldUnlocks'), perfectCount: store.list('weeks').filter(w => w.worldUnlockId).length
  };
}
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
export const monthName = key => new Intl.DateTimeFormat('ru', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${key}-01T00:00:00Z`));
