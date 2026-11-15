import Decimal from 'decimal.js';
import { currencyCode, formatFixedAmount, rawAmount } from './amount';
import { liquidityCost } from './liquidity-analysis';
import type { MonthlyWorkbook, Product } from './workbook';

const presets = [
  { label: '止损清仓', outcome: '预计本金损失', tone: 'danger', loss: true, requires: 'loss' },
  { label: '效益差淘汰', outcome: '预计盈利', tone: 'warning', loss: false, requires: 'nonnegative' },
  { label: '止盈清仓', outcome: '预计盈利', tone: 'success', loss: false, requires: 'profit' },
];

const rateText = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? new Decimal(value).times(100).toDecimalPlaces(2).toString() + '%' : '待核实';

export function productQuickNotes(book: MonthlyWorkbook, product: Product, balanceText: string) {
  const balance = rawAmount(balanceText);
  const cost = liquidityCost(book, product);
  const xirr = rateText(book.value(product.sheet, 'K' + product.row));
  const twr = rateText(book.value(product.sheet, 'L' + product.row));
  const error = !balance.trim() || !Number.isFinite(Number(balance)) || Number(balance) < 0
    ? '请先填写有效的本期余额，再生成快捷备注。'
    : cost === null ? '缺少有效的累计成本，暂无法计算快捷备注金额。'
      : !product.currency.trim() ? '产品币种缺失，暂无法生成快捷备注。' : '';
  const profit = error ? null : new Decimal(balance).minus(cost!);
  return {
    error,
    options: presets.map(preset => {
      const amount = profit === null ? null : (preset.loss ? profit.negated() : profit).toDecimalPlaces(2);
      const disabledReason = error || (preset.requires === 'loss' && !profit!.lt(0) ? '当前产品没有亏损，不能使用止损清仓。'
        : preset.requires === 'profit' && !profit!.gt(0) ? '当前产品没有盈利，不能使用止盈清仓。'
          : preset.requires === 'nonnegative' && profit!.lt(0) ? '当前产品收益为负，不能使用效益差淘汰。' : '');
      return { label: preset.label, tone: preset.tone, disabledReason, text: amount === null ? null : `${preset.label}，XIRR ${xirr}，TWR ${twr}，${preset.outcome} ${currencyCode(product.currency)} ${formatFixedAmount(amount.isZero() ? '0' : amount.toFixed(2))}。` };
    }),
  };
}
