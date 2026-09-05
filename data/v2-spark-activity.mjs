// A child-safe, bounded history projection. Private parent reasons remain in ledger.
const titles = {
  childSetTodayCompletion: 'Задание', parentSetHistoricalCompletion: 'Задание уточнено',
  parentManualStarAdjustment: 'Звёзды уточнены', parentManualBalanceAdjustment: 'Баланс уточнён',
  openChest: 'Открыт ящик', claimExtra: 'Дополнительная награда', finalizeMonth: 'Месяц завершён',
  claimPerfectWorldReward: 'Идеальная неделя · новый подарок',
  childRequestPurchase: 'Пожелание отправлено', parentApprovePurchase: 'Решение по пожеланию'
};
export async function activityEvent(name, intent, result, c, pending) {
  if (!titles[name]) return null;
  let title = titles[name];
  if (/Completion$/.test(name)) {
    const assignment = await c.read(`assignments/${result.assignmentId}`);
    title = `${result.done ? 'Выполнено' : 'Отметка снята'}: ${assignment?.taskTitleSnapshot ?? 'задание'}`;
  }
  if (name === 'childRequestPurchase' || name === 'parentApprovePurchase') {
    const purchase = { ...await c.read(`purchases/${result.id}`), ...pending.get(`purchases/${result.id}`) };
    title = `${titles[name]}: ${purchase.rewardTitle ?? 'желание'}`;
  }
  return { type: name, title, eventId: c.receiptId, createdAt: c.at,
    date: c.today, monthKey: result.monthKey ?? intent.monthKey ?? c.today.slice(0, 7),
    balanceDelta: result.balanceDelta ?? (result.balanceAfter !== undefined ? result.balanceAfter - result.balanceBefore : 0),
    starDelta: name === 'parentManualStarAdjustment' ? intent.delta : /Completion$/.test(name) ? result.delta : 0,
    ...Object.fromEntries(['weekStart','elementId','threshold','tranche','status','assignmentId','id','settlement']
      .filter(key => result[key] !== undefined).map(key => [key, result[key]])) };
}
