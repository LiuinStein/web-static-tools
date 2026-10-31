import { AssetType, Trade } from './model';

export interface Holding {
  code: string;
  name: string;
  type: AssetType;
  totalCost: number;
  shares?: number;
  averagePrice?: number;
  missingShares: number;
}
interface Total {
  value: number;
  correction: number;
  magnitude: number;
}
function add(total: Total, value: number): void {
  const adjusted = value - total.correction;
  const next = total.value + adjusted;
  total.correction = (next - total.value) - adjusted;
  total.value = next;
  total.magnitude += Math.abs(value);
}
const emptyTotal = (): Total => ({ value: 0, correction: 0, magnitude: 0 });

// Derived from visible trades only. Holdings are never persisted or written to Excel.
export function calculateHoldings(trades: Trade[]): Holding[] {
  const groups = new Map<string, {
    code: string; name: string; type: AssetType; latestDate: string;
    cost: Total; shares: Total; missingShares: number;
  }>();
  trades.forEach((trade) => {
    const code = trade.code.trim().toUpperCase();
    const key = JSON.stringify([trade.type, code]);
    let group = groups.get(key);
    if (!group) {
      group = {
        code, name: trade.name, type: trade.type, latestDate: trade.date,
        cost: emptyTotal(), shares: emptyTotal(), missingShares: 0,
      };
      groups.set(key, group);
    }
    if (trade.date > group.latestDate) {
      group.name = trade.name;
      group.latestDate = trade.date;
    }
    const sign = trade.direction === '买入' ? 1 : -1;
    add(group.cost, sign * trade.amount);
    if (trade.shares === undefined) group.missingShares += 1;
    else add(group.shares, sign * trade.shares);
  });
  const holdings: Holding[] = [];
  groups.forEach((group) => {
    const shares = group.missingShares ? undefined : group.shares.value;
    // Ignore floating point residue when fractional buys and sells exactly offset.
    if (shares !== undefined && Math.abs(shares) <= Number.EPSILON * group.shares.magnitude * 4) return;
    holdings.push({
      code: group.code,
      name: group.name,
      type: group.type,
      totalCost: group.cost.value,
      shares,
      averagePrice: shares === undefined ? undefined : group.cost.value / shares,
      missingShares: group.missingShares,
    });
  });
  return holdings.sort((a, b) => a.code.localeCompare(b.code) || a.type.localeCompare(b.type));
}
