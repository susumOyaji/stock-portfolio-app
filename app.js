/**
 * Stock Portfolio Manager Logic - Scraping Method (Restored)
 */

let holdings = [];
let editingIndex = null;
let lastFetchResult = null;
let autoUpdateTimer = null;
const STORAGE_KEY = 'stock_portfolio_data';
const SETTINGS_KEY = 'stock_portfolio_settings';

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    renderUI();
    setupEventListeners();
    refreshMarketIndices(); // 初回読み込み時に重要指標を取得

    // 設定された間隔で自動更新を開始
    const savedInterval = localStorage.getItem(SETTINGS_KEY) || '2';
    const intervalEl = document.getElementById('update-interval');
    if (intervalEl) intervalEl.value = savedInterval;
    startAutoUpdate(parseInt(savedInterval));
});

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

function startAutoUpdate(minutes) {
    if (autoUpdateTimer) {
        clearInterval(autoUpdateTimer);
        autoUpdateTimer = null;
    }

    if (minutes > 0) {
        autoUpdateTimer = setInterval(refreshAllPrices, minutes * 60 * 1000);
        console.log(`Auto update started: every ${minutes} minutes`);
    } else {
        console.log('Auto update disabled');
    }
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
    tableBody.innerHTML = '';
    let totalValuation = 0, totalCost = 0;

    holdings.forEach((stock, index) => {
        const metrics = calculateMetrics(stock);
        totalValuation += metrics.valuation;
        totalCost += metrics.costBasis;

        const row = document.createElement('tr');
        const plClass = metrics.profitLoss >= 0 ? 'value-positive' : 'value-negative';
        const plSign = metrics.profitLoss >= 0 ? '+' : '';

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
                <div class="price-current">${formatCurrency(stock.currentPrice)}</div>
                <div style="font-size: 0.65rem; color: var(--text-muted); margin-top: 0.2rem;">${stock.time || '--:--'}</div>
            </td>
            <td>
                <div class="${(stock.dayChange || '').startsWith('+') ? 'value-positive' : (stock.dayChange || '').startsWith('-') ? 'value-negative' : ''}" style="font-weight: 600;">
                    ${stock.dayChange || '0'}
                </div>
                <div class="${(stock.dayChange || '').startsWith('+') ? 'value-positive' : (stock.dayChange || '').startsWith('-') ? 'value-negative' : ''}" style="font-size: 0.75rem;">
                    ${stock.dayChangePercent || '0%'}
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
        const changeStr = (stock.dayChange || '0').replace(/[＋+]/g, '').replace(/[－-]/g, '-').replace(/,/g, '');
        const changeVal = parseFloat(changeStr) || 0;
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
    const symbol = /^\d{4}$/.test(scrapeCode) ? `${scrapeCode}.T` : scrapeCode;

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
        const priceSelectors = [
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
                const match = el.textContent.replace(/,/g, '').match(/[\d.]+/);
                if (match) { price = parseFloat(match[0]); break; }
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

        // 2. 前日比 (金額と率) - "+1500" バグ回避版
        let dayChange = '0';
        let dayChangePercent = '0%';

        // 前日比候補を探す
        const candidates = Array.from(doc.querySelectorAll('._3S6pP, ._399tF, span, div'))
            .filter(el => {
                const t = el.textContent.trim();
                // 15:00 のような時刻形式を排除（コロンが含まれ、％が含まれないものはスキップ）
                if (t.includes(':') && !t.includes('%')) return false;
                // ＋ か － か % を含み、かつ短すぎず長すぎないものを候補とする
                return (t.includes('＋') || t.includes('－') || t.includes('%')) && t.length < 40 && !el.classList.contains('_3P_pZ');
            });

        let changeText = '';
        if (candidates.length > 0) {
            // 最も前日比らしい（%と符号の両方を含む）ものを優先
            const best = candidates.find(el => (el.textContent.includes('＋') || el.textContent.includes('－')) && el.textContent.includes('%')) || candidates[0];
            changeText = best.textContent;
        }

        if (changeText) {
            const clean = changeText.replace(/－/g, '-').replace(/＋/g, '+').replace(/,/g, '');
            // 符号(+ or -)の直後に数値が来るパターンを抽出
            const matches = clean.match(/[+-][\d.]+/g);
            if (matches && matches.length >= 1) {
                dayChange = matches[0];
                if (matches.length >= 2) {
                    dayChangePercent = matches[1] + '%';
                } else {
                    const pMatch = clean.match(/[\d.]+(?=%)/);
                    if (pMatch) dayChangePercent = (dayChange.startsWith('-') ? '-' : '+') + pMatch[0] + '%';
                }
            }
        }

        // 3. 市場更新時刻 (より詳細な探索)
        let updateTime = '--:--';

        // 優先順位 1: 特定のクラス名（Yahooの仕様変更に対応）
        // ._18i9z は時刻、._2_o8X は日付
        const timeSelectors = [
            'time',
            '._18i9z',
            '[data-field="regularMarketTime"]',
            'span[class*="Price_time"]',
            'span[class*="Price_date"]',
            'span[class*="StyledPriceTime"]'
        ];

        for (const sel of timeSelectors) {
            const el = doc.querySelector(sel);
            if (el) {
                // 時刻(15:00) or 日付時刻(02/12 15:00) or 漢数字を含む形式(15時30分)を抽出
                const match = el.textContent.match(/(\d{1,2}\/\d{1,2}\s+)?\d{1,2}:\d{2}|(\d{1,2}時\d{1,2}分)|--:--/);
                if (match) {
                    updateTime = match[0].replace('時', ':').replace('分', '');
                    break;
                }
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
                checkTime: new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
                dayChange: dayChange,
                dayChangePercent: dayChangePercent,
                keywords: keywords.slice(0, 5) // 最大5つ
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
async function refreshAllPrices() {
    const refreshBtn = document.getElementById('refresh-all-btn');
    const refreshIcon = document.getElementById('refresh-icon');
    if (!refreshBtn || holdings.length === 0) return;

    refreshBtn.disabled = true;
    refreshIcon.style.animation = 'spin 1.5s linear infinite';

    try {
        await Promise.all(holdings.map(async (stock) => {
            const result = await fetchIndividualPrice(stock.code);
            if (result) {
                stock.currentPrice = result.price;
                stock.dayChange = result.dayChange;
                stock.dayChangePercent = result.dayChangePercent;
                stock.checkTime = result.checkTime;
                stock.time = result.time;
                stock.keywords = result.keywords;
            }
        }));
        await refreshMarketIndices(); // 日経平均と為替も更新
        saveData();
        renderUI();
        document.getElementById('last-updated').textContent = `最終更新: ${new Date().toLocaleTimeString()}`;
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
            changeEl.textContent = `${nikkeiResult.dayChange} (${nikkeiResult.dayChangePercent})`;
            changeEl.className = 'index-change ' + ((nikkeiResult.dayChange || '').startsWith('+') ? 'value-positive' : (nikkeiResult.dayChange || '').startsWith('-') ? 'value-negative' : '');
        }
    }

    // 2. ドル/円
    const usdjpyResult = await fetchIndividualPrice('USDJPY=X');
    if (usdjpyResult) {
        const priceEl = document.getElementById('usdjpy-price');
        const changeEl = document.getElementById('usdjpy-change');
        if (priceEl && changeEl) {
            priceEl.textContent = usdjpyResult.price.toFixed(2);
            changeEl.textContent = `${usdjpyResult.dayChange} (${usdjpyResult.dayChangePercent})`;
            changeEl.className = 'index-change ' + ((usdjpyResult.dayChange || '').startsWith('+') ? 'value-positive' : (usdjpyResult.dayChange || '').startsWith('-') ? 'value-negative' : '');
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
