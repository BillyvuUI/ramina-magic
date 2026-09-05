// Full family collections in this stage: they allow cross-collection consistency validation.
// Do not add query limits/pagination here without replacing coherentV2's complete-set contract.
export function subscribeV2Confirmed({ db, collection, onSnapshot, onSnapshotsInSync }, state, onError = () => {}) {
  let closed = false;
  const subscriptions = ['assignments', 'completionFacts', 'months', 'weeks'].map(name =>
    onSnapshot(collection(db, 'apps', 'ramina', name), { includeMetadataChanges: true }, snapshot => {
      if (!closed) state.stage(name, snapshot.docs.map(d => [d.id, d.data()]), snapshot.metadata);
    }, onError));
  subscriptions.push(onSnapshotsInSync(db, () => { if (!closed) state.flush(); }));
  return () => { closed = true; subscriptions.forEach(unsubscribe => unsubscribe()); };
}
