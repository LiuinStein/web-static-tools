# ConfirmPopover

按钮旁的受控确认气泡，复用 Fusion Balloon 的定位、视口适配、外部点击及 Esc 关闭。传入按钮 `children`、`visible`、`onVisibleChange`、`message`、`onConfirm` 和可选 `disabled`。只点击「确认清空」才调用回调，「返回」、外部点击和 Esc 仅关闭。可用于清空备注等局部操作，不使用模态遮罩。状态及保存逻辑由业务负责，组件统一维护气泡布局和确认按钮样式。
