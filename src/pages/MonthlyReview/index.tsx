import React, { useEffect, useRef, useState } from 'react';
import { Dialog } from '@alifd/next';
import PageHeader from '@/components/PageHeader';
import { monthlyOneDriveConfig } from './config';
import { MonthlyWorkbook, Product, Transaction } from './workbook';
import { Scalar, isoDate, serialDate } from './formula';
import { MonthlyDrive, DriveFile } from './onedrive';
import { Draft, listDrafts, saveDraft } from './storage';
import './style.css';

const money = (n: Scalar) => typeof n === 'number' ? n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
const pct = (n: Scalar) => typeof n === 'number' ? `${(n * 100).toFixed(2)}%` : n ? String(n).replace('Check inputs', '待核实').replace('Check date', '日期待核实').replace('Sale date?', '缺少卖出日期').replace('No transactions', '尚未登记交易') : '—';
const categoryNames: Record<string, string> = { 'Current Account': '活期账户', 'Monetary Fund': '货币基金', 'Debt Fund': '债券 / 理财', 'Time Deposit': '定期存款', 'Equity Fund': '权益基金', Stock: '股票' };
const readConfig = () => {
  try {
    const saved = JSON.parse(localStorage.getItem('monthly-review:settings') || 'null');
    return {
      clientId: typeof saved?.clientId === 'string' ? saved.clientId : monthlyOneDriveConfig.clientId,
      folder: typeof saved?.folder === 'string' ? saved.folder : monthlyOneDriveConfig.folder,
    };
  } catch { return { ...monthlyOneDriveConfig }; }
};
const blankProduct = { name: '', account: '', balance: '0', previous: '0', flow: '0', due: '', note: '' };
const fileId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function MonthlyReview() {
  const [book, setBook] = useState<MonthlyWorkbook | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [tab, setTab] = useState('总览');
  const [query, setQuery] = useState('');
  const [member, setMember] = useState('全部');
  const [currency, setCurrency] = useState('全部');
  const [config, setConfig] = useState(readConfig);
  const [drive, setDrive] = useState<MonthlyDrive | null>(null);
  const [scope, setScope] = useState('');
  const [account, setAccount] = useState('');
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [settings, setSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState<null | 'product' | 'transactions' | 'newMonth'>(null);
  const [selected, setSelected] = useState<Product | null>(null);
  const [anchorKey, setAnchorKey] = useState('');
  const [productForm, setProductForm] = useState(blankProduct);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [newDate, setNewDate] = useState('');
  const [finance, setFinance] = useState({ date: '', usd: '', hkd: '', salary: '', wthSalary: '' });
  const input = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; listDrafts().then(setDrafts).catch(e => setError(`无法读取本机草稿：${e.message}`)); return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!book) return;
    setFinance({ date: isoDate(book.value('Assets', 'L1')), usd: String(book.value('Assets', 'D61') || ''), hkd: String(book.value('Assets', 'D81') || ''), salary: String(book.value('Analyze', 'C5') || 0), wthSalary: String(book.value('Analyze', 'I5') || 0) });
  }, [book]);
  async function run(action: () => Promise<void>) {
    if (lock.current) return; lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (e) { if (mounted.current) setError(e.message || '操作失败，请重试'); } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function activate(data: Uint8Array, name: string, metadata?: Partial<Draft>) {
    const opened = await MonthlyWorkbook.open(data);
    const entry: Draft = { id: fileId(), name, data, updated: new Date().toISOString(), ...metadata };
    await saveDraft(entry); setDrafts(await listDrafts()); setBook(opened); setDraft(entry); setModal(null);
  }
  async function mutate(action: (next: MonthlyWorkbook) => void) {
    if (!book || !draft) return;
    // Apply to a copy; a rejected operation leaves both the visible workbook and saved draft intact.
    const next = await MonthlyWorkbook.open(draft.data); action(next);
    const data = await next.export(); const updated = { ...draft, data, updated: new Date().toISOString(), published: undefined };
    await saveDraft(updated); setBook(next); setDraft(updated); setDrafts(await listDrafts()); setNotice('已保存本机草稿，页面结果已更新。');
  }
  const products = book?.products() || [];
  const filtered = products.filter(p => (member === '全部' || p.member === member) && (currency === '全部' || p.currency === currency) && `${p.name} ${p.account} ${p.category} ${p.note}`.toLowerCase().includes(query.toLowerCase()));
  const val = (s: string, a: string) => book?.value(s, a) ?? null;
  const groups = products.reduce<Record<string, number>>((out, p) => { const rate = p.currency === 'USD' ? Number(val('Assets', 'D61')) : p.currency === 'HKD' ? Number(val('Assets', 'D81')) : 1; out[p.category] = (out[p.category] || 0) + p.balance * rate; return out; }, {});
  const issues = products.filter(p => ['K', 'L', 'M'].some(c => { const v = val(p.sheet, `${c}${p.row}`); return typeof v === 'string' && v !== 'N/A' && v !== ''; }));
  const savedStatus = draft?.published ? `已发布 · ${new Date(draft.published).toLocaleString('zh-CN')}` : '草稿仅保存在当前浏览器';
  function editProduct(p: Product) { setSelected(p); setProductForm({ name: p.name, account: p.account, balance: String(p.balance), previous: String(p.previous), flow: String(p.flow ?? 0), due: p.due, note: p.note }); setModal('product'); }
  async function connect() {
    const service = new MonthlyDrive(config.clientId, config.folder); const user = await service.connect();
    const key = `${config.clientId}:${user.homeAccountId}:${service.folder}`;
    const listed = await service.list(); setDrive(service); setFiles(listed); setAccount(user.username || user.name || 'Microsoft 账户'); setScope(key);
    localStorage.setItem('monthly-review:settings', JSON.stringify(config)); setSettings(false); setNotice('OneDrive 已连接。选择文件打开，或发布当前本机草稿。');
  }
  async function publish() {
    if (!drive || !book || !draft) return;
    if (draft.scope && draft.scope !== scope) throw new Error('此账本来自其他账户或文件夹，请连接原账户和文件夹后发布');
    if (!window.confirm(`将“${draft.name}”发布到 ${account} 的 /${drive.folder}/。${draft.source ? '更新原文件。' : '创建新文件；同名文件不会被覆盖。'}`)) return;
    const data = await book.export(); const result = await drive.publish(draft.name, data, draft.source);
    const updated = { ...draft, data, source: result, scope, published: new Date().toISOString() };
    // Publication is already successful even if refreshing the folder or persisting cache fails.
    setDraft(updated); setNotice('已发布到 OneDrive。');
    try { await saveDraft(updated); setDrafts(await listDrafts()); setFiles(await drive.list()); } catch (e) { setError(`文件已发布，但刷新本机缓存失败：${e.message}`); }
  }
  const field = (label: string, value: string, onChange: (v: string) => void, type = 'text') => <label className="mr-field"><span>{label}</span><input type={type} value={value} onChange={e => onChange(e.target.value)} step="any" /></label>;
  return <div className="monthly-review" aria-busy={busy}>
    <PageHeader title="月度复盘" />
    <div className="mr-title"><div><span className="mr-eyebrow">MONTHLY REVIEW</span><h1>把账记清，把变化看明白。</h1><p>每月一份账本，记录资产、现金流与投资收益。</p></div><span className={`mr-status ${draft?.published ? 'synced' : ''}`}>{busy ? '正在处理…' : book ? savedStatus : '等待导入账本'}</span></div>
    <input ref={input} type="file" accept=".xlsx" hidden onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) run(async () => { await activate(new Uint8Array(await file.arrayBuffer()), file.name); setNotice('已导入并保存在本机，尚未发布到 OneDrive。'); }); }} />
    <div className="mr-toolbar">
      <div className="mr-toolbar-group"><button disabled={busy} onClick={() => input.current?.click()}>导入 Excel</button><select aria-label="打开本机账本" disabled={busy} value={draft?.id || ''} onChange={e => { const d = drafts.find(x => x.id === e.target.value); if (d) run(async () => { const opened = await MonthlyWorkbook.open(d.data); setBook(opened); setDraft(d); }); }}><option value="">本机账本</option>{drafts.map(d => <option key={d.id} value={d.id}>{d.name} · {new Date(d.updated).toLocaleDateString('zh-CN')}</option>)}</select><button disabled={busy || !book} onClick={() => { const date = isoDate(val('Assets', 'L1')); const next = new Date(`${date}T00:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1, 1); setNewDate(next.toISOString().slice(0, 10)); setModal('newMonth'); }}>＋ 新建月份</button></div>
      <div className="mr-toolbar-group"><button disabled={busy || !book} onClick={() => run(async () => { if (!book || !draft) return; const data = await book.export(); const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); const a = document.createElement('a'); a.href = url; a.download = draft.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice('Excel 已生成，包含原有公式及当前计算结果。'); })}>↓ 下载 Excel</button><button className="primary" disabled={busy || !book || !drive} onClick={() => run(publish)}>发布到 OneDrive</button><button disabled={busy} onClick={() => setSettings(!settings)}>同步设置</button></div>
    </div>
    {error && <div className="mr-message error" role="alert">{error}</div>}{notice && <div className="mr-message" role="status">{notice}</div>}
    {settings && <section className="mr-panel"><h2>OneDrive 连接</h2><p>默认与交易日记使用相同的 Microsoft 应用和账本目录，可独立配置。请在 Entra 中注册当前站点的重定向网址，并授予 Files.ReadWrite 权限。</p><div className="mr-grid">{field('应用客户端 ID', config.clientId, v => setConfig({ ...config, clientId: v }))}{field('账本文件夹', config.folder, v => setConfig({ ...config, folder: v }))}</div><div className="mr-actions"><button disabled={busy} onClick={() => setConfig({ ...monthlyOneDriveConfig })}>恢复默认配置</button><button className="primary" disabled={busy} onClick={() => run(connect)}>{drive ? '重新连接' : '连接 OneDrive'}</button>{drive && <button disabled={busy} onClick={() => run(async () => { await drive.disconnect(); setDrive(null); setFiles([]); setScope(''); setAccount(''); })}>断开连接</button>}</div></section>}
    {drive && <div className="mr-cloud"><span>● {account} · /{drive.folder}/</span><select aria-label="打开 OneDrive Excel" disabled={busy} value="" onChange={e => { const file = files.find(f => f.id === e.target.value); if (file) run(async () => { const result = await drive.download(file); await activate(new Uint8Array(result.data), result.file.name, { source: result.file, scope, published: new Date().toISOString() }); }); }}><option value="">选择云端 Excel…</option>{files.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select><button disabled={busy} onClick={() => run(async () => setFiles(await drive.list()))}>刷新文件</button></div>}
    {!book ? <section className="mr-empty"><div className="mr-empty-icon">月</div><h2>从你现有的月度 Excel 开始</h2><p>导入原模板账本，即可管理产品、记录买卖，并实时查看收益。<br />账本保存在当前浏览器，只有点击发布才会上传。</p><button className="primary" disabled={busy} onClick={() => setSettings(true)}>从 OneDrive 打开</button><button disabled={busy} onClick={() => input.current?.click()}>选择 Excel 账本</button><div className="mr-empty-features"><span>原模板与公式保留</span><span>买入 · 卖出 · 分红</span><span>随时下载与发布</span></div></section> : <>
      <div className="mr-bookline"><strong>{draft?.name}</strong><span>记账日期 {isoDate(val('Assets', 'L1'))} · 上次 {isoDate(val('Assets', 'N1'))}</span><span>{products.length} 个产品 · {issues.length} 项收益待核实</span></div>
      <nav className="mr-tabs" aria-label="复盘内容">{['总览', '资产与产品', '负债', '记账设置', '待核实事项'].map(t => <button key={t} aria-current={tab === t ? 'page' : undefined} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}{t === '待核实事项' && issues.length > 0 ? ` (${issues.length})` : ''}</button>)}</nav>
      {tab === '总览' && <>
        <div className="mr-metrics">{[['家庭总资产', val('Analyze', 'O3')], ['家庭负债', val('Analyze', 'P3')], ['家庭净资产', val('Analyze', 'Q3')], ['较上次净资产变动', val('Analyze', 'Q4')]].map(([label, value]) => <article key={String(label)}><span>{label}</span><strong>¥ {money(value)}</strong><small>折合人民币</small></article>)}</div>
        <div className="mr-overview"><section className="mr-panel"><h2>资产配置</h2><p>按当前汇率折合人民币</p>{Object.entries(groups).map(([name, amount], i) => <div className="mr-allocation" key={name}><div><span><i style={{ background: ['#3577eb', '#6a9aef', '#42b5aa', '#dfac4e', '#9274cf', '#db8098'][i % 6] }} />{categoryNames[name] || name}</span><strong>¥ {money(amount)}</strong></div><div className="mr-track"><span style={{ width: `${Math.max(0, amount / (Number(val('Analyze', 'O3')) || 1) * 100)}%`, background: ['#3577eb', '#6a9aef', '#42b5aa', '#dfac4e', '#9274cf', '#db8098'][i % 6] }} /></div></div>)}</section>
          <section className="mr-panel"><h2>本期收支与收益</h2><div className="mr-summary-row"><span>工资收入</span><strong>¥ {money(val('Analyze', 'O5'))}</strong></div><div className="mr-summary-row"><span>估算支出</span><strong>¥ {money(val('Analyze', 'O6'))}</strong></div><div className="mr-summary-row"><span>估算投资收益（含汇率影响）</span><strong>¥ {money(val('Analyze', 'O7'))}</strong></div><div className="mr-summary-row"><span>估算期间收益率</span><strong>{pct(val('Analyze', 'O8'))}</strong></div><div className="mr-summary-row"><span>估算年化收益率</span><strong>{pct(val('Analyze', 'Q8'))}</strong></div><p className="mr-footnote">沿用模板计算口径：期间收益以期末余额为分母，属于估算。产品平均收益率不等同于组合收益率。</p></section></div>
        <section className="mr-panel"><h2>流动性概览</h2><div className="mr-liquidity">{[['受限资金', '32'], ['本月底前到期', '33'], ['随后三个月内到期', '34'], ['更晚到期', '35'], ['即时 / 未登记期限', '36']].map(([label, row]) => <div key={row}><span>{label}</span><strong>¥ {money(Number(val('Analyze', `O${row}`)) + Number(val('Analyze', `P${row}`)) * Number(val('Assets', 'D61')) + Number(val('Analyze', `Q${row}`)) * Number(val('Assets', 'D81')))}</strong></div>)}</div><p className="mr-footnote">按模板已登记到期日分类；即时余额不代表已核实实际赎回规则。</p></section>
      </>}
      {tab === '资产与产品' && <section className="mr-panel"><div className="mr-section-heading"><div><h2>资产与产品</h2><p>更新余额，管理产品与现金流。金额均以产品原币显示。</p></div><button className="primary" disabled={busy || !products.length} onClick={() => { setSelected(null); setProductForm(blankProduct); setAnchorKey(`${products[0].sheet}:${products[0].row}`); setModal('product'); }}>＋ 新增产品</button></div><div className="mr-filters"><input aria-label="搜索产品" placeholder="搜索产品、账户或备注" value={query} onChange={e => setQuery(e.target.value)} /><select aria-label="筛选成员" value={member} onChange={e => setMember(e.target.value)}>{['全部', '本人', 'WTH'].map(v => <option key={v}>{v}</option>)}</select><select aria-label="筛选币种" value={currency} onChange={e => setCurrency(e.target.value)}>{['全部', 'RMB', 'USD', 'HKD'].map(v => <option key={v}>{v}</option>)}</select></div><div className="mr-table-wrap"><table><thead><tr>{['产品 / 账户', '成员 / 币种', '本期余额', '较上次收益', 'XIRR', '年化 TWR', '操作'].map(x => <th key={x}>{x}</th>)}</tr></thead><tbody>{filtered.map(p => <tr key={`${p.sheet}:${p.row}`}><td><strong>{p.name}</strong><small>{p.account} · {categoryNames[p.category] || p.category}</small></td><td>{p.member}<small>{p.currency}</small></td><td>{money(p.balance)}</td><td>{money(val(p.sheet, `J${p.row}`))}</td><td title={String(val(p.sheet, `K${p.row}`) || '')}>{pct(val(p.sheet, `K${p.row}`))}</td><td>{pct(val(p.sheet, `L${p.row}`))}</td><td><div className="mr-row-actions"><button disabled={busy} onClick={() => editProduct(p)}>编辑</button><button disabled={busy} onClick={() => { setSelected(p); setTransactions(p.block ? book.transactions(p.block) : []); setModal('transactions'); }}>买卖记录</button><button className="danger" disabled={busy} onClick={() => { if (window.confirm(`删除“${p.name}”及其关联交易？这会更新本期汇总，历史月份不受影响。清仓请记录卖出。`)) run(() => mutate(next => next.deleteProduct(p))); }}>删除</button></div></td></tr>)}</tbody></table>{!filtered.length && <p>没有匹配产品。</p>}</div></section>}
      {tab === '负债' && <section className="mr-panel"><h2>负债记录</h2><p>原币为人民币；修改后自动更新家庭净资产。</p><div className="mr-table-wrap"><table><thead><tr><th>账户</th><th>余额</th><th>上期余额</th><th>还款日</th><th>操作</th></tr></thead><tbody>{[...book.sheet('Liabilities').cells.keys()].filter(a => /^C\d+$/.test(a)).map(a => +a.slice(1)).filter(r => r > 2 && val('Liabilities', `C${r}`) && val('Liabilities', `C${r}`) !== 'Sub Total').map(r => <tr key={r}><td>{val('Liabilities', `C${r}`)}</td><td>{money(val('Liabilities', `D${r}`))}</td><td>{money(val('Liabilities', `H${r}`))}</td><td>{val('Liabilities', `G${r}`)}</td><td><button disabled={busy} onClick={() => { const value = window.prompt('请输入负债余额', String(val('Liabilities', `D${r}`) || 0)); if (value === null) return; run(async () => { if (value.trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0) throw new Error('负债余额无效'); await mutate(next => next.set('Liabilities', `D${r}`, Number(value))); }); }}>编辑余额</button></td></tr>)}</tbody></table></div></section>}
      {tab === '记账设置' && <section className="mr-panel"><h2>日期、汇率与收入</h2><p>汇率表示 1 单位外币折合的人民币。工资为本次记账区间的累计收入。</p><div className="mr-grid">{field('本次记账日期', finance.date, v => setFinance({ ...finance, date: v }), 'date')}{field('USD → RMB', finance.usd, v => setFinance({ ...finance, usd: v }), 'number')}{field('HKD → RMB', finance.hkd, v => setFinance({ ...finance, hkd: v }), 'number')}{field('本人工资收入', finance.salary, v => setFinance({ ...finance, salary: v }), 'number')}{field('WTH 工资收入', finance.wthSalary, v => setFinance({ ...finance, wthSalary: v }), 'number')}</div><button className="primary" disabled={busy} onClick={() => run(() => mutate(next => { const date = serialDate(finance.date); if (date <= next.number('Assets', 'N1')) throw new Error('记账日期须晚于上次记账日期'); if (products.some(p => p.block && next.transactions(p.block).some(t => t.date && serialDate(t.date) > date))) throw new Error('记账日期不能早于已有交易日期'); if (![finance.usd, finance.hkd].every(v => Number.isFinite(Number(v)) && Number(v) > 0) || ![finance.salary, finance.wthSalary].every(v => v !== '' && Number.isFinite(Number(v)))) throw new Error('汇率或收入无效'); next.set('Assets', 'L1', date); next.set('Assets', 'D61', Number(finance.usd)); next.set('Assets', 'D81', Number(finance.hkd)); next.set('Analyze', 'C5', Number(finance.salary)); next.set('Analyze', 'I5', Number(finance.wthSalary)); }))}>保存并重新计算</button></section>}
      {tab === '待核实事项' && <section className="mr-panel"><h2>数据检查</h2><p>保留原始数据与提示，缺失信息不自动补造。修正产品或交易后会重新计算。</p>{issues.map(p => <div className="mr-issue" key={`${p.sheet}:${p.row}`}><strong>{p.name} · {p.account}</strong><span>XIRR：{pct(val(p.sheet, `K${p.row}`))} / TWR：{pct(val(p.sheet, `L${p.row}`))}</span><button onClick={() => { setSelected(p); setTransactions(p.block ? book.transactions(p.block) : []); setModal('transactions'); }}>检查交易</button></div>)}{Number(val('Liabilities', 'F1')) !== Number(val('Liabilities', 'H12')) && <div className="mr-issue">上期负债总额 {money(val('Liabilities', 'F1'))} 与上期明细合计 {money(val('Liabilities', 'H12'))} 不一致。历史快照保持原值，请核对来源。</div>}<details><summary>查看模板原有说明</summary>{[...book.sheet('Analyze').cells.keys()].filter(a => /^B\d+$/.test(a) && +a.slice(1) >= 40).map(a => <p key={a}>{val('Analyze', a)}</p>)}</details><p className="mr-footnote">#NUM! 表示现金流或日期无法求得收益率；#DIV/0! 表示缺少有效份额或计算分母为零。</p></section>}
    </>}
    <Dialog visible={modal === 'product'} title={selected ? '编辑产品' : '新增产品'} footer={false} onClose={() => setModal(null)} className="mr-dialog"><form onSubmit={e => { e.preventDefault(); run(async () => { await mutate(next => { const values = { ...productForm, balance: Number(productForm.balance), previous: Number(productForm.previous), flow: productForm.flow.trim() !== '' && Number.isFinite(Number(productForm.flow)) ? Number(productForm.flow) : productForm.flow }; let p = selected; if (!p) { const anchor = products.find(x => `${x.sheet}:${x.row}` === anchorKey); if (!anchor) throw new Error('请选择所属分组'); p = next.addProduct(anchor, values.name, values.account); } next.updateProduct(p, values); }); setModal(null); }); }}>
      {!selected && <label className="mr-field"><span>所属分组（沿用参照产品的成员、币种与分类）</span><select value={anchorKey} onChange={e => setAnchorKey(e.target.value)}>{products.map(p => <option key={`${p.sheet}:${p.row}`} value={`${p.sheet}:${p.row}`}>{p.member} · {p.currency} · {categoryNames[p.category] || p.category} · {p.account} / {p.name}</option>)}</select></label>}
      <div className="mr-grid">{field('产品名称', productForm.name, v => setProductForm({ ...productForm, name: v }))}{field('账户', productForm.account, v => setProductForm({ ...productForm, account: v }))}{field('本期余额', productForm.balance, v => setProductForm({ ...productForm, balance: v }), 'number')}{field('上期余额', productForm.previous, v => setProductForm({ ...productForm, previous: v }), 'number')}{field('期间净投入（投入为正，回款为负）', productForm.flow, v => setProductForm({ ...productForm, flow: v }))}{field('到期日（可留空）', productForm.due, v => setProductForm({ ...productForm, due: v }), 'date')}{field('备注', productForm.note, v => setProductForm({ ...productForm, note: v }))}</div><p className="mr-footnote">买卖流水保存后，期间净投入按交易日期重新汇总。新增产品后可进入「买卖记录」登记首次买入。</p><div className="mr-actions"><button type="button" disabled={busy} onClick={() => setModal(null)}>取消</button><button className="primary" disabled={busy}>保存产品</button></div></form></Dialog>
    <Dialog visible={modal === 'transactions'} title={`${selected?.name || ''} · 买卖记录`} footer={false} onClose={() => setModal(null)} className="mr-dialog mr-wide-dialog"><p>按日期顺序登记。金额与份额填正数，系统按交易方向写入正负号。分红需填写当日除息净值。</p><div className="mr-table-wrap"><table><thead><tr><th>日期</th><th>类型</th><th>金额（含费用后的实际收付）</th><th>份额</th><th>价格 / 净值</th><th>操作</th></tr></thead><tbody>{transactions.map((t, i) => { const update = (patch: Partial<Transaction>) => setTransactions(transactions.map((x, j) => j === i ? { ...x, ...patch } : x)); return <tr key={i}><td><input aria-label={`交易${i + 1}日期`} type="date" value={t.date} onChange={e => update({ date: e.target.value })} /></td><td><select aria-label={`交易${i + 1}类型`} value={t.kind} onChange={e => update({ kind: e.target.value as Transaction['kind'], shares: e.target.value === 'dividend' ? 0 : t.shares })}><option value="buy">买入</option><option value="sell">卖出</option><option value="dividend">分红</option></select></td><td><input aria-label={`交易${i + 1}金额`} type="number" step="any" value={t.amount} onChange={e => { const amount = Number(e.target.value); update({ amount, price: t.shares ? amount / t.shares : t.price }); }} /></td><td><input aria-label={`交易${i + 1}份额`} type="number" step="any" disabled={t.kind === 'dividend'} value={t.shares} onChange={e => { const shares = Number(e.target.value); update({ shares, price: shares ? t.amount / shares : t.price }); }} /></td><td><input aria-label={`交易${i + 1}价格`} type="number" step="any" value={t.price} onChange={e => update({ price: Number(e.target.value) })} /></td><td><button className="danger" onClick={() => setTransactions(transactions.filter((_, j) => j !== i))}>删除</button></td></tr>; })}</tbody></table></div><button disabled={busy} onClick={() => setTransactions([...transactions, { date: isoDate(val('Assets', 'L1')), kind: 'buy', amount: 0, shares: 0, price: 0 }])}>＋ 添加交易</button><p className="mr-footnote">部分卖出后请另行更新期末余额；全部卖出时余额自动归零，历史交易保留。</p><div className="mr-actions"><button disabled={busy} onClick={() => setModal(null)}>取消</button><button className="primary" disabled={busy} onClick={() => run(async () => { if (!selected) return; await mutate(next => next.saveTransactions(selected, transactions)); setModal(null); })}>保存并重新计算</button></div></Dialog>
    <Dialog visible={modal === 'newMonth'} title="新建月份" footer={false} onClose={() => setModal(null)} className="mr-dialog">{field('新记账日期', newDate, setNewDate, 'date')}<p>复制当前账本，承接上期余额、保留历史流水，清零当期收入与净投入。已有月份文件不会被覆盖。</p><div className="mr-actions"><button disabled={busy} onClick={() => setModal(null)}>取消</button><button className="primary" disabled={busy} onClick={() => run(async () => { if (!draft) return; const name = `${newDate.slice(0, 7)}.xlsx`; if (drafts.some(d => d.name === name && d.scope === draft.scope)) throw new Error('本机已存在此月份，请从账本列表打开'); const next = await MonthlyWorkbook.open(draft.data); next.rollover(newDate); await activate(await next.export(), name, { scope: draft.scope }); setNotice('新月份已创建，请核对余额并补充本期流水。'); })}>创建本机账本</button></div></Dialog>
  </div>;
}
