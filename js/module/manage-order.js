import { supabase, authReady } from '../supabase.js';

/* =========================================================
   KONFIGURASI
========================================================= */

const PREFS_KEY = 'manage_order_prefs';
const LOCAL_ORDERS_KEY = 'local_orders';
const AUTO_REFRESH_MS = 60_000;
const FRESH_ORDER_MINUTES = 30;
const STORE_NAME = 'ChimChum Malang';

const PAYMENT_PROOF_BUCKET = 'payment-proofs';
const DELETE_AFTER_DAYS = 30;

const STATUS_FLOW = ['new', 'disiapkan', 'dikirim', 'selesai'];

const STATUS_META = {
    new: {
        label: 'New',
        icon: 'fa-bell',
        badge: 'bg-blue-50 text-blue-700 ring-blue-200',
        dot: 'bg-blue-500',
        soft: 'bg-blue-50 text-blue-600'
    },
    disiapkan: {
        label: 'Diproses',
        icon: 'fa-fire-burner',
        badge: 'bg-amber-50 text-amber-700 ring-amber-200',
        dot: 'bg-amber-500',
        soft: 'bg-amber-50 text-amber-600'
    },
    dikirim: {
        label: 'Dikirim',
        icon: 'fa-motorcycle',
        badge: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
        dot: 'bg-indigo-500',
        soft: 'bg-indigo-50 text-indigo-600'
    },
    selesai: {
        label: 'Selesai',
        icon: 'fa-circle-check',
        badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
        dot: 'bg-emerald-500',
        soft: 'bg-emerald-50 text-emerald-600'
    },
    cancel: {
        label: 'Batal',
        icon: 'fa-circle-xmark',
        badge: 'bg-red-50 text-red-700 ring-red-200',
        dot: 'bg-red-500',
        soft: 'bg-red-50 text-red-600'
    }
};

/* Aksi cepat: status berikutnya */
const NEXT_STATUS = {
    new:       { to: 'disiapkan', label: 'Proses',  long: 'Proses Pesanan',  icon: 'fa-fire-burner' },
    disiapkan: { to: 'dikirim',   label: 'Kirim',   long: 'Tandai Dikirim',  icon: 'fa-motorcycle' },
    dikirim:   { to: 'selesai',   label: 'Selesai', long: 'Tandai Selesai',  icon: 'fa-circle-check' }
};

const PAYMENT_STATUS_OPTIONS = [
    ['unpaid', 'Belum Bayar'],
    ['pending', 'Menunggu Verifikasi'],
    ['paid', 'Lunas'],
    ['failed', 'Gagal'],
    ['refunded', 'Refund']
];

const PAYMENT_STATUS_LABEL = Object.fromEntries(PAYMENT_STATUS_OPTIONS);

const PAYMENT_STATUS_STYLES = {
    unpaid:   'bg-rose-50 text-rose-700 border-rose-200',
    pending:  'bg-amber-50 text-amber-700 border-amber-200',
    paid:     'bg-emerald-50 text-emerald-700 border-emerald-200',
    failed:   'bg-slate-100 text-slate-600 border-slate-300',
    refunded: 'bg-purple-50 text-purple-700 border-purple-200'
};

const DATE_FILTER_LABEL = {
    today: 'Hari Ini',
    yesterday: 'Kemarin',
    '7d': '7 Hari Terakhir',
    '30d': '30 Hari Terakhir'
};

const SORTERS = {
    newest:     (a, b) => toTime(b.created_at) - toTime(a.created_at),
    oldest:     (a, b) => toTime(a.created_at) - toTime(b.created_at),
    total_desc: (a, b) => b.grand_total - a.grand_total,
    total_asc:  (a, b) => a.grand_total - b.grand_total
};


/* =========================================================
   STATE
========================================================= */

const state = {
    allOrders: [],
    filteredOrders: [],

    currentPage: 1,
    pageSize: 20,

    search: '',
    status: 'all',
    payment: 'all',
    date: 'all',
    sort: 'newest',

    selectedId: null,
    proofId: null,

    loading: false,
    source: 'supabase',
    lastError: '',
    lastUpdated: null,

    autoRefresh: false,
    knownIds: new Set(),
    freshIds: new Set(),
    busy: new Set()
};

let autoRefreshTimer = null;
let confirmOpen = false;

const $ = id => document.getElementById(id);


/* =========================================================
   INIT
========================================================= */

async function initManageOrder() {
    loadPrefs();
    syncControls();
    bindEvents();
    renderStatusTabs();
    await loadOrders();
    setupAutoRefresh();

    // Perbarui label "x menit lalu" tiap menit tanpa fetch ulang
    setInterval(() => {
        if (!state.loading) {
            renderTable();
            renderLastUpdated();
        }
    }, 60_000);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initManageOrder, { once: true });
} else {
    initManageOrder();
}


/* =========================================================
   PREFERENSI (disimpan di browser)
========================================================= */

function loadPrefs() {
    try {
        const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');

        if ([10, 20, 50, 100].includes(Number(prefs.pageSize))) {
            state.pageSize = Number(prefs.pageSize);
        }
        if (SORTERS[prefs.sort]) {
            state.sort = prefs.sort;
        }
        state.autoRefresh = Boolean(prefs.autoRefresh);
    } catch {
        /* abaikan */
    }
}

function savePrefs() {
    try {
        localStorage.setItem(PREFS_KEY, JSON.stringify({
            pageSize: state.pageSize,
            sort: state.sort,
            autoRefresh: state.autoRefresh
        }));
    } catch {
        /* abaikan */
    }
}

function syncControls() {
    const set = (id, value) => {
        const el = $(id);
        if (el) el.value = value;
    };

    set('searchInput', state.search);
    set('paymentFilter', state.payment);
    set('dateFilter', state.date);
    set('sortSelect', state.sort);
    set('pageSize', String(state.pageSize));

    const toggle = $('autoRefreshToggle');
    if (toggle) toggle.checked = state.autoRefresh;
}


/* =========================================================
   EVENTS
========================================================= */

function bindEvents() {

    const searchInput = $('searchInput');

    if (searchInput) {
        searchInput.addEventListener('input', debounce(() => {
            state.search = searchInput.value.trim().toLowerCase();
            state.currentPage = 1;
            applyFilters();
        }, 250));
    }

    bindSelect('paymentFilter', value => { state.payment = value; });
    bindSelect('dateFilter', value => { state.date = value; });
    bindSelect('sortSelect', value => { state.sort = value; savePrefs(); });
    bindSelect('pageSize', value => { state.pageSize = Number(value) || 20; savePrefs(); });

    const autoToggle = $('autoRefreshToggle');
    if (autoToggle) {
        autoToggle.addEventListener('change', () => {
            state.autoRefresh = autoToggle.checked;
            savePrefs();
            setupAutoRefresh();
            showToast(
                state.autoRefresh
                    ? 'Auto refresh aktif (setiap 60 detik).'
                    : 'Auto refresh dimatikan.',
                'info'
            );
        });
    }

    document.addEventListener('click', handleClick);
    document.addEventListener('change', handleChange);
    document.addEventListener('keydown', handleKeydown);

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && state.autoRefresh) {
            loadOrders({ silent: true });
        }
    });
}

function bindSelect(id, apply) {
    const el = $(id);
    if (!el) return;

    el.addEventListener('change', () => {
        apply(el.value);
        state.currentPage = 1;
        applyFilters();
    });
}

function handleClick(event) {

    /* Tutup menu jika klik di luar */
    const menu = $('moreMenu');
    if (
        menu &&
        !menu.classList.contains('hidden') &&
        !event.target.closest('#moreMenu, [data-action="toggle-menu"]')
    ) {
        menu.classList.add('hidden');
    }

    /* Klik backdrop modal */
    if (event.target.matches('[data-modal]')) {
        closeModal(event.target.id);
        return;
    }

    const el = event.target.closest('[data-action]');
    if (!el) return;

    const action = el.dataset.action;
    const id = el.dataset.id;

    /* Klik baris/kartu tidak boleh terpicu saat klik kontrol di dalamnya */
    if (
        action === 'detail' &&
        el.matches('tr, [data-card]') &&
        event.target.closest('select, a, input, label, button')
    ) {
        return;
    }

    switch (action) {

        case 'refresh':
            loadOrders();
            break;

        case 'detail':
            window.showOrderDetail(id);
            break;

        case 'proof':
            window.showPaymentProof(id);
            break;

        case 'set-status':
            changeOrderStatus(id, el.dataset.to);
            break;

        case 'set-payment':
            window.updatePaymentStatus(id, el.dataset.value);
            break;

        case 'filter-status':
            state.status = el.dataset.value || 'all';
            state.currentPage = 1;
            applyFilters();
            break;

        case 'kpi':
            applyKpiFilter(el.dataset);
            break;

        case 'page':
            window.goToPage(Number(el.dataset.page));
            break;

        case 'close-modal':
            closeModal(el.dataset.target);
            break;

        case 'toggle-menu':
            menu?.classList.toggle('hidden');
            break;

        case 'export-csv':
            menu?.classList.add('hidden');
            exportCSV();
            break;

        case 'delete-old-proofs':
            menu?.classList.add('hidden');
            deleteOldPaymentProofs();
            break;

        case 'reset-filters':
            resetFilters();
            break;

        case 'clear-chip':
            clearChip(el.dataset.chip);
            break;

        case 'copy':
            copyText(el.dataset.copy || '', el.dataset.label || 'Teks');
            break;

        case 'copy-summary': {
            const order = findOrder(id);
            if (order) copyText(buildOrderSummary(order), 'Ringkasan pesanan');
            break;
        }

        case 'toggle-zoom':
            toggleProofZoom(el);
            break;
    }
}

function handleChange(event) {
    const select = event.target.closest('[data-payment-select]');
    if (select) {
        window.updatePaymentStatus(select.dataset.id, select.value, select);
    }
}

function handleKeydown(event) {

    if (confirmOpen) return;

    if (event.key === 'Escape') {
        if (isModalOpen('proofModal')) {
            closeModal('proofModal');
        } else if (isModalOpen('detailModal')) {
            closeModal('detailModal');
        } else {
            $('moreMenu')?.classList.add('hidden');
        }
        return;
    }

    if (event.key === '/' && !isTypingTarget(event.target) && !anyModalOpen()) {
        event.preventDefault();
        $('searchInput')?.focus();
    }
}

function isTypingTarget(target) {
    return Boolean(
        target?.closest?.('input, textarea, select, [contenteditable="true"]')
    );
}


/* =========================================================
   LOAD ORDERS
========================================================= */

window.loadOrders = loadOrders;

async function loadOrders({ silent = false } = {}) {

    if (state.loading) return;

    state.loading = true;
    setRefreshing(true);

    if (!silent && state.allOrders.length === 0) {
        renderSkeleton();
    }

    let orders = [];
    let supabaseSuccess = false;
    let errorMessage = '';

    try {
        await authReady;

        const { data, error } = await supabase
            .from('orders')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('[MANAGE ORDER] Supabase error:', error);
            errorMessage = error.message || '';
        } else if (Array.isArray(data)) {
            orders = data;
            supabaseSuccess = true;
        }

    } catch (error) {
        console.error('[MANAGE ORDER] Supabase exception:', error);
        errorMessage = error?.message || '';
    }

    /* FALLBACK LOCAL STORAGE */
    if (!supabaseSuccess) {
        try {
            const localOrders = JSON.parse(localStorage.getItem(LOCAL_ORDERS_KEY) || '[]');
            if (Array.isArray(localOrders)) orders = localOrders;
        } catch (error) {
            console.error('[MANAGE ORDER] localStorage error:', error);
        }
    }

    const normalized = orders.map(normalizeOrder);

    /* Deteksi pesanan baru saat auto refresh */
    if (silent && state.knownIds.size > 0) {
        const incoming = normalized.filter(o => !state.knownIds.has(keyOf(o.order_id)));

        if (incoming.length > 0) {
            incoming.forEach(o => state.freshIds.add(keyOf(o.order_id)));
            showToast(`${incoming.length} pesanan baru masuk!`, 'success');
        }
    }

    state.knownIds = new Set(normalized.map(o => keyOf(o.order_id)));
    state.allOrders = normalized;
    state.source = supabaseSuccess ? 'supabase' : 'local';
    state.lastError = supabaseSuccess ? '' : errorMessage;
    state.lastUpdated = new Date();

    state.loading = false;
    setRefreshing(false);

    renderSourceBanner();
    renderLastUpdated();
    applyFilters();

    if (!silent) {
        refreshOpenModals();
    }
}

function setRefreshing(active) {
    const icon = $('refreshIcon');
    const button = $('refreshBtn');

    icon?.classList.toggle('fa-spin', active);
    if (button) button.disabled = active;
}

function renderLastUpdated() {
    const el = $('lastUpdated');
    if (!el || !state.lastUpdated) return;

    el.textContent = `Diperbarui ${formatTime(state.lastUpdated)} WIB`;
}

function renderSourceBanner() {
    const banner = $('dataSourceBanner');
    if (!banner) return;

    if (state.source === 'supabase') {
        banner.classList.add('hidden');
        banner.innerHTML = '';
        return;
    }

    banner.classList.remove('hidden');
    banner.innerHTML = `
        <div class="flex items-start gap-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl px-4 py-3">
            <i class="fa-solid fa-triangle-exclamation mt-0.5"></i>
            <div class="text-sm flex-1">
                <p class="font-semibold">Gagal memuat dari server — menampilkan data lokal browser.</p>
                <p class="text-xs text-amber-700 mt-0.5">
                    ${escapeHTML(state.lastError || 'Periksa koneksi internet atau sesi login.')}
                </p>
            </div>
            <button type="button" data-action="refresh"
                    class="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg bg-white border border-amber-200 hover:bg-amber-100">
                Coba lagi
            </button>
        </div>
    `;
}


/* =========================================================
   AUTO REFRESH
========================================================= */

function setupAutoRefresh() {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;

    if (!state.autoRefresh) return;

    autoRefreshTimer = setInterval(() => {
        if (document.hidden) return;
        loadOrders({ silent: true });
    }, AUTO_REFRESH_MS);
}


/* =========================================================
   NORMALIZE
========================================================= */

function normalizeOrder(order) {
    return {
        ...order,

        order_id: String(order?.order_id || order?.id || '').trim(),

        customer_name: order?.customer_name || order?.name || '-',
        phone: order?.phone || order?.whatsapp || '-',
        address: order?.address || order?.alamat || '-',

        payment_method: order?.payment_method || 'Cash',
        payment_proof: order?.payment_proof || '',
        payment_status: normalizePaymentStatus(order?.payment_status),

        stock_restored: Boolean(order?.stock_restored),
        status: normalizeStatus(order?.status),

        items: Array.isArray(order?.items) ? order.items : [],

        notes: order?.notes || order?.note || order?.catatan || '',

        grand_total: Number(order?.grand_total ?? order?.total_price ?? order?.total ?? 0),

        created_at: order?.created_at || null
    };
}

function normalizeStatus(status) {
    const value = String(status || 'new').trim().toLowerCase();

    const aliases = {
        pending: 'new',
        baru: 'new',
        diproses: 'disiapkan',
        processing: 'disiapkan',
        proses: 'disiapkan',
        shipped: 'dikirim',
        selesai: 'selesai',
        completed: 'selesai',
        complete: 'selesai',
        cancelled: 'cancel',
        canceled: 'cancel',
        batal: 'cancel'
    };

    return aliases[value] || value;
}

function normalizePaymentStatus(status) {
    const value = String(status || 'unpaid').trim().toLowerCase();
    const aliases = { lunas: 'paid', sukses: 'paid', success: 'paid', refund: 'refunded' };
    const result = aliases[value] || value;
    return PAYMENT_STATUS_STYLES[result] ? result : 'unpaid';
}

function normalizeItem(item) {
    const name = item?.nama || item?.name || item?.product_name || 'Item';
    const qty = Number(item?.qty || item?.quantity || 1);
    const price = Number(item?.price || item?.harga || item?.unit_price || 0);
    const variant = item?.variant || item?.varian || item?.option || '';
    const note = item?.note || item?.catatan || '';

    return { name, qty, price, variant, note, subtotal: price * qty };
}

function itemCount(order) {
    return order.items.reduce((total, item) => total + normalizeItem(item).qty, 0);
}

function itemsSummary(order) {
    return order.items
        .map(item => {
            const { name, qty } = normalizeItem(item);
            return `${qty}× ${name}`;
        })
        .join(', ');
}

const keyOf = value => String(value || '').toUpperCase();

function findOrder(orderId) {
    const key = keyOf(orderId);
    return state.allOrders.find(o => keyOf(o.order_id) === key) || null;
}


/* =========================================================
   FILTER
========================================================= */

function applyFilters() {

    const range = getDateRange(state.date);

    state.filteredOrders = state.allOrders
        .filter(order => {

            if (state.status !== 'all' && order.status !== state.status) return false;

            if (state.payment !== 'all' && order.payment_status !== state.payment) return false;

            if (range) {
                const time = toTime(order.created_at);
                if (time < range.from || time >= range.to) return false;
            }

            if (state.search) {
                const searchable = [
                    order.order_id,
                    order.customer_name,
                    order.phone,
                    order.address,
                    order.payment_method,
                    PAYMENT_STATUS_LABEL[order.payment_status],
                    STATUS_META[order.status]?.label || order.status,
                    itemsSummary(order)
                ]
                    .map(value => String(value || '').toLowerCase())
                    .join(' ');

                if (!searchable.includes(state.search)) return false;
            }

            return true;
        })
        .sort(SORTERS[state.sort] || SORTERS.newest);

    const totalPages = Math.max(1, Math.ceil(state.filteredOrders.length / state.pageSize));
    if (state.currentPage > totalPages) state.currentPage = totalPages;

    renderAll();
}

function renderAll() {
    renderSummary();
    renderStatusTabs();
    renderTable();
    renderFilterState();
}

function getDateRange(filter) {
    const todayStart = startOfTodayWIB();
    const day = 24 * 60 * 60 * 1000;
    const end = Number.MAX_SAFE_INTEGER;

    switch (filter) {
        case 'today':     return { from: todayStart, to: end };
        case 'yesterday': return { from: todayStart - day, to: todayStart };
        case '7d':        return { from: todayStart - 6 * day, to: end };
        case '30d':       return { from: todayStart - 29 * day, to: end };
        default:          return null;
    }
}

function applyKpiFilter(dataset) {
    state.status = dataset.status || 'all';
    state.payment = dataset.payment || 'all';
    state.date = dataset.date || 'all';
    state.currentPage = 1;

    syncControls();
    applyFilters();

    $('orderTableBody')?.closest('section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function clearChip(chip) {
    if (chip === 'search') {
        state.search = '';
        const input = $('searchInput');
        if (input) input.value = '';
    }
    if (chip === 'payment') state.payment = 'all';
    if (chip === 'date') state.date = 'all';
    if (chip === 'status') state.status = 'all';

    state.currentPage = 1;
    syncControls();
    applyFilters();
}

function resetFilters() {
    state.search = '';
    state.status = 'all';
    state.payment = 'all';
    state.date = 'all';
    state.currentPage = 1;

    syncControls();
    applyFilters();
}

window.resetOrderFilters = resetFilters;


/* =========================================================
   KPI SUMMARY
========================================================= */

function renderSummary() {

    const container = $('summaryCards');
    if (!container) return;

    const todayStart = startOfTodayWIB();
    const active = state.allOrders.filter(o => o.status !== 'cancel');
    const today = active.filter(o => toTime(o.created_at) >= todayStart);

    const revenueToday = today.reduce((sum, o) => sum + o.grand_total, 0);
    const needAction = state.allOrders.filter(o => o.status === 'new').length;
    const pendingPayment = active.filter(o => o.payment_status === 'pending').length;

    const cards = [
        {
            label: 'Pesanan Hari Ini',
            value: today.length,
            sub: `${state.allOrders.length} pesanan total`,
            icon: 'fa-receipt',
            iconClass: 'bg-slate-100 text-slate-600',
            attrs: 'data-date="today"'
        },
        {
            label: 'Omzet Hari Ini',
            value: `Rp ${formatRupiah(revenueToday)}`,
            sub: 'Tidak termasuk pesanan batal',
            icon: 'fa-wallet',
            iconClass: 'bg-emerald-50 text-emerald-600',
            attrs: 'data-date="today"'
        },
        {
            label: 'Perlu Diproses',
            value: needAction,
            sub: needAction ? 'Pesanan baru menunggu' : 'Semua sudah ditangani',
            icon: 'fa-bell',
            iconClass: 'bg-blue-50 text-blue-600',
            attrs: 'data-status="new"',
            alert: needAction > 0
        },
        {
            label: 'Verifikasi Bayar',
            value: pendingPayment,
            sub: pendingPayment ? 'Cek bukti transfer' : 'Tidak ada antrean',
            icon: 'fa-hourglass-half',
            iconClass: 'bg-amber-50 text-amber-600',
            attrs: 'data-payment="pending"',
            alert: pendingPayment > 0
        }
    ];

    container.innerHTML = cards.map(card => `
        <button type="button" data-action="kpi" ${card.attrs}
                class="group text-left bg-white rounded-2xl border border-slate-200 shadow-sm p-4
                       hover:border-brand-200 hover:shadow-md transition
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
            <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                    <p class="text-[11px] uppercase tracking-wide font-semibold text-slate-400">
                        ${escapeHTML(card.label)}
                    </p>
                    <p class="text-lg sm:text-2xl font-bold text-slate-900 mt-1 truncate">
                        ${escapeHTML(card.value)}
                    </p>
                </div>
                <div class="relative w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${card.iconClass}">
                    <i class="fa-solid ${card.icon}"></i>
                    ${card.alert ? `
                        <span class="absolute -top-1 -right-1 flex h-3 w-3">
                            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-500 opacity-60"></span>
                            <span class="relative inline-flex rounded-full h-3 w-3 bg-brand-500"></span>
                        </span>
                    ` : ''}
                </div>
            </div>
            <p class="text-[11px] text-slate-400 mt-2 truncate group-hover:text-brand-600">
                ${escapeHTML(card.sub)}
            </p>
        </button>
    `).join('');
}


/* =========================================================
   STATUS TABS
========================================================= */

function renderStatusTabs() {

    const container = $('statusTabs');
    if (!container) return;

    const counts = { all: state.allOrders.length };
    Object.keys(STATUS_META).forEach(key => { counts[key] = 0; });
    state.allOrders.forEach(o => {
        if (counts[o.status] !== undefined) counts[o.status]++;
    });

    const tabs = [
        ['all', 'Semua', 'bg-slate-400'],
        ...Object.entries(STATUS_META).map(([key, meta]) => [key, meta.label, meta.dot])
    ];

    container.innerHTML = tabs.map(([value, label, dot]) => {
        const active = state.status === value;

        return `
            <button type="button" role="tab" aria-selected="${active}"
                    data-action="filter-status" data-value="${value}"
                    class="relative shrink-0 inline-flex items-center gap-2 px-3.5 py-3.5 text-sm font-semibold transition
                           ${active ? 'text-brand-600' : 'text-slate-500 hover:text-slate-800'}">
                ${value !== 'all' ? `<span class="w-2 h-2 rounded-full ${dot}"></span>` : ''}
                ${escapeHTML(label)}
                <span class="min-w-[22px] px-1.5 py-0.5 rounded-full text-[11px] font-bold
                             ${active ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-500'}">
                    ${counts[value] ?? 0}
                </span>
                ${active ? '<span class="absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-brand-500"></span>' : ''}
            </button>
        `;
    }).join('');
}


/* =========================================================
   TABLE + MOBILE LIST
========================================================= */

function renderTable() {

    const tbody = $('orderTableBody');
    const cardList = $('orderCardList');
    const emptyState = $('emptyState');
    const resultInfo = $('resultInfo');

    if (!tbody) return;

    const total = state.filteredOrders.length;
    const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
    const start = (state.currentPage - 1) * state.pageSize;
    const end = Math.min(start + state.pageSize, total);
    const pageOrders = state.filteredOrders.slice(start, end);

    if (resultInfo) {
        if (total === 0) {
            resultInfo.textContent = 'Tidak ada pesanan.';
        } else {
            const omzet = state.filteredOrders
                .filter(o => o.status !== 'cancel')
                .reduce((sum, o) => sum + o.grand_total, 0);

            resultInfo.textContent =
                `${total} pesanan · Omzet Rp ${formatRupiah(omzet)} (tanpa batal)`;
        }
    }

    if (pageOrders.length === 0) {
        tbody.innerHTML = '';
        if (cardList) cardList.innerHTML = '';
        if (emptyState) {
            emptyState.innerHTML = renderEmptyState();
            emptyState.classList.remove('hidden');
        }
    } else {
        emptyState?.classList.add('hidden');
        tbody.innerHTML = pageOrders.map(renderOrderRow).join('');
        if (cardList) cardList.innerHTML = pageOrders.map(renderOrderCard).join('');
    }

    renderPagination(total, totalPages, start, end);
}

function renderEmptyState() {
    const noData = state.allOrders.length === 0;

    return `
        <div class="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
            <i class="fa-solid ${noData ? 'fa-inbox' : 'fa-magnifying-glass'} text-xl"></i>
        </div>
        <p class="font-semibold text-slate-700">
            ${noData ? 'Belum ada pesanan' : 'Pesanan tidak ditemukan'}
        </p>
        <p class="text-xs text-slate-400 mt-1">
            ${noData ? 'Pesanan baru akan muncul di sini.' : 'Coba ubah kata kunci atau filter.'}
        </p>
        ${noData ? '' : `
            <button type="button" data-action="reset-filters"
                    class="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-50 text-brand-600 text-sm font-semibold hover:bg-brand-100">
                <i class="fa-solid fa-rotate-left text-xs"></i> Reset filter
            </button>
        `}
    `;
}

function renderSkeleton() {
    const tbody = $('orderTableBody');
    const cardList = $('orderCardList');
    $('emptyState')?.classList.add('hidden');

    const resultInfo = $('resultInfo');
    if (resultInfo) resultInfo.textContent = 'Memuat pesanan...';

    if (tbody) {
        tbody.innerHTML = Array.from({ length: 6 }, () => `
            <tr>
                <td class="px-4 py-4"><div class="skeleton h-4 w-28"></div><div class="skeleton h-3 w-14 mt-2"></div></td>
                <td class="px-4 py-4"><div class="skeleton h-4 w-32"></div><div class="skeleton h-3 w-24 mt-2"></div></td>
                <td class="px-4 py-4"><div class="skeleton h-4 w-20"></div><div class="skeleton h-6 w-28 mt-2"></div></td>
                <td class="px-4 py-4"><div class="skeleton h-4 w-20 ml-auto"></div></td>
                <td class="px-4 py-4"><div class="skeleton h-6 w-20 rounded-full"></div></td>
                <td class="px-4 py-4"><div class="skeleton h-4 w-20"></div></td>
                <td class="px-4 py-4"><div class="skeleton h-9 w-28 ml-auto"></div></td>
            </tr>
        `).join('');
    }

    if (cardList) {
        cardList.innerHTML = Array.from({ length: 4 }, () => `
            <div class="p-4 space-y-2">
                <div class="flex justify-between"><div class="skeleton h-4 w-28"></div><div class="skeleton h-5 w-16 rounded-full"></div></div>
                <div class="skeleton h-3 w-40"></div>
                <div class="skeleton h-3 w-full"></div>
                <div class="flex justify-between pt-1"><div class="skeleton h-5 w-24"></div><div class="skeleton h-8 w-24"></div></div>
            </div>
        `).join('');
    }
}

function isFreshOrder(order) {
    if (order.status !== 'new') return false;
    if (state.freshIds.has(keyOf(order.order_id))) return true;

    const time = toTime(order.created_at);
    return time > 0 && Date.now() - time < FRESH_ORDER_MINUTES * 60 * 1000;
}

function statusBadge(status, extra = '') {
    const meta = STATUS_META[status] || {
        label: status || '-',
        badge: 'bg-slate-100 text-slate-600 ring-slate-200',
        dot: 'bg-slate-400'
    };

    return `
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ring-1 ring-inset ${meta.badge} ${extra}">
            <span class="w-1.5 h-1.5 rounded-full ${meta.dot}"></span>
            ${escapeHTML(meta.label)}
        </span>
    `;
}

function paymentStatusSelect(order, extraClass = '') {
    const current = normalizePaymentStatus(order.payment_status);
    const busy = state.busy.has(`pay:${keyOf(order.order_id)}`);

    return `
        <select data-payment-select data-id="${escapeAttribute(order.order_id)}"
                aria-label="Status pembayaran ${escapeAttribute(order.order_id)}"
                ${busy ? 'disabled' : ''}
                class="border rounded-lg pl-2 pr-7 py-1 text-[11px] font-semibold cursor-pointer outline-none
                       focus:ring-2 focus:ring-brand-500 disabled:opacity-60 disabled:cursor-wait
                       ${PAYMENT_STATUS_STYLES[current]} ${extraClass}">
            ${PAYMENT_STATUS_OPTIONS.map(([value, label]) => `
                <option value="${value}" ${value === current ? 'selected' : ''}>${label}</option>
            `).join('')}
        </select>
    `;
}

function quickActionButton(order, { compact = false } = {}) {
    const next = NEXT_STATUS[order.status];
    if (!next) return '';

    const busy = state.busy.has(keyOf(order.order_id));

    return `
        <button type="button" data-action="set-status"
                data-id="${escapeAttribute(order.order_id)}" data-to="${next.to}"
                ${busy ? 'disabled' : ''}
                class="inline-flex items-center justify-center gap-1.5 ${compact ? 'px-3 h-9' : 'px-3.5 h-9'}
                       rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-xs font-semibold
                       transition active:scale-[0.98] disabled:opacity-60 disabled:cursor-wait whitespace-nowrap"
                title="Ubah status ke ${escapeAttribute(STATUS_META[next.to].label)}">
            <i class="fa-solid ${busy ? 'fa-spinner fa-spin' : next.icon} text-[11px]"></i>
            ${busy ? 'Menyimpan' : escapeHTML(next.label)}
        </button>
    `;
}

function whatsappButton(order, className = '') {
    const href = buildWhatsAppLink(order);
    if (!href) return '';

    return `
        <a href="${escapeAttribute(href)}" target="_blank" rel="noopener noreferrer"
           class="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600
                  hover:bg-emerald-100 transition ${className}"
           title="Chat WhatsApp pelanggan">
            <i class="fa-brands fa-whatsapp text-base"></i>
        </a>
    `;
}

function renderOrderRow(order) {

    const id = escapeAttribute(order.order_id);
    const fresh = isFreshOrder(order);
    const count = itemCount(order);

    return `
        <tr data-action="detail" data-id="${id}"
            class="cursor-pointer transition ${fresh ? 'bg-blue-50/40 hover:bg-blue-50' : 'hover:bg-slate-50'}">

            <!-- PESANAN -->
            <td class="px-4 py-3 align-top">
                <div class="flex items-center gap-2">
                    <span class="font-bold text-slate-900">${escapeHTML(order.order_id || '-')}</span>
                    ${fresh ? '<span class="px-1.5 py-0.5 rounded-md bg-blue-500 text-white text-[9px] font-bold uppercase tracking-wide">Baru</span>' : ''}
                </div>
                <div class="text-[11px] text-slate-400 mt-1 max-w-[220px] truncate" title="${escapeAttribute(itemsSummary(order))}">
                    ${count} item${order.items.length ? ` · ${escapeHTML(itemsSummary(order))}` : ''}
                </div>
            </td>

            <!-- PEMESAN -->
            <td class="px-4 py-3 align-top">
                <div class="font-semibold text-slate-800">${escapeHTML(order.customer_name)}</div>
                <div class="text-xs text-slate-400 mt-0.5">${escapeHTML(order.phone)}</div>
                ${order.address && order.address !== '-' ? `
                    <div class="text-[11px] text-slate-400 mt-1 max-w-[230px] truncate" title="${escapeAttribute(order.address)}">
                        <i class="fa-solid fa-location-dot mr-1"></i>${escapeHTML(order.address)}
                    </div>
                ` : ''}
            </td>

            <!-- PEMBAYARAN -->
            <td class="px-4 py-3 align-top">
                <div class="text-xs font-medium text-slate-600 mb-1">${escapeHTML(order.payment_method)}</div>
                ${paymentStatusSelect(order)}
                <div class="mt-1.5">
                    ${hasPaymentProof(order) ? `
                        <button type="button" data-action="proof" data-id="${id}"
                                class="text-[11px] text-brand-600 hover:text-brand-700 font-semibold">
                            <i class="fa-solid fa-image mr-1"></i>Lihat bukti
                        </button>
                    ` : '<span class="text-[11px] text-slate-400">Tidak ada bukti</span>'}
                </div>
            </td>

            <!-- TOTAL -->
            <td class="px-4 py-3 align-top text-right">
                <div class="font-bold text-slate-900 whitespace-nowrap">Rp ${formatRupiah(order.grand_total)}</div>
            </td>

            <!-- STATUS -->
            <td class="px-4 py-3 align-top">
                ${statusBadge(order.status)}
                ${order.stock_restored ? `
                    <div class="mt-1.5 text-[10px] font-semibold text-emerald-600">
                        <i class="fa-solid fa-rotate-left"></i> Stok dikembalikan
                    </div>
                ` : ''}
            </td>

            <!-- WAKTU -->
            <td class="px-4 py-3 align-top" title="${escapeAttribute(formatFullDate(order.created_at))}">
                <div class="text-xs font-medium text-slate-700 whitespace-nowrap">${escapeHTML(relativeTime(order.created_at))}</div>
                <div class="text-[11px] text-slate-400 whitespace-nowrap">
                    ${formatDate(order.created_at)} · ${formatTime(order.created_at)}
                </div>
            </td>

            <!-- AKSI -->
            <td class="px-4 py-3 align-top">
                <div class="flex items-center justify-end gap-1.5">
                    ${quickActionButton(order)}
                    ${whatsappButton(order)}
                    <button type="button" data-action="detail" data-id="${id}"
                            class="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-slate-100 hover:bg-brand-50 hover:text-brand-600 text-slate-600 transition"
                            title="Detail">
                        <i class="fa-solid fa-chevron-right text-xs"></i>
                    </button>
                </div>
            </td>
        </tr>
    `;
}

function renderOrderCard(order) {

    const id = escapeAttribute(order.order_id);
    const fresh = isFreshOrder(order);

    return `
        <div data-card data-action="detail" data-id="${id}"
             class="p-4 cursor-pointer active:bg-slate-50 ${fresh ? 'bg-blue-50/40' : ''}">

            <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                    <div class="flex items-center gap-2">
                        <span class="font-bold text-slate-900 truncate">${escapeHTML(order.order_id || '-')}</span>
                        ${fresh ? '<span class="px-1.5 py-0.5 rounded-md bg-blue-500 text-white text-[9px] font-bold uppercase">Baru</span>' : ''}
                    </div>
                    <p class="text-[11px] text-slate-400 mt-0.5">${escapeHTML(relativeTime(order.created_at))} · ${formatTime(order.created_at)} WIB</p>
                </div>
                ${statusBadge(order.status, 'shrink-0')}
            </div>

            <div class="mt-2.5">
                <p class="text-sm font-semibold text-slate-800">${escapeHTML(order.customer_name)}
                    <span class="font-normal text-slate-400 text-xs">· ${escapeHTML(order.phone)}</span>
                </p>
                ${order.items.length ? `
                    <p class="text-xs text-slate-500 mt-0.5 line-clamp-2">${escapeHTML(itemsSummary(order))}</p>
                ` : ''}
            </div>

            <div class="mt-3 flex items-center justify-between gap-2">
                <div class="min-w-0">
                    <p class="font-bold text-slate-900">Rp ${formatRupiah(order.grand_total)}</p>
                    <div class="mt-1 flex items-center gap-2">
                        ${paymentStatusSelect(order)}
                        ${hasPaymentProof(order) ? `
                            <button type="button" data-action="proof" data-id="${id}"
                                    class="text-brand-600 text-xs" title="Lihat bukti">
                                <i class="fa-solid fa-image"></i>
                            </button>
                        ` : ''}
                    </div>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                    ${whatsappButton(order)}
                    ${quickActionButton(order, { compact: true })}
                </div>
            </div>
        </div>
    `;
}


/* =========================================================
   PAGINATION
========================================================= */

function renderPagination(total, totalPages, start, end) {

    const info = $('paginationInfo');
    const pagination = $('pagination');

    if (!pagination) return;

    if (info) {
        info.textContent = total === 0 ? '' : `${start + 1}–${end} dari ${total}`;
    }

    if (totalPages <= 1) {
        pagination.innerHTML = '';
        return;
    }

    const navButton = (page, icon, disabled, label) => `
        <button type="button" data-action="page" data-page="${page}" ${disabled ? 'disabled' : ''}
                aria-label="${label}"
                class="w-9 h-9 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100
                       disabled:opacity-40 disabled:cursor-not-allowed">
            <i class="fa-solid ${icon} text-xs"></i>
        </button>
    `;

    const pages = getPaginationPages(state.currentPage, totalPages).map(page => {
        if (page === '...') {
            return '<span class="w-9 h-9 flex items-center justify-center text-slate-400">…</span>';
        }

        const active = page === state.currentPage;

        return `
            <button type="button" data-action="page" data-page="${page}" ${active ? 'aria-current="page"' : ''}
                    class="w-9 h-9 rounded-lg border text-sm font-semibold transition
                           ${active ? 'bg-brand-500 text-white border-brand-500' : 'border-slate-200 text-slate-600 hover:bg-slate-100'}">
                ${page}
            </button>
        `;
    }).join('');

    pagination.innerHTML = `
        ${navButton(state.currentPage - 1, 'fa-chevron-left', state.currentPage === 1, 'Halaman sebelumnya')}
        <div class="hidden sm:flex items-center gap-1">${pages}</div>
        <span class="sm:hidden px-3 text-xs font-semibold text-slate-600">${state.currentPage} / ${totalPages}</span>
        ${navButton(state.currentPage + 1, 'fa-chevron-right', state.currentPage === totalPages, 'Halaman berikutnya')}
    `;
}

window.goToPage = function(page) {

    const totalPages = Math.max(1, Math.ceil(state.filteredOrders.length / state.pageSize));
    const target = Number(page);

    if (!Number.isFinite(target) || target < 1 || target > totalPages) return;

    state.currentPage = target;
    renderTable();

    $('orderTableBody')?.closest('section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

function getPaginationPages(current, total) {

    if (total <= 7) {
        return Array.from({ length: total }, (_, i) => i + 1);
    }

    const pages = [1];

    if (current > 4) pages.push('...');

    const start = Math.max(2, current - 1);
    const end = Math.min(total - 1, current + 1);

    for (let i = start; i <= end; i++) pages.push(i);

    if (current < total - 3) pages.push('...');

    pages.push(total);

    return pages;
}


/* =========================================================
   FILTER STATE (chips)
========================================================= */

function renderFilterState() {

    const button = $('clearFilterBtn');
    const chipsEl = $('activeFilters');

    const chips = [];

    if (state.search) chips.push(['search', `Cari: "${state.search}"`]);
    if (state.status !== 'all') chips.push(['status', `Status: ${STATUS_META[state.status]?.label || state.status}`]);
    if (state.payment !== 'all') chips.push(['payment', `Bayar: ${PAYMENT_STATUS_LABEL[state.payment]}`]);
    if (state.date !== 'all') chips.push(['date', `Waktu: ${DATE_FILTER_LABEL[state.date]}`]);

    button?.classList.toggle('hidden', chips.length === 0);

    if (!chipsEl) return;

    chipsEl.classList.toggle('hidden', chips.length === 0);
    chipsEl.innerHTML = chips.map(([key, label]) => `
        <button type="button" data-action="clear-chip" data-chip="${key}"
                class="inline-flex items-center gap-1.5 pl-3 pr-2 py-1 rounded-full bg-brand-50 text-brand-700
                       border border-brand-100 text-xs font-semibold hover:bg-brand-100"
                title="Hapus filter">
            ${escapeHTML(label)}
            <i class="fa-solid fa-xmark text-[10px]"></i>
        </button>
    `).join('');
}


/* =========================================================
   DETAIL DRAWER
========================================================= */

window.showOrderDetail = function(orderId) {

    const order = findOrder(orderId);

    if (!order) {
        showToast('Pesanan tidak ditemukan.', 'error');
        return;
    }

    state.selectedId = order.order_id;
    renderDetail(order);
    openModal('detailModal');
};

function renderDetail(order) {
    const title = $('detailOrderId');
    const content = $('detailContent');
    const footer = $('detailFooter');

    if (title) title.textContent = order.order_id || '-';
    if (content) content.innerHTML = renderDetailContent(order);
    if (footer) footer.innerHTML = renderDetailFooter(order);
}

function refreshOpenModals() {
    if (state.selectedId && isModalOpen('detailModal')) {
        const order = findOrder(state.selectedId);
        if (order) {
            const scroller = $('detailContent');
            const scrollTop = scroller?.scrollTop || 0;
            renderDetail(order);
            if (scroller) scroller.scrollTop = scrollTop;
        } else {
            closeModal('detailModal');
        }
    }

    if (state.proofId && isModalOpen('proofModal')) {
        const order = findOrder(state.proofId);
        const content = $('proofContent');
        if (order && content) content.innerHTML = renderProofModal(order);
    }
}

function renderStepper(order) {

    if (order.status === 'cancel') {
        return `
            <div class="flex items-start gap-3 rounded-2xl bg-red-50 border border-red-100 p-4">
                <div class="w-10 h-10 rounded-xl bg-red-100 text-red-600 flex items-center justify-center shrink-0">
                    <i class="fa-solid fa-ban"></i>
                </div>
                <div>
                    <p class="font-semibold text-red-700">Pesanan dibatalkan</p>
                    <p class="text-xs text-red-600/80 mt-0.5">
                        ${order.stock_restored
                            ? 'Stok produk sudah dikembalikan.'
                            : 'Stok produk belum tercatat dikembalikan.'}
                    </p>
                </div>
            </div>
        `;
    }

    const currentIndex = Math.max(0, STATUS_FLOW.indexOf(order.status));

    return `
        <ol class="flex items-start">
            ${STATUS_FLOW.map((status, index) => {
                const meta = STATUS_META[status];
                const done = index < currentIndex || (index === currentIndex && status === 'selesai');
                const current = index === currentIndex && !done;

                const circle = done
                    ? 'bg-brand-500 text-white'
                    : current
                        ? 'bg-white text-brand-600 ring-2 ring-brand-500'
                        : 'bg-slate-100 text-slate-400';

                const line = index < currentIndex ? 'bg-brand-500' : 'bg-slate-200';

                return `
                    <li class="flex-1 flex flex-col items-center text-center relative">
                        ${index > 0 ? `<span class="absolute top-[18px] right-1/2 w-full h-0.5 ${line}"></span>` : ''}
                        <span class="relative z-10 w-9 h-9 rounded-full flex items-center justify-center text-xs ${circle}">
                            <i class="fa-solid ${done ? 'fa-check' : meta.icon}"></i>
                        </span>
                        <span class="mt-1.5 text-[11px] font-semibold ${current || done ? 'text-slate-800' : 'text-slate-400'}">
                            ${meta.label}
                        </span>
                    </li>
                `;
            }).join('')}
        </ol>
    `;
}

function sectionTitle(icon, label, extra = '') {
    return `
        <div class="flex items-center justify-between mb-2.5">
            <h3 class="text-xs uppercase tracking-wide font-bold text-slate-500">
                <i class="fa-solid ${icon} mr-1.5 text-slate-400"></i>${escapeHTML(label)}
            </h3>
            ${extra}
        </div>
    `;
}

function iconButton({ action = '', attrs = '', icon, title, href = '' }) {
    const cls = 'inline-flex items-center justify-center w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-brand-600 hover:border-brand-200 transition';

    if (href) {
        return `<a href="${escapeAttribute(href)}" target="_blank" rel="noopener noreferrer" class="${cls}" title="${escapeAttribute(title)}"><i class="${icon} text-xs"></i></a>`;
    }

    return `<button type="button" data-action="${action}" ${attrs} class="${cls}" title="${escapeAttribute(title)}"><i class="${icon} text-xs"></i></button>`;
}

function renderDetailContent(order) {

    const id = escapeAttribute(order.order_id);
    const items = order.items.map(normalizeItem);
    const itemsTotal = items.reduce((sum, item) => sum + item.subtotal, 0);
    const adjustment = order.grand_total - itemsTotal;
    const waLink = buildWhatsAppLink(order);
    const hasAddress = order.address && order.address !== '-';
    const mapsLink = hasAddress
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.address)}`
        : '';

    const itemsHTML = items.length
        ? items.map(item => `
            <div class="flex items-start justify-between gap-3 py-3 border-b border-slate-100 last:border-none">
                <div class="flex items-start gap-3 min-w-0">
                    <span class="shrink-0 min-w-[32px] h-7 px-1.5 rounded-lg bg-brand-50 text-brand-600 text-xs font-bold flex items-center justify-center">
                        ${item.qty}×
                    </span>
                    <div class="min-w-0">
                        <p class="font-semibold text-slate-800 text-sm">${escapeHTML(item.name)}</p>
                        ${item.variant ? `<p class="text-[11px] text-slate-500">${escapeHTML(item.variant)}</p>` : ''}
                        ${item.note ? `<p class="text-[11px] text-amber-600 italic">“${escapeHTML(item.note)}”</p>` : ''}
                        <p class="text-[11px] text-slate-400">@ Rp ${formatRupiah(item.price)}</p>
                    </div>
                </div>
                <p class="font-semibold text-slate-800 text-sm whitespace-nowrap">Rp ${formatRupiah(item.subtotal)}</p>
            </div>
        `).join('')
        : '<div class="py-5 text-center text-sm text-slate-400">Tidak ada rincian item.</div>';

    return `
        <div class="p-5 space-y-6">

            <!-- STATUS -->
            <section>
                <div class="flex flex-wrap items-center gap-2 mb-4">
                    ${statusBadge(order.status)}
                    <span class="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold border ${PAYMENT_STATUS_STYLES[order.payment_status]}">
                        ${escapeHTML(PAYMENT_STATUS_LABEL[order.payment_status])}
                    </span>
                    <span class="text-[11px] text-slate-400 ml-auto">
                        ${escapeHTML(formatFullDate(order.created_at))}
                    </span>
                </div>
                ${renderStepper(order)}
            </section>

            <!-- PELANGGAN -->
            <section>
                ${sectionTitle('fa-user', 'Pelanggan')}
                <div class="rounded-2xl border border-slate-200 divide-y divide-slate-100">
                    <div class="p-3.5">
                        <p class="text-[11px] text-slate-400">Nama</p>
                        <p class="font-semibold text-slate-800">${escapeHTML(order.customer_name)}</p>
                    </div>
                    <div class="p-3.5 flex items-center justify-between gap-3">
                        <div class="min-w-0">
                            <p class="text-[11px] text-slate-400">WhatsApp</p>
                            <p class="font-semibold text-slate-800">${escapeHTML(order.phone)}</p>
                        </div>
                        <div class="flex gap-1.5 shrink-0">
                            ${iconButton({ action: 'copy', attrs: `data-copy="${escapeAttribute(order.phone)}" data-label="Nomor WhatsApp"`, icon: 'fa-regular fa-copy', title: 'Salin nomor' })}
                            ${waLink ? iconButton({ href: waLink, icon: 'fa-brands fa-whatsapp', title: 'Chat WhatsApp' }) : ''}
                        </div>
                    </div>
                    <div class="p-3.5 flex items-start justify-between gap-3">
                        <div class="min-w-0">
                            <p class="text-[11px] text-slate-400">Alamat</p>
                            <p class="text-sm font-medium text-slate-800 break-words">${escapeHTML(order.address)}</p>
                        </div>
                        ${hasAddress ? `
                            <div class="flex gap-1.5 shrink-0">
                                ${iconButton({ action: 'copy', attrs: `data-copy="${escapeAttribute(order.address)}" data-label="Alamat"`, icon: 'fa-regular fa-copy', title: 'Salin alamat' })}
                                ${iconButton({ href: mapsLink, icon: 'fa-solid fa-map-location-dot', title: 'Buka di Google Maps' })}
                            </div>
                        ` : ''}
                    </div>
                </div>
            </section>

            <!-- ITEM -->
            <section>
                ${sectionTitle('fa-bag-shopping', 'Rincian Pesanan', `<span class="text-[11px] text-slate-400">${itemCount(order)} item</span>`)}
                <div class="rounded-2xl border border-slate-200 px-4">
                    ${itemsHTML}
                </div>

                ${order.notes ? `
                    <div class="mt-3 rounded-xl bg-amber-50 border border-amber-100 px-3.5 py-2.5 text-sm text-amber-800">
                        <i class="fa-solid fa-note-sticky mr-1.5"></i>${escapeHTML(order.notes)}
                    </div>
                ` : ''}

                <div class="mt-3 rounded-2xl bg-slate-50 border border-slate-100 p-4 space-y-1.5 text-sm">
                    ${items.length && adjustment !== 0 ? `
                        <div class="flex justify-between text-slate-500">
                            <span>Subtotal item</span><span>Rp ${formatRupiah(itemsTotal)}</span>
                        </div>
                        <div class="flex justify-between text-slate-500">
                            <span>${adjustment > 0 ? 'Ongkir / biaya lain' : 'Diskon / potongan'}</span>
                            <span>${adjustment > 0 ? '' : '−'}Rp ${formatRupiah(Math.abs(adjustment))}</span>
                        </div>
                        <div class="border-t border-slate-200 my-2"></div>
                    ` : ''}
                    <div class="flex items-center justify-between">
                        <span class="font-semibold text-slate-700">Total Pembayaran</span>
                        <span class="font-bold text-xl text-brand-600">Rp ${formatRupiah(order.grand_total)}</span>
                    </div>
                </div>
            </section>

            <!-- PEMBAYARAN -->
            <section>
                ${sectionTitle('fa-credit-card', 'Pembayaran')}
                <div class="rounded-2xl border border-slate-200 p-3.5 flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <p class="text-[11px] text-slate-400">Metode</p>
                        <p class="font-semibold text-slate-800">${escapeHTML(order.payment_method)}</p>
                    </div>
                    <div class="text-right">
                        <p class="text-[11px] text-slate-400 mb-1">Status pembayaran</p>
                        ${paymentStatusSelect(order, 'text-xs py-1.5')}
                    </div>
                </div>
                <div class="mt-3">
                    ${renderProofPreview(order)}
                </div>
            </section>

            <!-- UBAH STATUS MANUAL -->
            <section>
                <details class="group rounded-2xl border border-slate-200">
                    <summary class="list-none cursor-pointer px-4 py-3 flex items-center justify-between text-sm font-semibold text-slate-700">
                        <span><i class="fa-solid fa-sliders mr-2 text-slate-400"></i>Ubah status manual</span>
                        <i class="fa-solid fa-chevron-down text-xs text-slate-400 transition group-open:rotate-180"></i>
                    </summary>
                    <div class="px-4 pb-4 grid grid-cols-2 sm:grid-cols-3 gap-2">
                        ${Object.entries(STATUS_META).map(([value, meta]) => {
                            const current = value === order.status;
                            return `
                                <button type="button" data-action="set-status" data-id="${id}" data-to="${value}"
                                        ${current ? 'disabled' : ''}
                                        class="inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-semibold transition
                                               ${current
                                                    ? 'border-brand-500 bg-brand-50 text-brand-700 cursor-default'
                                                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'}">
                                    <span class="w-2 h-2 rounded-full ${meta.dot}"></span>
                                    ${meta.label}
                                    ${current ? '<i class="fa-solid fa-check text-[10px]"></i>' : ''}
                                </button>
                            `;
                        }).join('')}
                    </div>
                </details>
            </section>

        </div>
    `;
}

function renderDetailFooter(order) {

    const id = escapeAttribute(order.order_id);
    const next = NEXT_STATUS[order.status];
    const busy = state.busy.has(keyOf(order.order_id));
    const waLink = buildWhatsAppLink(order);

    const secondary = `
        <div class="flex items-center gap-2">
            ${waLink ? `
                <a href="${escapeAttribute(waLink)}" target="_blank" rel="noopener noreferrer"
                   class="inline-flex items-center gap-2 h-11 px-4 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-sm font-semibold"
                   title="Kirim pesan WhatsApp sesuai status">
                    <i class="fa-brands fa-whatsapp text-base"></i><span class="hidden sm:inline">WhatsApp</span>
                </a>
            ` : ''}
            <button type="button" data-action="copy-summary" data-id="${id}"
                    class="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600"
                    title="Salin ringkasan pesanan">
                <i class="fa-regular fa-copy"></i>
            </button>
            ${order.status !== 'cancel' && order.status !== 'selesai' ? `
                <button type="button" data-action="set-status" data-id="${id}" data-to="cancel" ${busy ? 'disabled' : ''}
                        class="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 disabled:opacity-50"
                        title="Batalkan pesanan">
                    <i class="fa-solid fa-ban"></i>
                </button>
            ` : ''}
        </div>
    `;

    const primary = next
        ? `
            <button type="button" data-action="set-status" data-id="${id}" data-to="${next.to}" ${busy ? 'disabled' : ''}
                    class="flex-1 inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl bg-brand-500 hover:bg-brand-600
                           text-white text-sm font-semibold transition active:scale-[0.99] disabled:opacity-60 disabled:cursor-wait">
                <i class="fa-solid ${busy ? 'fa-spinner fa-spin' : next.icon}"></i>
                ${busy ? 'Menyimpan...' : escapeHTML(next.long)}
            </button>
        `
        : `
            <div class="flex-1 text-right text-xs font-semibold ${order.status === 'cancel' ? 'text-red-500' : 'text-emerald-600'}">
                <i class="fa-solid ${order.status === 'cancel' ? 'fa-ban' : 'fa-circle-check'} mr-1"></i>
                ${order.status === 'cancel' ? 'Pesanan dibatalkan' : 'Pesanan selesai'}
            </div>
        `;

    return `<div class="flex items-center gap-2">${secondary}${primary}</div>`;
}


/* =========================================================
   UPDATE STATUS PESANAN
========================================================= */

async function changeOrderStatus(orderId, targetStatus) {

    const order = findOrder(orderId);

    if (!order) {
        showToast('Pesanan tidak ditemukan.', 'error');
        return;
    }

    const key = keyOf(order.order_id);
    if (state.busy.has(key)) return;

    const newStatus = normalizeStatus(targetStatus);
    const oldStatus = normalizeStatus(order.status);

    if (!STATUS_META[newStatus]) return;

    if (newStatus === oldStatus) {
        showToast('Status tidak berubah.', 'info');
        return;
    }

    const orderLabel = `<b class="text-slate-700">${escapeHTML(order.order_id)}</b>`;

    let confirmed = true;

    if (newStatus === 'cancel') {
        confirmed = await confirmDialog({
            title: 'Batalkan pesanan?',
            message: `Pesanan ${orderLabel} atas nama ${escapeHTML(order.customer_name)} akan dibatalkan dan stok produk dikembalikan.`,
            confirmText: 'Ya, batalkan',
            cancelText: 'Kembali',
            tone: 'danger'
        });
    } else if (oldStatus === 'cancel') {
        confirmed = await confirmDialog({
            title: 'Aktifkan kembali pesanan?',
            message: `Pesanan ${orderLabel} yang sudah dibatalkan akan diubah ke <b>${STATUS_META[newStatus].label}</b>. Pastikan stok produk masih tersedia.`,
            confirmText: 'Aktifkan',
            tone: 'warning'
        });
    } else if (oldStatus === 'selesai') {
        confirmed = await confirmDialog({
            title: 'Ubah pesanan yang sudah selesai?',
            message: `Status pesanan ${orderLabel} akan dikembalikan ke <b>${STATUS_META[newStatus].label}</b>.`,
            confirmText: 'Ubah status',
            tone: 'warning'
        });
    }

    if (!confirmed) return;

    state.busy.add(key);
    renderTable();
    refreshOpenModals();

    let stockRestored = order.stock_restored;

    try {
        await authReady;

        // Ubah status + kembalikan/kurangi stok dalam satu transaksi database
        const { data, error } = await supabase.rpc('update_order_status', {
            p_key: String(order.order_id),
            p_status: newStatus
        });

        if (error) throw error;

        stockRestored = Boolean(data?.stock_restored);

    } catch (error) {
        console.error('[MANAGE ORDER] Update error:', error);
        state.busy.delete(key);
        renderTable();
        refreshOpenModals();
        showToast(error?.message || 'Gagal mengubah status pesanan.', 'error');
        return;
    }

    state.busy.delete(key);

    updateLocalOrder(order.order_id, { status: newStatus, stock_restored: stockRestored });

    order.status = newStatus;
    order.stock_restored = stockRestored;

    applyFilters();
    refreshOpenModals();

    showToast(
        newStatus === 'cancel'
            ? `${order.order_id} dibatalkan, stok dikembalikan.`
            : `${order.order_id} → ${STATUS_META[newStatus].label}`,
        'success'
    );
}

/* Kompatibilitas dengan kode lama */
window.updateOrderStatus = async function(orderId, status) {
    const id = orderId || state.selectedId;
    if (!id) return;
    return changeOrderStatus(id, status);
};

window.changeOrderStatus = changeOrderStatus;


/* =========================================================
   UPDATE STATUS PEMBAYARAN
========================================================= */

window.updatePaymentStatus = async function(orderId, value, selectEl = null) {

    const newStatus = normalizePaymentStatus(value);
    const order = findOrder(orderId);

    if (!order) {
        showToast('Pesanan tidak ditemukan.', 'error');
        return;
    }

    const busyKey = `pay:${keyOf(order.order_id)}`;
    if (state.busy.has(busyKey)) return;

    if (newStatus === order.payment_status) {
        showToast('Status pembayaran tidak berubah.', 'info');
        return;
    }

    state.busy.add(busyKey);
    if (selectEl) selectEl.disabled = true;

    document
        .querySelectorAll(`[data-action="set-payment"][data-id="${cssEscape(order.order_id)}"]`)
        .forEach(btn => { btn.disabled = true; });

    try {
        await authReady;

        const { data, error } = await supabase
            .from('orders')
            .update({ payment_status: newStatus })
            .eq('order_id', order.order_id)
            .select('order_id');

        if (error) throw error;

        // RLS yang memblokir UPDATE tidak memberi error, hanya 0 baris berubah
        if (!data || data.length === 0) {
            throw new Error('Tidak ada baris yang berubah. Cek policy UPDATE (RLS) di tabel orders.');
        }

    } catch (error) {
        console.error('[MANAGE ORDER] Payment status error:', error);
        state.busy.delete(busyKey);
        showToast(error?.message || 'Gagal mengubah status pembayaran.', 'error');
        applyFilters(); // kembalikan dropdown ke nilai sebelumnya
        refreshOpenModals();
        return;
    }

    state.busy.delete(busyKey);
    order.payment_status = newStatus;

    updateLocalOrder(order.order_id, { payment_status: newStatus });

    applyFilters();
    refreshOpenModals();

    showToast(`Pembayaran ${order.order_id}: ${PAYMENT_STATUS_LABEL[newStatus]}`, 'success');
};

function updateLocalOrder(orderId, patch) {
    try {
        const localOrders = JSON.parse(localStorage.getItem(LOCAL_ORDERS_KEY) || '[]');
        if (!Array.isArray(localOrders)) return;

        const item = localOrders.find(o => keyOf(o?.order_id) === keyOf(orderId));
        if (item) {
            Object.assign(item, patch);
            localStorage.setItem(LOCAL_ORDERS_KEY, JSON.stringify(localOrders));
        }
    } catch (e) {
        console.warn('[MANAGE ORDER] Local sync error:', e);
    }
}


/* =========================================================
   BUKTI PEMBAYARAN
========================================================= */

window.showPaymentProof = function(orderId) {

    const order = findOrder(orderId);

    if (!order) {
        showToast('Pesanan tidak ditemukan.', 'error');
        return;
    }

    const title = $('proofOrderId');
    const content = $('proofContent');

    if (!content) return;

    state.proofId = order.order_id;

    if (title) {
        title.textContent = `${order.order_id} · ${order.customer_name}`;
    }

    content.innerHTML = renderProofModal(order);
    openModal('proofModal');
};

function getProofSrc(order) {
    const proof = String(order.payment_proof || '').trim();
    if (!proof) return '';
    if (isImageData(proof)) return proof;

    const url = safeURL(proof);
    return url === '#' ? '' : url;
}

function renderProofPreview(order) {

    if (!hasPaymentProof(order)) {
        return `
            <div class="rounded-2xl border border-dashed border-slate-200 p-6 text-center">
                <i class="fa-regular fa-image text-2xl text-slate-300"></i>
                <p class="text-sm font-medium text-slate-500 mt-2">Belum ada bukti pembayaran</p>
            </div>
        `;
    }

    const src = getProofSrc(order);

    return `
        <button type="button" data-action="proof" data-id="${escapeAttribute(order.order_id)}"
                class="group relative block w-full rounded-2xl overflow-hidden border border-slate-200 bg-slate-50">
            ${src ? `
                <img src="${escapeAttribute(src)}" alt="Bukti pembayaran ${escapeAttribute(order.order_id)}"
                     loading="lazy"
                     class="w-full max-h-64 object-contain group-hover:scale-[1.02] transition"
                     onerror="this.classList.add('hidden');this.nextElementSibling.classList.remove('hidden')">
            ` : ''}
            <div class="${src ? 'hidden' : ''} py-8 text-center text-slate-500 text-sm">
                <i class="fa-solid fa-file-lines text-2xl text-brand-500"></i>
                <p class="mt-2 font-medium">Bukti pembayaran tersedia</p>
            </div>
            <span class="absolute bottom-2 right-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900/70 text-white text-[11px] font-semibold">
                <i class="fa-solid fa-expand"></i> Perbesar
            </span>
        </button>
    `;
}

function renderProofModal(order) {

    if (!hasPaymentProof(order)) {
        return `
            <div class="text-center py-12 text-slate-400">
                <i class="fa-regular fa-image text-3xl mb-3"></i>
                <p class="font-medium">Tidak ada bukti pembayaran.</p>
            </div>
        `;
    }

    const src = getProofSrc(order);
    const isData = isImageData(src);
    const id = escapeAttribute(order.order_id);
    const busy = state.busy.has(`pay:${keyOf(order.order_id)}`);

    const verifyButton = (value, label, icon, cls) => {
        const current = order.payment_status === value;
        return `
            <button type="button" data-action="set-payment" data-id="${id}" data-value="${value}"
                    ${current || busy ? 'disabled' : ''}
                    class="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl text-sm font-semibold transition
                           disabled:opacity-50 disabled:cursor-not-allowed ${cls}">
                <i class="fa-solid ${icon}"></i>${label}${current ? ' ✓' : ''}
            </button>
        `;
    };

    return `
        <div class="w-full space-y-4">

            <div id="proofViewport"
                 class="relative bg-slate-900 rounded-2xl overflow-auto max-h-[60vh] min-h-[240px] flex items-center justify-center">
                ${src ? `
                    <img src="${escapeAttribute(src)}" alt="Bukti pembayaran"
                         data-action="toggle-zoom"
                         class="max-h-[58vh] w-auto max-w-full object-contain cursor-zoom-in select-none"
                         onerror="this.classList.add('hidden');this.nextElementSibling.classList.remove('hidden')">
                ` : ''}
                <div class="${src ? 'hidden' : ''} text-center text-slate-300 py-16 px-4">
                    <i class="fa-solid fa-file-circle-exclamation text-3xl"></i>
                    <p class="mt-2 text-sm">Pratinjau tidak tersedia. Buka file di tab baru.</p>
                </div>
                ${src ? '<span class="pointer-events-none absolute top-3 left-3 px-2 py-1 rounded-md bg-white/15 text-white text-[10px] font-semibold">Klik gambar untuk zoom</span>' : ''}
            </div>

            <div class="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-50 border border-slate-100 p-3.5">
                <div>
                    <p class="text-[11px] text-slate-400">Total tagihan · ${escapeHTML(order.payment_method)}</p>
                    <p class="font-bold text-lg text-slate-900">Rp ${formatRupiah(order.grand_total)}</p>
                </div>
                <div class="flex items-center gap-2">
                    ${src && !isData ? `
                        <a href="${escapeAttribute(src)}" target="_blank" rel="noopener noreferrer"
                           class="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-white border border-slate-200 text-slate-600 hover:text-brand-600"
                           title="Buka di tab baru">
                            <i class="fa-solid fa-up-right-from-square text-sm"></i>
                        </a>
                    ` : ''}
                    ${src ? `
                        <a href="${escapeAttribute(src)}" download="bukti-${id}"
                           class="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-white border border-slate-200 text-slate-600 hover:text-brand-600"
                           title="Unduh">
                            <i class="fa-solid fa-download text-sm"></i>
                        </a>
                    ` : ''}
                </div>
            </div>

            <div>
                <p class="text-xs font-semibold text-slate-500 mb-2">
                    Verifikasi pembayaran
                    <span class="ml-1 px-2 py-0.5 rounded-full border text-[10px] ${PAYMENT_STATUS_STYLES[order.payment_status]}">
                        ${escapeHTML(PAYMENT_STATUS_LABEL[order.payment_status])}
                    </span>
                </p>
                <div class="grid grid-cols-2 gap-2">
                    ${verifyButton('failed', 'Tolak', 'fa-xmark', 'bg-red-50 text-red-600 hover:bg-red-100')}
                    ${verifyButton('paid', 'Tandai Lunas', 'fa-check', 'bg-emerald-600 text-white hover:bg-emerald-700')}
                </div>
            </div>
        </div>
    `;
}

function toggleProofZoom(img) {
    const viewport = $('proofViewport');
    const zoomed = img.classList.toggle('is-zoomed');

    img.classList.toggle('max-h-[58vh]', !zoomed);
    img.classList.toggle('max-w-full', !zoomed);
    img.classList.toggle('max-w-none', zoomed);
    img.classList.toggle('cursor-zoom-in', !zoomed);
    img.classList.toggle('cursor-zoom-out', zoomed);

    if (viewport) {
        viewport.classList.toggle('flex', !zoomed);
        viewport.classList.toggle('block', zoomed);
    }
}

function hasPaymentProof(order) {
    const proof = String(order?.payment_proof || '').trim();
    if (!proof) return false;

    return ![
        'pending / cash',
        'pending',
        'cash',
        '-',
        'null',
        'undefined'
    ].includes(proof.toLowerCase());
}

function isImageData(value) {
    return String(value || '').trim().toLowerCase().startsWith('data:image/');
}


/* =========================================================
   WHATSAPP & COPY
========================================================= */

function toWhatsAppNumber(phone) {
    let digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return '';

    if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
    else if (digits.startsWith('8')) digits = `62${digits}`;

    return digits.length >= 10 ? digits : '';
}

function buildWhatsAppLink(order) {
    const number = toWhatsAppNumber(order.phone);
    if (!number) return '';

    const name = order.customer_name && order.customer_name !== '-' ? ` Kak ${order.customer_name}` : ' Kak';
    const id = `*${order.order_id}*`;
    const total = `Rp ${formatRupiah(order.grand_total)}`;

    const templates = {
        new: `Halo${name}, terima kasih sudah memesan di ${STORE_NAME} 🙏\n\nPesanan ${id} dengan total ${total} sudah kami terima dan akan segera kami proses.`,
        disiapkan: `Halo${name}, pesanan ${id} sedang kami siapkan ya 🍳\nTotal: ${total}.`,
        dikirim: `Halo${name}, pesanan ${id} sedang dalam perjalanan ke alamat Kakak 🛵\nMohon ditunggu ya!`,
        selesai: `Halo${name}, terima kasih! Pesanan ${id} sudah selesai. Semoga suka dan ditunggu pesanan berikutnya di ${STORE_NAME} 🧡`,
        cancel: `Halo${name}, mohon maaf pesanan ${id} terpaksa kami batalkan. Silakan balas pesan ini jika ada pertanyaan 🙏`
    };

    const text = templates[order.status] || `Halo${name}, terkait pesanan ${id} di ${STORE_NAME}.`;

    return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

function buildOrderSummary(order) {
    const lines = [
        `Pesanan ${order.order_id} — ${STORE_NAME}`,
        `Waktu: ${formatFullDate(order.created_at)}`,
        `Nama: ${order.customer_name}`,
        `WhatsApp: ${order.phone}`,
        `Alamat: ${order.address}`,
        '',
        ...order.items.map(item => {
            const i = normalizeItem(item);
            return `${i.qty}x ${i.name}${i.variant ? ` (${i.variant})` : ''} — Rp ${formatRupiah(i.subtotal)}`;
        }),
        '',
        `Total: Rp ${formatRupiah(order.grand_total)}`,
        `Pembayaran: ${order.payment_method} (${PAYMENT_STATUS_LABEL[order.payment_status]})`,
        `Status: ${STATUS_META[order.status]?.label || order.status}`
    ];

    if (order.notes) lines.push(`Catatan: ${order.notes}`);

    return lines.join('\n');
}

async function copyText(text, label = 'Teks') {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            const area = document.createElement('textarea');
            area.value = text;
            area.style.position = 'fixed';
            area.style.opacity = '0';
            document.body.appendChild(area);
            area.select();
            document.execCommand('copy');
            area.remove();
        }
        showToast(`${label} disalin.`, 'success');
    } catch {
        showToast('Gagal menyalin.', 'error');
    }
}


/* =========================================================
   EXPORT CSV
========================================================= */

function exportCSV() {

    if (state.filteredOrders.length === 0) {
        showToast('Tidak ada pesanan untuk diexport.', 'warning');
        return;
    }

    const header = [
        'ID Pesanan', 'Tanggal', 'Jam', 'Nama', 'WhatsApp', 'Alamat',
        'Item', 'Jumlah Item', 'Metode Bayar', 'Status Bayar', 'Status', 'Total'
    ];

    const rows = state.filteredOrders.map(o => [
        o.order_id,
        formatDate(o.created_at),
        formatTime(o.created_at),
        o.customer_name,
        o.phone,
        o.address,
        itemsSummary(o),
        itemCount(o),
        o.payment_method,
        PAYMENT_STATUS_LABEL[o.payment_status],
        STATUS_META[o.status]?.label || o.status,
        o.grand_total
    ]);

    const escapeCell = value => {
        const text = String(value ?? '');
        return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };

    // Pemisah ";" agar langsung rapi di Excel dengan regional Indonesia
    const csv = [header, ...rows].map(row => row.map(escapeCell).join(';')).join('\r\n');

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const stamp = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    const link = document.createElement('a');
    link.href = url;
    link.download = `pesanan-chimchum-${stamp}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);

    showToast(`${rows.length} pesanan diexport.`, 'success');
}


/* =========================================================
   MODAL
========================================================= */

function openModal(id) {
    const modal = $(id);
    if (!modal) return;

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.classList.add('overflow-hidden');

    requestAnimationFrame(() => {
        requestAnimationFrame(() => modal.classList.add('is-open'));
    });
}

function closeModal(id) {
    const modal = $(id);
    if (!modal || modal.classList.contains('hidden')) return;

    modal.classList.remove('is-open');

    if (id === 'detailModal') state.selectedId = null;
    if (id === 'proofModal') state.proofId = null;

    setTimeout(() => {
        if (!modal.classList.contains('is-open')) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
        if (!anyModalOpen()) {
            document.body.classList.remove('overflow-hidden');
        }
    }, 220);
}

function isModalOpen(id) {
    return Boolean($(id)?.classList.contains('is-open'));
}

function anyModalOpen() {
    return isModalOpen('detailModal') || isModalOpen('proofModal');
}

window.closeModal = closeModal;

window.closeAllModals = function() {
    closeModal('detailModal');
    closeModal('proofModal');
};


/* =========================================================
   CONFIRM DIALOG (pengganti confirm() bawaan browser)
   `message` boleh berisi HTML — pastikan data user sudah di-escape.
========================================================= */

function confirmDialog({
    title = 'Konfirmasi',
    message = '',
    confirmText = 'Lanjutkan',
    cancelText = 'Batal',
    tone = 'primary'
} = {}) {

    const tones = {
        primary: { btn: 'bg-brand-500 hover:bg-brand-600', icon: 'bg-brand-50 text-brand-600', ic: 'fa-circle-question' },
        warning: { btn: 'bg-amber-500 hover:bg-amber-600', icon: 'bg-amber-50 text-amber-600', ic: 'fa-circle-exclamation' },
        danger:  { btn: 'bg-red-600 hover:bg-red-700',     icon: 'bg-red-50 text-red-600',     ic: 'fa-triangle-exclamation' }
    };

    const t = tones[tone] || tones.primary;

    return new Promise(resolve => {

        const root = document.createElement('div');
        root.className = 'modal-root fixed inset-0 z-[90] modal-backdrop flex items-center justify-center p-4';
        root.innerHTML = `
            <div class="pop-panel bg-white rounded-3xl shadow-2xl w-full max-w-md p-6" role="alertdialog" aria-modal="true">
                <div class="flex gap-4">
                    <div class="w-12 h-12 rounded-2xl ${t.icon} flex items-center justify-center shrink-0">
                        <i class="fa-solid ${t.ic} text-lg"></i>
                    </div>
                    <div class="min-w-0">
                        <h3 class="font-bold text-slate-900">${escapeHTML(title)}</h3>
                        <div class="text-sm text-slate-500 mt-1 leading-relaxed">${message}</div>
                    </div>
                </div>
                <div class="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                    <button type="button" data-confirm="no"
                            class="h-11 px-5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold">
                        ${escapeHTML(cancelText)}
                    </button>
                    <button type="button" data-confirm="yes"
                            class="h-11 px-5 rounded-xl ${t.btn} text-white text-sm font-semibold">
                        ${escapeHTML(confirmText)}
                    </button>
                </div>
            </div>
        `;

        const previousFocus = document.activeElement;

        const done = value => {
            confirmOpen = false;
            document.removeEventListener('keydown', onKey, true);
            root.classList.remove('is-open');
            setTimeout(() => root.remove(), 180);
            previousFocus?.focus?.();
            resolve(value);
        };

        const onKey = event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                done(false);
            }
        };

        root.addEventListener('click', event => {
            if (event.target === root) return done(false);
            const btn = event.target.closest('[data-confirm]');
            if (btn) done(btn.dataset.confirm === 'yes');
        });

        document.body.appendChild(root);
        confirmOpen = true;
        document.addEventListener('keydown', onKey, true);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => root.classList.add('is-open'));
        });

        root.querySelector('[data-confirm="yes"]')?.focus();
    });
}


/* =========================================================
   TOAST
========================================================= */

function showToast(message, type = 'info') {

    let stack = $('toastStack');

    if (!stack) {
        stack = document.createElement('div');
        stack.id = 'toastStack';
        stack.className = 'fixed bottom-4 left-4 right-4 sm:left-auto sm:right-5 z-[100] flex flex-col items-stretch sm:items-end gap-2 pointer-events-none';
        document.body.appendChild(stack);
    }

    const styles = {
        success: ['fa-circle-check', 'text-emerald-500'],
        error:   ['fa-circle-xmark', 'text-red-500'],
        info:    ['fa-circle-info', 'text-blue-500'],
        warning: ['fa-triangle-exclamation', 'text-amber-500']
    };

    const [icon, color] = styles[type] || styles.info;

    const toast = document.createElement('div');
    toast.className = 'toast toast-enter pointer-events-auto flex items-start gap-3 sm:min-w-[280px] max-w-sm bg-white border border-slate-200 shadow-xl rounded-2xl px-4 py-3 text-sm text-slate-700';
    toast.innerHTML = `
        <i class="fa-solid ${icon} ${color} mt-0.5"></i>
        <span class="flex-1 font-medium">${escapeHTML(message)}</span>
        <button type="button" class="text-slate-300 hover:text-slate-500" aria-label="Tutup">
            <i class="fa-solid fa-xmark text-xs"></i>
        </button>
    `;

    const remove = () => {
        toast.classList.add('toast-enter');
        setTimeout(() => toast.remove(), 200);
    };

    toast.querySelector('button')?.addEventListener('click', remove);

    stack.appendChild(toast);
    while (stack.children.length > 3) stack.firstElementChild.remove();

    requestAnimationFrame(() => toast.classList.remove('toast-enter'));

    setTimeout(remove, type === 'error' ? 5000 : 3200);
}


/* =========================================================
   FORMAT
========================================================= */

function toTime(value) {
    if (!value) return 0;
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? 0 : time;
}

function startOfTodayWIB() {
    const ymd = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    return new Date(`${ymd}T00:00:00+07:00`).getTime();
}

function relativeTime(value) {
    const time = toTime(value);
    if (!time) return '-';

    const diff = Date.now() - time;
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;

    if (diff < minute) return 'Baru saja';
    if (diff < hour) return `${Math.floor(diff / minute)} menit lalu`;
    if (diff < day) return `${Math.floor(diff / hour)} jam lalu`;
    if (diff < 2 * day) return 'Kemarin';
    if (diff < 7 * day) return `${Math.floor(diff / day)} hari lalu`;

    return formatDate(value);
}

function formatDate(value) {
    if (!toTime(value)) return '-';

    return new Date(value).toLocaleDateString('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    });
}

function formatTime(value) {
    if (!toTime(value)) return '-';

    return new Date(value).toLocaleTimeString('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatFullDate(value) {
    if (!toTime(value)) return '-';

    return new Date(value).toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }) + ' WIB';
}

function formatRupiah(value) {
    return Number(value || 0).toLocaleString('id-ID');
}


/* =========================================================
   UTIL
========================================================= */

function debounce(fn, delay = 250) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

function escapeHTML(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function escapeAttribute(value) {
    return escapeHTML(value);
}

function cssEscape(value) {
    return window.CSS?.escape
        ? CSS.escape(String(value))
        : String(value).replace(/["\\]/g, '\\$&');
}

function safeURL(value) {
    const raw = String(value || '').trim();

    if (raw.toLowerCase().startsWith('data:image/')) return raw;

    try {
        const url = new URL(raw, window.location.origin);
        const protocol = url.protocol.toLowerCase();

        if (protocol !== 'http:' && protocol !== 'https:') return '#';

        return url.href;
    } catch {
        return '#';
    }
}


/* =========================================================
   DEBUG API
========================================================= */

window.manageOrderState = function() {
    return {
        ...state,
        knownIds: [...state.knownIds],
        freshIds: [...state.freshIds],
        busy: [...state.busy]
    };
};


/* =========================================================
   HAPUS BUKTI TRANSFER LAMA
========================================================= */

window.deleteOldPaymentProofs = deleteOldPaymentProofs;

async function deleteOldPaymentProofs() {

    const button = $('deleteOldProofsBtn');
    const label = button?.querySelector('[data-label]');
    const originalLabel = label?.innerHTML;

    const setLabel = html => { if (label) label.innerHTML = html; };

    try {
        await authReady;

        const { data: orders, error } = await supabase
            .from('orders')
            .select('id, order_id, status, created_at, payment_proof')
            .order('created_at', { ascending: true });

        if (error) throw error;

        const cutoffDate = new Date(Date.now() - DELETE_AFTER_DAYS * 24 * 60 * 60 * 1000);

        /*
         * Syarat: status = selesai, umur > 30 hari, payment_proof tersedia
         */
        const eligibleOrders = (orders || []).filter(order => {
            const createdAt = new Date(order.created_at);

            return (
                normalizeStatus(order.status) === 'selesai' &&
                !Number.isNaN(createdAt.getTime()) &&
                createdAt < cutoffDate &&
                hasPaymentProof(order)
            );
        });

        if (eligibleOrders.length === 0) {
            showToast('Tidak ada bukti transfer >30 hari yang memenuhi syarat.', 'info');
            return;
        }

        const confirmed = await confirmDialog({
            title: `Hapus ${eligibleOrders.length} bukti transfer?`,
            message: `
                <p>File akan <b class="text-red-600">dihapus permanen</b> dari Storage untuk pesanan yang:</p>
                <ul class="mt-2 space-y-1 text-xs">
                    <li><i class="fa-solid fa-check text-emerald-500 mr-1.5"></i>Berstatus <b>Selesai</b></li>
                    <li><i class="fa-solid fa-check text-emerald-500 mr-1.5"></i>Berumur lebih dari ${DELETE_AFTER_DAYS} hari</li>
                    <li><i class="fa-solid fa-check text-emerald-500 mr-1.5"></i>Memiliki bukti pembayaran</li>
                </ul>
            `,
            confirmText: 'Hapus permanen',
            tone: 'danger'
        });

        if (!confirmed) return;

        if (button) button.disabled = true;

        let successCount = 0;
        let failedCount = 0;
        const failedOrders = [];

        for (const [index, order] of eligibleOrders.entries()) {

            setLabel(`<i class="fa-solid fa-spinner fa-spin mr-1"></i> Menghapus ${index + 1}/${eligibleOrders.length}...`);

            try {
                const storagePath = getStoragePath(order.payment_proof, PAYMENT_PROOF_BUCKET);

                if (!storagePath) {
                    failedCount++;
                    failedOrders.push({ order_id: order.order_id, reason: 'Storage path tidak ditemukan' });
                    continue;
                }

                const { error: storageError } = await supabase
                    .storage
                    .from(PAYMENT_PROOF_BUCKET)
                    .remove([storagePath]);

                if (storageError) throw storageError;

                const { error: updateError } = await supabase
                    .from('orders')
                    .update({ payment_proof: null })
                    .eq('id', order.id);

                if (updateError) throw updateError;

                successCount++;

            } catch (error) {
                failedCount++;
                failedOrders.push({ order_id: order.order_id, reason: error?.message || 'Unknown error' });
                console.error('[DELETE PROOF] FAILED:', order.order_id, error);
            }
        }

        await loadOrders();

        let message = `${successCount} bukti transfer berhasil dihapus.`;
        if (failedCount > 0) message += ` ${failedCount} gagal (lihat console).`;

        showToast(message, failedCount > 0 ? 'warning' : 'success');

        if (failedOrders.length > 0) console.table(failedOrders);

    } catch (error) {
        console.error('[DELETE PROOF] ERROR:', error);
        showToast(error?.message || 'Gagal menghapus bukti transfer.', 'error');

    } finally {
        if (button) button.disabled = false;
        if (originalLabel) setLabel(originalLabel);
    }
}


/* =========================================================
   GET STORAGE PATH
========================================================= */

function getStoragePath(value, bucketName) {

    if (!value) return null;

    const raw = String(value).trim();
    if (!raw) return null;

    /* Data URI bukan file Storage */
    if (raw.toLowerCase().startsWith('data:image/')) return null;

    /* Database menyimpan path langsung, mis. ORD-123.jpg atau 2026/09/ORD-123.jpg */
    if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
        return raw.replace(/^\/+/, '');
    }

    try {
        const url = new URL(raw);
        const pathname = decodeURIComponent(url.pathname);
        const marker = '/storage/v1/object/';
        const markerIndex = pathname.indexOf(marker);

        if (markerIndex === -1) return null;

        let afterMarker = pathname.substring(markerIndex + marker.length);

        /* Hilangkan public/ sign/ authenticated/ */
        afterMarker = afterMarker.replace(/^(public|sign|authenticated)\//, '');

        if (!afterMarker.startsWith(`${bucketName}/`)) return null;

        return afterMarker.substring(bucketName.length + 1);

    } catch (error) {
        console.error('[DELETE PROOF] Invalid URL:', error);
        return null;
    }
}
