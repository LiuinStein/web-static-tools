# 黄金报价换算

汇率默认使用 `Frankfurter`，通过浏览器请求：

`https://api.frankfurter.dev/v2/rates?base=USD&quotes=CNY`

Frankfurter 按日更新，返回最新可用的 USD/CNY 参考汇率；界面显示响应中的实际数据日期，当日尚未发布或休市时不将旧数据标为当天数据。自动模式的汇率只读，可通过刷新图标更新（悬停提示及无障碍名称会提示刷新、重试或加载状态）；请求在 10 秒后超时，失败时提供重试和手动输入，不使用固定汇率兜底。

通过输入框前缀下拉框切换为「手动输入」。首次切换会填入已获取的汇率，之后保留手动值；切回 `Frankfurter` 重新请求。切换或卸载组件会取消请求，迟到响应不会覆盖手动输入。

两种换算共用当前选中的汇率，按 1 金衡盎司 = 31.1034768 克计算，结果保留两位小数。汇率必须大于零，价格允许为零；未填写或无效输入不显示计算结果。

验证：`node tests/gold-converter.test.cjs`、`npm run typecheck`、`npm run build`。

来源选项前的站点图标来自 Frankfurter 官方仓库 `lib/public/favicon.ico`，作为 `public/frankfurter.ico` 随网站打包。
