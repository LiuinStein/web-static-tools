export type BondCurrency = 'USD' | 'HKD' | 'CNH';
export type BondBroker = 'futu' | 'usmart' | 'schwab';
export type BondType = 'treasury' | 'sovereign' | 'corporate' | 'distressed' | 'municipal' | 'agency' | 'strips';
export const reviewedOn = '2026-11-04';
export const currencies: { value: BondCurrency; label: string; min: number; max: number }[] = [
  { value: 'HKD', label: '港元', min: 16, max: 120 },
  { value: 'USD', label: '美元', min: 2, max: 15 },
  { value: 'CNH', label: '离岸人民币', min: 15, max: 110 },
];
export const bondLabels: Record<BondType, string> = {
  treasury: '美国国债（不含 STRIPS）', sovereign: '其他主权债', corporate: '企业债 / 金融债',
  distressed: '困境债', municipal: '美国市政债', agency: '美国机构债', strips: '零息国债 STRIPS',
};
export interface BondPlan {
  broker: BondBroker;
  name: string;
  plan: string;
  currencies: BondCurrency[];
  types: BondType[];
  source: { label: string; url: string };
  notes: string[];
}
export const bondPlans: BondPlan[] = [
  {
    broker: 'futu', name: '富途 Futu', plan: '香港账户 · 标准线上费率',
    currencies: ['USD', 'HKD', 'CNH'], types: ['treasury', 'sovereign', 'corporate', 'distressed'],
    source: { label: '富途香港 · 债券费用', url: 'https://www.futuhk.com/hans/support/topic2_1034' },
    notes: ['按面值计佣金：主权债（含美国国债）0.08%，企业债、城投债、金融债等 0.16%，困境债 0.36%。', '平台费为面值的 0.04%，按币种设置上下限；托管费按每日持仓市值的 0.08% ÷ 365 计收。'],
  },
  {
    broker: 'usmart', name: 'uSMART 盈立', plan: '香港个人账户 · 标准线上费率',
    currencies: ['USD'], types: ['treasury', 'corporate'],
    source: { label: 'uSMART 香港 · 债券收费细则', url: 'https://hk.usmartglobal.com/zh-cn/charges/3' },
    notes: ['美国国债：面值的 0.07% 佣金，0.035% 平台费（最低 6 美元），目前暂不收托管费。', '企业债：成交金额的 0.5% 佣金，平台费 0；月托管费按月末持仓市值 × 0.08% ÷ 12，最低 10 美元 / 月。此处按每个持仓月末计费，假设市值不变、到期日不再持仓；不足整月的账单以券商为准。按本笔为唯一持仓估算，账户有多笔债券时不要重复套用最低费。', '企业债代履行权及公司行动等服务可按每宗指令收取 100 美元。请把适用的赎回、公司行动等费用填入「其他费用」，默认 0 不表示券商豁免。'],
  },
  {
    broker: 'schwab', name: '嘉信 Schwab', plan: 'International 个人账户 · 线上二级市场',
    currencies: ['USD'], types: ['treasury', 'corporate', 'municipal', 'agency', 'strips'],
    source: { label: 'Schwab · 个人投资者收费指南', url: 'https://www.schwab.com/legal/schwab-pricing-guide-for-individual-investors' },
    notes: ['美国国债线上交易费为 0；其他列示的二级市场债券每张 1 美元（本工具按每张 1,000 美元面值），每笔最低 10 美元、最高 250 美元。零息 STRIPS 按其他二级市场债券收费，不套用普通美国国债的 0 交易费。', '采用单笔线上交易口径，不含经纪辅助下单及特殊产品；公开上市普通债券未列常规托管费，此处按 0 估算。', 'Schwab 作为交易对手时，交易费可能已包含在报价中。请填写未含本页交易费的价格，避免重复计算；买卖价差或其他加价不包含在本页费用中。'],
  },
];
export function getBondPlan(currency: BondCurrency, broker: BondBroker): BondPlan {
  const plan = bondPlans.find(item => item.broker === broker && item.currencies.includes(currency));
  if (!plan) throw new Error('不支持所选币种与券商组合。');
  return plan;
}
export function supportedBondTypes(currency: BondCurrency, broker: BondBroker): BondType[] {
  return getBondPlan(currency, broker).types.filter(type => currency === 'USD' || type !== 'treasury');
}
