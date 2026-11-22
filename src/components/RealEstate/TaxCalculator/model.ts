export type HomeType = 'new' | 'resale';
export type HomeCount = 'first' | 'second' | 'other';

export interface TaxInputs {
  homeType: HomeType;
  price: number;
  area: number;
  homeCount: HomeCount;
  monthsHeld: number;
  onlyHome: boolean;
  originalPrice: number;
  stampRelief: boolean;
}

export interface TaxItem {
  name: string;
  payer: '买方' | '卖方' | '买卖双方';
  rate: string;
  amount: number;
}

export function deedTaxRate(area: number, homeCount: HomeCount): number {
  if (homeCount === 'first') return area <= 140 ? 0.01 : 0.015;
  if (homeCount === 'second') return area <= 140 ? 0.01 : 0.02;
  return 0.03;
}

export function calculatePropertyTaxes(input: TaxInputs): TaxItem[] {
  const taxes: TaxItem[] = [];
  if (input.price <= 0 || input.area <= 0) return taxes;

  const deedRate = deedTaxRate(input.area, input.homeCount);
  taxes.push({ name: '契税', payer: '买方', rate: `${deedRate * 100}%`, amount: input.price * deedRate });
  if (input.homeType === 'new') return taxes;

  const vat = input.monthsHeld < 24 ? input.price * 3 / 103 : 0;
  if (vat > 0) taxes.push({ name: '增值税', payer: '卖方', rate: '3%（含税价换算）', amount: vat });

  const incomeTax = input.onlyHome && input.monthsHeld >= 60
    ? 0
    : input.originalPrice <= 0
      ? input.price * 0.01
      : Math.max(0, input.price / (vat > 0 ? 1.03 : 1) - input.originalPrice) * 0.2;
  if (incomeTax > 0) {
    taxes.push({ name: '个人所得税', payer: '卖方', rate: input.originalPrice <= 0 ? '成交价 × 1%' : '应纳税所得额 × 20%', amount: incomeTax });
  }
  taxes.push({ name: '印花税', payer: '买卖双方', rate: input.stampRelief ? '个人住房暂免' : '住房买卖合同暂免', amount: 0 });
  return taxes;
}
