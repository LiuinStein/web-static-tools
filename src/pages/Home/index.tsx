import React, { useState } from 'react';
import { Link } from 'ice';
import './style.css';

const tools = [
  { path: '/monthly-review', title: '月度复盘', category: '复盘记录', icon: '▦', description: '汇总资产与负债，核对每月余额，回顾投入、收益和资产变化。', tags: ['资产负债', '批量记账', 'Excel / OneDrive'], scene: '每月整理财务时', featured: true },
  { path: '/trading-journal', title: '交易日记', category: '复盘记录', icon: '✎', description: '记录每笔交易与投资想法，整理持仓，让下一次决策有据可循。', tags: ['交易记录', '持仓管理', 'Excel / OneDrive'], scene: '交易之后，及时记录', featured: true },
  { path: '/finance/return', title: '收益率计算', category: '金融计算', icon: '%', description: '用 XIRR 计算多笔、不规则现金流对应的年化收益率。', tags: ['XIRR', '年化收益'], scene: '想知道投资实际回报时' },
  { path: '/finance/monetary', title: '货币与固收', category: '金融计算', icon: '¥', description: '换算万份收益与年化利率，计算按日利息、比较产品转换。', tags: ['利率换算', '利息计算'], scene: '比较理财产品时' },
  { path: '/finance/bond', title: '债券计算', category: '金融计算', icon: '≋', description: '根据债券价格、利息和期限，辅助测算债券投资收益。', tags: ['债券', '收益测算'], scene: '评估债券投资时' },
  { path: '/finance/stock', title: '股票交易费用', category: '金融计算', icon: '→', description: '计算港股、美股交易佣金与费用，提前了解交易成本。', tags: ['港股', '美股', '佣金'], scene: '股票下单之前' },
  { path: '/finance/future', title: '黄金价格换算', category: '金融计算', icon: '◇', description: '将美元 / 盎司换算为人民币 / 克，方便比较黄金报价。', tags: ['黄金', '单位换算'], scene: '比较内外盘金价时' },
  { path: '/common', title: '日期计算', category: '日常工具', icon: '▤', description: '计算两个日期之间的间隔，处理日常日期与期限问题。', tags: ['日期间隔', '天数'], scene: '需要核对日期时' },
  { path: '/code/encoding', title: '文本编解码', category: '开发工具', icon: '</>', description: '快速进行 Base64、URL 编码与解码，处理常见文本转换。', tags: ['Base64', 'URL'], scene: '开发调试、处理链接时' },
];
const categories = ['全部', '复盘记录', '金融计算', '日常工具', '开发工具'];

export default function Home() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');
  const filtered = tools.filter(tool => (category === '全部' || tool.category === category) &&
    `${tool.title} ${tool.description} ${tool.tags.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <main className="tools-home">
      <section className="home-intro">
        <div className="home-eyebrow">SHAOQUN TOOLS · 你的日常工具箱</div>
        <h1>把记录留下，把事情算清。</h1>
        <p>从每笔交易到每月复盘，从收益测算到日常换算。<br />选一个顺手的工具，开始今天的整理。</p>
        <div className="home-intro-actions"><Link to="/monthly-review" className="home-primary">开始月度复盘 <span aria-hidden="true">→</span></Link><a href="#home-toolbox" onClick={event => { event.preventDefault(); document.getElementById('home-toolbox')?.scrollIntoView({ behavior: 'smooth' }); }}>浏览全部工具 <span aria-hidden="true">↓</span></a></div>
        <div className="home-intro-mark" aria-hidden="true"><span>记录</span><span className="home-mark-line" /><span>计算</span><span className="home-mark-line" /><span>复盘</span></div>
      </section>

      <section className="home-section" aria-labelledby="home-recommend-heading">
        <div className="home-section-heading"><div><span className="home-kicker">从这里开始</span><h2 id="home-recommend-heading">值得养成习惯的两件事</h2></div><span className="home-heading-note">记录当下，也看见长期变化</span></div>
        <div className="home-featured-grid">{tools.filter(tool => tool.featured).map((tool, index) => <Link to={tool.path} key={tool.path} className={`home-featured home-featured-${index}`}>
          <div className="home-feature-top"><span className="home-icon" aria-hidden="true">{tool.icon}</span><span className="home-scene">{tool.scene}</span><span className="home-card-arrow" aria-hidden="true">→</span></div>
          <h3>{tool.title}</h3><p>{tool.description}</p><div className="home-card-bottom"><div className="home-tags">{tool.tags.map(tag => <span key={tag}>{tag}</span>)}</div><span className="home-enter">打开工具 →</span></div>
        </Link>)}</div>
      </section>

      <section id="home-toolbox" className="home-section" aria-labelledby="home-all-heading">
        <div className="home-section-heading"><div><span className="home-kicker">按需取用</span><h2 id="home-all-heading">找到此刻需要的工具</h2></div><label className="home-search"><span aria-hidden="true">⌕</span><input type="search" aria-label="搜索工具" placeholder="搜索工具、用途或关键词" value={query} onChange={event => setQuery(event.target.value)} /></label></div>
        <div className="home-filter-row"><div className="home-filters" aria-label="工具分类">{categories.map(item => <button key={item} type="button" aria-pressed={category === item} className={category === item ? 'is-active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div><span className="home-count" aria-live="polite">{filtered.length} 个工具</span></div>
        <div className="home-tool-grid">{filtered.map(tool => <Link to={tool.path} className="home-tool-card" key={tool.path}><div className="home-tool-top"><span className="home-icon" aria-hidden="true">{tool.icon}</span><span className="home-category">{tool.category}</span><span className="home-card-arrow" aria-hidden="true">→</span></div><h3>{tool.title}</h3><p>{tool.description}</p><div className="home-tags">{tool.tags.map(tag => <span key={tag}>{tag}</span>)}</div></Link>)}</div>
        {filtered.length === 0 && <div className="home-empty"><h3>暂时没有匹配的工具</h3><p>试试“收益”“日期”或“Excel”，也可以重新查看全部工具。</p><button type="button" onClick={() => { setQuery(''); setCategory('全部'); }}>重置筛选</button></div>}
      </section>
      <aside className="home-tip"><span aria-hidden="true">→</span><p><strong>给每一次复盘一个起点</strong><br />交易后留下记录，月末整理资产，再用收益率工具核对回报。</p><Link to="/trading-journal">写一笔交易日记 →</Link></aside>
    </main>
  );
}
