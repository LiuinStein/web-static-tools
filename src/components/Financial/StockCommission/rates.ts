export type Market = 'HK' | 'US';
export type Broker = 'futu' | 'usmart' | 'za' | 'schwab' | 'ibkr';
export type Instrument = 'stock' | 'etf';
export interface FeeRule {
  id: string;
  label: string;
  category: 'broker' | 'thirdParty';
  basis: 'notional' | 'shares' | 'fixed';
  rate: string;
  description: string;
  minimum?: string;
  maximum?: string;
  maximumRate?: string;
  maximumTakesPriority?: boolean;
  side?: 'sell';
  rounding?: 'up';
  decimals?: number;
  stockOnly?: boolean;
  waivable?: boolean;
  // FINRA does not assess TAF when the execution price is below its per-share rate.
  exemptBelowPrice?: string;
}
export interface Source { label: string; url: string; }
export interface BrokerPlan {
  broker: Broker;
  name: string;
  plan: string;
  rules: FeeRule[];
  notes: string[];
  sources: Source[];
}
export const reviewedOn = '2026-11-04';
export const secSource: Source = { label: 'SEC · 2026 交易费率', url: 'https://www.sec.gov/rules-regulations/fee-rate-advisories/2026-2' };
export const finraSource: Source = { label: 'FINRA · 2026–2029 收费调整', url: 'https://www.finra.org/sites/default/files/2024-11/NOF-IMM-EFF-FINRA-2024-019.pdf' };
const futuSource = (market: Market): Source => ({ label: `富途香港 · ${market === 'HK' ? '港股' : '美股'}收费`, url: `https://www.futuhk.com/hans/support/topic2_${market === 'HK' ? '335' : '283'}?from_platform=1` });
const usmartSource: Source = { label: 'uSMART 香港 · 服务与收费', url: 'https://hk.usmartglobal.com/zh-cn/charges' };
const zaHKSource: Source = { label: 'ZA Bank · 港股收费', url: 'https://bank.za.group/hk/en/faqs/Individuals/Investment_Related/HK_Stock_Trading/68f85039cd872843ca437132' };
const zaUSSource: Source = { label: 'ZA Bank · 美股收费', url: 'https://bank.za.group/en/faqs/Individuals/Investment_Related/US_Stock_Trading/673c6db49368571c627b50d2' };
const commission = (rate: string, basis: FeeRule['basis'], description: string, extra: Partial<FeeRule> = {}): FeeRule => ({ id: 'commission', label: '佣金', category: 'broker', basis, rate, description, ...extra });
const platform = (rate: string, basis: FeeRule['basis'], description: string, extra: Partial<FeeRule> = {}): FeeRule => ({ id: 'platform', label: '平台使用费', category: 'broker', basis, rate, description, ...extra });
function hkFees(broker: Broker): FeeRule[] {
  return [
    { id: 'stamp', label: '股票印花税', category: 'thirdParty', basis: 'notional', rate: '0.001', stockOnly: true, rounding: 'up', decimals: 0, description: '成交金额 × 0.1%，向上取整至港元；ETF 豁免' },
    { id: 'settlement', label: '结算交收费', category: 'thirdParty', basis: 'notional', rate: '0.000042', description: '成交金额 × 0.0042%，无最低及最高限制' },
    { id: 'trading', label: '交易费', category: 'thirdParty', basis: 'notional', rate: '0.0000565', minimum: broker === 'za' ? undefined : '0.01', description: `成交金额 × 0.00565%${broker === 'za' ? '' : '，最低 HKD 0.01'}` },
    { id: 'sfc', label: '证监会交易征费', category: 'thirdParty', basis: 'notional', rate: '0.000027', minimum: broker === 'futu' ? '0.01' : undefined, description: `成交金额 × 0.0027%${broker === 'futu' ? '，最低 HKD 0.01' : ''}` },
    { id: 'afrc', label: '财汇局交易征费', category: 'thirdParty', basis: 'notional', rate: '0.0000015', description: '成交金额 × 0.00015%' },
  ];
}
function secFee(reference = false): FeeRule {
  return { id: 'sec', label: reference ? 'SEC 费用（参考）' : 'SEC 规费', category: 'thirdParty', basis: 'notional', rate: '0.0000206', side: 'sell', rounding: 'up', minimum: reference ? undefined : '0.01', description: '仅卖出：成交金额 × 0.00206%，按分向上取整' };
}
function tafFee(reference = false): FeeRule {
  return { id: 'taf', label: reference ? 'FINRA TAF（参考）' : 'FINRA 交易活动费', category: 'thirdParty', basis: 'shares', rate: '0.000195', side: 'sell', rounding: 'up', minimum: reference ? undefined : '0.01', maximum: '9.79', exemptBelowPrice: reference ? '0.000195' : undefined, description: '仅卖出：USD 0.000195/股，最高 USD 9.79，按分向上取整' };
}
const usScope = '适用美国交易所上市股票及 ETF 的整股线上交易；不含 OTC、ADR 特别收费、期权及不足 1 股的碎股订单。';
export const plans: Record<Market, BrokerPlan[]> = {
  HK: [
    { broker: 'futu', name: '富途 Futu', plan: '香港账户 · 固定式', rules: [commission('0.0003', 'notional', '成交金额 × 0.03%，最低 HKD 3', { minimum: '3', waivable: true }), platform('15', 'fixed', 'HKD 15/单'), ...hkFees('futu')], notes: ['免佣优惠只减免佣金，平台费及代收费照收。'], sources: [futuSource('HK')] },
    { broker: 'usmart', name: 'uSMART 盈立', plan: '香港个人标准账户 · 基本佣金计划', rules: [commission('0.0003', 'notional', '成交金额 × 0.03%，无最低佣金'), platform('12', 'fixed', 'HKD 12/单'), ...hkFees('usmart')], notes: ['采用基本佣金计划，不自动套用 Trader / PRO、港股 ETF 限时优惠或高频套餐。'], sources: [usmartSource] },
    { broker: 'za', name: 'ZA Bank 众安银行', plan: '香港账户 · 标准收费', rules: [commission('0', 'fixed', '豁免'), platform('0.0005', 'notional', '成交金额 × 0.05%，最低 HKD 18', { minimum: '18', maximumRate: '0.015' }), ...hkFees('za')], notes: ['按整手订单估算；不足一手的卖出订单免平台费，需勾选「卖出为碎股订单」。不含 ZA Perks 优惠。'], sources: [zaHKSource] },
    { broker: 'ibkr', name: 'IBKR 盈透证券', plan: '固定式 · 港币计价 SEHK 股票 / ETF', rules: [commission('0.0008', 'notional', '成交金额 × 0.08%，最低 HKD 18；含交易费及结算费', { minimum: '18' }), platform('0', 'fixed', '不收平台费'), ...hkFees('ibkr').filter(rule => !['trading', 'settlement'].includes(rule.id))], notes: ['固定式已包含交易费和结算费，只另计印花税、证监会及财汇局征费；ETF 豁免印花税。', '不含阶梯式、人民币柜台、沪深港通、介绍经纪商加收费用及碎股订单。'], sources: [{ label: 'IBKR · 股票佣金', url: 'https://www.interactivebrokers.com/en/pricing/commissions-stocks.php' }, { label: 'IBKR · 港股固定式收费示例', url: 'https://www.interactivebrokers.com.hk/en/index.php?f=1316' }] },
  ],
  US: [
    { broker: 'futu', name: '富途 Futu', plan: '香港账户 · 固定式', rules: [
      commission('0.0049', 'shares', 'USD 0.0049/股，最低 0.99；上限成交金额 0.5%，最低优先', { minimum: '0.99', maximumRate: '0.005', waivable: true }),
      platform('0.005', 'shares', 'USD 0.005/股，最低 1；上限成交金额 0.5%，最低优先', { minimum: '1', maximumRate: '0.005' }),
      { id: 'settlement', label: '交收费', category: 'thirdParty', basis: 'shares', rate: '0.003', description: 'USD 0.003/股' }, secFee(), tafFee(),
      { id: 'cat', label: 'CAT 综合审计跟踪费', category: 'thirdParty', basis: 'shares', rate: '0.000003', description: 'NMS 上市股票：USD 0.000003/股' },
    ], notes: [usScope, '免佣仅减免佣金。CAT 按官网列示费率计算，未额外添加最低收费。'], sources: [futuSource('US'), secSource] },
    { broker: 'usmart', name: 'uSMART 盈立', plan: '香港个人标准账户 · 常规免佣计划', rules: [commission('0', 'fixed', '常规免佣'), platform('0.009', 'shares', 'USD 0.009/股，最低 1.88；上限成交金额 1%，最低优先', { minimum: '1.88', maximumRate: '0.01' }),
      { id: 'settlement', label: '交收费', category: 'thirdParty', basis: 'shares', rate: '0.003', minimum: '0.01', maximumRate: '0.03', description: 'USD 0.003/股，最低 0.01，上限成交金额 3%' }, secFee(),
      { id: 'taf', label: 'FINRA 交易活动费', category: 'thirdParty', basis: 'fixed', rate: '0', side: 'sell', description: '官网当前列为 0，不重复套用其他券商的 TAF' },
      { id: 'cat', label: 'CAT 综合审计追踪费', category: 'thirdParty', basis: 'shares', rate: '0.000003', minimum: '0.01', description: 'USD 0.000003/股，每单最低 0.01' },
    ], notes: [usScope, '不套用指定客户 USD 0.99、Trader / PRO 或其他限时优惠；TAF 按券商官网列示为 0。'], sources: [usmartSource, secSource] },
    { broker: 'za', name: 'ZA Bank 众安银行', plan: '香港账户 · 标准收费', rules: [commission('0', 'fixed', '豁免'), platform('0.0099', 'shares', 'USD 0.0099/股，最低 1.99；上限成交金额 1.5%，最低优先', { minimum: '1.99', maximumRate: '0.015' }), secFee(true), tafFee(true)], notes: [usScope, '官网未列 SEC / FINRA 的具体取整细则，按现行监管费率及逐项向上取分估算；不含 ZA Perks 优惠。'], sources: [zaUSSource, secSource, finraSource] },
    { broker: 'ibkr', name: 'IBKR 盈透证券', plan: 'IBKR Pro · 固定式 · SmartRouting', rules: [commission('0.005', 'shares', 'USD 0.005/股，最低 USD 1，上限成交金额 1%；上限优先', { minimum: '1', maximumRate: '0.01', maximumTakesPriority: true }), platform('0', 'fixed', '不收平台费'), secFee(true), tafFee(true)], notes: [usScope, '固定式包含交易所及清算费用，卖出另计 SEC / FINRA 费用（参考估算）；不含阶梯式、IBKR Lite、直接路由及介绍经纪商加价。实际取整及代收费以成交结单为准。'], sources: [{ label: 'IBKR · 股票佣金与美国收费细则', url: 'https://www.interactivebrokers.com/en/pricing/commissions-stocks.php' }, secSource, finraSource] },
    { broker: 'schwab', name: 'Charles Schwab 嘉信', plan: 'International 个人账户 · 线上交易', rules: [commission('0', 'fixed', '上市股票及 ETF 线上交易免佣'), platform('0', 'fixed', '不收平台费'), secFee(true), tafFee(true)], notes: [usScope, 'SEC / FINRA 两项用于估算 Industry Fee。Schwab 实际收费可能因取整及结算安排不同，以成交结单为准；不适用于 Schwab 香港账户。'], sources: [{ label: 'Schwab International · 定价', url: 'https://international.schwab.com/pricing' }, { label: 'Schwab · 个人投资者收费指南', url: 'https://www.schwab.com/legal/schwab-pricing-guide-for-individual-investors' }, secSource, finraSource] },
  ],
};
export function getPlan(market: Market, broker: Broker): BrokerPlan {
  const plan = plans[market].find(item => item.broker === broker);
  if (!plan) throw new Error('所选券商不支持此市场');
  return plan;
}
