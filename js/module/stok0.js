import { supabase, authReady } from '../supabase.js';

// =========================================================
// KONFIGURASI
// =========================================================
const LOW_STOCK_MAX = 10;          // 1..10 = menipis
const BAR_FULL_AT = LOW_STOCK_MAX * 3; // stok >= nilai ini = bar penuh
const SEARCH_DEBOUNCE_MS = 250;
const SAVE_DEBOUNCE_MS = 600;      // klik +/- beruntun digabung jadi 1 request
const NOTE_VISIBLE_MS = 2000;      // lama label "Tersimpan"/"Gagal" tampil
const PAGE_SIZES = [5, 10, 25, 50];
const DEFAULT_PAGE_SIZE = 10;
const PREFS_KEY = 'chimchum:stok:prefs';

// true  -> kartu ringkasan mengikuti pencarian + kategori (bukan status)
// false -> kartu ringkasan selalu menghitung seluruh produk
const SUMMARY_FOLLOWS_FILTER = true;

// Dengarkan perubahan tabel products dari perangkat lain (Supabase Realtime).
// Aman jika Realtime belum diaktifkan untuk tabel: halaman tetap jalan normal.
const ENABLE_REALTIME = true;

// =========================================================
// STATE
// =========================================================
let products = [];
let filteredProducts = [];
let loading = true;
let loadError = false;
let lastLoadedAt = null;

const state = {
    search: '',
    kategori: 'all',
    status: 'all',          // all | aman | menipis | habis
    sort: 'prioritas',      // prioritas | nama | stok_asc | stok_desc
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
};

const confirmed = new Map(); // id -> stok terakhir yang sudah tersimpan di server
const pending = new Map();   // id -> { timer, queued, inFlight, again }
const notes = new Map();     // id -> { type: 'saved' | 'error', until }
const flashIds = new Set();  // baris yang perlu disorot pada render berikutnya

let toastTimer = null;
let searchTimer = null;

// =========================================================
// HELPER
// =========================================================
const $ = (id) => document.getElementById(id);
const keyOf = (id) => String(id);
const findP = (id) => products.find((p) => keyOf(p.id) === keyOf(id));

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (m) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]
));

const getName = (p) => String(p.nama || p.name || '');

// Kategori: "dimsum", "Dimsum", " DIMSUM " dianggap satu kategori yang sama.
const categoryLabels = new Map(); // key -> label tampilan
const categoryCounts = new Map(); // key -> jumlah produk
const getCatRaw = (p) => String(p.kategori || p.category || '').trim().replace(/\s+/g, ' ');
const getCatKey = (p) => getCatRaw(p).toLowerCase();
const getCat    = (p) => categoryLabels.get(getCatKey(p)) || getCatRaw(p);

const getStock = (p) => Math.max(0, Number(p?.stok) || 0);
const getStatus = (p) => {
    const s = getStock(p);
    if (s <= 0) return 'habis';
    if (s <= LOW_STOCK_MAX) return 'menipis';
    return 'aman';
};

const STATUS_META = {
    aman:    { label: 'Aman',    icon: 'fa-check',                badge: 'bg-emerald-50 border-emerald-200 text-emerald-700', bar: 'bg-emerald-500', text: 'text-emerald-600' },
    menipis: { label: 'Menipis', icon: 'fa-triangle-exclamation', badge: 'bg-amber-50 border-amber-200 text-amber-700',       bar: 'bg-amber-500',   text: 'text-amber-600' },
    habis:   { label: 'Habis',   icon: 'fa-xmark',                badge: 'bg-rose-50 border-rose-200 text-rose-700',          bar: 'bg-rose-500',    text: 'text-rose-600' },
};
const STATUS_RANK = { habis: 0, menipis: 1, aman: 2 };

function byName(a, b) { return getName(a).localeCompare(getName(b), 'id', { sensitivity: 'base' }); }

const SORTS = {
    prioritas: (a, b) => STATUS_RANK[getStatus(a)] - STATUS_RANK[getStatus(b)] || getStock(a) - getStock(b) || byName(a, b),
    nama:      byName,
    stok_asc:  (a, b) => getStock(a) - getStock(b) || byName(a, b),
    stok_desc: (a, b) => getStock(b) - getStock(a) || byName(a, b),
};

function highlight(text) {
    const q = state.search;
    if (!q) return esc(text);
    const i = text.toLowerCase().indexOf(q);
    if (i < 0) return esc(text);
    return esc(text.slice(0, i))
        + `<mark class="bg-orange-100 text-orange-700 rounded px-0.5">${esc(text.slice(i, i + q.length))}</mark>`
        + esc(text.slice(i + q.length));
}

function loadPrefs() {
    try {
        const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
        if (SORTS[p.sort]) state.sort = p.sort;
        if (PAGE_SIZES.includes(p.pageSize)) state.pageSize = p.pageSize;
    } catch { /* abaikan */ }
}
function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ sort: state.sort, pageSize: state.pageSize })); } catch { /* abaikan */ }
}

// =========================================================
// NOTIFIKASI
// =========================================================
window.showStatus = function (message, type = 'error') {
    const box = $('statusBox');
    const msg = $('statusMessage');
    if (!box || !msg) return;

    box.classList.remove(
        'hidden', 'bg-red-50', 'border-red-200', 'text-red-700',
        'bg-emerald-50', 'border-emerald-200', 'text-emerald-700'
    );
    const isError = type === 'error';
    box.classList.add(...(isError
        ? ['bg-red-50', 'border-red-200', 'text-red-700']
        : ['bg-emerald-50', 'border-emerald-200', 'text-emerald-700']));
    msg.innerHTML = isError
        ? `<i class="fa-solid fa-circle-exclamation text-red-500 text-sm"></i><span class="font-medium">${esc(message)}</span>`
        : `<i class="fa-solid fa-circle-check text-emerald-500 text-sm"></i><span class="font-medium">${esc(message)}</span>`;

    box.classList.remove('toast-enter');
    void box.offsetWidth;
    box.classList.add('toast-enter');

    clearTimeout(toastTimer);
    toastTimer = setTimeout(window.hideStatus, isError ? 5000 : 3000);
};

window.hideStatus = function () {
    const box = $('statusBox');
    if (box) box.classList.add('hidden');
};

function setConnection(ok) {
    const el = $('connectionStatus');
    if (!el) return;
    el.className = ok
        ? 'text-[10px] text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200'
        : 'text-[10px] text-rose-600 bg-rose-50 px-3 py-1.5 rounded-lg border border-rose-200';
    el.innerHTML = ok
        ? '<i class="fa-solid fa-circle mr-1 text-[6px] align-middle"></i> Terhubung'
        : '<i class="fa-solid fa-triangle-exclamation mr-1"></i> Gagal terhubung';
}

function setRefreshing(on) {
    const btn = $('btnRefresh');
    if (!btn) return;
    btn.disabled = on;
    const icon = btn.querySelector('i');
    if (icon) icon.classList.toggle('fa-spin', on);
}

function renderLastUpdated() {
    const el = $('lastUpdated');
    if (!el || !lastLoadedAt) return;
    el.textContent = 'Diperbarui ' + lastLoadedAt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

// =========================================================
// LOAD DATA
// =========================================================
window.loadStok = async function () {
    if (pending.size) {
        window.showStatus('Tunggu sebentar, masih ada perubahan stok yang sedang disimpan.', 'error');
        return;
    }
    setRefreshing(true);
    try {
        await authReady;
        const { data, error } = await supabase.from('products').select('*');
        if (error) throw error;
        products = data || [];
        confirmed.clear();
        products.forEach((p) => confirmed.set(keyOf(p.id), getStock(p)));
        loadError = false;
        lastLoadedAt = new Date();
        setConnection(true);
    } catch (e) {
        console.warn('Gagal memuat dari Supabase:', e);
        loadError = true;
        setConnection(false);
        window.showStatus('Gagal memuat data dari server.', 'error');
    } finally {
        loading = false;
        setRefreshing(false);
    }

    renderCategoryOptions();
    renderLastUpdated();
    refresh(); // halaman dipertahankan (di-clamp bila perlu)
};

// =========================================================
// PIPELINE FILTER  (search + kategori -> status -> sort -> pagination)
// =========================================================
const matchSearch   = (p) => !state.search || getName(p).toLowerCase().includes(state.search);
const matchCategory = (p) => state.kategori === 'all' || getCatKey(p) === state.kategori;
const matchStatus   = (p) => state.status === 'all' || getStatus(p) === state.status;
const getBaseProducts = () => products.filter((p) => matchSearch(p) && matchCategory(p));
const hasFilter = () => Boolean(state.search) || state.kategori !== 'all' || state.status !== 'all';

/** Satu-satunya pintu untuk memperbarui tampilan. */
function refresh({ resetPage = false } = {}) {
    filteredProducts = getBaseProducts().filter(matchStatus).sort(SORTS[state.sort] || SORTS.prioritas);

    if (resetPage) state.page = 1;
    const totalPages = Math.max(1, Math.ceil(filteredProducts.length / state.pageSize));
    state.page = Math.min(Math.max(1, state.page), totalPages);

    // Simpan fokus agar render ulang tidak membuat admin "kehilangan posisi"
    const active = document.activeElement;
    const focusKey = active?.dataset?.focusKey;
    const focusView = active?.closest?.('[data-view]')?.dataset.view;
    const typedValue = active?.matches?.('[data-stock-input]') ? active.value : null;

    renderSummary();
    renderActiveFilters();
    renderList();
    renderPagination(totalPages);
    flashIds.clear();

    if (focusKey) {
        const scope = focusView ? document.querySelector(`[data-view="${focusView}"]`) : document;
        const el = scope?.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`);
        if (el) {
            if (typedValue !== null) el.value = typedValue;
            el.focus({ preventScroll: true });
        }
    }
}

// =========================================================
// KATEGORI
// =========================================================
function buildCategoryLabels() {
    const variants = new Map(); // key -> Map(penulisan asli -> jumlah)
    categoryCounts.clear();
    products.forEach((p) => {
        const raw = getCatRaw(p);
        if (!raw) return;
        const key = raw.toLowerCase();
        categoryCounts.set(key, (categoryCounts.get(key) || 0) + 1);
        if (!variants.has(key)) variants.set(key, new Map());
        const v = variants.get(key);
        v.set(raw, (v.get(raw) || 0) + 1);
    });

    categoryLabels.clear();
    variants.forEach((v, key) => {
        // Prioritaskan penulisan berawalan huruf kapital, lalu yang paling sering dipakai
        const best = [...v.entries()].sort((a, b) =>
            Number(/^[A-Z]/.test(b[0])) - Number(/^[A-Z]/.test(a[0])) || b[1] - a[1]
        )[0][0];
        categoryLabels.set(key, best);
    });
}

function renderCategoryOptions() {
    const select = $('kategoriFilter');
    if (!select) return;

    buildCategoryLabels();
    const cats = [...categoryLabels.entries()].sort((a, b) => a[1].localeCompare(b[1], 'id'));

    select.innerHTML = '';
    select.add(new Option(`Semua Kategori (${products.length})`, 'all'));
    cats.forEach(([key, label]) => select.add(new Option(`${label} (${categoryCounts.get(key) || 0})`, key)));

    if (state.kategori !== 'all' && !categoryLabels.has(state.kategori)) state.kategori = 'all';
    select.value = state.kategori;
}

// =========================================================
// RENDER: SUMMARY (kartu = tombol filter status)
// =========================================================
function renderSummary() {
    const box = $('stokSummary');
    if (!box || loading) return;

    const source = SUMMARY_FOLLOWS_FILTER ? getBaseProducts() : products;
    const count = { aman: 0, menipis: 0, habis: 0 };
    source.forEach((p) => { count[getStatus(p)]++; });
    const total = source.length;
    const scoped = SUMMARY_FOLLOWS_FILTER && (state.search || state.kategori !== 'all');

    const cards = [
        { key: 'all',     title: 'Total Produk', value: total,         hint: scoped ? 'Sesuai filter' : 'Semua produk',      tone: 'slate',   icon: 'fa-boxes-stacked' },
        { key: 'aman',    title: 'Stok Aman',    value: count.aman,    hint: `Lebih dari ${LOW_STOCK_MAX} porsi`,           tone: 'emerald', icon: 'fa-check' },
        { key: 'menipis', title: 'Menipis',      value: count.menipis, hint: `1 – ${LOW_STOCK_MAX} porsi · perlu restok`,  tone: 'amber',   icon: 'fa-triangle-exclamation' },
        { key: 'habis',   title: 'Stok Habis',   value: count.habis,   hint: '0 porsi · tidak bisa dijual',                 tone: 'rose',    icon: 'fa-xmark' },
    ];

    box.innerHTML = cards.map((c) => {
        const active = state.status === c.key;
        const ring = active ? `ring-2 ring-orange-400 shadow-md` : 'hover:shadow-sm hover:-translate-y-0.5';
        return `
        <button type="button" data-status="${c.key}" data-focus-key="sum:${c.key}" aria-pressed="${active}"
            class="text-left bg-white border border-${c.tone}-200 rounded-2xl p-4 transition ${ring} focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300">
            <div class="flex justify-between items-start gap-2">
                <div class="min-w-0">
                    <div class="text-[11px] font-semibold text-${c.tone}-600/80 uppercase tracking-wide">${c.title}</div>
                    <div class="text-2xl font-bold text-${c.tone === 'slate' ? 'slate-800' : c.tone + '-600'} mt-1">${c.value}</div>
                    <div class="text-[9px] text-${c.tone}-600/60 font-medium mt-1 truncate">${c.hint}</div>
                </div>
                <div class="w-8 h-8 shrink-0 rounded-full bg-${c.tone}-100 flex items-center justify-center text-${c.tone}-500">
                    <i class="fa-solid ${active && c.key !== 'all' ? 'fa-filter' : c.icon} text-xs"></i>
                </div>
            </div>
        </button>`;
    }).join('');
}

// =========================================================
// RENDER: CHIP FILTER AKTIF
// =========================================================
function renderActiveFilters() {
    const box = $('activeFilters');
    if (!box) return;

    const chips = [];
    if (state.search) chips.push(['search', `Cari: “${state.search}”`]);
    if (state.kategori !== 'all') chips.push(['kategori', `Kategori: ${categoryLabels.get(state.kategori) || state.kategori}`]);
    if (state.status !== 'all') chips.push(['status', `Status: ${STATUS_META[state.status].label}`]);

    if (!chips.length) { box.classList.add('hidden'); box.classList.remove('flex'); box.innerHTML = ''; return; }

    box.classList.remove('hidden'); box.classList.add('flex');
    box.innerHTML = chips.map(([k, label]) => `
        <span class="inline-flex items-center gap-1.5 bg-orange-50 border border-orange-200 text-orange-700 rounded-full pl-3 pr-1 py-0.5 text-[10px] font-medium">
            ${esc(label)}
            <button type="button" data-clear="${k}" class="w-4 h-4 rounded-full hover:bg-orange-100 flex items-center justify-center" aria-label="Hapus filter ${esc(label)}">
                <i class="fa-solid fa-xmark text-[9px]"></i>
            </button>
        </span>`).join('')
        + `<button type="button" data-clear="all" class="text-[10px] font-semibold text-slate-500 hover:text-orange-600 px-1">Reset semua</button>`;
}

// =========================================================
// RENDER: DAFTAR (tabel desktop + kartu mobile)
// =========================================================
function noteBadge(key) {
    const e = pending.get(key);
    if (e?.inFlight) return '<span class="text-slate-500"><i class="fa-solid fa-circle-notch fa-spin mr-1"></i>Menyimpan…</span>';
    if (e) return '<span class="text-slate-400"><i class="fa-regular fa-clock mr-1"></i>Menunggu…</span>';
    const n = notes.get(key);
    if (n && n.until > Date.now()) {
        return n.type === 'saved'
            ? '<span class="text-emerald-600"><i class="fa-solid fa-check mr-1"></i>Tersimpan</span>'
            : '<span class="text-rose-500"><i class="fa-solid fa-circle-exclamation mr-1"></i>Gagal, dikembalikan</span>';
    }
    return '';
}

function paintNote(key) {
    document.querySelectorAll(`[data-note="${CSS.escape(key)}"]`).forEach((el) => { el.innerHTML = noteBadge(key); });
}

function setNote(key, type) {
    notes.set(key, { type, until: Date.now() + NOTE_VISIBLE_MS });
    paintNote(key);
    setTimeout(() => paintNote(key), NOTE_VISIBLE_MS + 50);
}

function stockBar(p) {
    const st = getStock(p);
    const pct = st <= 0 ? 0 : Math.max(6, Math.min(100, Math.round((st / BAR_FULL_AT) * 100)));
    return `<div class="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden" aria-hidden="true">
        <div class="h-full ${STATUS_META[getStatus(p)].bar} rounded-full transition-all duration-300" style="width:${pct}%"></div>
    </div>`;
}

function statusBadge(p) {
    const m = STATUS_META[getStatus(p)];
    return `<span class="inline-flex items-center border ${m.badge} px-2.5 py-1 rounded-lg font-semibold text-[10px] whitespace-nowrap"><i class="fa-solid ${m.icon} mr-1"></i>${m.label}</span>`;
}

function stockControl(p) {
    const st = getStock(p);
    const key = esc(keyOf(p.id));
    const name = esc(getName(p));
    const btn = 'w-10 h-10 md:w-9 md:h-9 flex items-center justify-center text-slate-500 transition disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none focus-visible:bg-orange-50';
    return `
        <div class="inline-flex items-center rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden focus-within:border-orange-400 focus-within:ring-2 focus-within:ring-orange-100">
            <button type="button" data-step="-1" data-id="${key}" data-focus-key="dec:${key}" ${st <= 0 ? 'disabled' : ''}
                class="${btn} hover:bg-rose-50 hover:text-rose-500" title="Kurangi 1 (Shift: 10)" aria-label="Kurangi stok ${name}">
                <i class="fa-solid fa-minus text-[10px]"></i>
            </button>
            <input type="number" inputmode="numeric" min="0" step="1" value="${st}"
                data-stock-input data-id="${key}" data-focus-key="in:${key}"
                class="no-spin w-14 h-10 md:h-9 text-center text-sm font-semibold text-slate-700 bg-slate-50 border-x border-slate-200 outline-none focus:bg-white"
                aria-label="Jumlah stok ${name}">
            <button type="button" data-step="1" data-id="${key}" data-focus-key="inc:${key}"
                class="${btn} hover:bg-emerald-50 hover:text-emerald-600" title="Tambah 1 (Shift: 10)" aria-label="Tambah stok ${name}">
                <i class="fa-solid fa-plus text-[10px]"></i>
            </button>
        </div>`;
}

function productImg(p, size) {
    return `<img src="${esc(p.foto || p.image || 'https://placehold.co/80?text=%20')}" alt="" loading="lazy"
        class="${size} shrink-0 object-cover rounded-xl border border-slate-100 bg-slate-50"
        onerror="this.onerror=null;this.src='https://placehold.co/80?text=?'">`;
}

function emptyState() {
    if (loadError && !products.length) {
        return `<div class="flex flex-col items-center py-14 px-4 text-center">
            <div class="w-12 h-12 rounded-full bg-rose-50 flex items-center justify-center mb-3"><i class="fa-solid fa-plug-circle-xmark text-rose-400 text-xl"></i></div>
            <p class="text-xs font-semibold text-slate-600">Data stok tidak bisa dimuat.</p>
            <p class="text-[11px] text-slate-400 mt-1">Periksa koneksi internet, lalu coba lagi.</p>
            <button type="button" data-action="reload" class="mt-3 text-xs font-semibold text-white bg-orange-500 hover:bg-orange-600 px-4 py-2 rounded-lg transition">Coba lagi</button>
        </div>`;
    }
    if (!products.length) {
        return `<div class="flex flex-col items-center py-14 px-4 text-center">
            <div class="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center mb-3"><i class="fa-solid fa-box-open text-slate-300 text-xl"></i></div>
            <p class="text-xs font-semibold text-slate-500">Belum ada produk.</p>
        </div>`;
    }
    return `<div class="flex flex-col items-center py-14 px-4 text-center">
        <div class="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center mb-3"><i class="fa-solid fa-magnifying-glass text-slate-300 text-xl"></i></div>
        <p class="text-xs font-semibold text-slate-500">Tidak ada produk yang cocok.</p>
        ${hasFilter() ? '<button type="button" data-clear="all" class="mt-3 text-xs font-semibold text-orange-500 hover:text-orange-600 transition">Reset filter</button>' : ''}
    </div>`;
}

function renderList() {
    const tbody = $('stokTableBody');
    const cards = $('stokCardList');

    if (loading) {
        const n = Math.min(state.pageSize, 5);
        if (tbody) tbody.innerHTML = Array.from({ length: n }, () => `
            <tr class="animate-pulse"><td class="p-3"><div class="flex items-center gap-3"><div class="w-11 h-11 rounded-xl bg-slate-100"></div><div class="space-y-2"><div class="h-3 w-40 bg-slate-100 rounded"></div><div class="h-2.5 w-16 bg-slate-100 rounded"></div></div></div></td>
            <td class="p-3"><div class="h-3 w-10 mx-auto bg-slate-100 rounded"></div></td>
            <td class="p-3"><div class="h-5 w-16 mx-auto bg-slate-100 rounded-lg"></div></td>
            <td class="p-3"><div class="h-9 w-32 mx-auto bg-slate-100 rounded-xl"></div></td></tr>`).join('');
        if (cards) cards.innerHTML = Array.from({ length: n }, () => `
            <div class="p-3 flex gap-3 animate-pulse"><div class="w-14 h-14 rounded-xl bg-slate-100"></div><div class="flex-1 space-y-2 py-1"><div class="h-3 w-3/4 bg-slate-100 rounded"></div><div class="h-2.5 w-1/3 bg-slate-100 rounded"></div><div class="h-1.5 w-full bg-slate-100 rounded"></div></div></div>`).join('');
        return;
    }

    if (filteredProducts.length === 0) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="4">${emptyState()}</td></tr>`;
        if (cards) cards.innerHTML = emptyState();
        return;
    }

    const start = (state.page - 1) * state.pageSize;
    const rows = filteredProducts.slice(start, start + state.pageSize);

    if (tbody) tbody.innerHTML = rows.map((p) => {
        const key = keyOf(p.id);
        const st = getStock(p);
        const name = getName(p);
        return `
        <tr class="hover:bg-slate-50/70 transition ${flashIds.has(key) ? 'row-flash' : ''}">
            <td class="p-3">
                <div class="flex items-center gap-3 min-w-[220px]">
                    ${productImg(p, 'w-11 h-11')}
                    <div class="min-w-0">
                        <div class="font-semibold text-slate-800 truncate max-w-[320px]" title="${esc(name)}">${highlight(name)}</div>
                        <span class="inline-block mt-1 bg-slate-100 text-slate-500 px-2 py-0.5 rounded-md text-[10px] font-medium">${esc(getCat(p) || 'Tanpa kategori')}</span>
                    </div>
                </div>
            </td>
            <td class="p-3">
                <div class="flex flex-col items-center gap-1.5 px-2">
                    <div class="text-base font-bold ${STATUS_META[getStatus(p)].text}">${st}<span class="text-[10px] font-medium text-slate-400 ml-1">porsi</span></div>
                    ${stockBar(p)}
                </div>
            </td>
            <td class="p-3 text-center">${statusBadge(p)}</td>
            <td class="p-3">
                <div class="flex flex-col items-center gap-1">
                    ${stockControl(p)}
                    <div data-note="${esc(key)}" class="h-3.5 text-[10px] font-medium">${noteBadge(key)}</div>
                </div>
            </td>
        </tr>`;
    }).join('');

    if (cards) cards.innerHTML = rows.map((p) => {
        const key = keyOf(p.id);
        const name = getName(p);
        return `
        <div class="p-3 ${flashIds.has(key) ? 'row-flash' : ''}">
            <div class="flex gap-3">
                ${productImg(p, 'w-14 h-14')}
                <div class="flex-1 min-w-0">
                    <div class="flex items-start justify-between gap-2">
                        <div class="font-semibold text-sm text-slate-800 leading-snug line-clamp-2">${highlight(name)}</div>
                        ${statusBadge(p)}
                    </div>
                    <div class="text-[10px] text-slate-400 mt-0.5">${esc(getCat(p) || 'Tanpa kategori')}</div>
                    <div class="mt-2">${stockBar(p)}</div>
                </div>
            </div>
            <div class="flex items-center justify-between gap-2 mt-3">
                <div>
                    <div class="text-[10px] text-slate-400">Stok sistem</div>
                    <div class="text-base font-bold ${STATUS_META[getStatus(p)].text} leading-tight">${getStock(p)} <span class="text-[10px] font-medium text-slate-400">porsi</span></div>
                    <div data-note="${esc(key)}" class="h-3.5 text-[10px] font-medium">${noteBadge(key)}</div>
                </div>
                ${stockControl(p)}
            </div>
        </div>`;
    }).join('');
}

// =========================================================
// RENDER: PAGINATION
// =========================================================
function pageList(cur, total) {
    const nums = [...new Set([1, total, cur - 1, cur, cur + 1])]
        .filter((n) => n >= 1 && n <= total)
        .sort((a, b) => a - b);
    const out = [];
    nums.forEach((n, i) => {
        if (i && n - nums[i - 1] > 1) out.push('…');
        out.push(n);
    });
    return out;
}

function renderPagination(totalPages) {
    const total = filteredProducts.length;
    const startNum = total === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
    const endNum = Math.min(state.page * state.pageSize, total);

    const info = $('tableInfo');
    if (info) {
        info.textContent = loading ? 'Memuat data...'
            : hasFilter() ? `${total} dari ${products.length} produk cocok dengan filter`
            : `${total} produk`;
    }

    const text = $('paginationInfoText');
    if (text) {
        text.innerHTML = total === 0
            ? 'Tidak ada produk'
            : `<span class="font-medium text-slate-700">${startNum}–${endNum}</span> dari <span class="font-medium text-slate-700">${total}</span>`;
    }

    const mobile = $('pageInfoMobile');
    if (mobile) mobile.textContent = `${state.page} / ${totalPages}`;

    const prev = $('btnPrevPage');
    const next = $('btnNextPage');
    if (prev) prev.disabled = state.page <= 1;
    if (next) next.disabled = total === 0 || state.page >= totalPages;

    const numbers = $('pageNumbers');
    if (numbers) {
        numbers.innerHTML = total === 0 || totalPages === 1 ? '' : pageList(state.page, totalPages).map((n) => {
            if (n === '…') return '<span class="w-6 h-8 flex items-center justify-center text-slate-400 text-xs">…</span>';
            return n === state.page
                ? `<button type="button" aria-current="page" class="w-8 h-8 rounded-lg bg-orange-500 text-white flex items-center justify-center text-xs font-medium shadow-sm">${n}</button>`
                : `<button type="button" data-page="${n}" class="w-8 h-8 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center justify-center text-xs font-medium transition" aria-label="Halaman ${n}">${n}</button>`;
        }).join('');
    }
}

function scrollPanelIntoView() {
    const panel = $('stokPanel');
    if (panel && panel.getBoundingClientRect().top < 0) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// =========================================================
// AKSI FILTER & PAGINATION (tetap diekspos untuk kompatibilitas)
// =========================================================
window.setFilter = function (status) {
    state.status = state.status === status && status !== 'all' ? 'all' : status; // klik kartu aktif = matikan filter
    refresh({ resetPage: true });
};

function clearFilter(which) {
    if (which === 'search' || which === 'all') {
        state.search = '';
        const s = $('stokSearch');
        if (s) s.value = '';
        toggleClearSearch();
    }
    if (which === 'kategori' || which === 'all') {
        state.kategori = 'all';
        const k = $('kategoriFilter');
        if (k) k.value = 'all';
    }
    if (which === 'status' || which === 'all') state.status = 'all';
    refresh({ resetPage: true });
}

window.resetFilters = () => clearFilter('all');

window.changePage = function (direction) {
    if (direction === 'prev') state.page--;
    else if (direction === 'next') state.page++;
    refresh();
    scrollPanelIntoView();
};

window.goToPage = function (page) {
    state.page = Number(page) || 1;
    refresh();
    scrollPanelIntoView();
};

// =========================================================
// UPDATE STOK
//  - Tampilan berubah seketika (optimistis)
//  - Klik +/- beruntun digabung, baru dikirim setelah jeda SAVE_DEBOUNCE_MS
//  - Request per produk berurutan (tidak saling balapan)
//  - Gagal -> kembali ke nilai terakhir yang tersimpan di server
// =========================================================
function setLocalStock(key, val) {
    products = products.map((p) => (keyOf(p.id) === key ? { ...p, stok: val } : p));
}

function updateStock(id, raw) {
    const key = keyOf(id);
    const target = findP(key);
    if (!target) return;

    const str = String(raw ?? '').trim();
    const num = Number(str);
    // input kosong / bukan angka -> batalkan, kembalikan tampilan
    if (str === '' || !Number.isFinite(num)) { refresh(); return; }

    const newVal = Math.max(0, Math.floor(num));
    if (newVal === getStock(target)) { refresh(); return; }

    if (!confirmed.has(key)) confirmed.set(key, getStock(target));
    setLocalStock(key, newVal);
    flashIds.add(key);
    refresh(); // halaman TIDAK di-reset
    scheduleSave(key);
}

function scheduleSave(key) {
    const entry = pending.get(key) || {};
    clearTimeout(entry.timer);
    entry.queued = true;
    entry.timer = setTimeout(() => { entry.queued = false; saveNow(key); }, SAVE_DEBOUNCE_MS);
    pending.set(key, entry);
    paintNote(key);
}

async function saveNow(key) {
    const entry = pending.get(key);
    if (!entry) return;
    if (entry.inFlight) { entry.again = true; return; }

    const p = findP(key);
    if (!p) { pending.delete(key); return; }

    const val = getStock(p);
    if (val === confirmed.get(key)) { pending.delete(key); paintNote(key); return; }

    entry.inFlight = true;
    paintNote(key);

    try {
        await authReady;
        const { error } = await supabase.from('products').update({ stok: val }).eq('id', p.id);
        if (error) throw error;

        confirmed.set(key, val);
        entry.inFlight = false;

        if (entry.queued) { paintNote(key); return; }          // ada perubahan baru, timer akan menyimpan
        if (entry.again) { entry.again = false; return saveNow(key); }
        pending.delete(key);
        setNote(key, 'saved');
    } catch (e) {
        entry.inFlight = false;
        const name = getName(p) || 'produk';
        window.showStatus(`Gagal menyimpan stok ${name}: ${e?.message || e}`, 'error');

        if (entry.queued) { paintNote(key); return; }          // admin sudah mengubah lagi, coba di simpan berikutnya
        pending.delete(key);
        setLocalStock(key, confirmed.get(key) ?? 0);
        flashIds.add(key);
        refresh();
        setNote(key, 'error');
    }
}

window.modStock = (id, val) => updateStock(id, val);

window.stepStock = function (id, delta) {
    const p = findP(id);
    if (p) updateStock(id, getStock(p) + delta);
};

window.inputStock = function (id) {
    const el = document.querySelector(`[data-stock-input][data-id="${CSS.escape(keyOf(id))}"]`);
    if (el) updateStock(id, el.value);
};

// =========================================================
// REALTIME (opsional)
// =========================================================
function onRealtime(payload) {
    const { eventType, new: row, old } = payload || {};

    if (eventType === 'DELETE') {
        const key = keyOf(old?.id);
        products = products.filter((p) => keyOf(p.id) !== key);
        confirmed.delete(key);
    } else if (row && row.id != null) {
        const key = keyOf(row.id);
        const idx = products.findIndex((p) => keyOf(p.id) === key);

        if (pending.has(key)) {
            // admin sedang mengubah produk ini: pertahankan nilai lokalnya
            const local = idx >= 0 ? getStock(products[idx]) : getStock(row);
            const merged = { ...row, stok: local };
            if (idx >= 0) products[idx] = merged; else products.push(merged);
        } else {
            if (idx >= 0 && getStock(products[idx]) !== getStock(row)) flashIds.add(key);
            if (idx >= 0) products[idx] = row; else { products.push(row); flashIds.add(key); }
            confirmed.set(key, getStock(row));
        }
    } else {
        return;
    }

    renderCategoryOptions();
    refresh();
}

async function subscribeRealtime() {
    if (!ENABLE_REALTIME || typeof supabase?.channel !== 'function') return;
    try {
        await authReady;
        supabase
            .channel('stok-siap-jual')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, onRealtime)
            .subscribe();
    } catch (e) {
        console.warn('Realtime tidak aktif:', e);
    }
}

// =========================================================
// EVENT
// =========================================================
const isTyping = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

function toggleClearSearch() {
    const btn = $('btnClearSearch');
    const input = $('stokSearch');
    if (btn && input) btn.classList.toggle('hidden', !input.value);
}

function bindEvents() {
    const search = $('stokSearch');
    const kategori = $('kategoriFilter');
    const sort = $('sortSelect');
    const pageSize = $('pageSizeSelect');

    if (search) {
        state.search = search.value.toLowerCase().trim(); // jika browser mengisi ulang nilai
        toggleClearSearch();
        search.addEventListener('input', (e) => {
            toggleClearSearch();
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                state.search = e.target.value.toLowerCase().trim();
                refresh({ resetPage: true });
            }, SEARCH_DEBOUNCE_MS);
        });
        search.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && search.value) { e.preventDefault(); clearTimeout(searchTimer); clearFilter('search'); }
        });
    }
    $('btnClearSearch')?.addEventListener('click', () => { clearTimeout(searchTimer); clearFilter('search'); search?.focus(); });

    kategori?.addEventListener('change', (e) => {
        state.kategori = e.target.value;
        refresh({ resetPage: true });
    });

    if (sort) {
        sort.value = state.sort;
        sort.addEventListener('change', (e) => {
            state.sort = SORTS[e.target.value] ? e.target.value : 'prioritas';
            savePrefs();
            refresh({ resetPage: true });
        });
    }

    if (pageSize) {
        pageSize.innerHTML = PAGE_SIZES.map((n) => `<option value="${n}">${n}</option>`).join('');
        pageSize.value = String(state.pageSize);
        pageSize.addEventListener('change', (e) => {
            // pertahankan produk pertama yang sedang terlihat
            const firstIndex = (state.page - 1) * state.pageSize;
            state.pageSize = Number(e.target.value) || DEFAULT_PAGE_SIZE;
            state.page = Math.floor(firstIndex / state.pageSize) + 1;
            savePrefs();
            refresh();
        });
    }

    $('btnPrevPage')?.addEventListener('click', () => window.changePage('prev'));
    $('btnNextPage')?.addEventListener('click', () => window.changePage('next'));
    $('btnRefresh')?.addEventListener('click', () => window.loadStok());

    // Delegasi klik: tombol stok, kartu status, chip filter, nomor halaman
    document.addEventListener('click', (e) => {
        const t = e.target.closest('[data-step],[data-status],[data-clear],[data-page],[data-action]');
        if (!t || t.disabled) return;
        if (t.dataset.step) window.stepStock(t.dataset.id, Number(t.dataset.step) * (e.shiftKey ? 10 : 1));
        else if (t.dataset.status) window.setFilter(t.dataset.status);
        else if (t.dataset.clear) clearFilter(t.dataset.clear);
        else if (t.dataset.page) window.goToPage(t.dataset.page);
        else if (t.dataset.action === 'reload') window.loadStok();
    });

    // Input stok: simpan saat change (blur / Enter)
    document.addEventListener('change', (e) => {
        const inp = e.target.closest?.('[data-stock-input]');
        if (inp) updateStock(inp.dataset.id, inp.value);
    });

    document.addEventListener('focusin', (e) => {
        if (e.target.matches?.('[data-stock-input]')) e.target.select();
    });

    document.addEventListener('keydown', (e) => {
        const inp = e.target.closest?.('[data-stock-input]');
        if (inp) {
            if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
            else if (e.key === 'Escape') { inp.value = getStock(findP(inp.dataset.id)); inp.blur(); }
            return;
        }
        if (e.key === '/' && !isTyping(e.target)) { e.preventDefault(); search?.focus(); }
    });

    // Cegah perubahan stok hilang saat halaman ditutup
    window.addEventListener('beforeunload', (e) => {
        if (pending.size) { e.preventDefault(); e.returnValue = ''; }
    });
}

// =========================================================
// INIT
// =========================================================
loadPrefs();
bindEvents();
refresh(); // tampilkan skeleton
window.loadStok().then(subscribeRealtime);
