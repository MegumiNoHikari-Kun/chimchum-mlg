import {
    supabase,
    authReady
} from '../supabase.js';

// =========================================================
// KONSTANTA
// =========================================================
const STORAGE_BUCKET = 'menu';
const MAX_INPUT_SIZE = 15 * 1024 * 1024;  // batas file asli yang boleh dipilih
const MAX_UPLOAD_SIZE = 2 * 1024 * 1024;  // batas setelah dikompres
const MAX_IMAGE_DIMENSION = 1280;         // sisi terpanjang (px)
const IMAGE_EXT = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp'
};
const LOW_STOCK = 5;
const FORM_FIELDS = ['p-id', 'p-nama', 'p-kategori', 'p-isi', 'p-harga', 'p-hpp', 'p-stok', 'p-foto', 'p-deskripsi'];
const VALIDATED_FIELDS = ['p-nama', 'p-harga', 'p-hpp', 'p-stok', 'p-foto'];

const FALLBACK_IMAGE = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">' +
    '<rect width="80" height="80" fill="#f1f5f9"/>' +
    '<path d="M28 50l8-10 6 7 4-5 6 8z" fill="#cbd5e1"/><circle cx="33" cy="32" r="4" fill="#cbd5e1"/>' +
    '</svg>'
);

// =========================================================
// STATE
// =========================================================
let products = [];
let filteredProducts = [];
let usingLocalStorage = false;
let isLoading = false;
let isSaving = false;
let isDeleting = false;
let isUploading = false;

let formSnapshot = '';
let lastFocusedElement = null;

const filters = {
    keyword: '',
    category: '',
    stock: 'all',
    sort: loadPref('produk_sort', 'nama-asc')
};

let currentPage = 1;
let itemsPerPage = Number(loadPref('produk_per_page', '10')) || 10;

// =========================================================
// HELPER UMUM
// =========================================================
const $ = (id) => document.getElementById(id);

function loadPref(key, fallback) {
    try {
        return localStorage.getItem(key) ?? fallback;
    } catch {
        return fallback;
    }
}

function savePref(key, value) {
    try {
        localStorage.setItem(key, String(value));
    } catch { /* abaikan */ }
}

function debounce(fn, wait = 200) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
    };
}

function rupiah(value) {
    const number = Number(value || 0);
    return 'Rp ' + number.toLocaleString('id-ID');
}

function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Sorot kata kunci pencarian dengan aman (escape tiap potongan)
function highlight(text, keyword) {
    const raw = String(text ?? '');
    if (!keyword) return escapeHtml(raw);

    const lower = raw.toLowerCase();
    let out = '';
    let i = 0;
    let j;
    while ((j = lower.indexOf(keyword, i)) !== -1) {
        out += escapeHtml(raw.slice(i, j)) + '<mark>' + escapeHtml(raw.slice(j, j + keyword.length)) + '</mark>';
        i = j + keyword.length;
    }
    return out + escapeHtml(raw.slice(i));
}

function titleCase(value) {
    return String(value || '').replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

// =========================================================
// GETTERS
// =========================================================
function getProductName(product) {
    return String(product?.nama ?? product?.name ?? '').trim();
}

function getProductCategory(product) {
    return String(product?.kategori ?? product?.category ?? '').trim();
}

function getProductIsi(product) {
    return String(product?.isi ?? '').trim();
}

function getProductPrice(product) {
    return Number(product?.harga ?? product?.price ?? 0);
}

function getProductHpp(product) {
    return Number(product?.hpp ?? 0);
}

function getProductStock(product) {
    return Number(product?.stok ?? product?.stock ?? 0);
}

function getProductImage(product) {
    return String(product?.foto ?? product?.image ?? '').trim();
}

function getProductDescription(product) {
    return String(product?.deskripsi ?? product?.desc ?? '').trim();
}

function getMargin(harga, hpp) {
    const price = Number(harga) || 0;
    const cost = Number(hpp) || 0;
    const amount = price - cost;
    const percent = price > 0 ? (amount / price) * 100 : 0;
    return { amount, percent };
}

function marginTone(percent, amount) {
    if (amount < 0) return 'text-red-600';
    if (percent < 20) return 'text-amber-600';
    return 'text-emerald-600';
}

function stockInfo(stock) {
    if (stock <= 0) {
        return { label: 'Habis', cls: 'bg-red-50 text-red-600 ring-red-200', dot: 'bg-red-500' };
    }
    if (stock <= LOW_STOCK) {
        return { label: 'Menipis', cls: 'bg-amber-50 text-amber-700 ring-amber-200', dot: 'bg-amber-500' };
    }
    return { label: 'Tersedia', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' };
}

function stockBadge(stock) {
    const info = stockInfo(stock);
    const text = stock <= 0 ? 'Habis' : stock <= LOW_STOCK ? `${stock} · Menipis` : `${stock} porsi`;
    return `<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1 ring-inset whitespace-nowrap ${info.cls}">
        <span class="w-1.5 h-1.5 rounded-full ${info.dot}"></span>${text}
    </span>`;
}

// =========================================================
// URL IMAGE
// =========================================================
function validImageUrl(url) {
    if (!url) return false;
    try {
        const parsed = new URL(url);
        return (parsed.protocol === 'http:' || parsed.protocol === 'https:');
    } catch {
        return false;
    }
}

// Fallback gambar rusak untuk semua <img data-fallback>
document.addEventListener('error', (event) => {
    const img = event.target;
    if (img?.tagName === 'IMG' && 'fallback' in img.dataset && !img.dataset.failed) {
        img.dataset.failed = '1';
        img.src = FALLBACK_IMAGE;
    }
}, true);

// =========================================================
// LOCAL STORAGE
// =========================================================
function saveLocalProducts() {
    try {
        localStorage.setItem('local_products', JSON.stringify(products));
    } catch (error) {
        console.warn('LocalStorage gagal:', error);
    }
}

// =========================================================
// TOAST & BANNER
// =========================================================
const TOAST_STYLES = {
    success: ['fa-circle-check', 'text-emerald-500'],
    warning: ['fa-triangle-exclamation', 'text-amber-500'],
    error: ['fa-circle-exclamation', 'text-red-500'],
    info: ['fa-circle-info', 'text-sky-500']
};

function showToast(message, type = 'success', duration = 3500) {
    const container = $('toastContainer');
    if (!container) return;

    const [icon, color] = TOAST_STYLES[type] || TOAST_STYLES.info;
    const el = document.createElement('div');
    el.className = 'toast-enter pointer-events-auto flex items-start gap-3 bg-white border border-slate-200 shadow-lg rounded-xl px-4 py-3 text-xs text-slate-700 w-full sm:w-80';
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML = `
        <i class="fa-solid ${icon} ${color} mt-0.5"></i>
        <p class="flex-1 leading-relaxed">${escapeHtml(message)}</p>
        <button type="button" class="text-slate-400 hover:text-slate-600 -mr-1" aria-label="Tutup notifikasi">
            <i class="fa-solid fa-xmark"></i>
        </button>
    `;

    const remove = () => {
        el.style.transition = 'opacity .2s';
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 200);
    };
    el.querySelector('button').addEventListener('click', remove);

    container.appendChild(el);
    // Maksimal 4 toast sekaligus
    while (container.children.length > 4) container.firstElementChild.remove();

    // Error ditampilkan lebih lama agar sempat dibaca
    if (duration > 0) setTimeout(remove, type === 'error' ? duration * 2 : duration);
}

// Nama lama dipertahankan agar kompatibel
function showStatus(message, type = 'success') {
    showToast(message, type);
}

function showBanner(message) {
    const box = $('statusBox');
    if (!box) return;
    box.className = 'mb-5 rounded-xl px-4 py-3 text-xs border bg-amber-50 text-amber-800 border-amber-200 flex flex-col sm:flex-row sm:items-center gap-2';
    box.innerHTML = `
        <div class="flex items-start gap-2 flex-1">
            <i class="fa-solid fa-triangle-exclamation mt-0.5"></i>
            <span>${escapeHtml(message)}</span>
        </div>
        <button type="button" data-action="retry"
            class="self-start sm:self-auto shrink-0 bg-white border border-amber-300 hover:bg-amber-100 text-amber-800 font-semibold px-3 py-1.5 rounded-lg transition">
            <i class="fa-solid fa-rotate mr-1"></i>Coba hubungkan lagi
        </button>
    `;
}

function hideBanner() {
    const box = $('statusBox');
    if (!box) return;
    box.className = 'hidden mb-5';
    box.innerHTML = '';
}

function hideStatus() {
    hideBanner();
}

function setConnectionStatus(connected, localMode = false) {
    const element = $('connectionStatus');
    if (!element) return;

    if (localMode) {
        element.className = 'text-[10px] text-amber-600 whitespace-nowrap';
        element.innerHTML = '<i class="fa-solid fa-hard-drive mr-1"></i><span class="hidden sm:inline">Mode </span>Lokal';
        return;
    }

    if (connected) {
        element.className = 'text-[10px] text-emerald-600 whitespace-nowrap';
        element.innerHTML = '<i class="fa-solid fa-circle-check mr-1"></i><span class="hidden sm:inline">Terhubung</span>';
    } else {
        element.className = 'text-[10px] text-red-600 whitespace-nowrap';
        element.innerHTML = '<i class="fa-solid fa-circle-xmark mr-1"></i>Tidak terhubung';
    }
}

function setRefreshSpinning(spinning) {
    const icon = $('refreshIcon');
    const btn = $('btnRefresh');
    if (icon) icon.classList.toggle('loading-spinner', spinning);
    if (btn) btn.disabled = spinning;
}

// =========================================================
// OVERLAY (dipakai modal produk & dialog konfirmasi)
// =========================================================
const hideTimers = {};

function isOverlayOpen(id) {
    const el = $(id);
    return !!el && !el.classList.contains('hidden');
}

function showOverlay(overlayId, contentId) {
    const overlay = $(overlayId);
    const content = $(contentId);
    if (!overlay || !content) return;

    clearTimeout(hideTimers[overlayId]);
    overlay.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');

    setTimeout(() => {
        overlay.classList.remove('opacity-0');
        content.classList.remove('scale-95', 'translate-y-4');
    }, 10);
}

function hideOverlay(overlayId, contentId, after) {
    const overlay = $(overlayId);
    const content = $(contentId);
    if (!overlay || !content) return;

    overlay.classList.add('opacity-0');
    content.classList.add('scale-95', 'translate-y-4');

    clearTimeout(hideTimers[overlayId]);
    hideTimers[overlayId] = setTimeout(() => {
        overlay.classList.add('hidden');
        if (!isOverlayOpen('productModalOverlay') && !isOverlayOpen('confirmOverlay')) {
            document.body.classList.remove('overflow-hidden');
        }
        after?.();
    }, 200);
}

// Tab tetap berputar di dalam modal yang paling atas
function trapFocus(event) {
    const containerId = isOverlayOpen('confirmOverlay')
        ? 'confirmContent'
        : isOverlayOpen('productModalOverlay') ? 'productModalContent' : null;
    if (!containerId) return;

    const container = $(containerId);
    const focusables = [...container.querySelectorAll(
        'button:not([disabled]), [href], input:not([type="hidden"]):not([tabindex="-1"]), select, textarea, [tabindex]:not([tabindex="-1"])'
    )].filter(el => el.offsetParent !== null);
    if (!focusables.length) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (!container.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
    } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

// =========================================================
// DIALOG KONFIRMASI
// =========================================================
let confirmResolver = null;
let confirmPrevFocus = null;

const CONFIRM_TONES = {
    danger: {
        wrap: 'w-12 h-12 rounded-full bg-rose-50 text-rose-500 flex items-center justify-center mb-4',
        ok: 'flex-1 bg-rose-600 hover:bg-rose-700 text-white font-semibold px-4 py-2.5 rounded-xl text-xs transition focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300'
    },
    warning: {
        wrap: 'w-12 h-12 rounded-full bg-amber-50 text-amber-500 flex items-center justify-center mb-4',
        ok: 'flex-1 bg-amber-500 hover:bg-amber-600 text-white font-semibold px-4 py-2.5 rounded-xl text-xs transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300'
    }
};

function confirmDialog({ title, message, confirmText = 'Ya', tone = 'danger', icon = 'fa-trash' } = {}) {
    return new Promise((resolve) => {
        if (confirmResolver) confirmResolver(false);
        confirmResolver = resolve;
        confirmPrevFocus = document.activeElement;

        const styles = CONFIRM_TONES[tone] || CONFIRM_TONES.danger;
        $('confirmTitle').textContent = title || 'Yakin?';
        $('confirmMessage').textContent = message || '';
        $('confirmOk').textContent = confirmText;
        $('confirmOk').className = styles.ok;
        $('confirmIconWrap').className = styles.wrap;
        $('confirmIcon').className = `fa-solid ${icon}`;

        showOverlay('confirmOverlay', 'confirmContent');
        // Fokus default ke "Batal" agar Enter tidak langsung menghapus
        setTimeout(() => $('confirmCancel')?.focus(), 50);
    });
}

function resolveConfirm(result) {
    if (!confirmResolver) return;
    const resolve = confirmResolver;
    confirmResolver = null;
    hideOverlay('confirmOverlay', 'confirmContent', () => confirmPrevFocus?.focus?.());
    resolve(result);
}

// =========================================================
// MODAL PRODUK
// =========================================================
function serializeForm() {
    return JSON.stringify(FORM_FIELDS.map(id => $(id)?.value ?? ''));
}

function isFormDirty() {
    return isOverlayOpen('productModalOverlay') && serializeForm() !== formSnapshot;
}

function openModal(mode = 'add', product = null) {
    lastFocusedElement = document.activeElement;
    resetForm();

    const isEdit = mode === 'edit' && product;

    if (isEdit) {
        $('p-id').value = product.id ?? '';
        $('p-nama').value = getProductName(product);
        $('p-kategori').value = getProductCategory(product);
        $('p-isi').value = getProductIsi(product);
        $('p-harga').value = getProductPrice(product) || '';
        $('p-hpp').value = getProductHpp(product) || '';
        $('p-stok').value = getProductStock(product);
        $('p-foto').value = getProductImage(product);
        $('p-deskripsi').value = getProductDescription(product);

        $('formTitle').innerHTML = '<i class="fa-solid fa-pen-to-square text-sky-500"></i> Edit Produk';
        $('formSubtitle').textContent = getProductName(product);
        $('btnSaveText').textContent = 'Simpan Perubahan';
    } else {
        $('formTitle').innerHTML = '<i class="fa-solid fa-plus-circle text-orange-500"></i> Tambah Produk';
        $('formSubtitle').innerHTML = 'Kolom bertanda <span class="text-red-500">*</span> wajib diisi.';
        $('btnSaveText').textContent = 'Simpan Produk';
    }

    refreshCategoryDatalist();
    updateMarginInfo();
    updateDescCounter();
    updatePhotoPreview();

    formSnapshot = serializeForm();
    showOverlay('productModalOverlay', 'productModalContent');
    $('productForm')?.scrollTo?.(0, 0);
    setTimeout(() => $('p-nama')?.focus(), 60);
}

function closeModal() {
    hideOverlay('productModalOverlay', 'productModalContent', () => {
        resetForm();
        lastFocusedElement?.focus?.();
    });
}

async function requestCloseModal() {
    if (isSaving) return;
    if (isUploading) {
        showToast('Tunggu upload foto selesai dulu.', 'warning');
        return;
    }
    if (isFormDirty()) {
        const ok = await confirmDialog({
            title: 'Buang perubahan?',
            message: 'Perubahan yang belum disimpan akan hilang.',
            confirmText: 'Buang',
            tone: 'warning',
            icon: 'fa-pen-to-square'
        });
        if (!ok) return;
    }
    closeModal();
}

function editProduct(id) {
    const product = products.find(item => String(item?.id) === String(id));
    if (!product) {
        showToast('Produk tidak ditemukan. Coba muat ulang data.', 'error');
        return;
    }
    openModal('edit', product);
}

// =========================================================
// FORM: RESET, VALIDASI, INFO
// =========================================================
function resetForm() {
    FORM_FIELDS.forEach(id => {
        const el = $(id);
        if (el) el.value = '';
    });
    clearFieldErrors();
    hidePhotoPreview();
    hideUploadMessage();
    if ($('p-foto-file')) $('p-foto-file').value = '';
    updateMarginInfo();
    updateDescCounter();
}

function readForm() {
    const nama = $('p-nama').value.trim();
    const kategori = $('p-kategori').value.trim().toLowerCase();
    const isi = $('p-isi').value.trim();
    const hargaRaw = $('p-harga').value.trim();
    const hppRaw = $('p-hpp').value.trim();
    const stokRaw = $('p-stok').value.trim();
    const foto = $('p-foto').value.trim();
    const deskripsi = $('p-deskripsi').value.trim();

    return {
        nama, kategori, isi, foto, deskripsi, hargaRaw,
        harga: Number(hargaRaw),
        hpp: hppRaw === '' ? 0 : Number(hppRaw),
        stok: stokRaw === '' ? 0 : Number(stokRaw)
    };
}

function validateForm() {
    const v = readForm();
    const errors = {};

    if (!v.nama) errors['p-nama'] = 'Nama produk wajib diisi.';
    if (v.hargaRaw === '' || !Number.isFinite(v.harga) || v.harga <= 0) errors['p-harga'] = 'Harga jual harus lebih dari 0.';
    if (!Number.isFinite(v.hpp) || v.hpp < 0) errors['p-hpp'] = 'HPP tidak boleh negatif.';
    if (!Number.isFinite(v.stok) || v.stok < 0 || !Number.isInteger(v.stok)) errors['p-stok'] = 'Stok harus angka bulat 0 atau lebih.';
    if (v.foto && !validImageUrl(v.foto)) errors['p-foto'] = 'URL foto harus diawali http:// atau https://';

    const payload = {
        nama: v.nama,
        kategori: v.kategori,
        isi: v.isi || null,
        harga: v.harga,
        hpp: v.hpp,
        stok: v.stok,
        foto: v.foto,
        deskripsi: v.deskripsi
    };

    return { payload, errors };
}

function setFieldError(id, message) {
    const input = $(id);
    const errorEl = $('err-' + id);
    if (input) {
        input.classList.toggle('field-error', !!message);
        if (message) input.setAttribute('aria-invalid', 'true');
        else input.removeAttribute('aria-invalid');
    }
    if (errorEl) {
        errorEl.textContent = message || '';
        errorEl.classList.toggle('hidden', !message);
    }
}

function clearFieldErrors() {
    VALIDATED_FIELDS.forEach(id => setFieldError(id, ''));
}

function showFieldErrors(errors) {
    VALIDATED_FIELDS.forEach(id => setFieldError(id, errors[id] || ''));
    const firstId = VALIDATED_FIELDS.find(id => errors[id]);
    if (firstId) $(firstId)?.focus();
}

function updateMarginInfo() {
    const el = $('marginInfo');
    if (!el) return;

    const harga = Number($('p-harga')?.value);
    const hppRaw = $('p-hpp')?.value.trim();
    const hpp = Number(hppRaw);

    if (!harga || harga <= 0) {
        el.className = 'rounded-xl px-3 py-2 text-[11px] bg-slate-50 text-slate-400 border border-slate-100';
        el.innerHTML = '<i class="fa-solid fa-calculator mr-1.5"></i>Isi harga jual &amp; HPP untuk melihat keuntungan per porsi.';
        return;
    }

    if (!hppRaw) {
        el.className = 'rounded-xl px-3 py-2 text-[11px] bg-slate-50 text-slate-500 border border-slate-100';
        el.innerHTML = `<i class="fa-solid fa-tag mr-1.5"></i>Harga jual <b>${rupiah(harga)}</b> · isi HPP untuk menghitung margin.`;
        return;
    }

    const { amount, percent } = getMargin(harga, hpp);
    let tone = 'bg-emerald-50 text-emerald-700 border-emerald-100';
    let icon = 'fa-arrow-trend-up';
    let note = '';

    if (amount < 0) {
        tone = 'bg-red-50 text-red-700 border-red-100';
        icon = 'fa-arrow-trend-down';
        note = ' — harga jual di bawah modal!';
    } else if (percent < 20) {
        tone = 'bg-amber-50 text-amber-700 border-amber-100';
        icon = 'fa-triangle-exclamation';
        note = ' — margin tipis';
    }

    el.className = `rounded-xl px-3 py-2 text-[11px] border ${tone}`;
    el.innerHTML = `<i class="fa-solid ${icon} mr-1.5"></i>${amount < 0 ? 'Rugi' : 'Untung'} <b>${rupiah(Math.abs(amount))}</b>/porsi · margin <b>${percent.toFixed(0)}%</b>${note}`;
}

function updateDescCounter() {
    const el = $('descCounter');
    const desc = $('p-deskripsi');
    if (!el || !desc) return;
    const len = desc.value.length;
    el.textContent = `${len}/500`;
    el.classList.toggle('text-amber-600', len >= 450);
}

function stepStock(delta) {
    const input = $('p-stok');
    if (!input) return;
    const current = parseInt(input.value, 10) || 0;
    input.value = Math.max(0, current + delta);
    setFieldError('p-stok', '');
}

// =========================================================
// KATEGORI
// =========================================================
function getCategories() {
    const set = new Set();
    products.forEach(p => {
        const c = getProductCategory(p).toLowerCase();
        if (c) set.add(c);
    });
    return [...set].sort((a, b) => a.localeCompare(b, 'id'));
}

function refreshCategoryFilter() {
    const select = $('filterCategory');
    if (!select) return;

    const categories = getCategories();
    if (filters.category && !categories.includes(filters.category)) filters.category = '';

    select.innerHTML = '<option value="">Semua kategori</option>' +
        categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(titleCase(c))}</option>`).join('');
    select.value = filters.category;
}

function refreshCategoryDatalist() {
    const list = $('kategoriList');
    if (!list) return;
    list.innerHTML = getCategories().map(c => `<option value="${escapeHtml(c)}">`).join('');
}

// =========================================================
// AUTH CHECK
// =========================================================
async function checkAuth() {
    try {
        await authReady;
        const { data, error } = await supabase.auth.getSession();
        if (error) {
            console.warn('getSession error:', error);
            return null;
        }
        return data?.session || null;
    } catch (error) {
        console.warn('Auth check gagal:', error);
        return null;
    }
}

// =========================================================
// LOAD PRODUCTS
// =========================================================
function renderSkeleton() {
    const tbody = $('prodTable');
    const cards = $('prodCards');
    const rows = Array.from({ length: 4 });

    if (tbody) {
        tbody.innerHTML = rows.map(() => `
            <tr>
                <td class="p-3"><div class="skeleton w-12 h-12 rounded-xl"></div></td>
                <td class="p-3"><div class="skeleton h-3 w-36 rounded mb-2"></div><div class="skeleton h-2 w-24 rounded"></div></td>
                <td class="p-3"><div class="skeleton h-4 w-16 rounded-lg"></div></td>
                <td class="p-3"><div class="skeleton h-3 w-12 rounded"></div></td>
                <td class="p-3"><div class="skeleton h-3 w-16 rounded ml-auto"></div></td>
                <td class="p-3"><div class="skeleton h-3 w-16 rounded ml-auto"></div></td>
                <td class="p-3"><div class="skeleton h-4 w-16 rounded-full"></div></td>
                <td class="p-3"><div class="skeleton h-8 w-16 rounded-lg ml-auto"></div></td>
            </tr>
        `).join('');
    }
    if (cards) {
        cards.innerHTML = rows.map(() => `
            <div class="flex gap-3 p-3 rounded-xl border border-slate-100">
                <div class="skeleton w-16 h-16 rounded-xl shrink-0"></div>
                <div class="flex-1"><div class="skeleton h-3 w-3/4 rounded mb-2"></div><div class="skeleton h-2 w-1/2 rounded mb-3"></div><div class="skeleton h-3 w-1/3 rounded"></div></div>
            </div>
        `).join('');
    }
    const count = $('productCount');
    if (count) count.textContent = 'Memuat produk...';
}

async function loadProducts({ silent = false } = {}) {
    if (isLoading) return;
    isLoading = true;

    if (!silent) renderSkeleton();
    setRefreshSpinning(true);

    try {
        await authReady;
        const { data, error } = await supabase
            .from('products')
            .select('*')
            .order('nama', { ascending: true });

        if (error) throw error;

        products = Array.isArray(data) ? data : [];
        usingLocalStorage = false;
        setConnectionStatus(true, false);
        hideBanner();
        saveLocalProducts();
    } catch (error) {
        console.error('Supabase load error:', error);
        let localData = [];

        try {
            const stored = localStorage.getItem('local_products');
            localData = stored ? JSON.parse(stored) : [];
        } catch {
            localData = [];
        }

        products = Array.isArray(localData) ? localData : [];
        usingLocalStorage = true;
        setConnectionStatus(false, true);
        showBanner(
            'Gagal mengambil data dari database, sementara memakai data lokal di browser ini. ' +
            'Perubahan yang dibuat sekarang TIDAK tersimpan ke database. (' + getErrorMessage(error) + ')'
        );
    } finally {
        isLoading = false;
        setRefreshSpinning(false);
        refreshCategoryFilter();
        applyFilters();
    }
}

// =========================================================
// FILTER, SORT, RENDER
// =========================================================
const SORTERS = {
    'nama-asc': (a, b) => getProductName(a).localeCompare(getProductName(b), 'id'),
    'nama-desc': (a, b) => getProductName(b).localeCompare(getProductName(a), 'id'),
    'harga-asc': (a, b) => getProductPrice(a) - getProductPrice(b),
    'harga-desc': (a, b) => getProductPrice(b) - getProductPrice(a),
    'stok-asc': (a, b) => getProductStock(a) - getProductStock(b),
    'margin-desc': (a, b) =>
        getMargin(getProductPrice(b), getProductHpp(b)).percent - getMargin(getProductPrice(a), getProductHpp(a)).percent,
    'terbaru': (a, b) => String(b?.created_at ?? '').localeCompare(String(a?.created_at ?? ''))
};

function matchesStock(stock) {
    switch (filters.stock) {
        case 'available': return stock > 0;
        case 'low': return stock > 0 && stock <= LOW_STOCK;
        case 'out': return stock <= 0;
        default: return true;
    }
}

function applyFilters({ resetPage = false } = {}) {
    const keyword = filters.keyword.toLowerCase();

    const list = products.filter(product => {
        if (filters.category && getProductCategory(product).toLowerCase() !== filters.category) return false;
        if (!matchesStock(getProductStock(product))) return false;
        if (keyword) {
            const haystack = [
                getProductName(product),
                getProductCategory(product),
                getProductIsi(product),
                getProductDescription(product)
            ].join(' ').toLowerCase();
            if (!haystack.includes(keyword)) return false;
        }
        return true;
    });

    list.sort(SORTERS[filters.sort] || SORTERS['nama-asc']);
    filteredProducts = list;

    if (resetPage) currentPage = 1;
    renderAll();
}

function hasActiveFilters() {
    return !!(filters.keyword || filters.category || filters.stock !== 'all');
}

function resetFilters() {
    filters.keyword = '';
    filters.category = '';
    filters.stock = 'all';
    if ($('p-search')) $('p-search').value = '';
    if ($('filterCategory')) $('filterCategory').value = '';
    if ($('filterStock')) $('filterStock').value = 'all';
    syncSearchUi();
    applyFilters({ resetPage: true });
}

function renderAll() {
    renderStats();
    renderActiveFilters();
    renderTable();
    renderPagination();
}

// Kompatibel dengan pemanggilan lama renderTable(list)
function renderTable() {
    const tbody = $('prodTable');
    const cards = $('prodCards');
    const list = filteredProducts;

    const totalPages = Math.max(1, Math.ceil(list.length / itemsPerPage));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    if (list.length === 0) {
        const empty = renderEmptyState();
        if (tbody) tbody.innerHTML = `<tr><td colspan="8">${empty}</td></tr>`;
        if (cards) cards.innerHTML = empty;
        return;
    }

    const start = (currentPage - 1) * itemsPerPage;
    const pageItems = list.slice(start, start + itemsPerPage);
    const keyword = filters.keyword.toLowerCase();

    if (tbody) tbody.innerHTML = pageItems.map(p => renderRow(p, keyword)).join('');
    if (cards) cards.innerHTML = pageItems.map(p => renderCard(p, keyword)).join('');
}

function renderEmptyState() {
    if (products.length === 0) {
        return `
            <div class="flex flex-col items-center text-center py-12 px-4">
                <div class="w-14 h-14 rounded-full bg-orange-50 flex items-center justify-center mb-3">
                    <i class="fa-solid fa-box-open text-orange-400 text-lg"></i>
                </div>
                <p class="text-sm font-semibold text-slate-700">Belum ada produk</p>
                <p class="text-[11px] text-slate-400 mt-1">Mulai isi katalog menu ChimChum.</p>
                <button type="button" data-action="add"
                    class="mt-4 bg-orange-500 hover:bg-orange-600 text-white font-semibold px-4 py-2 rounded-xl text-xs transition">
                    <i class="fa-solid fa-plus mr-1"></i>Tambah produk pertama
                </button>
            </div>
        `;
    }
    return `
        <div class="flex flex-col items-center text-center py-12 px-4">
            <div class="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-3">
                <i class="fa-solid fa-magnifying-glass text-slate-400 text-lg"></i>
            </div>
            <p class="text-sm font-semibold text-slate-700">Tidak ada produk yang cocok</p>
            <p class="text-[11px] text-slate-400 mt-1">Coba kata kunci lain atau ubah filter.</p>
            <button type="button" data-action="reset-filters"
                class="mt-4 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold px-4 py-2 rounded-xl text-xs transition">
                <i class="fa-solid fa-filter-circle-xmark mr-1"></i>Reset filter
            </button>
        </div>
    `;
}

function productView(product) {
    const image = getProductImage(product);
    const price = getProductPrice(product);
    const hpp = getProductHpp(product);
    const margin = getMargin(price, hpp);
    return {
        id: escapeHtml(product?.id ?? ''),
        name: getProductName(product) || '-',
        category: getProductCategory(product),
        isi: getProductIsi(product),
        desc: getProductDescription(product),
        price,
        hpp,
        stock: getProductStock(product),
        imageSrc: validImageUrl(image) ? image : FALLBACK_IMAGE,
        margin
    };
}

function actionButtons(id, name, size = 'w-8 h-8') {
    const deleting = isDeleting === id;
    return `
        <button type="button" data-action="edit" data-id="${id}" title="Edit" aria-label="Edit ${escapeHtml(name)}"
            class="${size} flex items-center justify-center bg-sky-50 text-sky-600 hover:bg-sky-100 rounded-lg transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300">
            <i class="fa-solid fa-pen text-xs pointer-events-none"></i>
        </button>
        <button type="button" data-action="delete" data-id="${id}" title="Hapus" aria-label="Hapus ${escapeHtml(name)}" ${deleting ? 'disabled' : ''}
            class="${size} flex items-center justify-center bg-rose-50 text-rose-600 hover:bg-rose-100 disabled:opacity-50 rounded-lg transition focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300">
            <i class="fa-solid ${deleting ? 'fa-circle-notch loading-spinner' : 'fa-trash'} text-xs pointer-events-none"></i>
        </button>
    `;
}

function hppCell(v) {
    if (!v.hpp) {
        return `<div class="text-slate-400">—</div><div class="text-[10px] text-slate-400">belum diisi</div>`;
    }
    return `<div class="text-slate-600">${rupiah(v.hpp)}</div>
        <div class="text-[10px] font-medium ${marginTone(v.margin.percent, v.margin.amount)}">margin ${v.margin.percent.toFixed(0)}%</div>`;
}

function renderRow(product, keyword) {
    const v = productView(product);
    return `
        <tr class="hover:bg-orange-50/40 transition ${v.stock <= 0 ? 'bg-red-50/30' : ''}">
            <td class="p-3">
                <img src="${escapeHtml(v.imageSrc)}" alt="" data-fallback loading="lazy"
                    class="w-12 h-12 object-cover rounded-xl shadow-sm border border-slate-100 bg-slate-100">
            </td>
            <td class="p-3">
                <button type="button" data-action="edit" data-id="${v.id}"
                    class="text-left font-semibold text-slate-800 hover:text-orange-600 transition">${highlight(v.name, keyword)}</button>
                ${v.desc ? `<div class="text-[10px] text-slate-400 mt-0.5 max-w-xs truncate" title="${escapeHtml(v.desc)}">${highlight(v.desc, keyword)}</div>` : ''}
            </td>
            <td class="p-3">
                ${v.category
                    ? `<span class="bg-slate-100 text-slate-600 px-2 py-1 rounded-lg text-[10px] font-medium whitespace-nowrap">${highlight(titleCase(v.category), keyword)}</span>`
                    : '<span class="text-slate-300">—</span>'}
            </td>
            <td class="p-3 text-slate-600">${v.isi ? highlight(v.isi, keyword) : '<span class="text-slate-300">—</span>'}</td>
            <td class="p-3 font-bold text-orange-600 text-right whitespace-nowrap">${rupiah(v.price)}</td>
            <td class="p-3 text-right whitespace-nowrap">${hppCell(v)}</td>
            <td class="p-3">${stockBadge(v.stock)}</td>
            <td class="p-3">
                <div class="flex gap-1 justify-end">${actionButtons(v.id, v.name)}</div>
            </td>
        </tr>
    `;
}

function renderCard(product, keyword) {
    const v = productView(product);
    const meta = [v.category ? titleCase(v.category) : '', v.isi].filter(Boolean);
    return `
        <article class="flex gap-3 p-3 rounded-xl border ${v.stock <= 0 ? 'border-red-100 bg-red-50/30' : 'border-slate-100 bg-white'}">
            <img src="${escapeHtml(v.imageSrc)}" alt="" data-fallback loading="lazy"
                class="w-16 h-16 object-cover rounded-xl border border-slate-100 bg-slate-100 shrink-0">
            <div class="flex-1 min-w-0">
                <div class="flex items-start justify-between gap-2">
                    <button type="button" data-action="edit" data-id="${v.id}"
                        class="text-left font-semibold text-[13px] text-slate-800 leading-snug line-clamp-2">${highlight(v.name, keyword)}</button>
                    ${stockBadge(v.stock)}
                </div>
                ${meta.length ? `<p class="text-[10px] text-slate-400 mt-0.5 truncate">${highlight(meta.join(' · '), keyword)}</p>` : ''}
                <div class="flex items-end justify-between gap-2 mt-2">
                    <div class="min-w-0">
                        <p class="font-bold text-orange-600 text-sm">${rupiah(v.price)}</p>
                        <p class="text-[10px] text-slate-400 truncate">
                            ${v.hpp
                                ? `HPP ${rupiah(v.hpp)} · <span class="${marginTone(v.margin.percent, v.margin.amount)} font-medium">${v.margin.percent.toFixed(0)}%</span>`
                                : 'HPP belum diisi'}
                        </p>
                    </div>
                    <div class="flex gap-1.5 shrink-0">${actionButtons(v.id, v.name, 'w-9 h-9')}</div>
                </div>
            </div>
        </article>
    `;
}

function renderStats() {
    const total = products.length;
    let low = 0;
    let out = 0;
    let marginSum = 0;
    let marginCount = 0;

    products.forEach(p => {
        const stock = getProductStock(p);
        if (stock <= 0) out++;
        else if (stock <= LOW_STOCK) low++;

        const price = getProductPrice(p);
        const hpp = getProductHpp(p);
        if (price > 0 && hpp > 0) {
            marginSum += getMargin(price, hpp).percent;
            marginCount++;
        }
    });

    if ($('statTotal')) $('statTotal').textContent = total;
    if ($('statLow')) $('statLow').textContent = low;
    if ($('statOut')) $('statOut').textContent = out;
    if ($('statMargin')) $('statMargin').textContent = marginCount ? `${(marginSum / marginCount).toFixed(0)}%` : '–';

    document.querySelectorAll('.stat-card').forEach(card => {
        const active = card.dataset.statFilter === filters.stock && filters.stock !== 'all';
        card.classList.toggle('ring-2', active);
        card.classList.toggle('ring-orange-300', active);
        card.setAttribute('aria-pressed', String(active));
    });
}

function renderActiveFilters() {
    const wrap = $('activeFilters');
    const text = $('activeFiltersText');
    if (!wrap || !text) return;

    if (!hasActiveFilters()) {
        wrap.classList.add('hidden');
        wrap.classList.remove('flex');
        return;
    }

    const parts = [];
    if (filters.keyword) parts.push(`"${filters.keyword}"`);
    if (filters.category) parts.push(titleCase(filters.category));
    if (filters.stock !== 'all') parts.push($('filterStock')?.selectedOptions?.[0]?.textContent || filters.stock);

    text.textContent = `${filteredProducts.length} hasil untuk ${parts.join(' · ')}`;
    wrap.classList.remove('hidden');
    wrap.classList.add('flex');
}

// =========================================================
// PAGINATION
// =========================================================
function getPageList(current, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

    const pages = [1];
    const start = Math.max(2, current - 1);
    const end = Math.min(total - 1, current + 1);
    if (start > 2) pages.push('…');
    for (let i = start; i <= end; i++) pages.push(i);
    if (end < total - 1) pages.push('…');
    pages.push(total);
    return pages;
}

function renderPagination() {
    const totalItems = filteredProducts.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));

    const count = $('productCount');
    if (count) {
        count.textContent = products.length === 0
            ? 'Belum ada produk'
            : `${products.length} produk di katalog`;
    }

    const info = $('paginationInfo');
    if (info) {
        if (totalItems === 0) {
            info.textContent = 'Tidak ada produk';
        } else {
            const start = (currentPage - 1) * itemsPerPage + 1;
            const end = Math.min(currentPage * itemsPerPage, totalItems);
            info.innerHTML = `Menampilkan <b class="text-slate-700">${start}–${end}</b> dari <b class="text-slate-700">${totalItems}</b>`;
        }
    }

    const nav = $('paginationNav');
    if (nav) nav.classList.toggle('invisible', totalPages <= 1);

    if ($('btnPrevPage')) $('btnPrevPage').disabled = currentPage <= 1;
    if ($('btnNextPage')) $('btnNextPage').disabled = currentPage >= totalPages;
    if ($('pageInfoMobile')) $('pageInfoMobile').textContent = `${currentPage} / ${totalPages}`;

    const container = $('pageNumbers');
    if (container) {
        container.innerHTML = getPageList(currentPage, totalPages).map(page => {
            if (page === '…') {
                return '<span class="w-8 h-8 flex items-center justify-center text-slate-400 text-xs">…</span>';
            }
            if (page === currentPage) {
                return `<button type="button" aria-current="page" class="w-8 h-8 rounded-lg bg-orange-500 text-white flex items-center justify-center text-xs font-semibold shadow-sm">${page}</button>`;
            }
            return `<button type="button" data-page="${page}" class="w-8 h-8 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center justify-center text-xs font-medium transition">${page}</button>`;
        }).join('');
    }
}

function goToPage(pageNumber) {
    const totalPages = Math.max(1, Math.ceil(filteredProducts.length / itemsPerPage));
    if (pageNumber < 1 || pageNumber > totalPages || pageNumber === currentPage) return;

    currentPage = pageNumber;
    renderTable();
    renderPagination();

    const top = $('listTop');
    if (top && top.getBoundingClientRect().top < 0) {
        top.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function changePage(direction) {
    goToPage(direction === 'prev' ? currentPage - 1 : currentPage + 1);
}

// =========================================================
// SEARCH
// =========================================================
function syncSearchUi() {
    const hasValue = !!$('p-search')?.value;
    $('btnClearProductSearch')?.classList.toggle('hidden', !hasValue);
    $('searchShortcut')?.classList.toggle('md:inline-block', !hasValue);
}

const runSearch = debounce(() => {
    filters.keyword = ($('p-search')?.value || '').trim();
    applyFilters({ resetPage: true });
}, 200);

function filterTable() {
    syncSearchUi();
    runSearch();
}

function clearSearch() {
    const input = $('p-search');
    if (input) {
        input.value = '';
        input.focus();
    }
    syncSearchUi();
    filters.keyword = '';
    applyFilters({ resetPage: true });
}

// =========================================================
// PHOTO PREVIEW
// =========================================================
function hidePhotoPreview() {
    $('photoPreview')?.classList.add('hidden');
    $('btnPickPhoto')?.classList.remove('hidden');
    const img = $('previewImage');
    if (img) {
        img.onload = null;
        img.onerror = null;
        img.removeAttribute('src');
    }
}

function updatePhotoPreview() {
    const url = $('p-foto')?.value.trim();
    const image = $('previewImage');
    if (!image) return;

    if (!url || !validImageUrl(url)) {
        hidePhotoPreview();
        return;
    }

    image.onload = () => {
        $('photoPreview')?.classList.remove('hidden');
        $('btnPickPhoto')?.classList.add('hidden');
    };
    image.onerror = () => {
        hidePhotoPreview();
        showUploadMessage('Gambar dari URL ini tidak bisa dimuat.', 'error');
    };
    image.src = url;
}

const debouncedPreview = debounce(updatePhotoPreview, 350);

function removePhoto() {
    if ($('p-foto')) $('p-foto').value = '';
    setFieldError('p-foto', '');
    hidePhotoPreview();
    showUploadMessage('Foto dilepas dari produk.', 'info');
}

// =========================================================
// UPLOAD FOTO KE SUPABASE STORAGE
// =========================================================
function showUploadMessage(message, type = 'success') {
    const el = $('uploadMessage');
    if (!el) return;

    el.classList.remove('hidden', 'text-emerald-600', 'text-red-600', 'text-slate-500');
    el.classList.add(type === 'success' ? 'text-emerald-600' : type === 'error' ? 'text-red-600' : 'text-slate-500');
    el.textContent = message;
}

function hideUploadMessage() {
    $('uploadMessage')?.classList.add('hidden');
}

function setUploadState(uploading, label = 'Mengunggah...') {
    isUploading = uploading;

    const progress = $('uploadProgress');
    const text = $('uploadLabelText');
    const saveBtn = $('btnSave');

    if (text) text.textContent = label;
    progress?.classList.toggle('hidden', !uploading);
    if (saveBtn) saveBtn.disabled = uploading || isSaving;
}

class UploadValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'UploadValidationError';
    }
}

function formatBytes(bytes) {
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function validateImageFile(file) {
    if (!IMAGE_EXT[file.type]) {
        throw new UploadValidationError('Format file harus JPG, PNG, atau WEBP.');
    }
    if (file.size > MAX_INPUT_SIZE) {
        throw new UploadValidationError(
            `File terlalu besar (${formatBytes(file.size)}). Maksimal ${formatBytes(MAX_INPUT_SIZE)}.`
        );
    }
}

function canvasToBlob(canvas, type, quality) {
    return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

async function compressImage(file) {
    let bitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch {
        throw new UploadValidationError('File gambar tidak bisa dibaca. Coba file lain.');
    }

    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));

    // Sudah kecil dan dimensinya aman: langsung pakai file asli
    if (scale === 1 && file.size <= 500 * 1024) {
        bitmap.close?.();
        return file;
    }

    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; // latar putih (PNG transparan tidak jadi hitam)
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    // Turunkan kualitas bertahap sampai ukuran <= 2 MB
    for (const quality of [0.82, 0.7, 0.55, 0.4]) {
        let blob = await canvasToBlob(canvas, 'image/webp', quality);
        if (!blob || blob.type !== 'image/webp') {
            blob = await canvasToBlob(canvas, 'image/jpeg', quality); // fallback browser lama
        }
        if (blob && blob.size <= MAX_UPLOAD_SIZE) {
            return new File([blob], 'menu.' + IMAGE_EXT[blob.type], { type: blob.type });
        }
    }

    throw new UploadValidationError('Gambar masih terlalu besar setelah dikompres. Coba foto dengan resolusi lebih kecil.');
}

function buildFilePath(file) {
    const rand = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10);
    return `${Date.now()}-${rand}.${IMAGE_EXT[file.type]}`;
}

async function uploadProductImage(file) {
    await authReady;

    const filePath = buildFilePath(file);

    const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(filePath, file, {
            cacheControl: '3600',
            upsert: false,
            contentType: file.type
        });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(filePath);

    return { path: filePath, url: data.publicUrl };
}

function formatStorageError(error) {
    const message = getErrorMessage(error);
    const lower = message.toLowerCase();

    if (lower.includes('bucket not found')) {
        return `Bucket "${STORAGE_BUCKET}" tidak ditemukan di Supabase Storage.`;
    }
    if (lower.includes('row-level security') || lower.includes('violates') || lower.includes('unauthorized')) {
        return 'Upload ditolak oleh policy Storage. Pastikan sudah login dan policy INSERT untuk bucket menu sudah dibuat.';
    }
    if (lower.includes('payload too large') || lower.includes('exceeded')) {
        return 'Ukuran file melebihi batas bucket.';
    }
    if (lower.includes('failed to fetch') || lower.includes('network')) {
        return 'Koneksi terputus saat upload. Periksa internet lalu coba lagi.';
    }
    return 'Upload gagal: ' + message;
}

async function processFile(originalFile) {
    if (!originalFile || isUploading) return;

    if (usingLocalStorage) {
        showUploadMessage('Upload foto butuh koneksi database. Tempel URL gambar secara manual.', 'error');
        return;
    }

    hideUploadMessage();
    setFieldError('p-foto', '');

    try {
        validateImageFile(originalFile);

        setUploadState(true, 'Memproses...');
        const file = await compressImage(originalFile);

        setUploadState(true, 'Mengunggah...');
        const { url } = await uploadProductImage(file);

        $('p-foto').value = url;
        updatePhotoPreview();

        const sizeInfo = file === originalFile
            ? formatBytes(file.size)
            : `${formatBytes(originalFile.size)} → ${formatBytes(file.size)}`;
        showUploadMessage(`Foto berhasil diupload (${sizeInfo}).`, 'success');
    } catch (error) {
        if (error instanceof UploadValidationError) {
            console.warn('Upload ditolak:', error.message);
            showUploadMessage(error.message, 'error');
        } else {
            console.error('UPLOAD ERROR:', error);
            showUploadMessage(formatStorageError(error), 'error');
        }
    } finally {
        setUploadState(false);
    }
}

async function handleFileSelected(event) {
    const input = event.target;
    const file = input.files?.[0];
    await processFile(file);
    input.value = '';
}

function pickPhoto() {
    if (isUploading) return;
    $('p-foto-file')?.click();
}

async function copyPhotoUrl() {
    const input = $('p-foto');
    const url = input?.value.trim();

    if (!url) {
        showUploadMessage('Belum ada URL foto.', 'error');
        return;
    }

    try {
        await navigator.clipboard.writeText(url);
        showUploadMessage('URL berhasil disalin.', 'success');
    } catch {
        input.select();
        showUploadMessage('Tekan Ctrl+C untuk menyalin.', 'info');
    }
}

// =========================================================
// SAVE PRODUCT
// =========================================================
function setSavingState(saving) {
    isSaving = saving;
    const button = $('btnSave');
    const icon = $('btnSaveIcon');
    const text = $('btnSaveText');
    const isEdit = !!$('p-id')?.value.trim();

    if (button) button.disabled = saving || isUploading;
    if (icon) icon.className = saving ? 'fa-solid fa-circle-notch loading-spinner' : 'fa-solid fa-floppy-disk';
    if (text) text.textContent = saving ? 'Menyimpan...' : (isEdit ? 'Simpan Perubahan' : 'Simpan Produk');
    $('btnCancelModal') && ($('btnCancelModal').disabled = saving);
}

async function saveProduct() {
    if (isSaving) return;
    if (isUploading) {
        showToast('Tunggu upload foto selesai dulu.', 'warning');
        return;
    }

    const { payload, errors } = validateForm();
    if (Object.keys(errors).length) {
        showFieldErrors(errors);
        showToast('Periksa kembali isian yang ditandai merah.', 'error', 3000);
        return;
    }
    clearFieldErrors();

    const id = $('p-id')?.value.trim();
    const productName = payload.nama;

    setSavingState(true);

    try {
        // LOCAL STORAGE MODE
        if (usingLocalStorage) {
            if (id) {
                const index = products.findIndex(item => String(item.id) === String(id));
                if (index === -1) throw new Error('Produk tidak ditemukan di Local Storage.');
                products[index] = { ...products[index], ...payload };
            } else {
                const newId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
                products.unshift({ id: newId, ...payload, created_at: new Date().toISOString() });
            }

            saveLocalProducts();
            formSnapshot = serializeForm();
            closeModal();
            refreshCategoryFilter();
            applyFilters();
            showToast(`"${productName}" disimpan di data lokal (belum masuk database).`, 'warning');
            return;
        }

        // SUPABASE MODE
        await checkAuth();

        if (id) {
            const { data: updatedRows, error: updateError } = await supabase
                .from('products')
                .update(payload)
                .eq('id', id)
                .select('*');

            if (updateError) throw updateError;
            if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
                throw new Error('UPDATE gagal. ID tidak ditemukan atau RLS policy memblokir.');
            }

            formSnapshot = serializeForm();
            closeModal();
            showToast(`"${productName}" berhasil diperbarui.`, 'success');
            await loadProducts({ silent: true });
            return;
        }

        const { data: insertedRows, error: insertError } = await supabase
            .from('products')
            .insert([payload])
            .select('*');

        if (insertError) throw insertError;
        if (!Array.isArray(insertedRows) || insertedRows.length === 0) {
            throw new Error('INSERT tidak menghasilkan row baru.');
        }

        formSnapshot = serializeForm();
        closeModal();
        showToast(`"${productName}" berhasil ditambahkan.`, 'success');
        await loadProducts({ silent: true });
    } catch (error) {
        console.error('SAVE PRODUCT ERROR:', error);
        showToast(formatSupabaseError(error), 'error');
    } finally {
        setSavingState(false);
    }
}

// =========================================================
// DELETE PRODUCT
// =========================================================
async function deleteProduct(id) {
    if (isDeleting) return;

    const product = products.find(item => String(item?.id) === String(id));
    const productName = product ? getProductName(product) : 'produk ini';

    const ok = await confirmDialog({
        title: 'Hapus produk?',
        message: `"${productName}" akan dihapus permanen dan tidak bisa dikembalikan.`,
        confirmText: 'Ya, hapus',
        tone: 'danger',
        icon: 'fa-trash'
    });
    if (!ok) return;

    isDeleting = String(id);
    renderTable(); // tampilkan spinner pada tombol hapus

    try {
        if (usingLocalStorage) {
            const before = products.length;
            products = products.filter(item => String(item.id) !== String(id));
            if (products.length === before) throw new Error('Produk tidak ditemukan.');

            saveLocalProducts();
            showToast(`"${productName}" dihapus dari data lokal.`, 'success');
            return;
        }

        const { data: deletedRows, error: deleteError } = await supabase
            .from('products')
            .delete()
            .eq('id', id)
            .select('*');

        if (deleteError) throw deleteError;
        if (!Array.isArray(deletedRows) || deletedRows.length === 0) {
            throw new Error('Gagal menghapus. ID tidak ditemukan atau RLS policy memblokir.');
        }

        // Hapus langsung dari daftar agar terasa cepat, lalu sinkron ulang
        products = products.filter(item => String(item.id) !== String(id));
        showToast(`"${productName}" berhasil dihapus.`, 'success');
        loadProducts({ silent: true });
    } catch (error) {
        console.error('DELETE PRODUCT ERROR:', error);
        showToast(formatSupabaseError(error), 'error');
    } finally {
        isDeleting = false;
        refreshCategoryFilter();
        applyFilters();
    }
}

// =========================================================
// ERROR FORMATTER
// =========================================================
function getErrorMessage(error) {
    if (!error) return 'Unknown error';
    return (error.message || error.error_description || error.details || error.hint || String(error));
}

function formatSupabaseError(error) {
    const message = getErrorMessage(error);
    const lower = message.toLowerCase();

    if (lower.includes('row-level security') || lower.includes('permission denied') || lower.includes('rls')) {
        return 'Supabase menolak operasi karena RLS. Periksa policy SELECT, INSERT, UPDATE, dan DELETE pada tabel products.';
    }
    if (lower.includes('jwt') || lower.includes('invalid token') || lower.includes('token is expired')) {
        return 'Sesi login sudah habis. Silakan login kembali.';
    }
    if (lower.includes('duplicate') || lower.includes('unique')) {
        return 'Data duplikat. Nilai yang harus unik sudah digunakan.';
    }
    if (lower.includes('column') && lower.includes('does not exist')) {
        return 'Kolom database tidak ditemukan. Pastikan nama kolom products sesuai dengan kode.';
    }
    if (lower.includes('relation') && lower.includes('does not exist')) {
        return 'Tabel products tidak ditemukan di Database.';
    }
    if (lower.includes('failed to fetch') || lower.includes('network')) {
        return 'Koneksi internet terputus. Periksa jaringan lalu coba lagi.';
    }
    return 'Operasi database gagal: ' + message;
}

// =========================================================
// EVENTS
// =========================================================
function handleListClick(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const action = button.dataset.action;

    if (action === 'add') return openModal('add');
    if (action === 'reset-filters') return resetFilters();

    const id = button.dataset.id;
    if (!id) {
        showToast('ID produk kosong. Periksa kolom id di database.', 'error');
        return;
    }

    if (action === 'edit') editProduct(id);
    if (action === 'delete') deleteProduct(id);
}

// Form
$('btnSave')?.addEventListener('click', saveProduct);
$('productForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    saveProduct();
});
$('p-foto')?.addEventListener('input', () => {
    setFieldError('p-foto', '');
    hideUploadMessage();
    debouncedPreview();
});
$('p-foto-file')?.addEventListener('change', handleFileSelected);
$('btnCopyUrl')?.addEventListener('click', copyPhotoUrl);
$('btnPickPhoto')?.addEventListener('click', pickPhoto);
$('btnChangePhoto')?.addEventListener('click', pickPhoto);
$('btnRemovePhoto')?.addEventListener('click', removePhoto);

['p-harga', 'p-hpp'].forEach(id => {
    $(id)?.addEventListener('input', () => {
        setFieldError(id, '');
        updateMarginInfo();
    });
});
['p-nama', 'p-stok'].forEach(id => {
    $(id)?.addEventListener('input', () => setFieldError(id, ''));
});
$('p-deskripsi')?.addEventListener('input', updateDescCounter);

document.querySelectorAll('[data-stok-step]').forEach(btn => {
    btn.addEventListener('click', () => stepStock(Number(btn.dataset.stokStep)));
});

// Cegah scroll mouse mengubah angka secara tidak sengaja
document.querySelectorAll('input[type="number"]').forEach(input => {
    input.addEventListener('wheel', () => {
        if (document.activeElement === input) input.blur();
    }, { passive: true });
});

// Enter di input satu baris = simpan (kecuali kategori, agar pilihan datalist aman)
$('productForm')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    const target = e.target;
    if (target.tagName === 'INPUT' && target.id !== 'p-kategori') {
        e.preventDefault();
        saveProduct();
    }
});

// Drag & drop foto
const dropZone = $('dropZone');
if (dropZone) {
    ['dragenter', 'dragover'].forEach(type => dropZone.addEventListener(type, (e) => {
        e.preventDefault();
        if (!isUploading) dropZone.classList.add('dragover');
    }));
    ['dragleave', 'dragend'].forEach(type => dropZone.addEventListener(type, (e) => {
        if (e.type === 'dragleave' && dropZone.contains(e.relatedTarget)) return;
        dropZone.classList.remove('dragover');
    }));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        processFile(e.dataTransfer?.files?.[0]);
    });
}

// Tempel gambar dari clipboard saat modal terbuka
document.addEventListener('paste', (e) => {
    if (!isOverlayOpen('productModalOverlay') || isOverlayOpen('confirmOverlay')) return;
    const file = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/'));
    if (file) {
        e.preventDefault();
        processFile(file);
    }
});

// Modal
$('btnOpenAddModal')?.addEventListener('click', () => openModal('add'));
$('btnCloseModal')?.addEventListener('click', requestCloseModal);
$('btnCancelModal')?.addEventListener('click', requestCloseModal);
$('productModalOverlay')?.addEventListener('mousedown', (e) => {
    if (e.target.id === 'productModalOverlay') requestCloseModal();
});

// Dialog konfirmasi
$('confirmOk')?.addEventListener('click', () => resolveConfirm(true));
$('confirmCancel')?.addEventListener('click', () => resolveConfirm(false));
$('confirmOverlay')?.addEventListener('mousedown', (e) => {
    if (e.target.id === 'confirmOverlay') resolveConfirm(false);
});

// Banner
$('statusBox')?.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="retry"]')) loadProducts();
});

// Search, filter, sort, refresh
$('p-search')?.addEventListener('input', filterTable);
$('btnClearProductSearch')?.addEventListener('click', clearSearch);
$('btnResetFilters')?.addEventListener('click', resetFilters);
$('btnRefresh')?.addEventListener('click', () => loadProducts());

$('filterCategory')?.addEventListener('change', (e) => {
    filters.category = e.target.value;
    applyFilters({ resetPage: true });
});
$('filterStock')?.addEventListener('change', (e) => {
    filters.stock = e.target.value;
    applyFilters({ resetPage: true });
});
$('sortBy')?.addEventListener('change', (e) => {
    filters.sort = e.target.value;
    savePref('produk_sort', filters.sort);
    applyFilters({ resetPage: true });
});

document.querySelectorAll('.stat-card').forEach(card => {
    card.addEventListener('click', () => {
        const value = card.dataset.statFilter;
        filters.stock = (value === filters.stock) ? 'all' : value;
        if ($('filterStock')) $('filterStock').value = filters.stock;
        applyFilters({ resetPage: true });
    });
});

// Pagination
$('btnPrevPage')?.addEventListener('click', () => changePage('prev'));
$('btnNextPage')?.addEventListener('click', () => changePage('next'));
$('pageNumbers')?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-page]');
    if (!button) return;
    goToPage(parseInt(button.dataset.page, 10));
});
$('perPage')?.addEventListener('change', (e) => {
    itemsPerPage = Number(e.target.value) || 10;
    savePref('produk_per_page', itemsPerPage);
    applyFilters({ resetPage: true });
});

// Daftar produk (tabel & kartu)
$('prodTable')?.addEventListener('click', handleListClick);
$('prodCards')?.addEventListener('click', handleListClick);

// Keyboard global
document.addEventListener('keydown', (e) => {
    const confirmOpen = isOverlayOpen('confirmOverlay');
    const modalOpen = isOverlayOpen('productModalOverlay');

    if (e.key === 'Escape') {
        if (confirmOpen) { e.preventDefault(); resolveConfirm(false); return; }
        if (modalOpen) { e.preventDefault(); requestCloseModal(); return; }
        if (document.activeElement === $('p-search') && $('p-search').value) { clearSearch(); return; }
    }

    if (e.key === 'Tab' && (confirmOpen || modalOpen)) {
        trapFocus(e);
        return;
    }

    if (modalOpen && !confirmOpen && (e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        saveProduct();
        return;
    }

    if (!modalOpen && !confirmOpen && e.key === '/' && !isTypingTarget(e.target)) {
        e.preventDefault();
        $('p-search')?.focus();
    }
});

// Peringatan sebelum meninggalkan halaman jika ada perubahan belum disimpan
window.addEventListener('beforeunload', (e) => {
    if (isUploading || isSaving || isFormDirty()) {
        e.preventDefault();
        e.returnValue = '';
    }
});

// =========================================================
// INITIALIZE
// =========================================================
(async function init() {
    if ($('sortBy')) {
        if (!SORTERS[filters.sort]) filters.sort = 'nama-asc';
        $('sortBy').value = filters.sort;
    }
    if ($('perPage')) {
        if (![5, 10, 25, 50].includes(itemsPerPage)) itemsPerPage = 10;
        $('perPage').value = String(itemsPerPage);
    }

    try {
        await authReady;
        await checkAuth();
        await loadProducts();
    } catch (error) {
        console.error('INITIALIZATION ERROR:', error);
        showToast(getErrorMessage(error), 'error');
    }
})();
