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
let insightAll = false;
let trendMetric = 'orders'; // 'orders' | 'revenue'
let winTab = 'risk';        // 'risk' | 'lost'
let winAll = false;
let source = 'supabase';
const charts = {};

// Filter aktif
let period = '30';          // '7' | '30' | '90' | 'month' | 'all' | 'custom'
let channelSel = 'all';     // 'all' | 'offline' | 'shopeefood' | 'grabfood'
let customStart = '';
let customEnd = '';

const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // tampilkan mulai Senin
const WD_MAP = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const MIN_DUE_DAYS = 14;    // jeda minimal sebelum pelanggan repeat dianggap "mulai jarang"
const LOST_DAYS = 90;       // lebih dari ini dianggap hilang
const REPEAT_TARGET = 25;   // target repeat rate (%)
const PAGE_SIZE = 1000;

/* ============ KONFIGURASI TIPE PESANAN ============
   Field di tabel `orders` yang dicek untuk mendeteksi tipe pesanan.
   Kalau tipe pesanan Anda disimpan di kolom lain, tambahkan nama kolomnya di sini.
   Aturan: mengandung "shopee" -> ShopeeFood, mengandung "grab" -> GrabFood, selain itu -> Offline. */
const CHANNEL_FIELDS = ['order_type', 'tipe', 'type', 'channel', 'source', 'platform', 'payment_method'];
const CHANNELS = {
    offline:    { label: 'Offline',    cls: 'bg-slate-100 text-slate-700 border-slate-300', bar: '#64748b' },
    shopeefood: { label: 'ShopeeFood', cls: 'bg-orange-50 text-orange-700 border-orange-200', bar: '#f97316' },
    grabfood:   { label: 'GrabFood',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', bar: '#10b981' }
};
const chBadge = k => `<span class="inline-block px-2 py-0.5 rounded-full border text-[10px] font-semibold whitespace-nowrap ${CHANNELS[k].cls}">${CHANNELS[k].label}</span>`;

function channelOf(o) {
    const raw = CHANNEL_FIELDS.map(f => String(o[f] || '').toLowerCase()).join(' ');
    if (raw.includes('shopee')) return 'shopeefood';
    if (raw.includes('grab')) return 'grabfood';
    return 'offline';
}

/* ============ PENGATURAN (disimpan di browser) ============ */
const SETTINGS_KEY = 'chimchum_analisa_settings';
const DEFAULT_FEE = { offline: 0, shopeefood: 20, grabfood: 20 };
function loadSettings() {
    try {
        const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
        return { target: Number(s.target) || 0, fee: { ...DEFAULT_FEE, ...(s.fee || {}) } };
    } catch (e) {
        return { target: 0, fee: { ...DEFAULT_FEE } };
    }
}
let settings = loadSettings();
function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { console.warn(e); }
}
const feeOf = ch => Math.min(100, Math.max(0, Number(settings.fee[ch]) || 0)) / 100;

/* ================= HELPERS ================= */
const rupiah = n => 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID');
function rupiahShort(n) {
    const v = Math.round(Number(n || 0)), a = Math.abs(v);
    const f = (x, d) => x.toLocaleString('id-ID', { maximumFractionDigits: d });
    if (a >= 1e9) return 'Rp ' + f(v / 1e9, 1) + ' M';
    if (a >= 1e6) return 'Rp ' + f(v / 1e6, 1) + ' jt';
    if (a >= 1e4) return 'Rp ' + f(v / 1e3, 0) + ' rb';
    return rupiah(v);
}
const num = n => Number(n || 0).toLocaleString('id-ID');
const dec = (n, d = 1) => Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: d });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const pctDelta = (cur, prev) => (prev ? Math.round(((cur - prev) / prev) * 100) : 0);
const fp = d => `${d > 0 ? '+' : ''}${d}%`;
const hh = h => String(h % 24).padStart(2, '0') + '.00';
const $ = id => document.getElementById(id);
const isSmall = () => window.matchMedia('(max-width: 767px)').matches;
const custPage = () => (isSmall() ? 20 : 50);

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
// Berapa kali tiap hari (Min..Sab) muncul di rentang tanggal
function weekdayCounts(start, end) {
    const occ = Array(7).fill(0);
    if (!start || !end || start > end) return occ;
    const n = daysBetween(start, end);
    const [y, m, d] = start.split('-').map(Number);
    const w0 = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    for (let i = 0; i < n; i++) occ[(w0 + i) % 7]++;
    return occ;
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
    t.className = `fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-max max-w-[calc(100vw-2rem)] px-4 py-2.5 rounded-xl text-xs font-medium text-white shadow-lg flex items-center gap-2 ${color}`;
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
const sumNet = list => list.reduce((s, o) => s + Number(o.grand_total || 0) * (1 - feeOf(o._ch)), 0);

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
const segBadge = seg => `<span class="inline-block px-2 py-0.5 rounded-full border text-[10px] font-semibold whitespace-nowrap ${SEG_STYLE[seg][1]}">${SEG_STYLE[seg][0]}</span>`;

/* Status keaktifan pelanggan, dihitung dari pola order masing-masing:
   - aktif    : masih dalam jeda order biasanya
   - berisiko : pelanggan repeat yang sudah melewati 1,5x jeda biasanya (min. 14 hari)
   - hilang   : pelanggan repeat yang tidak order > 90 hari
   - sekali   : baru order 1x dan belum kembali > 30 hari */
const STATUS_STYLE = {
    aktif:    ['Aktif',          'bg-emerald-50 text-emerald-700 border-emerald-200'],
    berisiko: ['Mulai jarang',   'bg-amber-50 text-amber-700 border-amber-200'],
    hilang:   ['Hilang',         'bg-rose-50 text-rose-700 border-rose-200'],
    sekali:   ['Belum kembali',  'bg-slate-100 text-slate-600 border-slate-200']
};
const statusBadge = c => `<span class="inline-block px-2 py-0.5 rounded-full border text-[10px] font-semibold whitespace-nowrap ${STATUS_STYLE[c.status][1]}">${STATUS_STYLE[c.status][0]}</span>`;
function statusOf(c) {
    if (c.orders.length < 2) return c.daysSince > 30 ? 'sekali' : 'aktif';
    if (c.daysSince > LOST_DAYS) return 'hilang';
    if (c.daysSince > c.dueDays) return 'berisiko';
    return 'aktif';
}

function topItemsText(c, n = 2) {
    return [...c.items.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, q]) => `${k} (${q}x)`).join(', ') || '-';
}
const topItemOf = (c, n = 2) => esc(topItemsText(c, n));
const favItem = c => [...c.items.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';

// Variasi penulisan nama selain nama utama
function otherVariants(c) {
    return [...c.variants.values()].filter(v => v.n.toLowerCase() !== c.name.toLowerCase()).map(v => v.n);
}

/* Klasifikasi menu (menu engineering sederhana, pakai harga sebagai pendekatan margin) */
const MENU_CLS = {
    bintang:   ['Bintang',   'bg-emerald-50 text-emerald-700 border-emerald-200', 'Laris dan harganya di atas rata-rata. Jaga kualitas, tampilkan paling depan.'],
    andalan:   ['Andalan',   'bg-sky-50 text-sky-700 border-sky-200',             'Laris tapi harganya di bawah rata-rata. Uji naik harga sedikit atau jadikan paket.'],
    potensial: ['Potensial', 'bg-amber-50 text-amber-700 border-amber-200',       'Harga tinggi tapi jarang dipesan. Perbaiki foto/deskripsi, minta kasir merekomendasikan.'],
    evaluasi:  ['Evaluasi',  'bg-rose-50 text-rose-700 border-rose-200',          'Jarang dipesan dan murah. Pertimbangkan diganti atau dihapus.']
};
const menuBadge = k => (k ? `<span class="inline-block px-1.5 py-0.5 rounded-md border text-[9px] font-semibold align-middle ${MENU_CLS[k][1]}" title="${MENU_CLS[k][2]}">${MENU_CLS[k][0]}</span>` : '');

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
        const sk = h => `<div class="${h} rounded-2xl bg-slate-200/70 animate-pulse"></div>`;
        $('heroCards').innerHTML = sk('h-28').repeat(4);
        $('targetCard').innerHTML = sk('h-24');
        $('insightList').innerHTML = sk('h-20').repeat(4);
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
    const now = Date.now();
    customers.forEach(c => {
        c.name = [...c.variants.values()].sort((a, b) => b.c - a.c)[0]?.n || '-';
        c.channel = [...c.channels.entries()].sort((a, b) => b[1] - a[1])[0][0];
        c.daysSince = Math.max(0, Math.floor((now - new Date(c.last)) / 864e5));
        c.avgGap = c.orders.length >= 2 ? (new Date(c.last) - new Date(c.first)) / 864e5 / (c.orders.length - 1) : 0;
        c.dueDays = Math.max(MIN_DUE_DAYS, Math.round(c.avgGap * 1.5));
        c.status = statusOf(c);
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
    const today = todayJK();
    const chOk = o => channelSel === 'all' || o._ch === channelSel;
    const periodOrders = allOrders.filter(o => inRange(o, range));
    const orders = periodOrders.filter(chOk);

    // Periode pembanding (rentang hari yang sama persis sebelum periode terpilih)
    let prev = null;
    if (!range.all) {
        const len = daysBetween(range.start, range.end);
        const pe = addDays(range.start, -1);
        const ps = addDays(pe, -(len - 1));
        const po = allOrders.filter(o => o._jk.date >= ps && o._jk.date <= pe && chOk(o));
        const menuQty = new Map();
        po.forEach(o => itemsOf(o).forEach(i => menuQty.set(itemName(i), (menuQty.get(itemName(i)) || 0) + itemQty(i))));
        prev = { start: ps, end: pe, tx: po.length, items: countItems(po), rev: sumRev(po), menuQty };
        prev.aov = prev.tx ? prev.rev / prev.tx : 0;
    }

    const identified = orders.filter(o => o._cid);
    const anonCount = orders.length - identified.length;
    const active = [...new Set(identified.map(o => o._cid))].map(id => customers.get(id));
    const newCust = active.filter(c => c.orders.length < 2);
    const repCust = active.filter(c => c.orders.length >= 2);
    // Pelanggan yang order pertamanya terjadi di periode ini, dan yang sudah kembali lagi
    const acquired = active.filter(c => inRange(c.orders[0], range));
    const returned = acquired.filter(c => c.orders.length >= 2);

    // Statistik tiap pelanggan khusus di periode terpilih
    const pstat = new Map();
    identified.forEach(o => {
        const s = pstat.get(o._cid) || { n: 0, total: 0 };
        s.n++; s.total += Number(o.grand_total || 0);
        pstat.set(o._cid, s);
    });

    // Konsentrasi: porsi omzet dari 20% pelanggan teratas
    let topShare = null;
    if (pstat.size >= 20) {
        const spend = [...pstat.values()].map(s => s.total).sort((a, b) => b - a);
        const n = Math.ceil(spend.length * 0.2);
        const tot = spend.reduce((a, b) => a + b, 0);
        topShare = { n, pct: pct(spend.slice(0, n).reduce((a, b) => a + b, 0), tot) };
    }

    const revenue = sumRev(orders);
    const netRevenue = sumNet(orders);
    const totalItems = countItems(orders);
    const repOrders = orders.filter(isRepOrder);
    const revRepeat = sumRev(repOrders);

    // Perbandingan channel (selalu semua channel di periode terpilih)
    const periodRev = sumRev(periodOrders);
    const chStats = Object.keys(CHANNELS).map(k => {
        const os = periodOrders.filter(o => o._ch === k);
        const ids = new Set(os.filter(o => o._cid).map(o => o._cid));
        const rep = [...ids].filter(id => customers.get(id).orders.length >= 2).length;
        const rev = sumRev(os);
        return { key: k, orders: os.length, items: countItems(os), rev, net: rev * (1 - feeOf(k)), share: pct(rev, periodRev), aov: os.length ? rev / os.length : 0, cust: ids.size, rep, anon: os.filter(o => !o._cid).length };
    });

    const menu = new Map(), pairs = new Map(), pay = new Map();
    const hours = Array(24).fill(0), days = Array(7).fill(0);
    const heat = Array.from({ length: 7 }, () => Array(24).fill(0));

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
        heat[o._jk.wd][o._jk.hour]++;
        const pm = o.payment_method || 'Cash';
        const p = pay.get(pm) || { n: 0, total: 0 };
        p.n++; p.total += Number(o.grand_total || 0);
        pay.set(pm, p);
    });

    // Klasifikasi & tren menu
    const menuList = [...menu.values()];
    const totQty = menuList.reduce((s, m) => s + m.qty, 0);
    const totMenuRev = menuList.reduce((s, m) => s + m.revenue, 0);
    const avgPrice = totQty ? totMenuRev / totQty : 0;
    const popCut = menuList.length ? (0.7 * totQty) / menuList.length : 0;
    menuList.forEach(m => {
        m.avgPrice = m.qty ? m.revenue / m.qty : 0;
        m.prevQty = prev ? prev.menuQty.get(m.name) || 0 : null;
        m.delta = prev ? m.qty - m.prevQty : null;
        m.cls = menuList.length >= 4 && avgPrice > 0
            ? (m.qty >= popCut ? (m.avgPrice >= avgPrice ? 'bintang' : 'andalan') : (m.avgPrice >= avgPrice ? 'potensial' : 'evaluasi'))
            : '';
    });
    // Menu yang laku di periode sebelumnya tapi tidak terjual sama sekali sekarang
    const menuGone = prev ? [...prev.menuQty.entries()].filter(([n, q]) => !menu.has(n) && q >= 5).map(([name, q]) => ({ name, qty: 0, prevQty: q, delta: -q })) : [];

    // Rata-rata order per hari (dibagi berapa kali hari itu muncul di periode)
    const occStart = range.all ? orders[0]?._jk.date : range.start;
    const occEnd = range.all ? today : (range.end < today ? range.end : today);
    const occ = weekdayCounts(occStart, occEnd);

    view = {
        range, prev, chSel: channelSel, orders, anonCount, active, newCust, repCust, acquired, returned, pstat, topShare,
        revenue, netRevenue, totalItems, revRepeat, ordersRepeat: repOrders.length, chStats,
        menu: menuList, menuGone, avgPrice, pairs, hours, days, heat, occ, pay, winback: winbackLists()
    };
    view.time = computeTime(view);
    view.insights = buildInsights(view);

    custLimit = custPage();
    winAll = false;
    renderFilterSummary();
    renderHero();
    renderTarget();
    renderInsights();
    renderKPI();
    renderTrend();
    renderSplit();
    renderMenu();
    renderPairs();
    renderHeatmap();
    renderPay();
    renderChannel();
    renderWinback();
    renderSegFilter();
    renderCustomers();
    renderMerged();
}

function winbackLists() {
    const pool = [...customers.values()].filter(c => c.orders.length >= 2 && (channelSel === 'all' || c.channels.has(channelSel)));
    const byTotal = (a, b) => b.total - a.total;
    return {
        risk: pool.filter(c => c.status === 'berisiko').sort(byTotal),
        lost: pool.filter(c => c.status === 'hilang').sort(byTotal)
    };
}

function computeTime(v) {
    const total = v.orders.length;
    const act = [];
    for (let h = 0; h < 24; h++) if (v.hours[h]) act.push(h);
    if (!act.length) return null;
    const h0 = act[0], h1 = act[act.length - 1];
    let peakH = h0, quietH = h0;
    for (let h = h0; h <= h1; h++) {
        if (v.hours[h] > v.hours[peakH]) peakH = h;
        if (v.hours[h] < v.hours[quietH]) quietH = h;
    }
    const avg = d => (v.occ[d] ? v.days[d] / v.occ[d] : 0);
    const dd = DAY_ORDER.filter(d => v.occ[d] > 0);
    let busyDay = dd[0] ?? 0, quietDay = dd[0] ?? 0;
    dd.forEach(d => { if (avg(d) > avg(busyDay)) busyDay = d; if (avg(d) < avg(quietDay)) quietDay = d; });
    let slot = { d: 0, h: 0, n: -1 };
    DAY_ORDER.forEach(d => { for (let h = h0; h <= h1; h++) if (v.heat[d][h] > slot.n) slot = { d, h, n: v.heat[d][h] }; });
    return {
        h0, h1, peakH, quietH, busyDay, quietDay, slot, avg,
        label: `${hh(peakH)}–${hh(peakH + 1)}`,
        text: `${pct(v.hours[peakH], total)}% order terjadi di jam ini. Paling sepi (dalam jam operasional ${hh(h0)}–${hh(h1 + 1)}): pukul ${hh(quietH)}. ` +
            (dd.length > 1 ? `Hari teramai ${DAY_NAMES[busyDay]} (± ${dec(avg(busyDay))} order/hari), tersepi ${DAY_NAMES[quietDay]} (± ${dec(avg(quietDay))}).` : '')
    };
}

/* ================= INSIGHT OTOMATIS ================= */
function buildInsights(v) {
    const out = [];
    const add = (tone, icon, title, text, action, link) => out.push({ tone, icon, title, text, action, link });
    const nTx = v.orders.length;
    if (!nTx) return out;
    const aov = v.revenue / nTx;

    // 1. Omzet vs periode sebelumnya + pendorongnya
    if (v.prev && v.prev.tx > 0) {
        const dRev = pctDelta(v.revenue, v.prev.rev), dTx = pctDelta(nTx, v.prev.tx), dAov = pctDelta(aov, v.prev.aov);
        const up = dRev >= 0;
        let action;
        if (dRev <= -5) action = dTx <= dAov
            ? 'Penurunan terutama karena jumlah transaksi berkurang. Fokus mendatangkan pembeli: hubungi pelanggan di daftar Perlu Follow-up dan buat promo di jam sepi.'
            : 'Penurunan terutama karena nilai belanja per transaksi turun. Dorong upsell: tawarkan paket, topping, atau minuman di kasir dan di menu online.';
        else if (dRev >= 5) action = (dTx >= dAov ? 'Kenaikan didorong jumlah transaksi.' : 'Kenaikan didorong nilai belanja per transaksi.') + ' Cek menu yang naik daun untuk tahu pendorongnya, lalu pertahankan.';
        else action = 'Omzet relatif stabil. Untuk tumbuh, pilih satu tuas: tambah transaksi (promo/follow-up) atau naikkan nilai belanja (paket/upsell).';
        const partial = v.range.end >= todayJK() ? ' Catatan: hari ini belum selesai.' : '';
        add(dRev >= 5 ? 'good' : dRev <= -5 ? 'bad' : 'info', up ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down',
            `Omzet ${up ? 'naik' : 'turun'} ${Math.abs(dRev)}% dibanding periode sebelumnya`,
            `${rupiah(v.revenue)} vs ${rupiah(v.prev.rev)}. Transaksi ${fp(dTx)}, rata-rata per transaksi ${fp(dAov)}.${partial}`, action, 'sec-retensi');
    }

    // 2. Repeat rate
    const nCust = v.active.length;
    if (nCust >= 10) {
        const rr = pct(v.repCust.length, nCust);
        if (rr < REPEAT_TARGET) add('warn', 'fa-repeat', `Repeat rate ${rr}%, di bawah target ${REPEAT_TARGET}%`,
            `Hanya ${num(v.repCust.length)} dari ${num(nCust)} pelanggan aktif yang pernah order lebih dari sekali.`,
            'Beri alasan untuk kembali: kartu stempel (mis. beli 5 gratis 1), voucher order berikutnya di struk/kemasan, dan minta no. WA di setiap transaksi offline.', 'sec-retensi');
        else add('good', 'fa-repeat', `Repeat rate sehat: ${rr}%`,
            `${num(v.repCust.length)} dari ${num(nCust)} pelanggan aktif sudah order lebih dari sekali.`,
            'Beri benefit khusus untuk pelanggan Loyal (≥4x) supaya tidak pindah ke kompetitor.', 'sec-pelanggan');
    }

    // 3. Pelanggan baru yang kembali
    if (!v.range.all && v.acquired.length >= 5) {
        const r = pct(v.returned.length, v.acquired.length);
        add(r < 20 ? 'warn' : 'good', 'fa-user-plus', `${r}% pelanggan baru sudah order lagi`,
            `Dari ${num(v.acquired.length)} pelanggan yang pertama kali order di periode ini, ${num(v.returned.length)} sudah kembali.`,
            r < 20 ? 'Order ke-2 adalah titik paling kritis. Kirim ucapan terima kasih + voucher yang berlaku 7 hari setelah order pertama.'
                   : 'Pertahankan pengalaman order pertama (kecepatan, rasa, kemasan) karena itu yang membuat mereka kembali.', 'sec-retensi');
    }

    // 4. Pelanggan repeat yang mulai jarang
    const risk = v.winback.risk;
    if (risk.length) {
        const val = risk.reduce((s, c) => s + c.total / c.orders.length, 0);
        const withWa = risk.filter(c => c.phone).length;
        add('warn', 'fa-bullhorn', `${num(risk.length)} pelanggan repeat mulai jarang order`,
            `Mereka sudah melewati jeda order biasanya. Kalau semuanya order 1x lagi, nilainya ± ${rupiah(val)}. ${num(withWa)} di antaranya punya no. WA.`,
            'Hubungi yang belanjanya paling besar lebih dulu lewat tombol WA di daftar Perlu Follow-up, sebutkan menu favorit mereka.', 'sec-followup');
    }

    // 5. Menu naik & turun
    if (v.prev && v.prev.tx > 0) {
        const rising = v.menu.filter(m => m.delta > 0 && m.qty >= 5).sort((a, b) => b.delta - a.delta)[0];
        const falling = [...v.menu.filter(m => m.delta < 0 && m.prevQty >= 5), ...v.menuGone].sort((a, b) => a.delta - b.delta)[0];
        if (rising) add('good', 'fa-fire', `Naik daun: ${esc(rising.name)}`,
            `Terjual ${num(rising.qty)} porsi, ${rising.prevQty ? `+${num(rising.delta)} (${fp(pctDelta(rising.qty, rising.prevQty))})` : 'sebelumnya belum terjual'} dibanding periode sebelumnya.`,
            'Pastikan stok bahannya aman dan tonjolkan di foto utama menu online.', 'sec-menu');
        if (falling) add('bad', 'fa-arrow-down', `Penjualan turun: ${esc(falling.name)}`,
            `Terjual ${num(falling.qty)} porsi, turun ${num(-falling.delta)} dari ${num(falling.prevQty)} (${fp(pctDelta(falling.qty, falling.prevQty))}).`,
            'Cek apakah ada masalah stok, rasa, atau menu tidak tampil di aplikasi. Bisa dicoba promo singkat.', 'sec-menu');
    }

    // 6. Harga & perampingan menu
    const andalan = v.menu.filter(m => m.cls === 'andalan').sort((a, b) => b.qty - a.qty)[0];
    if (andalan) add('info', 'fa-tags', `${esc(andalan.name)} laris tapi harganya di bawah rata-rata`,
        `Terjual ${num(andalan.qty)} porsi, harga rata-rata ${rupiah(andalan.avgPrice)} (rata-rata semua menu ${rupiah(v.avgPrice)}).`,
        'Kandidat naik harga kecil (Rp 1–2 rb) atau dijadikan paket dengan menu bermargin lebih tinggi.', 'sec-menu');
    const evals = v.menu.filter(m => m.cls === 'evaluasi').sort((a, b) => a.qty - b.qty);
    if (evals.length >= 2) add('info', 'fa-scissors', `${evals.length} menu jarang dipesan dan harganya rendah`,
        `Contoh: ${esc(evals.slice(0, 3).map(m => m.name).join(', '))}.`,
        'Pertimbangkan merampingkan menu supaya stok bahan dan kerja dapur lebih efisien.', 'sec-menu');

    // 7. Kandidat paket
    const topPair = [...v.pairs.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topPair && topPair[1] >= 3) add('info', 'fa-link', `Kandidat paket: ${esc(topPair[0])}`,
        `Dipesan bersamaan ${num(topPair[1])} kali (${pct(topPair[1], nTx)}% transaksi).`,
        'Jadikan paket hemat dengan harga sedikit di bawah total keduanya untuk menaikkan rata-rata belanja.', 'sec-menu');

    // 8. Jam & hari ramai
    if (v.time) add('info', 'fa-clock', `Jam tersibuk: ${v.time.label}`, v.time.text,
        'Siapkan bahan dan tambah staf 30 menit sebelum jam ramai. Pakai jam paling sepi untuk promo happy hour atau persiapan.', 'sec-waktu');

    // 9. Ketergantungan aplikasi online
    if (v.chSel === 'all') {
        const online = v.chStats.filter(s => s.key !== 'offline' && s.rev > 0);
        const onlineRev = online.reduce((s, x) => s + x.rev, 0);
        const share = pct(onlineRev, v.revenue);
        if (share >= 15) {
            const fee = online.reduce((s, x) => s + (x.rev - x.net), 0);
            add('info', 'fa-motorcycle', `${share}% omzet datang dari aplikasi online`,
                `${online.map(s => `${CHANNELS[s.key].label} ${pct(s.rev, v.revenue)}%`).join(', ')}. Perkiraan potongan komisi ± ${rupiah(fee)} (persentase bisa diatur di Pengaturan).`,
                'Ajak pelanggan online yang sering order untuk order langsung (mis. kartu promo di kemasan) supaya hemat komisi.', 'sec-channel');
        }
    }

    // 10. Data pelanggan tidak lengkap
    if (nTx >= 10 && pct(v.anonCount, nTx) >= 30) add('warn', 'fa-user-secret', `${pct(v.anonCount, nTx)}% transaksi tanpa nama/no. WA`,
        `${num(v.anonCount)} transaksi tidak bisa dihubungkan ke pelanggan, jadi angka repeat bisa lebih rendah dari kenyataan.`,
        'Biasakan kasir mengisi nama dan no. WA. Data ini yang membuat follow-up dan promo tepat sasaran.', 'sec-retensi');

    // 11. Konsentrasi pelanggan
    if (v.topShare) add('info', 'fa-crown', `20% pelanggan teratas menyumbang ${v.topShare.pct}% omzet`,
        `${num(v.topShare.n)} pelanggan dengan belanja terbesar di periode ini (dihitung dari omzet pelanggan yang dikenali).`,
        'Jaga mereka dengan sapaan personal dan benefit khusus; kehilangan satu dari mereka berdampak besar.', 'sec-pelanggan');

    const rank = { bad: 0, warn: 1, good: 2, info: 3 };
    return out.map((x, i) => ({ ...x, i })).sort((a, b) => rank[a.tone] - rank[b.tone] || a.i - b.i);
}

/* ================= RENDER ================= */
function renderFilterSummary() {
    const v = view;
    const chLabel = v.chSel === 'all' ? 'Semua channel' : CHANNELS[v.chSel].label;
    const pill = (icon, text) => `<span class="shrink-0 inline-flex items-center gap-1.5 bg-white border border-slate-200 rounded-full px-3 py-1 text-[11px] text-slate-600 whitespace-nowrap"><i class="fa-solid ${icon} text-orange-500"></i>${esc(text)}</span>`;
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
    return `<span class="text-[10px] font-semibold px-1.5 py-0.5 rounded-md whitespace-nowrap ${up ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}" title="Dibanding periode sebelumnya"><i class="fa-solid ${up ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'}"></i> ${up ? '+' : ''}${d}%</span>`;
}

function renderHero() {
    const v = view;
    const nTx = v.orders.length;
    const aov = nTx ? v.revenue / nTx : 0;
    const prevAov = v.prev ? v.prev.aov : null;
    const hasFee = v.netRevenue < v.revenue - 1;
    const cards = [
        { t: 'Transaksi', val: num(nTx), sub: `${num(v.active.length)} pelanggan dikenali`, icon: 'fa-receipt', grad: 'from-orange-500 to-amber-500', d: deltaChip(nTx, v.prev?.tx) },
        { t: 'Menu Terjual', val: num(v.totalItems), sub: `${v.menu.length} jenis · ${nTx ? dec(v.totalItems / nTx) : '0'} item/transaksi`, icon: 'fa-utensils', grad: 'from-rose-500 to-orange-500', d: deltaChip(v.totalItems, v.prev?.items) },
        { t: 'Omzet', val: rupiah(v.revenue), sub: hasFee ? `Bersih ± ${rupiahShort(v.netRevenue)} setelah komisi` : `${pct(v.revRepeat, v.revenue)}% dari pelanggan repeat`, icon: 'fa-sack-dollar', grad: 'from-emerald-500 to-teal-500', d: deltaChip(v.revenue, v.prev?.rev) },
        { t: 'Rata-rata / Transaksi', val: rupiah(aov), sub: 'nilai keranjang (AOV)', icon: 'fa-basket-shopping', grad: 'from-indigo-500 to-violet-500', d: deltaChip(aov, prevAov) }
    ];
    $('heroCards').innerHTML = cards.map(c => `
        <div class="relative overflow-hidden rounded-2xl p-3.5 sm:p-4 text-white bg-gradient-to-br ${c.grad} shadow-sm">
            <i class="fa-solid ${c.icon} absolute -right-2 -bottom-3 text-5xl sm:text-6xl opacity-15" aria-hidden="true"></i>
            <div class="text-[11px] font-medium opacity-90">${c.t}</div>
            <div class="hero-val font-bold mt-1 leading-tight">${c.val}</div>
            <div class="text-[11px] opacity-90 mt-1 leading-snug">${esc(c.sub)}</div>
            <div class="mt-2 min-h-[20px] flex items-center gap-1.5">${c.d ? `<span class="bg-white rounded-md leading-none">${c.d}</span><span class="hidden sm:inline text-[10px] opacity-90">vs periode sebelumnya</span>` : ''}</div>
        </div>`).join('');
}

/* Target & proyeksi bulan berjalan (semua channel, tidak terpengaruh filter) */
function renderTarget() {
    const el = $('targetCard');
    const today = todayJK();
    const mStart = today.slice(0, 7) + '-01';
    const [y, m] = today.split('-').map(Number);
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const dayNo = Number(today.slice(8));
    const inM = allOrders.filter(o => o._jk.date >= mStart && o._jk.date <= today);
    const rev = sumRev(inM);
    const revBefore = sumRev(inM.filter(o => o._jk.date < today));
    const lmEnd = addDays(mStart, -1);
    const lmStart = lmEnd.slice(0, 8) + '01';
    const lmCut = lmEnd.slice(0, 8) + String(Math.min(dayNo, Number(lmEnd.slice(8)))).padStart(2, '0');
    const lmRev = sumRev(allOrders.filter(o => o._jk.date >= lmStart && o._jk.date <= lmCut));
    const lmFull = sumRev(allOrders.filter(o => o._jk.date >= lmStart && o._jk.date <= lmEnd));
    const avgDay = dayNo > 1 ? revBefore / (dayNo - 1) : 0;
    const proj = dayNo > 1 ? Math.max(rev + avgDay * (dim - dayNo), revBefore + avgDay * (dim - dayNo + 1)) : null;
    const remain = dim - dayNo + 1;
    const target = settings.target;
    const monthLabel = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

    const stat = (label, val, sub = '') => `<div class="min-w-0"><div class="text-[10px] text-slate-400">${label}</div><div class="text-sm font-bold text-slate-800 truncate">${val}</div>${sub ? `<div class="text-[10px] text-slate-400 truncate">${sub}</div>` : ''}</div>`;

    let targetHtml;
    if (target > 0) {
        const p = pct(rev, target);
        const pp = proj != null ? pct(proj, target) : null;
        const need = Math.max(0, target - rev) / remain;
        let msg, tone;
        if (rev >= target) { msg = 'Target bulan ini sudah tercapai.'; tone = 'text-emerald-600'; }
        else if (pp != null && pp >= 100) { msg = `Sesuai jalur. Butuh rata-rata ${rupiah(need)}/hari selama ${remain} hari tersisa.`; tone = 'text-emerald-600'; }
        else { msg = `Di bawah jalur. Butuh ${rupiah(need)}/hari selama ${remain} hari tersisa${avgDay ? ` (rata-rata sekarang ${rupiah(avgDay)}/hari)` : ''}.`; tone = 'text-rose-600'; }
        targetHtml = `
            <div class="flex items-center justify-between text-[11px] mb-1">
                <span class="text-slate-500">Target ${rupiah(target)}</span>
                <span class="font-semibold text-slate-700">${p}%${pp != null ? ` <span class="font-normal text-slate-400">· proyeksi ${pp}%</span>` : ''}</span>
            </div>
            <div class="relative h-2.5 bg-slate-100 rounded-full overflow-hidden">
                ${pp != null ? `<div class="absolute inset-y-0 left-0 bg-orange-200 rounded-full" style="width:${Math.min(100, pp)}%"></div>` : ''}
                <div class="absolute inset-y-0 left-0 bg-orange-500 rounded-full" style="width:${Math.min(100, p)}%"></div>
            </div>
            <p class="text-[11px] mt-1.5 ${tone}">${msg}</p>`;
    } else {
        targetHtml = `<button onclick="openSettings()" class="w-full sm:w-auto px-3 py-2 rounded-lg border border-dashed border-orange-300 text-orange-600 text-xs font-semibold hover:bg-orange-50"><i class="fa-solid fa-bullseye mr-1"></i> Atur target omzet bulanan</button>
            <p class="text-[10px] text-slate-400 mt-1">Supaya terlihat butuh berapa omzet per hari untuk mencapainya.</p>`;
    }

    el.innerHTML = `
        <div class="bg-white border border-slate-200 rounded-2xl shadow-sm p-4">
            <div class="flex items-start justify-between gap-2 mb-3">
                <div>
                    <h3 class="text-sm font-semibold text-slate-700"><i class="fa-solid fa-bullseye text-orange-500 mr-1"></i> Bulan ini · ${esc(monthLabel)}</h3>
                    <p class="text-[10px] text-slate-400">Semua channel, tidak terpengaruh filter. Hari ke-${dayNo} dari ${dim}.</p>
                </div>
                ${target > 0 ? '<button onclick="openSettings()" class="text-[11px] text-slate-400 hover:text-orange-600 shrink-0" aria-label="Ubah target"><i class="fa-solid fa-pen"></i></button>' : ''}
            </div>
            <div class="grid grid-cols-1 md:grid-cols-5 gap-4 items-center">
                <div class="md:col-span-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    ${stat('Omzet sejauh ini', rupiah(rev), lmRev ? `${fp(pctDelta(rev, lmRev))} vs bln lalu tgl sama` : '')}
                    ${stat('Proyeksi akhir bulan', proj != null ? rupiah(proj) : '-', proj != null && lmFull ? `${fp(pctDelta(proj, lmFull))} vs bulan lalu` : 'butuh data ≥ 1 hari')}
                    ${stat('Rata-rata per hari', avgDay ? rupiah(avgDay) : '-', 'hari yang sudah lewat')}
                    ${stat('Bulan lalu (penuh)', rupiah(lmFull))}
                </div>
                <div class="md:col-span-2">${targetHtml}</div>
            </div>
        </div>`;
}

const TONE = {
    bad:  ['border-rose-200 bg-rose-50/60', 'text-rose-600'],
    warn: ['border-amber-200 bg-amber-50/60', 'text-amber-600'],
    good: ['border-emerald-200 bg-emerald-50/60', 'text-emerald-600'],
    info: ['border-slate-200 bg-slate-50', 'text-indigo-600']
};

function renderInsights() {
    const list = view.insights;
    const limit = isSmall() ? 4 : 6;
    const shown = insightAll ? list : list.slice(0, limit);
    $('insightList').innerHTML = shown.length ? shown.map(x => `
        <div class="rounded-xl border p-3 ${TONE[x.tone][0]}">
            <div class="flex gap-2.5">
                <div class="w-8 h-8 rounded-lg bg-white flex items-center justify-center shrink-0 ${TONE[x.tone][1]}"><i class="fa-solid ${x.icon}"></i></div>
                <div class="min-w-0 flex-1">
                    <div class="text-[13px] font-semibold text-slate-800 leading-snug">${x.title}</div>
                    <p class="text-xs text-slate-600 mt-0.5">${x.text}</p>
                    ${x.action ? `<p class="text-xs mt-1.5 text-slate-700"><i class="fa-solid fa-lightbulb text-amber-500 mr-1"></i><b>Saran:</b> ${x.action}</p>` : ''}
                    ${x.link ? `<a href="#${x.link}" class="inline-block mt-1.5 text-[11px] font-semibold text-orange-600 hover:underline">Lihat detail <i class="fa-solid fa-arrow-right text-[9px]"></i></a>` : ''}
                </div>
            </div>
        </div>`).join('')
        : `<div class="text-xs text-slate-400 py-4">Belum cukup data di periode ini untuk membuat insight.</div>`;
    const btn = $('insightToggle');
    btn.classList.toggle('hidden', list.length <= limit);
    btn.textContent = insightAll ? 'Tampilkan lebih sedikit' : `Tampilkan semua insight (${list.length})`;
}

function renderKPI() {
    const v = view;
    const nOrders = v.orders.length;
    const nCust = v.active.length;
    const identifiedOrders = nOrders - v.anonCount;
    const rr = pct(v.repCust.length, nCust);
    const ret = pct(v.returned.length, v.acquired.length);
    const cards = [
        { t: 'Pelanggan Aktif', val: num(nCust), sub: 'unik di periode ini', icon: 'fa-users', cls: 'bg-slate-100 text-slate-600' },
        { t: 'Pelanggan Baru', val: num(v.acquired.length), sub: 'pertama kali order di periode ini', icon: 'fa-user-plus', cls: 'bg-sky-50 text-sky-600' },
        { t: 'Repeat Rate', val: rr + '%', valCls: nCust ? (rr >= REPEAT_TARGET ? 'text-emerald-600' : 'text-rose-600') : '', sub: `${num(v.repCust.length)} pelanggan · target > ${REPEAT_TARGET}%`, icon: 'fa-repeat', cls: 'bg-orange-50 text-orange-600' },
        { t: 'Pelanggan Baru Kembali', val: v.acquired.length ? ret + '%' : '-', sub: `${num(v.returned.length)} dari ${num(v.acquired.length)} sudah order lagi`, icon: 'fa-rotate-left', cls: 'bg-emerald-50 text-emerald-600' },
        { t: 'Order / Pelanggan', val: nCust ? dec(identifiedOrders / nCust, 2) : '0', sub: 'frekuensi beli di periode', icon: 'fa-arrows-rotate', cls: 'bg-rose-50 text-rose-600' },
        { t: 'Omzet dari Repeat', val: pct(v.revRepeat, v.revenue) + '%', sub: `${num(v.ordersRepeat)} order dari pelanggan repeat`, icon: 'fa-clipboard-check', cls: 'bg-purple-50 text-purple-600' },
        { t: 'Tanpa Identitas', val: num(v.anonCount), sub: `${pct(v.anonCount, nOrders)}% order tanpa nama/WA`, icon: 'fa-user-secret', cls: 'bg-slate-100 text-slate-500' },
        { t: 'Perlu Follow-up', val: num(v.winback.risk.length), sub: `mulai jarang · ${num(v.winback.lost.length)} hilang`, icon: 'fa-bullhorn', cls: 'bg-amber-50 text-amber-600', href: '#sec-followup' }
    ];
    $('kpiCards').innerHTML = cards.map(c => {
        const tag = c.href ? 'a' : 'div';
        return `
        <${tag} ${c.href ? `href="${c.href}"` : ''} class="bg-white rounded-xl p-3 sm:p-4 border border-slate-200 flex items-start justify-between gap-2 ${c.href ? 'hover:border-orange-300 transition' : ''}">
            <div class="min-w-0">
                <div class="text-[11px] font-medium text-slate-500 leading-tight">${c.t}</div>
                <div class="text-lg font-bold mt-1 truncate ${c.valCls || 'text-slate-800'}">${c.val}</div>
                <div class="text-[11px] text-slate-400 mt-0.5 leading-snug">${c.sub}</div>
            </div>
            <div class="hidden sm:flex w-10 h-10 rounded-xl items-center justify-center shrink-0 ${c.cls}"><i class="fa-solid ${c.icon}"></i></div>
        </${tag}>`;
    }).join('');
}

function makeChart(id, config) {
    if (charts[id]) charts[id].destroy();
    const el = $(id);
    if (!el || typeof Chart === 'undefined') return;
    charts[id] = new Chart(el, config);
}
if (typeof Chart !== 'undefined') {
    Chart.defaults.font.family = 'Poppins, sans-serif';
    Chart.defaults.font.size = 11;
}
const legendBottom = { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, padding: 10 } };

function renderTrend() {
    const r = view.range;
    const today = todayJK();
    const isRev = trendMetric === 'revenue';
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
        const val = isRev ? Number(o.grand_total || 0) : 1;
        if (!o._cid) row.anon += val;
        else if (isRepOrder(o)) row.repeat += val;
        else row.baru += val;
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
    const label = k => {
        if (byMonth) { const [y, m] = k.split('-').map(Number); return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('id-ID', { month: 'short', year: '2-digit' }); }
        return k.slice(8) + '/' + k.slice(5, 7);
    };
    const yTicks = { precision: 0, maxTicksLimit: 6 };
    if (isRev) yTicks.callback = val => rupiahShort(val).replace('Rp ', '');
    makeChart('trendChart', {
        type: 'bar',
        data: {
            labels: keys.map(label),
            datasets: [
                { label: 'Pelanggan Baru', data: keys.map(k => get(k).baru), backgroundColor: '#38bdf8', borderRadius: 2 },
                { label: 'Pelanggan Repeat', data: keys.map(k => get(k).repeat), backgroundColor: '#10b981', borderRadius: 2 },
                { label: 'Tanpa Identitas', data: keys.map(k => get(k).anon), backgroundColor: '#cbd5e1', borderRadius: 2 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            scales: {
                x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: isSmall() ? 6 : 15 } },
                y: { stacked: true, beginAtZero: true, ticks: yTicks }
            },
            plugins: {
                legend: legendBottom,
                tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${isRev ? rupiah(ctx.parsed.y) : num(ctx.parsed.y) + ' order'}` } }
            }
        }
    });
    document.querySelectorAll('#trendToggle button').forEach(b => b.classList.toggle('active', b.dataset.metric === trendMetric));
}

function renderSplit() {
    const loyal = view.active.filter(c => c.orders.length >= 4).length;
    const rep = view.repCust.length - loyal;
    makeChart('splitChart', {
        type: 'doughnut',
        data: { labels: ['Baru (1x)', 'Repeat (2–3x)', 'Loyal (≥4x)'], datasets: [{ data: [view.newCust.length, rep, loyal], backgroundColor: ['#38bdf8', '#f59e0b', '#10b981'], borderWidth: 2 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: legendBottom }, cutout: '60%' }
    });
}

function sortedMenu() {
    const sortKey = $('menuSort').value;
    return [...view.menu].sort((a, b) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0) || b.qty - a.qty);
}

function deltaQty(m) {
    if (m.delta == null) return '<span class="text-slate-300">-</span>';
    if (!m.prevQty) return m.qty ? '<span class="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-sky-50 text-sky-600">baru</span>' : '-';
    if (m.delta === 0) return '<span class="text-slate-400">tetap</span>';
    const up = m.delta > 0;
    return `<span class="font-semibold whitespace-nowrap ${up ? 'text-emerald-600' : 'text-rose-600'}"><i class="fa-solid ${up ? 'fa-caret-up' : 'fa-caret-down'}"></i> ${up ? '+' : ''}${num(m.delta)} <span class="font-normal opacity-70">(${fp(pctDelta(m.qty, m.prevQty))})</span></span>`;
}

function renderMenu() {
    const sortKey = $('menuSort').value;
    const all = sortedMenu();
    const list = menuAll ? all : all.slice(0, 10);
    const max = Math.max(1, ...list.map(m => Math.abs(m[sortKey] ?? 0)));
    const body = $('menuBody');
    const btn = $('menuToggle');
    btn.classList.toggle('hidden', all.length <= 10);
    btn.textContent = menuAll ? 'Tampilkan 10 teratas' : `Tampilkan semua (${all.length} menu)`;
    if (!list.length) { body.innerHTML = `<tr><td colspan="6" class="cell-full text-center py-10 text-slate-400">Belum ada penjualan menu di periode ini.</td></tr>`; return; }
    body.innerHTML = list.map((m, i) => `
        <tr class="hover:bg-slate-50/80">
            <td class="p-3 cell-full">
                <div class="flex items-center gap-2">
                    <span class="w-5 text-right text-slate-400 shrink-0">${i + 1}</span>
                    <span class="font-semibold text-slate-800">${esc(m.name)}</span> ${menuBadge(m.cls)}
                </div>
                <div class="h-1.5 bg-slate-100 rounded-full mt-1.5 ml-7 max-w-[10rem]"><div class="h-1.5 bg-orange-400 rounded-full" style="width:${Math.round((Math.abs(m[sortKey] ?? 0) / max) * 100)}%"></div></div>
            </td>
            <td class="p-3 font-bold text-slate-700" data-label="Terjual">${num(m.qty)}x <span class="font-normal text-slate-400">(${pct(m.qty, view.totalItems)}%)</span></td>
            <td class="p-3" data-label="vs sebelumnya">${deltaQty(m)}</td>
            <td class="p-3 text-emerald-600 font-semibold" data-label="Omzet">${rupiah(m.revenue)}</td>
            <td class="p-3 text-slate-600" data-label="Di order">${num(m.orders)} <span class="text-slate-400">(${pct(m.orders, view.orders.length)}%)</span></td>
            <td class="p-3 text-slate-600" data-label="% Repeat">${pct(m.repQty, m.qty)}%</td>
        </tr>`).join('');
}

function renderPairs() {
    const top = [...view.pairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const n = view.orders.length;
    $('pairsList').innerHTML = top.length
        ? top.map(([k, c], i) => `
            <div class="flex items-start justify-between gap-2 p-2 rounded-lg bg-slate-50">
                <span class="text-slate-700 min-w-0"><b class="text-orange-500">${i + 1}.</b> ${esc(k)}</span>
                <span class="shrink-0 font-semibold text-slate-600 text-right">${c}x<span class="block font-normal text-[10px] text-slate-400">${pct(c, n)}% trx</span></span>
            </div>`).join('')
        : `<div class="text-slate-400">Belum ada order dengan ≥ 2 jenis menu.</div>`;
}

function renderHeatmap() {
    const v = view, el = $('heatmap'), t = v.time;
    if (!t) {
        el.innerHTML = '<div class="text-xs text-slate-400 py-6">Belum ada data.</div>';
        $('timeInsight').textContent = 'Belum ada data.';
        return;
    }
    const cols = [];
    for (let h = t.h0; h <= t.h1; h++) cols.push(h);
    const max = Math.max(1, ...DAY_ORDER.flatMap(d => cols.map(h => v.heat[d][h])));
    const maxH = Math.max(...cols.map(h => v.hours[h]));
    const cell = (n, d, h) => {
        const r = n / max;
        const bg = n ? `rgba(249,115,22,${(0.12 + 0.88 * r).toFixed(2)})` : '#f8fafc';
        const fg = n ? (r > 0.5 ? '#fff' : '#9a3412') : '#cbd5e1';
        return `<td class="hm-cell" style="background:${bg};color:${fg}" title="${DAY_NAMES[d]} ${hh(h)}: ${n} order">${n || ''}</td>`;
    };
    const head = `<tr><th class="hm-day"></th>${cols.map(h => `<th class="hm-h">${String(h).padStart(2, '0')}</th>`).join('')}<th class="hm-h">Total</th></tr>`;
    const rows = DAY_ORDER.map(d => `<tr><th class="hm-day ${d === t.busyDay ? 'text-indigo-600' : ''}">${DAY_NAMES[d].slice(0, 3)}</th>${cols.map(h => cell(v.heat[d][h], d, h)).join('')}<td class="hm-tot">${num(v.days[d])}</td></tr>`).join('');
    const foot = `<tr><th class="hm-day">Total</th>${cols.map(h => `<td class="hm-tot ${v.hours[h] === maxH ? 'text-orange-600' : ''}">${v.hours[h]}</td>`).join('')}<td class="hm-tot text-slate-800">${num(v.orders.length)}</td></tr>`;
    el.innerHTML = `<table class="hm">${head}${rows}${foot}</table>`;
    $('timeInsight').innerHTML = `Paling ramai <b>${DAY_NAMES[t.slot.d]} pukul ${hh(t.slot.h)}</b>. Jam teramai secara umum ${t.label} (${pct(v.hours[t.peakH], v.orders.length)}% order), paling sepi ${hh(t.quietH)}.` +
        (DAY_ORDER.filter(d => v.occ[d]).length > 1 ? ` Hari teramai <b>${DAY_NAMES[t.busyDay]}</b> (± ${dec(t.avg(t.busyDay))} order/hari), tersepi ${DAY_NAMES[t.quietDay]} (± ${dec(t.avg(t.quietDay))}).` : '');
}

function renderPay() {
    const rows = [...view.pay.entries()].sort((a, b) => b[1].n - a[1].n);
    const total = view.orders.length || 1;
    $('payList').innerHTML = rows.length
        ? rows.map(([k, v]) => `
            <div>
                <div class="flex justify-between gap-2"><span class="font-semibold text-slate-700 truncate">${esc(k)} <span class="font-normal text-slate-400">${pct(v.n, total)}%</span></span><span class="text-slate-500 text-right shrink-0">${num(v.n)} order · ${rupiahShort(v.total)}</span></div>
                <div class="h-1.5 bg-slate-100 rounded-full mt-1"><div class="h-1.5 bg-emerald-400 rounded-full" style="width:${pct(v.n, total)}%"></div></div>
            </div>`).join('')
        : `<div class="text-slate-400">Belum ada data.</div>`;
}

function renderChannel() {
    $('channelBody').innerHTML = view.chStats.map(s => `
        <tr class="hover:bg-slate-50/80 ${view.chSel === s.key ? 'bg-orange-50/50' : ''}">
            <td class="p-3 cell-full">
                <div class="flex items-center justify-between gap-2">${chBadge(s.key)} <span class="md:hidden text-[11px] font-semibold text-slate-600">${s.share}% omzet</span></div>
                <div class="md:hidden h-1.5 bg-slate-100 rounded-full mt-2"><div class="h-1.5 rounded-full" style="width:${s.share}%;background:${CHANNELS[s.key].bar}"></div></div>
            </td>
            <td class="p-3 font-semibold" data-label="Transaksi">${num(s.orders)}</td>
            <td class="p-3 font-semibold" data-label="Menu terjual">${num(s.items)}</td>
            <td class="p-3 text-emerald-600 font-semibold" data-label="Omzet">${rupiah(s.rev)}</td>
            <td class="p-3 cell-hide-sm" data-label="Porsi omzet">
                <div class="flex items-center gap-2"><div class="h-1.5 w-16 bg-slate-100 rounded-full"><div class="h-1.5 rounded-full" style="width:${s.share}%;background:${CHANNELS[s.key].bar}"></div></div><span class="text-slate-600">${s.share}%</span></div>
            </td>
            <td class="p-3 text-slate-700" data-label="Bersih (est.)">${rupiah(s.net)}${feeOf(s.key) ? `<div class="text-[10px] text-slate-400">komisi ${Math.round(feeOf(s.key) * 100)}%</div>` : ''}</td>
            <td class="p-3 text-slate-600" data-label="Rata-rata/order">${rupiah(s.aov)}</td>
            <td class="p-3" data-label="Pelanggan">${num(s.cust)}</td>
            <td class="p-3" data-label="Repeat">${num(s.rep)} <span class="text-slate-400">(${pct(s.rep, s.cust)}%)</span></td>
            <td class="p-3 text-slate-500" data-label="Tanpa identitas">${num(s.anon)}</td>
        </tr>`).join('');
}

const waLink = (phone, text) => (phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : '');
function waMessage(c) {
    const fav = favItem(c);
    return `Halo kak ${c.name}, kangen nih! Sudah ${c.daysSince} hari kakak belum mampir ke ChimChum.${fav ? ` ${fav} favorit kakak lagi nunggu nih.` : ''} Ada promo spesial buat kakak, yuk order lagi! 😊`;
}

function renderWinback() {
    const lists = view.winback;
    const full = lists[winTab];
    const list = winAll ? full : full.slice(0, 15);
    $('winbackCount').textContent = num(lists.risk.length);
    document.querySelectorAll('#winTabs button').forEach(b => {
        const on = b.dataset.tab === winTab;
        b.classList.toggle('active', on);
        b.querySelector('.cnt').textContent = num(lists[b.dataset.tab].length);
    });
    const body = $('winbackBody');
    if (!list.length) {
        body.innerHTML = `<tr><td colspan="7" class="cell-full text-center py-10 text-slate-400">${winTab === 'risk' ? 'Tidak ada pelanggan repeat yang mulai jarang order. Mantap!' : 'Tidak ada pelanggan repeat yang hilang lebih dari 90 hari.'}</td></tr>`;
        return;
    }
    body.innerHTML = list.map(c => {
        const link = waLink(c.phone, waMessage(c));
        return `
        <tr class="hover:bg-slate-50/80">
            <td class="p-3 cell-full"><span class="font-semibold text-slate-800">${esc(c.name)}</span> ${chBadge(c.channel)}</td>
            <td class="p-3" data-label="Total order">${c.orders.length}x</td>
            <td class="p-3 text-emerald-600 font-semibold" data-label="Total belanja">${rupiah(c.total)}</td>
            <td class="p-3 text-slate-600" data-label="Terakhir">${fmtDate(c.last)} <div class="text-[10px] text-rose-500 font-semibold">${c.daysSince} hari lalu</div></td>
            <td class="p-3 text-slate-600 cell-hide-sm" data-label="Biasanya">tiap ± ${Math.max(1, Math.round(c.avgGap))} hari</td>
            <td class="p-3 text-slate-600 cell-full" data-label="Menu favorit">${topItemOf(c)}</td>
            <td class="p-3 cell-full">${link
                ? `<a href="${link}" target="_blank" rel="noopener noreferrer" class="flex md:inline-flex items-center justify-center gap-1.5 px-3 py-2 md:py-1.5 bg-emerald-500 md:bg-emerald-50 text-white md:text-emerald-700 hover:bg-emerald-600 md:hover:bg-emerald-100 rounded-lg font-semibold transition"><i class="fa-brands fa-whatsapp"></i> Kirim WA</a>`
                : '<span class="text-[10px] text-slate-400">Tidak ada no. WA (via aplikasi)</span>'}</td>
        </tr>`;
    }).join('') + (full.length > list.length
        ? `<tr><td colspan="7" class="cell-full p-3 text-center"><button onclick="showAllWinback()" class="px-3 py-1.5 rounded-lg bg-rose-50 text-rose-700 text-[11px] font-semibold hover:bg-rose-100">Tampilkan semua (${full.length} pelanggan)</button></td></tr>`
        : '');
}

const SEG_OPTS = [['all', 'Semua'], ['baru', 'Baru'], ['repeat', 'Repeat'], ['loyal', 'Loyal'], ['risk', 'Perlu dihubungi']];
const segMatch = (c, k) => (k === 'all' ? true : k === 'risk' ? c.status === 'berisiko' || c.status === 'hilang' : segmentOf(c.orders.length) === k);

function renderSegFilter() {
    $('segFilter').innerHTML = SEG_OPTS.map(([k, l]) => `
        <button onclick="setSegFilter('${k}')" class="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold border transition whitespace-nowrap ${segFilter === k ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}">${l} (${view.active.filter(c => segMatch(c, k)).length})</button>`).join('');
}

const SORT_VAL = {
    name:  (c) => c.name.toLowerCase(),
    channel: (c) => c.channel,
    seg:   (c) => c.orders.length,
    status: (c) => c.daysSince,
    orders: (c, s) => s.n,
    total: (c, s) => s.total,
    life:  (c) => c.total,
    first: (c) => new Date(c.first).getTime(),
    last:  (c) => new Date(c.last).getTime()
};

function filteredCustomers() {
    let list = view.active.map(c => ({ c, seg: segmentOf(c.orders.length), s: view.pstat.get(c.id) || { n: 0, total: 0 } }));
    if (segFilter !== 'all') list = list.filter(x => segMatch(x.c, segFilter));
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
        th.setAttribute('aria-sort', on ? (custSort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
        if (ind) ind.innerHTML = on ? `<i class="fa-solid ${custSort.dir === 'asc' ? 'fa-sort-up' : 'fa-sort-down'} ml-1"></i>` : '<i class="fa-solid fa-sort ml-1 opacity-30"></i>';
    });
    const sel = $('custSortSm');
    if (sel) {
        const val = `${custSort.key}:${custSort.dir}`;
        if ([...sel.options].some(o => o.value === val)) sel.value = val;
    }
}

function renderCustomers() {
    const list = filteredCustomers();
    const shown = list.slice(0, custLimit);
    renderSortIndicators();
    $('custBody').innerHTML = shown.length ? shown.map(({ c, seg, s }) => {
        const vars = otherVariants(c);
        return `
        <tr class="hover:bg-slate-50/80">
            <td class="p-3 cell-full">
                <div class="font-semibold text-slate-800">${esc(c.name)}</div>
                ${vars.length ? `<div class="font-normal text-[10px] text-amber-600" title="Nama-nama ini digabung otomatis">≈ ${esc(vars.join(', '))}</div>` : ''}
                <div class="flex flex-wrap items-center gap-1 mt-1 md:hidden">${chBadge(c.channel)} ${segBadge(seg)} ${statusBadge(c)} <span class="text-[10px] text-slate-400">${c.daysSince} hari lalu</span></div>
            </td>
            <td class="p-3 cell-hide-sm">${chBadge(c.channel)}</td>
            <td class="p-3 text-slate-600" data-label="WhatsApp">${c.phone ? `<a class="hover:underline text-emerald-600 break-all" target="_blank" rel="noopener noreferrer" href="https://wa.me/${c.phone}">${esc(c.phone)}</a>` : '<span class="text-slate-300">-</span>'}</td>
            <td class="p-3 cell-hide-sm">${segBadge(seg)}</td>
            <td class="p-3 cell-hide-sm">${statusBadge(c)}<div class="text-[10px] text-slate-400 mt-0.5">${c.daysSince} hari lalu</div></td>
            <td class="p-3 font-semibold" data-label="Order periode">${s.n}x <div class="font-normal text-[10px] text-slate-400">total ${c.orders.length}x</div></td>
            <td class="p-3 text-emerald-600 font-semibold" data-label="Belanja periode">${rupiah(s.total)} <div class="font-normal text-[10px] text-slate-400">rata-rata ${rupiahShort(s.n ? s.total / s.n : 0)}</div></td>
            <td class="p-3 text-slate-600" data-label="Semua waktu">${rupiah(c.total)}</td>
            <td class="p-3 text-slate-500" data-label="Pertama">${fmtDate(c.first)}</td>
            <td class="p-3 text-slate-500" data-label="Terakhir">${fmtDate(c.last)}</td>
            <td class="p-3 text-slate-600 cell-full md:max-w-xs" data-label="Menu favorit">${topItemOf(c)}</td>
        </tr>`;
    }).join('') : `<tr><td colspan="11" class="cell-full text-center py-10 text-slate-400">Tidak ada pelanggan yang cocok dengan filter ini.</td></tr>`;

    $('custFooter').innerHTML = `<span>Menampilkan ${shown.length} dari ${list.length} pelanggan.</span>` +
        (list.length > shown.length ? `<button onclick="moreCustomers()" class="ml-3 px-3 py-1.5 rounded-lg bg-orange-50 text-orange-700 font-semibold hover:bg-orange-100 transition">Tampilkan ${custPage()} lagi</button>` : '');
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
    const csv = '﻿' + rows.map(r => r.map(q).join(',')).join('\n');
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
    const rows = [['Nama', 'Variasi Nama', 'Channel', 'WhatsApp', 'Segmen', 'Status', 'Hari Sejak Order Terakhir', 'Order di Periode', 'Belanja di Periode', 'Total Order (Semua Waktu)', 'Total Belanja (Semua Waktu)', 'Order Pertama', 'Order Terakhir', 'Menu Favorit']];
    list.forEach(({ c, seg, s }) => {
        rows.push([c.name, otherVariants(c).join(', '), CHANNELS[c.channel].label, c.phone, SEG_STYLE[seg][0], STATUS_STYLE[c.status][0], c.daysSince, s.n, Math.round(s.total), c.orders.length, Math.round(c.total), fmtDate(c.first), fmtDate(c.last), topItemsText(c, 3)]);
    });
    downloadCSV(rows, 'pelanggan-chimchum');
};

window.exportWinbackCSV = function () {
    const list = view ? [...view.winback.risk, ...view.winback.lost] : [];
    if (!guardExport(list.length)) return;
    const rows = [['Nama', 'Channel', 'WhatsApp', 'Status', 'Total Order', 'Total Belanja', 'Order Terakhir', 'Hari Sejak Order Terakhir', 'Biasanya Order Tiap (hari)', 'Menu Favorit', 'Link WA']];
    list.forEach(c => rows.push([c.name, CHANNELS[c.channel].label, c.phone, STATUS_STYLE[c.status][0], c.orders.length, Math.round(c.total), fmtDate(c.last), c.daysSince, Math.round(c.avgGap), topItemsText(c, 3), waLink(c.phone, waMessage(c))]));
    downloadCSV(rows, 'follow-up-chimchum');
};

window.exportOrdersCSV = function () {
    if (!guardExport(view && view.orders.length)) return;
    const rows = [['Waktu (WIB)', 'No. Order', 'Pelanggan', 'WhatsApp', 'Channel', 'Metode Bayar', 'Status', 'Menu', 'Jumlah Item', 'Total', 'Estimasi Bersih']];
    view.orders.forEach(o => {
        const items = itemsOf(o);
        const c = custOf(o);
        rows.push([
            fmtDateTime(o.created_at), o.order_number || o.id || '', c ? c.name : (o.customer_name || ''), o._phone,
            CHANNELS[o._ch].label, o.payment_method || 'Cash', o.status || 'new',
            items.map(i => `${itemName(i)} x${itemQty(i)}`).join('; '),
            items.reduce((s, i) => s + itemQty(i), 0), Math.round(Number(o.grand_total || 0)),
            Math.round(Number(o.grand_total || 0) * (1 - feeOf(o._ch)))
        ]);
    });
    downloadCSV(rows, 'transaksi-chimchum');
};

window.exportMenuCSV = function () {
    if (!guardExport(view && view.menu.length)) return;
    const rows = [['Menu', 'Kategori', 'Jumlah Terjual', 'Periode Sebelumnya', 'Selisih', 'Omzet', 'Harga Rata-rata', 'Muncul di Order', '% dari Total Terjual', '% Repeat']];
    sortedMenu().forEach(m => rows.push([m.name, m.cls ? MENU_CLS[m.cls][0] : '', m.qty, m.prevQty ?? '', m.delta ?? '', Math.round(m.revenue), Math.round(m.avgPrice), m.orders, pct(m.qty, view.totalItems), pct(m.repQty, m.qty)]));
    downloadCSV(rows, 'menu-chimchum');
};

/* ================= CEK VERSI HTML =================
   analisa.js ini butuh analisa.html versi terbaru. Kalau HTML lama yang ter-load
   (belum diganti / masih tercache), tampilkan pesan yang jelas daripada error diam-diam. */
const REQUIRED_IDS = ['settingsForm', 'settingsDlg', 'targetCard', 'insightList', 'insightToggle', 'periodSelect', 'channelSelect',
    'heatmap', 'timeInsight', 'winTabs', 'custSortSm', 'secNav', 'trendToggle', 'appHeader'];
const missingIds = REQUIRED_IDS.filter(id => !$(id));
if (missingIds.length) {
    const msg = 'Halaman analisa.html belum versi terbaru (elemen tidak ditemukan: ' + missingIds.join(', ') + '). Ganti analisa.html dengan versi baru lalu muat ulang dengan Ctrl+Shift+R.';
    const box = document.createElement('div');
    box.setAttribute('role', 'alert');
    box.style.cssText = 'position:fixed;inset:auto 1rem 1rem 1rem;z-index:9999;background:#e11d48;color:#fff;padding:12px 16px;border-radius:12px;font:500 13px Poppins,sans-serif;box-shadow:0 10px 25px rgba(0,0,0,.2)';
    box.textContent = msg;
    document.body.appendChild(box);
    throw new Error(msg);
}
const on = (id, evt, fn) => { const el = $(id); if (el) el.addEventListener(evt, fn); else console.warn('[analisa] elemen #' + id + ' tidak ada'); };

/* ================= PENGATURAN ================= */
window.openSettings = function () {
    $('setTarget').value = settings.target ? num(settings.target) : '';
    $('setFeeShopee').value = settings.fee.shopeefood;
    $('setFeeGrab').value = settings.fee.grabfood;
    const dlg = $('settingsDlg');
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
};
window.closeSettings = () => { const d = $('settingsDlg'); d.close ? d.close() : d.removeAttribute('open'); };
on('settingsForm', 'submit', e => {
    e.preventDefault();
    const clampFee = v => Math.min(100, Math.max(0, Number(String(v).replace(',', '.')) || 0));
    settings = {
        target: Number(String($('setTarget').value).replace(/\D/g, '')) || 0,
        fee: { offline: 0, shopeefood: clampFee($('setFeeShopee').value), grabfood: clampFee($('setFeeGrab').value) }
    };
    saveSettings();
    closeSettings();
    allOrders.length ? analyze() : renderTarget();
    showToast('Pengaturan disimpan');
});
on('setTarget', 'input', e => {
    const d = e.target.value.replace(/\D/g, '');
    e.target.value = d ? Number(d).toLocaleString('id-ID') : '';
});

/* ================= EVENTS ================= */
window.setSegFilter = k => { segFilter = k; custLimit = custPage(); renderSegFilter(); renderCustomers(); };
window.moreCustomers = () => { custLimit += custPage(); renderCustomers(); };
window.showAllWinback = () => { winAll = true; renderWinback(); };
window.toggleExportMenu = force => {
    const m = $('exportMenu');
    if (typeof force === 'boolean') m.classList.toggle('hidden', !force);
    else m.classList.toggle('hidden');
};

function syncHeaderOffset() {
    const h = $('appHeader');
    if (h) document.documentElement.style.setProperty('--hdr', (h.offsetHeight + 8) + 'px');
}

function syncFilterUI() {
    document.querySelectorAll('#periodChips .chip').forEach(b => b.classList.toggle('active', b.dataset.period === period));
    document.querySelectorAll('#channelChips .chip').forEach(b => b.classList.toggle('active', b.dataset.channel === channelSel));
    $('periodSelect').value = period;
    $('channelSelect').value = channelSel;
    $('customRange').classList.toggle('hidden', period !== 'custom');
    syncHeaderOffset();
}

function setPeriod(p) {
    period = p;
    if (period === 'custom' && (!customStart || !customEnd)) {
        customEnd = todayJK();
        customStart = addDays(customEnd, -6);
        $('dateStart').value = customStart;
        $('dateEnd').value = customEnd;
    }
    syncFilterUI();
    allOrders.length && analyze();
}
function setChannel(ch) {
    channelSel = ch;
    syncFilterUI();
    allOrders.length && analyze();
}

on('periodChips', 'click', e => { const b = e.target.closest('.chip'); if (b) setPeriod(b.dataset.period); });
on('channelChips', 'click', e => { const b = e.target.closest('.chip'); if (b) setChannel(b.dataset.channel); });
on('periodSelect', 'change', e => setPeriod(e.target.value));
on('channelSelect', 'change', e => setChannel(e.target.value));

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
on('dateStart', 'change', onDateChange);
on('dateEnd', 'change', onDateChange);
if ($('dateStart') && $('dateEnd')) $('dateStart').max = $('dateEnd').max = todayJK();

on('menuSort', 'change', () => view && renderMenu());
on('menuToggle', 'click', () => { menuAll = !menuAll; view && renderMenu(); });
on('insightToggle', 'click', () => { insightAll = !insightAll; view && renderInsights(); });
on('trendToggle', 'click', e => {
    const b = e.target.closest('button[data-metric]');
    if (!b || !view) return;
    trendMetric = b.dataset.metric;
    renderTrend();
});
on('winTabs', 'click', e => {
    const b = e.target.closest('button[data-tab]');
    if (!b || !view) return;
    winTab = b.dataset.tab;
    winAll = false;
    renderWinback();
});

on('custSearch', 'input', e => {
    custQuery = (e.target.value || '').toLowerCase().trim();
    custLimit = custPage();
    $('custClear').classList.toggle('hidden', !custQuery);
    view && renderCustomers();
});
on('custClear', 'click', () => {
    $('custSearch').value = '';
    custQuery = '';
    custLimit = custPage();
    $('custClear').classList.add('hidden');
    view && renderCustomers();
});

on('custHead', 'click', e => {
    const th = e.target.closest('th[data-sort]');
    if (!th || !view) return;
    const k = th.dataset.sort;
    custSort = custSort.key === k
        ? { key: k, dir: custSort.dir === 'asc' ? 'desc' : 'asc' }
        : { key: k, dir: ['name', 'channel'].includes(k) ? 'asc' : 'desc' };
    renderCustomers();
});
on('custSortSm', 'change', e => {
    const [key, dir] = e.target.value.split(':');
    custSort = { key, dir };
    view && renderCustomers();
});

document.addEventListener('click', e => {
    if (!e.target.closest('#exportWrap')) $('exportMenu').classList.add('hidden');
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('exportMenu').classList.add('hidden'); });

/* Navigasi antar-bagian: tandai bagian yang sedang dilihat */
function setupSectionNav() {
    const nav = $('secNav');
    const links = [...nav.querySelectorAll('a')];
    const byId = new Map(links.map(a => [a.getAttribute('href').slice(1), a]));
    if (!('IntersectionObserver' in window)) return;
    const obs = new IntersectionObserver(entries => {
        entries.forEach(en => {
            if (!en.isIntersecting) return;
            const a = byId.get(en.target.id);
            if (!a) return;
            links.forEach(l => l.classList.toggle('active', l === a));
            nav.scrollTo({ left: a.offsetLeft - nav.clientWidth / 2 + a.clientWidth / 2, behavior: 'smooth' });
        });
    }, { rootMargin: '-40% 0px -55% 0px' });
    byId.forEach((_, id) => { const s = $(id); if (s) obs.observe(s); });
}

let resizeT;
window.addEventListener('resize', () => {
    syncHeaderOffset();
    clearTimeout(resizeT);
    resizeT = setTimeout(() => { if (view) { renderInsights(); renderTrend(); } }, 250);
});

syncFilterUI();
setupSectionNav();
loadAnalytics();
