//#region Common Utils
export function onlyDate(date?: Date | number): Date {
    return new Date(
        (date ? new Date(date) : new Date()).setHours(0, 0, 0, 0)
    )
}


//#region Exchange Fee

/**
 * fee table
 */
export class ExchangeFee {
    category: string       // classify into
    perTrans: boolean      // count once or twice
    chargeBy: string; rate: number; fix: number  // charge by `rate` or `fix`

    // below fields only accept when charged by `rate`
    target?: string        // calculate by `total` price or stock `quantity`, defaults to `total` price
    min?: number; max?: number  // range, only valid when changed by `rate`
    round?: 'up'                // round `up` or round `down`
}

function safeRound(num: number, round?: string) {
    if (round === 'up') {
        return Math.ceil(num);
    }
    if (round === 'down') {
        return Math.round(num);
    }

    return num;
}

function safeMin(a?: number, b?: number) {
    if (typeof a === 'number' && typeof b === 'number') {
        return a < b ? a : b;
    }

    return typeof a === 'number' ? a : b;
}

function safeMax(a?: number, b?: number) {
    if (typeof a === 'number' && typeof b === 'number') {
        return a > b ? a : b;
    }

    return typeof a === 'number' ? a : b;
}

function ensureRange(num: number, min?: number, max?: number) {
    return safeMin(safeMax(num, min), max) || 0;
}

/**
 * Common exchange fee calculator
 */
export function calcualteExchangeFee(unitPrice: number, quantity: number, feeTable: ExchangeFee[]) {
    let result = {};
    const price = unitPrice * quantity;

    for (const fee of feeTable) {
        let charged = 0;

        if (fee.chargeBy === 'rate') {
            charged = ensureRange(safeRound((fee.target === 'quantity' ? quantity : price) * fee.rate, fee.round), fee.min, fee.max);
            charged = fee.perTrans ? charged * 2 : charged;
        } else if (fee.chargeBy === 'fixed') {
            charged = fee.perTrans ? fee.fix * 2 : fee.fix;
        }

        if (!(fee.category in result)) {
            result[fee.category] = { charged: 0, chargedRate: 0 };
        }

        result[fee.category].charged += charged;
        result[fee.category].chargedRate += charged / price;
    }

    return result;
}


//#region Investment Return

/**
 * TWR (Time Weighted Return)
 */
export class TimeWeightedReturnOptions {
    portfolioValues: number[];
    cashFlows: number[];
    annualizationFactor: number;
}

export function calculateTimeWeightedReturn(
    options: TimeWeightedReturnOptions
) {
    const { portfolioValues, cashFlows, annualizationFactor } = options;

    if (portfolioValues.length !== cashFlows.length) {
        throw new Error('Portfolio values and cash flows must have same length');
    }

    if (portfolioValues.length < 2) {
        throw new Error('At least 2 periods required for TWR calculation');
    }

    const periodReturns: number[] = [];

    // Calculate period returns
    for (let i = 1; i < portfolioValues.length; i++) {
        const currentValue = portfolioValues[i];
        const previousValue = portfolioValues[i - 1];
        const cashFlow = cashFlows[i];

        // TWR formula: r_i = (V_i - V_{i-1} - CF_i) / (V_{i-1})
        const numerator = currentValue - previousValue - cashFlow;
        const denominator = previousValue;

        if (denominator <= 0) {
            throw new Error(`Invalid denominator for period ${i}: ${denominator}. Check cash flows.`);
        }

        const periodReturn = numerator / denominator;
        periodReturns.push(periodReturn);
    }

    // Calculate TWR: ∏(1 + r_i) - 1
    const twr = periodReturns.reduce((product, return_) => product * (1 + return_), 1) - 1;

    // Annualize TWR
    const periods = periodReturns.length;
    const annualizedTWR = Math.pow(1 + twr, annualizationFactor / periods) - 1;

    return {
        twr,
        annualizedTWR,
        periods,
        periodReturns,
    };
}

/**
 * XIRR i.e. MWR (Money Weighted Return)
 */
export class MoneyWeightedReturnOptions {
    cashFlows: number[];
    dates: Date[];
    finalValue: number;
    maxIterations?: number;
    tolerance?: number;
    daysOfYear?: number;
}

export function calculateMoneyWeightedReturn(
    options: MoneyWeightedReturnOptions
) {
    const {
        cashFlows,
        dates,
        finalValue,
        maxIterations = 1000,
        tolerance = 1e-8,
        daysOfYear = 365
    } = options;

    if (cashFlows.length !== dates.length) {
        throw new Error('Cash flows and dates must have same length');
    }

    if (cashFlows.length < 2) {
        throw new Error('At least 2 cash flows required for MWR calculation');
    }

    // Create all cash flows including initial and final values
    const allCashFlows: number[] = [];
    const allDates: Date[] = [];

    // Add intermediate cash flows
    for (let i = 0; i < cashFlows.length; i++) {
        allCashFlows.push(cashFlows[i]);
        allDates.push(onlyDate(dates[i]));
    }

    // Add final value as positive cash flow
    allCashFlows.push(finalValue);
    allDates.push(onlyDate(dates[dates.length - 1])); // Use last date for final value

    // Calculate time periods in years from first date
    const startDate = allDates[0];
    const timePeriods: number[] = allDates.map(date => {
        const diffTime = date.getTime() - startDate.getTime();
        return diffTime / (1000 * 60 * 60 * 24 * daysOfYear); // Convert to years
    });

    // Calculate IRR using Newton-Raphson method
    const mwr = calculateIRR(allCashFlows, timePeriods, maxIterations, tolerance);

    // Calculate total time period
    const totalTimeYears = timePeriods[timePeriods.length - 1];

    // Annualize MWR
    const annualizedMWR = Math.pow(1 + mwr, 1 / totalTimeYears) - 1;

    // Calculate NPV at the found rate
    const npv = calculateNPV(allCashFlows, timePeriods, mwr);

    return {
        mwr,
        annualizedMWR,
        cashFlowCount: allCashFlows.length,
        timePeriodYears: totalTimeYears,
        npv
    };
}

/**
 * Calculate Internal Rate of Return using Newton-Raphson method
 */
function calculateIRR(
    cashFlows: number[],
    timePeriods: number[],
    maxIterations: number,
    tolerance: number
): number {
    let rate = 0.1; // Initial guess

    for (let i = 0; i < maxIterations; i++) {
        const npv = calculateNPV(cashFlows, timePeriods, rate);
        const npvDerivative = calculateNPVDerivative(cashFlows, timePeriods, rate);

        if (Math.abs(npv) < tolerance) {
            return rate;
        }

        if (Math.abs(npvDerivative) < tolerance) {
            throw new Error('IRR calculation failed: derivative too small');
        }

        const newRate = rate - npv / npvDerivative;

        // Check for convergence before updating rate
        if (Math.abs(newRate - rate) < tolerance) {
            return newRate;
        }

        // Prevent negative rates that would cause issues
        if (newRate < -0.99) {
            rate = -0.99;
        } else {
            rate = newRate;
        }
    }

    throw new Error(`IRR calculation did not converge after ${maxIterations} iterations`);
}

/**
 * Calculate Net Present Value
 */
function calculateNPV(cashFlows: number[], timePeriods: number[], rate: number): number {
    return cashFlows.reduce((sum, cf, index) => {
        return sum + cf / Math.pow(1 + rate, timePeriods[index]);
    }, 0);
}

/**
 * Calculate derivative of NPV for Newton-Raphson method
 */
function calculateNPVDerivative(cashFlows: number[], timePeriods: number[], rate: number): number {
    return cashFlows.reduce((sum, cf, index) => {
        const time = timePeriods[index];
        return sum - (cf * time) / Math.pow(1 + rate, time + 1);
    }, 0);
}
