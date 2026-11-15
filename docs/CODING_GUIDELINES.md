# 编码规范

## 先复用现有组件，再扩展共享能力

新增页面必须优先组合现有公共组件，不能为每个页面另起一套基础控件和样式。以下要求同时适用于人工开发与自动化编码。

### 必须遵循的实现顺序

1. **先查已有实现**：查看 `src/components`、下方复用清单、组件说明及已有调用位置，确认是否已有相同控件。
2. **直接导入复用**：已有组件能满足需求时，直接传入数据、选项、值和事件。不得复制源码到页面目录、换类名重写同功能组件，或重新设计一套基础样式。
3. **在公共组件中扩展**：已有能力不足时，优先增加兼容的 props、变体或组合能力。默认行为保持兼容，并检查已有使用方；不能用页面内样式覆盖绕开公共组件。
4. **新类控件先进入共享层**：只有现有组件无法合理扩展时才新增公共组件，同时补充使用说明和适用场景，再让页面引用。不得先交付页面私有控件，再把通用化留到以后。

页面负责业务数据、计算、状态及组件组合；公共组件负责固定几何、交互状态、响应式和浏览器兼容。共享模板已覆盖的基础样式也必须复用，不在新页面复制主题、断点或控件状态。页面专属布局不能改变公共组件内部的尺寸与对齐约定。

### 现有复用清单

| 需求 | 必须优先使用的现有入口 |
| --- | --- |
| 普通下拉选择 | `@/components/Select` 默认导出 |
| 带图标的紧凑选择 | `@/components/Select` 的 `CompactSelect` |
| 预设与自由输入 | `@/components/Select` 的 `SelectAutoComplete` |
| 原生单日期输入 | [`@/components/DateInput`](../src/components/DateInput/README.md) |
| 市场、币种、输入模式分段选项 | `@/components/SegmentedControl` |
| 工具页弹窗 | `@/components/ToolPage/ToolDialog` |
| 工具页操作确认 | `@/components/ToolPage/useToolConfirm` |
| 通用页面标题 | `@/components/PageHeader` |
| 工具页基础布局、基础输入框与按钮样式 | [`components/ToolPage/style.css`](../src/components/ToolPage/README.md)；当前为共享模板，不是独立输入/按钮组件 |
| 股票、债券专属布局与券商比较表 | `components/Financial/CalculatorLayout` 中的共享样式与 `FeeComparisonTable` |

复用共享模板时，不代表可以跳过已有控件组件。例如日期框仍必须用 `DateInput`，不能仅引入公共 CSS 后直接写一个原生日期框。组件复用清单应随着公共组件新增或调整同步维护。

## 下拉框统一使用组件

业务代码必须使用 `src/components/Select` 提供的组件，不直接实现选择控件或下箭头。页面、筛选栏、可编辑表格和通过 portal 挂载的弹窗执行同一规则。

### 组件入口

| 使用场景 | 固定组件 | 保留的能力 |
| --- | --- | --- |
| 普通下拉选择 | 默认导出的 `Select` | 原生事件、标签、表单提交、受控/非受控值、option/optgroup、disabled、required、ref、键盘操作 |
| 带图标的紧凑选择 | `CompactSelect` | Fusion 富文本选项、图标、dataSource、选中值、原事件参数、菜单和键盘操作；保留汇率来源现有外观 |
| 可自由输入的预设选择 | `SelectAutoComplete` | 原自动补全、预设分组、任意输入、过滤、事件参数和键盘操作；不强制增加下箭头 |

```tsx
import Select, { CompactSelect, SelectAutoComplete } from '@/components/Select';

<Select aria-label="证券类型" value={instrument} onChange={e => setInstrument(e.target.value)}>
  <option value="stock">普通股票</option>
  <option value="etf">ETF</option>
</Select>
```

选项、事件及其参数保留在业务侧，组件只负责公共呈现与交互转发。组件通过 forwardRef 保留对底层控件的引用。`multiple` 或 `size` 大于 1 的原生列表框继续保留其原有行为，不绘制下拉箭头。

### 固定样式

| 项目 | 组件内部规则 |
| --- | --- |
| 箭头距右侧边框 | 12px |
| 文字右侧留白 | 36px |
| 原生下箭头 | 12px × 12px，垂直居中 |
| 紧凑选择器 | 保留原控件配色、尺寸、圆角和小箭头形状，间距统一由组件维护 |
| 页面例外 | 无；工资页与其他页面使用同一组件 |

组件内的固定样式不能由业务 props 覆盖；`style` 仅支持宽度、外边距、flex 和网格位置等布局属性。普通选择器的箭头和右侧留白由组件内联固定，避免页面样式、padding 简写或懒加载顺序将其重置。紧凑选择器的专属样式也封装在组件目录，不再分散到期货工具页面。

业务侧不得另写 `appearance`、箭头背景、定位、伪元素、右侧留白或间距变量。新增外观变体先在公共组件中实现，不在页面增加特例。调整统一间距时，只修改公共组件并同步更新规范。

### 分段选择

市场、币种和工资输入模式等分段选项统一使用 `@/components/SegmentedControl`。组件复用股票页港美股切换的灰色底槽、白底蓝字选中项、圆角、间距和交互状态。页面仅负责摆放位置，不复制按钮样式；选项、当前值和业务回调仍由页面提供。

### 日期输入必须复用 DateInput

新增或修改原生单日期输入时，必须从 `@/components/DateInput` 导入现有组件。组件已包含从交易日记提取的宽度约束与 WebKit 垂直居中处理，债券两个日期框和交易日记日期框共用这一份实现。

```tsx
import DateInput from '@/components/DateInput';

<DateInput
  aria-label="买入交割日"
  value={date}
  onChange={e => setDate(e.target.value)}
  required
/>
```

| 组件配置 | 控件高度 | 内部日期文字区域 |
| --- | --- | --- |
| 默认 `density="regular"` | 42px | 40px |
| `density="responsive"`，桌面 | 34px | 32px |
| `density="responsive"`，手机 | 44px | 42px |

内部日期区域的高度与行高必须随控件高度同步计算，不能只限制外框宽度。现有组件同时管理宽度收缩、垂直居中、原生日期显示区域及日历图标布局。

**禁止在业务页面重新实现或修补这些细节：**

- 不得新写 `<input type="date">`、复制日期组件或另造页面专属日期输入；必须导入已有 `DateInput`。
- 不得在页面重设 `height`、`line-height`、上下 padding、`appearance` 或 `--date-input-height`，也不得复制 `::-webkit-date-and-time-value`、`::-webkit-datetime-edit`、日历图标的伪元素样式。
- 不得通过裁切容器、隐藏溢出或缩放控件掩盖问题。卡片与字段应允许收缩；日期框自身的几何由组件保证。
- 业务侧只提供日期值、标签、限制与回调，保留原生日期选择以及 min/max、required、禁用、value/defaultValue、事件和 ref。不得为了修复样式改变格式、清空日期或绕过校验。
- 需要不同尺寸或新增兼容处理时，扩展现有组件的统一配置，并回归债券工具与交易日记，不增加页面例外。

调整后同时验证两处功能，在 320px、390px、768px、1440px 下检查有值、空值、聚焦、禁用及校验状态：日期文字必须上下居中，外框和内容均不得撑出字段或卡片，日期联动及原计算结果保持正确。涉及 iOS Safari 的修复应进行 Safari 实测；尚未实测时明确说明，不将 Chromium 手机尺寸模拟写成 Safari 验证通过。

组件接口与边界见 [DateInput 说明](../src/components/DateInput/README.md)。

### 下拉组件的自动检查

- `npm run check:selects` 扫描业务代码，禁止原生 `<select>`、直接导入 Fusion Select（含别名与子路径）、通过组件库命名空间或 createElement 创建选择控件等常见绕过方式。
- `npm run typecheck` 和 `npm run build` 自动执行组件检查，违规时停止。
- `npm run test:selects` 验证检查器对正常组件用法的放行，以及对直接实现选择控件的拦截。
- 原生下拉框和 Fusion Select 适配仅允许出现在 `src/components/Select` 内。不要为单个业务页面增加检查白名单。

上述自动检查目前覆盖下拉组件。日期组件及其他公共组件的复用要求由前述规范约束，尚未接入同类自动扫描，不得声称已自动拦截。

### 功能与视觉回归

迁移或调整组件后，检查 1440px、768px、390px 和 320px 宽度，确认箭头与文字留白、长选项、禁用状态及菜单边界。通过应用内导航切换页面并返回，检查样式加载顺序；覆盖股票、债券、工资、交易日记、月度复盘筛选和弹窗、汇率来源、预设时长。

同时验证附加功能：option/optgroup、富文本与图标、自动补全与自由输入、原事件参数、键盘选择、禁用/必填/提交行为，以及弹窗中的条件字段和联动筛选。不能只核对外观或空页面。无法进入的连接状态应说明验证范围。

组件接口见 [Select 组件说明](../src/components/Select/README.md)，工具页布局见 [共享模板](../src/components/ToolPage/README.md)。
