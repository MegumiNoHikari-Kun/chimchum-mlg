import { supabase, authReady } from '../supabase.js';

/* ================= STATE ================= */
let allOrders = [];        // semua order valid (non-cancel)
let customers = new Map(); // pelanggan teridentifikasi (seluruh riwayat)
let view = null;
let segFilter = 'all';
let custQuery = '';
const charts = {};

const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const WD_MAP = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const WINBACK_DAYS = 30;

/* ============ KONFIGURASI TIPE PESANAN ============
   Field di tabel `orders` yang dicek untuk mendeteksi tipe pesanan.
   Kalau tipe pesanan Anda disimpan di kolom lain, tambahkan nama kolomnya di sini.
   Aturan: mengandung "shopee" -> ShopeeFood, mengandung "grab" -> GrabFood, selain itu -> Offline. */
const CHANNEL_FIELDS = ['order_type', 'tipe', 'type', 'channel', 'source', 'platform', 'payment_method'];
const CHANNELS = {
    offline:    { label: 'Offline',    cls: 'bg-slate-100 text-slate-700 border-slate-300' },
    shopeefood: { label: 'ShopeeFood', cls: 'bg-orange-50 text-orange-700 border-orange-200' },
    grabfood:   { label: 'GrabFood',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
};
const chBadge = k => `<span class="px-2 py-0.5 rounded-full border text-[10px] font-semibold ${CHANNELS[k].cls}">${CHANNELS[k].label}</span>`;

function channelOf(o) {
    const raw = CHANNEL_FIELDS.map(f => String(o[f] || '').toLowerCase()).join(' ');
    if (raw.includes('shopee')) return 'shopeefood';
    if (raw.includes('grab')) return 'grabfood';
    return 'offline';
}

/* ================= HELPERS ================= */
const rupiah = n => 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

const jkFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false, weekday: 'short'
});
function jk(d) {
    const p = {};
    jkFmt.formatToParts(d).forEach(x => (p[x.type] = x.value));
    return { date: `${p.year}-${p.month}-${p.day}`, hour: parseInt(p.hour, 10) % 24, wd: WD_MAP[p.weekday] };
}
function fmtDate(iso) {
    return new Date(iso).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric' });
}

function normPhone(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.startsWith('0')) d = '62' + d.slice(1);
    else if (d.startsWith('8')) d = '62' + d;
    return d;
}

/* ============ PENANGANAN NAMA TYPO (fuzzy matching) ============ */
const HONORIFICS = new Set(['kak', 'kakak', 'kk', 'ka', 'mas', 'mbak', 'mba', 'bu', 'ibu', 'pak', 'bapak', 'bang', 'abang', 'om', 'tante', 'sis', 'bro']);
// Nama yang sebenarnya bukan nama orang (nomor meja, dll) -> dianggap anonim
const TABLE_LIKE = /^(meja|mj|table|tbl|no\.?|nomor|take\s?away|takeaway|ta|dine\s?in|dinein|walk\s?in|walkin|pelanggan|customer|umum|guest|tamu)\b/i;

// "Kak Enny" -> "eni" ; huruf y disamakan dengan i, huruf kembar dilebur, sapaan dibuang
function normName(raw) {
    const s = String(raw || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z\s]/g, ' ');
    const joined = s.split(/\s+/).filter(t => t && !HONORIFICS.has(t)).join('');
    return joined.replace(/y/g, 'i').replace(/(.)\1+/g, '$1');
}

function lev(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
        const cur = [i];
        for (let j = 1; j <= n; j++) {
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        prev = cur;
    }
    return prev[n];
}

// Nama pendek (≤4 huruf) harus sama persis setelah normalisasi (supaya "rina" ≠ "dina").
// 5–8 huruf boleh beda 1 huruf, >8 huruf boleh beda 2 huruf. Huruf pertama harus sama.
function similar(a, b) {
    if (a === b) return true;
    const L = Math.max(a.length, b.length);
    if (L <= 4 || a[0] !== b[0]) return false;
    const d = lev(a, b);
    return L <= 8 ? d <= 1 : d <= 2;
}

/* Beri setiap order sebuah ID pelanggan (_cid):
   1. Ada no. WA valid          -> p:<nomor>            (lintas channel)
   2. Tidak ada WA, ada nama    -> n:<channel>:<nama>   (nama mirip digabung, hanya dalam channel yang sama)
   3. Nama kosong / nomor meja  -> '' (anonim, tidak masuk analisa pelanggan) */
function assignCustomerIds(orders) {
    const nameCount = new Map();
    orders.forEach(o => {
        o._phone = normPhone(o.phone);
        o._ch = channelOf(o);
        const raw = String(o.customer_name || '').trim();
        o._norm = raw && !TABLE_LIKE.test(raw) ? normName(raw) : '';
        if (o._phone.length >= 9 || o._norm.length < 2) return;
        const m = nameCount.get(o._ch) || new Map();
        m.set(o._norm, (m.get(o._norm) || 0) + 1);
        nameCount.set(o._ch, m);
    });

    const repMap = new Map();
    nameCount.forEach((m, ch) => {
        const reps = [];
        [...m.entries()].sort((a, b) => b[1] - a[1]).forEach(([n]) => {
            const rep = reps.find(r => similar(r, n));
            if (rep) repMap.set(ch + '|' + n, rep);
            else { reps.push(n); repMap.set(ch + '|' + n, n); }
        });
    });

    orders.forEach(o => {
        if (o._phone.length >= 9) o._cid = 'p:' + o._phone;
        else if (o._norm.length >= 2) o._cid = 'n:' + o._ch + ':' + repMap.get(o._ch + '|' + o._norm);
        else o._cid = '';
    });
}

const itemName = i => String(i.nama || i.name || 'Tanpa Nama').trim();
const itemPrice = i => Number(i.harga || i.price || 0);
const itemQty = i => Number(i.qty || 1);

function segmentOf(count) {
    if (count >= 4) return 'loyal';
    if (count >= 2) return 'repeat';
    return 'baru';
}
const SEG_STYLE = {
    baru:   ['Baru',   'bg-sky-50 text-sky-700 border-sky-200'],
    repeat: ['Repeat', 'bg-amber-50 text-amber-700 border-amber-200'],
    loyal:  ['Loyal',  'bg-emerald-50 text-emerald-700 border-emerald-200']
};
const segBadge = seg => `<span class="px-2 py-0.5 rounded-full border text-[10px] font-semibold ${SEG_STYLE[seg][1]}">${SEG_STYLE[seg][0]}</span>`;

function topItemsText(c, n = 2) {
    return [...c.items.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, q]) => `${k} (${q}x)`).join(', ') || '-';
}
const topItemOf = (c, n = 2) => esc(topItemsText(c, n));

// Variasi penulisan nama selain nama utama
function otherVariants(c) {
    return [...c.variants.values()].filter(v => v.n.toLowerCase() !== c.name.toLowerCase()).map(v => v.n);
}

/* ================= LOAD DATA ================= */
window.loadAnalytics = async function () {
    await authReady;
    let orders = [];
    try {
        const { data } = await supabase.from('orders').select('*').order('created_at', { ascending: true });
        if (data) orders = data;
    } catch (e) { console.warn(e); }
    if (orders.length === 0) {
        orders = JSON.parse(localStorage.getItem('local_orders') || '[]');
    }

    allOrders = orders
        .filter(o => (o.status || 'new').toLowerCase() !== 'cancel' && o.created_at)
        .map(o => ({ ...o, _jk: jk(new Date(o.created_at)) }))
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    assignCustomerIds(allOrders);

    customers = new Map();
    allOrders.forEach(o => {
        if (!o._cid) return;
        let c = customers.get(o._cid);
        if (!c) {
            c = { id: o._cid, name: '', phone: '', channel: 'offline', orders: [], total: 0, items: new Map(), first: o.created_at, last: o.created_at, variants: new Map(), channels: new Map() };
            customers.set(o._cid, c);
        }
        c.orders.push(o);
        c.total += Number(o.grand_total || 0);
        c.last = o.created_at;
        if (!c.phone) c.phone = o._phone;
        const raw = String(o.customer_name || '').trim();
        if (raw) {
            const k = raw.toLowerCase();
            const v = c.variants.get(k) || { n: raw, c: 0 };
            v.c++;
            c.variants.set(k, v);
        }
        c.channels.set(o._ch, (c.channels.get(o._ch) || 0) + 1);
        (Array.isArray(o.items) ? o.items : []).forEach(i => {
            c.items.set(itemName(i), (c.items.get(itemName(i)) || 0) + itemQty(i));
        });
    });
    customers.forEach(c => {
        c.name = [...c.variants.values()].sort((a, b) => b.c - a.c)[0]?.n || '-';
        c.channel = [...c.channels.entries()].sort((a, b) => b[1] - a[1])[0][0];
    });

    analyze();
};

/* ================= ANALISA PERIODE ================= */
function periodStart() {
    const v = document.getElementById('periodSelect').value;
    if (v === 'all') return '0000-00-00';
    if (v === 'month') return jk(new Date()).date.slice(0, 7) + '-01';
    return jk(new Date(Date.now() - (parseInt(v, 10) - 1) * 864e5)).date;
}

const custOf = o => customers.get(o._cid);
const isRepOrder = o => { const c = custOf(o); return !!c && c.orders.length >= 2; };

function analyze() {
    const start = periodStart();
    const chSel = document.getElementById('channelSelect').value;
    const periodOrders = allOrders.filter(o => o._jk.date >= start);
    const orders = chSel === 'all' ? periodOrders : periodOrders.filter(o => o._ch === chSel);

    const identified = orders.filter(o => o._cid);
    const anonCount = orders.length - identified.length;
    const active = [...new Set(identified.map(o => o._cid))].map(id => customers.get(id));
    const newCust = active.filter(c => c.orders.length < 2);
    const repCust = active.filter(c => c.orders.length >= 2);

    const revenue = orders.reduce((s, o) => s + Number(o.grand_total || 0), 0);
    const repOrders = orders.filter(isRepOrder);
    const revRepeat = repOrders.reduce((s, o) => s + Number(o.grand_total || 0), 0);

    // Perbandingan channel (selalu semua channel di periode terpilih)
    const chStats = Object.keys(CHANNELS).map(k => {
        const os = periodOrders.filter(o => o._ch === k);
        const ids = new Set(os.filter(o => o._cid).map(o => o._cid));
        const rep = [...ids].filter(id => customers.get(id).orders.length >= 2).length;
        const rev = os.reduce((s, o) => s + Number(o.grand_total || 0), 0);
        return { key: k, orders: os.length, rev, aov: os.length ? rev / os.length : 0, cust: ids.size, rep, anon: os.filter(o => !o._cid).length };
    });

    const menu = new Map(), pairs = new Map(), pay = new Map();
    const hours = Array(24).fill(0), days = Array(7).fill(0);

    orders.forEach(o => {
        const rep = isRepOrder(o);
        const names = new Set();
        (Array.isArray(o.items) ? o.items : []).forEach(i => {
            const n = itemName(i);
            const m = menu.get(n) || { name: n, qty: 0, revenue: 0, orders: 0, repQty: 0 };
            m.qty += itemQty(i);
            m.revenue += itemQty(i) * itemPrice(i);
            if (rep) m.repQty += itemQty(i);
            if (!names.has(n)) { m.orders++; names.add(n); }
            menu.set(n, m);
        });
        const arr = [...names].sort();
        for (let a = 0; a < arr.length; a++)
            for (let b = a + 1; b < arr.length; b++) {
                const k = arr[a] + ' + ' + arr[b];
                pairs.set(k, (pairs.get(k) || 0) + 1);
            }
        hours[o._jk.hour]++;
        days[o._jk.wd]++;
        const pm = o.payment_method || 'Cash';
        const p = pay.get(pm) || { n: 0, total: 0 };
        p.n++; p.total += Number(o.grand_total || 0);
        pay.set(pm, p);
    });

    view = { start, chSel, orders, anonCount, active, newCust, repCust, revenue, revRepeat, ordersRepeat: repOrders.length, chStats, menu: [...menu.values()], pairs, hours, days, pay };

    renderKPI();
    renderChannel();
    renderTrend();
    renderSplit();
    renderMenu();
    renderPairs();
    renderTime();
    renderPay();
    renderWinback();
    renderSegFilter();
    renderCustomers();
    renderMerged();
}

/* ================= RENDER ================= */
function renderKPI() {
    const v = view;
    const nOrders = v.orders.length;
    const nCust = v.active.length;
    const identifiedOrders = nOrders - v.anonCount;
    const cards = [
        { t: 'Pelanggan Aktif', val: nCust, sub: v.anonCount ? `${v.anonCount} order tanpa identitas tidak dihitung` : 'unik di periode ini', icon: 'fa-users', cls: 'bg-slate-100 text-slate-600' },
        { t: 'Pelanggan Baru', val: v.newCust.length, sub: `${pct(v.newCust.length, nCust)}% dari pelanggan`, icon: 'fa-user-plus', cls: 'bg-sky-50 text-sky-600' },
        { t: 'Pelanggan Repeat', val: v.repCust.length, sub: `${pct(v.repCust.length, nCust)}% dari pelanggan`, icon: 'fa-repeat', cls: 'bg-emerald-50 text-emerald-600' },
        { t: 'Repeat Rate', val: pct(v.repCust.length, nCust) + '%', sub: 'target sehat: > 25–30%', icon: 'fa-chart-line', cls: 'bg-orange-50 text-orange-600' },
        { t: 'Total Order', val: nOrders, sub: `${pct(v.ordersRepeat, identifiedOrders)}% dari pelanggan repeat`, icon: 'fa-receipt', cls: 'bg-purple-50 text-purple-600' },
        { t: 'Omzet', val: rupiah(v.revenue), sub: `${pct(v.revRepeat, v.revenue)}% dari repeat`, icon: 'fa-sack-dollar', cls: 'bg-amber-50 text-amber-600' },
        { t: 'Rata-rata / Order (AOV)', val: rupiah(nOrders ? v.revenue / nOrders : 0), sub: 'nilai keranjang', icon: 'fa-basket-shopping', cls: 'bg-indigo-50 text-indigo-600' },
        { t: 'Order / Pelanggan', val: nCust ? (identifiedOrders / nCust).toFixed(2) : '0', sub: 'frekuensi beli', icon: 'fa-arrows-rotate', cls: 'bg-rose-50 text-rose-600' }
    ];
    document.getElementById('kpiCards').innerHTML = cards.map(c => `
        <div class="rounded-xl p-4 border border-slate-200 flex items-center justify-between gap-2">
            <div class="min-w-0">
                <div class="text-[11px] font-medium text-slate-500">${c.t}</div>
                <div class="text-lg font-bold mt-1 text-slate-800 truncate">${c.val}</div>
                <div class="text-[10px] text-slate-400 mt-0.5">${c.sub}</div>
            </div>
            <div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${c.cls}"><i class="fa-solid ${c.icon}"></i></div>
        </div>`).join('');
}

function renderChannel() {
    const body = document.getElementById('channelBody');
    body.innerHTML = view.chStats.map(s => `
        <tr class="hover:bg-slate-50/80">
            <td class="p-3">${chBadge(s.key)}</td>
            <td class="p-3 font-semibold">${s.orders}</td>
            <td class="p-3 text-emerald-600 font-semibold">${rupiah(s.rev)}</td>
            <td class="p-3 text-slate-600">${rupiah(s.aov)}</td>
            <td class="p-3">${s.cust}</td>
            <td class="p-3">${s.rep} <span class="text-slate-400">(${pct(s.rep, s.cust)}%)</span></td>
            <td class="p-3 text-slate-500">${s.anon}</td>
        </tr>`).join('');
}

function makeChart(id, config) {
    if (charts[id]) charts[id].destroy();
    const el = document.getElementById(id);
    if (!el || typeof Chart === 'undefined') return;
    charts[id] = new Chart(el, config);
}

function renderTrend() {
    const byMonth = view.start === '0000-00-00' && view.orders.length &&
        (new Date(view.orders[view.orders.length - 1].created_at) - new Date(view.orders[0].created_at)) / 864e5 > 62;
    const bucket = o => (byMonth ? o._jk.date.slice(0, 7) : o._jk.date);
    const map = new Map();
    view.orders.forEach(o => {
        const k = bucket(o);
        const r = map.get(k) || { baru: 0, repeat: 0, anon: 0 };
        if (!o._cid) r.anon++;
        else if (isRepOrder(o)) r.repeat++;
        else r.baru++;
        map.set(k, r);
    });
    const keys = [...map.keys()].sort();
    makeChart('trendChart', {
        type: 'bar',
        data: {
            labels: keys.map(k => (byMonth ? k : k.slice(8) + '/' + k.slice(5, 7))),
            datasets: [
                { label: 'Pelanggan Baru', data: keys.map(k => map.get(k).baru), backgroundColor: '#38bdf8' },
                { label: 'Pelanggan Repeat', data: keys.map(k => map.get(k).repeat), backgroundColor: '#10b981' },
                { label: 'Tanpa Identitas', data: keys.map(k => map.get(k).anon), backgroundColor: '#cbd5e1' }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } }, plugins: { legend: { position: 'bottom' } } }
    });
}

function renderSplit() {
    const loyal = view.active.filter(c => c.orders.length >= 4).length;
    const rep = view.repCust.length - loyal;
    makeChart('splitChart', {
        type: 'doughnut',
        data: { labels: ['Baru (1x)', 'Repeat (2–3x)', 'Loyal (≥4x)'], datasets: [{ data: [view.newCust.length, rep, loyal], backgroundColor: ['#38bdf8', '#f59e0b', '#10b981'] }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, cutout: '60%' }
    });
}

function renderMenu() {
    const sortKey = document.getElementById('menuSort').value;
    const list = [...view.menu].sort((a, b) => b[sortKey] - a[sortKey]).slice(0, 15);
    const max = Math.max(1, ...list.map(m => m[sortKey]));
    const body = document.getElementById('menuBody');
    if (!list.length) { body.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-slate-400">Belum ada data.</td></tr>`; return; }
    body.innerHTML = list.map((m, i) => `
        <tr class="hover:bg-slate-50/80">
            <td class="p-3 text-slate-400">${i + 1}</td>
            <td class="p-3 font-semibold text-slate-800">${esc(m.name)}
                <div class="h-1.5 bg-slate-100 rounded-full mt-1.5 w-32"><div class="h-1.5 bg-orange-400 rounded-full" style="width:${Math.round((m[sortKey] / max) * 100)}%"></div></div>
            </td>
            <td class="p-3 font-bold text-slate-700">${m.qty}x</td>
            <td class="p-3 text-emerald-600 font-semibold">${rupiah(m.revenue)}</td>
            <td class="p-3 text-slate-600">${m.orders} <span class="text-slate-400">(${pct(m.orders, view.orders.length)}%)</span></td>
            <td class="p-3 text-slate-600">${pct(m.repQty, m.qty)}%</td>
        </tr>`).join('');
}

function renderPairs() {
    const top = [...view.pairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    document.getElementById('pairsList').innerHTML = top.length
        ? top.map(([k, n], i) => `
            <div class="flex items-start justify-between gap-2 p-2 rounded-lg bg-slate-50">
                <span class="text-slate-700"><b class="text-orange-500">${i + 1}.</b> ${esc(k)}</span>
                <span class="shrink-0 font-semibold text-slate-600">${n}x</span>
            </div>`).join('')
        : `<div class="text-slate-400">Belum ada order dengan ≥ 2 jenis menu.</div>`;
}

function renderTime() {
    const hourLabels = view.hours.map((_, h) => String(h).padStart(2, '0'));
    const peakHour = view.hours.indexOf(Math.max(...view.hours));
    makeChart('hourChart', {
        type: 'bar',
        data: { labels: hourLabels, datasets: [{ data: view.hours, backgroundColor: view.hours.map((_, h) => (h === peakHour && view.hours[h] > 0 ? '#f97316' : '#fdba74')) }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });
    const peakDay = view.days.indexOf(Math.max(...view.days));
    makeChart('dayChart', {
        type: 'bar',
        data: { labels: DAY_NAMES.map(d => d.slice(0, 3)), datasets: [{ data: view.days, backgroundColor: view.days.map((_, d) => (d === peakDay && view.days[d] > 0 ? '#6366f1' : '#c7d2fe')) }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });
}

function renderPay() {
    const rows = [...view.pay.entries()].sort((a, b) => b[1].n - a[1].n);
    const total = view.orders.length || 1;
    document.getElementById('payList').innerHTML = rows.length
        ? rows.map(([k, v]) => `
            <div>
                <div class="flex justify-between"><span class="font-semibold text-slate-700">${esc(k)}</span><span class="text-slate-500">${v.n} order · ${rupiah(v.total)}</span></div>
                <div class="h-1.5 bg-slate-100 rounded-full mt-1"><div class="h-1.5 bg-emerald-400 rounded-full" style="width:${pct(v.n, total)}%"></div></div>
            </div>`).join('')
        : `<div class="text-slate-400">Belum ada data.</div>`;
}

const waLink = (phone, text) => (phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : '');

function renderWinback() {
    const now = Date.now();
    const list = [...customers.values()]
        .filter(c => c.orders.length >= 2 && (now - new Date(c.last)) / 864e5 > WINBACK_DAYS)
        .sort((a, b) => b.total - a.total)
        .slice(0, 15);
    const body = document.getElementById('winbackBody');
    if (!list.length) { body.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-slate-400">Tidak ada pelanggan repeat yang perlu di-follow up. 🎉</td></tr>`; return; }
    body.innerHTML = list.map(c => {
        const days = Math.floor((now - new Date(c.last)) / 864e5);
        const link = waLink(c.phone, `Halo kak ${c.name}, sudah lama nih tidak mampir ke ChimChum. Ada promo spesial untuk kakak, yuk order lagi! 😊`);
        return `
        <tr class="hover:bg-slate-50/80">
            <td class="p-3 font-semibold text-slate-800">${esc(c.name)} ${chBadge(c.channel)}</td>
            <td class="p-3">${c.orders.length}x</td>
            <td class="p-3 text-emerald-600 font-semibold">${rupiah(c.total)}</td>
            <td class="p-3 text-slate-600">${fmtDate(c.last)} <span class="text-rose-500">(${days} hari lalu)</span></td>
            <td class="p-3 text-slate-600">${topItemOf(c)}</td>
            <td class="p-3">${link
                ? `<a href="${link}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 px-2.5 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg font-semibold transition"><i class="fa-brands fa-whatsapp"></i> WA</a>`
                : '<span class="text-[10px] text-slate-400">Tidak ada no. WA (via aplikasi)</span>'}</td>
        </tr>`;
    }).join('');
}

function renderSegFilter() {
    const counts = { all: view.active.length, baru: 0, repeat: 0, loyal: 0 };
    view.active.forEach(c => counts[segmentOf(c.orders.length)]++);
    const opts = [['all', 'Semua'], ['baru', 'Baru'], ['repeat', 'Repeat'], ['loyal', 'Loyal']];
    document.getElementById('segFilter').innerHTML = opts.map(([k, l]) => `
        <button onclick="setSegFilter('${k}')" class="px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${segFilter === k ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}">${l} (${counts[k]})</button>`).join('');
}

function filteredCustomers() {
    let list = view.active.map(c => ({ c, seg: segmentOf(c.orders.length) }));
    if (segFilter !== 'all') list = list.filter(x => x.seg === segFilter);
    if (custQuery) {
        const digits = custQuery.replace(/\D/g, '');
        list = list.filter(({ c }) =>
            [...c.variants.values()].some(v => v.n.toLowerCase().includes(custQuery)) || (digits && c.phone.includes(digits)));
    }
    return list.sort((a, b) => b.c.total - a.c.total);
}

function renderCustomers() {
    const list = filteredCustomers();
    const body = document.getElementById('custBody');
    const shown = list.slice(0, 100);
    body.innerHTML = shown.length ? shown.map(({ c, seg }) => {
        const vars = otherVariants(c);
        return `
        <tr class="hover:bg-slate-50/80">
            <td class="p-3 font-semibold text-slate-800">${esc(c.name)}${vars.length ? `<div class="font-normal text-[10px] text-amber-600" title="Nama-nama ini digabung otomatis">≈ ${esc(vars.join(', '))}</div>` : ''}</td>
            <td class="p-3">${chBadge(c.channel)}</td>
            <td class="p-3 text-slate-600">${c.phone ? `<a class="hover:underline text-emerald-600" target="_blank" rel="noopener noreferrer" href="https://wa.me/${c.phone}">${esc(c.phone)}</a>` : '<span class="text-slate-300">-</span>'}</td>
            <td class="p-3">${segBadge(seg)}</td>
            <td class="p-3 font-semibold">${c.orders.length}x</td>
            <td class="p-3 text-emerald-600 font-semibold">${rupiah(c.total)}</td>
            <td class="p-3 text-slate-600">${rupiah(c.total / c.orders.length)}</td>
            <td class="p-3 text-slate-500">${fmtDate(c.first)}</td>
            <td class="p-3 text-slate-500">${fmtDate(c.last)}</td>
            <td class="p-3 text-slate-600 max-w-xs">${topItemOf(c)}</td>
        </tr>`;
    }).join('') : `<tr><td colspan="10" class="text-center py-8 text-slate-400">Tidak ada pelanggan ditemukan.</td></tr>`;
    document.getElementById('custFooter').textContent = `Menampilkan ${shown.length} dari ${list.length} pelanggan` + (list.length > 100 ? ' (gunakan pencarian atau Export CSV untuk data lengkap)' : '');
}

// Daftar nama yang digabung otomatis, supaya bisa dicek kebenarannya
function renderMerged() {
    const merged = [...customers.values()].filter(c => otherVariants(c).length > 0).sort((a, b) => b.orders.length - a.orders.length);
    document.getElementById('mergedCount').textContent = merged.length;
    document.getElementById('mergedBody').innerHTML = merged.length
        ? merged.map(c => `
            <tr class="hover:bg-slate-50/80">
                <td class="p-3">${chBadge(c.channel)}</td>
                <td class="p-3 font-semibold text-slate-800">${[...c.variants.values()].sort((a, b) => b.c - a.c).map(v => `${esc(v.n)} <span class="font-normal text-slate-400">(${v.c}x)</span>`).join(' &nbsp;·&nbsp; ')}</td>
                <td class="p-3 font-semibold">${c.orders.length}x</td>
            </tr>`).join('')
        : `<tr><td colspan="3" class="text-center py-6 text-slate-400">Tidak ada nama yang digabung otomatis.</td></tr>`;
}

/* ================= EVENTS ================= */
window.setSegFilter = k => { segFilter = k; renderSegFilter(); renderCustomers(); };

window.exportCustomersCSV = function () {
    if (!view) return;
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['Nama', 'Variasi Nama', 'Channel', 'WhatsApp', 'Segmen', 'Jumlah Order', 'Total Belanja', 'Order Pertama', 'Order Terakhir', 'Menu Favorit']];
    [...customers.values()].sort((a, b) => b.total - a.total).forEach(c => {
        rows.push([c.name, otherVariants(c).join(', '), CHANNELS[c.channel].label, c.phone, SEG_STYLE[segmentOf(c.orders.length)][0], c.orders.length, Math.round(c.total), fmtDate(c.first), fmtDate(c.last), topItemsText(c, 3)]);
    });
    const csv = '\uFEFF' + rows.map(r => r.map(q).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = `pelanggan-chimchum-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
};

document.getElementById('periodSelect').addEventListener('change', () => allOrders.length && analyze());
document.getElementById('channelSelect').addEventListener('change', () => allOrders.length && analyze());
document.getElementById('menuSort').addEventListener('change', () => view && renderMenu());
document.getElementById('custSearch').addEventListener('input', e => { custQuery = (e.target.value || '').toLowerCase().trim(); view && renderCustomers(); });

loadAnalytics();
