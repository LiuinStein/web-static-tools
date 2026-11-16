# 分段选择

统一从 `@/components/SegmentedControl` 导入，传入 `options`、`value`、`onChange` 和 `aria-label`；支持禁用选项、富文本标签及键盘聚焦。

默认 `variant="default"` 使用等宽按钮，空间不足时允许标签换行。短标签长度不一致且需保持单行时使用 `variant="content"`：按钮按文字宽度分配空间，控件不被父级 flex 压缩，文字保持单行。仅用于标签总宽度能够放入容器的场景。

尺寸、内边距与换行由组件维护，业务页面不覆盖按钮样式。`className` 用于页面摆放控件。
