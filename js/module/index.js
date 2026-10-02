import { supabase, authReady } from '../supabase.js';

const sampleProducts = [
    { id: 1, name: 'Dimsum Mentai Mix (4 Pcs)', category: 'dimsum', price: 22000, desc: 'Dimsum lembut dengan saus mentai gurih dibakar sempurna.', image: 'https://images.unsplash.com/photo-1541696432-82c6da8ce7bf?w=500&auto=format&fit=crop&q=60', stock: 15 },
    { id: 2, name: 'Dimsum Udang Keju (4 Pcs)', category: 'dimsum', price: 24000, desc: 'Dimsum udang segar dengan lelehan keju mozzarella di dalam.', image: 'https://images.unsplash.com/photo-1496116218417-1a781b1c416c?w=500&auto=format&fit=crop&q=60', stock: 0 },
    { id: 3, name: 'Ayam Krispy Dada Spesial', category: 'chicken', price: 25000, desc: 'Dada ayam pilihan dilapisi tepung bumbu renyah gurih.', image: 'https://images.unsplash.com/photo-1626645738196-c2a7c87a8f58?w=500&auto=format&fit=crop&q=60', stock: 8 },
    { id: 4, name: 'Ayam Krispy Paha Spicy', category: 'chicken', price: 23000, desc: 'Paha bawah juicy berbalut bumbu spicy pedas menggigit.', image: 'https://images.unsplash.com/photo-1562967914-608f82629710?w=500&auto=format&fit=crop&q=60', stock: 12 },
    { id: 5, name: 'Es Teh Manis Segar', category: 'drink', price: 5000, desc: 'Teh melati pilihan disajikan dingin menyegarkan.', image: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=500&auto=format&fit=crop&q=60', stock: 50 },
    { id: 6, name: 'Lemon Tea Dingin', category: 'drink', price: 8000, desc: 'Perpaduan teh segar dan perasan buah lemon asli.', image: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=500&auto=format&fit=crop&q=60', stock: 0 }
];

window.products = [];
let cart = [];
let currentFilter = 'all';
let pendingOrderData = null;
const WA_TARGET_NUMBER = '6285723785380';
let appliedVoucher = null;

function rp(n) {
    return `Rp ${Number(n || 0).toLocaleString('id-ID')}`;
}

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
    const el = document.getElementById('voucher-msg');
    if (!el) return;
    el.textContent = text;
    el.className = `text-[10px] mt-1 ${isError ? 'text-red-500' : 'text-emerald-600'}`;
}

function renderCartTotals(subtotal) {
    const discount = computeVoucherDiscount(appliedVoucher, subtotal);
    const total = Math.max(0, subtotal - discount);

    document.getElementById('cart-subtotal').innerText = rp(subtotal);
    document.getElementById('cart-total').innerText = rp(total);

    const row = document.getElementById('cart-discount-row');
    if (row) {
        row.classList.toggle('hidden', discount <= 0);
        row.classList.toggle('flex', discount > 0);
        document.getElementById('cart-discount-label').innerText =
            appliedVoucher ? `Diskon (${appliedVoucher.code})` : 'Diskon';
        document.getElementById('cart-discount').innerText = `- ${rp(discount)}`;
    }

    // Pesan status voucher mengikuti isi keranjang (minimal belanja bisa berubah)
    if (appliedVoucher) {
        if (discount > 0) {
            setVoucherMsg(`Voucher ${appliedVoucher.code} dipakai, hemat ${rp(discount)}`);
        } else {
            setVoucherMsg(`Belum memenuhi minimal belanja ${rp(appliedVoucher.min_purchase)}`, true);
        }
    }
}

window.addEventListener('DOMContentLoaded', async () => {
    await loadProductsFromSupabase();
});

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
        } else {
            window.products = sampleProducts;
        }
    } catch (e) {
        console.warn('Fallback to sample products:', e);
        window.products = sampleProducts;
    }
    if (typeof buildDynamicCategories === 'function') {
        buildDynamicCategories();
    }
    renderProducts(window.products);
}

function renderProducts(items) {
    const container = document.getElementById('product-grid-container');
    if (!container) return;

    if (currentFilter === 'all') {
        const grouped = {};
        items.forEach(item => {
            const cat = item.category || 'umum';
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(item);
        });

        let groupedHTML = '';
        Object.keys(grouped).forEach(cat => {
            const displayName = cat.charAt(0).toUpperCase() + cat.slice(1);
            const catItems = grouped[cat];

            groupedHTML += `
                <div class="mb-10 last:mb-0">
                    <div class="flex items-center space-x-3 mb-5">
                        <h4 class="text-xl font-extrabold text-slate-900 tracking-tight">${displayName}</h4>
                        <div class="flex-grow h-px bg-slate-200"></div>
                        <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider">${catItems.length} Pilihan</span>
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            `;

            catItems.forEach(item => {
                const isOutOfStock = (item.stock !== undefined && item.stock <= 0);
                groupedHTML += `
                    <div class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden flex flex-col justify-between hover:shadow-md transition ${isOutOfStock ? 'opacity-75 bg-slate-50' : ''}">
                        <div>
                            <div class="h-48 overflow-hidden relative">
                                <img src="${item.image}" alt="${item.name}" class="w-full h-full object-cover hover:scale-105 transition duration-300 ${isOutOfStock ? 'grayscale' : ''}" onerror="this.src='https://placehold.co/500x300/ff6b35/ffffff?text=ChimChum'">
                                <span class="absolute top-3 left-3 bg-white/90 backdrop-blur text-slate-800 text-xs font-semibold px-2.5 py-1 rounded-lg uppercase">${item.category}</span>
                                ${isOutOfStock 
                                    ? '<span class="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] flex items-center justify-center font-bold text-white text-sm">Stok Habis</span>'
                                    : `<span class="absolute bottom-3 right-3 bg-slate-900/80 text-white text-[10px] font-bold px-2 py-0.5 rounded-md">Stok: ${item.stock}</span>`
                                }
                            </div>
                            <div class="p-5">
                                <h4 class="font-bold text-slate-900 mb-1">${item.name}</h4>
                                <p class="text-xs text-slate-500 line-clamp-2 mb-4">${item.desc}</p>
                            </div>
                        </div>
                        <div class="p-5 pt-0 flex items-center justify-between">
                            <span class="font-bold text-brand-600">Rp ${item.price.toLocaleString('id-ID')}</span>
                            <button onclick="addToCart('${item.id}')" ${isOutOfStock ? 'disabled' : ''} class="${isOutOfStock ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-brand-50 hover:bg-brand-500 text-brand-600 hover:text-white'} px-3.5 py-2 rounded-xl font-semibold text-xs transition flex items-center space-x-1.5">
                                <i class="fa-solid fa-plus"></i>
                                <span>${isOutOfStock ? 'Stok Habis' : 'Tambah'}</span>
                            </button>
                        </div>
                    </div>
                `;
            });

            groupedHTML += `
                    </div>
                </div>
            `;
        });

        container.innerHTML = groupedHTML;
    } else {
        let gridHTML = `<div id="product-grid" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">`;
        items.forEach(item => {
            const isOutOfStock = (item.stock !== undefined && item.stock <= 0);
            gridHTML += `
                <div class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden flex flex-col justify-between hover:shadow-md transition ${isOutOfStock ? 'opacity-75 bg-slate-50' : ''}">
                    <div>
                        <div class="h-48 overflow-hidden relative">
                            <img src="${item.image}" alt="${item.name}" class="w-full h-full object-cover hover:scale-105 transition duration-300 ${isOutOfStock ? 'grayscale' : ''}" onerror="this.src='https://placehold.co/500x300/ff6b35/ffffff?text=ChimChum'">
                            <span class="absolute top-3 left-3 bg-white/90 backdrop-blur text-slate-800 text-xs font-semibold px-2.5 py-1 rounded-lg uppercase">${item.category}</span>
                            ${isOutOfStock 
                                ? '<span class="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] flex items-center justify-center font-bold text-white text-sm">Stok Habis</span>'
                                : `<span class="absolute bottom-3 right-3 bg-slate-900/80 text-white text-[10px] font-bold px-2 py-0.5 rounded-md">Stok: ${item.stock}</span>`
                            }
                        </div>
                        <div class="p-5">
                            <h4 class="font-bold text-slate-900 mb-1">${item.name}</h4>
                            <p class="text-xs text-slate-500 line-clamp-2 mb-4">${item.desc}</p>
                        </div>
                    </div>
                    <div class="p-5 pt-0 flex items-center justify-between">
                        <span class="font-bold text-brand-600">Rp ${item.price.toLocaleString('id-ID')}</span>
                        <button onclick="addToCart('${item.id}')" ${isOutOfStock ? 'disabled' : ''} class="${isOutOfStock ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-brand-50 hover:bg-brand-500 text-brand-600 hover:text-white'} px-3.5 py-2 rounded-xl font-semibold text-xs transition flex items-center space-x-1.5">
                            <i class="fa-solid fa-plus"></i>
                            <span>${isOutOfStock ? 'Stok Habis' : 'Tambah'}</span>
                        </button>
                    </div>
                </div>
            `;
        });
        gridHTML += `</div>`;
        container.innerHTML = gridHTML;
    }
}

window.filterCategory = function(category) {
    currentFilter = category;
    document.querySelectorAll('.category-btn').forEach(btn => {
        btn.className = 'category-btn bg-white hover:bg-slate-100 text-slate-600 px-4 py-2 rounded-xl text-sm font-medium border border-slate-200 transition whitespace-nowrap';
    });
    const activeBtn = document.getElementById(`cat-${category}`);
    if (activeBtn) {
        activeBtn.className = 'category-btn bg-slate-900 text-white px-4 py-2 rounded-xl text-sm font-medium transition whitespace-nowrap';
    }
    if (category === 'all') {
        renderProducts(window.products);
    } else {
        renderProducts(window.products.filter(p => p.category === category));
    }
};

window.addToCart = function(productId) {
    const product = window.products.find(p => String(p.id) === String(productId));
    if (!product) return;

    if (product.stock !== undefined && product.stock <= 0) {
        showNotification('Stok Habis', `Mohon maaf, produk ${product.name} sedang kosong dan tidak dapat dipesan.`, 'warning');
        return;
    }

    const existing = cart.find(item => String(item.id) === String(productId));
    const currentQtyInCart = existing ? existing.qty : 0;

    if (product.stock !== undefined && currentQtyInCart + 1 > product.stock) {
        showNotification('Stok Terbatas', `Jumlah melebihi stok yang tersedia (${product.stock} pcs).`, 'warning');
        return;
    }

    if (existing) {
        existing.qty += 1;
    } else {
        cart.push({ ...product, qty: 1 });
    }
    updateCartUI();
};

window.updateCartQty = function(productId, change) {
    const product = window.products.find(p => String(p.id) === String(productId));
    const item = cart.find(i => String(i.id) === String(productId));

    if (item) {
        const newQty = item.qty + change;
        if (newQty > 0) {
            if (product && product.stock !== undefined && newQty > product.stock) {
                showNotification('Stok Terbatas', `Maksimal stok tersedia adalah ${product.stock} pcs.`, 'warning');
                return;
            }
            item.qty = newQty;
        } else {
            cart = cart.filter(i => String(i.id) !== String(productId));
        }
    }
    updateCartUI();
};

function updateCartUI() {
    const container = document.getElementById('cart-items-container');
    const badge = document.getElementById('cart-badge');

    if (!container || !badge) return;

    const totalQty = cart.reduce((sum, i) => sum + i.qty, 0);
    badge.innerText = totalQty;

    if (cart.length === 0) {
        container.innerHTML = `
            <div class="text-center py-8 text-slate-400">
                <i class="fa-solid fa-basket-shopping text-2xl mb-1.5"></i>
                <p class="text-[11px]">Keranjang Anda masih kosong</p>
            </div>
        `;
        renderCartTotals(0);
        return;
    }

    container.innerHTML = '';
    let subtotal = 0;
    cart.forEach(item => {
        subtotal += item.price * item.qty;
        container.innerHTML += `
            <div class="flex items-center justify-between border-b border-slate-100 pb-2">
                <div class="flex-grow pr-2">
                    <h5 class="font-semibold text-[11px] text-slate-900 leading-snug">${item.name}</h5>
                    <p class="text-[10px] text-brand-600 font-medium">Rp ${item.price.toLocaleString('id-ID')}</p>
                </div>
                <div class="flex items-center space-x-1 flex-shrink-0">
                    <button onclick="updateCartQty('${item.id}', -1)" class="w-5 h-5 rounded bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 text-[9px]"><i class="fa-solid fa-minus"></i></button>
                    <span class="text-[11px] font-semibold w-4 text-center">${item.qty}</span>
                    <button onclick="updateCartQty('${item.id}', 1)" class="w-5 h-5 rounded bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 text-[9px]"><i class="fa-solid fa-plus"></i></button>
                </div>
            </div>
        `;
    });

    renderCartTotals(subtotal);
}


function setVoucherMsg(text, isError = false) {
    const el = document.getElementById('voucher-msg');
    if (!el) return;

    if (!text) {
        el.textContent = '';
        el.className = 'hidden mt-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium';
        return;
    }

    el.textContent = (isError ? '❌ ' : '✅ ') + text;
    el.className = `mt-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border ${
        isError
            ? 'bg-red-50 text-red-600 border-red-200'
            : 'bg-emerald-50 text-emerald-700 border-emerald-200'
    }`;
}

const VOUCHER_REASON = {
    not_found:   'Kode voucher tidak ditemukan.',
    not_started: 'Voucher belum berlaku.',
    expired:     'Voucher sudah kedaluwarsa.',
    quota_full:  'Kuota voucher sudah habis.'
};
async function applyVoucher() {
    const input = document.getElementById('voucher-code');
    const btn = document.getElementById('voucher-apply-btn');
    const code = (input?.value || '').trim().toUpperCase();
    const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);

    const fail = (msg) => {
        setVoucherMsg(msg, true);
        input?.classList.add('shake', 'border-red-400');
        setTimeout(() => input?.classList.remove('shake'), 400);
    };

    input?.classList.remove('border-red-400');

    if (!code) return fail('Masukkan kode voucher terlebih dahulu.');
    if (cart.length === 0) return fail('Pilih menu dulu sebelum memakai voucher.');

    if (btn) { btn.disabled = true; btn.textContent = '...'; }

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
        input.classList.remove('border-red-400');
        document.getElementById('voucher-remove-btn')?.classList.remove('hidden');
        btn?.classList.add('hidden');
        updateCartUI();   // pesan sukses ditampilkan oleh renderCartTotals
    } catch (err) {
        console.error('[VOUCHER] Error:', err);
        fail('Gagal memeriksa voucher. Periksa koneksi lalu coba lagi.');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Pakai'; }
    }
}

function removeVoucher() {
    appliedVoucher = null;
    const input = document.getElementById('voucher-code');
    if (input) { input.value = ''; input.disabled = false; input.classList.remove('border-red-400'); }
    document.getElementById('voucher-remove-btn')?.classList.add('hidden');
    document.getElementById('voucher-apply-btn')?.classList.remove('hidden');
    setVoucherMsg('');
    updateCartUI();
}

// tetap diekspor ke window, karena confirmAndSubmitOrder memanggil window.removeVoucher()
window.applyVoucher = applyVoucher;
window.removeVoucher = removeVoucher;

// pasang event langsung, tidak bergantung pada onclick di HTML
document.getElementById('voucher-apply-btn')?.addEventListener('click', applyVoucher);
document.getElementById('voucher-remove-btn')?.addEventListener('click', removeVoucher);
document.getElementById('voucher-code')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); applyVoucher(); }
});

window.proceedToPayment = function() {
    if (cart.length === 0) {
        showNotification('Perhatian', 'Keranjang belanja masih kosong.', 'warning');
        return;
    }
    const name = document.getElementById('customer-name').value.trim();
    const phone = document.getElementById('customer-phone').value.trim();
    const address = document.getElementById('customer-address').value.trim();
    const paymentMethod = document.querySelector('input[name="payment_method"]:checked')?.value || 'QRIS';

    if (!name || !phone || !address) {
        showNotification('Perhatian', 'Harap lengkapi nama, nomor telepon, dan alamat.', 'warning');
        return;
    }

    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    
    const randomNum = Math.floor(100 + Math.random() * 9000);
    const orderId = `ORD-${yy}${mm}${dd}${hh}${min}-${randomNum}`;
    const subtotal = cart.reduce((sum, i) => sum + (i.price * i.qty), 0);
    const discount = computeVoucherDiscount(appliedVoucher, subtotal);
    const grandTotal = Math.max(0, subtotal - discount);

    const jakartaOffset = 7 * 60;
    const localTime = new Date(now.getTime() + (now.getTimezoneOffset() + jakartaOffset) * 60000);
    const jakartaISOString = localTime.toISOString().replace('Z', '+07:00');

    pendingOrderData = {
        order_id: orderId,
        customer_name: name,
        phone: phone,
        address: address,
        items: cart,
        subtotal: subtotal,
        voucher_code: discount > 0 ? appliedVoucher.code : null,
        discount_amount: discount,
        grand_total: grandTotal,
        payment_method: paymentMethod,
        order_type: 'Website',
        status: 'new',
        created_at: jakartaISOString
    };

    const instructionBox = document.getElementById('payment-instruction-box');
    const proofContainer = document.getElementById('payment-proof-container');

    if (paymentMethod === 'QRIS') {
        if (proofContainer) proofContainer.style.display = 'block';
        instructionBox.innerHTML = `
            <p class="font-bold text-slate-900 mb-1">Scan QRIS untuk Pembayaran:</p>
            <p class="text-slate-600 mb-2">Total: <span class="font-bold text-brand-600">Rp ${grandTotal.toLocaleString('id-ID')}</span></p>
            <div class="bg-white p-3 rounded-xl border border-slate-200 text-center">
                <img src="./assets/ChimChum-QRISSHOPEE.png" alt="QRIS Code" class="mx-auto w-64 h-64 object-contain" onerror="this.src='https://placehold.co/150?text=QRIS+ChimChum'">
            </div>
        `;
    } else if (paymentMethod === 'Transfer') {
        if (proofContainer) proofContainer.style.display = 'block';
        instructionBox.innerHTML = `
            <div class="flex items-center space-x-2.5 mb-2 pb-2 border-b border-slate-200">
                <div class="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-sm border border-blue-100 flex-shrink-0">
                    <i class="fa-solid fa-building-columns"></i>
                </div>
                <div>
                    <p class="font-bold text-slate-900 text-xs">Transfer Bank BCA Syariah</p>
                    <p class="text-[10px] text-slate-500">Silakan transfer sesuai nominal tagihan</p>
                </div>
            </div>
            <p class="text-slate-600">Nama Bank : <span class="font-bold text-slate-900">BCA Syariah</span></p>
            <p class="text-slate-600">No. Rekening : <span class="font-bold text-slate-900">8881798766</span></p>
            <p class="text-slate-600">Atas Nama : <span class="font-bold text-slate-900">Intan Dwi A I</span></p>
            <p class="text-slate-600 mt-1">Total Tagihan : <span class="font-bold text-brand-600">Rp ${grandTotal.toLocaleString('id-ID')}</span></p>
        `;
    } else {
        if (proofContainer) proofContainer.style.display = 'none';
        instructionBox.innerHTML = `
            <p class="font-bold text-slate-900 mb-1">Pembayaran Cash / COD:</p>
            <p class="text-slate-600">Silakan siapkan uang pas sebesar <span class="font-bold text-brand-600">Rp ${grandTotal.toLocaleString('id-ID')}</span> saat kurir tiba.</p>
        `;
    }

    if (typeof toggleCartModal === 'function') toggleCartModal();
    const paymentModal = document.getElementById('payment-modal');
    if (paymentModal) paymentModal.classList.remove('hidden');
};

window.closePaymentModal = function() {
    const paymentModal = document.getElementById('payment-modal');
    if (paymentModal) paymentModal.classList.add('hidden');
};


async function compressImage(file, maxWidth = 1600, quality = 0.75) {
    // Bukan gambar → jangan diproses
    if (!file.type.startsWith('image/')) {
        return file;
    }

    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            const img = new Image();

            img.onload = () => {
                let width = img.width;
                let height = img.height;

                // Batasi ukuran maksimal
                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');

                // Background putih untuk format seperti JPG
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, width, height);

                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob(
                    (blob) => {
                        if (!blob) {
                            reject(new Error('Gagal mengompres gambar.'));
                            return;
                        }

                        const compressedFile = new File(
                            [blob],
                            file.name.replace(/\.[^/.]+$/, '') + '.jpg',
                            {
                                type: 'image/jpeg',
                                lastModified: Date.now()
                            }
                        );

                        console.log(
                            `📦 Compress: ${(file.size / 1024).toFixed(0)} KB → ${(compressedFile.size / 1024).toFixed(0)} KB`
                        );

                        resolve(compressedFile);
                    },
                    'image/jpeg',
                    quality
                );
            };

            img.onerror = () => reject(new Error('Gagal membaca gambar.'));
            img.src = e.target.result;
        };

        reader.onerror = () => reject(new Error('Gagal membaca file.'));
        reader.readAsDataURL(file);
    });
}


async function reduceProductStock(items) {
    await authReady;

    for (const item of items) {
        const qty = Number(item.qty || 0);

        if (!item.id || qty <= 0) {
            continue;
        }

        console.log('[STOCK] Mengurangi stok:', {
            productId: item.id,
            name: item.name,
            qty: qty
        });

        const { data, error } = await supabase.rpc(
            'reduce_product_stock',
            {
                p_product_id: item.id,
                p_quantity: qty
            }
        );

        if (error) {
            console.error('[STOCK] RPC error:', {
                message: error.message,
                details: error.details,
                hint: error.hint,
                code: error.code
            });

            throw error;
        }

        // false = stok tidak cukup
        if (data !== true) {
            throw new Error(
                `Stok ${item.name} tidak mencukupi.`
            );
        }

        console.log(
            `[STOCK] ${item.name}: berhasil dikurangi ${qty} pcs`
        );
    }
}


window.confirmAndSubmitOrder = async function() {
    const submitBtn = document.getElementById('confirm-btn');
    const fileInput = document.getElementById('payment-proof-file');
    const paymentMethod = pendingOrderData.payment_method;

    if (paymentMethod !== 'Cash' && (!fileInput || !fileInput.files || fileInput.files.length === 0)) {
        showNotification('Bukti Diperlukan', 'Harap upload bukti pembayaran terlebih dahulu.', 'warning');
        return;
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.classList.add('opacity-50', 'cursor-not-allowed');
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner animate-spin"></i><span>Memproses Pesanan...</span>';
    }

    let proofReference = 'Pending / Cash';

    try {
        await authReady;
        if (fileInput && fileInput.files && fileInput.files.length > 0) {
            const originalFile = fileInput.files[0];

            // Compress gambar sebelum upload
            const file = await compressImage(
                originalFile,
                1600, // maksimal lebar 1600px
                0.75  // kualitas JPEG 75%
            );
            
            const fileExt = file.name.split('.').pop().toLowerCase();
            const fileName = `${pendingOrderData.order_id}_${Date.now()}.${fileExt}`;
            
            const reader = new FileReader();
            
            proofReference = await new Promise((resolve, reject) => {
                reader.onload = async (e) => {
                    const base64Data = e.target.result;
            
                    try {
                        const { data: uploadData, error: uploadError } =
                            await supabase.storage
                                .from('payment-proofs')
                                .upload(fileName, file, {
                                    cacheControl: '3600',
                                    upsert: true,
                                    contentType: file.type
                                });
            
                        if (!uploadError) {
                            const { data: publicUrlData } =
                                supabase.storage
                                    .from('payment-proofs')
                                    .getPublicUrl(fileName);
            
                            if (publicUrlData?.publicUrl) {
                                resolve(publicUrlData.publicUrl);
                                return;
                            }
                        }
            
                        console.error('Upload gagal:', uploadError);
                        resolve(base64Data);            
                    } catch (err) {
                        console.error('Storage error:', err);
                        resolve(base64Data);
                    }
                };            
                reader.onerror = (err) => reject(err);
                // Dipakai hanya sebagai fallback kalau upload gagal
                reader.readAsDataURL(file);
            });                           
        }
    } catch (storageErr) {
        console.warn("Storage warning, using base64 reference:", storageErr);
    }

    pendingOrderData.payment_proof = proofReference;

    // Cash/COD: belum dibayar. QRIS/Transfer: bukti sudah diupload, menunggu verifikasi admin.
    pendingOrderData.payment_status =
    paymentMethod === 'Cash' ? 'unpaid' : 'pending';

    try {
        await authReady;

        // Pakai voucher secara atomik (cek kuota & masa berlaku di server)
        if (pendingOrderData.voucher_code) {
            const { data: ok, error: vErr } = await supabase
                .rpc('redeem_voucher', { p_code: pendingOrderData.voucher_code });
            if (vErr) throw vErr;
            if (!ok) {
                throw new Error('Voucher sudah tidak berlaku (kuota habis / kedaluwarsa). Hapus voucher lalu coba lagi.');
            }
        }
    
        // Simpan order
        const { data: insertedOrder, error: orderError } =
            await supabase
                .from('orders')
                .insert([pendingOrderData])
                .select()
                .single();
    
        if (orderError) {
            throw orderError;
        }
    
        console.log(
            '[ORDER] Order berhasil dibuat:',
            insertedOrder
        );
    
        // Kurangi stok setelah order berhasil
        await reduceProductStock(pendingOrderData.items);
    
        console.log('[STOCK] Semua stok berhasil diperbarui.');
    
    } catch (dbErr) {
        console.error('[ORDER] Gagal submit order / update stok:', {
            message: dbErr.message,
            details: dbErr.details,
            hint: dbErr.hint,
            code: dbErr.code
        });
    
        showNotification(
            'Pesanan Gagal',
            dbErr.message || 'Terjadi kesalahan saat memproses pesanan.',
            'warning'
        );
    
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.classList.remove('opacity-50', 'cursor-not-allowed');
            submitBtn.innerHTML =
                '<i class="fa-solid fa-circle-check"></i>' +
                '<span>Konfirmasi & Kirim Pesanan</span>';
        }
    
        return;
    }

    let localOrders = JSON.parse(localStorage.getItem('local_orders') || '[]');
    const orderToSave = { ...pendingOrderData };
    if (orderToSave.payment_proof && orderToSave.payment_proof.startsWith('data:image')) {
        orderToSave.payment_proof = '[Base64 Image Attached - Local Copy Truncated]';
    }
    localOrders.push(orderToSave);

    try {
        localStorage.setItem('local_orders', JSON.stringify(localOrders));
    } catch (e) {
        if (e.name === 'QuotaExceededError') {
            const trimmedOrders = localOrders.slice(-10);
            try {
                localStorage.setItem('local_orders', JSON.stringify(trimmedOrders));
            } catch (innerErr) {
                console.error('Critical: Failed to save to localStorage.', innerErr);
            }
        }
    }

    const itemsListStr = pendingOrderData.items.map(i => `• ${i.name} (${i.qty}x) - Rp ${(i.price * i.qty).toLocaleString('id-ID')}`).join('\n');
    const trackingLink = `https://chimchummlg.vercel.app/lacak.html/${pendingOrderData.order_id}`;
    const waText = encodeURIComponent(
`*INVOICE PEMESANAN CHIMCHUM MALANG*
ID Pesanan: ${pendingOrderData.order_id}

*Detail Item:*
${itemsListStr}
────────────────
Subtotal: ${rp(pendingOrderData.subtotal)}${pendingOrderData.discount_amount > 0
    ? `\nDiskon (${pendingOrderData.voucher_code}): - ${rp(pendingOrderData.discount_amount)}`
    : ''}
*Total: Rp ${pendingOrderData.grand_total.toLocaleString('id-ID')}*

*Data Pemesan:*
Nama: ${pendingOrderData.customer_name}
No. WA: ${pendingOrderData.phone}
Alamat: ${pendingOrderData.address}
Pembayaran: ${pendingOrderData.payment_method}
Bukti Pembayaran: ${trackingLink}

Mohon segera diproses ya Kak, terima kasih! 🙏`
    );

    closePaymentModal();
    cart = [];
    window.removeVoucher();   // <- tambahkan ini
    updateCartUI();
    if (fileInput) fileInput.value = '';

    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        submitBtn.innerHTML = '<i class="fa-solid fa-circle-check"></i><span>Konfirmasi & Kirim Pesanan</span>';
    }

    showNotification('Pesanan Berhasil Dibuat!', `ID Pesanan: ${pendingOrderData.order_id}. Mengalihkan ke WhatsApp...`, 'success');
    
    setTimeout(() => {
        window.open(`https://wa.me/${WA_TARGET_NUMBER}?text=${waText}`, '_blank');
    }, 1200);
};



window.fetchOrderStatus = async function() {
    const inputEl = document.getElementById('tracker-order-id');
    const resultDiv = document.getElementById('tracker-result');
    if (!inputEl || !resultDiv) return;

    const orderId = inputEl.value.trim();
    if (!orderId) {
        showNotification('Perhatian', 'Masukkan ID pesanan terlebih dahulu.', 'warning');
        return;
    }

    let foundOrder = null;
    try {
        await authReady;
        const { data } = await supabase.from('orders').select('*').eq('order_id', orderId).maybeSingle();
        if (data) foundOrder = data;
    } catch (e) {
        console.error(e);
    }

    if (!foundOrder) {
        let localOrders = JSON.parse(localStorage.getItem('local_orders') || '[]');
        foundOrder = localOrders.find(o => o.order_id === orderId);
    }

    resultDiv.classList.remove('hidden');
    if (foundOrder) {
        let proofDisplay = '';
        if (foundOrder.payment_proof && foundOrder.payment_proof !== 'Pending / Cash') {
            if (foundOrder.payment_proof.startsWith('data:image')) {
                proofDisplay = `<div class="pt-2"><p class="text-xs text-slate-500 mb-1 font-semibold">Bukti Pembayaran:</p><img src="${foundOrder.payment_proof}" class="w-32 h-32 object-cover rounded-xl border border-slate-200"></div>`;
            } else {
                proofDisplay = `<div class="pt-2"><a href="${foundOrder.payment_proof}" target="_blank" class="text-xs text-brand-600 underline font-semibold">Lihat Bukti Pembayaran ↗</a></div>`;
            }
        }

        resultDiv.innerHTML = `
            <div class="bg-slate-50 p-4 rounded-2xl space-y-2 text-sm">
                <div class="flex justify-between"><span class="text-slate-500">ID Pesanan:</span><span class="font-bold">${foundOrder.order_id}</span></div>
                <div class="flex justify-between"><span class="text-slate-500">Nama Pemesan:</span><span class="font-semibold">${foundOrder.customer_name}</span></div>
                <div class="flex justify-between"><span class="text-slate-500">Total Harga:</span><span class="font-bold text-brand-600">Rp ${Number(foundOrder.discount_amount) > 0 ? `<div class="flex justify-between"><span class="text-slate-500">Diskon (${foundOrder.voucher_code || '-'}):</span><span class="font-semibold text-emerald-600">- Rp ${Number(foundOrder.discount_amount).toLocaleString('id-ID')}</span></div>` : ''}
                <div class="flex justify-between"><span class="text-slate-500">Status:</span><span class="bg-amber-100 text-amber-700 text-xs px-2.5 py-1 rounded-full font-bold uppercase">${foundOrder.status}</span></div>
                <div class="flex justify-between"><span class="text-slate-500">Pembayaran:</span><span class="font-semibold uppercase">${foundOrder.payment_status || '-'}</span></div>
                ${proofDisplay}
            </div>
        `;
    } else {
        resultDiv.innerHTML = `
            <div class="text-center py-4 text-slate-400 text-sm">
                Pesanan dengan ID tersebut tidak ditemukan.
            </div>
        `;
    }
};

window.toggleCartModal = function() {
    const modal = document.getElementById('cart-modal');
    if (modal) modal.classList.toggle('hidden');
};

window.openTrackerModal = function() {
    const modal = document.getElementById('tracker-modal');
    if (modal) modal.classList.toggle('hidden');
};

window.showNotification = function(title, message, type = 'success') {
    const modal = document.getElementById('notification-modal');
    if (!modal) {
        console.warn(`${title}: ${message}`);
        return;
    }
    document.getElementById('notification-title').innerText = title;
    document.getElementById('notification-message').innerText = message;
    const iconContainer = document.getElementById('notification-icon');
    if (type === 'success') {
        iconContainer.className = 'w-16 h-16 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center text-2xl mx-auto';
        iconContainer.innerHTML = '<i class="fa-solid fa-check"></i>';
    } else {
        iconContainer.className = 'w-16 h-16 bg-amber-50 text-amber-500 rounded-full flex items-center justify-center text-2xl mx-auto';
        iconContainer.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
    }
    modal.classList.remove('hidden');
};

window.closeNotification = async function() {
    const modal = document.getElementById('notification-modal');

    if (modal) {
        modal.classList.add('hidden');
    }

    await loadProductsFromSupabase();
};
