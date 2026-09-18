import { supabase, authReady } from '../supabase.js';

/* =========================================================
STATE
========================================================= */

let cachedProducts = [];
let cachedOrders = [];
let kasirCart = {};
let currentKasirGrandTotal = 0;
let currentFilterStatus = 'all';

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

function escapeHtml(value) {
return String(value ?? '')
.replace(/&/g, '&')
.replace(/</g, '<')
.replace(/>/g, '>')
.replace(/"/g, '"')
.replace(/'/g, ''');
}

/* =========================================================
INITIALIZE
========================================================= */

async function initKasirDashboard() {
console.log('🚀 Start dashboard kasir...');

await window.loadProducts();
await window.loadOrders();

console.log('✅ Dashboard kasir siap.');


}

/* =========================================================
LOAD PRODUCTS FROM SUPABASE
========================================================= */

window.loadProducts = async () => {
console.log('🟠 loadProducts() MULAI');

try {
    await authReady;

    console.log('🟢 authReady SELESAI');
    console.log('🟢 Supabase:', supabase);

    if (!supabase) {
        throw new Error('Supabase tidak tersedia.');
    }

    const { data, error } = await supabase
        .from('products')
        .select('*');

    console.log('📦 DATA PRODUCTS:', data);
    console.log('🔴 ERROR PRODUCTS:', error);
    console.log('📊 JUMLAH PRODUK:', (data || []).length);

    if (error) {
        throw error;
    }

    cachedProducts = data || [];

    console.log('✅ cachedProducts:', cachedProducts);

    /* -----------------------------------------
       KATEGORI
    ----------------------------------------- */

    const kategoriMap = new Map();

    cachedProducts.forEach(product => {
        const kategori = (
            product.category ??
            product.kategori ??
            ''
        ).toString().trim();

        if (!kategori) {
            return;
        }

        const key = kategori.toLowerCase();

        if (!kategoriMap.has(key)) {
            kategoriMap.set(key, kategori);
        }
    });

    updateKasirKategoriDropdown(
        new Set(kategoriMap.values())
    );

    /* -----------------------------------------
       RENDER MENU
    ----------------------------------------- */

    renderKasirMenu();

} catch (error) {
    console.error('❌ Error load produk:', error);

    cachedProducts = [];

    const list = document.getElementById('kasirMenuList');

    if (list) {
        list.innerHTML = `
            <p style="
                color:#dc2626;
                padding:20px;
                background:#fef2f2;
                border-radius:10px;
            ">
                <strong>Gagal mengambil produk dari database.</strong>
                <br>
                <small>
                    ${escapeHtml(error?.message || error)}
                </small>
            </p>
        `;
    }
}


};

/* =========================================================
UPDATE CATEGORY DROPDOWN
========================================================= */

function updateKasirKategoriDropdown(categories) {
const select = document.getElementById('filterKategoriKasir');

if (!select) {
    console.warn('⚠️ filterKategoriKasir tidak ditemukan.');
    return;
}

const currentValue = select.value;

select.innerHTML = `
    <option value="Semua">All Kategori</option>
`;

[...categories]
    .sort((a, b) =>
        String(a).localeCompare(String(b), 'id')
    )
    .forEach(category => {
        const option = document.createElement('option');

        option.value = category;
        option.textContent = category;

        select.appendChild(option);
    });

if (
    [...select.options].some(
        option => option.value === currentValue
    )
) {
    select.value = currentValue;
}


}

/* =========================================================
RENDER MENU
========================================================= */

function renderKasirMenu(products = cachedProducts) {
const list = document.getElementById('kasirMenuList');

if (!list) {
    console.error(
        '❌ Element #kasirMenuList tidak ditemukan.'
    );
    return;
}

console.log(
    '🎨 renderKasirMenu() jumlah:',
    products.length
);

if (!products || products.length === 0) {
    list.innerHTML = `
        <p style="
            color:#aaa;
            padding:20px;
            text-align:center;
            grid-column: 1 / -1;
        ">
            Produk belum tersedia.
        </p>
    `;

    return;
}

list.innerHTML = products.map(product => {

    const id = product.id;

    const nama = (
        product.name ??
        product.nama ??
        ''
    ).toString();

    const harga = Number(
        product.price ??
        product.harga ??
        0
    );

    const kategori = (
        product.category ??
        product.kategori ??
        'Umum'
    ).toString();

    const foto = (
        product.image ??
        product.foto ??
        ''
    ).toString();

    const stok = Number(
        product.stok ?? product.stock ?? 100
    );

    const habis = stok <= 0;

    const safeId = JSON.stringify(id);
    const safeNama = JSON.stringify(nama);

    return `
        <div
            class="kasir-item-card"
            data-kategori="${escapeHtml(kategori)}"
            data-nama="${escapeHtml(nama.toLowerCase())}"
            style="
                ${habis
                    ? 'opacity:.45;pointer-events:none;'
                    : ''
                }
            "
            onclick='addToKasirCart(
                ${safeId},
                ${safeNama},
                ${harga},
                ${stok}
            )'
        >

            <img
                src="${escapeHtml(foto)}"
                alt="${escapeHtml(nama)}"
                onerror="this.src='https://placehold.co/150'"
            >

            <h4>
                ${escapeHtml(nama)}
            </h4>

            <p style="
                margin-top:4px;
                font-size:13px;
            ">
                ${rupiah(harga)}
            </p>

            ${
                habis
                    ? `
                        <small style="
                            color:#dc2626;
                            font-weight:600;
                        ">
                            Stok habis
                        </small>
                      `
                    : `
                        <small style="
                            color:#777;
                        ">
                            Stok: ${stok}
                        </small>
                      `
            }

        </div>
    `;
}).join('');


}

/* =========================================================
FILTER MENU
========================================================= */

function jalankanFilterKasir() {
const searchInput =
document.getElementById('searchMenuKasir');

const categorySelect =
    document.getElementById('filterKategoriKasir');

const search = (
    searchInput?.value || ''
).trim().toLowerCase();

const category =
    categorySelect?.value || 'Semua';

const filtered = cachedProducts.filter(product => {

    const nama = (
        product.name ??
        product.nama ??
        ''
    ).toString().toLowerCase();

    const kategori = (
        product.category ??
        product.kategori ??
        'Umum'
    ).toString();

    const matchSearch =
        !search ||
        nama.includes(search);

    const matchCategory =
        category === 'Semua' ||
        kategori.toLowerCase() ===
            category.toLowerCase();

    return matchSearch && matchCategory;
});

renderKasirMenu(filtered);


}

/* =========================================================
CART
========================================================= */

window.addToKasirCart = function (
id,
nama,
harga,
stok
) {
const productId = String(id);

harga = Number(harga) || 0;
stok = Number(stok ?? 100);

if (stok <= 0) {
    alert('Stok produk habis.');
    return;
}

if (!kasirCart[productId]) {
    kasirCart[productId] = {
        id: productId,
        nama: nama,
        harga: harga,
        qty: 0,
        stok: stok
    };
}

if (
    kasirCart[productId].qty >=
    kasirCart[productId].stok
) {
    alert('Jumlah melebihi stok.');
    return;
}

kasirCart[productId].qty++;

renderKasirCart();


};

/* =========================================================
CHANGE CART QTY
========================================================= */

window.changeKasirQty = function (
id,
perubahan
) {
const productId = String(id);

if (!kasirCart[productId]) {
    return;
}

const item = kasirCart[productId];

item.qty += Number(perubahan);

if (item.qty <= 0) {
    delete kasirCart[productId];
}

if (item.qty > item.stok) {
    item.qty = item.stok;
    alert('Jumlah melebihi stok.');
}

renderKasirCart();


};

/* =========================================================
REMOVE CART ITEM
========================================================= */

window.removeFromKasirCart = function (id) {
const productId = String(id);

delete kasirCart[productId];

renderKasirCart();


};

/* =========================================================
CLEAR CART
========================================================= */

window.clearKasirCart = function () {
kasirCart = {};

renderKasirCart();


};

/* =========================================================
RENDER CART
========================================================= */

function renderKasirCart() {
// Matched ID with kasir.html (#kasirCartItems)
const cartContainer =
document.getElementById('kasirCartItems');

if (!cartContainer) {
    console.warn(
        '⚠️ #kasirCartItems tidak ditemukan.'
    );
    return;
}

const items = Object.values(kasirCart);

if (items.length === 0) {
    cartContainer.innerHTML = `
        <p style="text-align:center; color:#aaa; font-size:13px; padding:30px 0;">
            Belum ada item dipilih.
        </p>
    `;

    updateKasirTotal();

    return;
}

cartContainer.innerHTML = items.map(item => {

    const subtotal =
        item.harga * item.qty;

    const safeId =
        JSON.stringify(item.id);

    return `
        <div class="receipt-item" style="display:flex; justify-content:space-between; align-items:center; font-size:13px; margin-bottom:12px; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px;">
            <div style="flex: 1;">
                <strong>${escapeHtml(item.nama)}</strong>
                <div style="font-size: 11px; color: var(--gray);">
                    ${rupiah(item.harga)} x ${item.qty}
                </div>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
                <strong style="margin-right: 8px;">${rupiah(subtotal)}</strong>
                <div class="receipt-qty-control" style="display:flex; gap: 4px;">
                    <button type="button" onclick='changeKasirQty(${safeId}, -1)'>-</button>
                    <span style="padding: 0 4px; font-weight: 600;">${item.qty}</span>
                    <button type="button" onclick='changeKasirQty(${safeId}, 1)'>+</button>
                    <button type="button" onclick='removeFromKasirCart(${safeId})' style="color:#dc2626; background:#fee2e2;">🗑️</button>
                </div>
            </div>
        </div>
    `;
}).join('');

updateKasirTotal();


}

/* =========================================================
CALCULATE TOTAL
========================================================= */

function calculateKasirTotal() {
return Object.values(kasirCart)
.reduce((total, item) => {
return total +
(Number(item.harga) *
Number(item.qty));
}, 0);
}

/* =========================================================
UPDATE TOTAL
========================================================= */

function updateKasirTotal() {
currentKasirGrandTotal =
calculateKasirTotal();

const totalElements = [
    'kasirGrandTotal',
    'grandTotalKasir',
    'totalKasir'
];

totalElements.forEach(id => {
    const element =
        document.getElementById(id);

    if (element) {
        element.textContent =
            rupiah(currentKasirGrandTotal);
    }
});

// Also trigger kembalian calculation if applicable
if (typeof window.hitungKembalian === 'function') {
    window.hitungKembalian();
}


}

/* =========================================================
LOAD ORDERS
========================================================= */

window.loadOrders = async () => {
console.log('🟠 loadOrders() MULAI');

try {
    await authReady;

    if (!supabase) {
        throw new Error(
            'Supabase tidak tersedia.'
        );
    }

    const { data, error } = await supabase
        .from('orders')
        .select('*')
        .order('created_at', {
            ascending: false
        });

    console.log('📦 DATA ORDERS:', data);
    console.log('🔴 ERROR ORDERS:', error);

    if (error) {
        throw error;
    }

    cachedOrders = data || [];

    console.log(
        '📊 JUMLAH ORDERS:',
        cachedOrders.length
    );

    renderKasirOrders();

} catch (error) {
    console.error(
        '❌ Error load orders:',
        error
    );

    cachedOrders = [];

    renderKasirOrders();
}


};

/* =========================================================
RENDER ORDERS
========================================================= */

function renderKasirOrders() {
// Matched ID with kasir.html (#orderTableBody)
const container =
document.getElementById('orderTableBody') ||
document.getElementById('kasirOrderList') ||
document.getElementById('kasirOrdersList');

if (!container) {
    console.warn(
        '⚠️ Container order kasir tidak ditemukan.'
    );
    return;
}

let orders = [...cachedOrders];

if (currentFilterStatus !== 'all') {
    orders = orders.filter(order => {

        const status = String(
            order.status ?? ''
        )
            .trim()
            .toLowerCase();

        return status ===
            currentFilterStatus.toLowerCase();
    });
}

if (orders.length === 0) {
    container.innerHTML = `
        <tr>
            <td colspan="8" style="text-align:center; color:#aaa; padding:35px;">
                Belum ada pesanan ditemukan.
            </td>
        </tr>
    `;

    return;
}

// Check if the container is a <tbody> element or general container
if (container.tagName === 'TBODY') {
    container.innerHTML = orders.map(order => {
        const id = order.id ?? '-';
        const waktu = order.created_at ? new Date(order.created_at).toLocaleString('id-ID') : '-';
        const pelanggan = order.nama_pelanggan || order.name || order.meja || '-';
        const wa = order.whatsapp || order.wa || '-';
        const tipeBayar = `${order.tipe_pesanan || 'Dine-In'} / ${order.metode_pembayaran || order.payment_method || 'Cash'}`;
        const status = String(order.status ?? 'pending');
        const total = Number(order.total ?? order.grand_total ?? order.total_harga ?? 0);
        
        // Format items list if stored as array/json
        let itemsText = '-';
        if (order.items && Array.isArray(order.items)) {
            itemsText = order.items.map(i => `${i.nama || i.name} (${i.qty}x)`).join(', ');
        } else if (typeof order.items === 'string') {
            itemsText = order.items;
        }

        return `
            <tr>
                <td>${escapeHtml(waktu)}</td>
                <td><strong>${escapeHtml(pelanggan)}</strong></td>
                <td>${escapeHtml(wa)}</td>
                <td>${escapeHtml(tipeBayar)}</td>
                <td><span style="padding: 4px 8px; border-radius: 6px; font-size: 11px; background: #e0f2fe; color: #0369a1;">${escapeHtml(status)}</span></td>
                <td><small style="color: #64748b;">${escapeHtml(itemsText)}</small></td>
                <td><strong>${rupiah(total)}</strong></td>
                <td>
                    <button onclick="window.updateOrderStatus('${id}', 'completed')" style="padding: 4px 8px; font-size: 11px; background: #ecfdf5; color: #059669;">Selesai</button>
                </td>
            </tr>
        `;
    }).join('');
} else {
    container.innerHTML = orders.map(order => {
        const id = order.id ?? '-';
        const status = String(order.status ?? 'pending');
        const total = Number(order.total ?? order.grand_total ?? order.total_harga ?? 0);

        return `
            <div class="kasir-order-card" style="background:white; padding:12px; border-radius:8px; border:1px solid #e2e8f0; margin-bottom:8px;">
                <div style="display:flex; justify-content:space-between; gap:10px;">
                    <strong>Order #${escapeHtml(id)}</strong>
                    <span>${escapeHtml(status)}</span>
                </div>
                <div style="margin-top:8px; font-weight:600;">
                    ${rupiah(total)}
                </div>
            </div>
        `;
    }).join('');
}


}

/* =========================================================
FILTER ORDER STATUS
========================================================= */

window.filterKasirOrders = function(status) {
currentFilterStatus =
String(status || 'all');

renderKasirOrders();


};

/* =========================================================
UPDATE ORDER STATUS HELPER
========================================================= */

window.updateOrderStatus = async function(orderId, newStatus) {
try {
const { error } = await supabase
.from('orders')
.update({ status: newStatus })
.eq('id', orderId);

    if (error) throw error;
    
    alert('Status pesanan berhasil diperbarui!');
    window.loadOrders();
} catch (err) {
    console.error('Gagal update status:', err);
    alert('Gagal memperbarui status pesanan.');
}


};

/* =========================================================
UI HELPER FUNCTIONS (CASH & SUBMIT)
========================================================= */

window.toggleCashSection = function() {
const metode = document.getElementById('kasirMetodeBayar')?.value;
const section = document.getElementById('sectionKalkulatorCash');
if (section) {
section.style.display = (metode === 'Cash') ? 'block' : 'none';
}
};

window.setUangCepat = function(nominal) {
const input = document.getElementById('kasirUangBayar');
if (input) {
input.value = nominal;
window.hitungKembalian();
}
};

window.setUangPas = function() {
const input = document.getElementById('kasirUangBayar');
if (input) {
input.value = currentKasirGrandTotal;
window.hitungKembalian();
}
};

window.hitungKembalian = function() {
const uangBayar = Number(document.getElementById('kasirUangBayar')?.value) || 0;
const kembalianEl = document.getElementById('kasirKembalian');

if (kembalianEl) {
    const kembalian = uangBayar - currentKasirGrandTotal;
    kembalianEl.textContent = rupiah(kembalian >= 0 ? kembalian : 0);
}


};

window.submitKasirOrder = async function() {
if (Object.keys(kasirCart).length === 0) {
alert('Struk kasir masih kosong. Pilih menu terlebih dahulu.');
return;
}

const meja = document.getElementById('kasirNomorMeja')?.value.trim();
if (!meja) {
    alert('Mohon isi Nama / Meja pelanggan terlebih dahulu.');
    document.getElementById('kasirNomorMeja')?.focus();
    return;
}

const wa = document.getElementById('kasirWaPelanggan')?.value.trim() || '-';
const metode = document.getElementById('kasirMetodeBayar')?.value || 'Cash';
const items = Object.values(kasirCart);

try {
    const orderData = {
        nama_pelanggan: meja,
        whatsapp: wa,
        tipe_pesanan: 'Dine-In',
        metode_pembayaran: metode,
        status: 'completed',
        total: currentKasirGrandTotal,
        items: items,
        created_at: new Date().toISOString()
    };

    const { error } = await supabase
        .from('orders')
        .insert([orderData]);

    if (error) throw error;

    alert('Transaksi berhasil disimpan!');
    
    // Reset cart and inputs
    window.clearKasirCart();
    if (document.getElementById('kasirNomorMeja')) document.getElementById('kasirNomorMeja').value = '';
    if (document.getElementById('kasirWaPelanggan')) document.getElementById('kasirWaPelanggan').value = '';
    if (document.getElementById('kasirUangBayar')) document.getElementById('kasirUangBayar').value = '';
    
    window.loadOrders();
} catch (err) {
    console.error('Error saving order:', err);
    alert('Gagal menyimpan transaksi: ' + (err.message || err));
}


};

/* =========================================================
EVENT LISTENERS
========================================================= */

function setupKasirEvents() {
const searchMenuKasir =
document.getElementById(
'searchMenuKasir'
);

const filterKategoriKasir =
    document.getElementById(
        'filterKategoriKasir'
    );

if (searchMenuKasir) {
    searchMenuKasir.addEventListener(
        'input',
        jalankanFilterKasir
    );
}

if (filterKategoriKasir) {
    filterKategoriKasir.addEventListener(
        'change',
        jalankanFilterKasir
    );
}

console.log(
    '✅ Event listener kasir terpasang.'
);


}

/* =========================================================
START KASIR
========================================================= */

async function startKasir() {
try {
console.log(
'🚀 START KASIR MODULE'
);

    setupKasirEvents();

    await initKasirDashboard();

    console.log(
        '✅ KASIR MODULE SELESAI'
    );

} catch (error) {
    console.error(
        '❌ Gagal initialize kasir:',
        error
    );
}


}

if (document.readyState === 'loading') {

document.addEventListener(
    'DOMContentLoaded',
    startKasir,
    { once: true }
);


} else {

startKasir();


}
