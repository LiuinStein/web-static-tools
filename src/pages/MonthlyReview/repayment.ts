import { isoDate, serialDate } from './formula';
import type { Scalar } from './formula';
export interface RepaymentSchedule { day: number; months: number; }
export interface RepaymentForm { mode: 'recurring' | 'once' | 'none' | 'legacy'; day: string; months: string; original: string; customInterval: boolean; date: string; originalDate: string; }
function validSchedule(day: number, months: number): boolean {
  return Number.isInteger(day) && day >= 1 && day <= 31 && Number.isSafeInteger(months) && months >= 1;
}
export function parseRepayment(value: Scalar): RepaymentSchedule | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/g, ' ');
  const english = text.match(/^(\d{1,2})(?:st|nd|rd|th)? Day Every (.+)$/i);
  if (english) {
    const interval = english[2].toLowerCase();
    const numeric = interval.match(/^(\d+) months?$/);
    const months = numeric ? Number(numeric[1]) : ({ month: 1, 'other month': 2, 'two months': 2, quarter: 3, year: 12 }[interval] || 0);
    const day = Number(english[1]);
    return validSchedule(day, months) ? { day, months } : null;
  }
  const chinese = text.replace(/^每双月/, '每2个月').replace(/^每季度/, '每3个月').replace(/^每半年/, '每6个月').replace(/^每年/, '每12个月').match(/^每(?:(\d+)个?)?月(\d{1,2})[日号]$/);
  if (chinese) {
    const day = Number(chinese[2]), months = Number(chinese[1] || 1);
    return validSchedule(day, months) ? { day, months } : null;
  }
  return null;
}
export function repaymentDate(value: Scalar): string {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 1 && value <= 2958465 ? isoDate(value) : '';
  if (typeof value !== 'string') return '';
  const match = value.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!match) return '';
  const date = match[1] + '-' + match[2].padStart(2, '0') + '-' + match[3].padStart(2, '0');
  try { serialDate(date); return date; } catch { return ''; }
}
export function repaymentForm(value: Scalar): RepaymentForm {
  const parsed = parseRepayment(value), date = repaymentDate(value);
  return { mode: date ? 'once' : parsed || value == null || String(value).trim() === '' ? 'recurring' : 'legacy', day: parsed ? String(parsed.day) : '', months: parsed ? String(parsed.months) : '1', original: String(value ?? ''), customInterval: parsed ? ![1, 2, 3, 6, 12].includes(parsed.months) : false, date, originalDate: date };
}
export function encodeRepayment(form: RepaymentForm): string {
  if (form.mode === 'none') return '';
  if (form.mode === 'legacy') return form.original;
  if (form.mode === 'once') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date) || repaymentDate(form.date) !== form.date) throw new Error('请选择有效的一次性还清日期');
    return form.original && form.originalDate === form.date ? form.original : form.date;
  }
  if (!form.day.trim()) return '';
  if (!/^\d+$/.test(form.day.trim()) || !/^\d+$/.test(form.months.trim())) throw new Error('还款日须为 1–31 的整数，月份间隔须为正整数');
  const day = Number(form.day), months = Number(form.months);
  if (!validSchedule(day, months)) throw new Error('还款日须为 1–31 的整数，月份间隔须为正整数');
  const suffix = day % 100 >= 11 && day % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] || 'th');
  return day + suffix + ' Day Every ' + (months === 1 ? 'Month' : months + ' Months');
}
export const liabilityGrowthClass = (value: number) => Number.isFinite(value) && value > 0 ? 'mr-debt-increase' : Number.isFinite(value) && value < 0 ? 'mr-debt-decrease' : undefined;
