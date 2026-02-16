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
// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    loadData();
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
        return { isOpen: false, status: 'weekend', label: '休場（週末）', color: 'var(--text-muted)', icon: '📅' };
    }

    // 前場（9:00-11:30）
    if (time >= 9 * 60 && time < 11 * 60 + 30) {
        return { isOpen: true, status: 'morning', label: '取引中（前場）', color: 'var(--success)', icon: '📈' };
    }
    // 昼休み（11:30-12:30）
    if (time >= 11 * 60 + 30 && time < 12 * 60 + 30) {
        return { isOpen: false, status: 'lunch', label: '昼休み（前場終値）', color: 'var(--warning)', icon: '🍱' };
    }
    // 後場（12:30-15:00）
    if (time >= 12 * 60 + 30 && time < 15 * 60) {
        return { isOpen: true, status: 'afternoon', label: '取引中（後場）', color: 'var(--success)', icon: '📈' };
    }
    // 市場終了後
    if (time >= 15 * 60) {
        return { isOpen: false, status: 'closed', label: '市場終了', color: 'var(--text-muted)', icon: '🌙' };
    }
    // 市場開始前
    return { isOpen: false, status: 'pre_market', label: '市場開始前', color: 'var(--text-muted)', icon: '🌅' };
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

    // 市場が開いている場合、最終更新からの経過時間を表示
    if (status.isOpen && lastFetchSuccessTime) {
        const diffMs = Date.now() - lastFetchSuccessTime;
        const diffMins = Math.floor(diffMs / 60000);
        labelText += ` (${diffMins}分前)`;
    }
    // 昼休み以外で閉まっている場合のみ (最終値) を付加
    else if (!status.isOpen && status.status !== 'lunch') {
        labelText += ' (最終値)';
    }

    badge.innerHTML = `<span>${labelText}</span>`;
    document.body.appendChild(badge);
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
        const parsePercent = (val) => {
            if (val === null || val === undefined || val === '') return -Infinity;
            // すでに数値の場合
            if (typeof val === 'number') return val;

            // 文字列の場合のクリーニング
            const strVal = String(val);
            // 符号、カンマ、%を除去して数値化
            const cleanStr = strVal
                .replace(/[＋+]/g, '')      // プラス符号を除去
                .replace(/[－-]/g, '-')     // マイナス記号を半角ハイフンに統一
                .replace(/,/g, '')          // カンマを除去
                .replace(/%/g, '')          // パーセントを除去
                .trim();

            const num = parseFloat(cleanStr);
            return isNaN(num) ? -Infinity : num;
        };

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

        // データ鮮度 (バッジ表示は廃止、ヘッダーに統合)
        const freshness = getDataFreshness(stock.time);

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
                <div style="display: flex; align-items: center; gap: 0.5rem; margin-top: 0.2rem;">
                    <div style="font-size: 0.65rem; color: var(--text-muted);">${stock.time || '--:--'}</div>
                </div>
                ${!marketStatus.isOpen && freshness.ageInHours > 6 ?
                `<div style="font-size: 0.6rem; color: var(--warning); margin-top: 0.1rem;">⚠️ 前日終値</div>` : ''}
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
            '._3rXWJKZ',
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

        // 既存セレクタでの探索
        for (const sel of priceSelectors) {
            const el = doc.querySelector(sel);
            if (el) {
                const txt = el.textContent.replace(/,/g, '').trim();
                const match = txt.match(/^[\d.]+$/); // 純粋な数値のみ（前日比などは除外）
                if (match) {
                    price = parseFloat(match[0]);
                    break;
                }
            }
        }

        // --- スマート探索 (Smart Search): セレクタで見つからない場合の自動探索 ---
        if (price === null) {
            console.log(`[SmartSearch] Trying fallback search for ${code}...`);

            // 戦略: 「現在値」や「円」といったキーワードの近くにある数値を探索
            const keywords = ['現在値', '時価', 'リアルタイム', '円'];
            const allElements = Array.from(doc.querySelectorAll('span, div, p, dd, strong, b'));

            // キーワードを含む要素を探す
            const keywordEls = allElements.filter(el =>
                keywords.some(k => el.textContent.includes(k)) && el.textContent.length < 20
            );

            for (const keyEl of keywordEls) {
                // その要素の親、兄弟、子要素から「数値のみ」のテキストを持つ要素を探す
                // 親の兄弟（隣の列など）も探す
                const context = keyEl.parentElement?.parentElement || keyEl.parentElement;
                if (!context) continue;

                const candidates = Array.from(context.querySelectorAll('*'))
                    .filter(el => {
                        const txt = el.textContent.trim().replace(/,/g, '');
                        // 数字のみ、かつ空でない、かつ長すぎない(桁数制限)
                        return /^[\d.]+$/.test(txt) && txt.length > 0 && txt.length < 10;
                    });

                // 数値候補が見つかったら、それを採用（最初に見つかったものを優先）
                if (candidates.length > 0) {
                    // 数値が大きい順（フォントサイズではなく値として）... は危険（出来高などを拾うかも）
                    // DOMの出現順で、キーワードに近いものを採用したい。
                    // candidates[0] は context 内で最初に見つかったもの。
                    const val = parseFloat(candidates[0].textContent.replace(/,/g, ''));
                    if (!isNaN(val) && val > 0) {
                        price = val;
                        console.log(`[SmartSearch] Found price via keyword "${keyEl.textContent}": ${price}`);
                        break;
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
let lastFetchSuccessTime = null;

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
