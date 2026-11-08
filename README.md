
## Fusion Design Pro - TS

> 使用 TypeScript，包含大量 UI 区块，比如图表、表单等。

## 使用

```bash
# 推荐 Node.js 24.19.0、npm 11.9.0；使用 nvm 时先运行 nvm use
# 首次安装依赖（无需 --legacy-peer-deps）
$ npm install

# 按锁文件重现依赖版本（CI / 全新环境推荐）
$ npm ci

# 启动开发服务，修改后自动刷新
$ npm start  # visit http://localhost:3333

# TypeScript 类型检查
$ npm run typecheck

# 编译生产版本，输出到 build/
$ npm run build
```

安装版本由 `package-lock.json` 固定。国际化已迁移至兼容 React 17 的 react-intl 7；未被页面使用的旧图表、拖拽及工具依赖已清理。React、Fusion 组件库和主题保持原版本，避免改变现有交互和视觉样式。Fusion 的 Field / Validate 配套包固定为现用版本，并将主题包的组件依赖对齐到同一版 Next，避免旧组件被提升到顶层后导致样式导入失败。

[More docs](https://ice.work/docs/guide/about).

## 部署到腾讯云 COS

COS SDK 只作为开发依赖供 Node.js 部署脚本使用，不导入网页源码，不进入前端打包，也不改变页面行为。

1. 安装依赖后，在项目根目录复制 `config.example.yaml` 为 `config.yaml`。
2. 在 `deploy:` 下填写 `secretId`、`secretKey`、`bucket` 和 `region`（使用空格缩进）：

   ```yaml
   deploy:
     secretId: "你的 SecretId"
     secretKey: "你的 SecretKey"
     bucket: "my-site-1250000000"
     region: "ap-guangzhou"
     prefix: ""
   ```

   `bucket` 是带 APPID 的完整存储桶名；`region` 使用地域标识。`prefix` 留空表示部署到桶根目录，也可设置为 `tools` 等子目录名。当前构建使用相对资源路径，子目录部署请通过以 `/` 结尾的网址访问。

3. 执行部署：

   ```bash
   npm run deploy
   ```

   脚本先校验配置，再执行 `npm run build`，成功后递归上传 `build/` 内的文件，保留目录结构并设置 MIME 类型和 `Cache-Control: no-cache`。资源文件先于 HTML 上传；构建或上传失败时命令以非零状态退出。相同对象名会被覆盖，桶中的其他文件和旧资源不会被删除。上传过程不是原子发布，中途失败后可重新执行。

可先预览文件清单（同样会重新构建，但不会连接 COS 或上传文件；预览时可留空密钥）：

```bash
npm run deploy -- --dry-run
```

`config.yaml` 已加入 Git 忽略列表，请保留在项目根目录，不要放入 `src/`、`public/` 或 `build/`。仓库只提交空密钥的示例配置。建议使用权限限定在目标桶/目录的 CAM 子账号密钥；分块上传需要相应的分块上传权限。

请提前在腾讯云控制台为存储桶配置静态网站托管（索引文档为 `index.html`）及适合的读取权限或自定义域名。脚本不修改存储桶权限、网站设置或 CDN 缓存；使用 CDN 时如需立即生效，应另外刷新 CDN 缓存。

## 目录

```md
├── build/                         # 构建产物
├── mock/                          # 本地模拟数据
│   ├── index.[j,t]s
├── public/
│   ├── index.html                 # 应用入口 HTML
│   └── favicon.png                # Favicon
├── src/                           # 源码路径
│   ├── components/                # 自定义业务组件
│   │   └── Guide/
│   │       ├── index.[j,t]sx
│   │       ├── index.module.scss
│   ├── layouts/                   # 布局组件
│   │   └── BasicLayout/
│   │       ├── index.[j,t]sx
│   │       └── index.module.scss
│   ├── pages/                     # 页面
│   │   └── Home/                  # home 页面，约定路由转成小写
│   │       ├── components/        # 页面级自定义业务组件
│   │       ├── models.[j,t]sx     # 页面级数据状态
│   │       ├── index.[j,t]sx      # 页面入口
│   │       └── index.module.scss  # 页面样式文件
│   ├── configs/                   # [可选] 配置文件
│   │   └── menu.[j,t]s            # [可选] 菜单配置
│   ├── models/                    # [可选] 应用级数据状态
│   │   └── user.[j,t]s
│   ├── utils/                     # [可选] 工具库
│   ├── global.scss                # 全局样式
│   ├── routes.[j,t]s              # 路由配置
│   └── app.[j,t]s[x]              # 应用入口脚本
├── build.json                     # 工程配置
├── README.md
├── package.json
├── .editorconfig
├── .eslintignore
├── .eslintrc.[j,t]s
├── .gitignore
├── .stylelintignore
├── .stylelintrc.[j,t]s
├── .gitignore
└── [j,t]sconfig.json
```
