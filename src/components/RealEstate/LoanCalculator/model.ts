export type LoanMode = 'fund' | 'commercial' | 'combined';
export type DownPaymentMode = 'rate' | 'amount';
export type RepaymentMode = 'equalPrincipalAndInterest' | 'equalPrincipal';

export interface LoanInputs {
  purchasePrice: number;
  valuation: number;
  downPaymentMode: DownPaymentMode;
  downPaymentRate: number;
  downPaymentAmount: number;
  years: number;
  mode: LoanMode;
  fundRate: number;
  commercialRate: number;
  fundAmount: number;
  fundPolicyLimit: number;
  contributionYears: number;
  repaymentMode: RepaymentMode;
}

export interface LoanResult {
  purchaseValue: number;
  downPayment: number;
  loanAmount: number;
  fundAmount: number;
  commercialAmount: number;
  monthlyPayment: number;
  principal: number;
  interest: number;
  totalPayment: number;
  monthlyDecrease: number;
  valid: boolean;
}

export function monthlyPayment(principal: number, annualRate: number, months: number): number {
  if (principal <= 0 || months <= 0) return 0;
  if (annualRate <= 0) return principal / months;
  const monthlyRate = annualRate / 100 / 12;
  const factor = (1 + monthlyRate) ** months;
  return principal * monthlyRate * factor / (factor - 1);
}

export function calculateLoan(input: LoanInputs): LoanResult {
  const purchaseValue = input.purchasePrice > 0
    ? Math.min(input.purchasePrice, input.valuation > 0 ? input.valuation : input.purchasePrice)
    : 0;
  const downPayment = input.downPaymentMode === 'rate'
    ? purchaseValue * input.downPaymentRate / 100
    : input.downPaymentAmount;
  const loanAmount = purchaseValue > 0 ? Math.max(0, purchaseValue - downPayment) : 0;
  const valid = purchaseValue > 0
    && (input.downPaymentMode !== 'rate' || input.downPaymentRate >= 15)
    && downPayment >= input.purchasePrice * 0.15
    && downPayment < purchaseValue
    && input.years > 0
    && input.fundRate >= 0
    && input.commercialRate >= 0
    && (input.mode !== 'combined'
      || (input.fundAmount >= 0
        && input.fundAmount <= loanAmount
        && input.fundAmount <= input.fundPolicyLimit));

  const fundAmount = input.mode === 'fund'
    ? loanAmount
    : input.mode === 'combined'
      ? Math.min(input.fundAmount, loanAmount)
      : 0;
  const commercialAmount = input.mode === 'commercial'
    ? loanAmount
    : input.mode === 'combined'
      ? loanAmount - fundAmount
      : 0;
  const months = input.years * 12;
  let monthly = 0;
  let interest = 0;
  let monthlyDecrease = 0;
  if (input.repaymentMode === 'equalPrincipalAndInterest') {
    monthly = monthlyPayment(fundAmount, input.fundRate, months)
      + monthlyPayment(commercialAmount, input.commercialRate, months);
    interest = monthly * months - loanAmount;
  } else {
    const firstMonthPayment = (principal: number, annualRate: number) => {
      if (principal <= 0 || months <= 0) return 0;
      const monthlyRate = annualRate / 100 / 12;
      return principal / months + principal * monthlyRate;
    };
    monthly = firstMonthPayment(fundAmount, input.fundRate)
      + firstMonthPayment(commercialAmount, input.commercialRate);
    const principalInterest = (principal: number, annualRate: number) => {
      if (principal <= 0 || months <= 0) return 0;
      const monthlyRate = annualRate / 100 / 12;
      return principal * monthlyRate * (months + 1) / 2;
    };
    interest = principalInterest(fundAmount, input.fundRate)
      + principalInterest(commercialAmount, input.commercialRate);
    monthlyDecrease = (fundAmount / months) * input.fundRate / 100 / 12
      + (commercialAmount / months) * input.commercialRate / 100 / 12;
  }

  return {
    purchaseValue,
    downPayment,
    loanAmount,
    fundAmount,
    commercialAmount,
    monthlyPayment: monthly,
    principal: loanAmount,
    interest: Math.max(0, interest),
    totalPayment: loanAmount + Math.max(0, interest),
    monthlyDecrease,
    valid,
  };
}
