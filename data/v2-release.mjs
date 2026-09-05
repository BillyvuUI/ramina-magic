export const WRITER_VERSION = 2;
export function validateReleaseConfig(config, { hostname, protocol }) {
  if (!config || config.environment !== 'production' || config.writerVersion !== WRITER_VERSION) throw Error('Invalid production configuration');
  const f = config.firebase;
  if (!f || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(f.projectId) || f.projectId.startsWith('demo-')
      || typeof f.apiKey !== 'string' || f.apiKey.length < 20 || f.authDomain !== `${f.projectId}.firebaseapp.com`) throw Error('Invalid production Firebase project');
  if (protocol !== 'https:' || ['localhost', '127.0.0.1', '::1'].includes(hostname)) throw Error('Production requires HTTPS on its approved host');
  if (!Array.isArray(config.allowedHosts) || !config.allowedHosts.includes(hostname)) throw Error('Unapproved production host');
  if (Object.keys(config).some(key => /emulator|clock|password|credential|uid/i.test(key))) throw Error('Development option in production config');
  return config;
}
export function assertV2Runtime(session) {
  if (session.schemaVersion !== 2 || session.policyVersion !== 1 || !['active','draft','maintenance'].includes(session.mode)) throw Error('V2 is unavailable');
  if (session.minimumWriterVersion > WRITER_VERSION) throw Object.assign(Error('UPDATE_REQUIRED'), { code: 'firestore/failed-precondition', details: { retryable: true } });
  return session.mode === 'active';
}
export function operationPending(completions, rewards) {
  return completions.length > 0 || rewards.some(row => ['pending','uncertain','storage-error'].includes(row.state));
}
export function friendlyError(error) {
  const message = String(error?.message ?? '');
  if (/Неверный PIN/.test(message)) return 'PIN не подошёл. Попробуйте ещё раз.';
  if (/UPDATE_REQUIRED/.test(message)) return 'Доступна новая версия приложения. Обновите её после проверки сохранённых действий.';
  if (/MAINTENANCE/.test(message)) return 'Приложение обновляется. Сохранённые действия проверим после обновления.';
  if (error?.details?.retryable || /unavailable|deadline-exceeded|internal|unknown/.test(error?.code ?? '')) return 'Проверяем, сохранилось ли действие… Подключитесь к интернету и нажмите «Проверить сохранение».';
  if (/NOT_TODAY|Only today|today.*only|today in/i.test(message)) return 'Это задание можно отметить сегодня.';
  if (/NOT_READY|not ended|coverage|perfect|evaluation/i.test(message)) return 'Проверка недели ещё не готова.';
  if (/INSUFFICIENT_BALANCE|balance.*negative|insufficient/i.test(message)) return 'Пока не хватает Крузейриков для этой покупки.';
  if (/WORLD_EXHAUSTED/.test(message)) return 'Все подарки этого мира уже собраны. Новые появятся позже!';
  if (/permission-denied|unauthenticated/.test(error?.code ?? '')) return 'Не удалось подключить устройство. Попробуйте ещё раз или позовите родителя.';
  if (/aborted|already-exists/.test(error?.code ?? '')) return 'Данные изменились на другом устройстве. Проверьте их ещё раз.';
  return 'Действие пока не получилось. Попробуйте ещё раз или позовите родителя.';
}
export function mergeHistory(rows, incoming) {
  return [...new Map([...rows, ...incoming].map(row => [row.id, row])).values()];
}

