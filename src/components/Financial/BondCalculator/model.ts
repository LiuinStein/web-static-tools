import Decimal from 'decimal.js';
import { BondBroker, BondCurrency, BondType, currencies, getBondPlan, supportedBondTypes } from './rates';

export interface BondInput {
  currency: BondCurrency;
  broker: BondBroker;
  bondType: BondType;
  buyPrice: number;
  unitFace: number;
  couponRate: number;
  faceAmount: number;
  frequency: number;
  settlementDate: string;
  maturityDate: string;
  otherFees: number;
}
export interface BondFee { id: string; label: string; rule: string; amount: number }

export function parseBondNumber(text: string, allowZero = false): number | null {
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text.trim())) return null;
  const value = Number(text);
  return Number.isFinite(value) && (allowZero ? value >= 0 : value > 0) && value <= 1e12 ? value : null;
}

function dateValue(text: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number(text.slice(0, 4)) < 1900) throw new Error('请选择有效的交割日期和到期日期。');
  const value = Date.parse(`${text}T00:00:00Z`);
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== text) throw new Error('请选择有效的交割日期和到期日期。');
  return value;
}

/** Number of month ends with a position; maturity is treated as the redemption date. */
function custodyMonthEnds(settlement: number, maturity: number): number {
  const date = new Date(settlement);
  let year = date.getUTCFullYear(), month = date.getUTCMonth(), count = 0;
  while (true) {
    const monthEnd = Date.UTC(year, month + 1, 0);
    if (monthEnd >= maturity) return count;
    if (monthEnd >= settlement) count++;
    month++;
    if (month === 12) { month = 0; year++; }
  }
}

const money = (value: Decimal) => value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/** Hold-to-maturity simple-interest estimate, not a coupon cash-flow/YTM solver. */
export function calculateBond(input: BondInput) {
  getBondPlan(input.currency, input.broker);
  if (!supportedBondTypes(input.currency, input.broker).includes(input.bondType)) throw new Error('所选券商与币种不支持此债券类型。');
  for (const [label, value] of [['买入价格', input.buyPrice], ['票面价格', input.unitFace], ['持有面值', input.faceAmount]] as const) {
    if (!Number.isFinite(value) || value <= 0 || value > 1e12) throw new Error(`${label}须为大于 0 且不超过 1 万亿的有效数字。`);
  }
  if (!Number.isFinite(input.couponRate) || input.couponRate < 0 || input.couponRate > 100) throw new Error('票面年利率须为 0 至 100%。');
  if (input.bondType === 'strips' && input.couponRate !== 0) throw new Error('STRIPS 为零息债券，票面年利率须为 0。');
  if (![1, 2, 4, 12].includes(input.frequency)) throw new Error('请选择支持的派息频率。');
  if (!Number.isFinite(input.otherFees) || input.otherFees < 0 || input.otherFees > 1e12) throw new Error('其他费用须为 0 至 1 万亿的有效数字。');
  const settlement = dateValue(input.settlementDate), maturity = dateValue(input.maturityDate);
  const days = (maturity - settlement) / 86400000;
  if (days <= 0 || days > 36525) throw new Error('到期日期须晚于交割日期，且持有期限不超过 100 年。');
  const face = new Decimal(input.faceAmount);
  const notional = money(face.mul(input.buyPrice).div(input.unitFace));
  if (notional.lte(0) || notional.gt(1e12)) throw new Error('买入成交额须至少为 0.01，且不超过 1 万亿。');
  let commission = new Decimal(0), platform = new Decimal(0), custody = new Decimal(0);
  let commissionRule = '', platformRule = '不收取', custodyRule = '不收取';
  let custodyMonths = 0;
  if (input.broker === 'futu') {
    const rate = input.bondType === 'distressed' ? 0.36 : input.bondType === 'corporate' ? 0.16 : 0.08;
    const range = currencies.find(item => item.value === input.currency)!;
    commission = money(face.mul(rate).div(100));
    platform = money(Decimal.min(range.max, Decimal.max(range.min, face.mul('0.0004'))));
    custody = money(notional.mul('0.0008').mul(days).div(365));
    commissionRule = `持有面值 × ${rate}%`;
    platformRule = `面值 × 0.04%，最低 ${range.min}，最高 ${range.max}`;
    custodyRule = '买入成交额 × 0.08% × 持有天数 ÷ 365（市值近似）';
  } else if (input.broker === 'usmart') {
    if (input.bondType === 'treasury') {
      commission = money(face.mul('0.0007'));
      platform = money(Decimal.max(6, face.mul('0.00035')));
      commissionRule = '持有面值 × 0.07%';
      platformRule = '持有面值 × 0.035%，最低 6 USD';
      custodyRule = '美国国债目前暂不收取';
    } else {
      commission = money(notional.mul('0.005'));
      custodyMonths = custodyMonthEnds(settlement, maturity);
      custody = money(Decimal.max(10, notional.mul('0.0008').div(12))).mul(custodyMonths);
      commissionRule = '买入成交金额 × 0.5%';
      custodyRule = `每月市值 × 0.08% ÷ 12，最低 10 USD / 月；预计 ${custodyMonths} 个持仓月末`;
    }
  } else {
    if (input.bondType === 'treasury') {
      commissionRule = '美国国债线上交易费 0';
    } else {
      if (!face.mod(1000).isZero()) throw new Error('Schwab 其他二级市场债券请按每张 1,000 USD 面值填写整数张。');
      commission = money(Decimal.min(250, Decimal.max(10, face.div(1000))));
      commissionRule = '每 1,000 USD 面值收 1 USD，最低 10，最高 250';
    }
    custodyRule = '普通公开交易债券未列常规托管费，按 0 估算';
  }
  const other = money(new Decimal(input.otherFees));
  const fees: BondFee[] = [
    { id: 'commission', label: input.broker === 'schwab' ? '交易费 / 佣金' : '交易佣金', rule: commissionRule, amount: commission.toNumber() },
    { id: 'platform', label: '平台使用费', rule: platformRule, amount: platform.toNumber() },
    { id: 'custody', label: '预计托管费', rule: custodyRule, amount: custody.toNumber() },
    { id: 'other', label: '其他费用', rule: '按填写的公司行动、赎回等费用计入', amount: other.toNumber() },
  ];
  const interest = money(face.mul(input.couponRate).div(100).mul(days).div(365));
  const couponPayment = money(face.mul(input.couponRate).div(100).div(input.frequency));
  const buyCash = notional.plus(commission).plus(platform);
  const receipts = face.plus(interest).minus(custody).minus(other);
  const profit = receipts.minus(buyCash);
  const totalFees = commission.plus(platform).plus(custody).plus(other);
  const profitRate = profit.div(buyCash).mul(100);
  return {
    days, custodyMonths, fees, notional: notional.toNumber(), interest: interest.toNumber(),
    couponPayment: couponPayment.toNumber(), buyCash: buyCash.toNumber(), receipts: receipts.toNumber(),
    profit: profit.toNumber(), totalFees: totalFees.toNumber(), priceGain: face.minus(notional).toNumber(),
    profitRate: profitRate.toNumber(), annualizedRate: profitRate.mul(365).div(days).toNumber(),
    feeRate: totalFees.div(notional).mul(100).toNumber(),
  };
}
