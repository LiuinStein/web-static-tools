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
| 局部清空操作的气泡确认 | `@/components/ConfirmPopover` |
| 单行预览与长文本展开 | `@/components/ExpandableText` |
| 可排序表头 | `@/components/ToolPage/SortableTableHeader` |
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

市场、币种和工资输入模式等分段选项统一使用 `@/components/SegmentedControl`。默认变体复用股票页港美股切换的灰色底槽、白底蓝字选中项、圆角、间距和交互状态。现有其他外观保持原样；新增规范与检查不得附带迁移现有控件或修改其样式。页面仅负责摆放位置，不复制按钮样式；选项、当前值和业务回调仍由页面提供。

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

## 统一组件规范检查

统一入口为 `npm run check:components`，覆盖复用清单中的全部已登记组件／模板。`npm run typecheck` 和 `npm run build` 先执行此检查，新增违规时停止。

规则登记在 `scripts/component-rules.cjs`，检查实现位于 `scripts/check-components.cjs`。新增公共组件或变体时，同步登记组件入口、合法实现文件、私有样式、公开属性限制和静态检查的边界，并增加测试；不允许用页面白名单掩盖新增违规。

| 规则 ID | 组件／模板 | 自动检查范围 |
| --- | --- | --- |
| `confirm-popover` | ConfirmPopover | 私有样式及 style/className；业务传入可见状态、提示与确认回调 |
| `expandable-text` | ExpandableText | 私有结构样式、受保护的 style/className；业务提供 text/label 与容器宽度 |
| `sortable-header` | SortableTableHeader | 表头按钮私有样式、受保护的 style/className；业务只提供列名、方向与回调 |
| `select` | Select 系列 | 原生 select、库导入及别名/子路径/命名空间/重新导出绕过、右侧留白与箭头属性、私有 CSS/变量 |
| `date-input` | DateInput | 原生日期框、动态 type 和属性展开、组件固定属性、尺寸变体、WebKit 几何样式与变量 |
| `segmented` | SegmentedControl | 业务侧原生 aria-pressed 按钮、私有结构样式和公开变体；正常 radio/checkbox 保留原有语义 |
| `dialog` | ToolDialog | 原生 dialog、组件库 Dialog 绕过、强制布局属性和私有外壳样式；允许弹窗内容定义业务布局 |
| `confirmation` | useToolConfirm | 原生浏览器 confirm（含 window/globalThis 调用）；正常本地回调与 hook 返回的 confirm 放行 |
| `page-header` | PageHeader | 私有 CSS 导入和不支持的样式属性；不把所有 h1 都强行判为通用标题 |
| `tool-template` | 工具页基础模板 | 禁止在业务样式中重新定义共享 tool-page 选择器；公开模板仍可导入 |
| `financial-template` | CalculatorLayout | 金融共享布局选择器的归属；业务专属布局保留在自身类名中 |
| `comparison-table` | FeeComparisonTable | 私有比较表结构类、样式和不支持的外部样式属性；其他用途的普通表格仍可使用 |

`npm run check:components -- --list` 查看当前登记范围及每类规则的检查边界。检查仅报告 Git 差异中的新增或修改行，未跟踪新文件按全部新增处理；历史代码不报错，不维护历史违规清单，不强制迁移现有 UI。

- 默认以 `HEAD` 为比较起点，合并检查暂存、未暂存与未跟踪新文件的最终工作区内容。
- 提交后、分支审查或 CI 使用 `npm run check:components -- --base <提交或分支>` 指定本次变更之前的提交（例如合并基点）；也可设置 `COMPONENT_CHECK_BASE`。干净工作区默认没有新增行，需要指定范围才能检查已提交代码。
- 修改历史文件时，仅检查新增或替换行；其余行不报告。只删除代码不触发违规。
- 可读取既有代码中的导入、组件类名作为判断新增代码的上下文，但历史诊断不会输出或阻止构建。
- 无法获取 Git 差异或比较引用无效时，检查报错，不能静默跳过。
- 仅调整规范与检查时，不得为通过检查修改现有组件样式、交互或布局。既有控件迁移须另行明确安排。

### 不得绕过检查

- 不通过导入别名、组件库子路径、命名空间、重新导出、require、动态导入或 createElement 绕开公共入口。
- 不通过组件私有类名或传入的业务类名改写其按钮、日期内部区域等结构。组件根节点可使用自身业务类做外部宽度、边距等布局，公开 props 和组件变体负责内部变化。
- 不直接导入组件私有 CSS；ToolPage 和 CalculatorLayout 明确公开的模板可以导入。
- 不向 Select 传入无法确认只有布局属性的 style 对象；DateInput、分段选项和弹窗的固定属性按各自公开接口使用。
- 新增变体先在组件中实现，再登记并测试；不得增加逐页豁免或为了让检查通过重命名一套重复实现。

### 验证与边界

运行 `npm run test:components`，验证所有登记规则、正常组合、误报场景和 CLI 退出状态；选择组件原有契约测试继续保留。只改文案、浏览器普通输入框、日期范围选择器、弹窗里的业务内容不应被误拦截。

静态检查能发现**已登记的语法与样式边界**，不能可靠判断任意不同名称、不同结构的控件是否语义重复，也不能验证真实渲染效果。因此，“检查通过”不等于所有规范已经得到证明。是否该扩展已有组件、页面是否重写了同类功能，仍需代码评审；字体居中、宽度溢出、菜单位置、键盘与 Safari 行为仍需下方浏览器回归。

### 功能与视觉回归

迁移或调整组件后，检查 1440px、768px、390px 和 320px 宽度，确认箭头与文字留白、长选项、禁用状态及菜单边界。通过应用内导航切换页面并返回，检查样式加载顺序；覆盖股票、债券、工资、交易日记、月度复盘筛选和弹窗、汇率来源、预设时长。

同时验证附加功能：option/optgroup、富文本与图标、自动补全与自由输入、原事件参数、键盘选择、禁用/必填/提交行为，以及弹窗中的条件字段和联动筛选。不能只核对外观或空页面。无法进入的连接状态应说明验证范围。

组件接口见 [Select 组件说明](../src/components/Select/README.md)，工具页布局见 [共享模板](../src/components/ToolPage/README.md)。
