# 工具页共享 CSS 模板

`style.css` 从月度复盘提取，月度复盘是视觉基准。适用页面：月度复盘、税后工资（含裁员补偿）、股票费用、债券收益。

## 接入

1. 在页面样式顶部引入本文件。
2. 页面根节点添加 `tool-page`。
3. 新工具可使用 `tool-heading`、`tool-eyebrow`、`tool-panel`、`tool-fields`、`tool-field`、`tool-columns`、`tool-summary`、`tool-summary-row`。已有 `mr-*`、`salary-*`、`sf-*` 对应结构通过模板的别名选择器接入，无需影响组件状态和计算代码。

模板统一管理色彩变量、标题、按钮、输入框、下拉箭头、卡片、表格及移动端断点。页面样式仅负责业务布局、特殊状态和专用控件；不要在各页面重新复制基础样式。股票和债券继续通过 `Financial/CalculatorLayout/style.css` 共用金融专属布局，再由该文件引入基础模板。

## 配置

CSS 变量限定在 `.tool-page` 内，不影响其他页面。可覆写 `--tool-panel-padding` 等明确的布局变量。下拉箭头默认以月度复盘的 `--tool-select-inset: 8px` 为准，工资页保留已指定的 `16px`，文字留白随变量同步。

窄屏标题与列布局使用月度复盘的 1050px / 600px 断点；表格可横向滚动。弹窗通过 `ToolDialog` 挂载；弹窗根节点携带 `tool-page tool-dialog`，即使挂到页面外也复用相同的样式变量。月度复盘的 `MonthlyDialog` 只是兼容入口，业务专属的表格列宽、收益图表规则仍留在页面内。


## 对话框与确认框

页面加载 `style.css` 后，从本目录导入 `ToolDialog`。支持 `size="normal" | "wide" | "compact"`，分别用于普通表单、宽表格和简短确认。标题、关闭按钮、输入框、表格、操作区和移动端留白由模板统一管理；关闭回调、Esc、遮罩关闭和缓存选项沿用原有 Dialog 合约。弹窗从首帧通过 CSS 居中，长弹窗在视口内滚动。

使用 `useToolConfirm()` 获取 `confirm` 和 `confirmationDialog`，将后者渲染在页面中。执行修改前先 `await confirm({ title, message, confirmLabel, danger })`；只有返回 `true` 才执行动作。取消、Esc、点击遮罩和页面卸载均返回 `false`，重复调用不会替换正在等待的确认。浏览器自身的关闭页面 / 刷新警告不属于应用内对话框。
