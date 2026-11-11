const moneyRound = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
function parseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value ? d : null;
}
function addMonths(date: Date, months: number) {
  const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(date.getUTCDate(), last));
  return first;
}
export function serviceYears(start: string, end: string) {
  const from = parseDate(start), lastDay = parseDate(end);
  if (!from || !lastDay || lastDay < from) return null;
  // End date is the last working day, included in service.
  const until = new Date(lastDay.getTime() + 86400000);
  let years = until.getUTCFullYear() - from.getUTCFullYear();
  if (addMonths(from, years * 12) > until) years--;
  const anniversary = addMonths(from, years * 12);
  const remainder = until.getTime() - anniversary.getTime();
  const n = years + (remainder === 0 ? 0 : until >= addMonths(anniversary, 6) ? 1 : .5);
  return { years, n, days: Math.round((until.getTime() - from.getTime()) / 86400000) };
}
export function severance(start: string, end: string, average: number, extraMonths: number, extraBase: number, localAverage: number | null, minimum: number) {
  const service = serviceYears(start, end);
  if (!service || [average, extraMonths, extraBase, minimum].some(n => !Number.isFinite(n) || n < 0) || (localAverage !== null && (!Number.isFinite(localAverage) || localAverage <= 0))) return null;
  const baseBeforeCap = Math.max(average, minimum);
  const highIncome = localAverage !== null && baseBeforeCap > localAverage * 3;
  const base = highIncome ? localAverage! * 3 : baseBeforeCap;
  const n = highIncome ? Math.min(service.n, 12) : service.n;
  const economic = moneyRound(n * base), extra = moneyRound(extraMonths * extraBase);
  return { ...service, payableN: n, base, highIncome, economic, extra, negotiated: moneyRound(economic + extra), double: moneyRound(2 * economic), verifiedCap: localAverage !== null };
}
