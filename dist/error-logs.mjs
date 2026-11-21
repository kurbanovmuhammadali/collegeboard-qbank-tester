export const MAX_LOG_LENGTH = 2000;
export const MAX_TYPE_LENGTH = 100;
export const normalizeType = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
export function logText(row) {
  return typeof row.errorLog === 'string' ? row.errorLog.trim() : '';
}
export function logType(row) {
  if (logText(row)) return (typeof row.errorType === 'string' && row.errorType.trim()) || logText(row).slice(0, MAX_TYPE_LENGTH);
  return typeof row.reason === 'string' && row.reason !== 'Not specified' ? row.reason.trim() : '';
}
export function collectLogs(history, byId) {
  return history.flatMap(session => session.rows.filter(row => byId[row.id] && logType(row)).map(row => ({
    key: JSON.stringify([session.id, row.id]), session, row, question: byId[row.id],
    text: logText(row) || logType(row), type: logType(row)
  })));
}
export function groupLogs(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const key = normalizeType(entry.type);
    if (!groups.has(key)) groups.set(key, {key, label: entry.type, entries: []});
    groups.get(key).entries.push(entry);
  }
  return [...groups.values()].sort((a, b) => b.entries.length - a.entries.length || a.label.localeCompare(b.label));
}
export function writeLog(row, text, type = '') {
  text = text.trim(); type = type.trim();
  if (text.length > MAX_LOG_LENGTH || type.length > MAX_TYPE_LENGTH) throw Error('Your error log or type is too long.');
  row.errorLog = text;
  row.errorType = text ? type || text.slice(0, MAX_TYPE_LENGTH) : '';
  row.errorTypeManual = !!text && !!type;
  // Clearing an entry also clears its previous dropdown reason.
  if (!text) row.reason = 'Not specified';
}
export function applyAssignments(entries, assignments) {
  const byKey = new Map(entries.map(entry => [entry.key, entry]));
  let applied = 0;
  for (const assignment of assignments) {
    const entry = byKey.get(assignment.id);
    if (!entry || logText(entry.row) !== entry.text || entry.row.errorTypeManual || typeof assignment.type !== 'string' || !assignment.type.trim() || assignment.type.length > MAX_TYPE_LENGTH) continue;
    entry.row.errorType = assignment.type.trim();
    applied++;
  }
  return applied;
}
