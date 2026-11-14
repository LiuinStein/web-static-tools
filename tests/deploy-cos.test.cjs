const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yaml = require('js-yaml');
const { readConfig, listFiles, calculateCrc64, deploy } = require('../scripts/deploy-cos.cjs');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-cos-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'js'));
  fs.writeFileSync(path.join(directory, 'index.html'), '<html></html>');
  fs.writeFileSync(path.join(directory, 'js/app.js'), 'console.log(1);');
  return directory;
}

const config = { bucket: 'site-1250000000', region: 'ap-guangzhou', prefix: 'tools' };

test('CRC64 uses COS-compatible decimal values, including empty and streamed files', async (t) => {
  const filename = path.join(fixture(t), 'checksum');
  fs.writeFileSync(filename, '123456789');
  assert.equal(await calculateCrc64(filename), '11051210869376104954');
  fs.writeFileSync(filename, '');
  assert.equal(await calculateCrc64(filename), '0');
  const data = Buffer.alloc(150000, '123456789');
  fs.writeFileSync(filename, data);
  // A multi-chunk stream must produce the same value as a single buffer.
  assert.equal(await calculateCrc64(filename), require('crc64-ecma182.js').crc64(data));
});

test('repeated deployments skip unchanged objects and upload only edited content', async (t) => {
  const directory = fixture(t);
  fs.writeFileSync(path.join(directory, 'empty.txt'), '');
  const remote = new Map();
  const uploaded = [];
  const messages = [];
  const client = {
    headObject(params, callback) {
      if (remote.has(params.Key)) callback(null, { headers: remote.get(params.Key) });
      else callback({ statusCode: 404 });
    },
    uploadFile(params, callback) {
      uploaded.push(params.Key);
      calculateCrc64(params.FilePath).then((checksum) => {
        remote.set(params.Key, {
          'X-Cos-Hash-Crc64ecma': checksum,
          'Content-Length': String(fs.statSync(params.FilePath).size),
          ETag: '"multipart-etag-3"',
        });
        callback(null);
      }, callback);
    },
  };
  const options = { directory, build() {}, createClient: () => client, log: (message) => messages.push(message) };
  await deploy(config, options);
  assert.equal(uploaded.length, 3);
  uploaded.length = 0;
  await deploy(config, options);
  assert.deepEqual(uploaded, []);
  assert.match(messages.at(-1), /已上传 0 个文件，跳过 3 个/);
  assert.ok(messages.includes('[跳过，内容未变] tools/empty.txt'));
  // Same-size edit must be detected by CRC64, not only length or mtime.
  fs.writeFileSync(path.join(directory, 'js/app.js'), 'console.log(2);');
  await deploy(config, options);
  assert.deepEqual(uploaded, ['tools/js/app.js']);
  assert.match(messages.at(-1), /已上传 1 个文件，跳过 2 个/);
});

test('objects without usable CRC64 or with inconsistent size are uploaded', async (t) => {
  const directory = fixture(t);
  for (const mode of ['missing', 'invalid', 'size']) {
    const uploaded = [];
    await deploy(config, {
      directory, build() {}, log() {},
      createClient: () => ({
        headObject(params, callback) {
          const filename = path.join(directory, params.Key.slice('tools/'.length));
          calculateCrc64(filename).then((checksum) => callback(null, { headers: {
            'x-cos-hash-crc64ecma': mode === 'missing' ? undefined : mode === 'invalid' ? 'not-a-crc64' : checksum,
            'content-length': mode === 'size' ? '99999' : String(fs.statSync(filename).size),
          } }), callback);
        },
        uploadFile(params, callback) { uploaded.push(params.Key); callback(null); },
      }),
    });
    assert.deepEqual(uploaded, ['tools/js/app.js', 'tools/index.html'], mode);
  }
});

test('HEAD permission and network errors stop deployment without exposing SDK details', async (t) => {
  for (const statusCode of [403, 500, undefined]) {
    await assert.rejects(deploy(config, {
      directory: fixture(t), build() {}, log() {},
      createClient: () => ({
        headObject(params, callback) { callback({ statusCode, message: 'sensitive signature' }); },
        uploadFile() { assert.fail('must not upload after HEAD failure'); },
      }),
    }), (error) => {
      assert.match(error.message, /比较失败：tools\/js\/app.js/);
      assert.doesNotMatch(error.message, /sensitive/);
      return true;
    });
  }
});

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
      return {
        headObject(params, callback) {
          assert.equal(params.Bucket, config.bucket);
          assert.equal(params.Region, config.region);
          callback({ statusCode: 404 });
        },
        uploadFile(params, callback) { uploads.push(params); callback(null); },
      };
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
    createClient: () => ({ headObject(params, callback) { callback({ statusCode: 404 }); }, uploadFile(params, callback) {
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
