import { supabase, authReady } from '../supabase.js';

// =========================================================
// KONFIGURASI
// =========================================================
const ITEMS_PER_PAGE = 5;
const LOW_STOCK_MAX = 10;        // 1..10 = menipis
const SEARCH_DEBOUNCE_MS = 250;

// true  -> kartu ringkasan mengikuti pencarian + kategori (bukan status)
// false -> kartu ringkasan selalu menghitung seluruh produk
const SUMMARY_FOLLOWS_FILTER = true;

// =========================================================
// STATE (satu sumber kebenaran)
// =========================================================
let products = [];
let filteredProducts = [];
const state = {
    search: '',
    kategori: 'all',
    status: 'all', // all | aman | menipis | habis
    page: 1,
};

let toastTimer = null;
let searchTimer = null;

// =========================================================
// HELPER
// =========================================================
const $ = (id) => document.getElementById(id);

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (m) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]
));

const getName  = (p) => String(p.nama || p.name || '');
const getCat   = (p) => String(p.kategori || p.category || '').trim();
const getStock = (p) => Math.max(0, Number(p.stok) || 0);
const getStatus = (p) => {
    const s = getStock(p);
    if (s <= 0) return 'habis';
    if (s <= LOW_STOCK_MAX) return 'menipis';
    return 'aman';
};

// =========================================================
// NOTIFIKASI (memakai #statusBox & #statusMessage di HTML)
// =========================================================
window.showStatus = function (message, type = 'error') {
    const box = $('statusBox');
    const msg = $('statusMessage');
    if (!box || !msg) return;

    box.classList.remove(
        'hidden', 'bg-red-50', 'border-red-200', 'text-red-700',
        'bg-emerald-50', 'border-emerald-200', 'text-emerald-700'
    );

    if (type === 'error') {
        box.classList.add('bg-red-50', 'border-red-200', 'text-red-700');
        msg.innerHTML = `<i class="fa-solid fa-circle-exclamation text-red-500 text-sm"></i><span class="font-medium">${esc(message)}</span>`;
    } else {
        box.classList.add('bg-emerald-50', 'border-emerald-200', 'text-emerald-700');
        msg.innerHTML = `<i class="fa-solid fa-circle-check text-emerald-500 text-sm"></i><span class="font-medium">${esc(message)}</span>`;
    }

    // restart animasi
    box.classList.remove('toast-enter');
    void box.offsetWidth;
    box.classList.add('toast-enter');

    clearTimeout(toastTimer);
    toastTimer = setTimeout(window.hideStatus, 3500);
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

// =========================================================
// LOAD DATA
// =========================================================
window.loadStok = async function () {
    try {
        await authReady;
        const { data, error } = await supabase.from('products').select('*');
        if (error) throw error;
        products = data || [];
        setConnection(true);
    } catch (e) {
        console.warn('Gagal memuat dari Supabase:', e);
        setConnection(false);
        window.showStatus('Gagal memuat data dari server.', 'error');
    }

    renderCategoryOptions();
    refresh({ resetPage: true });
};

// =========================================================
// PIPELINE FILTER  (search + kategori -> status -> pagination)
// =========================================================
const matchSearch   = (p) => !state.search || getName(p).toLowerCase().includes(state.search);
const matchCategory = (p) => state.kategori === 'all' || getCat(p) === state.kategori;
const matchStatus   = (p) => state.status === 'all' || getStatus(p) === state.status;

// Produk setelah search + kategori (dasar untuk kartu ringkasan)
const getBaseProducts = () => products.filter((p) => matchSearch(p) && matchCategory(p));

/**
 * Satu-satunya pintu untuk memperbarui tampilan.
 * resetPage: true  -> dipakai saat search/kategori/status berubah
 * resetPage: false -> dipakai saat update stok (halaman tetap)
 */
function refresh({ resetPage = false } = {}) {
    filteredProducts = getBaseProducts().filter(matchStatus);

    if (resetPage) state.page = 1;

    const totalPages = Math.max(1, Math.ceil(filteredProducts.length / ITEMS_PER_PAGE));
    state.page = Math.min(Math.max(1, state.page), totalPages);

    renderSummary();
    renderTable();
    renderPagination(totalPages);
}

// =========================================================
// KATEGORI
// =========================================================
function renderCategoryOptions() {
    const select = $('kategoriFilter');
    if (!select) return;

    const cats = [...new Set(products.map(getCat).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'id'));

    select.innerHTML = '';
    select.add(new Option('Semua Kategori', 'all'));
    cats.forEach((c) => select.add(new Option(c, c)));

    // kategori terpilih sudah tidak ada -> kembali ke "all"
    if (state.kategori !== 'all' && !cats.includes(state.kategori)) state.kategori = 'all';
    select.value = state.kategori;
}

// =========================================================
// RENDER: SUMMARY
// =========================================================
function renderSummary() {
    const box = $('stokSummary');
    if (!box) return;

    const source = SUMMARY_FOLLOWS_FILTER ? getBaseProducts() : products;
    const count = { aman: 0, menipis: 0, habis: 0 };
    source.forEach((p) => { count[getStatus(p)]++; });
    const total = source.length;

    const cls = (target) => state.status === target
        ? 'ring-2 ring-orange-400 bg-white shadow-md'
        : 'bg-white hover:bg-slate-50 opacity-80 hover:opacity-100';

    box.innerHTML = `
        <div onclick="setFilter('all')" class="border border-slate-200 rounded-2xl p-4 cursor-pointer transition ${cls('all')}">
            <div class="flex justify-between items-start">
                <div>
                    <div class="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Total Produk</div>
                    <div class="text-2xl font-bold text-slate-800 mt-1">${total}</div>
                </div>
                <div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500"><i class="fa-solid fa-boxes-stacked text-xs"></i></div>
            </div>
        </div>
        <div onclick="setFilter('aman')" class="border border-emerald-200 rounded-2xl p-4 cursor-pointer transition ${cls('aman')}">
            <div class="flex justify-between items-start">
                <div>
                    <div class="text-[11px] font-semibold text-emerald-600/80 uppercase tracking-wide">Stok Aman</div>
                    <div class="text-2xl font-bold text-emerald-600 mt-1">${count.aman}</div>
                    <div class="text-[9px] text-emerald-600/60 font-medium mt-1">Lebih dari ${LOW_STOCK_MAX} porsi</div>
                </div>
                <div class="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-500"><i class="fa-solid fa-check text-xs"></i></div>
            </div>
        </div>
        <div onclick="setFilter('menipis')" class="border border-amber-200 rounded-2xl p-4 cursor-pointer transition ${cls('menipis')}">
            <div class="flex justify-between items-start">
                <div>
                    <div class="text-[11px] font-semibold text-amber-600/80 uppercase tracking-wide">Menipis</div>
                    <div class="text-2xl font-bold text-amber-600 mt-1">${count.menipis}</div>
                    <div class="text-[9px] text-amber-600/60 font-medium mt-1">1 - ${LOW_STOCK_MAX} porsi</div>
                </div>
                <div class="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center text-amber-500"><i class="fa-solid fa-triangle-exclamation text-xs"></i></div>
            </div>
        </div>
        <div onclick="setFilter('habis')" class="border border-rose-200 rounded-2xl p-4 cursor-pointer transition ${cls('habis')}">
            <div class="flex justify-between items-start">
                <div>
                    <div class="text-[11px] font-semibold text-rose-600/80 uppercase tracking-wide">Stok Habis</div>
                    <div class="text-2xl font-bold text-rose-600 mt-1">${count.habis}</div>
                    <div class="text-[9px] text-rose-600/60 font-medium mt-1">0 porsi (Kosong)</div>
                </div>
                <div class="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center text-rose-500"><i class="fa-solid fa-xmark text-xs"></i></div>
            </div>
        </div>
    `;
}

// =========================================================
// RENDER: TABEL
// =========================================================
const BADGES = {
    aman:    '<span class="bg-emerald-50 border border-emerald-200 text-emerald-700 px-2.5 py-1 rounded-lg font-semibold text-[10px]"><i class="fa-solid fa-check mr-1"></i>Aman</span>',
    menipis: '<span class="bg-amber-50 border border-amber-200 text-amber-700 px-2.5 py-1 rounded-lg font-semibold text-[10px]"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Menipis</span>',
    habis:   '<span class="bg-rose-50 border border-rose-200 text-rose-700 px-2.5 py-1 rounded-lg font-semibold text-[10px]"><i class="fa-solid fa-xmark mr-1"></i>Habis</span>',
};

function renderTable() {
    const tbody = $('stokTableBody');
    if (!tbody) return;

    if (filteredProducts.length === 0) {
        const hasFilter = state.search || state.kategori !== 'all' || state.status !== 'all';
        tbody.innerHTML = `
            <tr><td colspan="6" class="text-center py-16">
                <div class="flex flex-col items-center">
                    <div class="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center mb-3"><i class="fa-solid fa-box-open text-slate-300 text-xl"></i></div>
                    <p class="text-xs font-semibold text-slate-500">Tidak ada produk yang cocok.</p>
                    ${hasFilter ? '<button onclick="resetFilters()" class="mt-3 text-xs font-semibold text-orange-500 hover:text-orange-600 transition">Reset filter</button>' : ''}
                </div>
            </td></tr>`;
        return;
    }

    const start = (state.page - 1) * ITEMS_PER_PAGE;
    const rows = filteredProducts.slice(start, start + ITEMS_PER_PAGE);

    tbody.innerHTML = rows.map((p) => {
        const st = getStock(p);
        const id = esc(p.id);
        return `
            <tr class="hover:bg-slate-50 transition">
                <td class="p-3">
                    <img src="${esc(p.foto || p.image || 'https://placehold.co/80')}" class="w-10 h-10 object-cover rounded-xl shadow-sm border border-slate-100" onerror="this.onerror=null;this.src='https://placehold.co/80?text=Error'">
                </td>
                <td class="p-3 font-semibold text-slate-800">${esc(getName(p))}</td>
                <td class="p-3"><span class="bg-slate-100 text-slate-600 px-2 py-1 rounded-md text-[10px] font-medium">${esc(getCat(p) || '-')}</span></td>
                <td class="p-3 text-center font-bold text-slate-700 text-base">${st}</td>
                <td class="p-3 text-center">${BADGES[getStatus(p)]}</td>
                <td class="p-3">
                    <div class="flex items-center justify-center gap-1.5">
                        <button onclick="stepStock('${id}', -1)" class="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-red-500 transition font-bold shadow-sm" title="Kurangi 1">-</button>
                        <input type="number" min="0" value="${st}" id="stok-${id}" class="w-14 text-center text-sm font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-1.5 outline-none focus:border-orange-400 focus:bg-white transition" onchange="inputStock('${id}')">
                        <button onclick="stepStock('${id}', 1)" class="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-emerald-500 transition font-bold shadow-sm" title="Tambah 1">+</button>
                    </div>
                </td>
            </tr>`;
    }).join('');
}

// =========================================================
// RENDER: PAGINATION (memakai elemen yang sudah ada di HTML)
// =========================================================
function renderPagination(totalPages) {
    const total = filteredProducts.length;
    const startNum = total === 0 ? 0 : (state.page - 1) * ITEMS_PER_PAGE + 1;
    const endNum = Math.min(state.page * ITEMS_PER_PAGE, total);

    const info = $('tableInfo');
    if (info) info.textContent = `${total} produk ditemukan`;

    const text = $('paginationInfoText');
    if (text) {
        text.innerHTML = `Menampilkan <span class="font-medium text-slate-700">${startNum}</span> - <span class="font-medium text-slate-700">${endNum}</span> dari <span class="font-medium text-slate-700">${total}</span> produk`;
    }

    const mobile = $('pageInfoMobile');
    if (mobile) mobile.textContent = `Page ${state.page} of ${totalPages}`;

    const prev = $('btnPrevPage');
    const next = $('btnNextPage');
    if (prev) prev.disabled = state.page <= 1;
    if (next) next.disabled = total === 0 || state.page >= totalPages;

    const numbers = $('pageNumbers');
    if (numbers) {
        let startP = Math.max(1, state.page - 2);
        const endP = Math.min(totalPages, startP + 4);
        startP = Math.max(1, endP - 4);

        let html = '';
        for (let i = startP; i <= endP; i++) {
            html += i === state.page
                ? `<button class="w-8 h-8 rounded-lg bg-orange-500 text-white flex items-center justify-center text-xs font-medium shadow-sm">${i}</button>`
                : `<button onclick="goToPage(${i})" class="w-8 h-8 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center justify-center text-xs font-medium transition">${i}</button>`;
        }
        numbers.innerHTML = total === 0 ? '' : html;
    }
}

// =========================================================
// AKSI FILTER & PAGINATION
// =========================================================
window.setFilter = function (status) {
    state.status = status;
    refresh({ resetPage: true });
};

window.resetFilters = function () {
    state.search = '';
    state.kategori = 'all';
    state.status = 'all';
    const s = $('stokSearch');
    const k = $('kategoriFilter');
    if (s) s.value = '';
    if (k) k.value = 'all';
    refresh({ resetPage: true });
};

window.changePage = function (direction) {
    if (direction === 'prev') state.page--;
    else if (direction === 'next') state.page++;
    refresh(); // clamp halaman dilakukan di refresh()
};

window.goToPage = function (page) {
    state.page = Number(page) || 1;
    refresh();
};

// =========================================================
// UPDATE STOK
// =========================================================
async function updateStock(id, newVal) {
    const target = products.find((p) => String(p.id) === String(id));
    if (!target) return;

    newVal = Math.max(0, Math.floor(Number(newVal)) || 0);
    const oldVal = getStock(target);

    // tidak ada perubahan / input tidak valid -> kembalikan tampilan input
    if (newVal === oldVal) { refresh(); return; }

    const setLocal = (val) => {
        products = products.map((p) => (String(p.id) === String(id) ? { ...p, stok: val } : p));
    };

    // Optimistis. Halaman TIDAK di-reset supaya admin tetap di posisi yang sama.
    setLocal(newVal);
    refresh();

    try {
        await authReady;
        const { error } = await supabase.from('products').update({ stok: newVal }).eq('id', id);
        if (error) throw error;
        window.showStatus('Stok berhasil diperbarui', 'success');
    } catch (e) {
        // rollback hanya jika belum ada perubahan lain sesudahnya
        const now = products.find((p) => String(p.id) === String(id));
        if (now && getStock(now) === newVal) { setLocal(oldVal); refresh(); }
        window.showStatus('Gagal update stok di server: ' + (e.message || e), 'error');
    }
}

window.modStock = (id, val) => updateStock(id, val);

window.stepStock = function (id, delta) {
    const p = products.find((x) => String(x.id) === String(id));
    if (p) updateStock(id, getStock(p) + delta);
};

window.inputStock = function (id) {
    const el = $(`stok-${id}`);
    if (el) updateStock(id, el.value);
};

// =========================================================
// INIT
// =========================================================
function bindEvents() {
    const search = $('stokSearch');
    const kategori = $('kategoriFilter');

    if (search) {
        state.search = search.value.toLowerCase().trim(); // jika browser mengisi ulang nilai
        search.addEventListener('input', (e) => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                state.search = e.target.value.toLowerCase().trim();
                refresh({ resetPage: true });
            }, SEARCH_DEBOUNCE_MS);
        });
    }

    if (kategori) {
        kategori.addEventListener('change', (e) => {
            state.kategori = e.target.value;
            refresh({ resetPage: true });
        });
    }
}

bindEvents();
window.loadStok();
