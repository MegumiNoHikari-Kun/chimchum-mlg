import { supabase, authReady } from '../supabase.js';

/* ================= STATE ================= */
let allOrders = [];        // semua order valid (non-cancel)
let customers = new Map(); // pelanggan teridentifikasi (seluruh riwayat)
let view = null;
let segFilter = 'all';
let custQuery = '';
let custSort = { key: 'total', dir: 'desc' };
let custLimit = 50;
let menuAll = false;
let source = 'supabase';
const charts = {};

// Filter aktif
let period = '30';          // '7' | '30' | '90' | 'month' | 'all' | 'custom'
let channelSel = 'all';     // 'all' | 'offline' | 'shopeefood' | 'grabfood'
let customStart = '';
let customEnd = '';

const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const WD_MAP = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const WINBACK_DAYS = 30;
const PAGE_SIZE = 1000;

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
const num = n => Number(n || 0).toLocaleString('id-ID');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const $ = id => document.getElementById(id);

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
const fmtDateStr = s => fmtDate(s + 'T12:00:00+07:00');       // 'YYYY-MM-DD' -> '30 Okt 2026'
const fmtDateTime = iso => new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' }); // 2026-10-30 14:05:00
const todayJK = () => jk(new Date()).date;

function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function daysBetween(a, b) { // inklusif
    const t = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
    return Math.round((t(b) - t(a)) / 864e5) + 1;
}

function normPhone(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.startsWith('0')) d = '62' + d.slice(1);
    else if (d.startsWith('8')) d = '62' + d;
    return d;
}

function showToast(msg, type = 'ok') {
    const t = $('toast');
    if (!t) return;
    const color = type === 'err' ? 'bg-rose-600' : type === 'warn' ? 'bg-amber-500' : 'bg-slate-800';
    const icon = type === 'err' ? 'fa-circle-exclamation' : type === 'warn' ? 'fa-triangle-exclamation' : 'fa-circle-check';
    t.className = `fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-xs font-medium text-white shadow-lg flex items-center gap-2 ${color}`;
    t.innerHTML = `<i class="fa-solid ${icon}"></i><span>${esc(msg)}</span>`;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => t.classList.add('hidden'), 3500);
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
const itemsOf = o => (Array.isArray(o.items) ? o.items : []);
const countItems = list => list.reduce((s, o) => s + itemsOf(o).reduce((a, i) => a + itemQty(i), 0), 0);
const sumRev = list => list.reduce((s, o) => s + Number(o.grand_total || 0), 0);

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
// Supabase membatasi 1000 baris per request, jadi ambil bertahap supaya riwayat lengkap.
async function fetchAllOrders() {
    const rows = [];
    for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase.from('orders').select('*')
            .order('created_at', { ascending: true }).range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        if (!data || !data.length) break;
        rows.push(...data);
        if (data.length < PAGE_SIZE) break;
    }
    return rows;
}

function setLoading(on) {
    const icon = $('refreshIcon');
    if (icon) icon.classList.toggle('fa-spin', on);
    if (on && !view) {
        const sk = '<div class="h-28 rounded-2xl bg-slate-200/70 animate-pulse"></div>';
        $('heroCards').innerHTML = sk.repeat(4);
    }
}

window.loadAnalytics = async function () {
    setLoading(true);
    await authReady;
    let orders = [];
    source = 'supabase';
    try {
        orders = await fetchAllOrders();
    } catch (e) {
        console.warn(e);
        showToast('Gagal mengambil data dari server. Menampilkan data lokal jika ada.', 'warn');
    }
    if (orders.length === 0) {
        try {
            const local = JSON.parse(localStorage.getItem('local_orders') || '[]');
            if (local.length) { orders = local; source = 'local'; }
        } catch (e) { console.warn(e); }
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
        itemsOf(o).forEach(i => {
            c.items.set(itemName(i), (c.items.get(itemName(i)) || 0) + itemQty(i));
        });
    });
    customers.forEach(c => {
        c.name = [...c.variants.values()].sort((a, b) => b.c - a.c)[0]?.n || '-';
        c.channel = [...c.channels.entries()].sort((a, b) => b[1] - a[1])[0][0];
    });

    analyze();
    setLoading(false);
    const lu = $('lastUpdated');
    if (lu) lu.textContent = 'Diperbarui ' + new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }) + (source === 'local' ? ' (data lokal)' : '');
};

/* ================= RENTANG PERIODE ================= */
function getRange() {
    const today = todayJK();
    if (period === 'all') return { start: '0000-00-00', end: '9999-12-31', all: true };
    if (period === 'custom') {
        let s = customStart || today, e = customEnd || today;
        if (s > e) [s, e] = [e, s];
        return { start: s, end: e, all: false };
    }
    if (period === 'month') return { start: today.slice(0, 7) + '-01', end: today, all: false };
    const n = parseInt(period, 10) || 30;
    return { start: addDays(today, -(n - 1)), end: today, all: false };
}
const rangeLabel = r => (r.all ? 'Semua waktu' : r.start === r.end ? fmtDateStr(r.start) : `${fmtDateStr(r.start)} – ${fmtDateStr(r.end)}`);
const rangeSlug = r => (r.all ? 'semua-waktu' : r.start === r.end ? r.start : `${r.start}_sd_${r.end}`);

const custOf = o => customers.get(o._cid);
const isRepOrder = o => { const c = custOf(o); return !!c && c.orders.length >= 2; };
const inRange = (o, r) => o._jk.date >= r.start && o._jk.date <= r.end;

/* ================= ANALISA PERIODE ================= */
function analyze() {
    const range = getRange();
    const periodOrders = allOrders.filter(o => inRange(o, range));
    const orders = channelSel === 'all' ? periodOrders : periodOrders.filter(o => o._ch === channelSel);

    // Periode pembanding (rentang hari yang sama persis sebelum periode terpilih)
    let prev = null;
    if (!range.all) {
        const len = daysBetween(range.start, range.end);
        const pe = addDays(range.start, -1);
        const ps = addDays(pe, -(len - 1));
        const po = allOrders.filter(o => o._jk.date >= ps && o._jk.date <= pe && (channelSel === 'all' || o._ch === channelSel));
        prev = { start: ps, end: pe, tx: po.length, items: countItems(po), rev: sumRev(po) };
    }

    const identified = orders.filter(o => o._cid);
    const anonCount = orders.length - identified.length;
    const active = [...new Set(identified.map(o => o._cid))].map(id => customers.get(id));
    const newCust = active.filter(c => c.orders.length < 2);
    const repCust = active.filter(c => c.orders.length >= 2);

    // Statistik tiap pelanggan khusus di periode terpilih
    const pstat = new Map();
    identified.forEach(o => {
        const s = pstat.get(o._cid) || { n: 0, total: 0 };
        s.n++; s.total += Number(o.grand_total || 0);
        pstat.set(o._cid, s);
    });

    const revenue = sumRev(orders);
    const totalItems = countItems(orders);
    const repOrders = orders.filter(isRepOrder);
    const revRepeat = sumRev(repOrders);

    // Perbandingan channel (selalu semua channel di periode terpilih)
    const chStats = Object.keys(CHANNELS).map(k => {
        const os = periodOrders.filter(o => o._ch === k);
        const ids = new Set(os.filter(o => o._cid).map(o => o._cid));
        const rep = [...ids].filter(id => customers.get(id).orders.length >= 2).length;
        const rev = sumRev(os);
        return { key: k, orders: os.length, items: countItems(os), rev, aov: os.length ? rev / os.length : 0, cust: ids.size, rep, anon: os.filter(o => !o._cid).length };
    });

    const menu = new Map(), pairs = new Map(), pay = new Map();
    const hours = Array(24).fill(0), days = Array(7).fill(0);

    orders.forEach(o => {
        const rep = isRepOrder(o);
        const names = new Set();
        itemsOf(o).forEach(i => {
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

    view = { range, prev, chSel: channelSel, orders, anonCount, active, newCust, repCust, pstat, revenue, totalItems, revRepeat, ordersRepeat: repOrders.length, chStats, menu: [...menu.values()], pairs, hours, days, pay, winback: winbackList() };

    custLimit = 50;
    renderFilterSummary();
    renderHero();
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
function renderFilterSummary() {
    const v = view;
    const chLabel = v.chSel === 'all' ? 'Semua channel' : CHANNELS[v.chSel].label;
    const pill = (icon, text) => `<span class="inline-flex items-center gap-1.5 bg-white border border-slate-200 rounded-full px-3 py-1 text-[11px] text-slate-600"><i class="fa-solid ${icon} text-orange-500"></i>${esc(text)}</span>`;
    $('filterSummary').innerHTML =
        pill('fa-calendar-days', rangeLabel(v.range)) +
        pill('fa-store', chLabel) +
        pill('fa-receipt', `${num(v.orders.length)} transaksi`) +
        (v.prev ? pill('fa-clock-rotate-left', `Pembanding: ${rangeLabel(v.prev)}`) : '');
    $('emptyNotice').classList.toggle('hidden', v.orders.length > 0);
}

function deltaChip(cur, prev) {
    if (prev == null) return '';
    if (prev === 0) return cur > 0 ? '<span class="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-sky-50 text-sky-600">baru</span>' : '';
    const d = Math.round(((cur - prev) / prev) * 100);
    const up = d >= 0;
    return `<span class="text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${up ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}" title="Dibanding periode sebelumnya"><i class="fa-solid ${up ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'}"></i> ${up ? '+' : ''}${d}%</span>`;
}

function renderHero() {
    const v = view;
    const nTx = v.orders.length;
    const aov = nTx ? v.revenue / nTx : 0;
    const prevAov = v.prev && v.prev.tx ? v.prev.rev / v.prev.tx : v.prev ? 0 : null;
    const cards = [
        { t: 'Total Transaksi', val: num(nTx), sub: `${num(v.active.length)} pelanggan dikenali`, icon: 'fa-receipt', grad: 'from-orange-500 to-amber-500', d: deltaChip(nTx, v.prev?.tx) },
        { t: 'Total Menu Terjual', val: num(v.totalItems), sub: `${num(v.menu.length)} jenis menu, ${nTx ? (v.totalItems / nTx).toFixed(1) : '0'} item/transaksi`, icon: 'fa-utensils', grad: 'from-rose-500 to-orange-500', d: deltaChip(v.totalItems, v.prev?.items) },
        { t: 'Omzet', val: rupiah(v.revenue), sub: `${pct(v.revRepeat, v.revenue)}% dari pelanggan repeat`, icon: 'fa-sack-dollar', grad: 'from-emerald-500 to-teal-500', d: deltaChip(v.revenue, v.prev?.rev) },
        { t: 'Rata-rata per Transaksi', val: rupiah(aov), sub: 'nilai keranjang (AOV)', icon: 'fa-basket-shopping', grad: 'from-indigo-500 to-violet-500', d: deltaChip(aov, prevAov) }
    ];
    $('heroCards').innerHTML = cards.map(c => `
        <div class="relative overflow-hidden rounded-2xl p-4 text-white bg-gradient-to-br ${c.grad} shadow-sm">
            <i class="fa-solid ${c.icon} absolute -right-2 -bottom-3 text-6xl opacity-15"></i>
            <div class="text-[11px] font-medium opacity-90">${c.t}</div>
            <div class="text-2xl font-bold mt-1 truncate">${c.val}</div>
            <div class="text-[11px] opacity-90 mt-1 truncate">${esc(c.sub)}</div>
            <div class="mt-2 min-h-[20px] flex items-center gap-1.5">${c.d ? `<span class="bg-white rounded-md leading-none">${c.d}</span><span class="text-[10px] opacity-90">vs periode sebelumnya</span>` : ''}</div>
        </div>`).join('');
}

function renderKPI() {
    const v = view;
    const nOrders = v.orders.length;
    const nCust = v.active.length;
    const identifiedOrders = nOrders - v.anonCount;
    const cards = [
        { t: 'Pelanggan Aktif', val: num(nCust), sub: 'unik di periode ini', icon: 'fa-users', cls: 'bg-slate-100 text-slate-600' },
        { t: 'Pelanggan Baru', val: num(v.newCust.length), sub: `${pct(v.newCust.length, nCust)}% dari pelanggan`, icon: 'fa-user-plus', cls: 'bg-sky-50 text-sky-600' },
        { t: 'Pelanggan Repeat', val: num(v.repCust.length), sub: `${pct(v.repCust.length, nCust)}% dari pelanggan`, icon: 'fa-repeat', cls: 'bg-emerald-50 text-emerald-600' },
        { t: 'Repeat Rate', val: pct(v.repCust.length, nCust) + '%', sub: 'target sehat: > 25–30%', icon: 'fa-chart-line', cls: 'bg-orange-50 text-orange-600' },
        { t: 'Order / Pelanggan', val: nCust ? (identifiedOrders / nCust).toFixed(2) : '0', sub: 'frekuensi beli', icon: 'fa-arrows-rotate', cls: 'bg-rose-50 text-rose-600' },
        { t: 'Order dari Repeat', val: num(v.ordersRepeat), sub: `${pct(v.ordersRepeat, identifiedOrders)}% dari order teridentifikasi`, icon: 'fa-clipboard-check', cls: 'bg-purple-50 text-purple-600' },
        { t: 'Tanpa Identitas', val: num(v.anonCount), sub: `${pct(v.anonCount, nOrders)}% order tidak dihitung sebagai pelanggan`, icon: 'fa-user-secret', cls: 'bg-slate-100 text-slate-500' },
        { t: 'Perlu Follow-up', val: num(v.winback.length), sub: `repeat, tidak order > ${WINBACK_DAYS} hari`, icon: 'fa-bullhorn', cls: 'bg-amber-50 text-amber-600' }
    ];
    $('kpiCards').innerHTML = cards.map(c => `
        <div class="bg-white rounded-xl p-4 border border-slate-200 flex items-center justify-between gap-2">
            <div class="min-w-0">
                <div class="text-[11px] font-medium text-slate-500">${c.t}</div>
                <div class="text-lg font-bold mt-1 text-slate-800 truncate">${c.val}</div>
                <div class="text-[10px] text-slate-400 mt-0.5">${c.sub}</div>
            </div>
            <div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${c.cls}"><i class="fa-solid ${c.icon}"></i></div>
        </div>`).join('');
}

function renderChannel() {
    const body = $('channelBody');
    body.innerHTML = view.chStats.map(s => `
        <tr class="hover:bg-slate-50/80 ${view.chSel === s.key ? 'bg-orange-50/50' : ''}">
            <td class="p-3">${chBadge(s.key)}</td>
            <td class="p-3 font-semibold">${num(s.orders)}</td>
            <td class="p-3 font-semibold">${num(s.items)}</td>
            <td class="p-3 text-emerald-600 font-semibold">${rupiah(s.rev)}</td>
            <td class="p-3 text-slate-600">${rupiah(s.aov)}</td>
            <td class="p-3">${num(s.cust)}</td>
            <td class="p-3">${num(s.rep)} <span class="text-slate-400">(${pct(s.rep, s.cust)}%)</span></td>
            <td class="p-3 text-slate-500">${num(s.anon)}</td>
        </tr>`).join('');
}

function makeChart(id, config) {
    if (charts[id]) charts[id].destroy();
    const el = $(id);
    if (!el || typeof Chart === 'undefined') return;
    charts[id] = new Chart(el, config);
}

function renderTrend() {
    const r = view.range;
    const today = todayJK();
    let span;
    if (r.all) {
        span = view.orders.length ? (new Date(view.orders[view.orders.length - 1].created_at) - new Date(view.orders[0].created_at)) / 864e5 : 0;
    } else {
        span = daysBetween(r.start, r.end < today ? r.end : today);
    }
    const byMonth = span > 62;
    const bucket = o => (byMonth ? o._jk.date.slice(0, 7) : o._jk.date);
    const map = new Map();
    view.orders.forEach(o => {
        const k = bucket(o);
        const row = map.get(k) || { baru: 0, repeat: 0, anon: 0 };
        if (!o._cid) row.anon++;
        else if (isRepOrder(o)) row.repeat++;
        else row.baru++;
        map.set(k, row);
    });
    let keys;
    if (!byMonth && !r.all) { // isi hari kosong supaya grafik tidak melompat
        keys = [];
        const end = r.end < today ? r.end : today;
        for (let d = r.start; d <= end; d = addDays(d, 1)) keys.push(d);
    } else {
        keys = [...map.keys()].sort();
    }
    const get = k => map.get(k) || { baru: 0, repeat: 0, anon: 0 };
    makeChart('trendChart', {
        type: 'bar',
        data: {
            labels: keys.map(k => (byMonth ? k : k.slice(8) + '/' + k.slice(5, 7))),
            datasets: [
                { label: 'Pelanggan Baru', data: keys.map(k => get(k).baru), backgroundColor: '#38bdf8' },
                { label: 'Pelanggan Repeat', data: keys.map(k => get(k).repeat), backgroundColor: '#10b981' },
                { label: 'Tanpa Identitas', data: keys.map(k => get(k).anon), backgroundColor: '#cbd5e1' }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } }, plugins: { legend: { position: 'bottom' } } }
    });
}

function renderSplit() {
    const loyal = view.active.filter(c => c.orders.length >= 4).length;
    const rep = view.repCust.length - loyal;
    makeChart('splitChart', {
        type: 'doughnut',
        data: { labels: ['Baru (1x)', 'Repeat (2–3x)', 'Loyal (≥4x)'], datasets: [{ data: [view.newCust.length, rep, loyal], backgroundColor: ['#38bdf8', '#f59e0b', '#10b981'], borderWidth: 2 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, cutout: '60%' }
    });
}

function sortedMenu() {
    const sortKey = $('menuSort').value;
    return [...view.menu].sort((a, b) => b[sortKey] - a[sortKey] || b.qty - a.qty);
}

function renderMenu() {
    const sortKey = $('menuSort').value;
    const all = sortedMenu();
    const list = menuAll ? all : all.slice(0, 10);
    const max = Math.max(1, ...list.map(m => m[sortKey]));
    const body = $('menuBody');
    const btn = $('menuToggle');
    btn.classList.toggle('hidden', all.length <= 10);
    btn.textContent = menuAll ? 'Tampilkan 10 teratas' : `Tampilkan semua (${all.length} menu)`;
    if (!list.length) { body.innerHTML = `<tr><td colspan="6" class="text-center py-10 text-slate-400">Belum ada penjualan menu di periode ini.</td></tr>`; return; }
    body.innerHTML = list.map((m, i) => `
        <tr class="hover:bg-slate-50/80">
            <td class="p-3 text-slate-400">${i + 1}</td>
            <td class="p-3 font-semibold text-slate-800">${esc(m.name)}
                <div class="h-1.5 bg-slate-100 rounded-full mt-1.5 w-32"><div class="h-1.5 bg-orange-400 rounded-full" style="width:${Math.round((m[sortKey] / max) * 100)}%"></div></div>
            </td>
            <td class="p-3 font-bold text-slate-700">${num(m.qty)}x <span class="font-normal text-slate-400">(${pct(m.qty, view.totalItems)}%)</span></td>
            <td class="p-3 text-emerald-600 font-semibold">${rupiah(m.revenue)}</td>
            <td class="p-3 text-slate-600">${num(m.orders)} <span class="text-slate-400">(${pct(m.orders, view.orders.length)}%)</span></td>
            <td class="p-3 text-slate-600">${pct(m.repQty, m.qty)}%</td>
        </tr>`).join('');
}

function renderPairs() {
    const top = [...view.pairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    $('pairsList').innerHTML = top.length
        ? top.map(([k, n], i) => `
            <div class="flex items-start justify-between gap-2 p-2 rounded-lg bg-slate-50">
                <span class="text-slate-700"><b class="text-orange-500">${i + 1}.</b> ${esc(k)}</span>
                <span class="shrink-0 font-semibold text-slate-600">${n}x</span>
            </div>`).join('')
        : `<div class="text-slate-400">Belum ada order dengan ≥ 2 jenis menu.</div>`;
}

function renderTime() {
    const hourLabels = view.hours.map((_, h) => String(h).padStart(2, '0'));
    const maxH = Math.max(...view.hours);
    const peakHour = view.hours.indexOf(maxH);
    makeChart('hourChart', {
        type: 'bar',
        data: { labels: hourLabels, datasets: [{ data: view.hours, backgroundColor: view.hours.map((_, h) => (h === peakHour && maxH > 0 ? '#f97316' : '#fdba74')) }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });
    $('hourInsight').textContent = maxH > 0
        ? `Paling ramai pukul ${String(peakHour).padStart(2, '0')}.00–${String((peakHour + 1) % 24).padStart(2, '0')}.00 dengan ${num(maxH)} order.`
        : 'Belum ada data.';

    const maxD = Math.max(...view.days);
    const peakDay = view.days.indexOf(maxD);
    makeChart('dayChart', {
        type: 'bar',
        data: { labels: DAY_NAMES.map(d => d.slice(0, 3)), datasets: [{ data: view.days, backgroundColor: view.days.map((_, d) => (d === peakDay && maxD > 0 ? '#6366f1' : '#c7d2fe')) }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });
    $('dayInsight').textContent = maxD > 0 ? `Hari tersibuk: ${DAY_NAMES[peakDay]} dengan ${num(maxD)} order.` : 'Belum ada data.';
}

function renderPay() {
    const rows = [...view.pay.entries()].sort((a, b) => b[1].n - a[1].n);
    const total = view.orders.length || 1;
    $('payList').innerHTML = rows.length
        ? rows.map(([k, v]) => `
            <div>
                <div class="flex justify-between gap-2"><span class="font-semibold text-slate-700">${esc(k)}</span><span class="text-slate-500 text-right">${num(v.n)} order, ${rupiah(v.total)}</span></div>
                <div class="h-1.5 bg-slate-100 rounded-full mt-1"><div class="h-1.5 bg-emerald-400 rounded-full" style="width:${pct(v.n, total)}%"></div></div>
            </div>`).join('')
        : `<div class="text-slate-400">Belum ada data.</div>`;
}

const waLink = (phone, text) => (phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : '');

function winbackList() {
    const now = Date.now();
    return [...customers.values()]
        .filter(c => c.orders.length >= 2 && (now - new Date(c.last)) / 864e5 > WINBACK_DAYS && (channelSel === 'all' || c.channels.has(channelSel)))
        .sort((a, b) => b.total - a.total);
}

function renderWinback() {
    const now = Date.now();
    const full = view.winback;
    const list = full.slice(0, 15);
    const body = $('winbackBody');
    $('winbackCount').textContent = full.length;
    if (!list.length) { body.innerHTML = `<tr><td colspan="6" class="text-center py-10 text-slate-400">Semua pelanggan repeat masih aktif. Tidak ada yang perlu di-follow up.</td></tr>`; return; }
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
    }).join('') + (full.length > list.length ? `<tr><td colspan="6" class="p-3 text-center text-[11px] text-slate-400">Menampilkan 15 teratas dari ${full.length} pelanggan, diurutkan berdasarkan total belanja.</td></tr>` : '');
}

function renderSegFilter() {
    const counts = { all: view.active.length, baru: 0, repeat: 0, loyal: 0 };
    view.active.forEach(c => counts[segmentOf(c.orders.length)]++);
    const opts = [['all', 'Semua'], ['baru', 'Baru'], ['repeat', 'Repeat'], ['loyal', 'Loyal']];
    $('segFilter').innerHTML = opts.map(([k, l]) => `
        <button onclick="setSegFilter('${k}')" class="px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${segFilter === k ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}">${l} (${counts[k]})</button>`).join('');
}

const SORT_VAL = {
    name:  (c, s) => c.name.toLowerCase(),
    channel: (c) => c.channel,
    seg:   (c) => c.orders.length,
    orders: (c, s) => s.n,
    total: (c, s) => s.total,
    life:  (c) => c.total,
    first: (c) => new Date(c.first).getTime(),
    last:  (c) => new Date(c.last).getTime()
};

function filteredCustomers() {
    let list = view.active.map(c => ({ c, seg: segmentOf(c.orders.length), s: view.pstat.get(c.id) || { n: 0, total: 0 } }));
    if (segFilter !== 'all') list = list.filter(x => x.seg === segFilter);
    if (custQuery) {
        const digits = custQuery.replace(/\D/g, '');
        list = list.filter(({ c }) =>
            [...c.variants.values()].some(v => v.n.toLowerCase().includes(custQuery)) || (digits && c.phone.includes(digits)));
    }
    const get = SORT_VAL[custSort.key] || SORT_VAL.total;
    const dir = custSort.dir === 'asc' ? 1 : -1;
    return list.sort((a, b) => {
        const x = get(a.c, a.s), y = get(b.c, b.s);
        const r = typeof x === 'string' ? x.localeCompare(y) : x - y;
        return r * dir || b.s.total - a.s.total;
    });
}

function renderSortIndicators() {
    document.querySelectorAll('#custHead th[data-sort]').forEach(th => {
        const ind = th.querySelector('.sort-ind');
        const on = th.dataset.sort === custSort.key;
        th.classList.toggle('text-orange-600', on);
        if (ind) ind.innerHTML = on ? `<i class="fa-solid ${custSort.dir === 'asc' ? 'fa-sort-up' : 'fa-sort-down'} ml-1"></i>` : '<i class="fa-solid fa-sort ml-1 opacity-30"></i>';
    });
}

function renderCustomers() {
    const list = filteredCustomers();
    const body = $('custBody');
    const shown = list.slice(0, custLimit);
    renderSortIndicators();
    body.innerHTML = shown.length ? shown.map(({ c, seg, s }) => {
        const vars = otherVariants(c);
        return `
        <tr class="hover:bg-slate-50/80">
            <td class="p-3 font-semibold text-slate-800">${esc(c.name)}${vars.length ? `<div class="font-normal text-[10px] text-amber-600" title="Nama-nama ini digabung otomatis">≈ ${esc(vars.join(', '))}</div>` : ''}</td>
            <td class="p-3">${chBadge(c.channel)}</td>
            <td class="p-3 text-slate-600">${c.phone ? `<a class="hover:underline text-emerald-600" target="_blank" rel="noopener noreferrer" href="https://wa.me/${c.phone}">${esc(c.phone)}</a>` : '<span class="text-slate-300">-</span>'}</td>
            <td class="p-3">${segBadge(seg)}</td>
            <td class="p-3 font-semibold">${s.n}x <div class="font-normal text-[10px] text-slate-400">total ${c.orders.length}x</div></td>
            <td class="p-3 text-emerald-600 font-semibold">${rupiah(s.total)} <div class="font-normal text-[10px] text-slate-400">rata-rata ${rupiah(s.n ? s.total / s.n : 0)}</div></td>
            <td class="p-3 text-slate-600">${rupiah(c.total)}</td>
            <td class="p-3 text-slate-500">${fmtDate(c.first)}</td>
            <td class="p-3 text-slate-500">${fmtDate(c.last)}</td>
            <td class="p-3 text-slate-600 max-w-xs">${topItemOf(c)}</td>
        </tr>`;
    }).join('') : `<tr><td colspan="10" class="text-center py-10 text-slate-400">Tidak ada pelanggan yang cocok dengan filter ini.</td></tr>`;

    $('custFooter').innerHTML = `<span>Menampilkan ${shown.length} dari ${list.length} pelanggan.</span>` +
        (list.length > shown.length ? `<button onclick="moreCustomers()" class="ml-3 px-3 py-1 rounded-lg bg-orange-50 text-orange-700 font-semibold hover:bg-orange-100 transition">Tampilkan 50 lagi</button>` : '');
}

// Daftar nama yang digabung otomatis, supaya bisa dicek kebenarannya
function renderMerged() {
    const merged = [...customers.values()].filter(c => otherVariants(c).length > 0).sort((a, b) => b.orders.length - a.orders.length);
    $('mergedCount').textContent = merged.length;
    $('mergedBody').innerHTML = merged.length
        ? merged.map(c => `
            <tr class="hover:bg-slate-50/80">
                <td class="p-3">${chBadge(c.channel)}</td>
                <td class="p-3 font-semibold text-slate-800">${[...c.variants.values()].sort((a, b) => b.c - a.c).map(v => `${esc(v.n)} <span class="font-normal text-slate-400">(${v.c}x)</span>`).join(' &nbsp;/&nbsp; ')}</td>
                <td class="p-3 font-semibold">${c.orders.length}x</td>
            </tr>`).join('')
        : `<tr><td colspan="3" class="text-center py-6 text-slate-400">Tidak ada nama yang digabung otomatis.</td></tr>`;
}

/* ================= EXPORT CSV (mengikuti filter aktif) ================= */
function downloadCSV(rows, base) {
    const q = v => {
        let s = String(v ?? '');
        if (/^[=+\-@]/.test(s)) s = "'" + s; // cegah formula injection di Excel
        return `"${s.replace(/"/g, '""')}"`;
    };
    const csv = '\uFEFF' + rows.map(r => r.map(q).join(',')).join('\n');
    const chSlug = view.chSel === 'all' ? 'semua-channel' : view.chSel;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = `${base}_${rangeSlug(view.range)}_${chSlug}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    showToast(`${rows.length - 1} baris diekspor untuk ${rangeLabel(view.range)}`);
}

function guardExport(count) {
    if (!view || !count) { showToast('Tidak ada data pada filter ini untuk diekspor.', 'warn'); return false; }
    return true;
}

window.exportCustomersCSV = function () {
    const list = view ? filteredCustomers() : [];
    if (!guardExport(list.length)) return;
    const rows = [['Nama', 'Variasi Nama', 'Channel', 'WhatsApp', 'Segmen', 'Order di Periode', 'Belanja di Periode', 'Total Order (Semua Waktu)', 'Total Belanja (Semua Waktu)', 'Order Pertama', 'Order Terakhir', 'Menu Favorit']];
    list.forEach(({ c, seg, s }) => {
        rows.push([c.name, otherVariants(c).join(', '), CHANNELS[c.channel].label, c.phone, SEG_STYLE[seg][0], s.n, Math.round(s.total), c.orders.length, Math.round(c.total), fmtDate(c.first), fmtDate(c.last), topItemsText(c, 3)]);
    });
    downloadCSV(rows, 'pelanggan-chimchum');
};

window.exportOrdersCSV = function () {
    if (!guardExport(view && view.orders.length)) return;
    const rows = [['Waktu (WIB)', 'No. Order', 'Pelanggan', 'WhatsApp', 'Channel', 'Metode Bayar', 'Status', 'Menu', 'Jumlah Item', 'Total']];
    view.orders.forEach(o => {
        const items = itemsOf(o);
        const c = custOf(o);
        rows.push([
            fmtDateTime(o.created_at), o.order_number || o.id || '', c ? c.name : (o.customer_name || ''), o._phone,
            CHANNELS[o._ch].label, o.payment_method || 'Cash', o.status || 'new',
            items.map(i => `${itemName(i)} x${itemQty(i)}`).join('; '),
            items.reduce((s, i) => s + itemQty(i), 0), Math.round(Number(o.grand_total || 0))
        ]);
    });
    downloadCSV(rows, 'transaksi-chimchum');
};

window.exportMenuCSV = function () {
    if (!guardExport(view && view.menu.length)) return;
    const rows = [['Menu', 'Jumlah Terjual', 'Omzet', 'Muncul di Order', '% dari Total Terjual', '% Repeat']];
    sortedMenu().forEach(m => rows.push([m.name, m.qty, Math.round(m.revenue), m.orders, pct(m.qty, view.totalItems), pct(m.repQty, m.qty)]));
    downloadCSV(rows, 'menu-chimchum');
};

/* ================= EVENTS ================= */
window.setSegFilter = k => { segFilter = k; custLimit = 50; renderSegFilter(); renderCustomers(); };
window.moreCustomers = () => { custLimit += 50; renderCustomers(); };
window.toggleExportMenu = force => {
    const m = $('exportMenu');
    m.classList.toggle('hidden', typeof force === 'boolean' ? !force : undefined);
};

function syncFilterUI() {
    document.querySelectorAll('#periodChips .chip').forEach(b => b.classList.toggle('active', b.dataset.period === period));
    document.querySelectorAll('#channelChips .chip').forEach(b => b.classList.toggle('active', b.dataset.channel === channelSel));
    $('customRange').classList.toggle('hidden', period !== 'custom');
}

$('periodChips').addEventListener('click', e => {
    const b = e.target.closest('.chip');
    if (!b) return;
    period = b.dataset.period;
    if (period === 'custom' && (!customStart || !customEnd)) {
        customEnd = todayJK();
        customStart = addDays(customEnd, -6);
        $('dateStart').value = customStart;
        $('dateEnd').value = customEnd;
    }
    syncFilterUI();
    allOrders.length && analyze();
});

$('channelChips').addEventListener('click', e => {
    const b = e.target.closest('.chip');
    if (!b) return;
    channelSel = b.dataset.channel;
    syncFilterUI();
    allOrders.length && analyze();
});

function onDateChange() {
    customStart = $('dateStart').value;
    customEnd = $('dateEnd').value;
    if (customStart && customEnd) {
        if (customStart > customEnd) {
            [customStart, customEnd] = [customEnd, customStart];
            $('dateStart').value = customStart;
            $('dateEnd').value = customEnd;
        }
        allOrders.length && analyze();
    }
}
$('dateStart').addEventListener('change', onDateChange);
$('dateEnd').addEventListener('change', onDateChange);
$('dateStart').max = $('dateEnd').max = todayJK();

$('menuSort').addEventListener('change', () => view && renderMenu());
$('menuToggle').addEventListener('click', () => { menuAll = !menuAll; view && renderMenu(); });

$('custSearch').addEventListener('input', e => {
    custQuery = (e.target.value || '').toLowerCase().trim();
    custLimit = 50;
    $('custClear').classList.toggle('hidden', !custQuery);
    view && renderCustomers();
});
$('custClear').addEventListener('click', () => {
    $('custSearch').value = '';
    custQuery = '';
    custLimit = 50;
    $('custClear').classList.add('hidden');
    view && renderCustomers();
});

$('custHead').addEventListener('click', e => {
    const th = e.target.closest('th[data-sort]');
    if (!th || !view) return;
    const k = th.dataset.sort;
    custSort = custSort.key === k
        ? { key: k, dir: custSort.dir === 'asc' ? 'desc' : 'asc' }
        : { key: k, dir: ['name', 'channel'].includes(k) ? 'asc' : 'desc' };
    renderCustomers();
});

document.addEventListener('click', e => {
    if (!e.target.closest('#exportWrap')) $('exportMenu').classList.add('hidden');
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('exportMenu').classList.add('hidden'); });

syncFilterUI();
loadAnalytics();
