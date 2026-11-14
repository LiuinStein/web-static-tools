const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const COS = require('cos-nodejs-sdk-v5');
const mime = require('mime-types');
const yaml = require('js-yaml');
const { crc64 } = require('crc64-ecma182.js');

const root = path.resolve(__dirname, '..');

function readConfig(filename, dryRun) {
  let config;
  try {
    const document = yaml.load(fs.readFileSync(filename, 'utf8'), { schema: yaml.JSON_SCHEMA });
    config = document && document.deploy;
  } catch {
    throw new Error('无法读取 COS 配置，请复制 config.example.yaml 为 config.yaml 并填写有效 YAML。');
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('COS 配置必须包含 deploy 映射，请将配置字段缩进到 deploy: 下。');
  }
  for (const key of ['bucket', 'region', ...(dryRun ? [] : ['secretId', 'secretKey'])]) {
    if (typeof config[key] !== 'string' || !config[key].trim()) {
      throw new Error(`COS 配置缺少有效的 ${key}。`);
    }
    config[key] = config[key].trim();
  }
  if (!/^[a-z0-9][a-z0-9-]*-\d+$/.test(config.bucket)) {
    throw new Error('bucket 必须是包含 APPID 的完整名称，例如 my-site-1250000000。');
  }
  if (!/^[a-z]+(?:-[a-z0-9]+)+$/.test(config.region)) {
    throw new Error('region 格式无效，例如 ap-guangzhou。');
  }
  if (config.prefix !== undefined && typeof config.prefix !== 'string') {
    throw new Error('prefix 必须是字符串。');
  }
  config.prefix = (config.prefix || '').replace(/^\/+|\/+$/g, '');
  if (config.prefix.includes('\\') || config.prefix.split('/').some((part) => part === '.' || part === '..')) {
    throw new Error('prefix 不允许包含反斜杠、. 或 .. 路径段。');
  }
  return config;
}

function listFiles(directory, relative = '') {
  const files = [];
  for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true })) {
    const name = path.posix.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error('构建产物包含符号链接，已停止部署。');
    if (entry.isDirectory()) files.push(...listFiles(directory, name));
    else if (entry.isFile()) files.push(name);
  }
  return files;
}

async function calculateCrc64(filename) {
  // Keep the unsigned 64-bit value as a decimal string (Number loses precision).
  let checksum = '0';
  for await (const chunk of fs.createReadStream(filename)) {
    checksum = crc64(chunk, checksum);
  }
  return checksum;
}

function getRemoteHeaders(client, params) {
  return new Promise((resolve, reject) => {
    client.headObject(params, (error, data) => {
      if (error) {
        if (error.statusCode === 404) return resolve(null);
        // SDK errors can contain signing details; only show our own message.
        return reject(new Error(`比较失败：${params.Key}，请检查 COS 读取权限、配置和网络。`));
      }
      resolve(Object.fromEntries(Object.entries(data.headers || {}).map(([key, value]) => [key.toLowerCase(), value])));
    });
  });
}

async function deploy(config, { dryRun = false, noCrc = false, build, createClient, log = console.log, directory = path.join(root, 'build') } = {}) {
  // Build must succeed before any upload is attempted.
  build();
  const files = listFiles(directory);
  if (!files.includes('index.html')) throw new Error('build/ 中缺少 index.html，已停止部署。');
  // Publish assets first so new HTML does not reference files that are not uploaded yet.
  files.sort((a, b) => Number(a.endsWith('.html')) - Number(b.endsWith('.html')) || a.localeCompare(b));
  const client = dryRun ? null : createClient(config);
  for (const file of files) {
    const key = [config.prefix, file].filter(Boolean).join('/');
    if (!dryRun) {
      const filename = path.join(directory, file);
      if (!noCrc) {
        const headers = await getRemoteHeaders(client, { Bucket: config.bucket, Region: config.region, Key: key });
        const remoteCrc64 = headers && headers['x-cos-hash-crc64ecma'];
        if (typeof remoteCrc64 === 'string' && /^\d+$/.test(remoteCrc64)
          && headers['content-length'] === String(fs.statSync(filename).size)
          && remoteCrc64 === await calculateCrc64(filename)) {
          log(`[跳过，内容相同] ${key}`);
          continue;
        }
      }
      await new Promise((resolve, reject) => {
        client.uploadFile({
          Bucket: config.bucket,
          Region: config.region,
          Key: key,
          FilePath: filename,
          ContentType: mime.contentType(path.extname(file)) || 'application/octet-stream',
          CacheControl: 'no-cache',
        }, (error) => {
          // Do not print SDK errors: request details can contain credentials/signatures.
          if (error) reject(new Error(`上传失败：${key}，请检查 COS 权限、配置和网络。`));
          else resolve();
        });
      });
    }
    log(`${dryRun ? '[预览]' : '[已上传]'} ${key}`);
  }
}

function parseOptions(args) {
  if (args.some((arg) => !['--dry-run', '--no-crc'].includes(arg))) {
    throw new Error('仅支持 --dry-run 和 --no-crc 参数；全量上传请使用 npm run deploy:full。');
  }
  return { dryRun: args.includes('--dry-run'), noCrc: args.includes('--no-crc') };
}

async function main() {
  const { dryRun, noCrc } = parseOptions(process.argv.slice(2));
  const config = readConfig(path.join(root, 'config.yaml'), dryRun);
  await deploy(config, {
    dryRun,
    noCrc,
    build() {
      const result = spawnSync(process.execPath, [process.env.npm_execpath || require.resolve('npm/bin/npm-cli.js'), 'run', 'build'], {
        cwd: root,
        stdio: 'pipe',
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      });
      if (result.error || result.status !== 0) {
        if (result.stdout) process.stderr.write(result.stdout);
        if (result.stderr) process.stderr.write(result.stderr);
        throw new Error('构建失败，未上传任何文件。');
      }
    },
    createClient: ({ secretId, secretKey }) => new COS({ SecretId: secretId, SecretKey: secretKey, Protocol: 'https:' }),
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { readConfig, listFiles, calculateCrc64, parseOptions, deploy };
