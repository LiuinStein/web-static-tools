# 共享原生日期输入

`DateInput` 是新增或修改原生单日期输入时的统一入口。直接从 `@/components/DateInput` 导入，禁止在页面复制实现或新增一套日期样式。它提取交易日记的日期居中处理，同时约束输入框宽度，供交易日记与债券计算器复用。

- 默认高度 42px，内部文字区域 40px。
- `density="responsive"`：桌面高度 34px，手机高度 44px，内部文字区域始终为控件高度减去上下边框。
- 保留原生 input[type=date] 的 value/defaultValue、min/max、required、disabled、事件和 ref；不替换日期选择器或业务校验。
- 控件只管理尺寸与对齐；颜色、边框和横向内边距沿用现有表单主题。业务页不再添加日期伪元素补丁。

修改后同时检查债券两个日期框与交易日记日期框，有值、空值和聚焦时均需验证文字居中及宽度不溢出。Chromium 模拟不能替代 iOS Safari 真机验证。

新尺寸或兼容需求先扩展本组件，并回归已有使用方。页面不得覆盖 `--date-input-height`、高度、行高、上下内边距或 WebKit 伪元素。完整约束见 [项目编码规范](../../../docs/CODING_GUIDELINES.md#日期输入必须复用-dateinput)。
