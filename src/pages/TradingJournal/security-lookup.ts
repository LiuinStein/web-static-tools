import { AssetType, Trade } from './model';

export type IdentityField = 'code' | 'name';
export interface SecurityIdentity { code: string; name: string }
const normalized = (value: string) => value.trim().toUpperCase();
export function findRecordedSecurity(trades: Trade[], type: AssetType, field: IdentityField, input: string): SecurityIdentity | undefined {
  if (!input.trim()) return undefined;
  const match = trades.filter(trade => trade.type === type &&
    normalized(trade[field]) === normalized(input) && trade.code.trim() && trade.name.trim())
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  return match && { code: match.code, name: match.name };
}
export function selectEastmoneySecurity(payload: any, type: AssetType, field: IdentityField, input: string): SecurityIdentity | undefined {
  const market = type;
  const classification = { '港股': 'HK', '美股': 'UsStock', 'A股': 'AStock' }[market];
  if (!classification) return undefined;
  const data = payload?.QuotationCodeTable?.Data;
  if (!Array.isArray(data)) return undefined;
  const matches = data.filter(item => item.Classify === classification && typeof item.Code === 'string' &&
    typeof item.Name === 'string' && item.Code.trim() && item.Name.trim() &&
    normalized(field === 'code' ? item.Code : item.Name) === normalized(input));
  // Do not silently choose among distinct securities with the same name.
  const unique = new Map(matches.map(item => [item.Code, { code: item.Code, name: item.Name }]));
  return unique.size === 1 ? Array.from(unique.values())[0] : undefined;
}
let sequence = 0;
export function queryEastmoney(input: string, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('查询已取消')); return; }
    const callback = `journalSecurity_${Date.now()}_${++sequence}`;
    const script = document.createElement('script');
    const target = window as any;
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      script.remove();
      // A timed-out script may still arrive; ignore its callback safely.
      target[callback] = () => {};
      setTimeout(() => { delete target[callback]; }, 60000);
    };
    const fail = (message: string) => { cleanup(); reject(new Error(message)); };
    const abort = () => fail('查询已取消');
    target[callback] = (payload: unknown) => { cleanup(); resolve(payload); };
    script.onerror = () => fail('东方财富查询暂不可用，请手动填写');
    signal.addEventListener('abort', abort, { once: true });
    const params = new URLSearchParams({ input: input.trim(), type: '14', count: '20',
      token: 'D43BF722C8E33BDC906FB84D85E326E8', cb: callback });
    script.src = `https://searchapi.eastmoney.com/api/suggest/get?${params}`;
    script.referrerPolicy = 'no-referrer';
    timer = setTimeout(() => fail('东方财富查询超时，请手动填写'), 6000);
    document.head.appendChild(script);
  });
}
export async function resolveSecurity(trades: Trade[], type: AssetType, field: IdentityField, input: string,
  signal: AbortSignal, query = queryEastmoney): Promise<{ identity?: SecurityIdentity; source: 'Excel' | '东方财富' }> {
  const recorded = findRecordedSecurity(trades, type, field, input);
  if (recorded) return { identity: recorded, source: 'Excel' };
  if (!['港股', '美股', 'A股'].includes(type) || !input.trim()) return { source: '东方财富' };
  return { identity: selectEastmoneySecurity(await query(input, signal), type, field, input), source: '东方财富' };
}
