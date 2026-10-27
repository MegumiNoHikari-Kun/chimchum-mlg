import { supabase, authReady } from '../supabase.js';

/* ================= STATE ================= */
let allOrders = [];        // semua order valid (non-cancel), sudah diberi _jk (tanggal/jam WIB) & _cid
let customers = new Map(); // semua pelanggan (seluruh riwayat)
let view = null;           // hasil analisa periode terpilih
let segFilter = 'all';
let custQuery = '';
const charts = {};

const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const WD_MAP = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const WINBACK_DAYS = 30;

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

// Identitas pelanggan: no. HP (dinormalisasi) -> kalau kosong pakai nama
function customerId(o) {
    const ph = normPhone(o.phone);
    if (ph.length >= 9) return 'p:' + ph;
    const nm = String(o.customer_name || '').trim().toLowerCase();
    return nm ? 'n:' + nm : 'anon:' + (o.id || o.order_id);
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

function topItemOf(c, n = 2) {
    return [...c.items.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, q]) => `${esc(k)} (${q}x)`).join(', ') || '-';
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
        .map(o => ({ ...o, _jk: jk(new Date(o.created_at)), _cid: customerId(o) }))
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    // Bangun profil pelanggan dari SELURUH riwayat
    customers = new Map();
    allOrders.forEach(o => {
        let c = customers.get(o._cid);
        if (!c) {
            c = { id: o._cid, name: o.customer_name || '-', phone: normPhone(o.phone), orders: [], total: 0, items: new Map(), first: o.created_at, last: o.created_at };
            customers.set(o._cid, c);
        }
        c.orders.push(o);
        c.total += Number(o.grand_total || 0);
        c.last = o.created_at;
        if (o.customer_name) c.name = o.customer_name; // pakai nama terbaru
        if (!c.phone) c.phone = normPhone(o.phone);
        (Array.isArray(o.items) ? o.items : []).forEach(i => {
            c.items.set(itemName(i), (c.items.get(itemName(i)) || 0) + itemQty(i));
        });
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

function analyze() {
    const start = periodStart();
    const orders = allOrders.filter(o => o._jk.date >= start);

    // Pelanggan aktif di periode
    const activeIds = new Set(orders.map(o => o._cid));
    const active = [...activeIds].map(id => customers.get(id));
    const isRepeat = c => c.orders.length >= 2;

    const newCust = active.filter(c => !isRepeat(c));
    const repCust = active.filter(isRepeat);

    const revenue = orders.reduce((s, o) => s + Number(o.grand_total || 0), 0);
    const revRepeat = orders.filter(o => isRepeat(customers.get(o._cid))).reduce((s, o) => s + Number(o.grand_total || 0), 0);
    const ordersRepeat = orders.filter(o => isRepeat(customers.get(o._cid))).length;

    // Statistik menu
    const menu = new Map();
    const pairs = new Map();
    const hours = Array(24).fill(0);
    const days = Array(7).fill(0);
    const pay = new Map();

    orders.forEach(o => {
        const rep = isRepeat(customers.get(o._cid));
        const its = Array.isArray(o.items) ? o.items : [];
        const names = new Set();
        its.forEach(i => {
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

    view = { start, orders, active, newCust, repCust, revenue, revRepeat, ordersRepeat, menu: [...menu.values()], pairs, hours, days, pay };

    renderKPI();
    renderTrend();
    renderSplit();
    renderMenu();
    renderPairs();
    renderTime();
    renderPay();
    renderWinback();
    renderSegFilter();
    renderCustomers();
}

/* ================= RENDER ================= */
function renderKPI() {
    const v = view;
    const nOrders = v.orders.length;
    const nCust = v.active.length;
    const cards = [
        { t: 'Pelanggan Aktif', val: nCust, sub: 'unik di periode ini', icon: 'fa-users', cls: 'bg-slate-100 text-slate-600' },
        { t: 'Pelanggan Baru', val: v.newCust.length, sub: `${pct(v.newCust.length, nCust)}% dari pelanggan`, icon: 'fa-user-plus', cls: 'bg-sky-50 text-sky-600' },
        { t: 'Pelanggan Repeat', val: v.repCust.length, sub: `${pct(v.repCust.length, nCust)}% dari pelanggan`, icon: 'fa-repeat', cls: 'bg-emerald-50 text-emerald-600' },
        { t: 'Repeat Rate', val: pct(v.repCust.length, nCust) + '%', sub: 'target sehat: > 25–30%', icon: 'fa-chart-line', cls: 'bg-orange-50 text-orange-600' },
        { t: 'Total Order', val: nOrders, sub: `${pct(v.ordersRepeat, nOrders)}% dari repeat`, icon: 'fa-receipt', cls: 'bg-purple-50 text-purple-600' },
        { t: 'Omzet', val: rupiah(v.revenue), sub: `${pct(v.revRepeat, v.revenue)}% dari repeat`, icon: 'fa-sack-dollar', cls: 'bg-amber-50 text-amber-600' },
        { t: 'Rata-rata / Order (AOV)', val: rupiah(nOrders ? v.revenue / nOrders : 0), sub: 'nilai keranjang', icon: 'fa-basket-shopping', cls: 'bg-indigo-50 text-indigo-600' },
        { t: 'Order / Pelanggan', val: nCust ? (nOrders / nCust).toFixed(2) : '0', sub: 'frekuensi beli', icon: 'fa-arrows-rotate', cls: 'bg-rose-50 text-rose-600' }
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
        const r = map.get(k) || { baru: 0, repeat: 0 };
        if (customers.get(o._cid).orders.length >= 2) r.repeat++; else r.baru++;
        map.set(k, r);
    });
    const keys = [...map.keys()].sort();
    makeChart('trendChart', {
        type: 'bar',
        data: {
            labels: keys.map(k => (byMonth ? k : k.slice(8) + '/' + k.slice(5, 7))),
            datasets: [
                { label: 'Pelanggan Baru', data: keys.map(k => map.get(k).baru), backgroundColor: '#38bdf8' },
                { label: 'Pelanggan Repeat', data: keys.map(k => map.get(k).repeat), backgroundColor: '#10b981' }
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

function waLink(phone, text) {
    return phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : '';
}

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
            <td class="p-3 font-semibold text-slate-800">${esc(c.name)}</td>
            <td class="p-3">${c.orders.length}x</td>
            <td class="p-3 text-emerald-600 font-semibold">${rupiah(c.total)}</td>
            <td class="p-3 text-slate-600">${fmtDate(c.last)} <span class="text-rose-500">(${days} hari lalu)</span></td>
            <td class="p-3 text-slate-600">${topItemOf(c)}</td>
            <td class="p-3">${link ? `<a href="${link}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 px-2.5 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg font-semibold transition"><i class="fa-brands fa-whatsapp"></i> WA</a>` : '<span class="text-slate-300">-</span>'}</td>
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
    if (custQuery) list = list.filter(({ c }) => c.name.toLowerCase().includes(custQuery) || c.phone.includes(custQuery.replace(/\D/g, '') || '\u0000'));
    return list.sort((a, b) => b.c.total - a.c.total);
}

function renderCustomers() {
    const list = filteredCustomers();
    const body = document.getElementById('custBody');
    const shown = list.slice(0, 100);
    body.innerHTML = shown.length ? shown.map(({ c, seg }) => `
        <tr class="hover:bg-slate-50/80">
            <td class="p-3 font-semibold text-slate-800">${esc(c.name)}</td>
            <td class="p-3 text-slate-600">${c.phone ? `<a class="hover:underline text-emerald-600" target="_blank" rel="noopener noreferrer" href="https://wa.me/${c.phone}">${esc(c.phone)}</a>` : '-'}</td>
            <td class="p-3">${segBadge(seg)}</td>
            <td class="p-3 font-semibold">${c.orders.length}x</td>
            <td class="p-3 text-emerald-600 font-semibold">${rupiah(c.total)}</td>
            <td class="p-3 text-slate-600">${rupiah(c.total / c.orders.length)}</td>
            <td class="p-3 text-slate-500">${fmtDate(c.first)}</td>
            <td class="p-3 text-slate-500">${fmtDate(c.last)}</td>
            <td class="p-3 text-slate-600 max-w-xs">${topItemOf(c)}</td>
        </tr>`).join('') : `<tr><td colspan="9" class="text-center py-8 text-slate-400">Tidak ada pelanggan ditemukan.</td></tr>`;
    document.getElementById('custFooter').textContent = `Menampilkan ${shown.length} dari ${list.length} pelanggan` + (list.length > 100 ? ' (gunakan pencarian atau Export CSV untuk data lengkap)' : '');
}

/* ================= EVENTS ================= */
window.setSegFilter = k => { segFilter = k; renderSegFilter(); renderCustomers(); };

window.exportCustomersCSV = function () {
    if (!view) return;
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['Nama', 'WhatsApp', 'Segmen', 'Jumlah Order', 'Total Belanja', 'Order Pertama', 'Order Terakhir', 'Menu Favorit']];
    [...customers.values()].sort((a, b) => b.total - a.total).forEach(c => {
        rows.push([c.name, c.phone, SEG_STYLE[segmentOf(c.orders.length)][0], c.orders.length, Math.round(c.total), fmtDate(c.first), fmtDate(c.last), topItemOf(c, 3).replace(/&amp;/g, '&')]);
    });
    const csv = '\uFEFF' + rows.map(r => r.map(q).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = `pelanggan-chimchum-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
};

document.getElementById('periodSelect').addEventListener('change', () => { if (allOrders) analyze(); });
document.getElementById('menuSort').addEventListener('change', () => view && renderMenu());
document.getElementById('custSearch').addEventListener('input', e => { custQuery = (e.target.value || '').toLowerCase().trim(); view && renderCustomers(); });

loadAnalytics();
