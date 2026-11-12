const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, f);
const { plans, getPlan } = require('../src/components/Financial/StockCommission/rates.ts');
const { calculateTrade, calculateRoundTrip, breakEvenPrice, parseTradeNumber } = require('../src/components/Financial/StockCommission/model.ts');
const base = { market: 'HK', broker: 'futu', price: 100, shares: 100, instrument: 'stock' };
const fee = (result, id) => result.lines.find(line => line.id === id).amount;

test('only the requested market/broker combinations are available and each has official sources', () => {
  assert.deepEqual(plans.HK.map(p => p.broker), ['futu', 'usmart', 'za', 'ibkr']);
  assert.deepEqual(plans.US.map(p => p.broker), ['futu', 'usmart', 'za', 'ibkr', 'schwab']);
  assert.throws(() => getPlan('HK', 'schwab'), /不支持/);
  for (const plan of [...plans.HK, ...plans.US]) {
    assert.equal(new Set(plan.rules.map(rule => rule.id)).size, plan.rules.length);
    assert.ok(plan.sources.length); assert.ok(plan.sources.every(s => s.url.startsWith('https://')));
  }
});

test('HK stock example correctly totals each broker plan and current exchange levies', () => {
  for (const [broker, expected] of [['futu', 29.28], ['usmart', 26.28], ['za', 29.28]]) {
    const result = calculateRoundTrip({ ...base, broker });
    assert.equal(result.buy.total, expected); assert.equal(result.sell.total, expected);
    assert.equal(result.total, expected * 2); assert.equal(result.profit, -expected * 2);
    assert.equal(fee(result.buy, 'settlement'), .42);
    assert.equal(fee(result.buy, 'stamp'), 10);
  }
});

test('HK stamp duty uses 0.1% and rounds each side independently to a full dollar', () => {
  const result = calculateRoundTrip({ ...base, price: 12.34 }, 23.45);
  assert.equal(fee(result.buy, 'stamp'), 2);
  assert.equal(fee(result.sell, 'stamp'), 3);
  assert.equal(fee(calculateTrade({ ...base, price: 20.01 }, 'buy'), 'stamp'), 3);
  assert.equal(fee(calculateTrade({ ...base, price: 20 }, 'buy'), 'stamp'), 2);
});

test('HK settlement has no old minimum or maximum and ETF duty is exempt', () => {
  for (const broker of ['futu', 'usmart', 'za']) {
    assert.equal(fee(calculateTrade({ ...base, broker, price: 1, shares: 100 }, 'buy'), 'settlement'), .00);
    assert.equal(fee(calculateTrade({ ...base, broker, shares: 1000000 }, 'buy'), 'settlement'), 4200);
    assert.equal(fee(calculateTrade({ ...base, broker, instrument: 'etf' }, 'buy'), 'stamp'), 0);
  }
});

test('Futu commission waiver preserves platform fees and all third-party charges', () => {
  for (const market of ['HK', 'US']) {
    const normal = calculateTrade({ ...base, market }, 'sell');
    const waived = calculateTrade({ ...base, market, commissionFree: true }, 'sell');
    assert.equal(fee(waived, 'commission'), 0);
    assert.equal(fee(waived, 'platform'), fee(normal, 'platform'));
    assert.equal(waived.thirdPartyFees, normal.thirdPartyFees);
  }
  assert.equal(fee(calculateTrade({ ...base, broker: 'usmart', commissionFree: true }, 'buy'), 'commission'), 3);
});

test('ZA HK odd-lot flag waives only the sell platform fee', () => {
  const normal = calculateRoundTrip({ ...base, broker: 'za' });
  const odd = calculateRoundTrip({ ...base, broker: 'za', oddLotSell: true });
  assert.equal(odd.buy.total, normal.buy.total);
  assert.equal(fee(odd.sell, 'platform'), 0);
  assert.equal(odd.sell.thirdPartyFees, normal.sell.thirdPartyFees);
  assert.equal(fee(calculateTrade({ ...base, oddLotSell: true }, 'sell'), 'platform'), 15);
});

test('US whole-share examples include sell-only SEC/TAF and broker-specific CAT fees', () => {
  for (const [broker, buy, sell] of [['futu', 2.29, 2.52], ['usmart', 2.19, 2.40], ['za', 1.99, 2.22], ['schwab', 0, .23]]) {
    const result = calculateRoundTrip({ ...base, market: 'US', broker });
    assert.equal(result.buy.total, buy, broker); assert.equal(result.sell.total, sell, broker);
    assert.equal(fee(result.buy, 'sec'), 0); assert.equal(fee(result.sell, 'sec'), .21);
    assert.equal(fee(result.buy, 'taf'), 0);
  }
  assert.equal(fee(calculateTrade({ ...base, market: 'US', broker: 'usmart' }, 'sell'), 'taf'), 0);
  assert.equal(fee(calculateTrade({ ...base, market: 'US', broker: 'usmart' }, 'buy'), 'cat'), .01);
});

test('US platform and commission rate caps apply while published minimums take priority', () => {
  const large = { ...base, market: 'US', price: .1, shares: 100000 };
  const futu = calculateTrade(large, 'buy');
  assert.equal(fee(futu, 'commission'), 50); assert.equal(fee(futu, 'platform'), 50);
  assert.equal(fee(calculateTrade({ ...large, broker: 'usmart' }, 'buy'), 'platform'), 100);
  assert.equal(fee(calculateTrade({ ...large, broker: 'za' }, 'buy'), 'platform'), 150);
  for (const [broker, minimum] of [['futu', 1], ['usmart', 1.88], ['za', 1.99]]) {
    assert.equal(fee(calculateTrade({ ...large, price: .001, shares: 1, broker }, 'buy'), 'platform'), minimum);
  }
});

test('uSMART clearing cap and broker-specific minimums apply without sharing Futu defaults', () => {
  const result = calculateTrade({ ...base, market: 'US', broker: 'usmart', price: .01, shares: 1000 }, 'buy');
  assert.equal(fee(result, 'settlement'), .30);
  const hk = calculateTrade({ ...base, broker: 'usmart', price: .01, shares: 1 }, 'buy');
  assert.equal(fee(hk, 'commission'), 0); // No HKD 3 minimum inherited from Futu.
  assert.equal(fee(hk, 'trading'), .01);
  assert.equal(fee(hk, 'sfc'), 0);
});

test('FINRA caps, sell-only charges and low-price reference exemptions are respected', () => {
  for (const broker of ['futu', 'za', 'schwab']) {
    const input = { ...base, market: 'US', broker, shares: 100000 };
    assert.equal(fee(calculateTrade(input, 'sell'), 'taf'), 9.79);
    assert.equal(fee(calculateTrade(input, 'buy'), 'taf'), 0);
  }
  assert.equal(fee(calculateTrade({ ...base, market: 'US', broker: 'za', price: .0001 }, 'sell'), 'taf'), 0);
});

test('break-even covers the actual sell-side tax/fee steps instead of dividing same-price roundtrip cost', () => {
  for (const market of ['HK', 'US']) for (const plan of plans[market]) {
    for (const input of [{ ...base, market, broker: plan.broker }, { ...base, market, broker: plan.broker, price: 12.34, shares: 1 }, { ...base, market, broker: plan.broker, instrument: 'etf', commissionFree: true }]) {
      const breakeven = breakEvenPrice(input);
      assert.ok(Number.isFinite(breakeven), plan.broker);
      assert.ok(calculateRoundTrip(input, breakeven).profit >= -1e-8, `${market}/${plan.broker}`);
      assert.ok(calculateRoundTrip(input, breakeven - .000001).profit < 1e-8, `${market}/${plan.broker} minimum reference`);
    }
  }
  const result = calculateRoundTrip(base);
  const naive = base.price + result.total / base.shares;
  assert.ok(calculateRoundTrip(base, naive).profit < 0);
});

test('different sell prices drive sell fees and cash flows, not buy price', () => {
  const result = calculateRoundTrip(base, 110);
  assert.equal(result.buy.notional, 10000); assert.equal(result.sell.notional, 11000);
  assert.equal(fee(result.sell, 'stamp'), 11);
  assert.equal(result.profit, Number((result.sell.cash - result.buy.cash).toFixed(2)));
});

test('empty, invalid, zero, negative, fractional-share and unsupported inputs never generate NaN results', () => {
  for (const text of ['', ' ', '0', '-1', 'NaN', 'Infinity', '1e3', '0x10', 'abc', '1000000001']) assert.equal(parseTradeNumber(text), null);
  for (const text of ['1.5', '.5', '1.0', '1e3']) assert.equal(parseTradeNumber(text, true), null);
  assert.equal(parseTradeNumber('.25'), .25); assert.equal(parseTradeNumber('100', true), 100);
  for (const change of [{ price: NaN }, { price: 0 }, { price: Infinity }, { shares: .5 }, { shares: 0 }, { shares: 1e10 }, { broker: 'schwab' }, { instrument: 'otc' }, { price: 1e9, shares: 1e9 }]) assert.throws(() => calculateTrade({ ...base, ...change }, 'buy'));
});

test('all fee line sums reconcile with category totals and totals across the full support matrix', () => {
  const Decimal = require('decimal.js');
  for (const market of ['HK', 'US']) for (const plan of plans[market]) for (const side of ['buy', 'sell']) {
    const result = calculateTrade({ ...base, market, broker: plan.broker, price: 89.82, shares: 777 }, side);
    const total = result.lines.reduce((sum, line) => sum.plus(line.amount), new Decimal(0));
    assert.equal(result.total, total.toNumber());
    assert.equal(result.total, new Decimal(result.brokerFees).plus(result.thirdPartyFees).toNumber());
    assert.ok(result.lines.every(line => Number.isFinite(line.amount) && line.amount >= 0));
  }
});


test('IBKR HK fixed includes exchange and clearing, but passes through levies and stamp duty', () => {
  const buy = calculateTrade({ ...base, broker: 'ibkr' }, 'buy');
  assert.equal(fee(buy, 'commission'), 18);
  assert.equal(buy.total, 28.29);
  assert.ok(!buy.lines.some(line => ['trading', 'settlement'].includes(line.id)));
  assert.equal(calculateTrade({ ...base, broker: 'ibkr', instrument: 'etf' }, 'buy').total, 18.29);
  assert.equal(fee(calculateTrade({ ...base, broker: 'ibkr', shares: 1000 }, 'buy'), 'commission'), 80);
});

test('IBKR US fixed uses the minimum, per-share rate and overriding low-value cap', () => {
  const input = { ...base, market: 'US', broker: 'ibkr' };
  const result = calculateRoundTrip(input);
  assert.equal(result.buy.total, 1);
  assert.equal(result.sell.total, 1.23);
  assert.equal(fee(calculateTrade({ ...input, shares: 1000 }, 'buy'), 'commission'), 5);
  assert.equal(fee(calculateTrade({ ...input, price: .20, shares: 10 }, 'buy'), 'commission'), .02);
  assert.equal(fee(calculateTrade({ ...input, commissionFree: true }, 'buy'), 'commission'), 1);
});
