const API_URL = 'https://api.hypixel.net/v2/skyblock/bazaar';
const AUTO_REFRESH_MS = 60000;
const TIERS = ['Rough', 'Flawed', 'Fine', 'Flawless', 'Perfect'];
// Number of the previous tier needed to craft one of the given tier.
const CRAFT_COST = { Flawed: 80, Fine: 80, Flawless: 80, Perfect: 5 };

const TEXTURE = 'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19.3/assets/minecraft/textures/block/';
const GEMS = [
    { type: 'RUBY',       name: 'Ruby',       color: '#ff4757', glass: 'red',        section: 'Crystal Hollows' },
    { type: 'AMBER',      name: 'Amber',      color: '#ffa502', glass: 'orange',     section: 'Crystal Hollows' },
    { type: 'SAPPHIRE',   name: 'Sapphire',   color: '#7b93ff', glass: 'light_blue', section: 'Crystal Hollows' },
    { type: 'JADE',       name: 'Jade',       color: '#7bed9f', glass: 'lime',       section: 'Crystal Hollows' },
    { type: 'AMETHYST',   name: 'Amethyst',   color: '#b388ff', glass: 'purple',     section: 'Crystal Hollows' },
    { type: 'TOPAZ',      name: 'Topaz',      color: '#fff200', glass: 'yellow',     section: 'Crystal Hollows' },
    { type: 'JASPER',     name: 'Jasper',     color: '#e056c8', glass: 'magenta',    section: 'Crystal Hollows' },
    { type: 'OPAL',       name: 'Opal',       color: '#f1f2f6', glass: 'white',      section: 'Glacite Tunnels' },
    { type: 'ONYX',       name: 'Onyx',       color: '#a4a9b4', glass: 'black',      section: 'Glacite Tunnels' },
    { type: 'AQUAMARINE', name: 'Aquamarine', color: '#00cec9', glass: 'blue',       section: 'Glacite Tunnels' },
    { type: 'CITRINE',    name: 'Citrine',    color: '#e1a84a', glass: 'brown',      section: 'Glacite Tunnels' },
    { type: 'PERIDOT',    name: 'Peridot',    color: '#3fbf5f', glass: 'green',      section: 'Glacite Tunnels' }
].map(g => ({ ...g, icon: `${TEXTURE}${g.glass}_stained_glass.png` }));

const productId = (gem, tier) => `${tier.toUpperCase()}_${gem.type}_GEM`;

const state = {
    view: 'prices',
    prices: {},        // productId -> { instaBuy, instaSell, buyWeek, sellWeek }
    source: null,      // 'live' | 'demo'
    apiUpdated: null,  // Date from API
    fetchedAt: null,
    loading: false,
    error: null
};

// ---------- Settings persistence ----------
const SETTINGS_KEY = 'gemtracker_settings_v2';
const settingIds = ['search', 'location', 'tier', 'sort', 'buy-mode', 'sell-mode', 'step', 'tax', 'auto-refresh'];

function loadSettings() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { /* ignore */ }
    settingIds.forEach(id => {
        const el = document.getElementById(id);
        if (!(id in saved)) return;
        if (el.type === 'checkbox') el.checked = !!saved[id];
        else el.value = saved[id];
    });
    if (saved.view) state.view = saved.view;
}

function saveSettings() {
    const data = { view: state.view };
    settingIds.forEach(id => {
        const el = document.getElementById(id);
        data[id] = el.type === 'checkbox' ? el.checked : el.value;
    });
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(data)); } catch { /* ignore */ }
}

const val = id => document.getElementById(id).value;

// ---------- Data ----------
async function loadData() {
    if (state.loading) return;
    state.loading = true;
    renderStatus();
    document.getElementById('refresh').disabled = true;

    try {
        const res = await fetch(API_URL, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data.success || !data.products) throw new Error('Unexpected API response');
        state.prices = parseProducts(data.products);
        if (Object.keys(state.prices).length === 0) throw new Error('No gemstone products in API response');
        state.source = 'live';
        state.apiUpdated = data.lastUpdated ? new Date(data.lastUpdated) : new Date();
        state.error = null;
    } catch (err) {
        console.error('Failed to load bazaar data:', err);
        state.error = err.message || String(err);
        // Keep previous live data if we have it; otherwise fall back to demo data.
        if (state.source !== 'live') {
            state.prices = demoPrices();
            state.source = 'demo';
            state.apiUpdated = null;
        }
    } finally {
        state.fetchedAt = new Date();
        state.loading = false;
        document.getElementById('refresh').disabled = false;
        render();
    }
}

function parseProducts(products) {
    const prices = {};
    for (const gem of GEMS) {
        for (const tier of TIERS) {
            const id = productId(gem, tier);
            const p = products[id];
            if (!p) continue;
            const q = p.quick_status || {};
            // Top of book: buy_summary holds sell offers (what you insta-buy from),
            // sell_summary holds buy orders (what you insta-sell into).
            const topOffer = p.buy_summary?.[0]?.pricePerUnit ?? q.buyPrice;
            const topOrder = p.sell_summary?.[0]?.pricePerUnit ?? q.sellPrice;
            const a = Number(topOffer) || 0;
            const b = Number(topOrder) || 0;
            // In a normal book insta-buy >= insta-sell; guard against swapped/empty sides.
            const instaBuy = a && b ? Math.max(a, b) : a || b;
            const instaSell = a && b ? Math.min(a, b) : a || b;
            prices[id] = {
                instaBuy,
                instaSell,
                buyWeek: Number(q.buyMovingWeek) || 0,
                sellWeek: Number(q.sellMovingWeek) || 0
            };
        }
    }
    return prices;
}

function demoPrices() {
    const base = { Rough: 3, Flawed: 250, Fine: 22000, Flawless: 1900000, Perfect: 11000000 };
    const prices = {};
    GEMS.forEach((gem, i) => {
        const mult = 0.7 + ((i * 37) % 60) / 100; // deterministic spread per gem
        TIERS.forEach(tier => {
            const instaSell = Math.round(base[tier] * mult);
            prices[productId(gem, tier)] = {
                instaSell,
                instaBuy: Math.round(instaSell * 1.06) || 1,
                buyWeek: Math.round(5e7 / base[tier]),
                sellWeek: Math.round(4e7 / base[tier])
            };
        });
    });
    return prices;
}

// ---------- Helpers ----------
function formatCoins(value) {
    if (value === null || value === undefined || !isFinite(value)) return '—';
    const sign = value < 0 ? '-' : '';
    const v = Math.abs(value);
    if (v >= 1e9) return sign + (v / 1e9).toFixed(2) + 'b';
    if (v >= 1e6) return sign + (v / 1e6).toFixed(2) + 'm';
    if (v >= 1e3) return sign + (v / 1e3).toFixed(1) + 'k';
    return sign + v.toFixed(v < 10 && v % 1 ? 1 : 0);
}

function signed(value) {
    return (value > 0 ? '+' : '') + formatCoins(value).replace(/^-/, '−');
}

function formatCount(value) {
    if (!value) return '0';
    if (value >= 1e6) return (value / 1e6).toFixed(1) + 'M';
    if (value >= 1e3) return (value / 1e3).toFixed(1) + 'K';
    return String(value);
}

function timeAgo(date) {
    if (!date) return '';
    const s = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return date.toLocaleString();
}

function iconHtml(gem) {
    return `<img class="gem-icon" src="${gem.icon}" alt="" loading="lazy"
        onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'gem-icon',style:'background:${gem.color}'}))">`;
}

function filteredGems() {
    const q = val('search').trim().toLowerCase();
    const loc = val('location');
    return GEMS.filter(g =>
        (loc === 'all' || g.section === loc) &&
        (!q || g.name.toLowerCase().includes(q) || g.section.toLowerCase().includes(q))
    );
}

const priceOf = (gem, tier) => state.prices[productId(gem, tier)];

// ---------- Rendering ----------
function render() {
    document.querySelectorAll('.tabs .tab').forEach(b => {
        const on = b.dataset.view === state.view;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
    });
    document.querySelectorAll('.view-only').forEach(el => { el.hidden = el.dataset.for !== state.view; });
    renderStatus();

    const content = document.getElementById('content');
    if (!state.source) {
        content.innerHTML = `<div class="grid" aria-busy="true" aria-label="Loading bazaar data">${'<div class="panel skeleton"></div>'.repeat(6)}</div>`;
        document.getElementById('stats').innerHTML = '';
        return;
    }

    let html = '';
    if (state.source === 'demo') {
        html += `<div class="notice warn"><strong>Showing demo data.</strong> Live prices could not be loaded
            (${escapeHtml(state.error || 'unknown error')}). Numbers below are placeholders — hit Refresh to try again.</div>`;
    } else if (state.error) {
        html += `<div class="notice warn">Last refresh failed (${escapeHtml(state.error)}). Showing the previous live prices.</div>`;
    }
    html += state.view === 'crafting' ? renderCrafting() : renderPrices();
    content.innerHTML = html;
    renderStats();
}

function renderStatus() {
    const left = document.getElementById('status-left');
    const right = document.getElementById('status-right');
    if (state.loading) {
        left.innerHTML = '<span class="badge loading">Updating…</span>';
    } else if (state.source === 'live') {
        left.innerHTML = `<span class="badge live">Live</span> Bazaar updated ${timeAgo(state.apiUpdated)}`;
    } else if (state.source === 'demo') {
        left.innerHTML = '<span class="badge demo">Demo data</span>';
    } else {
        left.textContent = '';
    }
    right.textContent = document.getElementById('auto-refresh').checked ? 'Auto-refreshing every minute' : '';
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderPrices() {
    const gems = filteredGems();
    if (gems.length === 0) return '<div class="empty">No gemstones match your filters.</div>';
    const tier = val('tier');
    return tier === 'all' ? renderPriceCards(gems) : renderTierTable(gems, tier);
}

function renderPriceCards(gems) {
    const sections = [...new Set(gems.map(g => g.section))];
    return sections.map(section => {
        const cards = gems.filter(g => g.section === section).map(gem => {
            const rows = TIERS.map(tier => {
                const p = priceOf(gem, tier);
                if (!p) return `<tr><td>${tier}</td><td class="na" colspan="3">Not on bazaar</td></tr>`;
                return `<tr>
                    <td>${tier}</td>
                    <td class="num price">${formatCoins(p.instaSell)}</td>
                    <td class="num">${formatCoins(p.instaBuy)}</td>
                    <td class="num muted">${formatCount(p.buyWeek + p.sellWeek)}</td>
                </tr>`;
            }).join('');
            return `<article class="card panel" style="--gem:${gem.color}">
                <h3 class="card-title" style="color:${gem.color}">${iconHtml(gem)} ${gem.name}</h3>
                <div class="table-wrap"><table>
                    <thead><tr><th>Tier</th><th>Insta-sell</th><th>Insta-buy</th><th>7d vol</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table></div>
            </article>`;
        }).join('');
        return `<h2 class="section-title">${section}</h2><div class="grid">${cards}</div>`;
    }).join('');
}

function renderTierTable(gems, tier) {
    const sort = val('sort');
    const rows = gems
        .map(gem => ({ gem, p: priceOf(gem, tier) }))
        .filter(r => r.p);
    if (rows.length === 0) return `<div class="empty">No ${tier} gemstones on the bazaar.</div>`;

    const key = {
        instaSell: r => -r.p.instaSell,
        instaBuy: r => -r.p.instaBuy,
        volume: r => -(r.p.buyWeek + r.p.sellWeek)
    }[sort];
    rows.sort(key ? (a, b) => key(a) - key(b) : (a, b) => a.gem.name.localeCompare(b.gem.name));

    const body = rows.map((r, i) => {
        const spread = r.p.instaSell ? ((r.p.instaBuy - r.p.instaSell) / r.p.instaSell) * 100 : 0;
        return `<tr>
            <td class="rank">#${i + 1}</td>
            <td><span class="gem-cell" style="color:${r.gem.color}">${iconHtml(r.gem)} ${tier} ${r.gem.name}</span></td>
            <td class="hide-sm muted">${r.gem.section}</td>
            <td class="num price">${formatCoins(r.p.instaSell)}</td>
            <td class="num">${formatCoins(r.p.instaBuy)}</td>
            <td class="num muted hide-sm">${spread.toFixed(1)}%</td>
            <td class="num muted">${formatCount(r.p.buyWeek + r.p.sellWeek)}</td>
        </tr>`;
    }).join('');

    return `<div class="panel big-table"><div class="table-wrap"><table>
        <thead><tr><th></th><th>Gemstone</th><th class="hide-sm">Location</th><th>Insta-sell</th><th>Insta-buy</th><th class="hide-sm">Spread</th><th>7d vol</th></tr></thead>
        <tbody>${body}</tbody>
    </table></div></div>`;
}

function craftingRows() {
    const buyMode = val('buy-mode');
    const sellMode = val('sell-mode');
    const step = val('step');
    const tax = Math.min(Math.max(parseFloat(val('tax')) || 0, 0), 100) / 100;
    const rows = [];

    for (const gem of filteredGems()) {
        for (let i = 1; i < TIERS.length; i++) {
            const to = TIERS[i];
            const from = TIERS[i - 1];
            if (step !== 'all' && step !== to) continue;
            const input = priceOf(gem, from);
            const output = priceOf(gem, to);
            if (!input || !output) continue;

            // Buy order fills at roughly the top buy order; sell offer at roughly the lowest offer.
            const unitCost = buyMode === 'insta' ? input.instaBuy : input.instaSell;
            const unitRevenue = sellMode === 'insta' ? output.instaSell : output.instaBuy;
            if (!unitCost || !unitRevenue) continue;

            const qty = CRAFT_COST[to];
            const cost = qty * unitCost;
            const revenue = unitRevenue * (1 - tax);
            const profit = revenue - cost;
            rows.push({ gem, from, to, qty, unitCost, cost, revenue, profit, roi: (profit / cost) * 100 });
        }
    }
    return rows.sort((a, b) => b.profit - a.profit);
}

function bestBy(list, score) {
    return list.reduce((best, x) => (best === null || score(x) > score(best) ? x : best), null);
}

function stat(label, value, sub, cls = '') {
    return `<div class="stat panel"><span class="stat-label">${label}</span>
        <span class="stat-value ${cls}">${value}</span><span class="stat-sub">${sub}</span></div>`;
}

function renderStats() {
    const el = document.getElementById('stats');
    const gems = filteredGems();
    const tierChoice = val('tier');
    const tier = state.view === 'prices' && tierChoice !== 'all' ? tierChoice : 'Fine';
    const priced = gems.map(gem => ({ gem, p: priceOf(gem, tier) })).filter(r => r.p);
    const topMine = bestBy(priced, r => r.p.instaSell);
    const busiest = bestBy(priced, r => r.p.buyWeek + r.p.sellWeek);
    const crafts = craftingRows();
    const bestCraft = crafts[0] || null;
    const profitable = crafts.filter(r => r.profit > 0).length;

    el.innerHTML = [
        topMine ? stat(`Best ${tier} to mine`, formatCoins(topMine.p.instaSell),
            `<span style="color:${topMine.gem.color}">${topMine.gem.name}</span> · insta-sell`) : '',
        bestCraft ? stat('Best craft', signed(bestCraft.profit),
            `${bestCraft.gem.name} ${bestCraft.from} → ${bestCraft.to}`, bestCraft.profit > 0 ? 'pos' : 'neg') : '',
        stat('Profitable crafts', `${profitable}/${crafts.length}`, 'with current craft settings'),
        busiest ? stat(`Most traded ${tier}`, formatCount(busiest.p.buyWeek + busiest.p.sellWeek),
            `<span style="color:${busiest.gem.color}">${busiest.gem.name}</span> · 7-day volume`) : ''
    ].join('');
}

function renderCrafting() {
    const rows = craftingRows();
    if (rows.length === 0) return '<div class="empty">No crafts match your filters.</div>';

    const body = rows.map(r => {
        const cls = r.profit > 0 ? 'pos' : 'neg';
        return `<tr>
            <td><span class="gem-cell" style="color:${r.gem.color}">${iconHtml(r.gem)} ${r.gem.name}</span></td>
            <td>${r.from} → ${r.to}</td>
            <td class="num muted hide-sm">${r.qty} × ${formatCoins(r.unitCost)}</td>
            <td class="num">${formatCoins(r.cost)}</td>
            <td class="num">${formatCoins(r.revenue)}</td>
            <td class="num ${cls}">${signed(r.profit)}</td>
            <td class="num ${cls}">${r.profit > 0 ? '+' : ''}${r.roi.toFixed(1)}%</td>
        </tr>`;
    }).join('');

    const profitable = rows.filter(r => r.profit > 0).length;
    return `<p class="intro">${profitable} of ${rows.length} crafts are currently profitable. Profit is per crafted gem, after tax.</p>
    <div class="panel big-table"><div class="table-wrap"><table>
        <thead><tr><th>Gemstone</th><th>Upgrade</th><th class="hide-sm">Inputs</th><th>Cost</th><th>Revenue</th><th>Profit</th><th>ROI</th></tr></thead>
        <tbody>${body}</tbody>
    </table></div></div>`;
}

// ---------- Wiring ----------
let autoTimer = null;
function scheduleAutoRefresh() {
    clearInterval(autoTimer);
    if (document.getElementById('auto-refresh').checked) {
        autoTimer = setInterval(() => { if (!document.hidden) loadData(); }, AUTO_REFRESH_MS);
    }
}

document.querySelectorAll('.tabs .tab').forEach(btn => btn.addEventListener('click', () => {
    state.view = btn.dataset.view;
    saveSettings();
    render();
}));

settingIds.forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener(el.tagName === 'INPUT' && el.type !== 'checkbox' ? 'input' : 'change', () => {
        saveSettings();
        if (id === 'auto-refresh') scheduleAutoRefresh();
        render();
    });
});

document.getElementById('refresh').addEventListener('click', loadData);
document.addEventListener('visibilitychange', () => {
    const stale = state.fetchedAt && Date.now() - state.fetchedAt.getTime() > AUTO_REFRESH_MS;
    if (!document.hidden && stale && document.getElementById('auto-refresh').checked) loadData();
});
setInterval(renderStatus, 15000); // keep the "updated Xs ago" text fresh

loadSettings();
render();
scheduleAutoRefresh();
loadData();
