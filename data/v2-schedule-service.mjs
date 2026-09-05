import { calendarKeys, makeAssignment, evaluateWeek } from './v2-model.mjs';
import { libraryFields, validId, ruleFields, materializationDates, recurrenceId } from './v2-schedule.mjs';
import { recordEventOnce } from './v2-transaction.mjs';

// Stage 2 is deliberately restricted to local preview/test adapters. The browser never supplies a live writer.
export function createScheduleService(adapter, { today }) {
  if (!['preview', 'test'].includes(adapter.environment)) throw new Error('V2 live writes are disabled');
  const ref = path => adapter.doc(adapter.db, 'apps', 'ramina', ...path.split('/'));
  const event = (id, intent, readPaths, decide) => recordEventOnce(adapter, { id, intent, readPaths }, decide);
  const timestamp = () => adapter.serverTimestamp();
  function weekPatch(old, delta, completedDelta = 0) {
    const scheduledCount = (old?.scheduledCount ?? 0) + delta;
    const completedCount = (old?.completedCount ?? 0) + completedDelta;
    if (scheduledCount < 0 || completedCount < 0 || completedCount > scheduledCount) throw new Error('Week aggregate needs repair');
    return { schemaVersion: 2, scheduledCount, completedCount, revision: (old?.revision ?? 0) + 1, perfect: false, evaluationStatus: 'stale' };
  }
  const service = {
    async saveLibrary({ id, input, operationId, expectedRevision = null }) {
      validId(id); validId(operationId);
      const fields = libraryFields(input);
      const path = `libraryTasks/${id}`;
      return event(`library:${operationId}`, { id, ...fields, expectedRevision }, [path], read => {
        const old = read(path);
        if (expectedRevision === null ? !!old : !old || (old.revision ?? 0) !== expectedRevision) throw new Error('Задание изменено на другом устройстве. Откройте его заново.');
        return { type: old ? 'library_task_updated' : 'library_task_created', patches: [{ path, data: {
          schemaVersion: 2, ...fields, revision: (old?.revision ?? 0) + 1, ...(old ? {} : { createdAt: timestamp() })
        } }] };
      });
    },
    async importLegacy({ taskId, category }) {
      validId(taskId);
      const source = `tasks/${taskId}`, target = `libraryTasks/${taskId}`, marker = `migrations/v2-library-${taskId}`;
      // Prepared for a future controlled import. Stage 2 UI only builds migrationPreview().
      return adapter.runTransaction(adapter.db, async tx => {
        const [from, to, migrated] = await Promise.all([source, target, marker].map(path => tx.get(ref(path))));
        if (to.exists()) return { applied: false, task: to.data() };
        if (migrated.exists()) throw new Error('Imported task is missing; review migration');
        if (!from.exists()) throw new Error('Legacy task no longer exists');
        const fields = libraryFields({ ...from.data(), category });
        const at = timestamp();
        const task = { schemaVersion: 2, ...fields, legacyTaskId: taskId, revision: 1, createdAt: from.data().createdAt ?? at, updatedAt: at };
        tx.set(ref(target), task);
        tx.set(ref(marker), { schemaVersion: 2, legacyTaskId: taskId, category, createdAt: at });
        return { applied: true, task };
      });
    },
    async assign({ id, libraryTaskId, date }) {
      validId(id); validId(libraryTaskId);
      const { weekStart } = calendarKeys(date);
      const path = `assignments/${id}`, library = `libraryTasks/${libraryTaskId}`, week = `weeks/${weekStart}`;
      return event(`assignment:${id}`, { id, libraryTaskId, date }, [path, library, week], read => {
        if (read(path)) throw new Error('Assignment ID already exists');
        const task = read(library);
        if (!task) throw new Error('Задание не найдено');
        const assignment = makeAssignment({ id, libraryTask: { ...task, id: libraryTaskId }, date, at: timestamp() });
        return { type: 'assignment_created', patches: [
          { path, data: assignment }, { path: week, data: weekPatch(read(week), 1) }
        ] };
      });
    },
    async cancel({ id, weekStart }) {
      validId(id); calendarKeys(weekStart);
      const path = `assignments/${id}`, week = `weeks/${weekStart}`, completion = `completionFacts/${id}`;
      return event(`cancel:${id}`, { id, weekStart }, [path, week, completion], read => {
        const assignment = read(path);
        if (!assignment || assignment.weekStart !== weekStart) throw new Error('Assignment no longer matches this week');
        if (assignment.status === 'cancelled') return { type: 'assignment_cancelled', patches: [] };
        return { type: 'assignment_cancelled', patches: [
          { path, data: { status: 'cancelled', cancelledAt: timestamp() } },
          { path: week, data: weekPatch(read(week), -1, read(completion)?.done ? -1 : 0) }
        ] };
      });
    },
    async saveRule({ id, input, operationId, expectedRevision = null }) {
      validId(id); validId(operationId); validId(input.libraryTaskId);
      if (id.length > 100) throw new Error('Rule ID too long');
      const path = `scheduleRules/${id}`, library = `libraryTasks/${input.libraryTaskId}`;
      return event(`rule:${operationId}`, { id, input, expectedRevision }, [path, library], read => {
        const old = read(path);
        if (expectedRevision === null ? !!old : !old || old.revision !== expectedRevision) throw new Error('Повторение изменено. Откройте его заново.');
        if (!read(library) || (input.active !== false && read(library).active === false)) throw new Error('Выберите активное задание');
        const fields = ruleFields(input, today(), old);
        return { type: old ? 'schedule_rule_updated' : 'schedule_rule_created', details: { effectiveFrom: fields.effectiveFrom }, patches: [{ path, data: {
          schemaVersion: 2, ...fields, revision: (old?.revision ?? 0) + 1, ...(old ? {} : { createdAt: timestamp() })
        } }] };
      });
    },
    async materializeRule(id) {
      validId(id);
      return adapter.runTransaction(adapter.db, async tx => {
        const ruleRef = ref(`scheduleRules/${id}`);
        const ruleSnap = await tx.get(ruleRef);
        if (!ruleSnap.exists() || !ruleSnap.data().active) return { created: 0 };
        const rule = ruleSnap.data();
        const taskSnap = await tx.get(ref(`libraryTasks/${rule.libraryTaskId}`));
        if (!taskSnap.exists() || taskSnap.data().active === false) return { created: 0 };
        const { dates, horizonEnd } = materializationDates(rule, today());
        const weeks = [...new Set(dates.map(date => calendarKeys(date).weekStart))];
        const paths = [...dates.map(date => `assignments/${recurrenceId(id, date)}`), ...weeks.map(week => `weeks/${week}`)];
        const snapshots = await Promise.all(paths.map(path => tx.get(ref(path))));
        const existing = new Map(paths.map((path, i) => [path, snapshots[i].data()]));
        const additions = new Map();
        const at = timestamp();
        let created = 0;
        for (const date of dates) {
          const assignmentId = recurrenceId(id, date), path = `assignments/${assignmentId}`;
          if (existing.get(path)) continue; // Includes cancelled occurrences: never resurrect them.
          const assignment = makeAssignment({ id: assignmentId, libraryTask: { ...taskSnap.data(), id: rule.libraryTaskId }, date, at, seriesId: id });
          tx.set(ref(path), { ...assignment, ruleRevision: rule.revision });
          additions.set(assignment.weekStart, (additions.get(assignment.weekStart) ?? 0) + 1);
          created++;
        }
        for (const [week, count] of additions) tx.set(ref(`weeks/${week}`), {
          ...weekPatch(existing.get(`weeks/${week}`), count), updatedAt: at
        }, { merge: true });
        if (!rule.materializedThrough || horizonEnd > rule.materializedThrough || created) {
          tx.set(ruleRef, { materializedThrough: [horizonEnd, rule.materializedThrough ?? ''].sort().at(-1), updatedAt: at }, { merge: true });
        }
        return { created, horizonEnd };
      });
    },
    async finalizePreviousWeek(weekStart) {
      if (calendarKeys(weekStart).weekStart !== weekStart) throw new Error('Expected Monday');
      return adapter.runTransaction(adapter.db, async tx => {
        const path = `weeks/${weekStart}`;
        const snapshot = await tx.get(ref(path));
        const week = snapshot.data() ?? { scheduledCount: 0, completedCount: 0, revision: 0 };
        const evaluation = evaluateWeek(weekStart, week, today());
        if (week.lastEvaluatedRevision === evaluation.lastEvaluatedRevision) return { applied: false, ...evaluation };
        const eventPath = `ledger/week-evaluated:${weekStart}:${evaluation.lastEvaluatedRevision}`;
        const receipt = await tx.get(ref(eventPath));
        if (receipt.exists()) throw new Error('Week evaluation needs repair');
        const at = timestamp();
        tx.set(ref(path), { schemaVersion: 2, ...evaluation, lastEvaluatedAt: at, ...(week.firstEvaluatedAt ? {} : { firstEvaluatedAt: at }), updatedAt: at }, { merge: true });
        tx.set(ref(eventPath), { schemaVersion: 2, type: 'week_evaluated', weekStart, ...evaluation, createdAt: at });
        return { applied: true, ...evaluation };
      });
    }
  };
  return service;
}
