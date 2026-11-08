import Dialog from './MonthlyDialog';
import { sumAvailableAmounts } from './totals';
import React, { useEffect, useMemo, useState } from 'react';
import type { MonthlyWorkbook, Product } from './workbook';
import { Benchmarks, benchmarkFor, benchmarkIntervalLabel, benchmarkRating } from './benchmarks';
import { linkedOptions } from './filters';
import { benchmarkBucket, BENCHMARK_BUCKETS, BenchmarkBucket, compareReturns, distribution, rankReturns, rateRange, ReturnMetric, ReturnRange, returnRows, returnSummary, RETURN_RANGES, returnDetailRows, ReturnSelection } from './return-analysis';

const detailOverlayProps = { cache: true };
const amount = (value: number | null) => value === null || !Number.isFinite(value) ? '—' : value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = (value: number | null) => value === null || !Number.isFinite(value * 100) ? '—' : (value * 100).toFixed(2) + '%';
const rateClass = (value: number | null) => value !== null && value > 0 ? 'mr-return-positive' : value !== null && value < 0 ? 'mr-return-negative' : '';
const rangeNames: Record<ReturnRange, string> = { high: '收益率 ≥ 20%', middle: '10% ≤ 收益率 < 20%', low: '5% ≤ 收益率 < 10%', base: '0% ≤ 收益率 < 5%', negative: '收益率 < 0%', missing: '无有效收益率' };
const colors: Record<string, string> = { high: '#16845b', middle: '#83b95b', low: '#d5ac38', base: '#6f9dde', negative: '#d14343', below: '#d14343', missing: '#aeb9c8', unconfigured: '#d2d9e2' };
const bandName = (key: BenchmarkBucket) => key === 'unconfigured' ? '未配置业绩基准' : key === 'missing' ? '基准指标待核实' : benchmarkIntervalLabel(key);
interface Props { book: MonthlyWorkbook; products: Product[]; benchmarks: Benchmarks; categoryNames: Record<string, string>; invalidKeys: string[]; onViewProduct: (product: Product) => void; }

export default function ReturnAnalysis({ book, products, benchmarks, categoryNames, invalidKeys, onViewProduct }: Props) {
  const [details, setDetails] = useState<ReturnSelection | null>(null);
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [metric, setMetric] = useState<ReturnMetric>('xirr');
  const [member, setMember] = useState('全部'), [currency, setCurrency] = useState('全部'), [category, setCategory] = useState('');
  const [holdingOnly, setHoldingOnly] = useState(true);
  const [basis, setBasis] = useState<'asset' | 'count'>('asset');
  const [dimension, setDimension] = useState<'category' | 'member' | 'currency'>('category');
  const [direction, setDirection] = useState<'desc' | 'asc'>('desc'), [limit, setLimit] = useState('10');
  const [range, setRange] = useState<ReturnRange | 'all'>('all'), [band, setBand] = useState<BenchmarkBucket | 'all'>('all');
  const rows = useMemo(() => returnRows(book, products, invalidKeys), [book, products, invalidKeys.join('|')]);
  const options = useMemo(() => linkedOptions(products, { member, currency, account: '' }), [products, member, currency]);
  const categories = useMemo(() => [...new Set(products.filter(p => (member === '全部' || p.member === member) && (currency === '全部' || p.currency === currency)).map(p => p.category))], [products, member, currency]);
  useEffect(() => {
    if (member !== '全部' && !options.members.includes(member)) setMember('全部');
    if (currency !== '全部' && !options.currencies.includes(currency)) setCurrency('全部');
    if (category && !categories.includes(category)) setCategory('');
  }, [book, member, currency, category]);
  const selected = useMemo(() => rows.filter(row => (member === '全部' || row.product.member === member) && (currency === '全部' || row.product.currency === currency) && (!category || row.product.category === category) && (!holdingOnly || row.product.balance > 0)), [rows, member, currency, category, holdingOnly]);
  const summary = useMemo(() => returnSummary(selected, metric), [selected, metric]);
  const rates = useMemo(() => distribution(selected, RETURN_RANGES, row => rateRange(row[metric])), [selected, metric]);
  const bands = useMemo(() => distribution(selected, BENCHMARK_BUCKETS, row => benchmarkBucket(row, benchmarks)), [selected, benchmarks]);
  const configured = selected.length - (bands.find(row => row.key === 'unconfigured')?.count || 0);
  const eligible = bands.filter(row => row.key !== 'missing' && row.key !== 'unconfigured').reduce((total, row) => total + row.count, 0);
  const achieved = bands.filter(row => row.key === 'high' || row.key === 'middle').reduce((total, row) => total + row.count, 0);
  const comparisons = useMemo(() => compareReturns(selected, metric, dimension), [selected, metric, dimension]);
  const maxMedian = Math.max(0.01, ...comparisons.map(group => Math.abs(group.median || 0)));
  const ranked = useMemo(() => rankReturns(selected.filter(row => (range === 'all' || rateRange(row[metric]) === range) && (band === 'all' || benchmarkBucket(row, benchmarks) === band)), metric, direction), [selected, range, band, metric, direction, benchmarks]);
  const shown = useMemo(() => limit === 'all' ? ranked : ranked.slice(0, Number(limit)), [ranked, limit]);
  const metricName = metric === 'xirr' ? 'XIRR' : '年化 TWR';
  const share = (count: number, balance: number | null): number | null => !count ? 0 : basis === 'count' ? count / summary.count : summary.balanceRmb !== null && summary.balanceRmb > 0 && balance !== null ? balance / summary.balanceRmb : null;
  const detailRows = useMemo(() => details ? returnDetailRows(selected, benchmarks, details) : [], [selected, benchmarks, details]);
  const detailTitle = details ? details.kind === 'range' ? rangeNames[details.key].replace(/收益率/g, details.metric === 'xirr' ? 'XIRR' : '年化 TWR') : '业绩基准：' + bandName(details.key) : '产品明细';
  const detailAmount = useMemo(() => sumAvailableAmounts(detailRows.map(row => row.balanceRmb)), [detailRows]);
  const detailMissingBalance = useMemo(() => detailRows.some(row => row.balanceRmb === null), [detailRows]);
  function openDetails(next: ReturnSelection) {
    setDetails(current => {
      if (current?.kind === 'range' && next.kind === 'range' && current.key === next.key && current.metric === next.metric) return current;
      if (current?.kind === 'benchmark' && next.kind === 'benchmark' && current.key === next.key) return current;
      return next;
    });
    setDetailsVisible(true);
  }
  const clearRanking = () => { setRange('all'); setBand('all'); };

  const rankingTable = useMemo(() => <div className="mr-table-wrap"><table><thead><tr><th>产品 / 账户</th><th>成员 / 币种</th><th>产品类型</th><th>XIRR</th><th>年化 TWR</th><th>本期余额（原币）</th><th>基准评价</th><th /></tr></thead><tbody>{shown.map(row => {
        const rule = benchmarkFor(benchmarks, row.product.category), bucket = benchmarkBucket(row, benchmarks);
        return <tr key={row.id}><td><strong>{row.product.name}</strong><small>{row.product.account}</small></td><td>{row.product.member}<small>{row.product.currency}</small></td><td>{categoryNames[row.product.category] || row.product.category}</td><td {...benchmarkRating(benchmarks, row.product.category, 'xirr', row.xirr)}>{percent(row.xirr)}</td><td {...benchmarkRating(benchmarks, row.product.category, 'twr', row.twr)}>{percent(row.twr)}</td><td>{row.product.currency} {amount(row.product.balance)}</td><td>{bucket === 'unconfigured' || bucket === 'missing' ? bandName(bucket) : benchmarkIntervalLabel(bucket, rule.metric === 'xirr' ? 'XIRR' : '年化 TWR')}</td><td><button onClick={() => onViewProduct(row.product)}>查看资产</button></td></tr>;
      })}</tbody></table></div>, [shown, benchmarks, categoryNames, onViewProduct]);
  const detailsTable = useMemo(() => <div className="mr-table-wrap"><table><thead><tr><th>产品 / 账户</th><th>成员 / 币种</th><th>当期金额（原币）</th><th>XIRR</th><th>年化 TWR</th>{details?.kind === 'benchmark' && <th>基准指标</th>}<th /></tr></thead><tbody>{detailRows.map(row => {
        const rule = benchmarkFor(benchmarks, row.product.category);
        return <tr key={row.id}><td><strong>{row.product.name}</strong><small>{row.product.account} · {categoryNames[row.product.category] || row.product.category}</small></td><td>{row.product.member}<small>{row.product.currency}</small></td><td>{row.product.currency} {amount(invalidKeys.includes(row.id) ? null : row.product.balance)}</td><td {...benchmarkRating(benchmarks, row.product.category, 'xirr', row.xirr)}>{percent(row.xirr)}</td><td {...benchmarkRating(benchmarks, row.product.category, 'twr', row.twr)}>{percent(row.twr)}</td>{details?.kind === 'benchmark' && <td>{rule.metric === 'none' ? '未配置' : rule.metric === 'xirr' ? 'XIRR' : '年化 TWR'}</td>}<td><button onClick={() => { setDetailsVisible(false); onViewProduct(row.product); }}>查看资产</button></td></tr>;
      })}</tbody></table></div>, [detailRows, benchmarks, categoryNames, details?.kind, invalidKeys.join('|'), onViewProduct]);

  return <section className="mr-panel mr-return-analysis" aria-label="收益率分析">
    <div className="mr-section-heading"><div><h2>收益率分析</h2><p>查看组合中的产品表现、分组差异与业绩基准达标情况。</p></div><div className="mr-return-toggle" role="group" aria-label="收益率分析指标">{(['xirr', 'twr'] as const).map(value => <button key={value} aria-pressed={metric === value} className={metric === value ? 'primary' : ''} onClick={() => { setMetric(value); clearRanking(); }}>{value === 'xirr' ? 'XIRR' : '年化 TWR'}</button>)}</div></div>
    <div className="mr-filters">
      <select aria-label="收益分析成员" value={member} onChange={e => { setMember(e.target.value); clearRanking(); }}><option value="全部">全部成员</option>{options.members.map(value => <option key={value}>{value}</option>)}</select>
      <select aria-label="收益分析币种" value={currency} onChange={e => { setCurrency(e.target.value); clearRanking(); }}><option value="全部">全部币种</option>{options.currencies.map(value => <option key={value}>{value}</option>)}</select>
      <select aria-label="收益分析产品类型" value={category} onChange={e => { setCategory(e.target.value); clearRanking(); }}><option value="">全部产品类型</option>{categories.map(value => <option key={value} value={value}>{categoryNames[value] || value}</option>)}</select>
      <label className="mr-return-checkbox"><input type="checkbox" checked={holdingOnly} onChange={e => { setHoldingOnly(e.target.checked); clearRanking(); }} />仅看持有产品</label>
      <button onClick={() => { setMember('全部'); setCurrency('全部'); setCategory(''); setHoldingOnly(true); clearRanking(); }}>重置筛选</button>
    </div>
    <div className="mr-return-cards" aria-live="polite">
      <article><span>{summary.missingBalance ? '可折算本期余额' : '筛选范围本期余额'}</span><strong>RMB {amount(summary.balanceRmb)}</strong><small>{summary.count} 个产品 · 按当前汇率折算</small></article>
      <article><span>产品 {metricName} 中位数</span><strong className={rateClass(summary.median)}>{percent(summary.median)}</strong><small>有效 {summary.valid} / {summary.count} 个产品</small></article>
      <article><span>正收益产品</span><strong className="mr-return-positive">{summary.positive} 个</strong><small>占有效产品 {summary.valid ? percent(summary.positive / summary.valid) : '—'}</small></article>
      <article><span>负收益产品</span><strong className="mr-return-negative">{summary.negative} 个</strong><small>零收益 {summary.flat} 个 · 无有效收益率 {summary.missing} 个</small></article>
    </div>
    {summary.missingBalance > 0 && <p className="mr-return-note">{summary.missingBalance} 个产品缺少有效余额或汇率，未计入人民币折算金额。</p>}
    <div className="mr-return-chart-toolbar"><span>分布统计口径</span><select aria-label="收益分布统计口径" value={basis} onChange={e => setBasis(e.target.value as 'asset' | 'count')}><option value="asset">本期余额占比（折合 RMB）</option><option value="count">产品数量占比</option></select><small>点击分布条目查看产品明细，并筛选下方排行</small></div>
    <div className="mr-return-charts">
      <article className="mr-return-subpanel"><h3>{metricName} 分布</h3>{rates.map(item => <button key={item.key} className="mr-return-chart-row" aria-pressed={range === item.key} aria-haspopup="dialog" disabled={!item.count} onClick={() => { setRange(item.key); setBand('all'); openDetails({ kind: 'range', key: item.key, metric }); }}>
        <span className="mr-return-chart-heading"><span>{rangeNames[item.key].replace(/收益率/g, metricName)}</span><strong>{percent(share(item.count, item.balanceRmb))}</strong></span><span className="mr-return-chart-track"><span style={{ width: Math.min(100, (share(item.count, item.balanceRmb) || 0) * 100) + '%', background: colors[item.key] }} /></span><small>{item.count} 个产品 · RMB {amount(item.balanceRmb)}</small>
      </button>)}</article>
      <article className="mr-return-subpanel"><h3>业绩基准达标情况</h3><p className="mr-return-note">按各产品类型已配置的指标和阈值评估。</p><div className="mr-return-benchmark-summary">已配置 {configured} 个 · 可评价 {eligible} 个<br /><strong>达到中档及以上 {achieved} 个（{eligible ? percent(achieved / eligible) : '—'}）</strong></div>{bands.map(item => <button key={item.key} className="mr-return-chart-row" aria-pressed={band === item.key} aria-haspopup="dialog" disabled={!item.count} onClick={() => { setBand(item.key); setRange('all'); openDetails({ kind: 'benchmark', key: item.key }); }}>
        <span className="mr-return-chart-heading"><span>{bandName(item.key)}</span><strong>{percent(share(item.count, item.balanceRmb))}</strong></span><span className="mr-return-chart-track"><span style={{ width: Math.min(100, (share(item.count, item.balanceRmb) || 0) * 100) + '%', background: colors[item.key] }} /></span><small>{item.count} 个产品 · RMB {amount(item.balanceRmb)}</small>
      </button>)}</article>
    </div>
    <article className="mr-return-subpanel mr-return-comparison"><div className="mr-section-heading"><h3>分组比较</h3><select aria-label="收益率分组维度" value={dimension} onChange={e => setDimension(e.target.value as typeof dimension)}><option value="category">按产品类型</option><option value="member">按成员</option><option value="currency">按币种</option></select></div>
      <div className="mr-table-wrap"><table><thead><tr><th>{dimension === 'category' ? '产品类型' : dimension === 'member' ? '成员' : '币种'}</th><th>产品收益率中位数</th><th>最低 / 最高</th><th>有效 / 全部产品</th><th>正收益产品占比</th><th>本期余额（RMB）</th></tr></thead><tbody>{comparisons.map(group => <tr key={group.key}><td>{dimension === 'category' ? categoryNames[group.key] || group.key : group.key}</td><td><strong className={rateClass(group.median)}>{percent(group.median)}</strong><div className="mr-return-axis" aria-hidden="true"><span style={{ left: (group.median && group.median < 0 ? 50 - Math.abs(group.median) / maxMedian * 50 : 50) + '%', width: Math.abs(group.median || 0) / maxMedian * 50 + '%', background: group.median !== null && group.median < 0 ? '#d14343' : '#16845b' }} /></div></td><td>{percent(group.min)} / {percent(group.max)}</td><td>{group.valid} / {group.count}</td><td>{group.valid ? percent(group.positive / group.valid) : '—'}</td><td>{amount(group.balanceRmb)}</td></tr>)}</tbody></table></div>{!comparisons.length && <p className="mr-return-note">当前筛选范围没有产品。</p>}
    </article>
    <article className="mr-return-subpanel mr-return-ranking"><div className="mr-section-heading"><h3>产品排行 · {metricName}</h3><div className="mr-toolbar-group"><select aria-label="产品排行筛选" value={range !== 'all' ? 'range:' + range : band !== 'all' ? 'band:' + band : 'all'} onChange={event => { const value = event.target.value; setRange(value.startsWith('range:') ? value.slice(6) as ReturnRange : 'all'); setBand(value.startsWith('band:') ? value.slice(5) as BenchmarkBucket : 'all'); }}><option value="all">全部排行产品</option><optgroup label={metricName + ' 收益率区间'}>{RETURN_RANGES.map(key => <option key={key} value={'range:' + key}>{rangeNames[key].replace(/收益率/g, metricName)}</option>)}</optgroup><optgroup label="业绩基准档位">{BENCHMARK_BUCKETS.map(key => <option key={key} value={'band:' + key}>{bandName(key)}</option>)}</optgroup></select><select aria-label="收益率排行顺序" value={direction} onChange={e => setDirection(e.target.value as 'asc' | 'desc')}><option value="desc">收益率从高到低</option><option value="asc">收益率从低到高</option></select><select aria-label="收益率排行显示数量" value={limit} onChange={e => setLimit(e.target.value)}><option value="10">前 10 项</option><option value="25">前 25 项</option><option value="all">全部产品</option></select></div></div>
      {(range !== 'all' || band !== 'all') && <div className="mr-return-ranking-filter"><span>{range !== 'all' ? rangeNames[range].replace(/收益率/g, metricName) : ''}{range !== 'all' && band !== 'all' ? ' · ' : ''}{band !== 'all' ? '基准：' + bandName(band) : ''} · {ranked.length} 个产品</span><button onClick={clearRanking}>清除排行筛选</button></div>}
      {rankingTable}{!shown.length && <p className="mr-return-note">没有符合当前筛选条件的产品。</p>}
      <p className="mr-return-note">显示 {shown.length} / {ranked.length} 个产品。无有效收益率的产品始终排在末尾。</p>
    </article>
    <Dialog visible={detailsVisible} animation={false} overlayProps={detailOverlayProps} closeMode={['close', 'mask', 'esc']} title={detailTitle} footer={false} onClose={() => setDetailsVisible(false)} className="mr-dialog mr-wide-dialog mr-record-dialog mr-return-details">
      <p>当前范围：{member === '全部' ? '全部成员' : member} · {currency === '全部' ? '全部币种' : currency} · {categoryNames[category] || category || '全部产品类型'} · {holdingOnly ? '仅看持有产品' : '全部产品'}</p>
      <div className="mr-return-detail-summary">{detailRows.length} 个产品 · 可折算当期金额合计 RMB {amount(detailAmount)}</div>
      {detailsTable}
      {!detailRows.length && <p>当前条件下没有产品。</p>}
      {detailMissingBalance && <p className="mr-return-note">缺少有效余额或汇率的产品未计入人民币合计。</p>}
      <div className="mr-actions"><button onClick={() => setDetailsVisible(false)}>关闭</button></div>
    </Dialog>
    <p className="mr-footnote">组内收益率展示有效产品的中位数，各产品等权；账本组合收益见上方估算数据。XIRR 与年化 TWR 沿用各产品原有计算区间，缺失项不按 0 计算。基准达标比例以已配置且可评价的产品数量为分母。</p>
  </section>;
}
