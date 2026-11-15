# 工具页共享 CSS 模板

`style.css` 从月度复盘提取，月度复盘是视觉基准。适用页面：月度复盘、税后工资（含裁员补偿）、股票费用、债券收益。

## 接入

1. 在页面样式顶部引入本文件。
2. 页面根节点添加 `tool-page`。
3. 新工具可使用 `tool-heading`、`tool-eyebrow`、`tool-panel`、`tool-fields`、`tool-field`、`tool-columns`、`tool-summary`、`tool-summary-row`。已有 `mr-*`、`salary-*`、`sf-*` 对应结构通过模板的别名选择器接入，无需影响组件状态和计算代码。

模板统一管理色彩变量、标题、按钮、输入框、卡片、表格及移动端断点；下拉框通过 `components/Select` 组件统一管理。页面样式仅负责业务布局、特殊状态和专用控件；不要在各页面重新复制基础样式。股票和债券继续通过 `Financial/CalculatorLayout/style.css` 共用金融专属布局，再由该文件引入基础模板。

普通按钮及其悬停默认样式通过 `:where()` 保持低优先级，让 tab 等专用控件始终优先，避免路由懒加载公共 CSS 的先后顺序改变外观。

新增页面先查阅项目 [组件复用清单](../../../docs/CODING_GUIDELINES.md#现有复用清单)，直接组合现有组件；不得复制基础控件和样式。下拉框、日期框等组件的接入与回归要求以 [编码规范](../../../docs/CODING_GUIDELINES.md) 为准。

## 配置

CSS 变量限定在 `.tool-page` 内，不影响其他页面。可覆写 `--tool-panel-padding` 等明确的布局变量。所有下拉框必须从 `@/components/Select` 导入，组件内部固定管理 12px 箭头间距和 36px 文字留白，页面不再配置间距变量或单独绘制箭头。普通选择、紧凑富文本选择和自动补全分别使用 `Select`、`CompactSelect`、`SelectAutoComplete`，功能与事件保持各自原有约定。组件样式内部引入，弹窗内同样生效；业务样式只负责布局。接口见 [组件说明](../Select/README.md)。

窄屏标题与列布局使用月度复盘的 1050px / 600px 断点；表格可横向滚动。弹窗通过 `ToolDialog` 挂载；弹窗根节点携带 `tool-page tool-dialog`，即使挂到页面外也复用相同的样式变量。月度复盘的 `MonthlyDialog` 只是兼容入口，业务专属的表格列宽、收益图表规则仍留在页面内。


## 对话框与确认框

页面加载 `style.css` 后，从本目录导入 `ToolDialog`。支持 `size="normal" | "wide" | "compact"`，分别用于普通表单、宽表格和简短确认。标题、关闭按钮、输入框、表格、操作区和移动端留白由模板统一管理；关闭回调、Esc、遮罩关闭和缓存选项沿用原有 Dialog 合约。弹窗从首帧通过 CSS 居中，长弹窗在视口内滚动。

使用 `useToolConfirm()` 获取 `confirm` 和 `confirmationDialog`，将后者渲染在页面中。执行修改前先 `await confirm({ title, message, confirmLabel, danger })`；只有返回 `true` 才执行动作。取消、Esc、点击遮罩和页面卸载均返回 `false`，重复调用不会替换正在等待的确认。浏览器自身的关闭页面 / 刷新警告不属于应用内对话框。

股票、债券与工资输入模式的分段切换复用 `SegmentedControl`，下拉框复用 `Select`；金融表单的尺寸、边框和颜色统一放在 `Financial/CalculatorLayout/style.css`，通过 `.financial-calculator` 限定作用域和优先级。左右输入与结果采用独立卡片，列间距和窄屏断点仍使用基础模板。
