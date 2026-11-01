import { Scalar } from './formula';

export const isUnavailable = (value: Scalar) => value == null || value === '' || (typeof value === 'string' && /^#?N\/A(?:\s|$)/i.test(value.trim()));
export const displayValue = (value: Scalar) => isUnavailable(value) ? '—' : String(value);
