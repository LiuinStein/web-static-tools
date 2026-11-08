import React, { useEffect, useMemo, useState } from 'react';
import Dialog from './MonthlyDialog';
import type { MonthlyWorkbook, Product } from './workbook';
import { isoDate } from './formula';
import { currencyCode } from './amount';
import { linkedOptions } from './filters';
import { sumAvailableAmounts } from './totals';
import { DEFAULT_LIQUIDITY_FILTERS, LiquidityBucket, LiquidityFilters, LIQUIDITY_NAMES, liquidityToday, liquidityBounds, liquidityRows, selectLiquidityRows, liquidityGroups, liquiditySummary, liquidityDetails, ProfitFilter } from './liquidity-analysis';

const overlayProps = { cache: true };
const money = (value: number | null) => value === null || !Number.isFinite(value) ? '—' : value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const profitNames: Record<ProfitFilter, string> = { all: '全部获利状态', profitable: '已获利（总收益 > 0 / 存款）', unprofitable: '未获利（总收益 ≤ 0）', unknown: '收益待核实' };
const colors: Record<LiquidityBucket, string> = { matured: '#3577eb', thisMonth: '#42b5aa', nextThreeMonths: '#73a36b', later: '#9274cf', undated: '#dfac4e', unknown: '#aeb9c8' };
interface Props { book: MonthlyWorkbook; products: Product[]; invalidKeys: string[]; templateSummary: number[]; categoryNames: Record<string, string>; onViewProduct: (product: Product) => void; }
export default function LiquidityAnalysis({ book, products, invalidKeys, templateSummary, categoryNames, onViewProduct }: Props) {
  const [filters, setFilters] = useState<LiquidityFilters>({ ...DEFAULT_LIQUIDITY_FILTERS });
  const [bucket, setBucket] = useState<LiquidityBucket | 'all' | null>(null), [visible, setVisible] = useState(false);
  const [today, setToday] = useState(() => liquidityToday());
  useEffect(() => {
    const refresh = () => setToday(liquidityToday());
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  const bounds = useMemo(() => liquidityBounds(today), [today]);
  const rows = useMemo(() => liquidityRows(book, products, invalidKeys, today), [book, products, invalidKeys.join('|'), today]);
  const options = useMemo(() => linkedOptions(products, { member: filters.member, currency: filters.currency, account: '' }), [products, filters.member, filters.currency]);
  const categories = useMemo(() => [...new Set(products.filter(p => (filters.member === '全部' || p.member === filters.member) && (filters.currency === '全部' || p.currency === filters.currency)).map(p => p.category))], [products, filters.member, filters.currency]);
  const update = (patch: Partial<LiquidityFilters>) => setFilters(current => ({ ...current, ...patch }));
  useEffect(() => {
    if (filters.member !== '全部' && !options.members.includes(filters.member)) update({ member: '全部' });
    if (filters.currency !== '全部' && !options.currencies.includes(filters.currency)) update({ currency: '全部' });
    if (filters.category && !categories.includes(filters.category)) update({ category: '' });
  }, [book, filters.member, filters.currency, filters.category]);
  const selected = useMemo(() => selectLiquidityRows(rows, filters), [rows, filters]);
  const groups = useMemo(() => liquidityGroups(selected), [selected]);
  const summary = useMemo(() => liquiditySummary(selected), [selected]);
  const details = useMemo(() => bucket === null ? [] : liquidityDetails(selected, bucket), [selected, bucket]);
  const detailAmount = useMemo(() => sumAvailableAmounts(details.map(row => row.balanceRmb)), [details]);
  const missingDetailBalance = useMemo(() => details.some(row => row.balanceRmb === null), [details]);
  const open = (value: LiquidityBucket | 'all') => { setBucket(value); setVisible(true); };
  const range = (value: LiquidityBucket) => value === 'undated' ? '无固定 / 未登记到期日，视为随时可支取' : !bounds ? '请核对当前日期' : value === 'matured' ? '截至 ' + isoDate(bounds.asOf) : value === 'thisMonth' ? isoDate(bounds.asOf) + ' 之后至 ' + isoDate(bounds.monthEnd) : value === 'nextThreeMonths' ? isoDate(bounds.monthEnd) + ' 之后至 ' + isoDate(bounds.threeMonthEnd) : value === 'later' ? isoDate(bounds.threeMonthEnd) + ' 之后' : '到期信息无法识别';
  const table = useMemo(() => <div className="mr-table-wrap"><table><thead><tr><th>产品 / 账户</th><th>成员 / 币种</th><th>到期日</th><th>流动性区间</th><th>当前总成本（原币）</th><th>总收益（原币）</th><th>当期金额（原币）</th><th /></tr></thead><tbody>{details.map(row => <tr key={row.id}>
    <td><strong>{row.product.name}</strong><small>{row.product.account} · {categoryNames[row.product.category] || row.product.category}</small></td>
    <td>{row.product.member}<small>{row.product.currency}</small></td>
    <td title={String(row.rawDue ?? '')}>{row.date || (row.bucket === 'undated' ? '随时可支取' : '待核实')}<small>{row.days !== null ? row.days === 0 ? '今天到期' : row.days > 0 ? '距今天 ' + row.days + ' 天' : '已到期 ' + (-row.days) + ' 天' : row.bucket === 'unknown' ? String(row.rawDue ?? '') : ''}</small></td>
    <td>{LIQUIDITY_NAMES[row.bucket]}</td><td>{currencyCode(row.product.currency)} {money(row.cost)}</td><td className={row.gain !== null && row.gain > 0 ? 'mr-profit-positive' : row.gain !== null && row.gain < 0 ? 'mr-profit-negative' : ''}>{money(row.gain)}{row.deposit && <small>存款按已获利</small>}</td>
    <td>{currencyCode(row.product.currency)} {money(invalidKeys.includes(row.id) ? null : row.product.balance)}</td><td><button onClick={() => { setVisible(false); onViewProduct(row.product); }}>查看资产</button></td>
  </tr>)}</tbody></table></div>, [details, categoryNames, invalidKeys.join('|'), onViewProduct]);

  return <section className="mr-panel mr-liquidity-analysis" aria-label="流动性分析">
    <div className="mr-section-heading"><div><h2>流动性分析</h2><p>以当前日期 {bounds ? isoDate(bounds.asOf) : '—'} 为基准，按产品已登记到期日分组。</p></div><button onClick={() => open('all')}>查看产品明细</button></div>
    <div className="mr-filters">
      <select aria-label="流动性获利筛选" value={filters.profit} onChange={e => update({ profit: e.target.value as ProfitFilter })}>{(Object.keys(profitNames) as ProfitFilter[]).map(value => <option key={value} value={value}>{profitNames[value]}</option>)}</select>
      <select aria-label="流动性成员筛选" value={filters.member} onChange={e => update({ member: e.target.value })}><option value="全部">全部成员</option>{options.members.map(value => <option key={value}>{value}</option>)}</select>
      <select aria-label="流动性币种筛选" value={filters.currency} onChange={e => update({ currency: e.target.value })}><option value="全部">全部币种</option>{options.currencies.map(value => <option key={value}>{value}</option>)}</select>
      <select aria-label="流动性产品类型筛选" value={filters.category} onChange={e => update({ category: e.target.value })}><option value="">全部产品类型</option>{categories.map(value => <option key={value} value={value}>{categoryNames[value] || value}</option>)}</select>
      <label className="mr-return-checkbox"><input type="checkbox" checked={filters.holdingOnly} onChange={e => update({ holdingOnly: e.target.checked })} />仅看持有产品</label>
      <button onClick={() => setFilters({ ...DEFAULT_LIQUIDITY_FILTERS })}>重置筛选</button>
    </div>
    <p className="mr-return-note">总收益 = 本期余额 − XIRR 表中的当前总成本（原币，含买卖和分红对成本的影响）。总收益大于 0 为已获利，小于等于 0 为未获利，成本缺失时列为待核实；活期存款和定期存款始终视为已获利。</p>
    {!bounds && <p className="mr-return-note">当前日期无效，已登记日期暂列为期限待核实，请核对设备日期。</p>}
    <div className="mr-return-cards" aria-live="polite">
      <article><span>{summary.missingBalance ? '可折算本期余额' : '筛选范围本期余额'}</span><strong>RMB {money(summary.balanceRmb)}</strong><small>{summary.count} 个产品</small></article>
      <article><span>截至本月底到期</span><strong>RMB {money(summary.throughMonth)}</strong><small>含截至今天已到期产品</small></article>
      <article><span>随后三个月内到期</span><strong>RMB {money(summary.nextThreeMonths)}</strong><small>{bounds ? '截至 ' + isoDate(bounds.threeMonthEnd) : '日期待核实'}</small></article>
      <article><span>随时可支取金额</span><strong>RMB {money(summary.availableNow)}</strong><small>无固定 / 未登记到期日</small></article>
    </div>
    <p className="mr-return-note">当前筛选：已获利 {summary.profitable} 个 · 未获利 {summary.unprofitable} 个 · 收益待核实 {summary.unknownProfit} 个。点击到期区间查看产品明细。</p>
    {summary.missingBalance > 0 && <p className="mr-return-note">{summary.missingBalance} 个产品缺少有效余额或汇率，未计入人民币金额。</p>}
    <div className="mr-liquidity-buckets">{groups.map(group => {
      const share = !group.count ? 0 : summary.balanceRmb !== null && summary.balanceRmb > 0 && group.balanceRmb !== null ? group.balanceRmb / summary.balanceRmb : null;
      return <button key={group.key} className="mr-liquidity-bucket" aria-haspopup="dialog" disabled={!group.count} onClick={() => open(group.key)}>
        <span className="mr-liquidity-bucket-title">{LIQUIDITY_NAMES[group.key]}</span><small>{range(group.key)}</small><strong>RMB {money(group.balanceRmb)}</strong>
        <span className="mr-return-chart-track"><span style={{ width: Math.min(100, (share || 0) * 100) + '%', background: colors[group.key] }} /></span>
        <span>{group.count} 个产品 · 可折算金额占比 {share === null ? '—' : (share * 100).toFixed(2) + '%'}</span>
      </button>;
    })}</div>
    {!selected.length && <p className="mr-return-note">没有符合当前筛选条件的产品。</p>}
    <details className="mr-liquidity-template"><summary>查看模板原有流动性汇总（全账本，不受筛选影响）</summary><div className="mr-liquidity">{['受限资金', '本月底前到期', '随后三个月内到期', '更晚到期', '随时可支取'].map((label, i) => <div key={label}><span>{label}</span><strong>RMB {money(templateSummary[i] ?? null)}</strong></div>)}</div></details>
    <p className="mr-footnote">无固定或未登记到期日的产品统一视为随时可支取；已登记但无法识别的到期信息仍列为期限待核实。</p>
    <Dialog visible={visible} title={bucket && bucket !== 'all' ? LIQUIDITY_NAMES[bucket] + ' · 产品明细' : '流动性产品明细'} closeMode={['close', 'mask', 'esc']} animation={false} overlayProps={overlayProps} footer={false} onClose={() => setVisible(false)} className="mr-dialog mr-wide-dialog mr-record-dialog mr-return-details mr-liquidity-details">
      <p>{profitNames[filters.profit]} · {filters.member === '全部' ? '全部成员' : filters.member} · {filters.currency === '全部' ? '全部币种' : filters.currency} · {categoryNames[filters.category] || filters.category || '全部产品类型'} · {filters.holdingOnly ? '仅看持有产品' : '全部产品'}<br />当前日期：{bounds ? isoDate(bounds.asOf) : '—'}</p>
      <div className="mr-return-detail-summary">{details.length} 个产品 · 可折算当期金额合计 RMB {money(detailAmount)}</div>
      {table}{!details.length && <p>没有符合当前筛选条件的产品。</p>}
      {missingDetailBalance && <p className="mr-return-note">缺少有效余额或汇率的产品未计入人民币合计。</p>}
      <div className="mr-actions"><button onClick={() => setVisible(false)}>关闭</button></div>
    </Dialog>
  </section>;
}
