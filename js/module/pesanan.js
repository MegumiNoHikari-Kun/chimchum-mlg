import { supabase, authReady } from '../supabase.js';

let cachedOrders = [];
let currentFilter = 'all';
let searchQuery = '';
let currentPage = 1;
let rowsPerPage = 10;
let isLoading = false;

// Filter periode & sorting
let filterMonth = 'all'; // 'all' | 1..12
let filterYear = 'all';  // 'all' | 2026, dst
let sortKey = 'created_at';
let sortDir = 'desc';

const MONTH_NAMES = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const SORT_KEYS = ['created_at', 'customer_name', 'phone', 'payment_method', 'status', 'items', 'grand_total'];
const STATUS_RANK = { new: 0, disiapkan: 1, 'sedang diproses': 1, dikirim: 2, selesai: 3, cancel: 4 };

const STATUS_META = {
    new:       { label: 'Baru',      cls: 'bg-amber-50 text-amber-700 border-amber-200',       icon: 'fa-bell',         iconCls: 'bg-amber-100 text-amber-600' },
    disiapkan: { label: 'Disiapkan', cls: 'bg-blue-50 text-blue-700 border-blue-200',          icon: 'fa-fire-burner',  iconCls: 'bg-blue-100 text-blue-600' },
    dikirim:   { label: 'Dikirim',   cls: 'bg-purple-50 text-purple-700 border-purple-200',    icon: 'fa-motorcycle',   iconCls: 'bg-purple-100 text-purple-600' },
    selesai:   { label: 'Selesai',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: 'fa-circle-check', iconCls: 'bg-emerald-100 text-emerald-600' },
    cancel:    { label: 'Batal',     cls: 'bg-rose-50 text-rose-700 border-rose-200',          icon: 'fa-circle-xmark', iconCls: 'bg-rose-100 text-rose-600' }
};

const PAYMENT_STATUS_STYLES = {
    unpaid:   'bg-rose-50 text-rose-700 border-rose-200',
    pending:  'bg-amber-50 text-amber-700 border-amber-200',
    paid:     'bg-emerald-50 text-emerald-700 border-emerald-200',
    failed:   'bg-slate-100 text-slate-600 border-slate-300',
    refunded: 'bg-purple-50 text-purple-700 border-purple-200'
};
const PAYMENT_OPTS = [
    ['unpaid', 'Belum Bayar'],
    ['pending', 'Menunggu Verifikasi'],
    ['paid', 'Lunas'],
    ['failed', 'Gagal'],
    ['refunded', 'Refund']
];

/* ================= HELPER ================= */
function rupiah(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }

// Data pelanggan (nama, alamat, item) berasal dari form publik -> wajib di-escape sebelum masuk innerHTML
function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function normStatus(s) {
    s = (s || 'new').toLowerCase();
    return s === 'sedang diproses' ? 'disiapkan' : s;
}

function orderKey(o) { return o.id || o.order_id; }
function matchKey(key) { return o => String(o.id) === String(key) || String(o.order_id) === String(key); }
function findOrder(key) { return cachedOrders.find(matchKey(key)); }

const dateFmt = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' });

function relTime(iso) {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (isNaN(s) || s < 0) return '';
    if (s < 60) return 'baru saja';
    if (s < 3600) return `${Math.floor(s / 60)} menit lalu`;
    if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`;
    if (s < 7 * 86400) return `${Math.floor(s / 86400)} hari lalu`;
    return '';
}

function waLink(phone) {
    let d = String(phone || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.startsWith('0')) d = '62' + d.slice(1);
    return `https://wa.me/${d}`;
}

function paymentIcon(method) {
    const m = (method || 'cash').toLowerCase();
    if (m.includes('qris')) return 'fa-qrcode';
    if (m.includes('transfer') || m.includes('bank')) return 'fa-building-columns';
    if (m.includes('cash') || m.includes('tunai')) return 'fa-money-bill-wave';
    return 'fa-wallet';
}

function itemsText(o) {
    return Array.isArray(o.items) ? o.items.map(i => `${i.nama || i.name} (${i.qty}x)`).join(', ') : '';
}

function filtersActive() {
    return filterMonth !== 'all' || filterYear !== 'all' || currentFilter !== 'all' || !!searchQuery;
}

/* ================= TOAST & DIALOG ================= */
function toast(message, type = 'success') {
    const host = document.getElementById('toastHost') || (() => {
        const h = document.createElement('div');
        h.id = 'toastHost';
        h.className = 'fixed bottom-4 right-4 left-4 sm:left-auto z-[80] flex flex-col gap-2 items-end pointer-events-none';
        document.body.appendChild(h);
        return h;
    })();
    const styles = {
        success: ['fa-circle-check', 'text-emerald-500'],
        error:   ['fa-circle-exclamation', 'text-rose-500'],
        info:    ['fa-bell', 'text-orange-500'],
        warning: ['fa-triangle-exclamation', 'text-amber-500']
    }[type] || ['fa-circle-info', 'text-slate-500'];

    const el = document.createElement('div');
    el.className = 'toast-in pointer-events-auto w-full sm:w-auto sm:max-w-sm bg-slate-900 text-white text-xs rounded-xl shadow-lg px-4 py-3 flex items-start gap-2.5';
    el.innerHTML = `<i class="fa-solid ${styles[0]} ${styles[1]} mt-0.5"></i><span class="leading-relaxed">${esc(message)}</span>`;
    host.appendChild(el);
    setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, type === 'error' || type === 'warning' ? 6000 : 3000);
}

function confirmDialog({ title, message, confirmText = 'Ya, lanjutkan', danger = false }) {
    return new Promise(resolve => {
        const wrap = document.createElement('div');
        wrap.className = 'fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm';
        wrap.innerHTML = `
            <div class="toast-in bg-white rounded-2xl shadow-xl w-full max-w-sm p-5" role="dialog" aria-modal="true">
                <div class="flex gap-3">
                    <div class="w-10 h-10 shrink-0 rounded-full flex items-center justify-center ${danger ? 'bg-rose-50 text-rose-600' : 'bg-orange-50 text-orange-600'}">
                        <i class="fa-solid ${danger ? 'fa-triangle-exclamation' : 'fa-circle-question'}"></i>
                    </div>
                    <div>
                        <h3 class="font-semibold text-slate-800 text-sm">${esc(title)}</h3>
                        <p class="text-xs text-slate-500 mt-1 leading-relaxed">${esc(message)}</p>
                    </div>
                </div>
                <div class="flex justify-end gap-2 mt-5">
                    <button data-r="0" class="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition">Batal</button>
                    <button data-r="1" class="px-4 py-2 text-xs font-semibold rounded-lg text-white transition ${danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-orange-500 hover:bg-orange-600'}">${esc(confirmText)}</button>
                </div>
            </div>`;
        let closed = false;
        const done = v => {
            if (closed) return;
            closed = true;
            document.removeEventListener('keydown', onKey);
            wrap.remove();
            resolve(v);
        };
        const onKey = e => { if (e.key === 'Escape') done(false); };
        wrap.addEventListener('click', e => {
            if (e.target === wrap) return done(false);
            const b = e.target.closest('[data-r]');
            if (b) done(b.dataset.r === '1');
        });
        document.addEventListener('keydown', onKey);
        document.body.appendChild(wrap);
        wrap.querySelector('[data-r="1"]').focus();
    });
}

function openProof(key) {
    const src = findOrder(key)?.payment_proof;
    if (!src) return;
    const isData = src.startsWith('data:image');
    if (!isData && !/^https?:\/\//i.test(src)) return; // tolak skema lain (mis. javascript:)

    const wrap = document.createElement('div');
    wrap.className = 'fixed inset-0 z-[70] flex flex-col items-center justify-center p-4 bg-slate-950/80';
    wrap.innerHTML = `
        <div class="w-full max-w-lg flex justify-between items-center mb-3 text-white text-xs">
            <span class="font-semibold"><i class="fa-solid fa-image mr-1.5"></i>Bukti Pembayaran</span>
            <div class="flex gap-2">
                ${isData ? '' : `<a href="${esc(src)}" target="_blank" rel="noopener noreferrer" class="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition"><i class="fa-solid fa-up-right-from-square mr-1"></i>Tab baru</a>`}
                <button data-close class="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition"><i class="fa-solid fa-xmark mr-1"></i>Tutup</button>
            </div>
        </div>
        <img src="${esc(src)}" alt="Bukti pembayaran" class="max-w-full max-h-[80vh] rounded-xl shadow-2xl bg-white">`;
    const close = () => { document.removeEventListener('keydown', onKey); wrap.remove(); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    wrap.addEventListener('click', e => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
}

/* ================= PERIODE (BULAN / TAHUN, zona WIB) ================= */
const ymFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit' });

function ymOf(o) {
    if (o._y === undefined) {
        if (!o.created_at) { o._y = 0; o._m = 0; }
        else {
            const p = {};
            ymFmt.formatToParts(new Date(o.created_at)).forEach(x => (p[x.type] = x.value));
            o._y = parseInt(p.year, 10) || 0;
            o._m = parseInt(p.month, 10) || 0;
        }
    }
    return o;
}

function getPeriodOrders() {
    if (filterYear === 'all' && filterMonth === 'all') return cachedOrders;
    return cachedOrders.filter(o => {
        ymOf(o);
        if (filterYear !== 'all' && o._y !== Number(filterYear)) return false;
        if (filterMonth !== 'all' && o._m !== Number(filterMonth)) return false;
        return true;
    });
}

function renderPeriodOptions() {
    const monthSel = document.getElementById('monthFilter');
    const yearSel = document.getElementById('yearFilter');

    if (monthSel) {
        monthSel.innerHTML = `<option value="all">Semua Bulan</option>` +
            MONTH_NAMES.map((n, i) => `<option value="${i + 1}">${n}</option>`).join('');
        monthSel.value = String(filterMonth);
    }
    if (yearSel) {
        const years = [...new Set(cachedOrders.map(o => ymOf(o)._y).filter(Boolean))];
        if (filterYear !== 'all' && !years.includes(Number(filterYear))) years.push(Number(filterYear));
        years.sort((a, b) => b - a);
        yearSel.innerHTML = `<option value="all">Semua Tahun</option>` +
            years.map(y => `<option value="${y}">${y}</option>`).join('');
        yearSel.value = String(filterYear);
    }
}

function renderAll() {
    renderSummary();
    renderTable();
    syncToolbar();
}

window.changeMonth = function(event) {
    filterMonth = event.target.value;
    currentPage = 1;
    renderAll();
};

window.changeYear = function(event) {
    filterYear = event.target.value;
    currentPage = 1;
    renderAll();
};

window.setThisMonth = function() {
    const p = {};
    ymFmt.formatToParts(new Date()).forEach(x => (p[x.type] = x.value));
    filterYear = String(parseInt(p.year, 10));
    filterMonth = String(parseInt(p.month, 10));
    currentPage = 1;
    renderPeriodOptions();
    renderAll();
};

window.resetFilters = function() {
    filterMonth = 'all';
    filterYear = 'all';
    currentFilter = 'all';
    searchQuery = '';
    sortKey = 'created_at';
    sortDir = 'desc';
    currentPage = 1;
    const input = document.getElementById('orderSearchInput');
    if (input) input.value = '';
    renderPeriodOptions();
    renderAll();
};

function syncToolbar() {
    const clearBtn = document.getElementById('searchClear');
    if (clearBtn) clearBtn.classList.toggle('hidden', !searchQuery);

    const resetBtn = document.getElementById('resetBtn');
    if (resetBtn) {
        const active = filtersActive() || sortKey !== 'created_at' || sortDir !== 'desc';
        resetBtn.classList.toggle('ring-2', active);
        resetBtn.classList.toggle('ring-orange-200', active);
    }

    const sortSel = document.getElementById('sortSelect');
    if (sortSel) {
        const v = `${sortKey}:${sortDir}`;
        sortSel.value = v;
        if (sortSel.value !== v) sortSel.selectedIndex = -1;
    }
}

/* ================= SORTING ================= */
window.sortBy = function(key) {
    if (sortKey === key) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
        sortKey = key;
        // Waktu & Total mulai dari terbesar/terbaru, kolom teks mulai A-Z
        sortDir = (key === 'created_at' || key === 'grand_total') ? 'desc' : 'asc';
    }
    currentPage = 1;
    renderTable();
    syncToolbar();
};

window.changeSort = function(event) {
    const [k, d] = String(event.target.value).split(':');
    if (!SORT_KEYS.includes(k)) return;
    sortKey = k;
    sortDir = d === 'asc' ? 'asc' : 'desc';
    currentPage = 1;
    renderTable();
    syncToolbar();
};

function updateSortIcons() {
    SORT_KEYS.forEach(k => {
        const el = document.getElementById('sort-' + k);
        if (!el) return;
        el.className = k === sortKey
            ? `fa-solid ${sortDir === 'asc' ? 'fa-sort-up' : 'fa-sort-down'} text-orange-500 ml-1`
            : 'fa-solid fa-sort text-slate-300 ml-1';
    });
}

function sortValue(o, key) {
    switch (key) {
        case 'created_at':     return o.created_at ? new Date(o.created_at).getTime() : 0;
        case 'customer_name':  return (o.customer_name || '').toLowerCase();
        case 'phone':          return String(o.phone || '').toLowerCase();
        case 'payment_method': return (o.payment_method || 'Cash').toLowerCase();
        case 'status':         return STATUS_RANK[(o.status || 'new').toLowerCase()] ?? 99;
        case 'items':          return itemsText(o).toLowerCase();
        case 'grand_total':    return Number(o.grand_total || 0);
        default:               return '';
    }
}

function compareOrders(a, b) {
    const va = sortValue(a, sortKey);
    const vb = sortValue(b, sortKey);
    let r;
    if (typeof va === 'number' && typeof vb === 'number') r = va - vb;
    else r = String(va).localeCompare(String(vb), 'id', { numeric: true, sensitivity: 'base' });
    return sortDir === 'asc' ? r : -r;
}

/* ================= SEARCH (semua kolom) ================= */
const STATUS_LABELS = { new: 'new baru', disiapkan: 'disiapkan diproses', 'sedang diproses': 'disiapkan diproses sedang diproses', dikirim: 'dikirim', selesai: 'selesai', cancel: 'cancel batal' };
const PAY_STATUS_LABELS = { unpaid: 'unpaid belum bayar', pending: 'pending menunggu verifikasi', paid: 'paid lunas', failed: 'failed gagal', refunded: 'refunded refund' };

function orderHaystack(o) {
    if (o._tgl === undefined) {
        if (o.created_at) {
            const d = new Date(o.created_at);
            o._tgl = d.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }).toLowerCase();
            o._tglLong = d.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'long', year: 'numeric' }).toLowerCase();
        } else { o._tgl = ''; o._tglLong = ''; }
    }
    const status = (o.status || 'new').toLowerCase();
    const payStatus = (o.payment_status || 'unpaid').toLowerCase();
    const phoneDigits = String(o.phone || '').replace(/\D/g, '');
    const phoneAlt = phoneDigits.startsWith('62') ? '0' + phoneDigits.slice(2) : phoneDigits;
    const total = Number(o.grand_total || 0);

    return [
        o.customer_name, o.order_id, o.id,
        o.phone, phoneDigits, phoneAlt,
        o.payment_method || 'Cash',
        status, STATUS_LABELS[status] || '',
        payStatus, PAY_STATUS_LABELS[payStatus] || '',
        o.address,
        o._tgl, o._tglLong,
        itemsText(o),
        total, rupiah(total)
    ].map(v => String(v ?? '').toLowerCase()).join(' | ');
}

let searchTimer;
window.handleSearchInput = function(event) {
    const value = (event.target.value || '').toLowerCase().trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
        searchQuery = value;
        currentPage = 1;
        renderTable();
        syncToolbar();
    }, 180);
};

window.clearSearch = function() {
    const input = document.getElementById('orderSearchInput');
    if (input) { input.value = ''; input.focus(); }
    searchQuery = '';
    currentPage = 1;
    renderTable();
    syncToolbar();
};

/* ================= LOAD ================= */
function setLoading(on) {
    isLoading = on;
    const btn = document.getElementById('refreshBtn');
    const icon = document.getElementById('refreshIcon');
    if (btn) btn.disabled = on;
    if (icon) icon.classList.toggle('fa-spin', on);
}

function renderSkeleton() {
    const bar = w => `<div class="h-2.5 bg-slate-100 rounded animate-pulse" style="width:${w}"></div>`;
    const tbody = document.getElementById('ordersBody');
    if (tbody) {
        tbody.innerHTML = Array.from({ length: 5 }, () => `
            <tr>${['70%', '80%', '60%', '55%', '85%', '50%', '40%'].map(w => `<td class="p-4">${bar(w)}<div class="mt-2">${bar('40%')}</div></td>`).join('')}</tr>
        `).join('');
    }
    const cards = document.getElementById('ordersCards');
    if (cards) {
        cards.innerHTML = Array.from({ length: 3 }, () => `
            <div class="p-4 space-y-2.5">${bar('50%')}${bar('80%')}${bar('65%')}</div>
        `).join('');
    }
}

window.loadOrders = async function({ silent = false } = {}) {
    if (isLoading) return;
    setLoading(true);
    if (!silent && cachedOrders.length === 0) renderSkeleton();

    await authReady;
    let orders = [];
    try {
        const { data, error } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        if (data) orders = data;
    } catch (e) {
        console.warn(e);
        toast('Gagal memuat data dari server. Menampilkan data lokal (jika ada).', 'warning');
    }
    if (orders.length === 0) {
        orders = JSON.parse(localStorage.getItem('local_orders') || '[]');
    }
    cachedOrders = orders;
    if (!silent) currentPage = 1;

    setLoading(false);
    const last = document.getElementById('lastUpdated');
    if (last) last.textContent = `· Diperbarui ${timeFmt.format(new Date())}`;

    renderPeriodOptions();
    renderAll();
};

/* ================= RINGKASAN ================= */
function renderSummary() {
    const orders = getPeriodOrders();
    const counts = { all: orders.length, new: 0, disiapkan: 0, dikirim: 0, selesai: 0, cancel: 0 };
    orders.forEach(o => {
        const st = normStatus(o.status);
        if (counts[st] !== undefined) counts[st]++;
    });

    const cards = [
        { key: 'all', title: 'Semua', icon: 'fa-receipt', iconCls: 'bg-slate-100 text-slate-600' },
        ...['new', 'disiapkan', 'dikirim', 'selesai', 'cancel'].map(k => ({ key: k, title: STATUS_META[k].label, icon: STATUS_META[k].icon, iconCls: STATUS_META[k].iconCls }))
    ];

    const container = document.getElementById('orderSummary');
    if (!container) return;
    container.innerHTML = cards.map(c => {
        const isActive = currentFilter === c.key;
        const highlightNew = c.key === 'new' && counts.new > 0 && !isActive;
        return `
            <button type="button" onclick="filterStatus('${c.key}')" aria-pressed="${isActive}"
                class="min-w-[120px] md:min-w-0 shrink-0 text-left rounded-xl p-3 transition flex items-center gap-3 bg-white
                ${isActive ? 'border-2 border-orange-500 shadow-sm bg-orange-50/40' : 'border border-slate-200 hover:border-orange-200 hover:shadow-sm'}">
                <div class="relative w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${c.iconCls}">
                    <i class="fa-solid ${c.icon} text-sm"></i>
                    ${highlightNew ? '<span class="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-white"></span>' : ''}
                </div>
                <div class="min-w-0">
                    <div class="text-[11px] font-medium text-slate-500 truncate">${c.title}</div>
                    <div class="text-lg font-bold leading-tight ${isActive ? 'text-orange-700' : 'text-slate-800'}">${counts[c.key]}</div>
                </div>
            </button>`;
    }).join('');
}

window.filterStatus = function(status) {
    currentFilter = status;
    currentPage = 1;
    renderAll();
};

window.changeRowsPerPage = function(event) {
    rowsPerPage = parseInt(event.target.value) || 10;
    currentPage = 1;
    renderTable();
};

window.changePage = function(page) {
    currentPage = page;
    renderTable();
    document.getElementById('orderSummary')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

/* ================= KOMPONEN BARIS ================= */
function statusSelect(key, status, extra = '') {
    const st = normStatus(status);
    const opts = [['new', 'Baru'], ['disiapkan', 'Disiapkan'], ['dikirim', 'Dikirim'], ['selesai', 'Selesai'], ['cancel', 'Batal']];
    return `
        <select data-action="status" data-key="${esc(key)}" aria-label="Status pesanan"
            class="border rounded-lg px-2 py-1.5 text-[11px] font-semibold cursor-pointer outline-none focus:ring-2 focus:ring-orange-200 disabled:opacity-50 ${STATUS_META[st]?.cls || STATUS_META.new.cls} ${extra}">
            ${opts.map(([v, l]) => `<option value="${v}" ${st === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>`;
}

function paymentStatusSelect(key, current, extra = '') {
    const val = (current || 'unpaid').toLowerCase();
    return `
        <select data-action="payment" data-key="${esc(key)}" aria-label="Status pembayaran"
            class="border rounded-lg px-2 py-1 text-[11px] font-semibold cursor-pointer outline-none focus:ring-2 focus:ring-orange-200 disabled:opacity-50 ${PAYMENT_STATUS_STYLES[val] || PAYMENT_STATUS_STYLES.unpaid} ${extra}">
            ${PAYMENT_OPTS.map(([v, label]) => `<option value="${v}" ${val === v ? 'selected' : ''}>${label}</option>`).join('')}
        </select>`;
}

function proofButton(o) {
    const proof = o.payment_proof;
    if (!proof || proof === 'Pending / Cash') {
        return `<span class="text-[10px] text-slate-400"><i class="fa-regular fa-image mr-1"></i>Belum ada bukti</span>`;
    }
    return `<button type="button" data-action="proof" data-key="${esc(orderKey(o))}" class="inline-flex items-center gap-1 text-[11px] font-semibold text-orange-600 hover:text-orange-700 hover:underline">
                <i class="fa-solid fa-image"></i> Lihat Bukti
            </button>`;
}

function methodBadge(o) {
    const m = o.payment_method || 'Cash';
    return `<span class="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-700"><i class="fa-solid ${paymentIcon(m)} text-slate-400"></i>${esc(m)}</span>`;
}

function waButton(phone) {
    const href = waLink(phone);
    if (!href) return `<span class="text-[11px] text-slate-400">-</span>`;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-[11px] text-emerald-600 hover:text-emerald-700 hover:underline font-medium">
                <i class="fa-brands fa-whatsapp"></i>${esc(phone)}
            </a>`;
}

function itemsList(o, max = 4) {
    if (!Array.isArray(o.items) || o.items.length === 0) return '<span class="text-slate-400">-</span>';
    const shown = o.items.slice(0, max);
    const rest = o.items.length - shown.length;
    return `<ul class="space-y-0.5">
        ${shown.map(i => `<li class="flex gap-1.5"><span class="shrink-0 font-semibold text-orange-600">${esc(i.qty)}×</span><span class="text-slate-600">${esc(i.nama || i.name)}</span></li>`).join('')}
        ${rest > 0 ? `<li class="text-[10px] text-slate-400" title="${esc(itemsText(o))}">+${rest} item lainnya</li>` : ''}
    </ul>`;
}

function actionButtons(key) {
    return `
        <button type="button" data-action="print" data-key="${esc(key)}" title="Cetak struk" aria-label="Cetak struk"
            class="w-8 h-8 inline-flex items-center justify-center rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition"><i class="fa-solid fa-print text-xs"></i></button>
        <button type="button" data-action="delete" data-key="${esc(key)}" title="Hapus pesanan" aria-label="Hapus pesanan"
            class="w-8 h-8 inline-flex items-center justify-center rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 transition"><i class="fa-solid fa-trash text-xs"></i></button>`;
}

function stockRestoredNote(o) {
    return o.stock_restored ? '<span class="block mt-1.5 text-[10px] font-semibold text-emerald-600"><i class="fa-solid fa-rotate-left"></i> Stok dikembalikan</span>' : '';
}

function copyIdButton(o) {
    if (!o.order_id) return '';
    return `<button type="button" data-action="copy" data-value="${esc(o.order_id)}" title="Salin ID" class="font-mono text-[10px] text-slate-400 hover:text-orange-600">#${esc(o.order_id)} <i class="fa-regular fa-copy ml-0.5"></i></button>`;
}

function rowHtml(o) {
    const key = orderKey(o);
    const st = normStatus(o.status);
    const d = o.created_at ? new Date(o.created_at) : null;
    const rel = d ? relTime(o.created_at) : '';

    return `
        <tr class="align-top hover:bg-slate-50/80 transition ${st === 'new' ? 'bg-amber-50/40' : ''} ${st === 'cancel' ? 'opacity-70' : ''}">
            <td class="p-3 whitespace-nowrap ${st === 'new' ? 'border-l-4 border-l-amber-400' : 'border-l-4 border-l-transparent'}">
                ${d ? `<div class="font-medium text-slate-700">${dateFmt.format(d)}</div>
                       <div class="text-[11px] text-slate-400">${timeFmt.format(d)} WIB</div>
                       ${rel ? `<div class="text-[10px] text-orange-600 mt-0.5">${rel}</div>` : ''}` : '<span class="text-slate-400">-</span>'}
            </td>
            <td class="p-3 min-w-[190px] max-w-[240px]">
                <div class="font-semibold text-slate-800">${esc(o.customer_name || '-')}</div>
                ${copyIdButton(o)}
                <div class="mt-1">${waButton(o.phone)}</div>
                ${o.address ? `<div class="mt-1 text-[11px] text-slate-500 flex gap-1.5"><i class="fa-solid fa-location-dot mt-0.5 text-slate-300"></i><span class="line-clamp-2" title="${esc(o.address)}">${esc(o.address)}</span></div>` : ''}
            </td>
            <td class="p-3 min-w-[160px]">
                ${methodBadge(o)}
                <div class="mt-1.5">${paymentStatusSelect(key, o.payment_status)}</div>
                <div class="mt-1.5">${proofButton(o)}</div>
            </td>
            <td class="p-3 whitespace-nowrap">
                ${statusSelect(key, o.status)}
                ${stockRestoredNote(o)}
            </td>
            <td class="p-3 min-w-[180px] max-w-xs">${itemsList(o)}</td>
            <td class="p-3 text-right font-bold text-emerald-600 whitespace-nowrap">${rupiah(o.grand_total)}</td>
            <td class="p-3"><div class="flex items-center justify-center gap-1.5">${actionButtons(key)}</div></td>
        </tr>`;
}

function cardHtml(o) {
    const key = orderKey(o);
    const st = normStatus(o.status);
    const d = o.created_at ? new Date(o.created_at) : null;
    const rel = d ? relTime(o.created_at) : '';

    return `
        <div class="p-4 ${st === 'new' ? 'bg-amber-50/40 border-l-4 border-l-amber-400' : 'border-l-4 border-l-transparent'} ${st === 'cancel' ? 'opacity-70' : ''}">
            <div class="flex justify-between items-start gap-3">
                <div class="min-w-0">
                    <div class="font-semibold text-sm text-slate-800 truncate">${esc(o.customer_name || '-')}</div>
                    ${copyIdButton(o)}
                </div>
                <div class="text-right shrink-0">
                    <div class="font-bold text-emerald-600 text-sm">${rupiah(o.grand_total)}</div>
                    <div class="text-[10px] text-slate-400">${d ? `${dateFmt.format(d)}, ${timeFmt.format(d)}` : '-'}</div>
                    ${rel ? `<div class="text-[10px] text-orange-600">${rel}</div>` : ''}
                </div>
            </div>

            <div class="mt-2.5 text-xs">${itemsList(o, 3)}</div>

            <div class="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                ${waButton(o.phone)}
                ${methodBadge(o)}
                ${proofButton(o)}
            </div>
            ${o.address ? `<div class="mt-1.5 text-[11px] text-slate-500 flex gap-1.5"><i class="fa-solid fa-location-dot mt-0.5 text-slate-300"></i><span class="line-clamp-2">${esc(o.address)}</span></div>` : ''}

            <div class="mt-3 grid grid-cols-2 gap-2">
                <label class="text-[10px] text-slate-400 font-medium">Status
                    <div class="mt-0.5">${statusSelect(key, o.status, 'w-full')}</div>
                </label>
                <label class="text-[10px] text-slate-400 font-medium">Pembayaran
                    <div class="mt-0.5">${paymentStatusSelect(key, o.payment_status, 'w-full py-1.5')}</div>
                </label>
            </div>
            ${stockRestoredNote(o)}

            <div class="mt-3 flex justify-end gap-1.5">${actionButtons(key)}</div>
        </div>`;
}

function emptyStateHtml() {
    const hasFilter = filtersActive();
    return `
        <div class="flex flex-col items-center justify-center text-center py-12 px-4">
            <div class="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center text-xl mb-3">
                <i class="fa-solid ${hasFilter ? 'fa-magnifying-glass' : 'fa-inbox'}"></i>
            </div>
            <div class="font-semibold text-slate-700 text-sm">${hasFilter ? 'Tidak ada pesanan yang cocok' : 'Belum ada pesanan'}</div>
            <div class="text-xs text-slate-400 mt-1">${hasFilter ? 'Coba ubah kata kunci atau filter periode/status.' : 'Pesanan baru akan muncul di sini.'}</div>
            ${hasFilter ? `<button type="button" onclick="resetFilters()" class="mt-4 px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600 transition">Reset filter</button>` : ''}
        </div>`;
}

/* ================= RENDER TABEL ================= */
function renderTable() {
    const tbody = document.getElementById('ordersBody');
    const cards = document.getElementById('ordersCards');
    if (!tbody && !cards) return;

    let filtered = [...getPeriodOrders()];

    if (currentFilter !== 'all') {
        filtered = filtered.filter(o => normStatus(o.status) === currentFilter);
    }

    if (searchQuery) {
        const tokens = searchQuery.split(/\s+/).filter(Boolean);
        filtered = filtered.filter(o => {
            const hay = orderHaystack(o);
            return tokens.every(t => hay.includes(t));
        });
    }

    filtered.sort(compareOrders);
    updateSortIcons();

    const totalFiltered = filtered.length;
    // Omzet tidak menghitung pesanan batal
    const sumTotal = filtered.reduce((s, o) => s + (normStatus(o.status) === 'cancel' ? 0 : Number(o.grand_total || 0)), 0);
    const totalPages = Math.ceil(totalFiltered / rowsPerPage) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIndex = (currentPage - 1) * rowsPerPage;
    const pageOrders = filtered.slice(startIndex, startIndex + rowsPerPage);

    if (pageOrders.length === 0) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="7">${emptyStateHtml()}</td></tr>`;
        if (cards) cards.innerHTML = emptyStateHtml();
        renderPaginationControls(0, 1, 1, 0);
        return;
    }

    if (tbody) tbody.innerHTML = pageOrders.map(rowHtml).join('');
    if (cards) cards.innerHTML = pageOrders.map(cardHtml).join('');

    renderPaginationControls(totalFiltered, currentPage, totalPages, sumTotal);
}

function pageList(page, total) {
    const out = [];
    for (let i = 1; i <= total; i++) {
        if (i === 1 || i === total || Math.abs(i - page) <= 1) out.push(i);
        else if (out[out.length - 1] !== '…') out.push('…');
    }
    return out;
}

function renderPaginationControls(totalItems, page, totalPages, sumTotal) {
    let el = document.getElementById('orderPagination');
    if (!el) {
        // Fallback untuk HTML lama
        const wrapper = document.getElementById('ordersBody')?.closest('.overflow-x-auto');
        if (!wrapper) return;
        el = document.createElement('div');
        el.id = 'orderPagination';
        el.className = 'flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 bg-white border-t border-slate-100 text-xs text-slate-600';
        wrapper.parentNode.insertBefore(el, wrapper.nextSibling);
    }

    const startRecord = totalItems === 0 ? 0 : (page - 1) * rowsPerPage + 1;
    const endRecord = Math.min(page * rowsPerPage, totalItems);
    const btn = 'min-w-[32px] h-8 px-2 inline-flex items-center justify-center border rounded-lg font-medium transition';

    const pages = pageList(page, totalPages).map(p => p === '…'
        ? `<span class="px-1 text-slate-400">…</span>`
        : `<button type="button" onclick="changePage(${p})" class="${btn} ${p === page ? 'bg-orange-500 border-orange-500 text-white' : 'border-slate-200 hover:bg-slate-100'}">${p}</button>`
    ).join('');

    el.innerHTML = `
        <div class="flex items-center gap-2 flex-wrap justify-center sm:justify-start">
            <span>Menampilkan <b>${startRecord}–${endRecord}</b> dari <b>${totalItems}</b> pesanan</span>
            ${totalItems ? `<span class="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-semibold" title="Tidak termasuk pesanan batal">Omzet ${rupiah(sumTotal)}</span>` : ''}
            <select onchange="changeRowsPerPage(event)" class="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 outline-none text-xs">
                ${[5, 10, 25, 50].map(n => `<option value="${n}" ${rowsPerPage === n ? 'selected' : ''}>${n} / halaman</option>`).join('')}
            </select>
        </div>
        ${totalPages > 1 ? `
        <div class="flex items-center gap-1">
            <button type="button" onclick="changePage(${page - 1})" ${page <= 1 ? 'disabled' : ''} aria-label="Sebelumnya"
                class="${btn} border-slate-200 ${page <= 1 ? 'opacity-40 cursor-not-allowed' : 'hover:bg-slate-100'}"><i class="fa-solid fa-chevron-left text-[10px]"></i></button>
            ${pages}
            <button type="button" onclick="changePage(${page + 1})" ${page >= totalPages ? 'disabled' : ''} aria-label="Berikutnya"
                class="${btn} border-slate-200 ${page >= totalPages ? 'opacity-40 cursor-not-allowed' : 'hover:bg-slate-100'}"><i class="fa-solid fa-chevron-right text-[10px]"></i></button>
        </div>` : ''}
    `;
}

/* ================= AKSI ================= */
window.reprintOrder = (key) => {
    const order = findOrder(key);
    if (!order) { toast('Pesanan tidak ditemukan.', 'error'); return; }
    cetakStrukThermal(order);
};

function cetakStrukThermal(order) {
    const printWindow = window.open('', '_blank', 'width=350,height=600');
    if (!printWindow) { toast('Pop-up diblokir browser. Izinkan pop-up untuk mencetak struk.', 'warning'); return; }

    // Pakai waktu pesanan, bukan waktu cetak ulang
    const tgl = (order.created_at ? new Date(order.created_at) : new Date()).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    const items = Array.isArray(order.items) ? order.items : [];
    const itemsHtml = items.map(i => `
      <div style="display:flex; justify-content:space-between; gap:6px; margin-bottom:5px; font-size:12px;">
        <span>${esc(i.nama || i.name)} x${esc(i.qty)}</span>
        <span>${rupiah(i.qty * (i.harga || i.price))}</span>
      </div>`).join('');
    const total = order.grand_total;

    printWindow.document.write(`
      <html><head>
        <title>Struk - ChimChum</title>
        <style>
          @page { margin:0; }
          body { font-family:'Courier New',monospace; width:48mm; padding:2mm; color:#000; font-size:11px; }
          .center { text-align:center; }
          .line { border-top:1px dashed #000; margin:6px 0; }
          .bold { font-weight:bold; }
        </style>
      </head><body>
        <div class="center bold" style="font-size:14px;">CHIMCHUM MALANG</div>
        <div class="center" style="font-size:10px;">Dimsum Mentai & Crispy Chicken</div>
        <div class="line"></div>
        <div style="font-size:11px; line-height:1.4;">
          Waktu : ${tgl}<br>
          ${order.order_id ? `ID : ${esc(order.order_id)}<br>` : ''}
          Pelanggan : ${esc(order.customer_name || '-')}
        </div>
        <div class="line"></div>
        ${itemsHtml}
        <div class="line"></div>
        <div style="display:flex; justify-content:space-between; font-size:12px;" class="bold">
          <span>TOTAL:</span><span>${rupiah(total)}</span>
        </div>
        <div class="line"></div>
        <div style="display:flex; justify-content:space-between; font-size:11px;">
          <span>Bayar (${esc(order.payment_method || 'Online')}):</span><span>${rupiah(total)}</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:11px;">
          <span>Kembalian:</span><span>${rupiah(0)}</span>
        </div>
        <div class="line"></div>
        <div class="center" style="font-size:10px; margin-top:8px;">Terima Kasih!</div>
        <script>window.onload=function(){window.print();setTimeout(()=>window.close(),300);}<\/script>
      </body></html>`);
    printWindow.document.close();
}

function setBusy(key, on) {
    document.querySelectorAll(`select[data-key]`).forEach(el => {
        if (el.dataset.key === String(key)) el.disabled = on;
    });
}

window.updateStatus = async function(key, val) {
    if (val === 'cancel') {
        const ok = await confirmDialog({
            title: 'Batalkan pesanan?',
            message: 'Status akan diubah menjadi Batal dan stok produk dikembalikan.',
            confirmText: 'Ya, batalkan',
            danger: true
        });
        if (!ok) { renderTable(); return; }
    }

    setBusy(key, true);
    await authReady;
    let restored;
    try {
        const { data, error } = await supabase.rpc('update_order_status', { p_key: String(key), p_status: val });
        if (error) throw error;
        restored = data?.stock_restored;
    } catch (e) {
        console.error('Gagal update status:', e);
        toast('Gagal mengubah status: ' + (e.message || e), 'error');
        renderTable();
        return;
    }

    const match = matchKey(key);
    cachedOrders = cachedOrders.map(o => {
        if (match(o)) { o.status = val; o.stock_restored = restored; }
        return o;
    });

    let localOrders = JSON.parse(localStorage.getItem('local_orders') || '[]');
    localOrders = localOrders.map(o => { if (match(o)) o.status = val; return o; });
    localStorage.setItem('local_orders', JSON.stringify(localOrders));

    toast(`Status diubah ke "${STATUS_META[normStatus(val)]?.label || val}"${restored ? ' · stok dikembalikan' : ''}`);
    renderSummary();
    renderTable();
};

window.updatePaymentStatus = async function(key, val) {
    setBusy(key, true);
    await authReady;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(key));
    try {
        let q = supabase.from('orders').update({ payment_status: val });
        q = isUuid ? q.eq('id', key) : q.eq('order_id', key);
        const { error } = await q;
        if (error) throw error;
    } catch (e) {
        console.error('Gagal update payment_status:', e);
        toast('Gagal mengubah status pembayaran: ' + (e.message || e), 'error');
        renderTable();
        return;
    }

    const match = matchKey(key);
    cachedOrders = cachedOrders.map(o => { if (match(o)) o.payment_status = val; return o; });

    let localOrders = JSON.parse(localStorage.getItem('local_orders') || '[]');
    localOrders = localOrders.map(o => { if (match(o)) o.payment_status = val; return o; });
    localStorage.setItem('local_orders', JSON.stringify(localOrders));

    const label = PAYMENT_OPTS.find(([v]) => v === val)?.[1] || val;
    toast(`Pembayaran ditandai "${label}"`);
    renderTable();
};

window.deleteOrder = async function(key) {
    const match = matchKey(key);
    const order = cachedOrders.find(match);

    const willRestore = !!order && (order.status || 'new').toLowerCase() !== 'cancel' && !order.stock_restored;
    const ok = await confirmDialog({
        title: 'Hapus pesanan?',
        message: `Pesanan ${order?.customer_name ? `atas nama ${order.customer_name} ` : ''}akan dihapus permanen.${willRestore ? ' Stok produk akan dikembalikan.' : ''}`,
        confirmText: 'Hapus',
        danger: true
    });
    if (!ok) return;

    await authReady;
    try {
        const { data, error } = await supabase.rpc('delete_order', { p_key: String(key) });
        if (error) throw error;
        if (data && data.skipped_items > 0) {
            toast(`Pesanan dihapus, tetapi ${data.skipped_items} produk tidak ditemukan sehingga stoknya tidak bisa dikembalikan. Cek stok secara manual.`, 'warning');
        } else {
            toast('Pesanan dihapus.');
        }
    } catch (e) {
        console.error('Gagal menghapus pesanan:', e);
        const hint = (e.code === 'PGRST202' || /delete_order/.test(e.message || ''))
            ? ' Pastikan fungsi SQL delete_order sudah dijalankan di Supabase.'
            : '';
        toast('Gagal menghapus pesanan: ' + (e.message || e) + hint, 'error');
        return;
    }

    cachedOrders = cachedOrders.filter(o => !match(o));
    let localOrders = JSON.parse(localStorage.getItem('local_orders') || '[]');
    localOrders = localOrders.filter(o => !match(o));
    localStorage.setItem('local_orders', JSON.stringify(localOrders));
    renderPeriodOptions();
    renderSummary();
    renderTable();
};

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        toast(`ID ${text} disalin`);
    } catch {
        toast('Gagal menyalin ID', 'error');
    }
}

/* ================= EVENT DELEGATION ================= */
// Tombol & dropdown di baris memakai data-action, bukan onclick inline,
// supaya nilai key/ID tidak perlu disisipkan ke dalam string JavaScript.
document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el || el.tagName === 'SELECT') return;
    const { action, key } = el.dataset;
    if (action === 'print') reprintOrder(key);
    else if (action === 'delete') deleteOrder(key);
    else if (action === 'proof') openProof(key);
    else if (action === 'copy') copyText(el.dataset.value);
});

document.addEventListener('change', e => {
    const sel = e.target.closest('select[data-action]');
    if (!sel) return;
    if (sel.dataset.action === 'status') updateStatus(sel.dataset.key, sel.value);
    else if (sel.dataset.action === 'payment') updatePaymentStatus(sel.dataset.key, sel.value);
});

// Tekan "/" untuk langsung ke kolom pencarian
document.addEventListener('keydown', e => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    e.preventDefault();
    document.getElementById('orderSearchInput')?.focus();
});

/* ================= REALTIME ================= */
let renderTimer;
function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
        // Jangan render ulang saat admin sedang membuka dropdown
        if (document.activeElement?.matches?.('select[data-action]')) { scheduleRender(); return; }
        renderPeriodOptions();
        renderAll();
    }, 300);
}

function handleRealtime(p) {
    if (p.eventType === 'INSERT' && p.new) {
        if (!cachedOrders.some(o => String(o.id) === String(p.new.id))) {
            cachedOrders.unshift(p.new);
            toast(`Pesanan baru dari ${p.new.customer_name || 'pelanggan'} · ${rupiah(p.new.grand_total)}`, 'info');
        }
    } else if (p.eventType === 'UPDATE' && p.new) {
        cachedOrders = cachedOrders.map(o => String(o.id) === String(p.new.id) ? p.new : o);
    } else if (p.eventType === 'DELETE' && p.old) {
        cachedOrders = cachedOrders.filter(o => String(o.id) !== String(p.old.id));
    }
    scheduleRender();
}

async function subscribeRealtime() {
    try {
        await authReady;
        supabase
            .channel('pesanan-admin')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, handleRealtime)
            .subscribe(status => {
                const badge = document.getElementById('liveBadge');
                if (!badge) return;
                const live = status === 'SUBSCRIBED';
                badge.classList.toggle('hidden', !live);
                badge.classList.toggle('inline-flex', live);
            });
    } catch (e) {
        console.warn('Realtime tidak aktif:', e);
    }
}

// Perbarui teks "x menit lalu" tiap menit
setInterval(() => {
    if (!document.activeElement?.matches?.('select[data-action]')) renderTable();
}, 60000);

renderPeriodOptions();
loadOrders();
subscribeRealtime();
