const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, f);
const { encodeBase64, decodeBase64, convertInput } = require('../src/components/Code/CommonEncoder/model.ts');

test('Base64 roundtrips UTF-8 text, Chinese, emoji, empty strings and large inputs', () => {
  for (const value of ['', 'hello', '中文 😀\n换行', '你好'.repeat(100000)]) {
    const encoded = encodeBase64(value);
    assert.equal(encoded, Buffer.from(value, 'utf8').toString('base64'));
    assert.equal(decodeBase64(encoded), value);
  }
});

test('invalid decoder input remains editable, clears stale output and recovers when completed', () => {
  for (const [decoder, invalid, complete, result] of [[decodeURIComponent, '%', '%E4%B8%AD', '中'], [decodeBase64, 'a', 'aGVsbG8=', 'hello'], [decodeBase64, '***', '5Lit5paH', '中文']]) {
    const failed = convertInput(invalid, false, decoder);
    assert.equal(failed.encoded, invalid); assert.equal(failed.raw, ''); assert.ok(failed.error);
    const recovered = convertInput(complete, false, decoder);
    assert.equal(recovered.raw, result); assert.equal(recovered.error, '');
  }
  assert.throws(() => decodeBase64('/w==')); // Invalid UTF-8 must not silently corrupt text.
});

test('encoder failures preserve the source text and clear the old result', () => {
  const failed = convertInput('\uD800', true, encodeURIComponent);
  assert.equal(failed.raw, '\uD800'); assert.equal(failed.encoded, ''); assert.ok(failed.error);
  assert.equal(convertInput('中文', true, encodeURIComponent).encoded, '%E4%B8%AD%E6%96%87');
});
