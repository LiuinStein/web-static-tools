
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

export function ensureRange(num: number, min?: number, max?: number) {
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