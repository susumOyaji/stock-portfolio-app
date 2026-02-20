/**
 * Stock Portfolio Manager Logic - Scraping Method (Restored)
 */

let holdings = [];
let editingIndex = null;
let lastFetchResult = null;
let autoUpdateTimer = null;
const STORAGE_KEY = 'stock_portfolio_data';
const SETTINGS_KEY = 'stock_portfolio_settings';
const FEATURED_KEY = 'stock_portfolio_featured';

// デフォルトの注目銘柄設定
const DEFAULT_FEATURED = {
    dji: { code: '^DJI', label: 'NYダウ' },
    nasdaq: { code: '^IXIC', label: 'Nasdaq' },
    sp500: { code: '^GSPC', label: 'S&P 500' }
};

let featuredStocks = { ...DEFAULT_FEATURED };

// --- Utilities (正規化・解析の共通処理) ---
function normalizeNumberStr(val) {
    if (val === null || val === undefined) return '';
    return String(val)
        .replace(/[＋+]/g, '+')
        .replace(/[－‐−-]/g, '-')
        .replace(/,/g, '')
        .replace(/%/g, '')
        .trim();
}

function parsePercent(val) {
    if (val === null || val === undefined || val === '') return -Infinity;
    if (typeof val === 'number') return val;
    const s = normalizeNumberStr(val);
    const n = parseFloat(s);
    return isNaN(n) ? -Infinity : n;
}

function getSignClass(val) {
    const s = normalizeNumberStr(val);
    if (s.startsWith('+')) return 'value-positive';
    if (s.startsWith('-')) return 'value-negative';
    return '';
}

function normalizeDayChangeValue(val) {
    const s = normalizeNumberStr(val);
    if (!s) return 0;
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    loadData();
    loadFeaturedData();
    renderUI();
    setupEventListeners();

    // 市場状態を確認
    const marketStatus = getMarketStatus();
    updateHeaderWithMarketStatus();

    // 起動時のローディング表示
    if (holdings.length > 0) {
        showLoadingState();
        try {
            await Promise.all([
                refreshMarketIndices(),
                refreshAllPrices()
            ]);
        } finally {
            hideLoadingState();
        }
    } else {
        refreshMarketIndices();
    }

    // 設定された間隔で自動更新（または待機）を開始
    const savedInterval = localStorage.getItem(SETTINGS_KEY) || '2';
    const intervalEl = document.getElementById('update-interval');
    if (intervalEl) intervalEl.value = savedInterval;
    startAutoUpdate(parseInt(savedInterval));

    if (!marketStatus.isOpen) {
        console.log(`市場は現在閉場中です（${marketStatus.label}）`);
    }
});

// --- Market Status & Helpers ---
function getMarketStatus() {
    const now = new Date();
    const day = now.getDay(); // 0:Sun, 6:Sat
    const hour = now.getHours();
    const minute = now.getMinutes();
    const time = hour * 60 + minute;

    // 土日
    if (day === 0 || day === 6) {
        return { isOpen: false, status: 'weekend', label: 'Closed (Weekend)', color: 'var(--text-muted)' };
    }

    // 前場（9:00-11:30）
    if (time >= 9 * 60 && time < 11 * 60 + 30) {
        return { isOpen: true, status: 'morning', label: 'Morning Session', color: 'var(--success)' };
    }
    // 昼休み（11:30-12:30）
    if (time >= 11 * 60 + 30 && time < 12 * 60 + 30) {
        return { isOpen: false, status: 'lunch', label: 'Lunch Break', color: 'var(--warning)' };
    }
    // 後場（12:30-15:25）
    if (time >= 12 * 60 + 30 && time < 15 * 60 + 25) {
        return { isOpen: true, status: 'afternoon', label: 'Afternoon Session', color: 'var(--success)' };
    }
    // クロージング・オークション（15:25-15:30）
    if (time >= 15 * 60 + 25 && time < 15 * 60 + 30) {
        return { isOpen: true, status: 'closing', label: 'Closing Auction', color: 'var(--warning)' };
    }
    // 市場終了後（15:30以降）
    if (time >= 15 * 60 + 30) {
        return { isOpen: false, status: 'closed', label: 'Market Closed', color: 'var(--text-muted)' };
    }
    // 市場開始前
    return { isOpen: false, status: 'pre_market', label: 'Pre-Market', color: 'var(--text-muted)' };
}

function getDataFreshness(updateTime) {
    if (!updateTime || updateTime === '--:--' || updateTime.includes('日')) {
        return { isFresh: false, label: '未取得', color: 'var(--text-muted)', ageInHours: null };
    }

    const now = new Date();
    // 時間と分を抽出 (例: "15:00")
    const match = updateTime.match(/(\d{1,2}):(\d{2})/);
    if (!match) return { isFresh: false, label: updateTime, color: 'var(--text-muted)' };

    const [_, h, m] = match;
    const updateDate = new Date();
    updateDate.setHours(parseInt(h), parseInt(m), 0, 0);

    // 更新時刻が未来の場合（日付またぎ）、前日とみなす
    if (updateDate > now) {
        updateDate.setDate(updateDate.getDate() - 1);
    }

    // 土日の場合は直近の平日（金曜日）まで遡る
    while (updateDate.getDay() === 0 || updateDate.getDay() === 6) {
        updateDate.setDate(updateDate.getDate() - 1);
    }

    const ageInMs = now - updateDate;
    const ageInHours = ageInMs / (1000 * 60 * 60);

    if (ageInHours < 1) {
        return { isFresh: true, label: `${Math.floor(ageInMs / 60000)}分前`, color: 'var(--success)', ageInHours };
    } else if (ageInHours < 24) {
        return { isFresh: false, label: `${Math.floor(ageInHours)}時間前`, color: 'var(--warning)', ageInHours };
    } else {
        return { isFresh: false, label: `${Math.floor(ageInHours / 24)}日前`, color: 'var(--danger)', ageInHours };
    }
}

function updateHeaderWithMarketStatus() {
    // フローティング表示：既存のバッジを削除
    let badge = document.querySelector('.market-status-badge');
    if (badge) badge.remove();

    const status = getMarketStatus();
    badge = document.createElement('div');
    badge.className = 'market-status-badge';
    badge.style.color = status.color;
    badge.style.border = `2px solid ${status.color}`;

    // シンプルな単色背景
    badge.style.background = status.isOpen
        ? 'rgba(16, 185, 129, 0.15)'
        : 'rgba(148, 163, 184, 0.15)';

    let labelText = status.label;

    badge.innerHTML = `<span>${labelText}</span>`;
    document.body.appendChild(badge);
}

// 未取得時は見やすく `-- (--%)` を返すユーティリティ
function formatDayChangeDisplay(change, changePercent) {
    // 空・未取得表現を標準化
    if (!change || !changePercent) return '-- (--%)';

    // スクレイピングの既定値 '0' / '0%' が残っている場合は未取得とみなす
    if ((change === '0' || change === '0.00') && (changePercent === '0%' || changePercent === '0.00%')) {
        return '-- (--%)';
    }

    return `${change} (${changePercent})`;
}

function showLoadingState() {
    const tableBody = document.getElementById('portfolio-body');
    if (!tableBody) return;

    // 行がなければ何もしない（初回など）
    if (tableBody.children.length === 0) return;

    // 既存のオーバーレイがあれば削除
    const existing = tableBody.parentElement.querySelector('.loading-overlay');
    if (existing) existing.remove();

    // テーブル全体を覆うオーバーレイ
    const overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    overlay.innerHTML = `<div class="loading-text">最新データを取得中...</div>`;

    // table-container は relative である必要がある
    const container = tableBody.closest('.table-container');
    if (container) {
        container.style.position = 'relative';
        container.appendChild(overlay);
    }
}

function hideLoadingState() {
    const overlay = document.querySelector('.loading-overlay');
    if (overlay) overlay.remove();
}

function setupEventListeners() {
    const codeInput = document.getElementById('code');
    const intervalSelect = document.getElementById('update-interval');
    let fetchTimeout = null;

    // 更新間隔の変更
    if (intervalSelect) {
        intervalSelect.addEventListener('change', (e) => {
            const minutes = parseInt(e.target.value);
            localStorage.setItem(SETTINGS_KEY, minutes);
            startAutoUpdate(minutes);
        });
    }

    codeInput.addEventListener('input', (e) => {
        const code = e.target.value.trim();
        clearTimeout(fetchTimeout);
        if (code.length >= 4 || code.includes('^') || code.includes('=') || code.includes('.')) {
            fetchTimeout = setTimeout(() => autoFetchStockData(code), 800);
        }
    });

    document.getElementById('stock-form').addEventListener('submit', handleFormSubmit);
    document.getElementById('cancel-btn').addEventListener('click', cancelEdit);
    document.getElementById('refresh-all-btn').addEventListener('click', refreshAllPrices);

    const addBtn = document.getElementById('add-stock-trigger');
    const closeBtn = document.getElementById('modal-close');
    const overlay = document.getElementById('modal-overlay');

    addBtn.addEventListener('click', () => openModal());
    closeBtn.addEventListener('click', () => closeModal());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
}

function openModal(isEdit = false) {
    const overlay = document.getElementById('modal-overlay');
    const title = document.getElementById('modal-title');
    const submitBtn = document.getElementById('submit-btn');
    const cancelBtn = document.getElementById('cancel-btn');

    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    if (isEdit) {
        title.textContent = '銘柄の編集';
        submitBtn.textContent = '更新';
        cancelBtn.style.display = 'block';
    } else {
        title.textContent = '銘柄の追加';
        submitBtn.textContent = '追加';
        cancelBtn.style.display = 'none';
        document.getElementById('stock-form').reset();
        editingIndex = null;
    }
}

function closeModal() {
    document.getElementById('modal-overlay').style.display = 'none';
    document.body.style.overflow = 'auto';
    editingIndex = null;
}

// --- Persistence ---
function loadData() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        try { holdings = JSON.parse(saved); } catch (e) { holdings = []; }
    }
}
function saveData() { localStorage.setItem(STORAGE_KEY, JSON.stringify(holdings)); }

function loadFeaturedData() {
    const saved = localStorage.getItem(FEATURED_KEY);
    if (saved) {
        try { featuredStocks = JSON.parse(saved); } catch (e) { featuredStocks = { ...DEFAULT_FEATURED }; }
    }
}
function saveFeaturedData() { localStorage.setItem(FEATURED_KEY, JSON.stringify(featuredStocks)); }

// 自動更新タイマーの管理
// 市場が開いているか定期的にチェックし、開いていればデータ更新を行う
let lastUpdateTime = 0;

function startAutoUpdate(minutes) {
    if (autoUpdateTimer) {
        clearInterval(autoUpdateTimer);
        autoUpdateTimer = null;
    }

    if (minutes <= 0) {
        console.log('Auto update disabled');
        return;
    }

    // 更新チェックの間隔（基本は1分ごと、ただし設定間隔がそれより短ければそれに合わせる）
    // 市場再開を検知するために、最大でも1分間隔でチェックする
    const checkInterval = Math.min(minutes * 60 * 1000, 60 * 1000);

    // 初回実行時刻を記録
    lastUpdateTime = Date.now();

    autoUpdateTimer = setInterval(() => {
        const now = Date.now();
        const marketStatus = getMarketStatus();

        // ヘッダーの市場状態表示は毎回更新（時計代わり）
        updateHeaderWithMarketStatus();

        // 前回の更新から、設定された間隔以上経過しているか？
        if (now - lastUpdateTime >= minutes * 60 * 1000) {
            if (marketStatus.isOpen) {
                console.log('Market is open, updating prices...');
                refreshAllPrices();
                lastUpdateTime = now;
            } else {
                // 市場が閉まっている場合は更新をスキップ
                // ただし、コンソールにはログを出して動作を確認できるようにする
                console.log(`Market is closed (${marketStatus.status}), skipping update.`);

                // 注意: lastUpdateTime は更新しない
                // これにより、市場が開いた瞬間に（次のチェックタイミングで）即座に更新が走るようになる
            }
        }
    }, checkInterval);

    console.log(`Auto update started: target interval ${minutes} min (check interval ${checkInterval / 1000}s)`);
}

// --- Calculation & Logic ---
function formatCurrency(value) {
    return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(Math.round(value));
}
function formatPercent(value) { return value.toFixed(2) + '%'; }

function calculateMetrics(stock) {
    const valuation = (stock.currentPrice || 0) * stock.quantity;
    const costBasis = stock.purchasePrice * stock.quantity;
    const profitLoss = valuation - costBasis;
    const profitLossRate = costBasis !== 0 ? (profitLoss / costBasis) * 100 : 0;
    return { valuation, costBasis, profitLoss, profitLossRate };
}

// --- UI Rendering ---
function renderUI() {
    const tableBody = document.getElementById('portfolio-body');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    // 市場状態による警告表示
    const marketStatus = getMarketStatus();

    // 中部の警告表示を廃止（上部に統合するため、既存があれば削除のみ行う）
    const existingWarning = document.querySelector('.market-closed-warning');
    if (existingWarning) existingWarning.remove();


    // 前日比（％）で降順にソートして表示
    const sortedHoldings = [...holdings].sort((a, b) => {
        const percentA = parsePercent(a.dayChangePercent);
        const percentB = parsePercent(b.dayChangePercent);
        return percentB - percentA;
    });

    let totalValuation = 0, totalCost = 0;

    sortedHoldings.forEach((stock) => {
        const index = holdings.indexOf(stock);
        const metrics = calculateMetrics(stock);
        totalValuation += metrics.valuation;
        totalCost += metrics.costBasis;

        const row = document.createElement('tr');
        const plClass = metrics.profitLoss >= 0 ? 'value-positive' : 'value-negative';
        const plSign = metrics.profitLoss >= 0 ? '+' : '';

        // データ鮮度
        const freshness = getDataFreshness(stock.time);

        // 表示用時刻の調整（不揃いを解消）
        const displayTime = stock.time || '--:--';
        const checkTimeStr = stock.checkTime || '--:--';

        // 日次変化の表示を整形
        const _changeDisplay = formatDayChangeDisplay(stock.dayChange, stock.dayChangePercent);
        const _match = _changeDisplay.match(/^(.+?)\s+\((.+)\)$/);
        const _changeVal = _match ? _match[1] : _changeDisplay;
        const _changePct = _match ? _match[2] : '';

        row.innerHTML = `
            <td>
                <div class="stock-name">${stock.name}</div>
                <div class="stock-code">${stock.code}</div>
                <div style="display: flex; flex-wrap: wrap; gap: 0.2rem; margin-top: 0.4rem;">
                    ${(stock.keywords || []).map(k => `<span class="badge">${k}</span>`).join('')}
                </div>
            </td>
            <td>${stock.quantity.toLocaleString()}</td>
            <td>${formatCurrency(stock.purchasePrice)}</td>
            <td>
                <div class="price-current">${stock.currentPrice ? formatCurrency(stock.currentPrice) : '--'}</div>
                <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 0.3rem; margin-top: 0.2rem;">
                    <div style="font-size: 0.65rem; color: var(--text-muted);">${displayTime}</div>
                    ${!marketStatus.isOpen ? `<div style="font-size: 0.5rem; color: var(--text-muted); opacity: 0.7; font-family: monospace; background: rgba(0,0,0,0.05); padding: 0 2px; border-radius: 2px;" title="Selector">${stock.selector || 'N/A'}</div>` : ''}
                </div>
                ${!marketStatus.isOpen && freshness.ageInHours > 6 ?
                `<div style="font-size: 0.6rem; color: var(--warning); margin-top: 0.1rem;">⚠️ 前日終値</div>` : ''}
            </td>
            <td>
                <div class="${getSignClass(stock.dayChange)}" style="font-weight: 600;">
                    ${_changeVal}
                </div>
                <div class="${getSignClass(stock.dayChange)}" style="font-size: 0.75rem;">
                    ${_changePct}
                </div>
            </td>
            <td>${formatCurrency(metrics.valuation)}</td>
            <td>
                <div class="${plClass}" style="font-weight: 700;">${plSign}${formatCurrency(metrics.profitLoss)}</div>
                <div class="${plClass}" style="font-size: 0.75rem;">${plSign}${formatPercent(metrics.profitLossRate)}</div>
            </td>
            <td>
                <div style="display: flex; gap: 0.4rem;">
                    <button class="btn-icon btn-edit" onclick="editStock(${index})">✏️</button>
                    <button class="btn-icon btn-delete" onclick="deleteStock(${index})">🗑️</button>
                </div>
            </td>
        `;
        tableBody.appendChild(row);
    });

    const totalPL = totalValuation - totalCost;
    const totalRate = totalCost !== 0 ? (totalPL / totalCost) * 100 : 0;

    // 総評価額の前日比を合計
    let totalDayChange = 0;
    holdings.forEach(stock => {
        const changeVal = normalizeDayChangeValue(stock.dayChange);
        totalDayChange += changeVal * (stock.quantity || 0);
    });

    document.getElementById('total-valuation').textContent = formatCurrency(totalValuation);

    const tdcEl = document.getElementById('total-day-change');
    if (tdcEl) {
        const sign = totalDayChange >= 0 ? '+' : '';
        tdcEl.textContent = `前日比: ${sign}${formatCurrency(totalDayChange)}`;
        tdcEl.className = totalDayChange >= 0 ? 'value-positive' : 'value-negative';
    }

    const totalSign = totalPL >= 0 ? '+' : '';
    document.getElementById('total-profit-loss').textContent = totalSign + formatCurrency(totalPL);

    const tprEl = document.getElementById('total-profit-rate');
    const plColorClass = totalPL >= 0 ? 'value-positive' : 'value-negative';

    if (tprEl) {
        tprEl.textContent = `損益率: ${totalSign}${formatPercent(totalRate)}`;
        tprEl.className = plColorClass;
    }

    document.getElementById('total-profit-loss').className = `card-value ${plColorClass}`;
}

// --- Proxy & Fetching ---
async function fetchWithProxy(url) {
    const ts = Date.now();
    // 1. Cloudflare Functions (Dedicated Proxy)
    try {
        const localProxyUrl = `/proxy?url=${encodeURIComponent(url)}&_cb=${ts}`;
        const response = await fetch(localProxyUrl, { cache: 'no-store' });
        if (response.ok) {
            const text = await response.text();
            if (text && text.length > 500) return text;
        }
    } catch (e) {
        console.warn('Local proxy failed:', e);
    }

    // 2. Public Proxies (Fallback)
    const proxies = [
        (u) => `https://corsproxy.io/?${encodeURIComponent(u + (u.includes('?') ? '&' : '?') + '_cb=' + ts)}`,
        (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u + (u.includes('?') ? '&' : '?') + '_cb=' + ts)}`
    ];
    for (const proxyFn of proxies) {
        try {
            const response = await fetch(proxyFn(url), { cache: 'no-store' });
            if (response.ok) {
                const text = proxyFn.toString().includes('allorigins') ? (await response.json()).contents : await response.text();
                if (text && text.length > 500) return text;
            }
        } catch (e) {
            console.error('Public proxy failed:', e);
        }
    }
    return null;
}

// --- Scraping Engine ---
async function scrapeYahooJapan(code) {
    // 銘柄コードの正規化
    let scrapeCode = code;
    if (scrapeCode === '^N225') scrapeCode = '998407.O';
    if (scrapeCode.startsWith('USDJPY')) scrapeCode = 'USDJPY=FX';

    // symbol は URL 用。^DJI のような記号はエンコードが必要
    const symbol = /^\d{4}$/.test(scrapeCode) ? `${scrapeCode}.T` :
        (scrapeCode === '^DJI' ? '%5EDJI' :
            (scrapeCode === '^IXIC' ? '%5EIXIC' :
                (scrapeCode === '^GSPC' ? '%5EGSPC' : scrapeCode)));

    // 各種フラグ
    const isJP = symbol.endsWith('.T') || /^\d{4}/.test(symbol);
    const isDJI = code === '^DJI' || symbol === '%5EDJI' || symbol === 'DJI';
    const isNasdaq = code === '^IXIC' || symbol === '%5EIXIC' || symbol === 'IXIC';
    const isSP500 = code === '^GSPC' || symbol === '%5EGSPC' || symbol === 'GSPC';
    const isUSIndex = isDJI || isNasdaq || isSP500;
    const isNikkei = code === '^N225' || symbol === '998407.O';

    const url = `https://finance.yahoo.co.jp/quote/${symbol}?_ts=${Date.now()}`;

    try {
        const html = await fetchWithProxy(url);
        if (!html) return null;
        const doc = new DOMParser().parseFromString(html, 'text/html');

        // 0. 銘柄名
        let name = null;
        const ogTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute('content');
        if (ogTitle && !ogTitle.includes('Yahoo!ファイナンス一覧')) {
            // タイトルから余計な情報を削る
            let cleaned = ogTitle.split('【')[0].split('：')[0].split(':')[0].split(' - ')[0].trim();
            // 「の株価・株式情報」などの定型句を削除
            name = cleaned.replace(/の株価・株式情報$/, '').replace(/の株価$/, '').replace(/株価・株式情報$/, '').trim();
        }

        if (!name || name === '株価・株式情報') {
            const h1 = doc.querySelector('header h1') || doc.querySelector('h1');
            if (h1) {
                let h1Text = h1.textContent;
                h1Text = h1Text.replace(/\d{4,}/g, ''); // 銘柄コード削除
                h1Text = h1Text.replace(/[【［\[(].*?[】］\])]/g, ''); // カッコ内削除
                h1Text = h1Text.replace(/の株価・株式情報$/, '').replace(/の株価$/, '').trim();
                name = h1Text;
            }
        }

        // 1. 株価 (セレクタの優先順位を調整: リアルタイム優先)
        let price = null;
        let usedSelector = null;
        const priceSelectors = [
            // Add Japanese Stock specific selector first (e.g., for 4-digit codes ending in .T)
            '._CommonPriceBoard__price_1g7gt_64 ._StyledNumber__value_1arhg_9', // DJI Price Selector
            'span.PriceBoard__price__1V0k span.StyledNumber__value__3rXW', // Japanese Stock Price Selector
            '._3rXWJKZ', // 主要な現在値
            '.StyledPriceText',
            '[data-test-id="price"]',
            'span[class*="Price__value"]',
            '._3m7vS',
            '[data-field="regularMarketPrice"]',
            'span[class*="StyledPrice"]',
            '._3P_pZ',
            '[class*="price_"]',
            '[class*="Price_price"]'
        ];

        for (const sel of priceSelectors) {
            const el = doc.querySelector(sel);
            if (el) {
                let rawTxt = el.textContent.trim();
                // 前日比の記号(＋, －, %)が含まれている場合は、価格ではない可能性が高いのでスキップ
                if (rawTxt.includes('＋') || rawTxt.includes('－') || rawTxt.includes('%')) continue;

                let txt = rawTxt.replace(/,/g, '');
                if (txt === '---' || txt === '0') continue;

                // 数値部分だけ取り出す
                const match = txt.match(/[\d.]+/);
                if (match) {
                    price = parseFloat(match[0]);
                    usedSelector = sel;
                    break;
                }
            }
        }

        // --- スマート探索 (Smart Search): セレクタで見つからない場合の自動探索 ---
        if (price === null) {
            console.log(`[SmartSearch] Trying fallback search for ${code}...`);

            // 戦略A: 「前日終値」や「基準値」を優先的に探す（市場開始前対策）
            const preKeywords = ['前日終値', '基準値', 'Close'];
            const allElements = Array.from(doc.querySelectorAll('span, div, p, dt, dd, th, td, strong, b'));

            for (const kw of preKeywords) {
                // キーワードのテキストノードを直接含んでいるか、または直下の子要素にあるか
                const kwEl = allElements.find(el => {
                    const t = el.textContent.trim();
                    return t === kw || (t.includes(kw) && t.length < 15);
                });

                if (kwEl) {
                    // 親、または親の親、または自分自身から数値を探す
                    const searchRoots = [kwEl, kwEl.parentElement, kwEl.parentElement?.parentElement];
                    for (const root of searchRoots) {
                        if (!root) continue;

                        // textContent 内の数値も正規表現で直接探す (タグに分かれていても連結される)
                        // カンマを除去してからマッチング
                        const text = root.textContent.replace(/,/g, '');
                        const matches = text.match(/[\d.]+/g);
                        if (matches) {
                            for (const m of matches) {
                                const val = parseFloat(m);
                                if (!isNaN(val) && val > 0 && val < 500000) { // 株価として現実的な範囲
                                    price = val;
                                    break;
                                }
                            }
                        }
                        if (price !== null) {
                            console.log(`[SmartSearch] Found price via pre-keyword "${kw}": ${price}`);
                            usedSelector = `Smart:${kw}`;
                            break;
                        }
                    }
                }
                if (price !== null) break;
            }

            if (price === null) {
                // 戦略B: 「現在値」や「円」といったキーワードの近くにある数値を探索
                const keywords = ['現在値', '時価', 'リアルタイム', '円'];
                // キーワードを含む要素を探す
                const keywordEls = allElements.filter(el =>
                    keywords.some(k => el.textContent.includes(k)) && el.textContent.length < 20
                );

                for (const keyEl of keywordEls) {
                    const context = keyEl.parentElement?.parentElement || keyEl.parentElement;
                    if (!context) continue;

                    const candidates = Array.from(context.querySelectorAll('*'))
                        .filter(el => {
                            const txt = el.textContent.trim().replace(/,/g, '');
                            return /^-?[\d.]+$/.test(txt) && txt.length > 0 && txt.length < 15;
                        });

                    if (candidates.length > 0) {
                        const val = parseFloat(candidates[0].textContent.replace(/,/g, ''));
                        if (!isNaN(val) && val > 0) {
                            price = val;
                            console.log(`[SmartSearch] Found price via keyword "${keyEl.textContent}": ${price}`);
                            break;
                        }
                    }
                }
            }
        }

        // JSON-LD からの補完 (極めて正確)
        if (!price || !name) {
            const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
            for (const script of scripts) {
                try {
                    const data = JSON.parse(script.textContent);
                    const item = Array.isArray(data) ? data[0] : data;
                    if (item.offers?.price) price = parseFloat(item.offers.price);
                    if (item.name && (!name || name === '株価・株式情報')) name = item.name;
                } catch (e) { }
            }
        }

        // 2. 前日比 (金額と率)
        let dayChange = '0';
        let dayChangePercent = '0%';

        // DJI/Nasdaq/S&P500 等の米国指数専用の当日変化率取得ロジック
        if (isUSIndex) {
            const indexChangeEl = doc.querySelector('._PriceChangeLabel__primary_hse06_56 ._StyledNumber__value_1arhg_9');
            if (indexChangeEl) {
                dayChange = indexChangeEl.textContent.trim().replace(/,/g, '');
                if (!dayChange.startsWith('+') && !dayChange.startsWith('-') && dayChange !== '0') {
                    dayChange = '+' + dayChange;
                }
            }
            const indexChangePercentEl = doc.querySelector('._PriceChangeLabel__secondary_hse06_62 ._StyledNumber__value_1arhg_9');
            if (indexChangePercentEl) {
                dayChangePercent = indexChangePercentEl.textContent.trim().replace(/,/g, '') + '%';
                if (!dayChangePercent.startsWith('+') && !dayChangePercent.startsWith('-') && dayChangePercent !== '0%') {
                    dayChangePercent = '+' + dayChangePercent;
                }
            }
        }

        // 日経平均 (998407.O) 専用の当日変化率取得ロジック
        if (isNikkei && dayChange === '0' && dayChangePercent === '0%') {
            // 日経平均のセレクタ（通常の日本株と共通）
            const nikkeiDayChangeEl = doc.querySelector('span.PriceChangeLabel__primary__Y_ut span.StyledNumber__value__3rXW');
            if (nikkeiDayChangeEl) {
                dayChange = nikkeiDayChangeEl.textContent.trim().replace(/,/g, '');
                if (!dayChange.startsWith('+') && !dayChange.startsWith('-') && dayChange !== '0') {
                    dayChange = '+' + dayChange;
                }
            }
            const nikkeiDayChangePercentEl = doc.querySelector('span.PriceChangeLabel__secondary__3BXI span.StyledNumber__value__3rXW');
            if (nikkeiDayChangePercentEl) {
                dayChangePercent = nikkeiDayChangePercentEl.textContent.trim().replace(/,/g, '') + '%';
                if (!dayChangePercent.startsWith('+') && !dayChangePercent.startsWith('-') && dayChangePercent !== '0%') {
                    dayChangePercent = '+' + dayChangePercent;
                }
            }
        }

        // 日本株 (4桁コード) 専用の当日変化率取得ロジック
        if (isJP && symbol.endsWith('.T') && dayChange === '0' && dayChangePercent === '0%') {
            const jpDayChangeEl = doc.querySelector('span.PriceChangeLabel__primary__Y_ut span.StyledNumber__value__3rXW');
            if (jpDayChangeEl) {
                dayChange = jpDayChangeEl.textContent.trim().replace(/,/g, '');
                if (!dayChange.startsWith('+') && !dayChange.startsWith('-') && dayChange !== '0') {
                    dayChange = '+' + dayChange;
                }
            }
            const jpDayChangePercentEl = doc.querySelector('span.PriceChangeLabel__secondary__3BXI span.StyledNumber__value__3rXW');
            if (jpDayChangePercentEl) {
                dayChangePercent = jpDayChangePercentEl.textContent.trim().replace(/,/g, '') + '%';
                if (!dayChangePercent.startsWith('+') && !dayChangePercent.startsWith('-') && dayChangePercent !== '0%') {
                    dayChangePercent = '+' + dayChangePercent;
                }
            }
        }

        // DJI専用のロジックで値が取得できなかった場合のみ、汎用ロジックを試す
        if (dayChange === '0' && dayChangePercent === '0%') { // <--- New condition
            // 戦略A: 専用クラスからの抽出（個別に取得できる場合）
            const amtEl = doc.querySelector('._3S6pP');
            const pctEl = doc.querySelector('._399tF');

            if (amtEl) {
                dayChange = amtEl.textContent.trim().replace(/＋/g, '+').replace(/－/g, '-').replace(/,/g, '');
                // 数値のみで符号がない場合は + を補完（UIの色付け用）
                if (dayChange !== '0' && dayChange !== '0.00' && !dayChange.startsWith('+') && !dayChange.startsWith('-')) {
                    dayChange = '+' + dayChange;
                }
            }

            if (pctEl) {
                dayChangePercent = pctEl.textContent.trim().replace(/＋/g, '+').replace(/－/g, '-').replace(/[()%]/g, '') + '%';
                if (dayChangePercent !== '0%' && dayChangePercent !== '0.00%' && !dayChangePercent.startsWith('+') && !dayChangePercent.startsWith('-')) {
                    dayChangePercent = '+' + dayChangePercent;
                }
            }
            // 戦略B: まとまった文字列（"前日比 +10 (+0.5%)" など）からのフォールバック抽出
            if (dayChange === '0' || dayChangePercent === '0%') {
                const candidates = Array.from(doc.querySelectorAll('span, div, td'))
                    .filter(el => {
                        const t = el.textContent.trim();
                        if (t.includes(':')) return false;
                        return (t.includes('＋') || t.includes('－') || t.includes('%')) && t.length < 40 && !el.classList.contains('_3P_pZ');
                    });

                if (candidates.length > 0) {
                    const best = candidates.find(el => (el.textContent.includes('＋') || el.textContent.includes('－')) && el.textContent.includes('%')) || candidates[0];
                    const clean = best.textContent.replace(/－/g, '-').replace(/＋/g, '+').replace(/,/g, '');
                    const matches = clean.match(/[+-]?[\d.]+/g);
                    if (matches && matches.length >= 1) {
                        dayChange = dayChange === '0' ? matches[0] : dayChange;
                        if (!dayChange.startsWith('+') && !dayChange.startsWith('-') && dayChange !== '0') dayChange = '+' + dayChange;

                        if (matches.length >= 2) {
                            // dayChangePercent の符号を dayChange に合わせる（一貫性を保つ）
                            let percentValue = matches[1];
                            if (dayChange.startsWith('-')) {
                                dayChangePercent = '-' + percentValue.replace(/^-/, '') + '%';
                            } else {
                                dayChangePercent = '+' + percentValue.replace(/^[+-]/, '') + '%';
                            }
                        } else if (dayChangePercent === '0%') {
                            const pMatch = clean.match(/[\d.]+(?=%)/);
                            if (pMatch) {
                                let percentValue = pMatch[0];
                                if (dayChange.startsWith('-')) {
                                    dayChangePercent = '-' + percentValue + '%';
                                } else {
                                    dayChangePercent = '+' + percentValue + '%';
                                }
                            }
                        }
                    }
                }
            }
        }

        // 3. 市場更新時刻 (より詳細な探索)
        let updateTime = '--:--';
        const marketStatus = getMarketStatus();

        // 市場開始前の日本株は無条件で "--:--" とする
        if (isJP && marketStatus.status === 'pre_market') {
            updateTime = '--:--';
        } else {
            // 米国指数専用の時刻取得ロジック
            if (isUSIndex) {
                const indexTimeEl = doc.querySelector('._CommonPriceBoard__times_1g7gt_55 time');
                if (indexTimeEl) {
                    const tMatch = indexTimeEl.textContent.trim().match(/\d{1,2}:\d{2}/);
                    if (tMatch) {
                        updateTime = tMatch[0];
                    }
                }
            }

            // Fallback to generic time selectors if DJI specific logic didn't find anything
            if (updateTime === '--:--') {
                const timeSelectors = [
                    'span[class*="Price_time"]',
                    '._18i9z',
                    'time',
                    '[data-field="regularMarketTime"]'
                ];

                let foundTime = null;
                // ページ全体から "--:--" を優先的に探す
                if (doc.body.textContent.includes('--:--')) {
                    foundTime = '--:--';
                }

                if (!foundTime) {
                    for (const sel of timeSelectors) {
                        const el = doc.querySelector(sel);
                        if (el) {
                            const txt = el.textContent.trim();
                            if (txt.includes('--:--')) {
                                foundTime = '--:--';
                                break;
                            }
                            const tMatch = txt.match(/\d{1,2}:\d{2}/);
                            if (tMatch) {
                                foundTime = tMatch[0];
                                break;
                            }
                        }
                    }
                }
                updateTime = foundTime || '--:--';
            }
        }

        // 優先順位 2: もし上記で取れなかった場合、価格エリアの周辺から探す
        if (updateTime === '--:--') {
            const priceArea = doc.querySelector('._3m7vS, ._3P_pZ, [class*="Price_price"]')?.closest('div');
            if (priceArea) {
                const contextMatch = priceArea.parentElement?.textContent.match(/(\d{1,2}:\d{2})|--:--/);
                if (contextMatch) updateTime = contextMatch[0];
            }
        }

        // 優先順位 3: それでもダメな場合のみ、ページ全体から「リアルタイム」等の文字列と一緒に探す
        if (updateTime === '--:--' || updateTime === '15:30') {
            const rtEl = Array.from(doc.querySelectorAll('span, p, div'))
                .find(el => (el.textContent.includes('リアルタイム') || el.textContent.includes('ディレイ')) && /\d{1,2}:\d{2}/.test(el.textContent));
            if (rtEl) {
                const match = rtEl.textContent.match(/\d{1,2}:\d{2}/);
                if (match) updateTime = match[0];
            }
        }

        // 4. キーワード / テーマ (メタデータ優先で抽出)
        let keywords = [];

        // --- 手法A: Metaタグ (keywords) から抽出 ---
        const metaKeywords = doc.querySelector('meta[name="keywords"]')?.getAttribute('content');
        if (metaKeywords) {
            metaKeywords.split(/[,、]/).forEach(k => {
                const txt = k.trim();
                if (txt && !keywords.includes(txt) && txt.length < 15) keywords.push(txt);
            });
        }

        // --- 手法B: JSON-LD から関連キーワードを抽出 ---
        if (keywords.length < 3) {
            const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
            scripts.forEach(script => {
                try {
                    const data = JSON.parse(script.textContent);
                    const item = Array.isArray(data) ? data[0] : data;
                    // BreadcrumbList や category などから抽出
                    if (item.itemListElement) {
                        item.itemListElement.forEach(el => {
                            if (el.item?.name && !keywords.includes(el.item.name)) keywords.push(el.item.name);
                        });
                    }
                } catch (e) { }
            });
        }

        // --- 手法C: 従来のリンク抽出 (フォールバック) ---
        if (keywords.length < 3) {
            const keywordEls = doc.querySelectorAll('a[href*="keyword"], a[href*="theme"]');
            keywordEls.forEach(el => {
                const txt = el.textContent.trim();
                if (txt && txt.length < 15 && !keywords.includes(txt)) keywords.push(txt);
            });
        }

        // 重複削除と整理 (投資テーマとして意味のあるものに限定)
        const blacklist = ['株', '株式', '株価', 'チャート', '掲示板', 'ニュース', '時系列', '一覧', '情報', '価格', '比較', '予想', '分析'];
        keywords = keywords.filter(k => {
            const txt = k.trim();
            // 銘柄名そのもの、または銘柄名の一部である場合は除外
            if (name && (name.includes(txt) || txt.includes(name))) return false;
            // 短すぎる、またはブラックリストに含まれる一般的な言葉を除外
            if (txt.length <= 1 && txt !== '銅') return false; // 1文字は基本除外（'銅'などの意味あるものは残す可能性ありだが一旦除外が安全）
            return !blacklist.some(bad => txt.includes(bad));
        }).slice(0, 5);

        if (price || name) {
            return {
                price: price || 0,
                name: name || code,
                time: updateTime,
                selector: usedSelector, // セレクタ情報の追加
                checkTime: new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
                dayChange: dayChange,
                dayChangePercent: dayChangePercent,
                keywords: keywords.slice(0, 5)
            };
        }
    } catch (e) { console.error('Scraping error', e); }
    return null;
}

async function fetchIndividualPrice(code) {
    // スクレイピングで情報を取得
    const result = await scrapeYahooJapan(code);

    // 日本のスクレイピングで取得できなかった場合のフォールバック（米国株など）
    if (!result || result.price === 0) {
        try {
            const symbol = code.length <= 4 && !code.includes('^') ? `${code}.T` : code;
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?_ts=${Date.now()}`;
            const text = await fetchWithProxy(url);
            if (text) {
                const data = JSON.parse(text);
                const res = data.chart?.result?.[0];
                if (res) {
                    const meta = res.meta;
                    const change = meta.regularMarketPrice - meta.chartPreviousClose;
                    const p = (change / meta.chartPreviousClose) * 100;
                    return {
                        price: meta.regularMarketPrice,
                        name: result?.name || code,
                        time: new Date(meta.regularMarketTime * 1000).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
                        checkTime: new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
                        dayChange: (change >= 0 ? '+' : '') + change.toFixed(2),
                        dayChangePercent: (change >= 0 ? '+' : '') + p.toFixed(2) + '%'
                    };
                }
            }
        } catch (e) { }
    }
    return result;
}

// --- Actions ---
let lastFetchSuccessTime = null;

async function refreshAllPrices() {
    const refreshBtn = document.getElementById('refresh-all-btn');
    const refreshIcon = document.getElementById('refresh-icon');
    if (!refreshBtn || holdings.length === 0) return;

    refreshBtn.disabled = true;
    refreshIcon.style.animation = 'spin 1.5s linear infinite';

    const fetchTime = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

    try {
        await Promise.all(holdings.map(async (stock) => {
            const result = await fetchIndividualPrice(stock.code);
            if (result) {
                stock.currentPrice = result.price;
                stock.dayChange = result.dayChange;
                stock.dayChangePercent = result.dayChangePercent;
                stock.checkTime = fetchTime; // すべての行に共通のフェッチ開始時刻をセット
                stock.time = result.time;
                stock.keywords = result.keywords;
                stock.selector = result.selector;
            }
        }));
        await refreshMarketIndices(); // 日経平均と為替も更新
        saveData();
        renderUI();

        lastFetchSuccessTime = Date.now();
        document.getElementById('last-updated').textContent = `最終更新: ${new Date().toLocaleTimeString()}`;
        updateHeaderWithMarketStatus(); // ヘッダーの経過時間表示を更新
    } finally {
        refreshBtn.disabled = false;
        refreshIcon.style.animation = 'none';
    }
}

// 市場インデックス（日経平均・為替）の更新
async function refreshMarketIndices() {
    // 1. 日経平均
    const nikkeiResult = await fetchIndividualPrice('^N225');
    if (nikkeiResult) {
        const priceEl = document.getElementById('nikkei-price');
        const changeEl = document.getElementById('nikkei-change');
        if (priceEl && changeEl) {
            priceEl.textContent = `¥${nikkeiResult.price.toLocaleString()}`;
            changeEl.textContent = `前日比：${formatDayChangeDisplay(nikkeiResult.dayChange, nikkeiResult.dayChangePercent)}`;
            changeEl.className = 'index-change ' + getSignClass(nikkeiResult.dayChange);
        }
    }

    // 2. ドル/円
    const usdjpyResult = await fetchIndividualPrice('USDJPY=X');
    if (usdjpyResult) {
        const priceEl = document.getElementById('usdjpy-price');
        const changeEl = document.getElementById('usdjpy-change');
        if (priceEl && changeEl) {
            priceEl.textContent = usdjpyResult.price.toFixed(2);
            changeEl.textContent = formatDayChangeDisplay(usdjpyResult.dayChange, usdjpyResult.dayChangePercent);
            changeEl.className = 'index-change ' + getSignClass(usdjpyResult.dayChange);
        }
    }

    // 3. 注目株・市場
    const featuredItems = [
        { id: 'dji', code: featuredStocks.dji.code, format: (p) => `$${p.toLocaleString()}` },
        { id: 'nasdaq', code: featuredStocks.nasdaq.code, format: (p) => p.toLocaleString() },
        { id: 'sp500', code: featuredStocks.sp500.code, format: (p) => p.toLocaleString() }
    ];

    await Promise.all(featuredItems.map(async (item) => {
        const result = await fetchIndividualPrice(item.code);
        if (result) {
            const priceEl = document.getElementById(`${item.id}-price`);
            const changeEl = document.getElementById(`${item.id}-change`);
            const labelEl = document.getElementById(`${item.id}-label`);
            if (priceEl && changeEl) {
                priceEl.textContent = item.format(result.price);
                changeEl.textContent = formatDayChangeDisplay(result.dayChange, result.dayChangePercent);
                changeEl.className = 'featured-change ' + getSignClass(result.dayChange);
                if (labelEl && result.name && result.name !== item.code) {
                    labelEl.textContent = result.name;
                    featuredStocks[item.id].label = result.name;
                }
            }
        }
    }));
}

async function editFeaturedStock(id) {
    const current = featuredStocks[id];
    const newCode = prompt(`${current.label} の新しい企業コードを入力してください:`, current.code);

    if (newCode && newCode !== current.code) {
        featuredStocks[id].code = newCode.trim();
        saveFeaturedData();

        // 該当カードを「取得中」表示に
        const priceEl = document.getElementById(`${id}-price`);
        if (priceEl) priceEl.textContent = '取得中...';

        // 即座に更新
        const result = await fetchIndividualPrice(featuredStocks[id].code);
        if (result) {
            const changeEl = document.getElementById(`${id}-change`);
            const labelEl = document.getElementById(`${id}-label`);

            featuredStocks[id].label = result.name || newCode;
            if (labelEl) labelEl.textContent = featuredStocks[id].label;

            const format = (id === 'dji') ? (p) => `$${p.toLocaleString()}` : (p) => p.toLocaleString();
            if (priceEl) priceEl.textContent = format(result.price);
            if (changeEl) {
                changeEl.textContent = formatDayChangeDisplay(result.dayChange, result.dayChangePercent);
                changeEl.className = 'featured-change ' + getSignClass(result.dayChange);
            }
            saveFeaturedData();
        }
    }
}

async function autoFetchStockData(code) {
    const nameInput = document.getElementById('name');
    const priceInput = document.getElementById('current-price');
    nameInput.placeholder = '取得中...';
    priceInput.placeholder = '取得中...';

    const result = await fetchIndividualPrice(code);
    if (result) {
        nameInput.value = result.name;
        priceInput.value = result.price;
        lastFetchResult = result;
    }
    nameInput.placeholder = '例: トヨタ自動車';
    priceInput.placeholder = '0.00';
}

function handleFormSubmit(e) {
    e.preventDefault();
    const code = document.getElementById('code').value.trim();
    const name = document.getElementById('name').value.trim();
    const quantity = parseFloat(document.getElementById('quantity').value);
    const purchasePrice = parseFloat(document.getElementById('purchase-price').value);
    const currentPrice = parseFloat(document.getElementById('current-price').value);

    if (!code || !name || isNaN(quantity)) return;

    const data = {
        code, name, quantity, purchasePrice, currentPrice,
        dayChange: lastFetchResult?.dayChange || (editingIndex !== null ? holdings[editingIndex].dayChange : '0'),
        dayChangePercent: lastFetchResult?.dayChangePercent || (editingIndex !== null ? holdings[editingIndex].dayChangePercent : '0%'),
        checkTime: lastFetchResult?.checkTime || (editingIndex !== null ? holdings[editingIndex].checkTime : '--:--'),
        time: lastFetchResult?.time || (editingIndex !== null ? holdings[editingIndex].time : '--:--'),
        keywords: lastFetchResult?.keywords || (editingIndex !== null ? holdings[editingIndex].keywords : [])
    };

    if (editingIndex !== null) holdings[editingIndex] = data;
    else holdings.push(data);

    closeModal();
    saveData();
    renderUI();
    lastFetchResult = null;
}

function deleteStock(index) {
    if (confirm('削除しますか？')) { holdings.splice(index, 1); saveData(); renderUI(); }
}
function moveStock(index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= holdings.length) return;
    const temp = holdings[index];
    holdings[index] = holdings[newIndex];
    holdings[newIndex] = temp;
    saveData();
    renderUI();
}
function editStock(index) {
    editingIndex = index;
    const s = holdings[index];
    document.getElementById('code').value = s.code;
    document.getElementById('name').value = s.name;
    document.getElementById('quantity').value = s.quantity;
    document.getElementById('purchase-price').value = s.purchasePrice;
    document.getElementById('current-price').value = s.currentPrice;
    openModal(true);
}
function cancelEdit() { closeModal(); }
