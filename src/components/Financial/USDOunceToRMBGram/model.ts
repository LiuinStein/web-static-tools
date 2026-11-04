export interface ExchangeRate { rate: number; date: string; }

export const EXCHANGE_RATE_URL = 'https://api.frankfurter.dev/v2/rates?base=USD&quotes=CNY';
export const GRAMS_PER_TROY_OUNCE = 31.1034768;

export function isPositiveNumber(value: string, allowZero = false): boolean {
    return /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()) && Number.isFinite(Number(value)) && (allowZero ? Number(value) >= 0 : Number(value) > 0);
}

export async function fetchExchangeRate(signal: AbortSignal): Promise<ExchangeRate> {
    const response = await fetch(EXCHANGE_RATE_URL, { signal, cache: 'no-store' });
    if (!response.ok) throw new Error('汇率请求失败');
    const data = await response.json();
    const row = Array.isArray(data) && data.length === 1 ? data[0] : null;
    if (!row || row.base !== 'USD' || row.quote !== 'CNY' || typeof row.rate !== 'number' || !Number.isFinite(row.rate) || row.rate <= 0 || typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
        throw new Error('汇率数据无效');
    }
    const date = new Date(`${row.date}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== row.date) throw new Error('汇率日期无效');
    return { rate: row.rate, date: row.date };
}

export function convertPrice(price: string, rate: string, direction: 'usdToCny' | 'cnyToUsd'): string {
    if (!isPositiveNumber(price, true) || !isPositiveNumber(rate)) return '';
    const result = direction === 'usdToCny'
        ? Number(price) * Number(rate) / GRAMS_PER_TROY_OUNCE
        : Number(price) * GRAMS_PER_TROY_OUNCE / Number(rate);
    return Number.isFinite(result) ? result.toFixed(2) : '';
}
