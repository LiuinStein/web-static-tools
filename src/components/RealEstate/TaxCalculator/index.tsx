import * as React from 'react';
import SegmentedControl from '@/components/SegmentedControl';
import Select from '@/components/Select';
import AmountInput from '@/pages/MonthlyReview/AmountInput';
import { rawAmount } from '@/pages/MonthlyReview/amount';
import type { HomeCount, HomeType } from './model';
import { calculatePropertyTaxes, deedTaxRate } from './model';
import './style.css';

const money = (value: number) => value.toLocaleString('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 2 });

export default function TaxCalculator() {
  const [homeType, setHomeType] = React.useState<HomeType>('resale');
  const [price, setPrice] = React.useState('6000000');
  const [area, setArea] = React.useState('90');
  const [homeCount, setHomeCount] = React.useState<HomeCount>('first');
  const [monthsHeld, setMonthsHeld] = React.useState('60');
  const [onlyHome, setOnlyHome] = React.useState(true);
  const [originalPrice, setOriginalPrice] = React.useState('0');
  const [includeBrokerage, setIncludeBrokerage] = React.useState(true);
  const deal = Number(rawAmount(price)) || 0;
  const size = Number(rawAmount(area)) || 0;
  const months = Number(rawAmount(monthsHeld)) || 0;
  const rate = deedTaxRate(size, homeCount);
  const taxes = calculatePropertyTaxes({
    homeType, price: deal, area: size, homeCount, monthsHeld: months, onlyHome,
    originalPrice: Number(rawAmount(originalPrice)) || 0,
    stampRelief: true,
    includeBrokerage,
  });
  const total = taxes.reduce((sum, tax) => sum + tax.amount, 0);
  const buyersTotal = taxes.filter(tax => tax.payer === '买方' || tax.payer === '买卖双方').reduce((sum, tax) => sum + tax.amount, 0);
  const sellersTotal = taxes.filter(tax => tax.payer === '卖方' || tax.payer === '买卖双方').reduce((sum, tax) => sum + tax.amount, 0);
  const scaleTenThousand = (value: string) => {
    const amount = Number(rawAmount(value));
    if (!Number.isFinite(amount) || amount <= 0) return rawAmount(value);
    return amount < 10000 ? String(amount * 10000) : rawAmount(value);
  };
  const field = (label: string, value: string, setValue: (value: string) => void, hint?: string, multiplyTenThousand = false) => (
    <label className="tool-field re-tax-field">
      <span>{label}</span>
      <AmountInput
        appearance="native"
        aria-label={label}
        value={value}
        onFocus={event => event.currentTarget.select()}
        onClick={event => event.currentTarget.select()}
        onChange={event => setValue(rawAmount(event.currentTarget.value))}
        onBlur={multiplyTenThousand ? event => setValue(scaleTenThousand(event.currentTarget.value)) : undefined}
      />
      {hint && <small className="re-tax-field-hint">{hint}</small>}
    </label>
  );
  return <main className="re-tax-calculator tool-page">
    <header className="salary-heading"><div><div className="salary-eyebrow">房地产 / 交易税费</div><h1>税费计算器</h1><p>按北京住房交易政策估算新房契税及二手房买卖双方税费。</p></div></header>
    <div className="salary-notice">北京住房交易估算 · 仅供交易参考；计税价格、扣除项目及资格以税务机关核定为准。</div>
    <div className="re-tax-layout salary-layout">
      <section className="re-tax-input-panel salary-panel">
        <h2>01　交易参数</h2>
        <SegmentedControl<HomeType> aria-label="住房类型" value={homeType} onChange={setHomeType} options={[
          { value: 'resale', label: '二手房' }, { value: 'new', label: '新房' },
        ]} />
        <div className="tool-fields re-tax-form">
          {field('合同成交价（元）', price, setPrice, undefined, true)}
          {field('建筑面积（㎡）', area, setArea)}
          <label className="tool-field re-tax-field">
            <span>本次购房后家庭住房套数</span>
            <Select aria-label="本次购房后家庭住房套数" value={homeCount} onChange={event => setHomeCount(event.target.value as HomeCount)}>
              <option value="first">首套</option><option value="second">二套</option><option value="other">三套及以上 / 不符合优惠条件</option>
            </Select>
          </label>
          {homeType === 'resale' && <>
            <label className="tool-field re-tax-field">
              <span>卖方持有时间</span>
              <Select aria-label="卖方持有时间" value={monthsHeld} onChange={event => setMonthsHeld(event.target.value)}>
                <option value="23">不满二</option>
                <option value="24">满二</option>
                <option value="60">满五</option>
              </Select>
              <small className="re-tax-field-hint">满 24 个月免征增值税；满 60 个月且家庭唯一可免个税。</small>
            </label>
            <label className="tool-field re-tax-field">
              <span>卖方住房情况</span>
              <Select aria-label="卖方住房情况" value={onlyHome ? 'sole' : 'not-sole'} onChange={event => setOnlyHome(event.target.value === 'sole')}>
                <option value="sole">家庭唯一住房</option><option value="not-sole">非家庭唯一住房</option>
              </Select>
            </label>
            {field('卖方购入原值（元）', originalPrice, setOriginalPrice, undefined, true)}
            <label className="re-tax-check">
              <input
                type="checkbox"
                checked={includeBrokerage}
                onChange={event => setIncludeBrokerage(event.target.checked)}
              />
              包含中介费（买卖双方各按成交价 1% 估算）
            </label>
          </>}
        </div>
      </section>
      <section className="re-tax-results salary-results" aria-live="polite">
        <div className="re-tax-summary salary-total">
          <div className="re-tax-total"><span>预计税费合计</span><strong>{money(total)}</strong></div>
          <div className="re-tax-side-total"><span>买方承担</span><strong>{money(buyersTotal)}</strong></div>
          {homeType === 'resale' && <div className="re-tax-side-total"><span>卖方承担</span><strong>{money(sellersTotal)}</strong></div>}
        </div>
        <div className="re-tax-detail-panel salary-panel">
          <h2>02　税费明细</h2>
          <div className="re-tax-table-wrap"><table><thead><tr><th>税种</th><th>承担方</th><th>估算口径</th><th>金额</th></tr></thead>
            <tbody>{taxes.map(tax => <tr key={tax.name}><th>{tax.name}</th><td>{tax.payer}</td><td>{tax.rate}</td><td>{money(tax.amount)}</td></tr>)}</tbody>
            <tfoot><tr><th colSpan={3}>契税参考税率</th><td>{(rate * 100).toFixed(rate * 100 % 1 ? 1 : 0)}%</td></tr></tfoot>
          </table></div>
          <details className="re-tax-policy"><summary>政策口径与估算说明</summary>
            <ul>
              <li>契税：家庭唯一住房，140㎡及以下 1%、以上 1.5%；家庭第二套，140㎡及以下 1%、以上 2%。不符合优惠条件按北京市 3% 税率估算。</li>
              <li>二手房增值税：个人销售购买不足 2 年住房按含税成交价换算为 3% 征收率；满 2 年免征。</li>
              <li>个人所得税：自用满 5 年且为家庭唯一生活用房免征；卖方购入原值为 0 时按成交价 1%估算；原值大于 0 时按扣除增值税和购入原值后的转让所得 20%估算。</li>
              <li>个人住房买卖暂免印花税。勾选中介费时，买卖双方各按成交价 1%估算。结果不含登记费、贷款费用、住宅专项维修资金等项目；计税价格、扣除项目及资格以税务机关核定为准。</li>
            </ul>
            <div className="re-tax-sources">
              <a href="https://www.beijing.gov.cn/zhengce/zhengcefagui/qtwj/202512/t20251231_4381541.html" target="_blank" rel="noreferrer">个人销售住房增值税政策（北京政府网）</a>
              <a href="https://www.beijing.gov.cn/ywdt/zybwdt/202411/t20241114_3941003.html" target="_blank" rel="noreferrer">住房交易契税优惠政策（北京政府网）</a>
              <a href="https://www.beijing.gov.cn/zhengce/zcjd/201905/t20190523_77289.html" target="_blank" rel="noreferrer">个人转让住房个税政策（北京政府网）</a>
              <a href="https://etax.beijing.chinatax.gov.cn/WebGt3GrZlf/views/ssxgj/skjsq.html" target="_blank" rel="noreferrer">北京市税务局房产交易税费计算器</a>
            </div>
          </details>
        </div>
      </section>
    </div>
  </main>;
}
