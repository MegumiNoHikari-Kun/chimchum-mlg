import { supabase, authReady } from '../supabase.js';

/* =========================================================
   STATE
========================================================= */

let cachedProducts = [];
let visibleProducts = [];
let cachedOrders = [];
let ordersError = null;
let kasirCart = {};              // { [id]: { id, nama, harga, qty, stok } }
let currentCategory = 'all';     // key kategori (lowercase)
let currentFilterStatus = 'all';

let kasirSubtotal = 0;
let kasirDiscount = 0;
let currentKasirGrandTotal = 0;
let appliedVoucher = null;

let isSubmittingKasir = false;   // cegah klik ganda (supaya stok tidak terpotong dua kali)
let voucherChecking = false;
let lastOrderForReprint = null;
let lastSeenNewCount = null;
let allowUnload = false;

const ORDER_TYPE_PREFIX = {
    Offline: 'DINEIN',
    GrabFood: 'GRAB',
    ShopeeFood: 'SHOPEE',
    GoFood: 'GOFOOD'
};

const DEFAULT_STOCK = 100;       // dipakai bila kolom stok kosong (sama seperti versi lama)
const LOW_STOCK = 5;
const ORDER_REFRESH_MS = 30000;
const NEW_ORDER_POLL_MS = 45000;
const PLACEHOLDER_IMG = 'https://placehold.co/300x225/fff7ed/ea580c?text=ChimChum';

const $ = id => document.getElementById(id);
const isFinePointer = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? true;
const collator = new Intl.Collator('id', { sensitivity: 'base', numeric: true });

/* =========================================================
   HELPER
========================================================= */

function rupiah(value) {
    const number = Number(value) || 0;
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0
    }).format(number);
}

function formatNumber(value) {
    return new Intl.NumberFormat('id-ID').format(Number(value) || 0);
}

function parseMoney(value) {
    return Number(String(value ?? '').replace(/\D/g, '')) || 0;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatWaktu(value) {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString('id-ID', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function formatJam(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function isValidWa(value) {
    const digits = String(value).replace(/[\s\-+().]/g, '');
    return /^\d{9,15}$/.test(digits);
}

// Getter produk (kolom bisa bernama Inggris / Indonesia)
const P = {
    id: p => String(p.id),
    name: p => (p.name ?? p.nama ?? '').toString().trim(),
    price: p => Number(p.price ?? p.harga ?? 0) || 0,
    category: p => (p.category ?? p.kategori ?? '').toString().trim() || 'Umum',
    image: p => (p.image ?? p.foto ?? '').toString().trim(),
    stock: p => {
        const raw = p.stok ?? p.stock;
        if (raw === null || raw === undefined || raw === '') return DEFAULT_STOCK;
        return Number(raw) || 0;
    }
};

function findProduct(id) {
    return cachedProducts.find(p => P.id(p) === String(id));
}

/* =========================================================
   UI PRIMITIVES: TOAST, MODAL, CONFIRM
========================================================= */

function toast(message, type = 'info', timeout = 3200) {
    const stack = $('toastStack');
    if (!stack) { alert(message); return; }

    const icons = {
        success: 'fa-circle-check',
        error: 'fa-circle-exclamation',
        warning: 'fa-triangle-exclamation',
        info: 'fa-circle-info'
    };

    const el = document.createElement('div');
    el.className = `toast toast--${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML = `
        <i class="fa-solid ${icons[type] || icons.info}"></i>
        <span>${escapeHtml(message).replace(/\n/g, '<br>')}</span>
        <button type="button" class="toast__close" aria-label="Tutup">&times;</button>
    `;

    const remove = () => {
        el.classList.add('is-leaving');
        setTimeout(() => el.remove(), 200);
    };
    el.querySelector('.toast__close').addEventListener('click', remove);

    stack.appendChild(el);
    while (stack.children.length > 4) stack.firstElementChild.remove();
    if (timeout) setTimeout(remove, timeout);
}

const modalStack = [];

function openModal(el) {
    if (!el || modalStack.includes(el)) return;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('is-open'));
    modalStack.push(el);
    document.body.classList.add('modal-open');
}

function closeModal(el) {
    if (!el) return;
    el.classList.remove('is-open');
    el.hidden = true;
    const i = modalStack.indexOf(el);
    if (i > -1) modalStack.splice(i, 1);
    if (!modalStack.length) document.body.classList.remove('modal-open');
}

function dismissTopModal() {
    const top = modalStack[modalStack.length - 1];
    if (!top) return false;
    if (typeof top._resolve === 'function') top._resolve(false);
    else if (top.id === 'paymentModal') window.closePaymentModal();
    else if (top.id === 'successModal') window.startNewTransaction();
    else closeModal(top);
    return true;
}

function confirmDialog({ title = 'Konfirmasi', message = '', okText = 'Ya', cancelText = 'Batal', danger = false } = {}) {
    const modal = $('confirmModal');
    if (!modal) return Promise.resolve(window.confirm(message));

    $('confirmTitle').textContent = title;
    $('confirmMessage').textContent = message;
    const okBtn = $('confirmOk');
    const cancelBtn = $('confirmCancel');
    okBtn.textContent = okText;
    cancelBtn.textContent = cancelText;
    okBtn.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;

    return new Promise(resolve => {
        const done = value => {
            okBtn.onclick = null;
            cancelBtn.onclick = null;
            modal._resolve = null;
            closeModal(modal);
            resolve(value);
        };
        okBtn.onclick = () => done(true);
        cancelBtn.onclick = () => done(false);
        modal._resolve = done;
        openModal(modal);
        setTimeout(() => okBtn.focus(), 30);
    });
}

function markInvalid(el, message) {
    if (!el) return;
    el.classList.remove('is-invalid');
    void el.offsetWidth; // restart animasi
    el.classList.add('is-invalid');
    el.focus();
    if (message) toast(message, 'warning');
    el.addEventListener('input', () => el.classList.remove('is-invalid'), { once: true });
}

/* =========================================================
   TAB SWITCH + LOGOUT
========================================================= */

let orderAutoRefreshInterval = null;

function startOrderAutoRefresh() {
    if (orderAutoRefreshInterval) return;
    orderAutoRefreshInterval = setInterval(() => {
        if (document.hidden) return;
        // jangan render ulang saat kasir sedang memilih status di dropdown
        if (document.activeElement?.closest?.('#orderTableBody')) return;
        window.loadOrders();
    }, ORDER_REFRESH_MS);
}

function stopOrderAutoRefresh() {
    if (orderAutoRefreshInterval) {
        clearInterval(orderAutoRefreshInterval);
        orderAutoRefreshInterval = null;
    }
}

window.switchTab = function (tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.toggle('active', el.id === tabId));
    document.querySelectorAll('.tab-btn[data-tab]').forEach(el => {
        const on = el.dataset.tab === tabId;
        el.classList.toggle('active', on);
        el.setAttribute('aria-selected', String(on));
    });

    window.toggleCartDrawer(false);

    if (tabId === 'tab-pesanan') {
        window.loadOrders();
        startOrderAutoRefresh();
    } else {
        stopOrderAutoRefresh();
    }
};

window.logoutKasir = async function () {
    const hasCart = Object.keys(kasirCart).length > 0;
    const ok = await confirmDialog({
        title: 'Keluar dari kasir?',
        message: hasCart ? 'Masih ada item di keranjang yang belum disimpan. Tetap keluar?' : 'Anda akan keluar dari dashboard kasir.',
        okText: 'Keluar',
        danger: true
    });
    if (!ok) return;

    allowUnload = true;
    try {
        await authReady;
        if (supabase?.auth) await supabase.auth.signOut();
    } catch (error) {
        console.error('❌ Error saat logout:', error);
    } finally {
        window.location.href = 'login.html';
    }
};

/* =========================================================
   LOAD PRODUCTS
========================================================= */

function sortProducts(list) {
    return [...list].sort((a, b) =>
        collator.compare(P.category(a), P.category(b)) ||
        collator.compare(P.name(a), P.name(b)) ||
        P.stock(a) - P.stock(b)
    );
}

let productsLoading = false;
let productsReloadQueued = false;

window.loadProducts = async () => {
    if (productsLoading) { productsReloadQueued = true; return; }
    productsLoading = true;

    try {
        await authReady;
        if (!supabase) throw new Error('Supabase tidak tersedia.');

        const { data, error } = await supabase.from('products').select('*');
        if (error) throw error;

        cachedProducts = sortProducts(data || []);
        syncCartWithStock();
        renderCategoryBar();
        applyMenuFilter();

    } catch (error) {
        console.error('❌ Error load produk:', error);
        const list = $('kasirMenuList');
        if (list && !cachedProducts.length) {
            list.innerHTML = `
                <div class="menu-empty menu-empty--error">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    <strong>Gagal mengambil produk dari database.</strong>
                    <small>${escapeHtml(error?.message || error)}</small>
                    <button type="button" class="btn btn-outline" data-action="reload-products">
                        <i class="fa-solid fa-rotate-right"></i> Coba lagi
                    </button>
                </div>`;
            $('menuCount').textContent = 'Menu gagal dimuat';
        } else {
            toast('Gagal memperbarui data produk: ' + (error?.message || error), 'error');
        }
    } finally {
        productsLoading = false;
        if (productsReloadQueued) {
            productsReloadQueued = false;
            window.loadProducts();
        }
    }
};

// Sesuaikan isi keranjang dengan stok terbaru dari database
function syncCartWithStock() {
    const adjusted = [];
    Object.values(kasirCart).forEach(item => {
        const p = findProduct(item.id);
        if (!p) return;
        item.stok = P.stock(p);
        if (item.stok <= 0) {
            delete kasirCart[item.id];
            adjusted.push(`${item.nama} (habis)`);
        } else if (item.qty > item.stok) {
            item.qty = item.stok;
            adjusted.push(`${item.nama} (maks ${item.stok})`);
        }
    });
    if (adjusted.length) {
        toast('Stok berubah, keranjang disesuaikan: ' + adjusted.join(', '), 'warning', 6000);
    }
    renderKasirCart();
}

/* =========================================================
   CATEGORY BAR + FILTER MENU
========================================================= */

function renderCategoryBar() {
    const bar = $('categoryBar');
    if (!bar) return;

    const map = new Map();
    cachedProducts.forEach(p => {
        const label = P.category(p);
        const key = label.toLowerCase();
        if (!map.has(key)) map.set(key, { label, count: 0 });
        map.get(key).count++;
    });

    if (currentCategory !== 'all' && !map.has(currentCategory)) currentCategory = 'all';

    const chip = (key, label, count) => `
        <button type="button" class="cat-chip ${currentCategory === key ? 'is-active' : ''}" data-cat="${escapeHtml(key)}">
            ${escapeHtml(label)} <span>${count}</span>
        </button>`;

    const cats = [...map.entries()].sort((a, b) => collator.compare(a[1].label, b[1].label));
    bar.innerHTML = chip('all', 'Semua', cachedProducts.length)
        + cats.map(([key, v]) => chip(key, v.label, v.count)).join('');
}

function setCategory(key) {
    currentCategory = key || 'all';
    document.querySelectorAll('#categoryBar .cat-chip').forEach(c =>
        c.classList.toggle('is-active', c.dataset.cat === currentCategory));
    applyMenuFilter();
    $('kasirMenuList')?.scrollTo({ top: 0 });
}

function getSearchQuery() {
    return ($('searchMenuKasir')?.value || '').trim().toLowerCase();
}

function applyMenuFilter() {
    const q = getSearchQuery();
    visibleProducts = cachedProducts.filter(p => {
        const cat = P.category(p).toLowerCase();
        if (currentCategory !== 'all' && cat !== currentCategory) return false;
        if (!q) return true;
        return P.name(p).toLowerCase().includes(q) || cat.includes(q);
    });

    renderKasirMenu(visibleProducts);

    const countEl = $('menuCount');
    if (countEl) {
        const filtered = visibleProducts.length !== cachedProducts.length;
        countEl.textContent = filtered
            ? `${visibleProducts.length} dari ${cachedProducts.length} menu`
            : `${cachedProducts.length} menu`;
    }
    const clearBtn = $('searchClear');
    if (clearBtn) clearBtn.hidden = !$('searchMenuKasir')?.value;
}

/* =========================================================
   RENDER MENU
========================================================= */

function renderKasirMenu(products = visibleProducts) {
    const list = $('kasirMenuList');
    if (!list) return;

    if (!cachedProducts.length) {
        list.innerHTML = `
            <div class="menu-empty">
                <i class="fa-solid fa-bowl-food"></i>
                <strong>Produk belum tersedia.</strong>
            </div>`;
        return;
    }

    if (!products.length) {
        const q = $('searchMenuKasir')?.value.trim();
        list.innerHTML = `
            <div class="menu-empty">
                <i class="fa-solid fa-magnifying-glass"></i>
                <strong>Tidak ada menu ${q ? `untuk “${escapeHtml(q)}”` : 'di kategori ini'}.</strong>
                <button type="button" class="btn btn-outline" data-action="reset-filter">Tampilkan semua menu</button>
            </div>`;
        return;
    }

    list.innerHTML = products.map(p => {
        const id = P.id(p);
        const nama = P.name(p);
        const harga = P.price(p);
        const stok = P.stock(p);
        const habis = stok <= 0;
        const low = !habis && stok <= LOW_STOCK;
        const qty = kasirCart[id]?.qty || 0;
        const foto = P.image(p) || PLACEHOLDER_IMG;

        return `
            <button type="button"
                class="menu-card ${habis ? 'is-out' : ''} ${qty ? 'in-cart' : ''}"
                data-id="${escapeHtml(id)}"
                ${habis ? 'disabled' : ''}
                aria-label="${escapeHtml(`${nama}, ${rupiah(harga)}${habis ? ', stok habis' : ''}`)}">
                <span class="menu-card__img">
                    <img src="${escapeHtml(foto)}" alt="" loading="lazy"
                         onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'">
                    ${qty ? `<span class="menu-card__qty">${qty}</span>` : ''}
                    ${habis ? `<span class="menu-card__flag">Habis</span>` : ''}
                    ${low ? `<span class="menu-card__flag menu-card__flag--low">Sisa ${stok}</span>` : ''}
                </span>
                <span class="menu-card__body">
                    <span class="menu-card__name">${escapeHtml(nama)}</span>
                    <span class="menu-card__meta">
                        <span class="menu-card__price">${rupiah(harga)}</span>
                        <span class="menu-card__stock ${low ? 'is-low' : ''}">${habis ? 'Stok habis' : `Stok ${stok}`}</span>
                    </span>
                </span>
            </button>`;
    }).join('');
}

// Update badge qty di kartu menu tanpa render ulang semua gambar
function updateMenuBadges() {
    document.querySelectorAll('#kasirMenuList .menu-card').forEach(card => {
        const qty = kasirCart[card.dataset.id]?.qty || 0;
        card.classList.toggle('in-cart', qty > 0);
        let badge = card.querySelector('.menu-card__qty');
        if (qty > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'menu-card__qty';
                card.querySelector('.menu-card__img')?.appendChild(badge);
            }
            badge.textContent = qty;
        } else if (badge) {
            badge.remove();
        }
    });
}

function bumpCard(id) {
    const card = document.querySelector(`#kasirMenuList .menu-card[data-id="${CSS.escape(String(id))}"]`);
    if (card) {
        card.classList.remove('bump');
        void card.offsetWidth;
        card.classList.add('bump');
    }
    const fab = $('cartFab');
    if (fab) {
        fab.classList.remove('bump');
        void fab.offsetWidth;
        fab.classList.add('bump');
    }
}

/* =========================================================
   CART
========================================================= */

window.addToKasirCart = function (id, nama, harga, stok) {
    const productId = String(id);
    const p = findProduct(productId);
    nama = p ? P.name(p) : String(nama ?? '');
    harga = p ? P.price(p) : (Number(harga) || 0);
    stok = p ? P.stock(p) : Number(stok ?? DEFAULT_STOCK);

    if (stok <= 0) {
        toast(`Stok ${nama} habis.`, 'warning');
        return false;
    }

    if (!kasirCart[productId]) {
        kasirCart[productId] = { id: productId, nama, harga, qty: 0, stok };
    }
    const item = kasirCart[productId];
    item.stok = stok;

    if (item.qty >= item.stok) {
        toast(`Stok ${nama} hanya ${item.stok}.`, 'warning');
        return false;
    }

    item.qty++;
    renderKasirCart({ highlightId: productId });
    bumpCard(productId);
    return true;
};

function setCartQty(id, qty) {
    const item = kasirCart[String(id)];
    if (!item) return;

    qty = Math.floor(Number(qty));
    if (!Number.isFinite(qty)) qty = item.qty;

    if (qty <= 0) {
        delete kasirCart[item.id];
    } else if (qty > item.stok) {
        item.qty = item.stok;
        toast(`Stok ${item.nama} hanya ${item.stok}.`, 'warning');
    } else {
        item.qty = qty;
    }
    renderKasirCart();
}

window.changeKasirQty = function (id, perubahan) {
    const item = kasirCart[String(id)];
    if (item) setCartQty(id, item.qty + Number(perubahan));
};

window.removeFromKasirCart = function (id) {
    delete kasirCart[String(id)];
    renderKasirCart();
};

window.clearKasirCart = async function (ask = false) {
    if (ask && Object.keys(kasirCart).length) {
        const ok = await confirmDialog({
            title: 'Kosongkan pesanan?',
            message: 'Semua item di keranjang akan dihapus.',
            okText: 'Kosongkan',
            danger: true
        });
        if (!ok) return;
    }
    kasirCart = {};
    renderKasirCart();
};

function renderKasirCart({ highlightId } = {}) {
    const container = $('kasirCartItems');
    if (!container) return;

    const items = Object.values(kasirCart);

    if (!items.length) {
        container.innerHTML = `
            <div class="cart-empty">
                <i class="fa-solid fa-basket-shopping"></i>
                <strong>Belum ada item</strong>
                <small>Ketuk menu untuk menambahkan ke pesanan.</small>
            </div>`;
    } else {
        container.innerHTML = items.map(item => {
            const atMax = item.qty >= item.stok;
            return `
                <div class="cart-item ${item.id === highlightId ? 'is-flash' : ''}" data-id="${escapeHtml(item.id)}">
                    <div class="cart-item__name">${escapeHtml(item.nama)}</div>
                    <div class="cart-item__total">${rupiah(item.harga * item.qty)}</div>
                    <div class="cart-item__price">
                        ${rupiah(item.harga)}
                        ${atMax ? `<span class="warn">· maks stok</span>` : ''}
                    </div>
                    <div class="stepper">
                        <button type="button" data-action="dec" class="${item.qty === 1 ? 'is-remove' : ''}"
                                aria-label="${item.qty === 1 ? 'Hapus' : 'Kurangi'} ${escapeHtml(item.nama)}">
                            <i class="fa-solid ${item.qty === 1 ? 'fa-trash-can' : 'fa-minus'}"></i>
                        </button>
                        <input type="text" inputmode="numeric" class="qty-input" data-action="qty"
                               value="${item.qty}" aria-label="Jumlah ${escapeHtml(item.nama)}">
                        <button type="button" data-action="inc" ${atMax ? 'disabled' : ''}
                                aria-label="Tambah ${escapeHtml(item.nama)}">
                            <i class="fa-solid fa-plus"></i>
                        </button>
                    </div>
                </div>`;
        }).join('');

        if (highlightId) {
            container.querySelector(`.cart-item[data-id="${CSS.escape(highlightId)}"]`)
                ?.scrollIntoView({ block: 'nearest' });
        }
    }

    updateKasirTotal();
    updateMenuBadges();
    updateCartMeta();
    window.hitungKembalian();
}

function calculateKasirTotal() {
    return Object.values(kasirCart).reduce((t, i) => t + Number(i.harga) * Number(i.qty), 0);
}

function updateCartMeta() {
    const items = Object.values(kasirCart);
    const qty = items.reduce((s, i) => s + i.qty, 0);

    $('cartCount').textContent = qty;
    $('btnClearCart').hidden = !items.length;

    $('fabCount').textContent = qty ? `${qty} item` : 'Keranjang kosong';
    $('fabTotal').textContent = rupiah(currentKasirGrandTotal);
    $('cartFab').classList.toggle('has-items', qty > 0);

    const btn = $('btnCheckout');
    btn.disabled = !items.length;
    $('btnCheckoutLabel').textContent = items.length ? `Bayar ${rupiah(currentKasirGrandTotal)}` : 'Bayar';
    $('checkoutHint').textContent = items.length ? '' : 'Pilih menu untuk memulai transaksi.';
}

/* =========================================================
   VOUCHER / DISKON
========================================================= */

function computeDiscount(voucher, subtotal) {
    if (!voucher || subtotal <= 0) return 0;
    if (subtotal < Number(voucher.min_purchase || 0)) return 0;

    const value = Number(voucher.discount_value) || 0;
    let disc = voucher.discount_type === 'percent'
        ? subtotal * Math.min(Math.max(value, 0), 100) / 100
        : value;

    if (voucher.discount_type === 'percent' && Number(voucher.max_discount) > 0) {
        disc = Math.min(disc, Number(voucher.max_discount));
    }
    return Math.max(0, Math.min(Math.round(disc), subtotal));
}

function describeVoucher(v) {
    if (!v) return '';
    const parts = [];
    const val = Number(v.discount_value) || 0;
    if (v.discount_type === 'percent') {
        parts.push(`Diskon ${val}%` + (Number(v.max_discount) > 0 ? ` (maks ${rupiah(v.max_discount)})` : ''));
    } else {
        parts.push(`Potongan ${rupiah(val)}`);
    }
    const min = Number(v.min_purchase) || 0;
    if (min > 0) parts.push(`min. belanja ${rupiah(min)}`);
    if (v.end_at) parts.push(`berlaku s/d ${formatWaktu(v.end_at)}`);
    if (v.quota !== null && v.quota !== undefined) {
        parts.push(`sisa kuota ${Math.max(0, Number(v.quota) - Number(v.used_count || 0))}`);
    }
    return parts.join(' · ');
}

// Mengembalikan pesan error (string) atau '' bila voucher valid
function validateVoucher(v, subtotal) {
    if (!v) return 'Kode voucher tidak ditemukan.';
    if (!v.is_active) return 'Voucher sedang tidak aktif.';

    const now = new Date();
    if (v.start_at && new Date(v.start_at) > now) return `Voucher baru berlaku mulai ${formatWaktu(v.start_at)}.`;
    if (v.end_at && new Date(v.end_at) < now) return `Voucher sudah kedaluwarsa sejak ${formatWaktu(v.end_at)}.`;
    if (v.quota !== null && v.quota !== undefined && Number(v.used_count || 0) >= Number(v.quota)) {
        return 'Kuota voucher sudah habis.';
    }

    const min = Number(v.min_purchase || 0);
    if (subtotal < min) return `Minimal belanja ${rupiah(min)} — kurang ${rupiah(min - subtotal)} lagi.`;
    if (computeDiscount(v, subtotal) <= 0) return 'Voucher ini tidak memberi potongan untuk pesanan ini.';
    return '';
}

function showVoucherMsg(text, type = 'info') {
    const el = $('kasirVoucherMsg');
    if (!el) return;
    if (type === true) type = 'error';      // kompatibel dengan pemanggilan lama
    if (type === false) type = 'success';
    el.className = `voucher-msg is-${type}`;
    el.innerHTML = text
        ? `<i class="fa-solid ${type === 'error' ? 'fa-circle-exclamation' : type === 'success' ? 'fa-circle-check' : 'fa-circle-info'}"></i> ${escapeHtml(text)}`
        : '';
}

function setVoucherLoading(on) {
    voucherChecking = on;
    const btn = $('btnApplyVoucher');
    if (!btn) return;
    btn.disabled = on;
    btn.classList.toggle('is-loading', on);
    btn.textContent = on ? 'Cek…' : 'Pakai';
}

function renderVoucherState() {
    const row = $('voucherInputRow');
    const box = $('voucherApplied');
    if (!row || !box) return;

    if (!appliedVoucher) {
        row.hidden = false;
        box.hidden = true;
        box.innerHTML = '';
        return;
    }

    row.hidden = true;
    box.hidden = false;

    const min = Number(appliedVoucher.min_purchase || 0);
    const eligible = kasirSubtotal > 0 && kasirDiscount > 0;
    let status;
    if (eligible) {
        status = `<span class="voucher-status">Hemat ${rupiah(kasirDiscount)}</span>`;
    } else if (kasirSubtotal <= 0) {
        status = `<span class="voucher-status">Tambahkan item agar voucher berlaku</span>`;
    } else if (kasirSubtotal < min) {
        status = `<span class="voucher-status">Belum berlaku — tambah belanja ${rupiah(min - kasirSubtotal)} lagi</span>`;
    } else {
        status = `<span class="voucher-status">Belum memberi potongan</span>`;
    }

    box.className = `voucher-applied ${eligible ? 'is-ok' : 'is-pending'}`;
    box.innerHTML = `
        <i class="fa-solid ${eligible ? 'fa-ticket' : 'fa-hourglass-half'}"></i>
        <div class="voucher-applied__text">
            <strong>${escapeHtml(appliedVoucher.code)}</strong>
            <small>${escapeHtml(describeVoucher(appliedVoucher))}</small>
            ${status}
        </div>
        <button type="button" class="icon-btn icon-btn--ghost" data-action="remove-voucher" title="Hapus voucher" aria-label="Hapus voucher">
            <i class="fa-solid fa-xmark"></i>
        </button>`;
}

function updateKasirTotal() {
    kasirSubtotal = calculateKasirTotal();
    kasirDiscount = computeDiscount(appliedVoucher, kasirSubtotal);
    currentKasirGrandTotal = Math.max(0, kasirSubtotal - kasirDiscount);

    $('kasirSubtotal').textContent = rupiah(kasirSubtotal);

    const rowDiskon = $('rowDiskon');
    if (rowDiskon) {
        rowDiskon.hidden = !(appliedVoucher && kasirDiscount > 0);
        $('labelDiskon').textContent = appliedVoucher ? `Diskon (${appliedVoucher.code})` : 'Diskon';
        $('kasirDiskon').textContent = `- ${rupiah(kasirDiscount)}`;
    }

    $('kasirGrandTotal').textContent = rupiah(currentKasirGrandTotal);
    renderVoucherState();
}

window.applyVoucher = async function () {
    if (voucherChecking) return;

    const input = $('kasirVoucherCode');
    const code = (input?.value || '').trim().toUpperCase();
    if (input) input.value = code;

    if (!code) {
        showVoucherMsg('Masukkan kode voucher.', 'error');
        input?.focus();
        return;
    }
    if (!Object.keys(kasirCart).length) {
        showVoucherMsg('Tambahkan item dulu sebelum memakai voucher.', 'error');
        return;
    }

    setVoucherLoading(true);
    showVoucherMsg('Memeriksa voucher…', 'info');

    try {
        await authReady;
        if (!supabase) throw new Error('Supabase tidak tersedia.');

        const { data: v, error } = await supabase
            .from('vouchers')
            .select('*')
            .eq('code', code)
            .maybeSingle();
        if (error) throw error;

        const problem = validateVoucher(v, kasirSubtotal);
        if (problem) {
            showVoucherMsg(problem, 'error');
            input?.select();
            return;
        }

        appliedVoucher = v;
        showVoucherMsg('');
        updateKasirTotal();
        updateCartMeta();
        window.hitungKembalian();
        toast(`Voucher ${v.code} dipakai — hemat ${rupiah(kasirDiscount)}.`, 'success');

    } catch (err) {
        console.error('❌ Error voucher:', err);
        showVoucherMsg('Gagal memeriksa voucher: ' + (err?.message || err), 'error');
    } finally {
        setVoucherLoading(false);
    }
};

window.removeVoucher = function () {
    appliedVoucher = null;
    const input = $('kasirVoucherCode');
    if (input) { input.value = ''; input.disabled = false; }
    showVoucherMsg('');
    updateKasirTotal();
    updateCartMeta();
    window.hitungKembalian();
};

window.setJenisPesanan = function (type) {
    $('kasirJenisPesanan').value = type;
    document.querySelectorAll('#orderTypeGroup .seg-btn').forEach(btn =>
        btn.classList.toggle('is-active', btn.dataset.type === type));
};

/* =========================================================
   PEMBAYARAN (MODAL) + KALKULATOR CASH
========================================================= */

function getUangBayar() {
    return parseMoney($('kasirUangBayar')?.value);
}

window.setUangBayar = function (n) {
    const el = $('kasirUangBayar');
    if (el) el.value = n > 0 ? formatNumber(n) : '';
    window.hitungKembalian();
};

window.setUangCepat = n => window.setUangBayar(getUangBayar() + Number(n));
window.setUangPas = () => window.setUangBayar(currentKasirGrandTotal);

function cashSuggestions(total) {
    if (total <= 0) return [];
    const set = new Set([total]);
    [1000, 2000, 5000, 10000, 20000, 50000, 100000].forEach(step => {
        const v = Math.ceil(total / step) * step;
        if (v > total) set.add(v);
    });
    [50000, 100000, 200000].forEach(v => { if (v > total) set.add(v); });
    return [...set].sort((a, b) => a - b).slice(0, 6);
}

function renderCashQuick() {
    const box = $('cashQuick');
    if (!box) return;
    const list = cashSuggestions(currentKasirGrandTotal);
    box.innerHTML = list.map(v => `
        <button type="button" class="chip ${v === currentKasirGrandTotal ? 'is-exact' : ''}" data-amount="${v}">
            ${v === currentKasirGrandTotal ? 'Uang Pas' : formatNumber(v)}
        </button>`).join('');
}

window.toggleCashSection = function () {
    const metode = $('kasirMetodeBayar')?.value || 'Cash';
    const cash = metode === 'Cash';
    const cashBox = $('sectionKalkulatorCash');
    const nonCash = $('sectionNonCash');
    if (cashBox) cashBox.hidden = !cash;
    if (nonCash) nonCash.hidden = cash;
    const name = $('payMethodName');
    if (name) name.textContent = metode === 'Transfer' ? 'transfer bank' : metode;
    updatePaySubmitState();
};

window.setMetodeBayar = function (method) {
    $('kasirMetodeBayar').value = method;
    document.querySelectorAll('#payMethodGroup .seg-btn').forEach(btn =>
        btn.classList.toggle('is-active', btn.dataset.method === method));
    window.toggleCashSection();
    if (method === 'Cash' && isFinePointer && !$('paymentModal').hidden) {
        setTimeout(() => $('kasirUangBayar')?.focus(), 30);
    }
};

window.hitungKembalian = function () {
    const valueEl = $('kasirKembalian');
    const box = $('changeBox');
    const label = $('changeLabel');
    if (!valueEl || !box) return;

    const uang = getUangBayar();
    const diff = uang - currentKasirGrandTotal;
    box.classList.remove('is-short', 'is-ok');

    if (!uang) {
        label.textContent = 'Kembalian';
        valueEl.textContent = rupiah(0);
    } else if (diff < 0) {
        label.textContent = 'Uang kurang';
        valueEl.textContent = rupiah(-diff);
        box.classList.add('is-short');
    } else {
        label.textContent = 'Kembalian';
        valueEl.textContent = rupiah(diff);
        box.classList.add('is-ok');
    }

    document.querySelectorAll('#cashQuick .chip').forEach(c =>
        c.classList.toggle('is-active', Number(c.dataset.amount) === uang));

    updatePaySubmitState();
};

function updatePaySubmitState() {
    const btn = $('btnSubmitOrder');
    const label = $('paySubmitLabel');
    if (!btn || !label) return;

    const cash = ($('kasirMetodeBayar')?.value || 'Cash') === 'Cash';
    const uang = getUangBayar();
    const short = cash && uang < currentKasirGrandTotal;

    btn.disabled = isSubmittingKasir || short;
    btn.classList.toggle('is-loading', isSubmittingKasir);

    if (isSubmittingKasir) label.textContent = 'Menyimpan…';
    else if (short) label.textContent = uang ? `Kurang ${rupiah(currentKasirGrandTotal - uang)}` : 'Masukkan uang diterima';
    else label.textContent = `Selesaikan · ${rupiah(currentKasirGrandTotal)}`;

    const back = $('btnPayBack');
    if (back) back.disabled = isSubmittingKasir;
}

function renderPaymentSummary() {
    const items = Object.values(kasirCart);
    const nama = $('kasirNomorMeja').value.trim();
    const jenis = $('kasirJenisPesanan').value || 'Offline';
    const wa = $('kasirWaPelanggan').value.trim();

    $('payCustomer').innerHTML = `
        <span class="pay-customer__name"><i class="fa-solid fa-user"></i> ${escapeHtml(nama)}</span>
        <span class="tag">${escapeHtml(jenis)}</span>
        ${wa ? `<small class="muted"><i class="fa-brands fa-whatsapp"></i> ${escapeHtml(wa)}</small>` : ''}`;

    $('payItems').innerHTML = items.map(i => `
        <div class="pay-item">
            <span><strong>${i.qty}×</strong> ${escapeHtml(i.nama)}</span>
            <span>${rupiah(i.qty * i.harga)}</span>
        </div>`).join('');

    $('paySubtotal').textContent = rupiah(kasirSubtotal);
    $('payDiscountRow').hidden = !(kasirDiscount > 0);
    $('payDiscountLabel').textContent = `Diskon${appliedVoucher ? ` (${appliedVoucher.code})` : ''}`;
    $('payDiscount').textContent = `- ${rupiah(kasirDiscount)}`;
    $('payTotal').textContent = rupiah(currentKasirGrandTotal);
    $('payNonCashTotal').textContent = rupiah(currentKasirGrandTotal);

    renderCashQuick();
}

window.openPaymentModal = async function () {
    if (isSubmittingKasir) return;
    const items = Object.values(kasirCart);
    if (!items.length) {
        toast('Keranjang masih kosong.', 'warning');
        return;
    }

    const nameEl = $('kasirNomorMeja');
    if (!nameEl.value.trim()) {
        window.toggleCartDrawer(true);
        markInvalid(nameEl, 'Isi Nama / Meja pelanggan dulu.');
        return;
    }

    const waEl = $('kasirWaPelanggan');
    if (waEl.value.trim() && !isValidWa(waEl.value.trim())) {
        window.toggleCartDrawer(true);
        markInvalid(waEl, 'Nomor WhatsApp tidak valid (9–15 digit).');
        return;
    }

    // Voucher dipasang tapi tidak memenuhi syarat → jangan diam-diam memakai kuota
    if (appliedVoucher) {
        const problem = validateVoucher(appliedVoucher, kasirSubtotal);
        if (problem) {
            const ok = await confirmDialog({
                title: 'Voucher tidak bisa dipakai',
                message: `Voucher ${appliedVoucher.code}: ${problem} Lanjut bayar tanpa voucher?`,
                okText: 'Lanjut tanpa voucher',
                cancelText: 'Kembali'
            });
            if (!ok) return;
            window.removeVoucher();
        }
    }

    renderPaymentSummary();
    window.setUangBayar(0);
    window.setMetodeBayar($('kasirMetodeBayar').value || 'Cash');
    openModal($('paymentModal'));

    if (isFinePointer && $('kasirMetodeBayar').value === 'Cash') {
        setTimeout(() => $('kasirUangBayar')?.focus(), 60);
    }
};

window.closePaymentModal = function () {
    if (isSubmittingKasir) return;
    closeModal($('paymentModal'));
};

/* =========================================================
   RECEIPT PRINTING
========================================================= */

function buildStrukHTML(order) {
    const tanggal = new Date(order.created_at).toLocaleString('id-ID', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });

    const reprintInfo = order.isReprint
        ? `
            <div class="struk-line"></div>
            <div class="struk-center bold" style="font-size:11px;">REPRINT</div>
            <div class="struk-center" style="font-size:10px;">
                Waktu Reprint: ${escapeHtml(order.reprintTime)}
            </div>
        `
        : '';

    const itemsRows = (order.items || []).map(i => {
        const subtotal = Number(i.harga) * Number(i.qty);
        return `
            <div class="struk-row">
                <span class="struk-item-name">${escapeHtml(i.nama)} x${i.qty}</span>
                <span>${rupiah(subtotal)}</span>
            </div>
        `;
    }).join('');

    const diskon = Number(order.discount_amount) || 0;
    // fallback untuk order lama yang belum punya kolom subtotal
    const subtotal = Number(order.subtotal) || (Number(order.grand_total) + diskon);

    const diskonRows = diskon > 0
        ? `
            <div class="struk-row">
                <span>Subtotal</span>
                <span>${rupiah(subtotal)}</span>
            </div>
            <div class="struk-row">
                <span>Diskon${order.voucher_code ? ` (${escapeHtml(order.voucher_code)})` : ''}</span>
                <span>- ${rupiah(diskon)}</span>
            </div>
        `
        : '';

    const bayarRows = order.payment_method === 'Cash'
        ? `
            <div class="struk-row">
                <span>Tunai Diterima</span>
                <span>${rupiah(order._uangBayar)}</span>
            </div>
            <div class="struk-row">
                <span>Kembalian</span>
                <span>${rupiah(order._kembalian)}</span>
            </div>
        `
        : '';

    return `
        <div class="struk-center">
            <div class="center">
              <img src="https://cdn.jsdelivr.net/gh/MegumiNoHikari-Kun/chimchum-malang@main/assets/logo-transparan_new.png" style="width: 65px; height: 65px; object-fit: contain;">
            </div>
            <div class="bold" style="font-size:15px;margin-top:2px;">CHIMCHUM MALANG</div>
            <div style="font-size:10px;">Dimsum &amp; Snack</div>
            <div style="font-size:10px;">Sawojajar, Malang</div>
        </div>
        ${reprintInfo}

        <div class="struk-line"></div>

        <div>No: ${escapeHtml(order.order_id)}</div>
        <div>${escapeHtml(tanggal)}</div>
        <div>Meja/Nama: ${escapeHtml(order.customer_name)}</div>
        <div>Jenis: ${escapeHtml(order.order_type || 'Offline')}</div>

        <div class="struk-line"></div>

        ${itemsRows}

        <div class="struk-line"></div>

        ${diskonRows}

        <div class="struk-row bold">
            <span>TOTAL</span>
            <span>${rupiah(order.grand_total)}</span>
        </div>

        <div class="struk-row">
            <span>Metode Bayar</span>
            <span>${escapeHtml(order.payment_method)}</span>
        </div>

        ${bayarRows}

        <div class="struk-line"></div>

        <div class="struk-center">
            <div style="font-size:10px;margin-bottom:3px;">Tersedia juga di:</div>
            <div class="delivery-badges">
                <span style="background-color:#28a745;color:#fff;padding:4px 8px;border-radius:4px;font-weight:bold;">GOFOOD</span>
                <span style="background-color:#ff5722;color:#fff;padding:4px 8px;border-radius:4px;font-weight:bold;">SHOPEEFOOD</span>
                <span style="background-color:#28a745;color:#fff;padding:4px 8px;border-radius:4px;font-weight:bold;">GRABFOOD</span>
            </div>
        </div>

        <div class="struk-line"></div>

        <div class="struk-center">Terima kasih atas kunjungan Anda!</div>
        <div class="center" style="font-size:10px; margin-top:8px;">Jazakumullahu Khairan</div>
    `;
}

// return true bila jendela cetak berhasil dibuka
function cetakStrukKasir(order) {
    const printWindow = window.open('', '_blank', 'width=350,height=600');
    if (!printWindow) return false;

    printWindow.document.write(`
        <html>
        <head>
            <title>Struk Belanja - ChimChum</title>
            <style>
                @page { margin: 0; size: 58mm auto; }
                body {
                    font-family: 'Courier New', Courier, monospace;
                    width: 58mm;
                    margin: 0;
                    padding: 2mm;
                    font-size: 11px;
                    line-height: 1.4;
                    color: #000;
                }
                .struk-center, .center, .text-center { text-align: center; }
                .bold { font-weight: bold; }
                .struk-line { border-top: 1px dashed #000; margin: 4px 0; }
                .struk-row { display: flex; justify-content: space-between; gap: 6px; }
                .struk-item-name { flex: 1; word-break: break-word; }
                .delivery-badges { display: flex; justify-content: center; gap: 4px; flex-wrap: wrap; margin-top: 2px; }
            </style>
        </head>
        <body>
            ${buildStrukHTML(order)}
            <script>
                window.onload = function() {
                    window.print();
                    setTimeout(function() { window.close(); }, 300);
                };
            <\/script>
        </body>
        </html>
    `);
    printWindow.document.close();
    return true;
}

const POPUP_BLOCKED_MSG = 'Popup cetak diblokir browser. Izinkan popup untuk situs ini, lalu cetak ulang.';

/* =========================================================
   SUBMIT ORDER (CREATE)
========================================================= */

async function reduceStockForItems(items) {
    const failed = [];

    for (const item of items) {
        const qty = Number(item.qty || 0);
        if (!item.id || qty <= 0) continue;

        // id di keranjang berupa string; kirim sebagai angka bila memang angka
        const productId = /^\d+$/.test(String(item.id)) ? Number(item.id) : item.id;

        try {
            const { data, error } = await supabase.rpc('reduce_product_stock', {
                p_product_id: productId,
                p_quantity: qty
            });
            if (error) throw error;
            if (data !== true) failed.push(`${item.nama} (stok tidak cukup)`);
        } catch (err) {
            console.error('[STOCK] Gagal mengurangi stok:', item.nama, err);
            failed.push(`${item.nama} (${err?.message || 'error'})`);
        }
    }

    return failed;
}

function generateOrderId(jenisPesanan) {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const rand = Math.floor(1000 + Math.random() * 9000); // selalu 4 digit
    const prefix = ORDER_TYPE_PREFIX[jenisPesanan] || 'ORDER';
    return `${prefix}-${yy}${mm}${dd}${hh}${min}-${rand}`;
}

function setSubmitting(on) {
    isSubmittingKasir = on;
    $('paymentModal')?.classList.toggle('is-busy', on);
    updatePaySubmitState();
}

function resetKasirForm() {
    kasirCart = {};
    $('kasirNomorMeja').value = '';
    $('kasirWaPelanggan').value = '';
    window.removeVoucher();
    window.setJenisPesanan('Offline');
    $('kasirMetodeBayar').value = 'Cash';
    document.querySelectorAll('#payMethodGroup .seg-btn').forEach(b =>
        b.classList.toggle('is-active', b.dataset.method === 'Cash'));
    window.setUangBayar(0);
    renderKasirCart();
    window.toggleCartDrawer(false);
}

window.submitKasirOrder = async function () {
    if (isSubmittingKasir) return;

    const items = Object.values(kasirCart).map(i => ({ ...i }));
    const namaMeja = $('kasirNomorMeja')?.value.trim();
    const wa = $('kasirWaPelanggan')?.value.trim() || null;
    const metodeBayar = $('kasirMetodeBayar')?.value || 'Cash';
    const jenisPesanan = $('kasirJenisPesanan')?.value || 'Offline';
    const printStruk = $('printStrukCheck')?.checked;
    const uangBayar = metodeBayar === 'Cash' ? getUangBayar() : 0;

    if (!items.length) {
        toast('Keranjang masih kosong.', 'warning');
        window.closePaymentModal();
        return;
    }
    if (!namaMeja) {
        window.closePaymentModal();
        markInvalid($('kasirNomorMeja'), 'Nama / Meja wajib diisi.');
        return;
    }
    if (metodeBayar === 'Cash' && uangBayar < currentKasirGrandTotal) {
        toast('Uang tunai diterima kurang dari total tagihan.', 'warning');
        $('kasirUangBayar')?.focus();
        return;
    }

    // Voucher hanya dipakai bila benar-benar memberi potongan
    const voucher = appliedVoucher && kasirDiscount > 0 ? appliedVoucher : null;
    const subtotal = kasirSubtotal;
    const discount = voucher ? kasirDiscount : 0;
    const grandTotal = Math.max(0, subtotal - discount);

    setSubmitting(true);

    try {
        await authReady;
        if (!supabase) throw new Error('Supabase tidak tersedia.');

        // Pakai voucher secara atomik (cek kuota di server)
        if (voucher) {
            const { data: ok, error: rpcErr } = await supabase.rpc('redeem_voucher', { p_code: voucher.code });
            if (rpcErr) throw rpcErr;
            if (!ok) {
                setSubmitting(false);
                window.removeVoucher();
                renderPaymentSummary();
                window.hitungKembalian();
                toast(`Voucher ${voucher.code} sudah tidak valid (kuota habis / kedaluwarsa). `
                    + 'Total sudah dihitung ulang tanpa diskon — periksa lalu proses lagi.', 'error', 8000);
                return;
            }
        }

        const kembalian = metodeBayar === 'Cash' ? uangBayar - grandTotal : 0;
        const addressNote = metodeBayar === 'Cash'
            ? `${jenisPesanan} | Uang diterima: ${rupiah(uangBayar)} | Kembalian: ${rupiah(kembalian)}`
            : jenisPesanan;

        const orderPayload = {
            order_id: generateOrderId(jenisPesanan),
            customer_name: namaMeja,
            phone: wa,
            address: addressNote,
            items: items.map(i => ({ id: i.id, nama: i.nama, harga: i.harga, qty: i.qty })),
            subtotal,
            voucher_code: voucher?.code ?? null,
            discount_amount: discount,
            grand_total: grandTotal,
            payment_method: metodeBayar,
            order_type: jenisPesanan,
            status: 'new',
            created_at: new Date().toISOString(),
            payment_proof: null
        };

        const { error } = await supabase.from('orders').insert(orderPayload).select();
        if (error) {
            if (voucher) console.warn('⚠️ Voucher sudah ter-redeem tetapi order gagal disimpan:', voucher.code);
            throw error;
        }

        if (lastSeenNewCount !== null) lastSeenNewCount++; // order sendiri bukan "pesanan baru masuk"

        // Kurangi stok setelah order tersimpan
        const stockFailed = await reduceStockForItems(items);

        const printable = { ...orderPayload, _uangBayar: uangBayar, _kembalian: kembalian };
        lastOrderForReprint = printable;

        const printBlocked = printStruk ? !cetakStrukKasir(printable) : false;

        setSubmitting(false);
        closeModal($('paymentModal'));
        resetKasirForm();
        showSuccessModal(printable, stockFailed, printBlocked);

        window.loadOrders();
        window.loadProducts();

    } catch (error) {
        console.error('❌ Error submit order:', error);
        toast('Gagal menyimpan transaksi: ' + (error?.message || error)
            + (voucher ? '\nCatatan: kuota voucher mungkin sudah terpakai, cek di admin.' : ''), 'error', 9000);
    } finally {
        if (isSubmittingKasir) setSubmitting(false);
    }
};

function showSuccessModal(order, stockFailed = [], printBlocked = false) {
    const cash = order.payment_method === 'Cash';

    $('successOrderId').textContent = `No. ${order.order_id}`;
    $('successTotal').textContent = rupiah(order.grand_total);
    $('successMethod').textContent = order.payment_method;
    $('successChangeBox').hidden = !cash;
    $('successPaidLabel').hidden = !cash;
    $('successPaid').hidden = !cash;
    if (cash) {
        $('successChange').textContent = rupiah(order._kembalian);
        $('successPaid').textContent = rupiah(order._uangBayar);
    }

    const msgs = [];
    if (stockFailed.length) {
        msgs.push(`<strong><i class="fa-solid fa-triangle-exclamation"></i> Stok berikut GAGAL dikurangi:</strong>
            <ul>${stockFailed.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
            Mohon sesuaikan stok secara manual / hubungi admin.`);
    }
    if (printBlocked) {
        msgs.push(`<strong><i class="fa-solid fa-print"></i> ${POPUP_BLOCKED_MSG}</strong>`);
    }
    const warn = $('successWarning');
    warn.hidden = !msgs.length;
    warn.innerHTML = msgs.join('<hr>');

    openModal($('successModal'));
    setTimeout(() => $('btnNewTransaction')?.focus(), 60);
}

window.printLastReceipt = function () {
    if (!lastOrderForReprint) return;
    if (!cetakStrukKasir(lastOrderForReprint)) toast(POPUP_BLOCKED_MSG, 'error', 6000);
};

window.startNewTransaction = function () {
    closeModal($('successModal'));
    if (isFinePointer) $('searchMenuKasir')?.focus();
};

/* =========================================================
   LOAD ORDERS (READ)
========================================================= */

function periodStart(periode) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    if (periode === 'today') return d;
    if (periode === '7d') { d.setDate(d.getDate() - 6); return d; }
    if (periode === '30d') { d.setDate(d.getDate() - 29); return d; }
    return null;
}

function periodLabel(periode) {
    return { today: 'hari ini', '7d': '7 hari terakhir', '30d': '30 hari terakhir', all: 'semua periode' }[periode] || '';
}

let ordersLoading = false;
let ordersReloadQueued = false;

window.loadOrders = async (manual = false) => {
    if (ordersLoading) { ordersReloadQueued = true; return; }
    ordersLoading = true;

    const btn = $('btnRefreshOrders');
    btn?.classList.add('is-loading');

    try {
        await authReady;
        if (!supabase) throw new Error('Supabase tidak tersedia.');

        const periode = $('filterPeriode')?.value || 'today';
        let query = supabase
            .from('orders')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(1000);

        const start = periodStart(periode);
        if (start) query = query.gte('created_at', start.toISOString());

        const { data, error } = await query;
        if (error) throw error;

        cachedOrders = data || [];
        ordersError = null;

        const upd = $('ordersUpdated');
        if (upd) upd.textContent = `Diperbarui ${formatJam(new Date())} · otomatis tiap 30 detik saat tab ini dibuka`;
        if (manual) toast('Data pesanan diperbarui.', 'success', 1800);

    } catch (error) {
        console.error('❌ Error load orders:', error);
        ordersError = error;
        if (manual || !cachedOrders.length) {
            toast('Gagal memuat pesanan: ' + (error?.message || error), 'error');
        }
    } finally {
        ordersLoading = false;
        btn?.classList.remove('is-loading');
        renderOrderSummary();
        renderKasirOrders();
        pollNewOrders();
        if (ordersReloadQueued) {
            ordersReloadQueued = false;
            window.loadOrders();
        }
    }
};

/* =========================================================
   BADGE PESANAN BARU (cek ringan di background)
========================================================= */

async function pollNewOrders() {
    try {
        await authReady;
        if (!supabase) return;
        const { count, error } = await supabase
            .from('orders')
            .select('id', { count: 'exact', head: true })
            .ilike('status', 'new');
        if (error) throw error;

        const n = Number(count) || 0;
        const badge = $('badgeNewOrders');
        if (badge) {
            badge.hidden = n === 0;
            badge.textContent = n > 99 ? '99+' : String(n);
        }

        const onOrdersTab = $('tab-pesanan')?.classList.contains('active');
        if (lastSeenNewCount !== null && n > lastSeenNewCount && !onOrdersTab) {
            toast(`${n - lastSeenNewCount} pesanan baru masuk. Cek tab Pesanan.`, 'info', 7000);
        }
        lastSeenNewCount = n;
    } catch (err) {
        console.warn('Cek pesanan baru gagal:', err?.message || err);
    }
}

/* =========================================================
   ORDER STATUS DEFINITIONS
========================================================= */

const STATUS_LIST = [
    { value: 'new', label: 'New', color: '#d97706' },
    { value: 'disiapkan', label: 'Diproses', color: '#2563eb' },
    { value: 'dikirim', label: 'Dikirim', color: '#7c3aed' },
    { value: 'selesai', label: 'Selesai', color: '#059669' },
    { value: 'cancel', label: 'Batal', color: '#dc2626' }
];

function statusLabel(value) {
    const v = String(value ?? '').toLowerCase();
    return STATUS_LIST.find(s => s.value === v)?.label || value;
}

function statusColorOf(value) {
    const v = String(value ?? '').toLowerCase();
    return STATUS_LIST.find(s => s.value === v)?.color || '#64748b';
}

/* =========================================================
   RENDER ORDER SUMMARY CARDS
========================================================= */

function renderOrderSummary() {
    const container = $('orderSummary');
    if (!container) return;

    const countOf = v => cachedOrders.filter(o => String(o.status ?? '').toLowerCase() === v).length;
    const revenue = cachedOrders
        .filter(o => String(o.status ?? '').toLowerCase() === 'selesai')
        .reduce((sum, o) => sum + Number(o.grand_total ?? 0), 0);

    const card = (label, value, color, filter, extra = '') => `
        <button type="button" class="summary-card ${extra}" style="--c:${color}"
            ${filter ? `data-status-filter="${filter}"` : 'tabindex="-1" disabled'}>
            <span class="summary-card__label">${label}</span>
            <span class="summary-card__value">${value}</span>
        </button>`;

    container.innerHTML =
        card('Semua', cachedOrders.length, '#334155', 'all')
        + STATUS_LIST.map(s => card(s.label, countOf(s.value), s.color, s.value)).join('')
        + card('Omzet (Selesai)', rupiah(revenue), '#ea580c', null, 'summary-card--revenue');

    updateOrderSummaryActiveState();
}

function updateOrderSummaryActiveState() {
    document.querySelectorAll('#orderSummary .summary-card[data-status-filter]').forEach(card => {
        card.classList.toggle('is-active',
            String(card.dataset.statusFilter).toLowerCase() === String(currentFilterStatus).toLowerCase());
    });
}

window.filterKasirOrders = function (status) {
    currentFilterStatus = String(status || 'all').toLowerCase();
    renderKasirOrders();
    updateOrderSummaryActiveState();
};

/* =========================================================
   RENDER ORDERS TABLE
========================================================= */

function renderKasirOrders() {
    const tbody = $('orderTableBody');
    if (!tbody) return;

    const q = ($('searchOrders')?.value || '').trim().toLowerCase();
    let orders = cachedOrders;

    if (currentFilterStatus !== 'all') {
        orders = orders.filter(o => String(o.status ?? '').trim().toLowerCase() === currentFilterStatus);
    }
    if (q) {
        orders = orders.filter(o => {
            const fields = [o.customer_name, o.nama, o.order_id, o.phone, o.wa, o.voucher_code, o.order_type];
            if (fields.some(v => String(v ?? '').toLowerCase().includes(q))) return true;
            return Array.isArray(o.items) && o.items.some(i => String(i.nama ?? i.name ?? '').toLowerCase().includes(q));
        });
    }

    const sub = $('ordersSubtitle');
    if (sub) {
        const periode = $('filterPeriode')?.value || 'today';
        sub.textContent = `${orders.length} pesanan · ${periodLabel(periode)}`
            + (currentFilterStatus !== 'all' ? ` · status ${statusLabel(currentFilterStatus)}` : '');
    }

    if (!orders.length) {
        const msg = ordersError && !cachedOrders.length
            ? `Gagal memuat pesanan: ${escapeHtml(ordersError?.message || ordersError)}`
            : (q || currentFilterStatus !== 'all' ? 'Tidak ada pesanan yang cocok dengan filter.' : 'Belum ada pesanan.');
        tbody.innerHTML = `<tr><td colspan="7" class="table-empty">${msg}</td></tr>`;
        return;
    }

    tbody.innerHTML = orders.map(order => {
        const id = String(order.id ?? order.order_id ?? '');
        const status = String(order.status ?? 'new').toLowerCase();
        const total = Number(order.grand_total ?? 0);
        const discount = Number(order.discount_amount ?? 0);
        const items = Array.isArray(order.items) ? order.items : [];
        const phone = order.phone ?? order.wa ?? '';
        const color = statusColorOf(status);

        const itemsHtml = items.length
            ? items.map(i => `<div><strong>${i.qty ?? 1}×</strong> ${escapeHtml(i.nama ?? i.name ?? '')}</div>`).join('')
            : '-';

        const known = STATUS_LIST.some(s => s.value === status);
        const options = (known ? '' : `<option value="${escapeHtml(status)}" selected>${escapeHtml(status)}</option>`)
            + STATUS_LIST.map(s => `<option value="${s.value}" ${status === s.value ? 'selected' : ''}>${s.label}</option>`).join('');

        return `
            <tr class="${status === 'new' ? 'is-new' : ''} ${status === 'cancel' ? 'is-cancel' : ''}">
                <td class="nowrap">${escapeHtml(formatWaktu(order.created_at))}</td>
                <td>
                    <strong>${escapeHtml(order.customer_name ?? order.nama ?? '-')}</strong>
                    <small class="block muted">${escapeHtml(order.order_id ?? '')}</small>
                    ${phone ? `<small class="block"><i class="fa-brands fa-whatsapp"></i> ${escapeHtml(phone)}</small>` : ''}
                </td>
                <td>
                    <span class="tag">${escapeHtml(order.order_type ?? 'Offline')}</span>
                    <small class="block muted">${escapeHtml(order.payment_method ?? '-')}</small>
                    ${order.voucher_code ? `<small class="block voucher-tag"><i class="fa-solid fa-ticket"></i> ${escapeHtml(order.voucher_code)}</small>` : ''}
                </td>
                <td class="items-cell">${itemsHtml}</td>
                <td class="nowrap">
                    <strong>${rupiah(total)}</strong>
                    ${discount > 0 ? `<small class="block text-success">hemat ${rupiah(discount)}</small>` : ''}
                </td>
                <td>
                    <select class="status-select" data-action="status" data-id="${escapeHtml(id)}"
                            data-prev="${escapeHtml(status)}" style="--c:${color}" aria-label="Ubah status">
                        ${options}
                    </select>
                </td>
                <td class="nowrap">
                    <div class="row-actions">
                        <button type="button" class="icon-btn" data-action="reprint" data-id="${escapeHtml(id)}" title="Cetak ulang struk">
                            <i class="fa-solid fa-print"></i>
                        </button>
                        <span title="Hubungi Admin untuk menghapus pesanan">
                            <button type="button" class="icon-btn" disabled aria-label="Hapus (hubungi admin)">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                        </span>
                    </div>
                </td>
            </tr>`;
    }).join('');
}

/* =========================================================
   REPRINT ORDER
========================================================= */

window.reprintOrder = (key) => {
    const order = cachedOrders.find(o => String(o.id) === String(key) || String(o.order_id) === String(key));
    if (!order) {
        toast('Pesanan tidak ditemukan.', 'error');
        return;
    }

    let uangBayar = Number(order.grand_total) || 0;
    let kembalian = 0;

    if (order.payment_method === 'Cash' && order.address) {
        const uangMatch = order.address.match(/Uang diterima:\s*Rp\s*([\d.]+)/);
        const kembalianMatch = order.address.match(/Kembalian:\s*Rp\s*([\d.]+)/);
        if (uangMatch) uangBayar = Number(uangMatch[1].replace(/\./g, '')) || order.grand_total;
        if (kembalianMatch) kembalian = Number(kembalianMatch[1].replace(/\./g, '')) || 0;
    }

    const ok = cetakStrukKasir({
        ...order,
        _uangBayar: uangBayar,
        _kembalian: kembalian,
        isReprint: true,
        reprintTime: new Date().toLocaleString('id-ID', {
            day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
        })
    });
    if (!ok) toast(POPUP_BLOCKED_MSG, 'error', 6000);
};

/* =========================================================
   UPDATE ORDER STATUS (UPDATE)
========================================================= */

window.updateOrderStatus = async function (id, newStatus, selectEl) {
    if (newStatus === 'cancel') {
        const ok = await confirmDialog({
            title: 'Batalkan pesanan?',
            message: 'Status akan menjadi Batal dan stok produk dikembalikan.',
            okText: 'Ya, batalkan',
            cancelText: 'Tidak',
            danger: true
        });
        if (!ok) {
            if (selectEl) selectEl.value = selectEl.dataset.prev || selectEl.value;
            return;
        }
    }

    if (selectEl) selectEl.disabled = true;

    try {
        await authReady;
        if (!supabase) throw new Error('Supabase tidak tersedia.');

        const { error } = await supabase.rpc('update_order_status', {
            p_key: String(id),
            p_status: newStatus
        });
        if (error) throw error;

        toast(`Status diubah ke ${statusLabel(newStatus)}.`, 'success', 2000);
        if (selectEl) selectEl.blur();
        await window.loadOrders();
        if (newStatus === 'cancel') window.loadProducts(); // refresh angka stok di menu

    } catch (error) {
        console.error('❌ Error update status order:', error);
        toast('Gagal mengubah status: ' + (error?.message || error), 'error', 6000);
        renderKasirOrders(); // kembalikan dropdown
    }
};

/* =========================================================
   DELETE ORDER (tombol dinonaktifkan di UI — via admin)
========================================================= */

window.deleteKasirOrder = async function (id) {
    const ok = await confirmDialog({ title: 'Hapus pesanan?', message: 'Tindakan ini tidak bisa dibatalkan.', okText: 'Hapus', danger: true });
    if (!ok) return;

    try {
        await authReady;
        if (!supabase) throw new Error('Supabase tidak tersedia.');
        const { error } = await supabase.from('orders').delete().eq('id', id);
        if (error) throw error;
        toast('Pesanan dihapus.', 'success');
        window.loadOrders();
    } catch (error) {
        console.error('❌ Error delete order:', error);
        toast('Gagal menghapus pesanan: ' + (error?.message || error), 'error');
    }
};

/* =========================================================
   DRAWER KERANJANG (layar < 860px)
========================================================= */

window.toggleCartDrawer = function (open) {
    const cart = $('posCart');
    if (!cart) return;
    const want = open ?? !cart.classList.contains('is-open');
    cart.classList.toggle('is-open', want);
    $('drawerBackdrop')?.classList.toggle('is-open', want);
    document.body.classList.toggle('drawer-open', want);
};

/* =========================================================
   EVENT LISTENERS
========================================================= */

function focusMenuSearch() {
    if (!$('tab-kasir').classList.contains('active')) {
        window.switchTab('tab-kasir');
    }
    const s = $('searchMenuKasir');
    s?.focus();
    s?.select();
}

function setupKasirEvents() {
    // --- Menu: cari, kategori, klik kartu ---
    const search = $('searchMenuKasir');
    search?.addEventListener('input', applyMenuFilter);
    search?.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const first = visibleProducts.find(p => P.stock(p) > 0);
            if (first && window.addToKasirCart(P.id(first))) search.select();
        }
    });

    $('searchClear')?.addEventListener('click', () => {
        search.value = '';
        applyMenuFilter();
        search.focus();
    });

    $('categoryBar')?.addEventListener('click', e => {
        const chip = e.target.closest('.cat-chip');
        if (chip) setCategory(chip.dataset.cat);
    });

    $('kasirMenuList')?.addEventListener('click', e => {
        const action = e.target.closest('[data-action]')?.dataset.action;
        if (action === 'reset-filter') {
            search.value = '';
            setCategory('all');
            return;
        }
        if (action === 'reload-products') {
            window.loadProducts();
            return;
        }
        const card = e.target.closest('.menu-card');
        if (card && !card.disabled) window.addToKasirCart(card.dataset.id);
    });

    // --- Keranjang: stepper & input qty ---
    const cartItems = $('kasirCartItems');
    cartItems?.addEventListener('click', e => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const id = btn.closest('.cart-item')?.dataset.id;
        if (btn.dataset.action === 'inc') window.changeKasirQty(id, 1);
        if (btn.dataset.action === 'dec') window.changeKasirQty(id, -1);
    });
    cartItems?.addEventListener('change', e => {
        if (e.target.matches('.qty-input')) {
            setCartQty(e.target.closest('.cart-item')?.dataset.id, parseMoney(e.target.value));
        }
    });
    cartItems?.addEventListener('focusin', e => {
        if (e.target.matches('.qty-input')) e.target.select();
    });
    cartItems?.addEventListener('keydown', e => {
        if (e.target.matches('.qty-input') && e.key === 'Enter') e.target.blur();
    });

    // --- Form pelanggan ---
    $('kasirNomorMeja')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); window.openPaymentModal(); }
    });

    // --- Voucher ---
    const voucherInput = $('kasirVoucherCode');
    voucherInput?.addEventListener('input', () => {
        const pos = voucherInput.selectionStart;
        voucherInput.value = voucherInput.value.toUpperCase().replace(/\s/g, '');
        voucherInput.setSelectionRange(pos, pos);
        if ($('kasirVoucherMsg')?.classList.contains('is-error')) showVoucherMsg('');
    });
    voucherInput?.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); window.applyVoucher(); }
    });
    $('voucherApplied')?.addEventListener('click', e => {
        if (e.target.closest('[data-action="remove-voucher"]')) {
            const code = appliedVoucher?.code;
            window.removeVoucher();
            if (code) toast(`Voucher ${code} dilepas.`, 'info', 2000);
        }
    });

    // --- Pembayaran ---
    const cashInput = $('kasirUangBayar');
    cashInput?.addEventListener('input', () => {
        const n = Math.min(parseMoney(cashInput.value), 999999999);
        cashInput.value = n ? formatNumber(n) : '';
        window.hitungKembalian();
    });
    cashInput?.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (!$('btnSubmitOrder').disabled) window.submitKasirOrder();
        }
    });
    $('cashQuick')?.addEventListener('click', e => {
        const chip = e.target.closest('.chip[data-amount]');
        if (chip) window.setUangBayar(Number(chip.dataset.amount));
    });

    // Klik di luar kartu modal = tutup
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', e => {
            if (e.target !== modal) return;
            if (modalStack[modalStack.length - 1] === modal) dismissTopModal();
        });
    });

    // --- Tab pesanan ---
    $('orderSummary')?.addEventListener('click', e => {
        const card = e.target.closest('.summary-card[data-status-filter]');
        if (card) window.filterKasirOrders(card.dataset.statusFilter);
    });
    const tbody = $('orderTableBody');
    tbody?.addEventListener('change', e => {
        const sel = e.target.closest('select[data-action="status"]');
        if (sel) window.updateOrderStatus(sel.dataset.id, sel.value, sel);
    });
    tbody?.addEventListener('click', e => {
        const btn = e.target.closest('button[data-action="reprint"]');
        if (btn) window.reprintOrder(btn.dataset.id);
    });
    $('searchOrders')?.addEventListener('input', renderKasirOrders);
    $('filterPeriode')?.addEventListener('change', () => window.loadOrders());

    // --- Shortcut keyboard (laptop) ---
    document.addEventListener('keydown', e => {
        const tag = (e.target.tagName || '').toLowerCase();
        const typing = ['input', 'textarea', 'select'].includes(tag) || e.target.isContentEditable;

        if (e.key === 'Escape') {
            if (dismissTopModal()) { e.preventDefault(); return; }
            if ($('posCart')?.classList.contains('is-open')) { window.toggleCartDrawer(false); return; }
            if (e.target.id === 'searchMenuKasir' && e.target.value) {
                e.target.value = '';
                applyMenuFilter();
            }
            return;
        }

        if (modalStack.length) {
            const top = modalStack[modalStack.length - 1];
            if (e.key === 'F9' && top.id === 'paymentModal') {
                e.preventDefault();
                if (!$('btnSubmitOrder').disabled) window.submitKasirOrder();
            }
            return;
        }

        if ((e.key === '/' && !typing) || e.key === 'F2') {
            e.preventDefault();
            focusMenuSearch();
            return;
        }

        if (e.key === 'F9') {
            e.preventDefault();
            if ($('tab-kasir').classList.contains('active')) window.openPaymentModal();
        }
    });

    // Peringatan bila menutup halaman saat keranjang masih berisi
    window.addEventListener('beforeunload', e => {
        if (Object.keys(kasirCart).length && !isSubmittingKasir && !allowUnload) {
            e.preventDefault();
            e.returnValue = '';
        }
    });

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) pollNewOrders();
    });
}

/* =========================================================
   START KASIR
========================================================= */

async function startKasir() {
    try {
        setupKasirEvents();
        renderKasirCart();
        window.toggleCashSection();
        await window.loadProducts();
        await window.loadOrders();
        setInterval(() => { if (!document.hidden) pollNewOrders(); }, NEW_ORDER_POLL_MS);
        if (isFinePointer) $('searchMenuKasir')?.focus();
    } catch (error) {
        console.error('❌ Gagal initialize kasir:', error);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startKasir, { once: true });
} else {
    startKasir();
}
