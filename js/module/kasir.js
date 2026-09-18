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
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
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
        <option value="all">Semua Kategori</option>
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

        /*
         * Penting:
         * Jangan gunakan Number(p.stok) || 100
         * karena stok 0 akan dianggap false.
         */
        const stok = Number(
            product.stok ?? 100
        );

        const habis = stok <= 0;

        /*
         * JSON.stringify membuat nama produk
         * lebih aman untuk inline onclick.
         */
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
        categorySelect?.value || 'all';

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
            category === 'all' ||
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
    const cartContainer =
        document.getElementById('kasirCartList');

    if (!cartContainer) {
        console.warn(
            '⚠️ #kasirCartList tidak ditemukan.'
        );
        return;
    }

    const items = Object.values(kasirCart);

    if (items.length === 0) {
        cartContainer.innerHTML = `
            <p style="
                color:#aaa;
                padding:20px;
                text-align:center;
            ">
                Keranjang masih kosong.
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
            <div class="kasir-cart-item">

                <div style="
                    display:flex;
                    justify-content:space-between;
                    gap:10px;
                ">

                    <div>
                        <strong>
                            ${escapeHtml(item.nama)}
                        </strong>

                        <div style="
                            font-size:13px;
                            color:#777;
                        ">
                            ${rupiah(item.harga)}
                        </div>
                    </div>

                    <strong>
                        ${rupiah(subtotal)}
                    </strong>

                </div>

                <div style="
                    display:flex;
                    align-items:center;
                    gap:8px;
                    margin-top:8px;
                ">

                    <button
                        type="button"
                        onclick='changeKasirQty(
                            ${safeId},
                            -1
                        )'
                    >
                        −
                    </button>

                    <span>
                        ${item.qty}
                    </span>

                    <button
                        type="button"
                        onclick='changeKasirQty(
                            ${safeId},
                            1
                        )'
                    >
                        +
                    </button>

                    <button
                        type="button"
                        onclick='removeFromKasirCart(
                            ${safeId}
                        )'
                        style="
                            margin-left:auto;
                            color:#dc2626;
                        "
                    >
                        Hapus
                    </button>

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

        /*
         * Jika tabel orders kamu mempunyai
         * struktur berbeda, bagian ini bisa
         * disesuaikan.
         */
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
    /*
     * Cari beberapa kemungkinan ID container
     * agar kompatibel dengan HTML yang sudah ada.
     */
    const container =
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
            <p style="
                color:#aaa;
                padding:20px;
                text-align:center;
            ">
                Belum ada pesanan.
            </p>
        `;

        return;
    }

    container.innerHTML = orders.map(order => {

        const id = order.id ?? '-';

        const status = String(
            order.status ?? 'pending'
        );

        const total = Number(
            order.total ??
            order.grand_total ??
            order.total_harga ??
            0
        );

        return `
            <div class="kasir-order-card">

                <div style="
                    display:flex;
                    justify-content:space-between;
                    gap:10px;
                ">

                    <strong>
                        Order #${escapeHtml(id)}
                    </strong>

                    <span>
                        ${escapeHtml(status)}
                    </span>

                </div>

                <div style="
                    margin-top:8px;
                    font-weight:600;
                ">
                    ${rupiah(total)}
                </div>

            </div>
        `;
    }).join('');
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
