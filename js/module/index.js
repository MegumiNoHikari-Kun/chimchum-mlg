import { supabase, authReady } from '../supabase.js';
import {
    getCachedStore, fetchStoreSettings, isStoreOpen, displayTime,
    formatWaDisplay, buildMapEmbedUrl, safeUrl
} from './store-settings.js';

const sampleProducts = [
    { id: 1, name: 'Dimsum Mentai Mix (4 Pcs)', category: 'dimsum', price: 22000, desc: 'Dimsum lembut dengan saus mentai gurih dibakar sempurna.', image: 'https://images.unsplash.com/photo-1541696432-82c6da8ce7bf?w=500&auto=format&fit=crop&q=60', stock: 15 },
    { id: 2, name: 'Dimsum Udang Keju (4 Pcs)', category: 'dimsum', price: 24000, desc: 'Dimsum udang segar dengan lelehan keju mozzarella di dalam.', image: 'https://images.unsplash.com/photo-1496116218417-1a781b1c416c?w=500&auto=format&fit=crop&q=60', stock: 0 },
    { id: 3, name: 'Ayam Krispy Dada Spesial', category: 'chicken', price: 25000, desc: 'Dada ayam pilihan dilapisi tepung bumbu renyah gurih.', image: 'https://images.unsplash.com/photo-1626645738196-c2a7c87a8f58?w=500&auto=format&fit=crop&q=60', stock: 8 },
    { id: 4, name: 'Ayam Krispy Paha Spicy', category: 'chicken', price: 23000, desc: 'Paha bawah juicy berbalut bumbu spicy pedas menggigit.', image: 'https://images.unsplash.com/photo-1562967914-608f82629710?w=500&auto=format&fit=crop&q=60', stock: 12 },
    { id: 5, name: 'Es Teh Manis Segar', category: 'drink', price: 5000, desc: 'Teh melati pilihan disajikan dingin menyegarkan.', image: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=500&auto=format&fit=crop&q=60', stock: 50 },
    { id: 6, name: 'Lemon Tea Dingin', category: 'drink', price: 8000, desc: 'Perpaduan teh segar dan perasan buah lemon asli.', image: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=500&auto=format&fit=crop&q=60', stock: 0 }
];

// Pengaturan toko dari tabel store_settings (lihat Master Toko).
// Mulai dari cache browser supaya tampilan langsung benar, lalu diperbarui dari database.
let store = getCachedStore();
const CART_KEY = 'chimchum_cart';
const CUSTOMER_KEY = 'chimchum_customer';
const PLACEHOLDER_IMG = 'https://placehold.co/500x375/ff6b35/ffffff?text=ChimChum';
const QRIS_IMG = './assets/ChimChum-QRISSHOPEE.png';

window.products = [];
let productsFromDb = false;
let cart = loadJSON(CART_KEY, []);
let currentFilter = 'all';
let searchQuery = '';
let pendingOrderData = null;
let appliedVoucher = null;
let isSubmitting = false;

/* =========================================================
   HELPERS
   ========================================================= */
const $ = (id) => document.getElementById(id);

function rp(n) {
    return `Rp ${Number(n || 0).toLocaleString('id-ID')}`;
}

// Cegah HTML/script dari data (nama pelanggan, produk, dll) ikut dieksekusi
function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function loadJSON(key, fallback) {
    try {
        const v = JSON.parse(localStorage.getItem(key));
        return v ?? fallback;
    } catch {
        return fallback;
    }
}

function saveJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage penuh / diblokir */ }
}

function findProduct(id) {
    return window.products.find(p => String(p.id) === String(id));
}

function findCartItem(id) {
    return cart.find(i => String(i.id) === String(id));
}

function cartSubtotal() {
    return cart.reduce((s, i) => s + i.price * i.qty, 0);
}

function cartQty() {
    return cart.reduce((s, i) => s + i.qty, 0);
}

function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

let toastTimer = null;
function showToast(text) {
    const el = $('toast');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('opacity-0', 'translate-y-2');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('opacity-0', 'translate-y-2'), 1800);
}

async function copyText(text, label = 'Disalin') {
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
    }
    showToast(`✓ ${label}`);
}
window.copyText = copyText;

function fieldError(el, message) {
    showToast(message);
    if (!el) return;
    el.classList.add('shake', 'border-red-400', 'ring-2', 'ring-red-200');
    el.focus();
    setTimeout(() => el.classList.remove('shake'), 400);
    el.addEventListener('input', () => el.classList.remove('border-red-400', 'ring-2', 'ring-red-200'), { once: true });
}

/* =========================================================
   MODAL HELPERS (scroll lock, klik backdrop, tombol Esc)
   ========================================================= */
const MODAL_IDS = ['notification-modal', 'payment-modal', 'tracker-modal', 'cart-modal'];

function isOpen(id) {
    const m = $(id);
    return m && !m.classList.contains('hidden');
}

function syncScrollLock() {
    document.body.classList.toggle('overflow-hidden', MODAL_IDS.some(isOpen));
}

function openModal(id) {
    $(id)?.classList.remove('hidden');
    syncScrollLock();
}

function closeModal(id) {
    $(id)?.classList.add('hidden');
    syncScrollLock();
}

const MODAL_CLOSERS = {
    'notification-modal': () => window.closeNotification(),
    'payment-modal': () => window.closePaymentModal(),
    'tracker-modal': () => closeModal('tracker-modal'),
    'cart-modal': () => closeModal('cart-modal')
};

MODAL_IDS.forEach(id => {
    $(id)?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) MODAL_CLOSERS[id]();
    });
});

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const top = MODAL_IDS.find(isOpen);
    if (top) MODAL_CLOSERS[top]();
});

/* =========================================================
   STATUS BUKA / TUTUP
   ========================================================= */
function updateOpenStatus() {
    const open = isStoreOpen(store);
    const label = open
        ? `Buka sekarang · tutup ${displayTime(store.close_time)}`
        : `Sedang tutup · buka ${displayTime(store.open_time)}`;

    document.querySelectorAll('.open-status').forEach(el => {
        const dark = el.dataset.theme === 'dark';
        const color = open
            ? (dark ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30' : 'bg-emerald-50 text-emerald-700 border-emerald-200')
            : (dark ? 'bg-red-500/15 text-red-300 border-red-400/30' : 'bg-red-50 text-red-600 border-red-200');
        el.className = `open-status inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full border ${color}`;
        el.innerHTML = `<span class="w-1.5 h-1.5 rounded-full ${open ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}"></span>${label}`;
    });
}

/* =========================================================
   PENGATURAN TOKO → TAMPILAN
   ========================================================= */
function applyStoreSettings() {
    const hours = `${displayTime(store.open_time)} – ${displayTime(store.close_time)}`;
    const days = String(store.open_days || '').trim();
    const text = {
        ...store,
        wa_display: formatWaDisplay(store.wa_number),
        hours_text: `${days ? days.charAt(0).toLowerCase() + days.slice(1) + ' ' : ''}${hours}`,
        hours_text_cap: `${days ? days + ' ' : ''}${hours}`,
        hero_info_sub: [store.services, store.area_label].filter(Boolean).join(' · ')
    };

    // Teks biasa (pakai textContent → aman dari HTML/script)
    document.querySelectorAll('[data-store]').forEach(el => {
        const value = text[el.dataset.store];
        if (value === undefined) return;
        el.textContent = value;
        el.classList.toggle('hidden', value === '');
    });

    // Link WhatsApp
    document.querySelectorAll('[data-store-wa]').forEach(el => {
        el.href = `https://wa.me/${store.wa_number}`;
    });

    // Link luar (Maps, ShopeeFood, GrabFood, GoFood) — sembunyikan kalau kosong
    document.querySelectorAll('[data-store-link]').forEach(el => {
        const url = safeUrl(store[el.dataset.storeLink]);
        el.classList.toggle('hidden', !url);
        if (url) el.href = url;
    });
    const apps = document.querySelectorAll('#delivery-apps [data-store-link]');
    const anyApp = [...apps].some(a => !a.classList.contains('hidden'));
    $('delivery-apps')?.classList.toggle('hidden', !anyApp);

    // Peta (hanya ganti kalau berubah, supaya iframe tidak reload terus)
    const map = $('store-map');
    const embed = buildMapEmbedUrl(store);
    if (map && map.getAttribute('src') !== embed) map.setAttribute('src', embed);

    const yearEl = $('footer-year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    document.title = `${store.store_name} - Dimsum Mentai & Crispy Chicken`;
    updateOpenStatus();
}

async function loadStoreSettings() {
    await authReady;
    store = await fetchStoreSettings(supabase);
    applyStoreSettings();
}

/* =========================================================
   VOUCHER
   ========================================================= */
function computeVoucherDiscount(voucher, subtotal) {
    if (!voucher || subtotal <= 0) return 0;
    if (subtotal < Number(voucher.min_purchase || 0)) return 0;

    let disc = voucher.discount_type === 'percent'
        ? subtotal * Number(voucher.discount_value) / 100
        : Number(voucher.discount_value);

    if (voucher.discount_type === 'percent' && voucher.max_discount) {
        disc = Math.min(disc, Number(voucher.max_discount));
    }
    return Math.min(Math.round(disc), subtotal);
}

function setVoucherMsg(text, isError = false) {
    const el = $('voucher-msg');
    if (!el) return;

    if (!text) {
        el.textContent = '';
        el.className = 'hidden';
        return;
    }

    el.textContent = (isError ? '❌ ' : '✅ ') + text;
    el.className = `mt-2 px-3 py-2 rounded-xl text-xs font-medium border ${
        isError ? 'bg-red-50 text-red-600 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
    }`;
}

const VOUCHER_REASON = {
    not_found: 'Kode voucher tidak ditemukan.',
    not_started: 'Voucher belum berlaku.',
    expired: 'Voucher sudah kedaluwarsa.',
    quota_full: 'Kuota voucher sudah habis.'
};

async function applyVoucher() {
    const input = $('voucher-code');
    const btn = $('voucher-apply-btn');
    const code = (input?.value || '').trim().toUpperCase();
    const subtotal = cartSubtotal();

    const fail = (msg) => {
        setVoucherMsg(msg, true);
        input?.classList.add('shake', 'border-red-400');
        setTimeout(() => input?.classList.remove('shake'), 400);
    };

    input?.classList.remove('border-red-400');

    if (!code) return fail('Masukkan kode voucher terlebih dahulu.');
    if (cart.length === 0) return fail('Pilih menu dulu sebelum memakai voucher.');

    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch loading-spinner"></i>'; }

    try {
        await authReady;
        const { data, error } = await supabase.rpc('check_voucher', { p_code: code });
        if (error) throw error;

        if (!data || !data.valid) {
            return fail(VOUCHER_REASON[data?.reason] || 'Voucher tidak valid.');
        }

        const v = data.voucher;

        if (subtotal < Number(v.min_purchase || 0)) {
            return fail(`Minimal belanja ${rp(v.min_purchase)} untuk memakai voucher ${v.code}.`);
        }

        appliedVoucher = v;
        input.value = v.code;
        input.disabled = true;
        input.classList.add('bg-emerald-50');
        input.classList.remove('border-red-400');
        $('voucher-remove-btn')?.classList.remove('hidden');
        btn?.classList.add('hidden');
        updateCartUI();
    } catch (err) {
        console.error('[VOUCHER] Error:', err);
        fail('Gagal memeriksa voucher. Periksa koneksi lalu coba lagi.');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Pakai'; }
    }
}

function removeVoucher(focusInput = true) {
    appliedVoucher = null;

    const input = $('voucher-code');
    if (input) {
        input.value = '';
        input.disabled = false;
        input.classList.remove('border-red-400', 'bg-emerald-50');
        if (focusInput) input.focus();
    }

    $('voucher-remove-btn')?.classList.add('hidden');
    $('voucher-apply-btn')?.classList.remove('hidden');

    setVoucherMsg('');
    updateCartUI();
}

window.applyVoucher = applyVoucher;
window.removeVoucher = () => removeVoucher(false);

$('voucher-apply-btn')?.addEventListener('click', applyVoucher);
$('voucher-remove-btn')?.addEventListener('click', () => removeVoucher(true));
$('voucher-code')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); applyVoucher(); }
});

/* =========================================================
   PRODUK
   ========================================================= */
async function loadProductsFromSupabase() {
    await authReady;
    try {
        const { data, error } = await supabase.from('products').select('*');
        if (error) throw error;
        if (data && data.length > 0) {
            window.products = data.map(p => ({
                id: p.id,
                name: p.nama || p.name,
                category: (p.kategori || p.category || 'umum').toLowerCase(),
                price: Number(p.harga || p.price || 0),
                desc: p.deskripsi || p.desc || '',
                image: p.foto || p.image || 'https://images.unsplash.com/photo-1541696432-82c6da8ce7bf?w=500',
                stock: p.stock !== undefined ? Number(p.stock) : (p.stok !== undefined ? Number(p.stok) : 10)
            }));
            productsFromDb = true;
        } else {
            window.products = sampleProducts;
        }
    } catch (e) {
        console.warn('Fallback to sample products:', e);
        window.products = sampleProducts;
    }

    const collator = new Intl.Collator('id', { sensitivity: 'base', numeric: true });
    window.products.sort((a, b) =>
        collator.compare(String(a.name || ''), String(b.name || '')) ||
        collator.compare(String(a.category || ''), String(b.category || '')) ||
        Number(a.stock || 0) - Number(b.stock || 0)
    );

    reconcileCart();
    buildDynamicCategories();
    renderProducts();
    updateCartUI();
}

// Sinkronkan keranjang yang tersimpan dengan harga & stok terbaru
function reconcileCart() {
    if (!productsFromDb || cart.length === 0) return;
    let changed = false;

    cart = cart.reduce((acc, item) => {
        const p = findProduct(item.id);
        if (!p || (p.stock !== undefined && p.stock <= 0)) { changed = true; return acc; }
        const qty = p.stock !== undefined ? Math.min(item.qty, p.stock) : item.qty;
        if (qty !== item.qty || p.price !== item.price) changed = true;
        acc.push({ ...p, qty });
        return acc;
    }, []);

    if (changed) showToast('Keranjang diperbarui sesuai stok & harga terbaru');
}

function buildDynamicCategories() {
    const container = $('category-buttons-container');
    if (!container) return;

    const counts = {};
    window.products.forEach(p => {
        if (p.category) counts[p.category] = (counts[p.category] || 0) + 1;
    });

    const chip = (key, label, count) => {
        const active = currentFilter === key;
        return `<button type="button" data-cat="${esc(key)}" class="category-btn flex-shrink-0 px-4 py-2 rounded-xl text-sm font-medium transition whitespace-nowrap border ${
            active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white hover:bg-slate-100 text-slate-600 border-slate-200'
        }">${esc(label)} <span class="${active ? 'text-slate-400' : 'text-slate-400'} text-xs ml-0.5">${count}</span></button>`;
    };

    container.innerHTML =
        chip('all', 'Semua', window.products.length) +
        Object.keys(counts).map(cat => chip(cat, capitalize(cat), counts[cat])).join('');
}

$('category-buttons-container')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cat]');
    if (btn) window.filterCategory(btn.dataset.cat);
});

window.filterCategory = function (category) {
    currentFilter = category;
    buildDynamicCategories();
    renderProducts();

    // kalau user sudah scroll jauh ke bawah, kembalikan ke awal daftar menu
    const section = $('menu-section');
    if (section && window.scrollY > section.offsetTop) {
        section.scrollIntoView({ behavior: 'smooth' });
    }
};

$('menu-search')?.addEventListener('input', (e) => {
    searchQuery = e.target.value.trim().toLowerCase();
    renderProducts();
});

function actionSlotHTML(item) {
    const out = item.stock !== undefined && item.stock <= 0;
    const inCart = findCartItem(item.id);
    const qty = inCart ? inCart.qty : 0;
    const id = esc(item.id);

    if (out) {
        return `<button disabled class="w-full bg-slate-100 text-slate-400 cursor-not-allowed py-2.5 rounded-xl font-semibold text-xs">Stok Habis</button>`;
    }
    if (qty === 0) {
        return `<button data-action="add" data-id="${id}" class="w-full bg-brand-500 hover:bg-brand-600 active:scale-[.98] text-white py-2.5 rounded-xl font-semibold text-xs sm:text-sm transition flex items-center justify-center gap-1.5 shadow-sm shadow-brand-500/30">
                    <i class="fa-solid fa-plus"></i> Tambah
                </button>`;
    }
    return `<div class="w-full flex items-center justify-between bg-brand-50 border border-brand-200 rounded-xl p-1">
                <button data-action="dec" data-id="${id}" aria-label="Kurangi" class="w-9 h-8 rounded-lg bg-white hover:bg-slate-50 text-brand-600 flex items-center justify-center shadow-sm"><i class="fa-solid ${qty === 1 ? 'fa-trash-can' : 'fa-minus'} text-xs"></i></button>
                <span class="font-bold text-brand-700 text-sm">${qty}</span>
                <button data-action="inc" data-id="${id}" aria-label="Tambah" class="w-9 h-8 rounded-lg bg-brand-500 hover:bg-brand-600 text-white flex items-center justify-center shadow-sm"><i class="fa-solid fa-plus text-xs"></i></button>
            </div>`;
}

function productCard(item) {
    const out = item.stock !== undefined && item.stock <= 0;
    const low = !out && item.stock !== undefined && item.stock <= 5;
    const inCart = !!findCartItem(item.id);

    return `
        <article data-card="${esc(item.id)}" class="group bg-white rounded-2xl border shadow-sm overflow-hidden flex flex-col hover:shadow-lg transition ${inCart ? 'border-brand-300 ring-2 ring-brand-100' : 'border-slate-100'} ${out ? 'opacity-70' : ''}">
            <div class="relative aspect-[4/3] overflow-hidden bg-slate-100">
                <img src="${esc(item.image)}" alt="${esc(item.name)}" loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition duration-500" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'">
                <span class="absolute top-2 left-2 bg-white/90 backdrop-blur text-slate-700 text-[10px] font-semibold px-2 py-0.5 rounded-md uppercase tracking-wide">${esc(item.category)}</span>
                ${out
                    ? `<div class="absolute inset-0 bg-slate-900/50 flex items-center justify-center"><span class="bg-white text-slate-900 text-xs font-bold px-3 py-1.5 rounded-full">Stok Habis</span></div>`
                    : low
                        ? `<span class="absolute bottom-2 right-2 bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-md">Sisa ${item.stock}</span>`
                        : ''}
            </div>
            <div class="p-3 sm:p-4 flex flex-col flex-grow">
                <h4 class="font-semibold text-slate-900 text-sm sm:text-base leading-snug line-clamp-2">${esc(item.name)}</h4>
                <p class="text-[11px] sm:text-xs text-slate-500 line-clamp-2 mt-1">${esc(item.desc)}</p>
                <div class="mt-auto pt-3 space-y-2">
                    <p class="font-bold text-brand-600 text-sm sm:text-base">${rp(item.price)}</p>
                    <div data-slot="${esc(item.id)}">${actionSlotHTML(item)}</div>
                </div>
            </div>
        </article>`;
}

const GRID = 'grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5';

function renderProducts() {
    const container = $('product-grid-container');
    if (!container) return;

    let items = window.products;
    if (currentFilter !== 'all') items = items.filter(p => p.category === currentFilter);
    if (searchQuery) {
        items = items.filter(p =>
            String(p.name).toLowerCase().includes(searchQuery) ||
            String(p.desc).toLowerCase().includes(searchQuery));
    }

    if (items.length === 0) {
        container.innerHTML = `
            <div class="bg-white rounded-2xl border border-slate-100 py-14 text-center">
                <div class="w-14 h-14 mx-auto rounded-full bg-slate-100 text-slate-400 flex items-center justify-center text-xl mb-3"><i class="fa-solid fa-bowl-food"></i></div>
                <p class="font-semibold text-slate-700">Menu tidak ditemukan</p>
                <p class="text-sm text-slate-400">Coba kata kunci lain atau pilih kategori "Semua".</p>
            </div>`;
        return;
    }

    // Tampilan "Semua" tanpa pencarian → dikelompokkan per kategori
    if (currentFilter === 'all' && !searchQuery) {
        const grouped = {};
        items.forEach(item => {
            const cat = item.category || 'umum';
            (grouped[cat] = grouped[cat] || []).push(item);
        });

        container.innerHTML = Object.keys(grouped).map(cat => `
            <div class="mb-10 last:mb-0">
                <div class="flex items-center gap-3 mb-4">
                    <h4 class="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight">${esc(capitalize(cat))}</h4>
                    <div class="flex-grow h-px bg-slate-200"></div>
                    <span class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">${grouped[cat].length} Pilihan</span>
                </div>
                <div class="${GRID}">${grouped[cat].map(productCard).join('')}</div>
            </div>`).join('');
    } else {
        container.innerHTML = `<div class="${GRID}">${items.map(productCard).join('')}</div>`;
    }
}

// Update tombol di kartu produk tanpa render ulang seluruh grid
function refreshProductSlots() {
    document.querySelectorAll('[data-slot]').forEach(slot => {
        const product = findProduct(slot.dataset.slot);
        if (!product) return;
        slot.innerHTML = actionSlotHTML(product);
        const card = slot.closest('[data-card]');
        if (card) {
            const inCart = !!findCartItem(product.id);
            card.classList.toggle('border-brand-300', inCart);
            card.classList.toggle('ring-2', inCart);
            card.classList.toggle('ring-brand-100', inCart);
            card.classList.toggle('border-slate-100', !inCart);
        }
    });
}

// Delegasi klik tombol tambah / kurang di kartu produk & keranjang
document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    switch (btn.dataset.action) {
        case 'add':
        case 'inc':
            window.addToCart(id);
            break;
        case 'dec':
            window.updateCartQty(id, -1);
            break;
        case 'remove':
            cart = cart.filter(i => String(i.id) !== String(id));
            updateCartUI();
            break;
    }
});

/* =========================================================
   KERANJANG
   ========================================================= */
window.addToCart = function (productId) {
    const product = findProduct(productId);
    if (!product) return;

    if (product.stock !== undefined && product.stock <= 0) {
        showNotification('Stok Habis', `Mohon maaf, produk ${product.name} sedang kosong dan tidak dapat dipesan.`, 'warning');
        return;
    }

    const existing = findCartItem(productId);
    const currentQty = existing ? existing.qty : 0;

    if (product.stock !== undefined && currentQty + 1 > product.stock) {
        showToast(`Stok ${product.name} hanya tersisa ${product.stock}`);
        return;
    }

    if (existing) {
        existing.qty += 1;
    } else {
        cart.push({ ...product, qty: 1 });
        showToast(`✓ ${product.name} masuk keranjang`);
    }

    const badge = $('cart-badge');
    badge?.classList.remove('pop');
    void badge?.offsetWidth;
    badge?.classList.add('pop');

    updateCartUI();
};

window.updateCartQty = function (productId, change) {
    const product = findProduct(productId);
    const item = findCartItem(productId);
    if (!item) return;

    const newQty = item.qty + change;
    if (newQty > 0) {
        if (product && product.stock !== undefined && newQty > product.stock) {
            showToast(`Stok ${product.name} hanya tersisa ${product.stock}`);
            return;
        }
        item.qty = newQty;
    } else {
        cart = cart.filter(i => String(i.id) !== String(productId));
    }
    updateCartUI();
};

$('cart-clear-btn')?.addEventListener('click', () => {
    if (!confirm('Kosongkan semua isi keranjang?')) return;
    cart = [];
    updateCartUI();
});

function renderCartTotals(subtotal) {
    const discount = computeVoucherDiscount(appliedVoucher, subtotal);
    const total = Math.max(0, subtotal - discount);

    $('cart-subtotal').innerText = rp(subtotal);
    $('cart-total').innerText = rp(total);

    const row = $('cart-discount-row');
    if (row) {
        row.classList.toggle('hidden', discount <= 0);
        row.classList.toggle('flex', discount > 0);
        $('cart-discount-label').innerText = appliedVoucher ? `Diskon (${appliedVoucher.code})` : 'Diskon';
        $('cart-discount').innerText = `- ${rp(discount)}`;
    }

    if (appliedVoucher) {
        if (discount > 0) {
            setVoucherMsg(`Voucher ${appliedVoucher.code} dipakai, hemat ${rp(discount)}`);
        } else {
            setVoucherMsg(`Belum memenuhi minimal belanja ${rp(appliedVoucher.min_purchase)}`, true);
        }
    }
    return total;
}

function updateCartUI() {
    const container = $('cart-items-container');
    const badge = $('cart-badge');
    if (!container || !badge) return;

    saveJSON(CART_KEY, cart);

    const totalQty = cartQty();
    const subtotal = cartSubtotal();
    const empty = cart.length === 0;

    badge.innerText = totalQty;
    $('cart-count-label').innerText = `${totalQty} item`;
    $('cart-clear-btn')?.classList.toggle('hidden', empty);
    $('checkout-fields')?.classList.toggle('hidden', empty);
    const checkoutBtn = $('checkout-btn');
    if (checkoutBtn) checkoutBtn.disabled = empty;

    if (empty) {
        container.innerHTML = `
            <div class="text-center py-14">
                <div class="w-16 h-16 mx-auto rounded-full bg-brand-50 text-brand-400 flex items-center justify-center text-2xl mb-3"><i class="fa-solid fa-basket-shopping"></i></div>
                <p class="font-semibold text-slate-700">Keranjang masih kosong</p>
                <p class="text-sm text-slate-400 mb-5">Yuk pilih dimsum atau ayam favoritmu!</p>
                <button onclick="toggleCartModal()" class="bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition">Lihat Menu</button>
            </div>`;
    } else {
        container.innerHTML = cart.map(item => {
            const id = esc(item.id);
            return `
            <div class="flex items-center gap-3">
                <img src="${esc(item.image)}" alt="" class="w-14 h-14 rounded-xl object-cover bg-slate-100 flex-shrink-0" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'">
                <div class="flex-grow min-w-0">
                    <h5 class="font-semibold text-sm text-slate-900 leading-snug line-clamp-2">${esc(item.name)}</h5>
                    <p class="text-xs text-slate-500">${rp(item.price)} <span class="text-slate-300">·</span> <span class="font-semibold text-brand-600">${rp(item.price * item.qty)}</span></p>
                </div>
                <div class="flex items-center bg-slate-100 rounded-xl p-0.5 flex-shrink-0">
                    <button data-action="dec" data-id="${id}" aria-label="Kurangi" class="w-8 h-8 rounded-lg hover:bg-white flex items-center justify-center text-slate-600"><i class="fa-solid ${item.qty === 1 ? 'fa-trash-can text-red-400' : 'fa-minus'} text-[11px]"></i></button>
                    <span class="text-sm font-bold w-6 text-center">${item.qty}</span>
                    <button data-action="inc" data-id="${id}" aria-label="Tambah" class="w-8 h-8 rounded-lg hover:bg-white flex items-center justify-center text-slate-600"><i class="fa-solid fa-plus text-[11px]"></i></button>
                </div>
            </div>`;
        }).join('<div class="border-t border-slate-100"></div>');
    }

    const total = renderCartTotals(subtotal);

    // Floating cart bar
    const floating = $('floating-cart');
    if (floating) {
        floating.classList.toggle('hidden', empty);
        $('floating-cart-count').innerText = `${totalQty} item · Lihat keranjang`;
        $('floating-cart-total').innerText = rp(total);
    }

    refreshProductSlots();
}

window.toggleCartModal = function () {
    isOpen('cart-modal') ? closeModal('cart-modal') : openModal('cart-modal');
};

/* =========================================================
   DATA PEMESAN (disimpan agar order berikutnya lebih cepat)
   ========================================================= */
function prefillCustomer() {
    const c = loadJSON(CUSTOMER_KEY, null);
    if (!c) return;
    if (c.name) $('customer-name').value = c.name;
    if (c.phone) $('customer-phone').value = c.phone;
    if (c.address) $('customer-address').value = c.address;
}

function normalizePhone(raw) {
    let d = String(raw).replace(/[^\d+]/g, '');
    if (d.startsWith('+62')) d = '0' + d.slice(3);
    else if (d.startsWith('62')) d = '0' + d.slice(2);
    return d.replace(/\D/g, '');
}

/* =========================================================
   CHECKOUT → PEMBAYARAN
   ========================================================= */
window.proceedToPayment = function () {
    if (cart.length === 0) {
        showToast('Keranjang Anda masih kosong.');
        return;
    }

    const nameEl = $('customer-name');
    const phoneEl = $('customer-phone');
    const addressEl = $('customer-address');
    const name = nameEl.value.trim();
    const phone = normalizePhone(phoneEl.value);
    const address = addressEl.value.trim();
    const paymentMethod = document.querySelector('input[name="payment_method"]:checked')?.value || 'QRIS';

    if (name.length < 2) return fieldError(nameEl, 'Isi nama lengkap dulu ya');
    if (!/^08\d{8,12}$/.test(phone)) return fieldError(phoneEl, 'Nomor WhatsApp belum valid (cth: 081234567890)');
    if (address.length < 10) return fieldError(addressEl, 'Alamat terlalu singkat, tambahkan detail/patokan');

    phoneEl.value = phone;
    saveJSON(CUSTOMER_KEY, { name, phone, address });

    const now = new Date();
    const randomNum = Math.floor(100 + Math.random() * 9000);
    const parts = (year) => Object.fromEntries(
        new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Jakarta',
            year, month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hourCycle: 'h23'
        }).formatToParts(now).map(x => [x.type, x.value])
    );
    const p = parts('2-digit');
    const pFull = parts('numeric');

    const jakartaISOString = `${pFull.year}-${pFull.month}-${pFull.day}T${pFull.hour}:${pFull.minute}:${pFull.second}+07:00`;
    const orderId = `ORD-${p.year}${p.month}${p.day}${p.hour}${p.minute}-${randomNum}`;

    const subtotal = cartSubtotal();
    const discount = computeVoucherDiscount(appliedVoucher, subtotal);
    const grandTotal = Math.max(0, subtotal - discount);

    pendingOrderData = {
        order_id: orderId,
        customer_name: name,
        phone: phone,
        address: address,
        items: cart.map(i => ({ ...i })),
        subtotal: subtotal,
        voucher_code: discount > 0 ? appliedVoucher.code : null,
        discount_amount: discount,
        grand_total: grandTotal,
        payment_method: paymentMethod,
        order_type: 'Website',
        status: 'new',
        created_at: jakartaISOString
    };

    // Ringkasan pesanan
    $('payment-summary').innerHTML = `
        <div class="bg-gradient-to-br from-brand-500 to-brand-600 text-white rounded-2xl p-4 shadow-lg shadow-brand-500/25">
            <p class="text-xs text-white/80">Total yang harus dibayar</p>
            <div class="flex items-center justify-between gap-2">
                <p class="text-3xl font-extrabold tracking-tight">${rp(grandTotal)}</p>
                <button onclick="copyText('${grandTotal}', 'Nominal disalin')" class="bg-white/15 hover:bg-white/25 text-xs font-semibold px-3 py-1.5 rounded-lg transition"><i class="fa-regular fa-copy mr-1"></i>Salin</button>
            </div>
            ${discount > 0 ? `<p class="text-xs text-white/90 mt-1"><i class="fa-solid fa-ticket mr-1"></i>Hemat ${rp(discount)} dengan ${esc(appliedVoucher.code)}</p>` : ''}
        </div>
        <details class="mt-3 bg-slate-50 border border-slate-200 rounded-2xl group">
            <summary class="cursor-pointer list-none px-4 py-3 flex items-center justify-between text-sm font-semibold text-slate-700">
                <span><i class="fa-solid fa-list-ul text-slate-400 mr-2"></i>${cartQty()} item · ${esc(name)}</span>
                <i class="fa-solid fa-chevron-down text-xs text-slate-400 group-open:rotate-180 transition"></i>
            </summary>
            <div class="px-4 pb-3 space-y-1 text-xs text-slate-600">
                ${pendingOrderData.items.map(i => `<div class="flex justify-between gap-2"><span>${esc(i.name)} × ${i.qty}</span><span class="font-semibold">${rp(i.price * i.qty)}</span></div>`).join('')}
                <div class="pt-2 mt-1 border-t border-slate-200 text-slate-500"><i class="fa-solid fa-location-dot mr-1"></i>${esc(address)}</div>
            </div>
        </details>`;

    const instructionBox = $('payment-instruction-box');
    const proofContainer = $('payment-proof-container');

    if (paymentMethod === 'QRIS') {
        proofContainer.style.display = 'block';
        instructionBox.innerHTML = `
            <p class="font-bold text-slate-900">Scan QRIS di bawah ini</p>
            <ol class="text-xs text-slate-500 list-decimal pl-4 space-y-0.5">
                <li>Buka e-wallet / m-banking, pilih <b>Scan / Bayar QRIS</b></li>
                <li>Masukkan nominal <b class="text-brand-600">${rp(grandTotal)}</b></li>
                <li>Screenshot bukti bayar lalu upload di bawah</li>
            </ol>
            <div class="bg-white p-3 rounded-xl border border-slate-200 text-center mt-2">
                <img src="${QRIS_IMG}" alt="QRIS ChimChum" class="mx-auto w-60 h-60 object-contain" onerror="this.src='https://placehold.co/240?text=QRIS+ChimChum'">
                <a href="${QRIS_IMG}" download="QRIS-ChimChum.png" class="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700">
                    <i class="fa-solid fa-download"></i> Simpan gambar QRIS
                </a>
            </div>
            <p class="text-[11px] text-slate-400">Bayar dari HP yang sama? Simpan gambar QRIS, lalu pilih "upload dari galeri" di aplikasi pembayaranmu.</p>`;
    } else if (paymentMethod === 'Transfer') {
        proofContainer.style.display = 'block';
        instructionBox.innerHTML = `
            <p class="font-bold text-slate-900">Transfer Bank BCA Syariah</p>
            <div class="bg-white rounded-xl border border-slate-200 p-3 flex items-center justify-between">
                <div>
                    <p class="text-[11px] text-slate-400">No. Rekening · a.n. Intan Dwi A I</p>
                    <p class="font-bold text-slate-900 text-lg tracking-wider">8881798766</p>
                </div>
                <button onclick="copyText('8881798766', 'No. rekening disalin')" class="bg-slate-100 hover:bg-slate-200 text-xs font-semibold px-3 py-2 rounded-lg"><i class="fa-regular fa-copy mr-1"></i>Salin</button>
            </div>
            <p class="text-xs text-slate-500">Transfer tepat <b class="text-brand-600">${rp(grandTotal)}</b>, lalu upload bukti di bawah.</p>`;
    } else {
        proofContainer.style.display = 'none';
        instructionBox.innerHTML = `
            <p class="font-bold text-slate-900">Pembayaran Cash / COD</p>
            <p class="text-slate-600 text-xs">Siapkan uang pas sebesar <span class="font-bold text-brand-600">${rp(grandTotal)}</span> saat kurir tiba.</p>`;
    }

    resetProofPreview();
    closeModal('cart-modal');
    openModal('payment-modal');
};

window.closePaymentModal = function () {
    if (isSubmitting) return;
    closeModal('payment-modal');
};

window.backToCart = function () {
    if (isSubmitting) return;
    closeModal('payment-modal');
    openModal('cart-modal');
};

/* ---------- Upload bukti + preview ---------- */
function resetProofPreview() {
    const input = $('payment-proof-file');
    if (input) input.value = '';
    $('proof-empty')?.classList.remove('hidden');
    const preview = $('proof-preview');
    preview?.classList.add('hidden');
    preview?.classList.remove('flex');
    $('proof-dropzone')?.classList.remove('border-emerald-400', 'bg-emerald-50/50', 'border-solid');
}

$('payment-proof-file')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return resetProofPreview();

    if (!file.type.startsWith('image/')) {
        resetProofPreview();
        showToast('File harus berupa gambar (JPG/PNG)');
        return;
    }

    const url = URL.createObjectURL(file);
    const img = $('proof-preview-img');
    img.onload = () => URL.revokeObjectURL(url);
    img.src = url;
    $('proof-preview-name').textContent = file.name;
    $('proof-empty').classList.add('hidden');
    $('proof-preview').classList.remove('hidden');
    $('proof-preview').classList.add('flex');
    $('proof-dropzone').classList.add('border-emerald-400', 'bg-emerald-50/50', 'border-solid');
});

async function compressImage(file, maxWidth = 1600, quality = 0.75) {
    if (!file.type.startsWith('image/')) return file;

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let { width, height } = img;
                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);
                canvas.toBlob((blob) => {
                    if (!blob) return reject(new Error('Gagal mengompres gambar.'));
                    resolve(new File([blob], file.name.replace(/\.[^/.]+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: Date.now() }));
                }, 'image/jpeg', quality);
            };
            img.onerror = () => reject(new Error('Gagal membaca gambar.'));
            img.src = e.target.result;
        };
        reader.onerror = () => reject(new Error('Gagal membaca file.'));
        reader.readAsDataURL(file);
    });
}

function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
    });
}

async function reduceProductStock(items) {
    await authReady;
    for (const item of items) {
        const qty = Number(item.qty || 0);
        if (!item.id || qty <= 0) continue;

        const { data, error } = await supabase.rpc('reduce_product_stock', {
            p_product_id: item.id,
            p_quantity: qty
        });

        if (error) {
            console.error('[STOCK] RPC error:', { message: error.message, details: error.details, hint: error.hint, code: error.code });
            throw error;
        }
        if (data !== true) {
            throw new Error(`Stok ${item.name} tidak mencukupi.`);
        }
    }
}

function setConfirmBtn(state, text) {
    const btn = $('confirm-btn');
    if (!btn) return;
    if (state === 'loading') {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-circle-notch loading-spinner"></i><span>${text}</span>`;
    } else {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-circle-check"></i><span>Konfirmasi & Kirim Pesanan</span>';
    }
}

window.confirmAndSubmitOrder = async function () {
    if (!pendingOrderData || isSubmitting) return;

    const fileInput = $('payment-proof-file');
    const paymentMethod = pendingOrderData.payment_method;
    const file = fileInput?.files?.[0];

    if (paymentMethod !== 'Cash' && !file) {
        showToast('Upload bukti pembayaran dulu ya');
        $('proof-dropzone')?.classList.add('shake', 'border-red-400');
        setTimeout(() => $('proof-dropzone')?.classList.remove('shake', 'border-red-400'), 600);
        return;
    }

    isSubmitting = true;
    let proofReference = 'Pending / Cash';

    // 1. Upload bukti bayar
    if (file) {
        setConfirmBtn('loading', 'Mengupload bukti...');
        let compressed = file;
        try {
            await authReady;
            compressed = await compressImage(file, 1600, 0.75);
            const fileExt = compressed.name.split('.').pop().toLowerCase();
            const fileName = `${pendingOrderData.order_id}_${Date.now()}.${fileExt}`;

            const { error: uploadError } = await supabase.storage
                .from('payment-proofs')
                .upload(fileName, compressed, { cacheControl: '3600', upsert: true, contentType: compressed.type });
            if (uploadError) throw uploadError;

            const { data: publicUrlData } = supabase.storage.from('payment-proofs').getPublicUrl(fileName);
            proofReference = publicUrlData?.publicUrl || await fileToDataURL(compressed);
        } catch (err) {
            // Fallback: simpan sebagai base64 kalau upload storage gagal
            console.warn('Upload gagal, memakai base64:', err);
            try { proofReference = await fileToDataURL(compressed); } catch { /* tetap 'Pending' */ }
        }
    }

    pendingOrderData.payment_proof = proofReference;
    pendingOrderData.payment_status = paymentMethod === 'Cash' ? 'unpaid' : 'pending';

    // 2. Simpan order
    setConfirmBtn('loading', 'Menyimpan pesanan...');
    try {
        await authReady;

        if (pendingOrderData.voucher_code) {
            const { data: ok, error: vErr } = await supabase.rpc('redeem_voucher', { p_code: pendingOrderData.voucher_code });
            if (vErr) throw vErr;
            if (!ok) throw new Error('Voucher sudah tidak berlaku (kuota habis / kedaluwarsa). Hapus voucher lalu coba lagi.');
        }

        const { error: orderError } = await supabase.from('orders').insert([pendingOrderData]).select().single();
        if (orderError) throw orderError;

        await reduceProductStock(pendingOrderData.items);
    } catch (dbErr) {
        console.error('[ORDER] Gagal submit order / update stok:', {
            message: dbErr.message, details: dbErr.details, hint: dbErr.hint, code: dbErr.code
        });
        isSubmitting = false;
        setConfirmBtn('idle');
        showNotification('Pesanan Gagal', dbErr.message || 'Terjadi kesalahan saat memproses pesanan.', 'warning');
        return;
    }

    // 3. Simpan salinan lokal (untuk fitur "pesanan saya" di Lacak)
    const localOrders = loadJSON('local_orders', []);
    const orderToSave = { ...pendingOrderData };
    if (orderToSave.payment_proof?.startsWith('data:image')) {
        orderToSave.payment_proof = '[Base64 Image Attached - Local Copy Truncated]';
    }
    localOrders.push(orderToSave);
    try {
        localStorage.setItem('local_orders', JSON.stringify(localOrders));
    } catch (e) {
        if (e.name === 'QuotaExceededError') saveJSON('local_orders', localOrders.slice(-10));
    }

    // 4. Pesan WhatsApp
    const o = pendingOrderData;
    const itemsListStr = o.items.map(i => `• ${i.name} (${i.qty}x) - ${rp(i.price * i.qty)}`).join('\n');
    const trackingLink = `https://chimchummlg.vercel.app/lacak.html/${o.order_id}`;
    const waText = encodeURIComponent(
`*INVOICE PEMESANAN CHIMCHUM MALANG*
ID Pesanan: ${o.order_id}

*Detail Item:*
${itemsListStr}
────────────────
Subtotal: ${rp(o.subtotal)}${o.discount_amount > 0 ? `\nDiskon (${o.voucher_code}): - ${rp(o.discount_amount)}` : ''}
*Total: ${rp(o.grand_total)}*

*Data Pemesan:*
Nama: ${o.customer_name}
No. WA: ${o.phone}
Alamat: ${o.address}
Pembayaran: ${o.payment_method}
Bukti Pembayaran: ${trackingLink}

Mohon segera diproses ya Kak, terima kasih! 🙏`);

    isSubmitting = false;
    setConfirmBtn('idle');
    closeModal('payment-modal');
    cart = [];
    removeVoucher(false);
    resetProofPreview();

    const waUrl = `https://wa.me/${store.wa_number}?text=${waText}`;
    showNotification(
        'Pesanan Berhasil Dibuat! 🎉',
        'Langkah terakhir: kirim detail pesanan ke WhatsApp admin agar segera diproses.',
        'success',
        waUrl,
        o.order_id
    );
    pendingOrderData = null;
};

/* =========================================================
   LACAK PESANAN
   ========================================================= */
const STATUS_STEPS = [
    { label: 'Diterima', icon: 'fa-receipt' },
    { label: 'Disiapkan', icon: 'fa-fire-burner' },
    { label: 'Dikirim', icon: 'fa-motorcycle' },
    { label: 'Selesai', icon: 'fa-circle-check' }
];
// Kunci sudah dinormalisasi: huruf kecil, spasi/underscore/strip → spasi tunggal
const STATUS_INDEX = {
    // 0 — Diterima
    'new': 0, 'baru': 0, 'pending': 0, 'received': 0, 'diterima': 0, 'menunggu': 0, 'menunggu konfirmasi': 0,
    // 1 — Disiapkan
    'disiapkan': 1, 'sedang disiapkan': 1, 'siapkan': 1, 'persiapan': 1,
    'process': 1, 'processing': 1, 'proses': 1, 'diproses': 1, 'sedang diproses': 1,
    'cooking': 1, 'dimasak': 1, 'confirmed': 1, 'dikonfirmasi': 1, 'preparing': 1,
    'ready': 1, 'siap': 1, 'siap diambil': 1, 'siap dikirim': 1,
    // 2 — Dikirim
    'dikirim': 2, 'sedang dikirim': 2, 'diantar': 2, 'sedang diantar': 2, 'dalam pengiriman': 2,
    'delivery': 2, 'delivering': 2, 'shipped': 2, 'shipping': 2, 'otw': 2, 'pickup': 2, 'on delivery': 2,
    // 3 — Selesai
    'selesai': 3, 'done': 3, 'completed': 3, 'complete': 3, 'finished': 3, 'delivered': 3, 'diterima pelanggan': 3
};
const STATUS_CANCELLED = ['cancel', 'canceled', 'cancelled', 'batal', 'dibatalkan', 'rejected', 'ditolak'];

function normalizeStatus(status) {
    return String(status || '').toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const PAYMENT_LABEL = {
    unpaid: ['Belum dibayar', 'bg-slate-100 text-slate-600'],
    pending: ['Menunggu verifikasi', 'bg-amber-100 text-amber-700'],
    paid: ['Lunas', 'bg-emerald-100 text-emerald-700'],
    lunas: ['Lunas', 'bg-emerald-100 text-emerald-700'],
    rejected: ['Ditolak', 'bg-red-100 text-red-600'],
    failed: ['Gagal', 'bg-red-100 text-red-600']
};

function renderTimeline(status) {
    const s = normalizeStatus(status);
    if (STATUS_CANCELLED.includes(s)) {
        return `<div class="bg-red-50 border border-red-200 text-red-600 text-sm font-semibold rounded-xl p-3 text-center"><i class="fa-solid fa-ban mr-1.5"></i>Pesanan dibatalkan</div>`;
    }
    const idx = STATUS_INDEX[s];
    if (idx === undefined) {
        return `<div class="text-center"><span class="bg-amber-100 text-amber-700 text-xs px-3 py-1 rounded-full font-bold uppercase">${esc(status || '-')}</span></div>`;
    }
    return `
        <div class="relative">
            <div class="absolute top-[18px] left-[12.5%] right-[12.5%] h-1 bg-slate-100 rounded-full">
                <div class="h-full bg-brand-500 rounded-full transition-all" style="width:${(idx / 3) * 100}%"></div>
            </div>
            <ol class="relative grid grid-cols-4">
                ${STATUS_STEPS.map((st, i) => {
                    const done = i <= idx;
                    return `<li class="flex flex-col items-center text-center">
                        <div class="w-9 h-9 rounded-full flex items-center justify-center text-sm ${done ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-400'} ${i === idx ? 'ring-4 ring-brand-100' : ''}"><i class="fa-solid ${st.icon}"></i></div>
                        <span class="mt-1.5 text-[11px] font-semibold ${done ? 'text-slate-900' : 'text-slate-400'}">${st.label}</span>
                    </li>`;
                }).join('')}
            </ol>
        </div>`;
}

// Hapus order dari salinan lokal (dipakai kalau order ternyata tidak ada di database)
function forgetLocalOrders(orderIds) {
    const ids = new Set(orderIds);
    if (ids.size === 0) return;
    saveJSON('local_orders', loadJSON('local_orders', []).filter(o => !ids.has(o.order_id)));
}

async function renderRecentOrders() {
    const box = $('tracker-recent');
    if (!box) return;
    let recent = loadJSON('local_orders', []).slice(-3).reverse();
    if (recent.length === 0) { box.innerHTML = ''; return; }

    // Cocokkan dengan database: order yang sudah tidak ada dihapus dari daftar
    try {
        await authReady;
        const ids = recent.map(o => o.order_id);
        const { data, error } = await supabase.from('orders').select('order_id').in('order_id', ids);
        if (!error && Array.isArray(data)) {
            const existing = new Set(data.map(r => r.order_id));
            const missing = ids.filter(id => !existing.has(id));
            if (missing.length) {
                forgetLocalOrders(missing);
                recent = recent.filter(o => existing.has(o.order_id));
            }
        }
    } catch (e) {
        // offline / gagal cek → tetap tampilkan daftar lokal
        console.warn('[TRACKER] Gagal verifikasi pesanan lokal:', e);
    }

    if (recent.length === 0) { box.innerHTML = ''; return; }

    box.innerHTML = `
        <p class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Pesanan terakhir di perangkat ini</p>
        <div class="flex flex-wrap gap-2">
            ${recent.map(o => `<button type="button" data-track="${esc(o.order_id)}" class="text-xs bg-slate-50 hover:bg-brand-50 border border-slate-200 hover:border-brand-200 rounded-lg px-2.5 py-1.5 text-slate-700 transition">
                <span class="font-semibold">${esc(o.order_id)}</span> · ${rp(o.grand_total)}
            </button>`).join('')}
        </div>`;
}

$('tracker-recent')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-track]');
    if (!btn) return;
    $('tracker-order-id').value = btn.dataset.track;
    window.fetchOrderStatus();
});

$('tracker-order-id')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); window.fetchOrderStatus(); }
});

window.fetchOrderStatus = async function () {
    const inputEl = $('tracker-order-id');
    const resultDiv = $('tracker-result');
    const btn = $('tracker-btn');
    if (!inputEl || !resultDiv) return;

    const orderId = inputEl.value.trim().toUpperCase();
    if (!orderId) return fieldError(inputEl, 'Masukkan ID pesanan terlebih dahulu');

    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch loading-spinner"></i>'; }

    let foundOrder = null;
    let dbChecked = false;     // true = database berhasil dicek (ada / tidak ada)
    try {
        await authReady;
        const { data, error } = await supabase.from('orders').select('*').eq('order_id', orderId).maybeSingle();
        if (error) throw error;
        dbChecked = true;
        if (data) foundOrder = data;
    } catch (e) {
        console.error('[TRACKER] Gagal cek database:', e);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Cek'; }
    }

    let isOfflineCopy = false;
    if (!foundOrder) {
        if (dbChecked) {
            // Database menjawab "tidak ada" → salinan lokal sudah tidak valid, hapus
            forgetLocalOrders([orderId]);
            renderRecentOrders();
        } else {
            // Database tidak bisa dihubungi → tampilkan salinan lokal sebagai cadangan
            foundOrder = loadJSON('local_orders', []).find(o => o.order_id === orderId) || null;
            isOfflineCopy = !!foundOrder;
        }
    }

    if (!foundOrder && !dbChecked) {
        resultDiv.classList.remove('hidden');
        resultDiv.innerHTML = `
            <div class="text-center py-6 text-slate-400 text-sm border-t border-slate-100">
                <i class="fa-solid fa-wifi text-xl mb-2 block"></i>
                Gagal terhubung ke server.<br>
                <span class="text-xs">Periksa koneksi internet lalu coba lagi.</span>
            </div>`;
        return;
    }

    resultDiv.classList.remove('hidden');
    if (!foundOrder) {
        resultDiv.innerHTML = `
            <div class="text-center py-6 text-slate-400 text-sm border-t border-slate-100">
                <i class="fa-solid fa-magnifying-glass text-xl mb-2 block"></i>
                Pesanan dengan ID tersebut tidak ditemukan.<br>
                <span class="text-xs">Pastikan ID sesuai, cth: ORD-2611071623-1234</span>
            </div>`;
        return;
    }

    const o = foundOrder;
    const pay = PAYMENT_LABEL[String(o.payment_status || '').toLowerCase()] || [o.payment_status || '-', 'bg-slate-100 text-slate-600'];
    const items = Array.isArray(o.items) ? o.items : [];

    let proofDisplay = '';
    if (o.payment_proof && o.payment_proof !== 'Pending / Cash' && !o.payment_proof.startsWith('[')) {
        proofDisplay = o.payment_proof.startsWith('data:image')
            ? `<img src="${esc(o.payment_proof)}" class="w-24 h-24 object-cover rounded-xl border border-slate-200">`
            : `<a href="${esc(o.payment_proof)}" target="_blank" rel="noopener" class="text-xs text-brand-600 underline font-semibold">Lihat Bukti Pembayaran ↗</a>`;
    }

    resultDiv.innerHTML = `
        <div class="border-t border-slate-100 pt-4 space-y-4">
            ${renderTimeline(o.status)}
            <div class="bg-slate-50 p-4 rounded-2xl space-y-2 text-sm">
                <div class="flex justify-between gap-2"><span class="text-slate-500">ID Pesanan</span><span class="font-bold text-right">${esc(o.order_id)}</span></div>
                <div class="flex justify-between gap-2"><span class="text-slate-500">Nama</span><span class="font-semibold text-right">${esc(o.customer_name)}</span></div>
                ${items.length ? `<div class="border-t border-slate-200 pt-2 space-y-1 text-xs text-slate-600">${items.map(i => `<div class="flex justify-between gap-2"><span>${esc(i.name)} × ${Number(i.qty) || 0}</span><span>${rp(Number(i.price) * Number(i.qty))}</span></div>`).join('')}</div>` : ''}
                ${Number(o.discount_amount) > 0 ? `
                <div class="flex justify-between border-t border-slate-200 pt-2"><span class="text-slate-500">Subtotal</span><span class="font-semibold">${rp(o.subtotal || (Number(o.grand_total) + Number(o.discount_amount)))}</span></div>
                <div class="flex justify-between"><span class="text-slate-500">Diskon (${esc(o.voucher_code || '-')})</span><span class="font-semibold text-emerald-600">- ${rp(o.discount_amount)}</span></div>` : ''}
                <div class="flex justify-between ${Number(o.discount_amount) > 0 ? '' : 'border-t border-slate-200 pt-2'}"><span class="text-slate-500">Total</span><span class="font-bold text-brand-600">${rp(o.grand_total || o.total_price)}</span></div>
                <div class="flex justify-between items-center"><span class="text-slate-500">Pembayaran</span><span class="${pay[1]} text-xs px-2.5 py-1 rounded-full font-bold">${esc(pay[0])}</span></div>
                ${proofDisplay ? `<div class="pt-1">${proofDisplay}</div>` : ''}
            </div>
            <a href="https://wa.me/${store.wa_number}?text=${encodeURIComponent(`Halo Kak, saya mau tanya pesanan ${o.order_id}`)}" target="_blank" rel="noopener"
               class="w-full border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold py-2.5 rounded-xl text-sm flex items-center justify-center gap-2 transition">
                <i class="fa-brands fa-whatsapp"></i> Tanya admin soal pesanan ini
            </a>
        </div>`;

    if (isOfflineCopy) {
        // Status di salinan lokal hanya status saat order dibuat, jangan tampilkan seolah-olah terbaru
        resultDiv.querySelector('.relative, .bg-red-50')?.remove();
        resultDiv.firstElementChild?.insertAdjacentHTML('afterbegin', `
            <div class="bg-amber-50 border border-amber-200 text-amber-700 text-xs rounded-xl p-3 flex gap-2">
                <i class="fa-solid fa-wifi mt-0.5"></i>
                <span>Tidak bisa terhubung ke server. Ini salinan pesanan di perangkatmu, <b>status terbaru belum bisa ditampilkan</b>. Coba lagi nanti.</span>
            </div>`);
    }
};

window.openTrackerModal = function () {
    if (isOpen('tracker-modal')) {
        closeModal('tracker-modal');
        return;
    }
    renderRecentOrders();
    openModal('tracker-modal');
};

/* =========================================================
   NOTIFIKASI
   ========================================================= */
window.showNotification = function (title, message, type = 'success', waUrl = null, orderId = null) {
    const modal = $('notification-modal');
    if (!modal) {
        console.warn(`${title}: ${message}`);
        return;
    }
    $('notification-title').innerText = title;
    $('notification-message').innerText = message;

    const icon = $('notification-icon');
    if (type === 'success') {
        icon.className = 'w-16 h-16 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center text-2xl mx-auto';
        icon.innerHTML = '<i class="fa-solid fa-check"></i>';
    } else {
        icon.className = 'w-16 h-16 bg-amber-50 text-amber-500 rounded-full flex items-center justify-center text-2xl mx-auto';
        icon.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
    }

    const orderBox = $('notification-order-box');
    if (orderBox) {
        orderBox.classList.toggle('hidden', !orderId);
        orderBox.classList.toggle('flex', !!orderId);
        $('notification-order-id').textContent = orderId || '';
        $('notification-copy-btn').onclick = () => copyText(orderId, 'ID pesanan disalin');
    }

    const waBtn = $('notification-wa-btn');
    if (waBtn) {
        waBtn.href = waUrl || '#';
        waBtn.classList.toggle('hidden', !waUrl);
        waBtn.classList.toggle('flex', !!waUrl);
    }
    $('notification-wa-hint')?.classList.toggle('hidden', !waUrl);

    openModal('notification-modal');
};

window.closeNotification = async function () {
    closeModal('notification-modal');
    await loadProductsFromSupabase();   // ambil stok terbaru
};

/* =========================================================
   TESTIMONI
   ========================================================= */
const TESTI_BUCKET = 'testimoni';

async function loadTestimonials() {
    await authReady;
    const container = $('testi-scroll');
    if (!container) return;

    try {
        const { data, error } = await supabase.storage
            .from(TESTI_BUCKET)
            .list('', { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });
        if (error) throw error;

        const files = (data || []).filter(f => f.name && !f.name.endsWith('/') && f.name !== '.emptyFolderPlaceholder');

        if (files.length === 0) {
            container.innerHTML = `<div class="flex-shrink-0 w-full text-center py-10 text-slate-400 text-sm">Belum ada testimoni yang ditampilkan.</div>`;
            return;
        }

        container.innerHTML = files.map(file => {
            const { data: urlData } = supabase.storage.from(TESTI_BUCKET).getPublicUrl(file.name);
            const url = esc(urlData?.publicUrl || '');
            return `
                <a href="${url}" target="_blank" rel="noopener" class="flex-shrink-0 snap-start w-56 sm:w-64">
                    <div class="w-full aspect-square rounded-2xl border border-slate-100 shadow-sm overflow-hidden bg-slate-50 flex items-center justify-center hover:shadow-md transition">
                        <img src="${url}" alt="Testimoni pelanggan" loading="lazy" class="w-full h-full object-contain p-[2px]">
                    </div>
                </a>`;
        }).join('');
    } catch (err) {
        console.error('[TESTI] Error saat load testimoni:', err);
        container.innerHTML = `<div class="flex-shrink-0 w-full text-center py-10 text-red-400 text-sm">Gagal memuat testimoni.</div>`;
    }
}

function scrollTesti(direction) {
    const container = $('testi-scroll');
    if (!container) return;
    const amount = container.clientWidth * 0.8;
    container.scrollBy({ left: direction === 'next' ? amount : -amount, behavior: 'smooth' });
}

$('testi-prev')?.addEventListener('click', () => scrollTesti('prev'));
$('testi-next')?.addEventListener('click', () => scrollTesti('next'));

/* =========================================================
   INIT
   ========================================================= */
applyStoreSettings();
loadStoreSettings();
setInterval(updateOpenStatus, 60 * 1000);
prefillCustomer();
updateCartUI();
loadProductsFromSupabase();
loadTestimonials();
