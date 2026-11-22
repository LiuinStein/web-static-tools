import * as React from 'react';
import { Card, Form } from '@alifd/next';
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
  const [price, setPrice] = React.useState('3000000');
  const [area, setArea] = React.useState('90');
  const [homeCount, setHomeCount] = React.useState<HomeCount>('first');
  const [monthsHeld, setMonthsHeld] = React.useState('60');
  const [onlyHome, setOnlyHome] = React.useState(true);
  const [originalPrice, setOriginalPrice] = React.useState('');
  const [deductibleCosts, setDeductibleCosts] = React.useState('');
  const [approved, setApproved] = React.useState(false);
  const deal = Number(rawAmount(price)) || 0;
  const size = Number(rawAmount(area)) || 0;
  const months = Number(rawAmount(monthsHeld)) || 0;
  const rate = deedTaxRate(size, homeCount);
  const taxes = calculatePropertyTaxes({
    homeType, price: deal, area: size, homeCount, monthsHeld: months, onlyHome,
    originalPrice: Number(rawAmount(originalPrice)) || 0,
    deductibleCosts: Number(rawAmount(deductibleCosts)) || 0,
    useApprovedIncomeTax: approved, stampRelief: true,
  });
  const total = taxes.reduce((sum, tax) => sum + tax.amount, 0);
  const buyersTotal = taxes.filter(tax => tax.payer === '买方' || tax.payer === '买卖双方').reduce((sum, tax) => sum + tax.amount, 0);
  const sellersTotal = taxes.filter(tax => tax.payer === '卖方' || tax.payer === '买卖双方').reduce((sum, tax) => sum + tax.amount, 0);
  const field = (label: string, value: string, setValue: (value: string) => void, hint?: string) => (
    <Form.Item colSpan={6} label={label}>
      <AmountInput appearance="fusion" aria-label={label} value={value} onChange={event => setValue(rawAmount(event.currentTarget.value))} />
      {hint && <small className="re-tax-field-hint">{hint}</small>}
    </Form.Item>
  );
  return <Card free>
    <Card.Header title="税费计算器" />
    <Card.Content>
      <div className="re-tax-calculator">
        <SegmentedControl<HomeType> aria-label="住房类型" value={homeType} onChange={setHomeType} options={[
          { value: 'resale', label: '二手房' }, { value: 'new', label: '新房' },
        ]} />
        <Form responsive labelAlign="top">
          {field('合同成交价（元）', price, setPrice)}
          {field('建筑面积（㎡）', area, setArea)}
          <Form.Item colSpan={6} label="本次购房后家庭住房套数">
            <Select aria-label="本次购房后家庭住房套数" value={homeCount} onChange={event => setHomeCount(event.target.value as HomeCount)}>
              <option value="first">首套</option><option value="second">二套</option><option value="other">三套及以上 / 不符合优惠条件</option>
            </Select>
          </Form.Item>
          {homeType === 'resale' && <>
            {field('卖方持有时间（月）', monthsHeld, setMonthsHeld, '满 24 个月免征增值税；满 60 个月且家庭唯一可免个税。')}
            {!(onlyHome && months >= 60) && !approved && <>
              {field('卖方购入原值（元）', originalPrice, setOriginalPrice)}
              {field('可扣除相关税费及合理费用（元）', deductibleCosts, setDeductibleCosts)}
            </>}
            <Form.Item colSpan={6} label="卖方住房情况">
              <Select aria-label="卖方住房情况" value={onlyHome ? 'sole' : 'not-sole'} onChange={event => setOnlyHome(event.target.value === 'sole')}>
                <option value="sole">家庭唯一住房</option><option value="not-sole">非家庭唯一住房</option>
              </Select>
            </Form.Item>
            {!(onlyHome && months >= 60) && <Form.Item colSpan={6}>
              <label className="re-tax-check"><input type="checkbox" checked={approved} onChange={event => setApproved(event.target.checked)} />按北京核定征收率 1% 估算个人所得税</label>
            </Form.Item>}
          </>}
          <Form.Item colSpan={12}>
            <section className="re-tax-summary" aria-live="polite">
              <div><span>预计税费合计</span><strong>{money(total)}</strong></div>
              <div><span>买方</span><strong>{money(buyersTotal)}</strong></div>
              {homeType === 'resale' && <div><span>卖方</span><strong>{money(sellersTotal)}</strong></div>}
            </section>
          </Form.Item>
          <Form.Item colSpan={12}>
            <div className="re-tax-table-wrap"><table><thead><tr><th>税种</th><th>承担方</th><th>估算口径</th><th>金额</th></tr></thead>
              <tbody>{taxes.map(tax => <tr key={tax.name}><th>{tax.name}</th><td>{tax.payer}</td><td>{tax.rate}</td><td>{money(tax.amount)}</td></tr>)}</tbody>
              <tfoot><tr><th colSpan={3}>契税参考税率</th><td>{(rate * 100).toFixed(rate * 100 % 1 ? 1 : 0)}%</td></tr></tfoot>
            </table></div>
          </Form.Item>
          <Form.Item colSpan={12}>
            <details className="re-tax-policy"><summary>政策口径与估算说明</summary>
              <ul>
                <li>契税：家庭唯一住房，140㎡及以下 1%、以上 1.5%；家庭第二套，140㎡及以下 1%、以上 2%。不符合优惠条件按北京市 3% 税率估算。</li>
                <li>二手房增值税：个人销售购买不足 2 年住房按含税成交价换算为 3% 征收率；满 2 年免征。</li>
                <li>个人所得税：自用满 5 年且为家庭唯一生活用房免征；可核实原值时按转让所得 20%估算，无法核实时北京核定征收率按成交价 1%估算。</li>
                <li>个人住房买卖暂免印花税。结果不含中介费、登记费、贷款费用、住宅专项维修资金等非税项目；计税价格、扣除项目及资格以税务机关核定为准。</li>
              </ul>
              <div className="re-tax-sources">
                <a href="https://www.beijing.gov.cn/zhengce/zhengcefagui/qtwj/202512/t20251231_4381541.html" target="_blank" rel="noreferrer">个人销售住房增值税政策（北京政府网）</a>
                <a href="https://www.beijing.gov.cn/ywdt/zybwdt/202411/t20241114_3941003.html" target="_blank" rel="noreferrer">住房交易契税优惠政策（北京政府网）</a>
                <a href="https://www.beijing.gov.cn/zhengce/zcjd/201905/t20190523_77289.html" target="_blank" rel="noreferrer">个人转让住房个税政策（北京政府网）</a>
                <a href="https://etax.beijing.chinatax.gov.cn/WebGt3GrZlf/views/ssxgj/skjsq.html" target="_blank" rel="noreferrer">北京市税务局房产交易税费计算器</a>
              </div>
            </details>
          </Form.Item>
        </Form>
      </div>
    </Card.Content>
  </Card>;
}
