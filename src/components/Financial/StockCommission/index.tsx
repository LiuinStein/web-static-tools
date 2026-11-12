import React, { useMemo, useState } from 'react';
import { Broker, Instrument, Market, getPlan, plans, reviewedOn } from './rates';
import { TradeInput, breakEvenPrice, calculateRoundTrip, parseTradeNumber, compareStockBrokers } from './model';
import './style.css';
import FeeComparisonTable, { ComparisonRow } from '../CalculatorLayout/FeeComparisonTable';

export default function StockCommission({ fixedMarket }: { fixedMarket?: Market }) {
  const [selectedMarket, setMarket] = useState<Market>('HK');
  const market = fixedMarket || selectedMarket;
  const [brokers, setBrokers] = useState<Record<Market, Broker>>({ HK: 'futu', US: 'futu' });
  const broker = brokers[market], plan = getPlan(market, broker);
  const [buyText, setBuyText] = useState('100');
  const [sellText, setSellText] = useState('');
  const [sharesText, setSharesText] = useState('100');
  const [instrument, setInstrument] = useState<Instrument>('stock');
  const [commissionFree, setCommissionFree] = useState(false);
  const [oddLotSell, setOddLotSell] = useState(false);
  const currency = market === 'HK' ? 'HKD' : 'USD';
  const buyPrice = parseTradeNumber(buyText), shares = parseTradeNumber(sharesText, true);
  const sellPrice = sellText.trim() === '' ? buyPrice : parseTradeNumber(sellText);
  const calculation = useMemo(() => {
    if (buyPrice === null || sellPrice === null || shares === null) return null;
    const input: TradeInput = { market, broker, price: buyPrice, shares, instrument, commissionFree: broker === 'futu' && commissionFree, oddLotSell: market === 'HK' && broker === 'za' && oddLotSell };
    try { return { result: calculateRoundTrip(input, sellPrice), breakEven: breakEvenPrice(input), error: '' }; }
    catch (error) { return { result: null, breakEven: null, error: error instanceof Error ? error.message : '输入无效，请检查股价与股数' }; }
  }, [market, broker, buyPrice, sellPrice, shares, instrument, commissionFree, oddLotSell]);
  const error = buyPrice === null ? '请输入大于 0 的有效买入价（不超过 10 亿）。' : sellPrice === null ? '请输入有效卖出价，或留空按买入价估算。' : shares === null ? '股数须为 1 至 10 亿的整数，不足 1 股的订单不适用此费率。' : calculation?.error || '';
  const result = calculation?.result;
  const amount = (value: number | undefined) => value === undefined ? '—' : value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const price = (value: number | null | undefined) => value == null ? '—' : value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  const comparisons = useMemo(() => compareStockBrokers(market, broker, buyPrice !== null && shares !== null && sellPrice !== null ? { market, price: buyPrice, shares, instrument, commissionFree, oddLotSell } : null, sellPrice ?? undefined), [market, broker, buyPrice, shares, sellPrice, instrument, commissionFree, oddLotSell]);
  const feeIds = Array.from(new Set(comparisons.flatMap(item => item.plan.rules.map(rule => rule.id))));
  const comparisonRows: ComparisonRow[] = feeIds.map(feeId => ({
    id: feeId, label: comparisons.flatMap(item => item.plan.rules).find(rule => rule.id === feeId)!.label + '（买卖合计）',
    description: plan.rules.find(rule => rule.id === feeId) ? `当前券商：${plan.rules.find(rule => rule.id === feeId)!.description}` : '当前券商未单列此项，其他券商可能单独收费',
    cells: comparisons.map(item => {
      if (!item.result) return { value: '—' };
      const buy = item.result.buy.lines.find(line => line.id === feeId), sell = item.result.sell.lines.find(line => line.id === feeId);
      return { value: amount(Number(((buy?.amount || 0) + (sell?.amount || 0)).toFixed(2))), detail: buy ? `买入 ${amount(buy.amount)} / 卖出 ${amount(sell?.amount)}；${buy.description}` : '未单列收费，可能已包含在其他费项中' };
    }),
  }));
  comparisonRows.push(...[
    { id: 'buy-total', description: '买入时各项费用之和', label: '买入费用合计', cells: comparisons.map(item => ({ value: amount(item.result?.buy.total) })) },
    { id: 'sell-total', description: '卖出时各项费用之和', label: '卖出费用合计', cells: comparisons.map(item => ({ value: amount(item.result?.sell.total) })) },
    { id: 'broker-subtotal', description: '买卖佣金、平台费等券商费用合计', label: '券商费用小计（买卖合计）', cells: comparisons.map(item => ({ value: item.result ? amount(Number((item.result.buy.brokerFees + item.result.sell.brokerFees).toFixed(2))) : '—' })) },
    { id: 'third-party-subtotal', description: '买卖税费及交易所等代收费合计', label: '税费 / 代收费小计（买卖合计）', cells: comparisons.map(item => ({ value: item.result ? amount(Number((item.result.buy.thirdPartyFees + item.result.sell.thirdPartyFees).toFixed(2))) : '—' })) },
    { id: 'total', description: '买入费用 + 卖出费用', label: '买卖总费用', emphasis: true, cells: comparisons.map(item => ({ value: amount(item.result?.total) })) },
  ]);
  const id = `stock-${fixedMarket || 'all'}`;
  const selectOnFocus = (event: React.FocusEvent<HTMLInputElement>) => event.currentTarget.select();
  return <section className="tool-page financial-calculator stock-fees" aria-label={`${fixedMarket === 'HK' ? '港股' : fixedMarket === 'US' ? '美股' : '港美股'}交易费用计算器`}>
    <div className="sf-heading"><div><span className="sf-eyebrow">TRADING COST</span><h2>每笔交易，算清成本。</h2><p>选择市场与券商，查看买卖费用和回本参考价。</p></div><span className="sf-currency">{currency} · {market === 'HK' ? '港元' : '美元'}</span></div>
    <div className="sf-workspace">
      <div className="sf-input-panel">
        {!fixedMarket && <div className="sf-markets" role="group" aria-label="交易市场">{(['HK', 'US'] as Market[]).map(value => <button key={value} type="button" aria-pressed={market === value} onClick={() => setMarket(value)}>{value === 'HK' ? '港股' : '美股'}<small>{value}</small></button>)}</div>}
        <label className="sf-field"><span>券商</span><select value={broker} onChange={event => setBrokers({ ...brokers, [market]: event.target.value as Broker })}>{plans[market].map(item => <option key={item.broker} value={item.broker}>{item.name}</option>)}</select></label>
        <p className="sf-plan">{plan.plan}</p>
        <div className="sf-input-grid">
          <label className="sf-field" htmlFor={`${id}-buy`}><span>买入股价 <small>{currency}</small></span><input id={`${id}-buy`} type="text" inputMode="decimal" autoComplete="off" value={buyText} onChange={event => setBuyText(event.target.value)} onFocus={selectOnFocus} aria-invalid={buyPrice === null} aria-describedby={error ? `${id}-error` : undefined} /></label>
          <label className="sf-field" htmlFor={`${id}-sell`}><span>卖出股价 <small>{currency}</small></span><input id={`${id}-sell`} type="text" inputMode="decimal" autoComplete="off" value={sellText} placeholder="留空按买入价" onChange={event => setSellText(event.target.value)} onFocus={selectOnFocus} aria-invalid={sellPrice === null} aria-describedby={error ? `${id}-error` : undefined} /></label>
          <label className="sf-field" htmlFor={`${id}-shares`}><span>交易股数 <small>股</small></span><input id={`${id}-shares`} type="text" inputMode="numeric" autoComplete="off" value={sharesText} onChange={event => setSharesText(event.target.value)} onFocus={selectOnFocus} aria-invalid={shares === null} aria-describedby={error ? `${id}-error` : undefined} /></label>
          <label className="sf-field"><span>证券类型</span><select value={instrument} onChange={event => setInstrument(event.target.value as Instrument)}><option value="stock">普通股票</option><option value="etf">ETF</option></select></label>
        </div>
        {broker === 'futu' && <label className="sf-check"><input type="checkbox" checked={commissionFree} onChange={event => setCommissionFree(event.target.checked)} />免佣优惠 <small>仅减免佣金</small></label>}
        {broker === 'za' && market === 'HK' && <label className="sf-check"><input type="checkbox" checked={oddLotSell} onChange={event => setOddLotSell(event.target.checked)} />卖出为不足一手的碎股订单 <small>免卖出平台费</small></label>}
        {error && <p id={`${id}-error`} className="sf-error" role="alert">{error}</p>}
        <p className="sf-hint">按一笔买入、一笔卖出且各一次成交估算；金额均以{currency === 'HKD' ? '港元' : '美元'}显示。卖出价留空时，计算同价往返成本。</p>
      </div>
      <div className="sf-results" aria-live="polite" aria-atomic="true">
        <div className="sf-fee-overview">
        <div className="sf-fee-summary">
          <div className="sf-total sf-total-main"><span>买卖合计费用 <small>{currency}</small></span><strong>{amount(result?.total)}</strong><p className="sf-fee-rate">占买入成交额 {result ? `${(result.feeRate * 100).toFixed(4)}%` : '—'}</p></div>
          <div className="sf-total sf-side-total"><span>买入费用 <small>{currency}</small></span><strong>{amount(result?.buy.total)}</strong><p className="sf-fee-rate">占买入成交额 {result ? `${(result.buy.total / result.buy.notional * 100).toFixed(4)}%` : '—'}</p></div>
          <div className="sf-total sf-side-total"><span>卖出费用 <small>{currency}</small></span><strong>{amount(result?.sell.total)}</strong><p className="sf-fee-rate">占卖出成交额 {result ? `${(result.sell.total / result.sell.notional * 100).toFixed(4)}%` : '—'}</p></div>
        </div>
        </div>
        <div className="sf-result-divider" aria-hidden="true" />
        <div className="sf-result-grid"><div><span>买入总支出</span><strong>{amount(result?.buy.cash)}</strong><small>成交金额 + 买入费用</small></div><div><span>卖出净收入</span><strong>{amount(result?.sell.cash)}</strong><small>成交金额 − 卖出费用</small></div><div><span>扣费后盈亏</span><strong className={result && result.profit < 0 ? 'sf-negative' : ''}>{amount(result?.profit)}</strong><small>卖出净收入 − 买入总支出</small></div><div><span>回本参考卖价</span><strong>{price(calculation?.breakEven)}</strong><small>已计卖出费用，未按报价档位取整</small></div></div>
      </div>
    </div>
    <div className="sf-detail-heading"><h3>券商费用对比</h3><span>{market === 'HK' ? '港股' : '美股'} · {currency} · 当前券商列在最前</span></div>
    <p className="sf-comparison-note">同一买入价、卖出价、股数及证券类型，采用本工具已收录的当前市场全部券商费率。富途免佣：{commissionFree ? '开启' : '关闭'}{market === 'HK' ? `；ZA 碎股卖出：${oddLotSell ? '开启' : '关闭'}` : ''}。优惠只作用于对应券商，未计报价差异与汇兑成本。</p>
    <FeeComparisonTable caption={`所有已收录${market === 'HK' ? '港股' : '美股'}券商费用对比（${currency}）`} columns={comparisons.map(item => ({ id: item.plan.broker, name: item.plan.name, plan: item.plan.plan, selected: item.plan.broker === broker, error: item.error, source: item.plan.sources[0]?.url }))} rows={comparisonRows} />
    <details className="sf-rules"><summary>查看费率、计算口径与官方来源 <span>核对于 {reviewedOn}</span></summary><div className="sf-rule-content"><dl>{plan.rules.map(rule => <div key={rule.id}><dt>{rule.label}</dt><dd>{rule.description}</dd></div>)}</dl><ul>{plan.notes.map(note => <li key={note}>{note}</li>)}<li>除整港元印花税、向上取分的 SEC / FINRA 外，其余逐项四舍五入至分进行估算。拆单或多次成交会改变取整及最低收费。</li><li>不包含汇兑、融资利息、持仓、股息、ADR 特别费用及个别证券的额外税费。费率为核对日快照，优惠及实际扣费以券商结单为准。</li></ul><div className="sf-sources">{plan.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a>)}</div></div></details>
  </section>;
}
