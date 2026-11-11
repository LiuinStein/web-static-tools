export const brackets = [36000, 144000, 300000, 420000, 660000, 960000, Infinity];
export const rates = [.03, .1, .2, .25, .3, .35, .45];
export const deductions = [0, 2520, 16920, 31920, 52920, 85920, 181920];
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export function tax(amount: number, bonus = false) {
  const n = Math.max(0, amount);
  const i = brackets.findIndex(limit => n <= limit);
  return round(Math.max(0, n * rates[i] - deductions[i] / (bonus ? 12 : 1)));
}
export const defaults = { salary: 50000, bonus: 200000, equity: 0, extra: 0, other: 0,
  maxBase: 36348, socialBase: 36348, fundBase: 36348, pension: 8, unemployment: .5, medical: 2, medicalFixed: 3, fund: 12, employerFund: 12 };
export type SalaryInput = typeof defaults;
export function calculate(v: SalaryInput, separateBonus: boolean, separateEquity: boolean) {
  const sb = Math.min(v.maxBase, Math.max(7270, v.socialBase));
  const fb = Math.min(v.maxBase, Math.max(2540, v.fundBase));
  const pension = round(sb * v.pension / 100), unemployment = round(sb * v.unemployment / 100);
  const medical = round(sb * v.medical / 100 + v.medicalFixed);
  const social = round(pension + unemployment + medical);
  const fund = Math.round(fb * v.fund / 100), employerFund = Math.round(fb * v.employerFund / 100);
  const salaryAnnual = v.salary * 12;
  const taxable = Math.max(0, salaryAnnual - 60000 - (social + fund + v.extra + v.other) * 12);
  const combined = Math.max(0, salaryAnnual + (separateBonus ? 0 : v.bonus) + (separateEquity ? 0 : v.equity) - 60000 - (social + fund + v.extra + v.other) * 12);
  const salaryTax = tax(taxable), comprehensiveTax = tax(combined);
  const bonusTax = separateBonus ? tax(v.bonus, true) : tax(Math.max(0, salaryAnnual + v.bonus - 60000 - (social + fund + v.extra + v.other) * 12)) - salaryTax;
  const equityTax = separateEquity ? tax(v.equity) : comprehensiveTax - salaryTax - (separateBonus ? 0 : bonusTax);
  const totalTax = round(comprehensiveTax + (separateBonus ? bonusTax : 0) + (separateEquity ? equityTax : 0));
  const gross = round(salaryAnnual + v.bonus + v.equity);
  const cash = round(gross - totalTax - (social + fund) * 12);
  const fundAnnual = (fund + employerFund) * 12;
  const months = Array.from({ length: 12 }, (_, j) => {
    const m = j + 1;
    const cumulative = tax(Math.max(0, (v.salary - social - fund - v.extra - v.other - 5000) * m));
    const previous = tax(Math.max(0, (v.salary - social - fund - v.extra - v.other - 5000) * j));
    return { month: m, tax: round(cumulative - previous), cash: round(v.salary - social - fund - (cumulative - previous)) };
  });
  return { sb, fb, pension, unemployment, medical, social, fund, employerFund, gross, salaryTax, comprehensiveTax, bonusTax: round(bonusTax), equityTax: round(equityTax), totalTax, cash, fundAnnual, total: round(cash + fundAnnual), months };
}
