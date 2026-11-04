const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, f);
const { calculateBond, parseBondNumber } = require('../src/components/Financial/BondCalculator/model.ts');
const { bondPlans, supportedBondTypes } = require('../src/components/Financial/BondCalculator/rates.ts');
const base = { currency: 'USD', broker: 'futu', bondType: 'treasury', buyPrice: 98, unitFace: 100, couponRate: 4, faceAmount: 10000, frequency: 2, settlementDate: '2026-01-01', maturityDate: '2027-01-01', otherFees: 0 };
const fee = (result, id) => result.fees.find(item => item.id === id).amount;

test('only researched currency, broker and bond combinations are accepted', () => {
  assert.deepEqual(bondPlans.map(plan => plan.broker), ['futu', 'usmart', 'schwab']);
  assert.ok(bondPlans.every(plan => plan.source.url.startsWith('https://')));
  assert.ok(!supportedBondTypes('HKD', 'futu').includes('treasury'));
  for (const change of [{ broker: 'za' }, { currency: 'EUR' }, { broker: 'schwab', currency: 'HKD' }, { broker: 'usmart', bondType: 'strips' }]) assert.throws(() => calculateBond({ ...base, ...change }));
});

test('Futu calculates whole-position custody, interest and cash flows with explicit settlement dates', () => {
  const r = calculateBond(base);
  assert.equal(r.days, 365); assert.equal(r.notional, 9800);
  assert.equal(fee(r, 'commission'), 8); assert.equal(fee(r, 'platform'), 4); assert.equal(fee(r, 'custody'), 7.84);
  assert.equal(r.interest, 400); assert.equal(r.couponPayment, 200);
  assert.equal(r.buyCash, 9812); assert.equal(r.receipts, 10392.16);
  assert.equal(r.profit, 580.16); assert.equal(r.totalFees, 19.84);
  assert.ok(Math.abs(r.annualizedRate - 580.16 / 9812 * 100) < 1e-10);
  assert.equal(calculateBond({ ...base, faceAmount: 20000 }).fees.find(f => f.id === 'custody').amount, 15.68);
});

test('Futu platform fee floors/caps are currency-specific and commissions vary by bond type', () => {
  for (const [currency, min, max] of [['USD', 2, 15], ['HKD', 16, 120], ['CNH', 15, 110]]) {
    assert.equal(fee(calculateBond({ ...base, currency, bondType: 'sovereign', faceAmount: 1000 }), 'platform'), min);
    assert.equal(fee(calculateBond({ ...base, currency, bondType: 'corporate', faceAmount: 1000000 }), 'platform'), max);
  }
  assert.equal(fee(calculateBond({ ...base, bondType: 'corporate' }), 'commission'), 16);
  assert.equal(fee(calculateBond({ ...base, bondType: 'distressed' }), 'commission'), 36);
});

test('uSMART Treasuries have their own platform floor, no cap and no custody fee', () => {
  const r = calculateBond({ ...base, broker: 'usmart' });
  assert.equal(fee(r, 'commission'), 7); assert.equal(fee(r, 'platform'), 6); assert.equal(fee(r, 'custody'), 0);
  assert.equal(fee(calculateBond({ ...base, broker: 'usmart', faceAmount: 1000000 }), 'platform'), 350);
});

test('uSMART corporate custody uses month ends and a monthly floor, not daily Futu custody', () => {
  const input = { ...base, broker: 'usmart', bondType: 'corporate' };
  const r = calculateBond(input);
  assert.equal(fee(r, 'commission'), 49); assert.equal(fee(r, 'platform'), 0);
  assert.equal(r.custodyMonths, 12); assert.equal(fee(r, 'custody'), 120);
  const noMonthEnd = calculateBond({ ...input, settlementDate: '2026-01-01', maturityDate: '2026-01-31' });
  assert.equal(noMonthEnd.custodyMonths, 0); assert.equal(fee(noMonthEnd, 'custody'), 0);
  const oneMonthEnd = calculateBond({ ...input, settlementDate: '2026-01-31', maturityDate: '2026-02-01' });
  assert.equal(oneMonthEnd.custodyMonths, 1); assert.equal(fee(oneMonthEnd, 'custody'), 10);
  assert.equal(fee(calculateBond({ ...input, faceAmount: 1000000 }), 'custody'), 783.96);
});

test('Schwab ordinary Treasuries are free, while STRIPS and other secondary bonds have per-bond fees', () => {
  const r = calculateBond({ ...base, broker: 'schwab' });
  assert.equal(r.totalFees, 0);
  for (const bondType of ['corporate', 'municipal', 'agency', 'strips']) {
    const input = { ...base, broker: 'schwab', bondType, couponRate: bondType === 'strips' ? 0 : 4 };
    for (const [faceAmount, expected] of [[1000, 10], [10000, 10], [20000, 20], [1000000, 250]]) {
      assert.equal(fee(calculateBond({ ...input, faceAmount }), 'commission'), expected);
    }
    assert.throws(() => calculateBond({ ...input, faceAmount: 1500 }), /1,000/);
  }
  assert.throws(() => calculateBond({ ...base, broker: 'schwab', bondType: 'strips' }), /零息/);
});

test('optional fees lower profit once and coupon frequency changes payments without changing total interest', () => {
  const initial = calculateBond(base), extra = calculateBond({ ...base, otherFees: 100, frequency: 4 });
  assert.equal(extra.profit, 480.16);
  assert.equal(extra.totalFees, 119.84);
  assert.equal(extra.buyCash, initial.buyCash);
  assert.equal(extra.couponPayment, 100); assert.equal(extra.interest, initial.interest);
  const zero = calculateBond({ ...base, couponRate: 0 });
  assert.equal(zero.interest, 0); assert.equal(zero.couponPayment, 0);
  assert.ok(calculateBond({ ...base, buyPrice: 120, couponRate: 0 }).profit < 0);
});

test('dates, leap days, invalid inputs and quote scaling never produce NaN or divide by zero', () => {
  assert.equal(calculateBond({ ...base, settlementDate: '2028-02-28', maturityDate: '2028-03-01' }).days, 2);
  assert.equal(calculateBond({ ...base, unitFace: 1000, buyPrice: 980 }).notional, calculateBond(base).notional);
  for (const text of ['', ' ', '-1', 'Infinity', '1e3', '0x10', 'NaN', '1000000000001']) assert.equal(parseBondNumber(text), null);
  assert.equal(parseBondNumber('0'), null); assert.equal(parseBondNumber('0', true), 0);
  for (const change of [{ buyPrice: 0 }, { unitFace: 0 }, { faceAmount: NaN }, { couponRate: 101 }, { frequency: 0 }, { otherFees: -1 }, { maturityDate: '' }, { maturityDate: '2026-02-30' }, { maturityDate: '2025-01-01' }, { maturityDate: base.settlementDate }, { settlementDate: '2026-1-01' }, { maturityDate: '2200-01-01' }]) assert.throws(() => calculateBond({ ...base, ...change }));
});
