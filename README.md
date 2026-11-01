
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
