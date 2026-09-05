// One persistent, invisible technical identity per device. No user account flow.
export async function ensureDeviceSession({ auth, signInAnonymously, signOut }) {
  await auth.authStateReady();
  if (auth.currentUser && !auth.currentUser.isAnonymous) await signOut(auth);
  if (!auth.currentUser) await signInAnonymously(auth);
  return auth.currentUser;
}
