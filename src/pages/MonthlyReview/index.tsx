import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from '@alifd/next';
import { Prompt } from 'react-router-dom';
import Decimal from 'decimal.js';
import AssetsTable from './AssetsTable';
import AssetGroupDialog from './AssetGroupDialog';
import LiabilitiesTable from './LiabilitiesTable';
import { isCashAccount } from './categories';
import { isUnavailable } from './display';
import { matchesSearch } from './search';
import { MonthlyBatch, productKey, balanceNumber } from './batch';
import PageHeader from '@/components/PageHeader';
import { monthlyOneDriveConfig } from './config';
import { MonthlyWorkbook, Product, Transaction, Liability } from './workbook';
import { createAssetGroup, createProductEntry, productGroups } from './product-entry';
import { cashFlowSummary } from './transactions';
import TransactionsTable, { blankTransaction } from './TransactionsTable';
import { Scalar, isoDate, serialDate } from './formula';
import { MonthlyDrive, DriveFile } from './onedrive';
import { Draft, listDrafts, saveDraft, draftOptionLabel, draftSourceTitle } from './storage';
import './style.css';

const moneyFormat = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n: Scalar) => typeof n === 'number' ? moneyFormat.format(n) : '—';
const pct = (n: Scalar) => typeof n === 'number' ? `${(n * 100).toFixed(2)}%` : !isUnavailable(n) ? String(n).replace('Check inputs', '待核实').replace('Check date', '日期待核实').replace('Sale date?', '缺少卖出日期').replace('No transactions', '尚未登记交易') : '—';
const categoryNames: Record<string, string> = { 'Current Account': '活期账户', 'Debt Fund': '债券基金 / 理财', 'Time Deposit': '定期存款', 'Equity Fund': '权益基金', Stock: '股票' };
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
const daysBetween = (end: string, start: string): number | null => {
  try { return end && start ? serialDate(end) - serialDate(start) : null; } catch { return null; }
};
const fileId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function MonthlyReview() {
  const [savedBook, setBook] = useState<MonthlyWorkbook | null>(null);
  const [batch, setBatch] = useState<MonthlyBatch | null>(null);
  const [onlyUnchecked, setOnlyUnchecked] = useState(false);
  const book = batch?.book || savedBook;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [tab, setTab] = useState('总览');
  const [query, setQuery] = useState('');
  const [member, setMember] = useState('全部');
  const [currency, setCurrency] = useState('全部');
  const [accountFilter, setAccountFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [config, setConfig] = useState(readConfig);
  const [drive, setDrive] = useState<MonthlyDrive | null>(null);
  const [scope, setScope] = useState('');
  const [account, setAccount] = useState('');
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [settings, setSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState<null | 'product' | 'transactions' | 'newMonth' | 'liability' | 'cancelBatch' | 'group'>(null);
  const [selectedLiability, setSelectedLiability] = useState<Liability | null>(null);
  const [liabilityForm, setLiabilityForm] = useState({ balance: '', repayment: '' });
  const [selected, setSelected] = useState<Product | null>(null);
  const [anchorKey, setAnchorKey] = useState('');
  const [productForm, setProductForm] = useState(blankProduct);
  const [accountChoice, setAccountChoice] = useState('');
  const [entryMode, setEntryMode] = useState<'manual' | 'transactions'>('manual');
  const [initialTransactions, setInitialTransactions] = useState<Transaction[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [newDate, setNewDate] = useState('');
  const [extraRates, setExtraRates] = useState<Record<string, string>>({});
  const [finance, setFinance] = useState({ date: '', usd: '', hkd: '', salary: '', wthSalary: '' });
  const input = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; listDrafts().then(setDrafts).catch(e => setError(`无法读取本机草稿：${e.message}`)); return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false;
    if (config.clientId.trim()) run(async () => {
      const service = new MonthlyDrive(config.clientId, config.folder);
      const user = await service.restore();
      if (!user || cancelled) return;
      const listed = await service.list();
      if (cancelled) return;
      setDrive(service); setFiles(listed); setAccount(user.username || user.name || 'Microsoft 账户');
      setScope(`${service.config.clientId}:${user.homeAccountId}:${service.folder}`);
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!book) return;
    setExtraRates(Object.fromEntries(book.currencyCodes().filter(c => !['RMB', 'USD', 'HKD'].includes(c)).map(c => [c, String(book.exchangeRate(c))])));
    setFinance({ date: isoDate(book.value('Assets', 'L1')), usd: String(book.exchangeRate('USD') || ''), hkd: String(book.exchangeRate('HKD') || ''), salary: String(book.value('Analyze', 'C5') || 0), wthSalary: String(book.value('Analyze', 'I5') || 0) });
  }, [savedBook, Boolean(batch), book?.currencyCodes().join('|')]);
  useEffect(() => {
    if (!batch?.dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [batch?.dirty]);
  useEffect(() => {
    if (modal !== 'cancelBatch') return;
    const closeConfirmation = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation(); setModal(null);
    };
    window.addEventListener('keydown', closeConfirmation, true);
    return () => window.removeEventListener('keydown', closeConfirmation, true);
  }, [modal]);
  async function run(action: () => Promise<void>) {
    if (lock.current) return; lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (e) { if (mounted.current) setError(e.message || '操作失败，请重试'); } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function activate(data: Uint8Array, name: string, metadata?: Partial<Draft>) {
    if (batch) throw new Error('请先保存或取消本次批量记账');
    const opened = await MonthlyWorkbook.open(data);
    const entry: Draft = { id: fileId(), name, data, updated: new Date().toISOString(), ...metadata };
    const saved = await saveDraft(entry); setDrafts(await listDrafts()); setBook(opened); setDraft(saved); setModal(null);
  }
  async function mutate(action: (next: MonthlyWorkbook) => void, touchedKey?: string) {
    if (!book || !draft) return;
    if (batch) {
      const next = batch.apply(action, touchedKey); setBatch(next);
      setNotice('修改已加入本次批量记账，点击「保存本机草稿」后统一保存。产品增删后需重新核对各行。');
      return;
    }
    // Apply to a copy; a rejected operation leaves both the visible workbook and saved draft intact.
    const next = await MonthlyWorkbook.open(draft.data); action(next);
    const data = await next.export(); const updated = { ...draft, data, updated: new Date().toISOString(), published: undefined };
    const saved = await saveDraft(updated); setBook(next); setDraft(saved); setDrafts(await listDrafts()); setNotice('已保存本机草稿，页面结果已更新。');
  }
  function startBatch(source = book, target = '资产') {
    if (!source) return;
    setBatch(new MonthlyBatch(source)); setOnlyUnchecked(false); setTab(target); setError(''); setNotice('');
  }
  async function saveBatch() {
    if (!batch || !draft) return;
    const completed = batch.commitInputs();
    if (completed.invalid.length) throw new Error('仍有 ' + completed.invalid.length + ' 项金额无效，请修正后再保存（包含其他 tab 或被筛选隐藏的账户）');
    completed.book.validate();
    const data = await completed.book.export();
    const saved = await saveDraft({ ...draft, data, updated: new Date().toISOString(), published: undefined });
    setBook(completed.book); setDraft(saved); setDrafts(await listDrafts()); setBatch(null); setOnlyUnchecked(false);
    setNotice('批量记账已保存到本机草稿，可下载 Excel 检查或发布到 OneDrive。');
  }
  function discardBatch() {
    setBatch(null); setOnlyUnchecked(false); setModal(null); setError(''); setNotice('已退出批量记账。');
  }
  function cancelBatch() {
    if (batch?.dirty) setModal('cancelBatch');
    else discardBatch();
  }
  const products = useMemo(() => book?.products() || [], [book]);
  const liabilities = useMemo(() => book?.liabilities() || [], [book]);
  const reviewRows = tab === '负债' ? liabilities : tab === '资产' ? products : [...products, ...liabilities];
  const reviewCount = batch ? reviewRows.filter(row => batch.reviewed.has(productKey(row))).length : 0;
  const changedRowKeys = batch?.changedKeys() || new Set<string>();
  const changeCount = reviewRows.filter(row => changedRowKeys.has(productKey(row))).length;
  function editLiability(row: Liability) {
    setSelectedLiability(row); setLiabilityForm({ balance: batch?.inputs.get(productKey(row)) ?? String(row.balance), repayment: String(row.repayment ?? '') }); setError(''); setModal('liability');
  }
  function saveLiability(event: React.FormEvent) {
    event.preventDefault();
    run(async () => {
      if (!selectedLiability) return;
      const balance = balanceNumber(liabilityForm.balance);
      if (balance === null) throw new Error('负债余额须为有效的非负金额');
      await mutate(next => next.updateLiability(selectedLiability, { balance, repayment: liabilityForm.repayment }), productKey(selectedLiability));
      setModal(null);
    });
  }
  const groupOptions = useMemo(() => productGroups(book || undefined), [book]);
  const memberOptions = useMemo(() => book?.members().map(m => m.member) || ['本人', 'WTH'], [book]);
  const currencyOptions = useMemo(() => book?.currencyCodes() || ['RMB', 'USD', 'HKD'], [book]);
  const liquidity = useMemo(() => book?.liquiditySummary() || [], [book]);
  const automaticFlow = isCashAccount(selected?.category || groupOptions.find(g => g.key === anchorKey)?.category || '');
  const formAutomaticFlow = [productForm.balance, ...(selected ? [productForm.previous] : [])].every(v => v.trim() !== '' && Number.isFinite(Number(v))) ? new Decimal(productForm.balance).minus(selected ? productForm.previous : 0).toNumber() : NaN;
  const accounts = useMemo(() => [...new Set(products.map(p => p.account))].sort((a, b) => a.localeCompare(b, 'zh-CN')), [products]);
  const categories = useMemo(() => [...new Set(products.map(p => p.category))].sort((a, b) => (categoryNames[a] || a).localeCompare(categoryNames[b] || b, 'zh-CN')), [products]);
  useEffect(() => {
    if (book && categoryFilter && !products.some(p => p.category === categoryFilter)) setCategoryFilter('');
    if (book && accountFilter && !products.some(p => p.account === accountFilter)) setAccountFilter('');
    if (book && member !== '全部' && !memberOptions.includes(member)) setMember('全部');
    if (book && currency !== '全部' && !currencyOptions.includes(currency)) setCurrency('全部');
  }, [book, products, accountFilter, categoryFilter, member, currency, memberOptions, currencyOptions]);
  const filtered = products.filter(p => (member === '全部' || p.member === member) && (currency === '全部' || p.currency === currency) && (!accountFilter || p.account === accountFilter) && (!categoryFilter || p.category === categoryFilter) && matchesSearch(`${p.name} ${p.account} ${categoryNames[p.category] || p.category} ${p.member} ${p.currency} ${p.note}`, query));
  const visibleProducts = batch && onlyUnchecked ? filtered.filter(p => !batch.reviewed.has(productKey(p))) : filtered;
  const val = (s: string, a: string) => book?.value(s, a) ?? null;
  const groups = useMemo(() => products.reduce<Record<string, number>>((out, p) => { const rate = book?.exchangeRate(p.currency) || 0; out[p.category] = (out[p.category] || 0) + p.balance * rate; return out; }, {}), [book, products]);
  const issues = useMemo(() => products.filter(p => ['K', 'L', 'M'].some(c => { const v = book?.value(p.sheet, `${c}${p.row}`); return typeof v === 'string' && !isUnavailable(v); })), [book, products]);
  const savedStatus = draft?.published ? `已发布 · ${new Date(draft.published).toLocaleString('zh-CN')}` : '草稿仅保存在当前浏览器';
  function editProduct(p: Product) {
    const current = batch?.commitInputs();
    if (current && current !== batch) setBatch(current);
    p = current?.book.products().find(row => productKey(row) === productKey(p)) || p;
    setSelected(p); setAccountChoice(p.account); setError('');
    setProductForm({ name: p.name, account: p.account, balance: String(p.balance), previous: String(p.previous), flow: String(p.flow ?? 0), due: p.due, note: p.note });
    setModal('product');
  }
  function newProduct() {
    const group = groupOptions.find(g => g.sheet === 'Assets' && g.currency === 'RMB' && g.category === 'Debt Fund') || groupOptions[0];
    const accountName = accountFilter || products.find(p => p.sheet === group?.sheet && p.currency === group?.currency && p.category === group?.category)?.account || accounts[0] || '';
    setSelected(null); setAnchorKey(group?.key || ''); setAccountChoice(accountName || '__new__'); setError('');
    setProductForm({ ...blankProduct, account: accountName }); setEntryMode('manual');
    setInitialTransactions(group && isCashAccount(group.category) ? [] : [blankTransaction(isoDate(val('Assets', 'L1')))]); setModal('product');
  }
  function saveProduct(event: React.FormEvent) {
    event.preventDefault();
    run(async () => {
      await mutate(next => {
        const values = { ...productForm, name: productForm.name.trim(), account: productForm.account.trim(), balance: Number(productForm.balance) };
        if (selected) {
          next.updateProduct(selected, { ...values, previous: Number(productForm.previous), flow: productForm.flow.trim() !== '' && Number.isFinite(Number(productForm.flow)) ? Number(productForm.flow) : productForm.flow });
        } else {
          if (!automaticFlow && entryMode === 'manual' && productForm.flow.trim() === '') throw new Error('请填写净投入金额');
          createProductEntry(next, anchorKey, { ...values, flow: Number(productForm.flow) }, automaticFlow ? 'manual' : entryMode, automaticFlow ? [] : initialTransactions);
        }
      }, selected ? productKey(selected) : undefined);
      setModal(null);
    });
  }
  async function connect(switchAccount = false) {
    const service = new MonthlyDrive(config.clientId, config.folder); const user = await service.connect(switchAccount);
    const key = `${service.config.clientId}:${user.homeAccountId}:${service.folder}`;
    const listed = await service.list(); setDrive(service); setFiles(listed); setAccount(user.username || user.name || 'Microsoft 账户'); setScope(key);
    const applied = { clientId: service.config.clientId, folder: service.folder };
    localStorage.setItem('monthly-review:settings', JSON.stringify(applied)); setConfig(applied); setSettings(false); setNotice('OneDrive 已连接，当前目录已加载。两页共用登录，各自保留目录设置。');
  }
  async function publish() {
    if (!drive || !book || !draft) return;
    if (draft.scope && draft.scope !== scope) throw new Error('此账本来自其他账户或目录。请打开当前目录的账本，或先另存为当前目录副本。');
    if (!window.confirm(`将“${draft.name}”发布到 ${account} 的 /${drive.folder}/。${draft.source ? '更新原文件。' : '创建新文件；同名文件不会被覆盖。'}`)) return;
    const data = await book.export(); const result = await drive.publish(draft.name, data, draft.source);
    const updated = { ...draft, data, source: result, scope, sourceLabel: `${account} · /${drive.folder}/`, published: new Date().toISOString() };
    // Publication is already successful even if refreshing the folder or persisting cache fails.
    setDraft(updated); setNotice('已发布到 OneDrive。');
    try { const saved = await saveDraft(updated); setDraft(saved); setDrafts(await listDrafts()); setFiles(await drive.list()); } catch (e) { setError(`文件已发布，但刷新本机缓存失败：${e.message}`); }
  }
  const accountingDate = isoDate(val('Assets', 'L1'));
  const previousDate = isoDate(val('Assets', 'N1'));
  const elapsedDays = daysBetween(finance.date, previousDate);
  const recordedDays = daysBetween(accountingDate, previousDate);
  const initialSummary = cashFlowSummary(initialTransactions, book?.number('Assets', 'N1') || 0, book?.number('Assets', 'L1') || 0);
  const field = (label: string, value: string, onChange: (v: string) => void, type = 'text', readOnly = false) => <label className="mr-field"><span>{label}</span><input type={type} value={value} readOnly={readOnly} onFocus={event => { if (label === '本期余额' || label.startsWith('期间净投入')) event.currentTarget.select(); }} onClick={event => { if (label === '本期余额' || label.startsWith('期间净投入')) event.currentTarget.select(); }} onChange={e => onChange(e.target.value)} step="any" /></label>;
  return <div className="monthly-review" aria-busy={busy}>
    <Prompt when={Boolean(batch?.dirty)} message="批量记账尚未保存，离开将丢弃本次修改。确定离开？" />
    <PageHeader title="月度复盘" />
    <div className="mr-title"><div><span className="mr-eyebrow">MONTHLY REVIEW</span><h1>把账记清，把变化看明白。</h1><p>每月一份账本，记录资产、现金流与投资收益。</p></div><span className={`mr-status ${draft?.published ? 'synced' : ''}`}>{busy ? '正在处理…' : batch ? '批量记账中 · 尚未保存' : book ? savedStatus : '等待导入账本'}</span></div>
    <input ref={input} type="file" accept=".xlsx" hidden onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) run(async () => { await activate(new Uint8Array(await file.arrayBuffer()), file.name); setNotice('已导入并保存在本机，尚未发布到 OneDrive。'); }); }} />
    <div className="mr-toolbar">
      <div className="mr-toolbar-group"><button disabled={busy || Boolean(batch)} onClick={() => input.current?.click()}>导入 Excel</button><select aria-label="打开本机账本" disabled={busy || Boolean(batch)} value={draft?.id || ''} onChange={e => { const d = drafts.find(x => x.id === e.target.value); if (d) run(async () => { const opened = await MonthlyWorkbook.open(d.data); setBook(opened); setDraft(d); }); }}><option value="">本机账本</option>{drafts.map(d => <option key={d.id} value={d.id} title={`${d.name} · ${draftSourceTitle(d)}`}>{draftOptionLabel(d, drafts)}</option>)}</select><button disabled={busy || !book || Boolean(batch)} onClick={() => { const date = isoDate(val('Assets', 'L1')); const next = new Date(`${date}T00:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1, 1); setNewDate(next.toISOString().slice(0, 10)); setModal('newMonth'); }}>＋ 新建月份</button></div>
      <div className="mr-toolbar-group"><button disabled={busy || !book || Boolean(batch)} onClick={() => run(async () => { if (!book || !draft) return; const data = await book.export(); const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); const a = document.createElement('a'); a.href = url; a.download = draft.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice('Excel 已生成，包含原有公式及当前计算结果。'); })}>↓ 下载 Excel</button><button className="primary" disabled={busy || !book || !drive || Boolean(batch)} onClick={() => run(publish)}>发布到 OneDrive</button><button disabled={busy} onClick={() => setSettings(!settings)}>同步设置</button></div>
    </div>
    {error && !modal && <div className="mr-message error" role="alert">{error}</div>}{notice && <div className="mr-message" role="status">{notice}</div>}
    {settings && <section className="mr-panel"><h2>OneDrive 连接</h2><p>与交易日记共用 Microsoft 登录，账本目录独立。连接后修改目录并应用即可，无需重复登录。请在 Entra 中注册当前站点的重定向网址，并授予 Files.ReadWrite 权限。</p><div className="mr-grid">{field('应用客户端 ID', config.clientId, v => setConfig({ ...config, clientId: v }))}{field('账本文件夹', config.folder, v => setConfig({ ...config, folder: v }))}</div><div className="mr-actions"><button disabled={busy} onClick={() => setConfig({ ...monthlyOneDriveConfig })}>恢复默认配置</button><button className="primary" disabled={busy} onClick={() => run(() => connect())}>{drive ? '应用目录' : '连接 OneDrive'}</button>{drive && <button disabled={busy} onClick={() => run(() => connect(true))}>切换账户</button>}{drive && <button disabled={busy} onClick={() => run(async () => { await drive.disconnect(); setDrive(null); setFiles([]); setScope(''); setAccount(''); })}>断开共享登录</button>}</div></section>}
    {drive && <div className="mr-cloud"><span>● {account} · /{drive.folder}/</span><select aria-label="打开 OneDrive Excel" disabled={busy || Boolean(batch)} value="" onChange={e => { const file = files.find(f => f.id === e.target.value); if (file) run(async () => { const result = await drive.download(file); await activate(new Uint8Array(result.data), result.file.name, { source: result.file, scope, sourceLabel: `${account} · /${drive.folder}/`, published: new Date().toISOString() }); }); }}><option value="">选择云端 Excel</option>{files.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select><button disabled={busy} onClick={() => run(async () => setFiles(await drive.list()))}>刷新文件</button></div>}
    {drive && book && draft?.scope && draft.scope !== scope && <div className="mr-message">当前账本来自其他账户或目录，原文件保持原位。可打开当前目录账本，或 <button disabled={busy || Boolean(batch)} onClick={() => run(async () => {
      if (!draft || !window.confirm(`将“${draft.name}”另存为当前账户 /${drive.folder}/ 的副本？原账本保留，发布时不会覆盖同名文件。`)) return;
      await activate(draft.data, draft.name, { scope, sourceLabel: `${account} · /${drive.folder}/` }); setNotice('已创建当前目录的本机副本，点击发布后才会上传。');
    })}>另存为当前目录副本</button>。</div>}
    {!book ? <section className="mr-empty"><div className="mr-empty-icon">月</div><h2>从你现有的月度 Excel 开始</h2><p>导入原模板账本，即可管理产品、记录买卖，并实时查看收益。<br />账本保存在当前浏览器，只有点击发布才会上传。</p><button className="primary" disabled={busy} onClick={() => setSettings(true)}>从 OneDrive 打开</button><button disabled={busy} onClick={() => input.current?.click()}>选择 Excel 账本</button><div className="mr-empty-features"><span>原模板与公式保留</span><span>买入 · 卖出 · 分红</span><span>随时下载与发布</span></div></section> : <>
      <div className="mr-bookline"><strong>{draft?.name}</strong><span>记账日期 {accountingDate} · 上次 {previousDate}{recordedDays !== null && recordedDays >= 0 ? ` · ${recordedDays}天` : ''}</span><span>{products.length} 个产品 · {issues.length} 项收益待核实</span></div>
      {batch && <div className="mr-batch-bar" role="region" aria-label="批量记账工具栏"><div><strong>批量记账</strong><span aria-live="polite">已核对 {reviewCount} / {reviewRows.length} 项（{tab === '负债' ? '负债' : tab === '资产' ? '资产' : '资产与负债'}） · 已修改 {changeCount} 项{batch.invalid.length ? ' · ' + batch.invalid.length + ' 项金额无效' : ''}</span><p>资产与负债的修改暂存于本次记账，统一保存后才能下载或发布。{batch.invalid.length > 0 ? '无效金额未参与收益计算，汇总暂按最近有效金额预览。' : ''}</p></div><div className="mr-toolbar-group"><button disabled={busy} onClick={cancelBatch}>取消批量记账</button><button className="primary" disabled={busy || batch.invalid.length > 0} onClick={() => run(saveBatch)}>保存本机草稿</button></div></div>}
      <nav className="mr-tabs" aria-label="复盘内容">{['总览', '资产', '负债', '记账设置', '待核实事项'].map(t => <button key={t} aria-current={tab === t ? 'page' : undefined} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}{t === '待核实事项' && issues.length > 0 ? ` (${issues.length})` : ''}</button>)}</nav>
      {tab === '总览' && <>
        <div className="mr-metrics">{[['家庭总资产', val('Analyze', 'O3')], ['家庭负债', val('Analyze', 'P3')], ['家庭净资产', val('Analyze', 'Q3')], ['较上次净资产变动', val('Analyze', 'Q4')]].map(([label, value]) => <article key={String(label)}><span>{label}</span><strong>¥ {money(value)}</strong><small>折合人民币</small></article>)}</div>
        <div className="mr-overview"><section className="mr-panel"><h2>资产配置</h2><p>按当前汇率折合人民币</p>{Object.entries(groups).map(([name, amount], i) => <div className="mr-allocation" key={name}><div><span><i style={{ background: ['#3577eb', '#6a9aef', '#42b5aa', '#dfac4e', '#9274cf', '#db8098'][i % 6] }} />{categoryNames[name] || name}</span><strong>¥ {money(amount)}</strong></div><div className="mr-track"><span style={{ width: `${Math.max(0, amount / (Number(val('Analyze', 'O3')) || 1) * 100)}%`, background: ['#3577eb', '#6a9aef', '#42b5aa', '#dfac4e', '#9274cf', '#db8098'][i % 6] }} /></div></div>)}</section>
          <section className="mr-panel"><h2>本期收支与收益</h2><div className="mr-summary-row"><span>工资收入</span><strong>¥ {money(val('Analyze', 'O5'))}</strong></div><div className="mr-summary-row"><span>估算支出</span><strong>¥ {money(val('Analyze', 'O6'))}</strong></div><div className="mr-summary-row"><span>估算投资收益（含汇率影响）</span><strong>¥ {money(val('Analyze', 'O7'))}</strong></div><div className="mr-summary-row"><span>估算期间收益率</span><strong>{pct(val('Analyze', 'O8'))}</strong></div><div className="mr-summary-row"><span>估算年化收益率</span><strong>{pct(val('Analyze', 'Q8'))}</strong></div><p className="mr-footnote">沿用模板计算口径：期间收益以期末余额为分母，属于估算。产品平均收益率不等同于组合收益率。</p></section></div>
        <section className="mr-panel"><h2>流动性概览</h2><div className="mr-liquidity">{[['受限资金', '32'], ['本月底前到期', '33'], ['随后三个月内到期', '34'], ['更晚到期', '35'], ['即时 / 未登记期限', '36']].map(([label, row], index) => <div key={row}><span>{label}</span><strong>¥ {money(liquidity[index])}</strong></div>)}</div><p className="mr-footnote">按模板已登记到期日分类；即时余额不代表已核实实际赎回规则。</p></section>
      </>}
      {tab === '资产' && <section className="mr-panel"><div className="mr-section-heading"><div><h2>资产</h2><p>更新余额，管理产品与现金流。金额均以产品原币显示。</p></div><div className="mr-toolbar-group">{!batch && <button disabled={busy || !products.length} onClick={() => startBatch()}>批量记账</button>}<button disabled={busy} onClick={() => { setError(''); setModal('group'); }}>＋ 新增分组</button><button className="primary" disabled={busy} onClick={newProduct}>＋ 新增产品</button></div></div><div className="mr-filters"><input aria-label="搜索产品" placeholder="搜索产品、账户或备注" value={query} onChange={e => setQuery(e.target.value)} /><select aria-label="筛选成员" value={member} onChange={e => setMember(e.target.value)}><option value="全部">全部成员</option>{memberOptions.map(v => <option key={v} value={v}>{v}</option>)}</select><select aria-label="筛选币种" value={currency} onChange={e => setCurrency(e.target.value)}><option value="全部">全部币种</option>{currencyOptions.map(v => <option key={v} value={v}>{v}</option>)}</select><select aria-label="筛选账户" value={accountFilter} onChange={e => setAccountFilter(e.target.value)}><option value="">全部账户</option>{accounts.map(v => <option key={v} value={v}>{v}</option>)}</select><select aria-label="筛选产品类型" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}><option value="">全部产品类型</option>{categories.map(v => <option key={v} value={v}>{categoryNames[v] || v}</option>)}</select></div>{batch && <div className="mr-batch-help"><p>金额输入在失去焦点后重算。直接填写本期余额，按 Tab / 回车核对并跳至下一行，Esc 退出连续录入；可从 Excel 粘贴一列余额，按当前可见顺序从所选行开始填入。可点击产品名称、余额或收益表头排序，录入时行顺序保持不变。活期账户净投入自动计算且不可编辑；其他产品净投入可直接填写，投入为正、回款为负，保存买卖记录后会按流水重算。上期余额只读，其他信息仍可通过「编辑」修改。</p><div className="mr-toolbar-group"><label><input type="checkbox" checked={onlyUnchecked} onChange={e => setOnlyUnchecked(e.target.checked)} />仅看未核对</label><button disabled={busy || !visibleProducts.length} onClick={() => setBatch(batch.check(visibleProducts.map(productKey), true))}>将当前可见项标为已核对</button><button disabled={busy || !batch.reviewed.size} onClick={() => setBatch(batch.check(products.map(productKey), false))}>清除核对标记</button></div></div>}
        <AssetsTable book={book} products={visibleProducts} batch={batch} busy={busy} categoryNames={categoryNames} money={money} pct={pct} onBatch={next => { setBatch(next); setError(''); setNotice(''); }} onError={setError} onEdit={editProduct} onTransactions={p => { setSelected(p); setTransactions(p.block ? book.transactions(p.block) : []); setError(''); setModal('transactions'); }} onDelete={p => { if (window.confirm(`删除“${p.name}”及其关联交易？这会更新本期汇总，历史月份不受影响。清仓请记录卖出。`)) run(() => mutate(next => next.deleteProduct(p))); }} /></section>}
      {tab === '负债' && <LiabilitiesTable book={book} batch={batch} busy={busy} money={money} onStart={() => startBatch(book, '负债')} onBatch={next => { setBatch(next); setError(''); setNotice(''); }} onError={setError} onEdit={editLiability} onZero={row => {
        if (batch) { setBatch(batch.balances([[productKey(row), '0']])); setError(''); setNotice(''); }
        else run(() => mutate(next => next.updateLiability(row, { balance: 0, repayment: String(row.repayment ?? '') })));
      }} />}
      {tab === '记账设置' && <section className="mr-panel"><h2>日期、汇率与收入</h2><p>汇率表示 1 单位外币折合的人民币。工资为本次记账区间的累计收入。</p><div className="mr-grid">{field('本次记账日期', finance.date, v => setFinance({ ...finance, date: v }), 'date')}{field('上次记账日期', previousDate, () => {}, 'date', true)}<p className="mr-date-gap" aria-live="polite">{elapsedDays === null ? '请选择有效的本次记账日期以查看间隔天数。' : elapsedDays < 0 ? '本次记账日期早于上次记账日期，请调整。' : `本次记账日期距上次记账日期已过去 ${elapsedDays} 天。`}</p>{field('USD → RMB', finance.usd, v => setFinance({ ...finance, usd: v }), 'number')}{field('HKD → RMB', finance.hkd, v => setFinance({ ...finance, hkd: v }), 'number')}{Object.entries(extraRates).map(([code, rate]) => <React.Fragment key={code}>{field(`${code} → RMB`, rate, value => setExtraRates({ ...extraRates, [code]: value }), 'number')}</React.Fragment>)}{field('本人工资收入', finance.salary, v => setFinance({ ...finance, salary: v }), 'number')}{field('WTH 工资收入', finance.wthSalary, v => setFinance({ ...finance, wthSalary: v }), 'number')}</div><button className="primary" disabled={busy} onClick={() => run(() => mutate(next => { const date = serialDate(finance.date); if (date <= next.number('Assets', 'N1')) throw new Error('记账日期须晚于上次记账日期'); if (products.some(p => p.block && next.transactions(p.block).some(t => t.date && serialDate(t.date) > date))) throw new Error('记账日期不能早于已有交易日期'); if (![finance.usd, finance.hkd, ...Object.values(extraRates)].every(v => Number.isFinite(Number(v)) && Number(v) > 0) || ![finance.salary, finance.wthSalary].every(v => v !== '' && Number.isFinite(Number(v)))) throw new Error('汇率或收入无效'); next.set('Assets', 'L1', date); next.set('Assets', next.rateAddress('USD'), Number(finance.usd)); next.set('Assets', next.rateAddress('HKD'), Number(finance.hkd)); for (const [code, rate] of Object.entries(extraRates)) next.set('Assets', next.rateAddress(code), Number(rate)); next.set('Analyze', 'C5', Number(finance.salary)); next.set('Analyze', 'I5', Number(finance.wthSalary)); }))}>保存并重新计算</button></section>}
      {tab === '待核实事项' && <section className="mr-panel"><h2>数据检查</h2><p>保留原始数据与提示，缺失信息不自动补造。修正产品或交易后会重新计算。</p>{issues.map(p => <div className="mr-issue" key={`${p.sheet}:${p.row}`}><strong>{p.name} · {p.account}</strong><span>XIRR：{pct(val(p.sheet, `K${p.row}`))} / TWR：{pct(val(p.sheet, `L${p.row}`))}</span><button onClick={() => { setSelected(p); setTransactions(p.block ? book.transactions(p.block) : []); setError(''); setModal('transactions'); }}>检查交易</button></div>)}{Number(val('Liabilities', 'F1')) !== Number(val('Liabilities', 'H12')) && <div className="mr-issue">上期负债总额 {money(val('Liabilities', 'F1'))} 与上期明细合计 {money(val('Liabilities', 'H12'))} 不一致。历史快照保持原值，请核对来源。</div>}<details><summary>查看模板原有说明</summary>{[...book.sheet('Analyze').cells.keys()].filter(a => /^B\d+$/.test(a) && +a.slice(1) >= 40).map(a => <p key={a}>{val('Analyze', a)}</p>)}</details><p className="mr-footnote">#NUM! 表示现金流或日期无法求得收益率；#DIV/0! 表示缺少有效份额或计算分母为零。</p></section>}
    </>}
    <AssetGroupDialog visible={modal === 'group'} busy={busy} book={book} error={error} categoryNames={categoryNames} onClose={() => setModal(null)} onSave={values => run(async () => {
      await mutate(next => { createAssetGroup(next, values); });
      setMember(values.member.trim()); setCurrency(values.currency.trim().toUpperCase()); setAccountFilter(values.account.trim()); setCategoryFilter(''); setQuery(''); setOnlyUnchecked(false); setModal(null);
    })} />
    <Dialog visible={modal === 'product'} title={selected ? '编辑产品' : '新增产品'} footer={false} onClose={() => setModal(null)} className={`mr-dialog ${selected ? '' : 'mr-wide-dialog mr-product-dialog'}`}>
      {error && <div className="mr-message error" role="alert">{error}</div>}
      <form onSubmit={saveProduct}>
        {!selected && <label className="mr-field"><span>所属分组</span><select aria-label="所属分组" disabled={busy} value={anchorKey} onChange={e => setAnchorKey(e.target.value)}>{groupOptions.map(g => <option key={g.key} value={g.key}>{g.member} · {g.currency} · {categoryNames[g.category] || g.category}</option>)}</select></label>}
        <div className="mr-grid">
          {field('产品名称', productForm.name, v => setProductForm({ ...productForm, name: v }))}
          <label className="mr-field"><span>账户</span><select aria-label="账户" disabled={busy} value={accountChoice} onChange={e => { const choice = e.target.value; setAccountChoice(choice); setProductForm({ ...productForm, account: choice === '__new__' ? '' : choice }); }}>{accounts.map(name => <option key={name} value={name}>{name}</option>)}<option value="__new__">＋ 新增账户</option></select></label>
          {accountChoice === '__new__' && field('新账户名称', productForm.account, v => setProductForm({ ...productForm, account: v }))}
          {field('本期余额', productForm.balance, v => setProductForm({ ...productForm, balance: v }), 'number')}
          {selected && field('上期余额', productForm.previous, v => setProductForm({ ...productForm, previous: v }), 'number')}
          {selected && field('期间净投入（投入为正，回款为负）', automaticFlow ? Number.isFinite(formAutomaticFlow) ? String(formAutomaticFlow) : '' : productForm.flow, v => setProductForm({ ...productForm, flow: v }), 'text', automaticFlow)}
          {field('到期日（可留空）', productForm.due, v => setProductForm({ ...productForm, due: v }), 'date')}
          {field('备注', productForm.note, v => setProductForm({ ...productForm, note: v }))}
        </div>
        {!selected && <fieldset disabled={automaticFlow || busy} aria-disabled={automaticFlow} className="mr-product-flow">
          <h3>本期交易与净投入</h3>
          <div className="mr-flow-options" role="radiogroup" aria-label="净投入录入方式">
            <label><input type="radio" name="product-flow-mode" checked={automaticFlow || entryMode === 'manual'} disabled={busy} onChange={() => { setProductForm({ ...productForm, flow: String(initialSummary.net) }); setEntryMode('manual'); }} />直接填写净投入</label>
            <label><input type="radio" name="product-flow-mode" checked={!automaticFlow && entryMode === 'transactions'} disabled={busy} onChange={() => setEntryMode('transactions')} />通过买卖记录计算</label>
          </div>
          {entryMode === 'transactions' && !automaticFlow ? <>
            <p>按日期顺序登记上次记账日期 {previousDate} 之后、至 {accountingDate}（含当日）的交易，支持跨月、多次买入卖出及分红。金额填实际收付金额，份额填正数。</p>
            <TransactionsTable rows={initialTransactions} onChange={setInitialTransactions} date={accountingDate} disabled={busy} labelPrefix="新增交易" />
            <div className="mr-entry-summary"><div><span>买入合计</span><strong>{money(initialSummary.buys)}</strong></div><div><span>卖出回款</span><strong>{money(initialSummary.sales)}</strong></div><div><span>现金分红</span><strong>{money(initialSummary.dividends)}</strong></div><div><span>本期净投入</span><strong>{money(initialSummary.net)}</strong></div></div>
            <p className="mr-footnote">净投入 = 买入 − 卖出回款 − 现金分红。本期余额请填写记账日实际余额；全部卖出时会自动归零。分红需填写除息后净值。</p>
          </> : <>
            {field('期间净投入（投入为正，回款为负）', automaticFlow ? Number.isFinite(formAutomaticFlow) ? String(formAutomaticFlow) : '' : productForm.flow, v => setProductForm({ ...productForm, flow: v }), 'number')}
            <p className="mr-footnote">{automaticFlow ? '活期账户净投入自动计算，此处不可修改。' : '直接填写模式仅保存净投入，不保存逐笔交易。以后补齐交易日期与明细后，才能计算 XIRR、TWR。'}</p>
          </>}
        </fieldset>}
        <p className="mr-footnote">{automaticFlow ? '活期账户净投入由本期余额减上期余额自动计算，买卖记录不会改写此规则。' : selected ? '买卖流水保存后，期间净投入按交易日期重新汇总。' : '新增产品不承接上期余额；新账户在保存产品后自动加入账户列表。'}</p>
        <div className="mr-actions"><button type="button" disabled={busy} onClick={() => setModal(null)}>取消</button><button className="primary" disabled={busy}>{batch ? '应用到批量记账' : '保存产品'}</button></div>
      </form>
    </Dialog>
    <Dialog visible={modal === 'transactions'} title={`${selected?.name || ''} · 买卖记录`} footer={false} onClose={() => setModal(null)} className="mr-dialog mr-wide-dialog">
      {error && <div className="mr-message error" role="alert">{error}</div>}
      <p>按日期顺序登记。金额与份额填正数，系统按交易方向写入正负号。分红需填写当日除息净值。</p>
      <TransactionsTable rows={transactions} onChange={setTransactions} date={accountingDate} disabled={busy} />
      <p className="mr-footnote">{selected && isCashAccount(selected.category) ? '活期账户余额按实际金额填写，净投入自动按本期余额减上期余额计算，买卖记录不覆盖此规则。' : '部分卖出后请另行更新期末余额；全部卖出时余额自动归零，历史交易保留。'}</p>
      <div className="mr-actions"><button disabled={busy} onClick={() => setModal(null)}>取消</button><button className="primary" disabled={busy} onClick={() => run(async () => { if (!selected) return; await mutate(next => next.saveTransactions(selected, transactions), productKey(selected)); setModal(null); })}>{batch ? '应用并重新计算' : '保存并重新计算'}</button></div>
    </Dialog>
    <Dialog visible={modal === 'liability'} title={`${selectedLiability?.account || ''} · 编辑负债`} footer={false} onClose={() => setModal(null)} className="mr-dialog">
      {error && <div className="mr-message error" role="alert">{error}</div>}
      <form onSubmit={saveLiability}><div className="mr-grid">{field('本期余额', liabilityForm.balance, balance => setLiabilityForm({ ...liabilityForm, balance }), 'number')}{field('还款日', liabilityForm.repayment, repayment => setLiabilityForm({ ...liabilityForm, repayment }))}</div>
        <p className="mr-footnote">上期余额 {money(selectedLiability?.previous ?? null)} 元（只读）。还款日支持每月还款日或具体日期等文字，可留空。</p>
        <div className="mr-actions"><button type="button" disabled={busy} onClick={() => setModal(null)}>取消</button><button className="primary" disabled={busy}>{batch ? '应用到批量记账' : '保存负债'}</button></div>
      </form>
    </Dialog>
    <Dialog visible={modal === 'cancelBatch'} title="取消批量记账" footer={false} onClose={() => setModal(null)} className="mr-dialog">
      <p>确定取消本次批量记账的全部修改？已保存的本机草稿不受影响。</p>
      <div className="mr-actions"><button type="button" disabled={busy} onClick={() => setModal(null)}>继续记账</button><button type="button" className="primary" disabled={busy} onClick={discardBatch}>确定取消</button></div>
    </Dialog>
    <Dialog visible={modal === 'newMonth'} title="新建月份" footer={false} onClose={() => setModal(null)} className="mr-dialog">{error && <div className="mr-message error" role="alert">{error}</div>}{field('新记账日期', newDate, setNewDate, 'date')}<p>复制当前账本，承接上期余额、保留历史流水，清零当期收入与净投入。已有月份文件不会被覆盖。</p><div className="mr-actions"><button disabled={busy} onClick={() => setModal(null)}>取消</button><button className="primary" disabled={busy} onClick={() => run(async () => { if (!draft) return; const name = `${newDate.slice(0, 7)}.xlsx`; if (drafts.some(d => d.name === name && d.scope === draft.scope)) throw new Error('本机已存在此月份，请从账本列表打开'); const next = await MonthlyWorkbook.open(draft.data); next.rollover(newDate); await activate(await next.export(), name, { scope: draft.scope, sourceLabel: draft.sourceLabel }); startBatch(next); setNotice('新月份已创建，可直接逐行更新余额并补充本期流水。'); })}>创建本机账本</button></div></Dialog>
  </div>;
}
