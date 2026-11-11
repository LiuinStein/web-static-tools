import React, { useState } from 'react';
import { severance } from './severance';
const money = (n: number) => n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export default function SeveranceCalculator({ monthlyAverage }: { monthlyAverage: number }) {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState(() => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()));
  const [mode, setMode] = useState('nm');
  const [extraMonths, setExtraMonths] = useState('1');
  const [average, setAverage] = useState<string | null>(null);
  const [extraBase, setExtraBase] = useState<string | null>(null);
  const [localAverage, setLocalAverage] = useState('12116');
  const minimum = 2540;
  const averageValue = average === null ? Math.round(monthlyAverage * 100) / 100 : Number(average);
  const extraBaseValue = extraBase === null ? Math.round(Number(localAverage) * 3 * 100) / 100 : Number(extraBase);
  const missing = average === '' || (mode === 'nm' && (extraMonths === '' || extraBase === '' || (extraBase === null && localAverage === '')));
  const result = missing ? null : severance(start, end, averageValue, mode === 'nm' ? Number(extraMonths) : 0, mode === 'nm' ? extraBaseValue : 0, localAverage === '' ? null : Number(localAverage), Number(minimum));
  const historic = !!start && start < '2008-01-01';
  const numberField = (label: string, value: string | number, set: (value: string) => void, placeholder?: string) => <label className="salary-field"><span>{label}</span><input type="text" inputMode="decimal" value={value} placeholder={placeholder} onFocus={e => e.currentTarget.select()} onClick={e => e.currentTarget.select()} onChange={e => { if (/^\d*(?:\.\d*)?$/.test(e.target.value)) set(e.target.value); }} /></label>;
  return <section className="salary-section salary-severance"><h2>裁员补偿计算器</h2><p className="salary-help">N 按在本单位的工作年限折算，不是入职年份。按税前金额测算，解除日期视为最后在职日并计入工龄。</p>
    <div className="salary-layout salary-severance-layout"><div className="salary-panel salary-severance-inputs"><h3>补偿信息</h3><div className="salary-fields"><label className="salary-field"><span>入职日期</span><input type="date" value={start} max={end || undefined} onChange={e => setStart(e.target.value)} /></label><label className="salary-field"><span>解除 / 终止日期</span><input type="date" value={end} min={start || undefined} onChange={e => setEnd(e.target.value)} /></label>
    <label className="salary-field salary-field-wide"><span>补偿方案</span><select value={mode} onChange={e => setMode(e.target.value)}><option value="nm">N+M：经济补偿 + 协商额外补偿</option><option value="double">2N：违法解除 / 终止赔偿金</option></select></label>
    {mode === 'nm' && <>{numberField('额外补偿 M（个月）', extraMonths, setExtraMonths)}{numberField('额外补偿每月基数（元）', extraBase === null ? extraBaseValue : extraBase, setExtraBase)}</>}
    {numberField('解除前 12 个月平均应得月工资（元）', average === null ? averageValue : average, setAverage)}
    {numberField('当地上年度职工月平均工资（元，用于三倍封顶）', localAverage, setLocalAverage, '请按解除地、适用年度的经济补偿口径填写')}
    </div><p className="salary-help">平均应得工资暂随上方全年税前收入 ÷ 12 联动，可直接修改；工作不足 12 个月按实际工作月数的平均工资。奖金、津贴、补贴等应得货币收入按实际核对，股权是否计入需结合其性质。当地月平均工资按你提供的 12,116 元作为测算默认值，可调整；请核对解除地与年度适用的经济补偿统计口径。M 的基数默认取该值的三倍（36,348 元），随其联动，可手动修改；这是协商补偿的测算约定。法定代通知金按解除前上一个月工资计算，不统一三倍封顶。</p>
    <button type="button" className="salary-severance-reset" onClick={() => { setAverage(null); setExtraBase(null); }}>恢复工资基数自动联动</button>
    </div><div className="salary-results salary-severance-results">
    {!start || !end ? <p className="salary-notice">请选择入职日期及解除日期，查看补偿测算。</p> : historic ? <p role="alert" className="salary-notice">2008 年以前入职涉及新旧法律衔接、分段计算。本计算器暂不展示该类金额，需结合当地适用规则核算。</p> : !result ? <p role="alert" className="salary-notice">请检查日期先后和工资、月数输入；金额须为非负数，当地平均工资如填写须大于 0。</p> : <div className="salary-severance-result" aria-live="polite"><span>{mode === 'nm' ? 'N+M 补偿合计' : '2N 赔偿金'} · 税前 · {result.verifiedCap ? '已按填写口径核算封顶' : '未封顶参考测算'}</span><strong>¥ {money(mode === 'nm' ? result.negotiated : result.double)}</strong><div className="salary-line"><span>在职 {result.days} 天 · 完整 {result.years} 年 · 工龄折算 N</span><b>{result.n}</b></div><div className="salary-line"><span>适用补偿年限 / 月工资基数</span><b>{result.payableN} / ¥ {money(result.base)}</b></div><div className="salary-line"><span>{mode === 'nm' ? `${result.payableN} × ${money(result.base)} + ${extraMonths} × ${money(extraBaseValue)}` : `2 × ${result.payableN} × ${money(result.base)}`}</span><b>¥ {money(mode === 'nm' ? result.negotiated : result.double)}</b></div>{result.highIncome && <p className="salary-help">月工资超过当地上年度月平均工资三倍，补偿工资按三倍封顶，补偿年限最高 12 年；M 按填写的协商基数另算。</p>}{!result.verifiedCap && <p className="salary-help">尚未填写当地上年度职工月平均工资，未应用三倍工资及高收入者 12 年上限，结果不代表法定应付金额。不得用上方社保最高基数代替经济补偿的封顶依据。</p>}</div>}
    <details className="salary-panel salary-config"><summary>补偿规则与政策依据</summary><ul><li>《劳动合同法》第 47 条：每满一年支付一个月工资；剩余满六个月不足一年计 1，不满六个月计 0.5。高于当地上年度月平均工资三倍时，工资基数三倍封顶，年限最高 12 年；未触发该条件的，不统一套用 12 年上限。</li><li>第 40 条特定解除情形下，未提前 30 日书面通知可额外支付一个月工资；第 41 条经济性裁员并非一律 N+1。M 为协商月数，本页不自动认定其法定性质。</li><li>第 48、87 条：违法解除或终止时，符合支付赔偿金条件的按经济补偿标准二倍计算。2N 不与 N、代通知金自动叠加。</li><li>《实施条例》第 20、25、27 条分别规定代通知金的上月工资基数、赔偿金与经济补偿不重复支付，以及应得月工资和最低工资下限。本页内置北京现行最低月工资 2,540 元作为补偿基数下限（2025 年 9 月起）；其他地区或历史年度需按当地当时标准核算。</li></ul><p className="salary-help">本卡片独立测算，不计入上方全年收入，不包含补偿个税、未休年假、欠薪及特殊保护情形；经济补偿是否发生须结合解除原因与实际协议。</p><div className="salary-severance-sources"><a href="https://www.beijing.gov.cn/zhengce/zhengcefagui/202507/t20250728_4159830.html" target="_blank" rel="noreferrer">北京最低工资标准（2025-09 起）</a><a href="https://www.mohrss.gov.cn/xxgk2020/fdzdgknr/zcfg/fl/202011/t20201102_394622_wap.html" target="_blank" rel="noreferrer">《劳动合同法》</a><a href="https://www.mohrss.gov.cn/xxgk2020/fdzdgknr/zcfg/fg/202011/t20201103_394939_wap.html" target="_blank" rel="noreferrer">《劳动合同法实施条例》</a><a href="https://www.beijing.gov.cn/fuwu/bmfw/sy/jrts/202603/t20260319_4561923.html" target="_blank" rel="noreferrer">北京：N+1 与 2N 解读</a><a href="https://rsj.beijing.gov.cn/xwsl/mtgz/201912/t20191206_920452.html" target="_blank" rel="noreferrer">北京经济补偿封顶统计口径说明</a></div></details>
    </div></div>
  </section>;
}
