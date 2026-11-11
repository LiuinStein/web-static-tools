import React, { useMemo, useState } from 'react';
import { BondBroker, BondCurrency, BondType, bondLabels, bondPlans, currencies, getBondPlan, reviewedOn, supportedBondTypes } from './rates';
import { BondInput, calculateBond, parseBondNumber } from './model';
import './style.css';

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function BondCalculator() {
  const [currency, setCurrency] = useState<BondCurrency>('HKD');
  const [brokers, setBrokers] = useState<Record<BondCurrency, BondBroker>>({ USD: 'futu', HKD: 'futu', CNH: 'futu' });
  const broker = brokers[currency], plan = getBondPlan(currency, broker);
  const [selectedType, setType] = useState<BondType>('treasury');
  const types = supportedBondTypes(currency, broker);
  const bondType = types.includes(selectedType) ? selectedType : types[0];
  const [fields, setFields] = useState(() => {
    const today = new Date();
    const maturity = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate());
    return { buyPrice: '97.654', unitFace: '100', couponRate: '2.5', faceAmount: '10000', otherFees: '0', settlementDate: localDate(today), maturityDate: localDate(maturity) };
  });
  const [frequency, setFrequency] = useState(2);
  const currencyPlan = currencies.find(item => item.value === currency)!;
  const couponText = bondType === 'strips' ? '0' : fields.couponRate;
  const parsed = {
    buyPrice: parseBondNumber(fields.buyPrice), unitFace: parseBondNumber(fields.unitFace),
    couponRate: parseBondNumber(couponText, true), faceAmount: parseBondNumber(fields.faceAmount),
    otherFees: fields.otherFees.trim() === '' ? 0 : parseBondNumber(fields.otherFees, true),
  };
  const calculation = useMemo(() => {
    if (Object.values(parsed).some(value => value === null)) return { result: null, error: '请填写有效的价格、面值、票息及费用；价格与面值须大于 0，票息与费用可为 0。' };
    try {
      return { result: calculateBond({ ...fields, ...parsed, frequency, currency, broker, bondType } as BondInput), error: '' };
    } catch (error) {
      return { result: null, error: error instanceof Error ? error.message : '请检查债券参数。' };
    }
  }, [fields, frequency, currency, broker, bondType]);
  const { result, error } = calculation;
  const amount = (value: number | undefined) => value === undefined ? '—' : value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const percent = (value: number | undefined) => value === undefined ? '—' : `${value.toFixed(4)}%`;
  const input = (key: 'buyPrice' | 'unitFace' | 'couponRate' | 'faceAmount' | 'otherFees', label: string, unit: string) => <label className="sf-field" htmlFor={`bond-${key}`}>
    <span>{label}<small>{unit}</small></span>
    <input id={`bond-${key}`} type="text" inputMode="decimal" autoComplete="off" value={key === 'couponRate' ? couponText : fields[key]} readOnly={key === 'couponRate' && bondType === 'strips'} onChange={event => setFields({ ...fields, [key]: event.target.value })} onFocus={event => event.currentTarget.select()} aria-invalid={parsed[key] === null || (key === 'couponRate' && parsed[key]! > 100)} aria-describedby={error ? 'bond-error' : undefined} />
  </label>;

  return <section className="tool-page financial-calculator bond-calculator" aria-label="债券到期收益计算器">
    <div className="sf-heading"><div><span className="sf-eyebrow">BOND RETURN</span><h2>持有到期，算清收益。</h2><p>选择券商与债券，查看到期收益和持有成本。</p></div><span className="sf-currency">{currency} · {currencyPlan.label}</span></div>
    <div className="sf-workspace">
      <div className="sf-input-panel">
        <div className="sf-markets" role="group" aria-label="债券计价币种">{currencies.map(item => <button key={item.value} type="button" aria-pressed={currency === item.value} onClick={() => setCurrency(item.value)}>{item.value === 'CNH' ? '人民币' : item.label}<small>{item.value}</small></button>)}</div>
        <label className="sf-field"><span>券商</span><select value={broker} onChange={event => setBrokers({ ...brokers, [currency]: event.target.value as BondBroker })}>{bondPlans.filter(item => item.currencies.includes(currency)).map(item => <option key={item.broker} value={item.broker}>{item.name}</option>)}</select></label>
        <p className="sf-plan">{plan.plan}</p>
        <div className="sf-input-grid">
          {input('buyPrice', '买入价格', currency)}
          {input('unitFace', '每张票面价格', currency)}
          {input('couponRate', '票面年利率', '% / 年')}
          {input('faceAmount', '持有面值总额', currency)}
          <label className="sf-field"><span>债券类型</span><select value={bondType} onChange={event => setType(event.target.value as BondType)}>{types.map(type => <option key={type} value={type}>{bondLabels[type]}</option>)}</select></label>
          <label className="sf-field"><span>派息频率</span><select value={frequency} onChange={event => setFrequency(Number(event.target.value))}>{[1, 2, 4, 12].map(value => <option key={value} value={value}>每年 {value} 次</option>)}</select></label>
          <label className="sf-field" htmlFor="bond-settlement"><span>买入交割日</span><input id="bond-settlement" type="date" min="1900-01-01" max="9999-12-31" value={fields.settlementDate} onChange={event => setFields({ ...fields, settlementDate: event.target.value })} aria-invalid={Boolean(error) && !fields.settlementDate} aria-describedby={error ? 'bond-error' : undefined} /></label>
          <label className="sf-field" htmlFor="bond-maturity"><span>到期日期</span><input id="bond-maturity" type="date" min={fields.settlementDate || '1900-01-01'} max="9999-12-31" value={fields.maturityDate} onChange={event => setFields({ ...fields, maturityDate: event.target.value })} aria-invalid={Boolean(error) && (!fields.maturityDate || fields.maturityDate <= fields.settlementDate)} aria-describedby={error ? 'bond-error' : undefined} /></label>
          {input('otherFees', '其他费用', `${currency} · 选填`)}
        </div>
        {broker === 'usmart' && bondType === 'corporate' && <p className="sf-hint">企业债赎回、公司行动等服务可能另收 100 USD / 指令，请将适用金额填入其他费用。</p>}
        {error && <p id="bond-error" className="sf-error" role="alert">{error}</p>}
        <p className="sf-hint">买入价与票面价采用同一报价单位；面值总额为到期偿还本金。按持有到期、365 天单利估算，非 YTM。</p>
      </div>
      <div className="sf-results" aria-live="polite" aria-atomic="true">
        <div className="sf-fee-overview"><div className="sf-fee-summary">
          <div className="sf-total sf-total-main"><span>预计到期净收益 <small>{currency}</small></span><strong>{amount(result?.profit)}</strong><p className="sf-fee-rate">占买入总支出 {percent(result?.profitRate)}</p></div>
          <div className="sf-total sf-side-total"><span>参考年化 <small>% / 年</small></span><strong>{result ? result.annualizedRate.toFixed(2) : '—'}</strong><p className="sf-fee-rate">按持有期限单利折算</p></div>
          <div className="sf-total sf-side-total"><span>每次派息 <small>{currency}</small></span><strong>{amount(result?.couponPayment)}</strong><p className="sf-fee-rate">{parsed.couponRate === 0 ? '零息债券，不派付票息' : `按全年 ${frequency} 次等额派息`}</p></div>
        </div></div>
        <div className="sf-result-divider" aria-hidden="true" />
        <div className="sf-result-grid">
          <div><span>买入总支出</span><strong>{amount(result?.buyCash)}</strong><small>成交金额 + 佣金 + 平台费</small></div>
          <div><span>累计净回款</span><strong>{amount(result?.receipts)}</strong><small>本金 + 利息 − 托管费 − 其他费用</small></div>
          <div><span>预计总费用</span><strong>{amount(result?.totalFees)}</strong><small>占买入成交额 {percent(result?.feeRate)}</small></div>
          <div><span>持有天数</span><strong>{result ? `${result.days.toLocaleString('zh-CN')} 天` : '—'}</strong><small>买入交割日至到期日</small></div>
          <div><span>持有期利息</span><strong>{amount(result?.interest)}</strong><small>按实际持有天数估算</small></div>
          <div><span>本金价差</span><strong className={result && result.priceGain < 0 ? 'sf-negative' : ''}>{amount(result?.priceGain)}</strong><small>持有面值 − 买入成交金额</small></div>
        </div>
      </div>
    </div>
    <div className="sf-detail-heading"><h3>费用明细</h3><span>{plan.name} · {currency}</span></div>
    <div className="sf-table-wrap"><table><caption className="sf-sr-only">债券买入及持有期间费用</caption><thead><tr><th scope="col">费项</th><th scope="col">计费规则</th><th scope="col">金额（{currency}）</th></tr></thead><tbody>
      {(result?.fees || [{ id: 'commission', label: '交易费 / 佣金' }, { id: 'platform', label: '平台使用费' }, { id: 'custody', label: '预计托管费' }, { id: 'other', label: '其他费用' }]).map(fee => <tr key={fee.id}><th scope="row">{fee.label}<small>{fee.id === 'custody' ? '持有期间估算' : fee.id === 'other' ? '手动填写' : '买入时收取'}</small><small className="bond-mobile-rule">{'rule' in fee ? fee.rule : '输入有效参数后显示'}</small></th><td>{'rule' in fee ? fee.rule : '输入有效参数后显示'}</td><td>{amount('amount' in fee ? fee.amount : undefined)}</td></tr>)}
    </tbody><tfoot><tr><th scope="row">总费用</th><td>买入费用 + 持有期间费用</td><td>{amount(result?.totalFees)}</td></tr></tfoot></table></div>
    <details className="sf-rules"><summary>查看费率、计算口径与官方来源 <span>核对于 {reviewedOn}</span></summary><div className="sf-rule-content">
      <dl><div><dt>成交金额</dt><dd>持有面值总额 × 买入价格 ÷ 每张票面价格。报价按每 100 面值时，票面价格填 100；Schwab「每张 1,000 面值」指计费单位，报价单位仍可填 100。</dd></div><div><dt>持有期利息</dt><dd>持有面值 × 票面年利率 × 实际持有天数 ÷ 365。每次派息按全年等额拆分，不代表完整派息日程。</dd></div><div><dt>到期净收益 / 年化</dt><dd>累计净回款 − 买入总支出；参考年化为净收益 ÷ 买入总支出 × 365 ÷ 持有天数。假设本金按面值偿还，不采用逐期现金流的 YTM 口径。</dd></div><div><dt>托管费估算</dt><dd>以买入成交额近似持有期间市值；uSMART 企业债按持仓月末计收，其他类型按所选券商规则处理。</dd></div></dl>
      <ul>{plan.notes.map(note => <li key={note}>{note}</li>)}<li>切换币种不做汇率换算；本工具不计算提前卖出、应计利息交割明细、汇兑、融资及税费。实际票息天数规则、报价加价与结单取整可能使结果不同。</li><li>「其他费用」在累计净回款中扣除，默认 0。按订单或公司行动通知填入适用收费。</li><li>ZA Bank 未列入：截至核对日，未查到普通个人账户直投债券的公开交易入口及费率；债券基金、南向通合格产品说明不作为本工具的债券收费依据。</li></ul>
      <div className="sf-sources"><a href={plan.source.url} target="_blank" rel="noreferrer">{plan.source.label}</a><a href="https://bank.za.group/rates-list" target="_blank" rel="noreferrer">ZA Bank · 服务收费资料</a></div>
    </div></details>
  </section>;
}
