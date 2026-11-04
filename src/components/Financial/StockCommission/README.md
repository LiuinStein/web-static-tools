# 港美股交易费用

路由：`/#/finance/stock`。港股支持富途香港、uSMART 香港与 ZA Bank；美股另支持 Schwab International 个人账户。一个市场切换控件和一个券商下拉框，按市场记住本次页面会话的券商选择。

## 计算范围

- 富途采用固定式；uSMART 采用个人标准账户常规方案；ZA 不套用 ZA Perks；Schwab 使用 International 上市股票/ETF 线上交易方案，不是嘉信香港账户。
- 支持股票、ETF 的整股数量。一笔买入和一笔卖出，各按一次成交估算。港股 ETF 免股票印花税；不自动套用 uSMART 限时 ETF 优惠。
- 输入买入价、股数和可选卖出价；卖出价留空按买入价，分别计算买卖两边费用。空白、负数、零、无效值或非整数股数不生成结果。无外部行情请求，不代表可成交报价。
- 使用 Decimal，逐项金额四舍五入至分；印花税向上取整到港元，SEC/TAF 向上取分。各项目独立取整后求和。实际多次成交、结算及券商取整可能产生差异。
- 最低费优先于成交金额比例封顶；固定金额上限（如 TAF）另行应用。佣金优惠只作用于被标记为可减免的佣金。
- 回本卖价求解包含卖出时按新成交金额计算的税费及取整，向上保留六位小数；未按证券报价档位取整，可能不是可下单的最小价位。
- ZA 港股可手动指定卖出不足一手，免该侧平台费；应用没有股票代码或每手股数，不能自行判断碎股。
- 不包含融资、换汇、持仓/股息/ADR 特别收费及个别证券的额外税费；不适用 OTC、期权及不足一股的美股订单。

## 费率来源与维护

核对日期：2026-11-04。费率是静态快照，统一位于 `rates.ts`，不从搜索摘要或第三方推广页更新。页面可展开每个费项的计算规则、账户方案、日期和官方来源。

- [富途香港港股收费](https://www.futuhk.com/hans/support/topic2_335?from_platform=1)
- [富途香港美股收费](https://www.futuhk.com/hans/support/topic2_283?from_platform=1)
- [uSMART 香港服务与收费](https://hk.usmartglobal.com/zh-cn/charges)
- [ZA Bank 港股收费](https://bank.za.group/hk/en/faqs/Individuals/Investment_Related/HK_Stock_Trading/68f85039cd872843ca437132)
- [ZA Bank 美股收费](https://bank.za.group/en/faqs/Individuals/Investment_Related/US_Stock_Trading/673c6db49368571c627b50d2)
- [Schwab International 定价](https://international.schwab.com/pricing)
- [Schwab 个人投资者收费指南](https://www.schwab.com/legal/schwab-pricing-guide-for-individual-investors)
- [SEC Section 31，2026-04-04 起每百万美元 20.60 美元](https://www.sec.gov/rules-regulations/fee-rate-advisories/2026-2)
- [FINRA 2026–2029 收费调整](https://www.finra.org/sites/default/files/2024-11/NOF-IMM-EFF-FINRA-2024-019.pdf)

重要差异：uSMART 官网目前将美股 TAF 列为 0，CAT 列有每单最低 0.01 美元；不把富途代收费规则复制到其他券商。ZA 官网要求跟随 SEC/FINRA 最新规则但未列精确取整；Schwab 的 Industry Fee 保留券商酌情调整，两者的监管部分均明确标为参考估算，不把免佣展示成零总费用。

SEC 费率应查 Section 31 交易费公告，不应混用 Section 6(b) 注册申报费。2026 年的 FINRA TAF 每股 0.000195 美元、每笔上限 9.79 美元，2027 年将变更；更新时同时修改核对日期及测试预期。

## 验证

`npm run test:stock` 覆盖全部七种市场/券商组合、买卖侧差异、税费取整、最低费与封顶、ETF、免佣、ZA 碎股卖出、回本价及无效输入。`npm run typecheck` 与 `npm run build` 验证应用集成。
