const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yaml = require('js-yaml');
const { readConfig, listFiles, deploy } = require('../scripts/deploy-cos.cjs');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-cos-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'js'));
  fs.writeFileSync(path.join(directory, 'index.html'), '<html></html>');
  fs.writeFileSync(path.join(directory, 'js/app.js'), 'console.log(1);');
  return directory;
}

const config = { bucket: 'site-1250000000', region: 'ap-guangzhou', prefix: 'tools' };

test('uploads assets before HTML, preserving keys and browser headers', async (t) => {
  const directory = fixture(t);
  const uploads = [];
  let built = false;
  await deploy(config, {
    directory,
    log() {},
    build() { built = true; },
    createClient() {
      assert.equal(built, true);
      return { uploadFile(params, callback) { uploads.push(params); callback(null); } };
    },
  });
  assert.deepEqual(uploads.map((item) => item.Key), ['tools/js/app.js', 'tools/index.html']);
  assert.equal(uploads[0].Bucket, config.bucket);
  assert.equal(uploads[0].Region, config.region);
  assert.equal(uploads[0].FilePath, path.join(directory, 'js/app.js'));
  assert.match(uploads[0].ContentType, /javascript/);
  assert.equal(uploads[1].ContentType, 'text/html; charset=utf-8');
  assert.equal(uploads[1].CacheControl, 'no-cache');
});

test('dry run builds and lists files without creating a COS client', async (t) => {
  const messages = [];
  await deploy({ ...config, prefix: '' }, {
    directory: fixture(t), dryRun: true, build() {},
    createClient() { assert.fail('must not connect to COS'); },
    log(message) { messages.push(message); },
  });
  assert.equal(messages[0], '[预览] js/app.js');
  assert.equal(messages.length, 3);
});

test('build failure prevents client creation and uploads', async () => {
  await assert.rejects(deploy(config, {
    build() { throw new Error('build failed'); },
    createClient() { assert.fail('must not connect to COS'); },
  }), /build failed/);
});

test('upload failure stops before publishing HTML and hides SDK error details', async (t) => {
  let count = 0;
  await assert.rejects(deploy(config, {
    directory: fixture(t), build() {}, log() {},
    createClient: () => ({ uploadFile(params, callback) {
      count += 1;
      callback(new Error('sensitive signing details'));
    } }),
  }), (error) => {
    assert.match(error.message, /上传失败/);
    assert.doesNotMatch(error.message, /sensitive/);
    return true;
  });
  assert.equal(count, 1);
});

test('validates YAML deploy mapping without exposing credentials', (t) => {
  const filename = path.join(fixture(t), 'config.yaml');
  const write = (value) => fs.writeFileSync(filename, yaml.dump({ deploy: value }));
  write(config);
  assert.throws(() => readConfig(filename, false), /secretId/);
  assert.equal(readConfig(filename, true).prefix, 'tools');
  write({ ...config, prefix: '/tools/' });
  assert.equal(readConfig(filename, true).prefix, 'tools');
  write({ ...config, prefix: '../src' });
  assert.throws(() => readConfig(filename, true), /prefix/);
  write({ ...config, bucket: 'missing-appid' });
  assert.throws(() => readConfig(filename, true), /bucket/);
  fs.writeFileSync(filename, 'secretId: xxx');
  assert.throws(() => readConfig(filename, true), /deploy/);
  write([]);
  assert.throws(() => readConfig(filename, true), /deploy/);
  fs.writeFileSync(filename, 'deploy:\n  secretKey: [sensitive');
  assert.throws(() => readConfig(filename, true), (error) => !error.message.includes('sensitive'));
});

test('reads indented YAML fields, quoted secrets, and comments', (t) => {
  const filename = path.join(fixture(t), 'config.yaml');
  fs.writeFileSync(filename, 'deploy:\n  secretId: xxx\n  secretKey: "key: #value"\n  bucket: site-1250000000 # APPID\n  region: ap-guangzhou\n');
  const result = readConfig(filename, false);
  assert.equal(result.secretId, 'xxx');
  assert.equal(result.secretKey, 'key: #value');
  assert.equal(result.bucket, config.bucket);
  assert.equal(result.prefix, '');
});

test('missing entrypoint or symlinks prevent any upload', async (t) => {
  const directory = fixture(t);
  fs.unlinkSync(path.join(directory, 'index.html'));
  await assert.rejects(deploy(config, {
    directory, build() {}, createClient() { assert.fail('must not connect'); },
  }), /index.html/);
  fs.symlinkSync(__filename, path.join(directory, 'link'));
  assert.throws(() => listFiles(directory), /符号链接/);
});
