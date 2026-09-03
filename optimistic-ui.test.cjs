// Run: node --experimental-vm-modules --test --test-isolation=none tests/optimistic-ui.test.cjs
// Execute the real app module with controlled Firestore delivery/transaction retries.
// These tests never connect to Firebase. They complement, not replace, device tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const root = 'apps/ramina/';
const profilePath = root + 'profile/main';
const completionPath = root + 'completions/';
const clone = value => value === undefined ? undefined : structuredClone(value);
const metadata = { fromCache: false, hasPendingWrites: false };
const snapshot = (id, value, meta = {}) => ({
  id, exists: () => value !== undefined, data: () => clone(value),
  metadata: { ...metadata, ...meta }
});

function backend(balance = 100) {
  const records = new Map([
    [profilePath, { name: 'Рамина', balance }],
    [root + 'settings/main', { pinHash: 'test' }],
    [root + 'settings/seed', { done: true }],
    [root + 'tasks/a', { title: 'Task A', reward: 10 }],
    [root + 'tasks/b', { title: 'Task B', reward: 15 }],
    [root + 'rewards/ice', { title: 'Ice cream', price: 50 }]
  ]);
  const versions = new Map();
  return {
    records, versions,
    read(ref) { return clone(records.get(ref)); },
    write(ref, value) {
      if (value === undefined) records.delete(ref);
      else records.set(ref, clone(value));
      versions.set(ref, (versions.get(ref) || 0) + 1);
    },
    readSnapshot(ref, meta) {
      if (ref.split('/').length % 2 === 0) {
        return snapshot(ref.split('/').at(-1), this.read(ref), meta);
      }
      return {
        docs: [...records].filter(([key]) => key.startsWith(ref + '/'))
          .map(([key, value]) => snapshot(key.split('/').at(-1), value, meta)),
        metadata: { ...metadata, ...meta }
      };
    }
  };
}

async function client(db) {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      let html = '';
      const classes = new Set();
      elements.set(id, {
        textContent: '', htmlWrites: 0, events: new Map(),
        get innerHTML() { return html; },
        set innerHTML(value) { html = value; this.htmlWrites++; },
        addEventListener(name, callback) { this.events.set(name, callback); },
        classList: {
          add: name => classes.add(name), remove: name => classes.delete(name),
          contains: name => classes.has(name),
          toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); }
        }
      });
    }
    return elements.get(id);
  }
  const listeners = new Map();
  const jobs = [];
  const errors = [];
  let inSync;
  const api = {
    initializeApp: () => ({}), getAuth: () => ({}), getFirestore: () => db,
    signInAnonymously: async () => {},
    doc: (_, ...parts) => parts.join('/'), collection: (_, ...parts) => parts.join('/'),
    query: ref => ref, orderBy: () => null, limit: () => null,
    serverTimestamp: () => ({ seconds: 1, nanoseconds: 0 }),
    getDoc: async ref => db.readSnapshot(ref),
    setDoc: async () => { throw Error('Unexpected non-transactional write'); },
    deleteDoc: async () => { throw Error('Unexpected deleteDoc'); },
    addDoc: async (ref, data) => { db.write(ref + '/request', data); },
    onSnapshot(ref, ...args) {
      const options = args.length === 2 ? args[0] : {};
      const callback = args.at(-1);
      listeners.set(ref, { callback, options });
      return () => listeners.delete(ref);
    },
    onSnapshotsInSync(_, callback) { inSync = callback; return () => {}; },
    runTransaction(_, callback) {
      return new Promise((resolve, reject) => {
        const job = {
          attempts: 0, prepared: null, reject,
          async prepare() {
            this.attempts++;
            const data = new Map([...db.records].map(([key, value]) => [key, clone(value)]));
            const versions = new Map(db.versions);
            const reads = new Map();
            const writes = [];
            const result = await callback({
              async get(ref) {
                assert.equal(writes.length, 0, 'All reads must precede writes');
                reads.set(ref, versions.get(ref) || 0);
                return snapshot(ref.split('/').at(-1), data.get(ref));
              },
              set(ref, value, options) { writes.push({ ref, value, merge: options?.merge }); },
              update(ref, value) { writes.push({ ref, value, merge: true }); },
              delete(ref) { writes.push({ ref }); }
            });
            this.prepared = { reads, writes, result };
          },
          async commit({ deferResolution = false } = {}) {
            try {
              if (!this.prepared) await this.prepare();
              if ([...this.prepared.reads].some(([ref, version]) => (db.versions.get(ref) || 0) !== version)) {
                await this.prepare();
              }
              for (const { ref, value, merge } of this.prepared.writes) {
                db.write(ref, merge ? { ...db.read(ref), ...clone(value) } : value);
              }
              this.resolve = () => resolve(this.prepared.result);
              if (!deferResolution) this.resolve();
            } catch (error) { reject(error); }
          }
        };
        jobs.push(job);
      });
    }
  };
  const context = vm.createContext({
    document: { getElementById: element, querySelectorAll: () => [] },
    window: {}, navigator: {}, TextEncoder,
    console: { error: error => errors.push(error), warn: () => {} },
    setTimeout: () => 1, clearTimeout: () => {}
  });
  const module = new vm.SourceTextModule(appSource + `
    export { toggleTask, completedToday, localDateKey, requestPurchase, approvePurchase, switchTab };
  `, { context });
  await module.link(specifier => {
    const exports = specifier === './firebase-config.js'
      ? { firebaseConfig: { apiKey: 'test-only' } } : api;
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  for (let i = 0; i < 20 && !inSync; i++) await Promise.resolve();
  assert.equal(listeners.size, 6, 'App startup must register its listeners');
  assert.deepEqual(errors, [], 'App must initialize without runtime errors');
  const app = {
    ...module.namespace, element, jobs, errors, listeners,
    key: taskId => module.namespace.localDateKey() + '_' + taskId,
    balance: () => Number(element('balance').textContent),
    emit(ref, snap = db.readSnapshot(root + ref)) { listeners.get(root + ref).callback(snap); },
    sync: () => inSync(),
    publish(meta) {
      for (const [ref, { callback }] of listeners) callback(db.readSnapshot(ref, meta));
      inSync();
    }
  };
  app.publish();
  return app;
}

test('click changes checkmark and balance synchronously; stale snapshots cannot undo it', async () => {
  const db = backend();
  const app = await client(db);
  const save = app.toggleTask('a');
  assert.equal(app.balance(), 110);
  assert.equal(app.completedToday('a'), true);
  assert.match(app.element('tasksList').innerHTML, /disabled aria-busy="true"/);
  assert.equal(db.read(profilePath).balance, 100, 'UI must respond before persistence');
  await app.toggleTask('a');
  assert.equal(app.jobs.length, 1, 'Double click must not start a second transaction');
  app.publish();
  assert.equal(app.balance(), 110);
  assert.equal(app.completedToday('a'), true);
  app.switchTab('shop');
  assert.equal(app.element('shopTab').classList.contains('active'), true);
  await app.jobs[0].commit();
  await save;
  assert.equal(app.balance(), 110, 'Commit before snapshots must retain overlay');
  app.publish();
  assert.equal(app.balance(), 110, 'Acknowledgment must not credit twice');
  assert.doesNotMatch(app.element('tasksList').innerHTML, /aria-busy/);
});

for (const order of ['profile-first', 'completions-first']) {
  test(`paired snapshots avoid a transient double credit (${order})`, async () => {
    const db = backend();
    const app = await client(db);
    const save = app.toggleTask('a');
    await app.jobs[0].commit({ deferResolution: true });
    const refs = order === 'profile-first' ? ['profile/main', 'completions'] : ['completions', 'profile/main'];
    app.emit(refs[0]);
    assert.equal(app.balance(), 110);
    app.emit(refs[1]);
    app.sync();
    assert.equal(app.balance(), 110, 'Snapshots before promise must not double credit');
    app.jobs[0].resolve();
    await save;
    assert.equal(app.balance(), 110);
    assert.doesNotMatch(app.element('tasksList').innerHTML, /aria-busy/);
  });
}

test('undo stays unchecked without a balance jump when committed snapshots arrive before transaction resolution', async () => {
  const db = backend();
  const app = await client(db);
  const completedRef = completionPath + app.key('a');
  db.write(completedRef, { taskId: 'a', reward: 10 });
  app.publish();
  assert.equal(app.completedToday('a'), true);
  assert.equal(app.balance(), 100);

  // Record every balance assignment, including any transient render between assertions.
  const balanceElement = app.element('balance');
  let balanceText = balanceElement.textContent;
  const displayedBalances = [];
  Object.defineProperty(balanceElement, 'textContent', {
    get: () => balanceText,
    set(value) { balanceText = value; displayedBalances.push(Number(value)); }
  });
  function assertUndone() {
    assert.equal(app.completedToday('a'), false);
    assert.match(app.element('tasksList').innerHTML,
      /data-task="a"[^>]*aria-label="Выполнено">\s*<\/button>/);
    assert.equal(app.balance(), 90);
    assert.deepEqual(app.errors, [], 'Undo must not log a caught runtime error');
  }

  let resolved = false;
  const save = app.toggleTask('a').then(() => { resolved = true; });
  assertUndone();
  assert.equal(db.read(profilePath).balance, 100, 'Undo must render before commit');

  await app.jobs[0].commit({ deferResolution: true });
  assert.equal(resolved, false);
  assert.equal(db.read(profilePath).balance, 90);
  assert.equal(db.read(completedRef), undefined);
  const committedVersions = [db.versions.get(profilePath), db.versions.get(completedRef)];
  assertUndone();

  // Exercise the actual listener callbacks while runTransaction is still pending.
  assert.doesNotThrow(() => app.emit('profile/main'));
  assertUndone();
  assert.doesNotThrow(() => app.emit('completions'));
  assertUndone();
  assert.doesNotThrow(() => app.sync());
  assertUndone();
  assert.equal(resolved, false, 'Both committed snapshots must precede promise resolution');
  assert.match(app.element('tasksList').innerHTML, /disabled aria-busy="true"/);

  app.jobs[0].resolve();
  await save;
  assert.equal(resolved, true);
  assertUndone();
  assert.doesNotMatch(app.element('tasksList').innerHTML, /aria-busy/);
  assert.doesNotThrow(() => app.publish());
  assertUndone();

  assert.ok(displayedBalances.length > 0);
  assert.ok(displayedBalances.every(balance => balance === 90),
    `Balance must stay at 90 throughout undo: ${displayedBalances}`);
  assert.equal(app.jobs.length, 1, 'Acknowledgment must not start another transaction');
  assert.equal(db.read(profilePath).balance, 90, 'Reward must be debited exactly once');
  assert.equal(db.read(completedRef), undefined);
  assert.deepEqual([db.versions.get(profilePath), db.versions.get(completedRef)], committedVersions,
    'Snapshot delivery and promise resolution must not write either document again');
});

test('failed operation removes only its overlay, preserving remote updates and another pending task', async () => {
  const db = backend();
  const app = await client(db);
  const first = app.toggleTask('a');
  const second = app.toggleTask('b');
  assert.equal(app.balance(), 125);
  db.write(profilePath, { balance: 60 }); // A purchase approved on another device.
  app.publish();
  assert.equal(app.balance(), 85);
  app.jobs[0].reject(Error('permission-denied'));
  await first;
  assert.equal(app.balance(), 75);
  assert.equal(app.completedToday('a'), false);
  assert.equal(app.completedToday('b'), true);
  assert.match(app.element('toast').textContent, /Не получилось сохранить/);
  await app.jobs[1].commit();
  await second;
  app.publish();
  assert.equal(app.balance(), 75);
  assert.equal(db.read(profilePath).balance, 75);
});

for (const reward of [4, 0]) {
  test(`undo uses the saved completion reward (${reward}), not the edited task reward`, async () => {
    const db = backend();
    const app = await client(db);
    db.write(completionPath + app.key('a'), { taskId: 'a', reward });
    app.publish();
    const save = app.toggleTask('a');
    assert.equal(app.balance(), 100 - reward);
    assert.equal(app.completedToday('a'), false);
    app.publish();
    assert.equal(app.balance(), 100 - reward);
    await app.jobs[0].commit();
    await save;
    app.publish();
    assert.equal(db.read(profilePath).balance, 100 - reward);
    assert.equal(db.read(completionPath + app.key('a')), undefined);
  });
}

test('two devices marking the same task retry without cancelling it or double crediting', async () => {
  const db = backend();
  const first = await client(db);
  const second = await client(db);
  const save1 = first.toggleTask('a');
  const save2 = second.toggleTask('a');
  await Promise.all([first.jobs[0].prepare(), second.jobs[0].prepare()]);
  await first.jobs[0].commit();
  first.publish();
  second.publish();
  assert.equal(second.balance(), 110);
  await second.jobs[0].commit();
  await Promise.all([save1, save2]);
  assert.equal(second.jobs[0].attempts, 2, 'Conflicting read must be retried');
  first.publish();
  second.publish();
  assert.equal(db.read(profilePath).balance, 110);
  assert.equal(first.completedToday('a'), true);
  assert.equal(second.completedToday('a'), true);
  assert.doesNotMatch(second.element('tasksList').innerHTML, /aria-busy/);
});

test('two devices undoing the same task debit only once and never recreate the completion', async () => {
  const db = backend();
  const first = await client(db);
  db.write(completionPath + first.key('a'), { taskId: 'a', reward: 10 });
  first.publish();
  const second = await client(db);
  const saves = [first.toggleTask('a'), second.toggleTask('a')];
  await Promise.all([first.jobs[0].prepare(), second.jobs[0].prepare()]);
  await first.jobs[0].commit();
  await second.jobs[0].commit();
  await Promise.all(saves);
  first.publish();
  second.publish();
  assert.equal(db.read(profilePath).balance, 90);
  assert.equal(first.completedToday('a'), false);
  assert.equal(second.completedToday('a'), false);
});

test('different tasks on two devices preserve both changes after a transaction retry', async () => {
  const db = backend();
  const first = await client(db);
  const second = await client(db);
  const saves = [first.toggleTask('a'), second.toggleTask('b')];
  await Promise.all([first.jobs[0].prepare(), second.jobs[0].prepare()]);
  await second.jobs[0].commit();
  first.publish();
  assert.equal(first.balance(), 125);
  await first.jobs[0].commit();
  await Promise.all(saves);
  first.publish();
  second.publish();
  assert.equal(first.balance(), 125);
  assert.equal(second.balance(), 125);
  const refreshed = await client(db);
  assert.equal(refreshed.balance(), 125);
  assert.equal(refreshed.completedToday('a'), true);
  assert.equal(refreshed.completedToday('b'), true);
});

test('a newer opposite remote action wins even when this client misses its own commit snapshot', async () => {
  const db = backend();
  const first = await client(db);
  const save = first.toggleTask('a');
  await first.jobs[0].commit();
  await save;
  const second = await client(db);
  const undo = second.toggleTask('a');
  await second.jobs[0].commit();
  await undo;
  first.publish();
  assert.equal(first.balance(), 100);
  assert.equal(first.completedToday('a'), false);
  assert.doesNotMatch(first.element('tasksList').innerHTML, /aria-busy/);
});

test('cache and pending-write snapshots cannot acknowledge a committed operation', async () => {
  const db = backend();
  const app = await client(db);
  const save = app.toggleTask('a');
  await app.jobs[0].commit();
  await save;
  for (const meta of [{ fromCache: true }, { hasPendingWrites: true }]) {
    app.publish(meta);
    assert.equal(app.balance(), 110);
    assert.match(app.element('tasksList').innerHTML, /aria-busy/);
  }
  assert.equal(app.listeners.get(profilePath).options.includeMetadataChanges, true);
  assert.equal(app.listeners.get(root + 'completions').options.includeMetadataChanges, true);
  app.publish();
  assert.equal(app.balance(), 110);
  assert.doesNotMatch(app.element('tasksList').innerHTML, /aria-busy/);
});

test('unrelated snapshots preserve task DOM instead of rebuilding it', async () => {
  const db = backend();
  const app = await client(db);
  const writes = app.element('tasksList').htmlWrites;
  db.write(root + 'purchases/p1', { rewardTitle: 'Ice cream', price: 50, status: 'pending' });
  app.publish();
  assert.equal(app.element('tasksList').htmlWrites, writes);
  assert.match(app.element('historyList').innerHTML, /Ice cream/);
});

test('purchase request stays pending; approval reads the real balance transactionally', async () => {
  const db = backend(45);
  const app = await client(db);
  const taskSave = app.toggleTask('a');
  assert.equal(app.balance(), 55);
  await app.requestPurchase('ice');
  await app.element('confirmBuy').onclick();
  assert.equal(db.read(profilePath).balance, 45);
  assert.equal(db.read(root + 'purchases/request').status, 'pending');
  const approval = app.approvePurchase('request', true);
  await app.jobs[1].commit();
  await approval;
  assert.equal(db.read(profilePath).balance, 45);
  assert.equal(db.read(root + 'purchases/request').status, 'pending');
  assert.match(app.element('toast').textContent, /Не хватает/);
  await app.jobs[0].commit();
  await taskSave;
  app.publish();
  const retry = app.approvePurchase('request', true);
  await app.jobs[2].commit();
  await retry;
  app.publish();
  assert.equal(app.balance(), 5);
  assert.equal(db.read(root + 'purchases/request').status, 'approved');
});
