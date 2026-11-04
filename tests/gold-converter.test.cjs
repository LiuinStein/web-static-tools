const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, filename);
};
const { convertPrice, fetchExchangeRate, EXCHANGE_RATE_URL } = require('../src/components/Financial/USDOunceToRMBGram/model.ts');

test('converts both directions using troy ounces and the selected rate', () => {
  assert.equal(convertPrice('2000', '7.2', 'usdToCny'), '462.97');
  assert.equal(convertPrice('450', '7.2', 'cnyToUsd'), '1943.97');
  assert.equal(convertPrice('2000', '7', 'usdToCny'), '450.11');
  assert.equal(convertPrice('0', '7', 'cnyToUsd'), '0.00');
});

test('missing and invalid prices or rates never produce misleading results', () => {
  for (const direction of ['usdToCny', 'cnyToUsd']) {
    for (const rate of ['', ' ', '0', '-1', 'NaN', 'Infinity', 'abc', '0x10']) {
      assert.equal(convertPrice('2000', rate, direction), '');
    }
    for (const price of ['', ' ', '-1', 'abc', 'Infinity']) {
      assert.equal(convertPrice(price, '7.2', direction), '');
    }
  }
});

test('fetches the latest USD/CNY pair and preserves the actual publication date', async t => {
  const signal = new AbortController().signal;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, EXCHANGE_RATE_URL);
    assert.equal(options.signal, signal);
    assert.equal(options.cache, 'no-store');
    return { ok: true, json: async () => [{ base: 'USD', quote: 'CNY', rate: 7.12345, date: '2026-10-30' }] };
  });
  assert.deepEqual(await fetchExchangeRate(signal), { rate: 7.12345, date: '2026-10-30' });
});

test('rejects HTTP errors, malformed responses, wrong pairs and invalid values', async t => {
  let response;
  t.mock.method(globalThis, 'fetch', async () => response);
  response = { ok: false };
  await assert.rejects(fetchExchangeRate(new AbortController().signal));
  const valid = { base: 'USD', quote: 'CNY', rate: 7.1, date: '2026-10-30' };
  for (const data of [null, [], {}, [valid, valid], [{ ...valid, base: 'EUR' }], [{ ...valid, quote: 'USD' }],
    [{ ...valid, rate: 0 }], [{ ...valid, rate: -1 }], [{ ...valid, rate: Infinity }], [{ ...valid, rate: '7.1' }],
    [{ ...valid, date: '2026-02-30' }], [{ ...valid, date: 'yesterday' }]]) {
    response = { ok: true, json: async () => data };
    await assert.rejects(fetchExchangeRate(new AbortController().signal));
  }
});

test('network failure and cancellation propagate to the UI error handler', async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => {
    signal.throwIfAborted();
    throw new TypeError('Network unavailable');
  });
  await assert.rejects(fetchExchangeRate(controller.signal), /Network unavailable/);
  controller.abort();
  await assert.rejects(fetchExchangeRate(controller.signal), { name: 'AbortError' });
});
