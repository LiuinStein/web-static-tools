# 通用下拉组件

业务侧统一从 `@/components/Select` 导入，禁止直接写原生 select 或导入 Fusion Select。类型检查及生产构建会运行 `scripts/check-select-components.cjs` 检查这一边界。

- 默认 `Select`：保留原生 select 的全部业务属性、option/optgroup 子节点、原生 onChange 事件和 HTMLSelectElement ref。无需额外包装层，已有 label、CSS 布局和表单提交继续生效。
- `CompactSelect`：转发 Fusion Select 的业务属性与 ref，内部管理紧凑附加控件外观及箭头；保留 dataSource 的图标、React 节点和多参数事件。
- `SelectAutoComplete`：转发原 AutoComplete 的输入、预设、过滤及 ref，不将可输入控件替换为普通单选框。

`style` 仅开放布局属性。箭头距右侧 12px、文字留白 36px 由组件固定管理，页面不得覆盖。原生 multiple 和列表框不绘制下箭头。

共享样式在组件内部引入，不再依赖全局 select 选择器。修改几何参数、增加变体或升级底层库后，执行 `npm run test:selects`、`npm run typecheck`、`npm run build`，并按项目编码规范验证附加功能、移动端和跨页面切换。
