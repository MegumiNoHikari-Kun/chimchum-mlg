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

function formatWaktu(value) {
    if (!value) return '-';
    try {
        const d = new Date(value);
        return d.toLocaleString('id-ID', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    } catch {
        return String(value);
    }
}


/* =========================================================
   TAB SWITCH + LOGOUT
   (referenced by onclick in kasir.html but were missing)
========================================================= */

let orderAutoRefreshInterval = null;

function startOrderAutoRefresh() {
    if (orderAutoRefreshInterval) return; // already running
    orderAutoRefreshInterval = setInterval(() => {
        window.loadOrders();
    }, 30000);
}

function stopOrderAutoRefresh() {
    if (orderAutoRefreshInterval) {
        clearInterval(orderAutoRefreshInterval);
        orderAutoRefreshInterval = null;
    }
}

window.switchTab = function (tabId, btnEl) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));

    const target = document.getElementById(tabId);
    if (target) target.classList.add('active');
    if (btnEl) btnEl.classList.add('active');

    if (tabId === 'tab-pesanan') {
        window.loadOrders();
       console.log("load pesanan @30 detik");
        startOrderAutoRefresh(); // refresh every 30s while this tab is open
    } else {
        stopOrderAutoRefresh(); // don't keep polling in the background
    }
};

window.logoutKasir = async function () {
    try {
        await authReady;
        if (supabase?.auth) {
            await supabase.auth.signOut();
        }
    } catch (error) {
        console.error('❌ Error saat logout:', error);
    } finally {
        window.location.href = 'login.html';
    }
};


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

        if (!supabase) {
            throw new Error('Supabase tidak tersedia.');
        }

        const { data, error } = await supabase
            .from('products')
            .select('*');

        console.log('📦 DATA PRODUCTS:', data, '🔴 ERROR:', error);

        if (error) throw error;

        cachedProducts = data || [];

        const kategoriMap = new Map();
        cachedProducts.forEach(product => {
            const kategori = (product.category ?? product.kategori ?? '').toString().trim();
            if (!kategori) return;
            const key = kategori.toLowerCase();
            if (!kategoriMap.has(key)) kategoriMap.set(key, kategori);
        });

        updateKasirKategoriDropdown(new Set(kategoriMap.values()));
        renderKasirMenu();

    } catch (error) {
        console.error('❌ Error load produk:', error);
        cachedProducts = [];

        const list = document.getElementById('kasirMenuList');
        if (list) {
            list.innerHTML = `
                <p style="color:#dc2626;padding:20px;background:#fef2f2;border-radius:10px;">
                    <strong>Gagal mengambil produk dari database.</strong>
                    <br><small>${escapeHtml(error?.message || error)}</small>
                </p>
            `;
        }
    }
};


/* =========================================================
   CATEGORY DROPDOWN
========================================================= */

function updateKasirKategoriDropdown(categories) {
    const select = document.getElementById('filterKategoriKasir');
    if (!select) return;

    const currentValue = select.value;

    select.innerHTML = `<option value="all">Semua Kategori</option>`;

    [...categories]
        .sort((a, b) => String(a).localeCompare(String(b), 'id'))
        .forEach(category => {
            const option = document.createElement('option');
            option.value = category;
            option.textContent = category;
            select.appendChild(option);
        });

    if ([...select.options].some(option => option.value === currentValue)) {
        select.value = currentValue;
    }
}


/* =========================================================
   RENDER MENU
========================================================= */

function renderKasirMenu(products = cachedProducts) {
    const list = document.getElementById('kasirMenuList');
    if (!list) {
        console.error('❌ Element #kasirMenuList tidak ditemukan.');
        return;
    }

    if (!products || products.length === 0) {
        list.innerHTML = `<p style="color:#aaa;padding:20px;text-align:center;">Produk belum tersedia.</p>`;
        return;
    }

    list.innerHTML = products.map(product => {
        const id = product.id;
        const nama = (product.name ?? product.nama ?? '').toString();
        const harga = Number(product.price ?? product.harga ?? 0);
        const kategori = (product.category ?? product.kategori ?? 'Umum').toString();
        const foto = (product.image ?? product.foto ?? '').toString();
        const stok = Number(product.stok ?? 100);
        const habis = stok <= 0;

        const safeId = JSON.stringify(id);
        const safeNama = JSON.stringify(nama);

        return `
            <div class="kasir-item-card"
                data-kategori="${escapeHtml(kategori)}"
                data-nama="${escapeHtml(nama.toLowerCase())}"
                style="${habis ? 'opacity:.45;pointer-events:none;' : ''}"
                onclick='addToKasirCart(${safeId}, ${safeNama}, ${harga}, ${stok})'>
                <img src="${escapeHtml(foto)}" alt="${escapeHtml(nama)}" onerror="this.src='https://placehold.co/150'">
                <h4>${escapeHtml(nama)}</h4>
                <p style="margin-top:4px;font-size:13px;">${rupiah(harga)}</p>
                ${habis
                    ? `<small style="color:#dc2626;font-weight:600;">Stok habis</small>`
                    : `<small style="color:#777;">Stok: ${stok}</small>`
                }
            </div>
        `;
    }).join('');
}


/* =========================================================
   FILTER MENU
========================================================= */

function jalankanFilterKasir() {
    const search = (document.getElementById('searchMenuKasir')?.value || '').trim().toLowerCase();
    const category = document.getElementById('filterKategoriKasir')?.value || 'all';

    const filtered = cachedProducts.filter(product => {
        const nama = (product.name ?? product.nama ?? '').toString().toLowerCase();
        const kategori = (product.category ?? product.kategori ?? 'Umum').toString();

        const matchSearch = !search || nama.includes(search);
        const matchCategory = category === 'all' || kategori.toLowerCase() === category.toLowerCase();

        return matchSearch && matchCategory;
    });

    renderKasirMenu(filtered);
}


/* =========================================================
   CART
   NOTE: cart container id fixed to match kasir.html (#kasirCartItems)
========================================================= */

window.addToKasirCart = function (id, nama, harga, stok) {
    const productId = String(id);
    harga = Number(harga) || 0;
    stok = Number(stok ?? 100);

    if (stok <= 0) {
        alert('Stok produk habis.');
        return;
    }

    if (!kasirCart[productId]) {
        kasirCart[productId] = { id: productId, nama, harga, qty: 0, stok };
    }

    if (kasirCart[productId].qty >= kasirCart[productId].stok) {
        alert('Jumlah melebihi stok.');
        return;
    }

    kasirCart[productId].qty++;
    renderKasirCart();
};

window.changeKasirQty = function (id, perubahan) {
    const productId = String(id);
    if (!kasirCart[productId]) return;

    const item = kasirCart[productId];
    item.qty += Number(perubahan);

    if (item.qty <= 0) {
        delete kasirCart[productId];
    } else if (item.qty > item.stok) {
        item.qty = item.stok;
        alert('Jumlah melebihi stok.');
    }

    renderKasirCart();
};

window.removeFromKasirCart = function (id) {
    delete kasirCart[String(id)];
    renderKasirCart();
};

window.clearKasirCart = function () {
    kasirCart = {};
    renderKasirCart();
};

function renderKasirCart() {
    const cartContainer = document.getElementById('kasirCartItems'); // was 'kasirCartList' — mismatch fixed
    if (!cartContainer) {
        console.warn('⚠️ #kasirCartItems tidak ditemukan.');
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
        window.hitungKembalian();
        return;
    }

    cartContainer.innerHTML = items.map(item => {
        const subtotal = item.harga * item.qty;
        const safeId = JSON.stringify(item.id);

        return `
            <div class="receipt-item">
                <div style="flex:1;">
                    <div><strong>${escapeHtml(item.nama)}</strong></div>
                    <div style="font-size:12px;color:#777;">${rupiah(item.harga)} x ${item.qty} = ${rupiah(subtotal)}</div>
                </div>
                <div class="receipt-qty-control" style="display:flex;align-items:center;gap:6px;">
                    <button type="button" onclick='changeKasirQty(${safeId}, -1)'>−</button>
                    <span>${item.qty}</span>
                    <button type="button" onclick='changeKasirQty(${safeId}, 1)'>+</button>
                    <button type="button" onclick='removeFromKasirCart(${safeId})' style="color:#dc2626;">✕</button>
                </div>
            </div>
        `;
    }).join('');

    updateKasirTotal();
    window.hitungKembalian();
}

function calculateKasirTotal() {
    return Object.values(kasirCart).reduce((total, item) => total + (Number(item.harga) * Number(item.qty)), 0);
}

function updateKasirTotal() {
    currentKasirGrandTotal = calculateKasirTotal();

    ['kasirGrandTotal', 'grandTotalKasir', 'totalKasir'].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.textContent = rupiah(currentKasirGrandTotal);
    });
}


/* =========================================================
   CASH CALCULATOR
   (toggleCashSection / hitungKembalian / setUangCepat / setUangPas
    were called from kasir.html onclick but never defined — added here)
========================================================= */

window.toggleCashSection = function () {
    const metode = document.getElementById('kasirMetodeBayar')?.value;
    const section = document.getElementById('sectionKalkulatorCash');
    if (!section) return;
    section.style.display = (metode === 'Cash') ? 'block' : 'none';
};

window.hitungKembalian = function () {
    const uangInput = document.getElementById('kasirUangBayar');
    const kembalianEl = document.getElementById('kasirKembalian');
    if (!kembalianEl) return;

    const uangBayar = Number(uangInput?.value) || 0;
    const kembalian = uangBayar - currentKasirGrandTotal;

    kembalianEl.textContent = rupiah(kembalian < 0 ? 0 : kembalian);
    kembalianEl.style.color = kembalian < 0 ? '#dc2626' : 'var(--success)';
};

window.setUangCepat = function (nominal) {
    const uangInput = document.getElementById('kasirUangBayar');
    if (!uangInput) return;
    const current = Number(uangInput.value) || 0;
    uangInput.value = current + Number(nominal);
    window.hitungKembalian();
};

window.setUangPas = function () {
    const uangInput = document.getElementById('kasirUangBayar');
    if (!uangInput) return;
    uangInput.value = currentKasirGrandTotal;
    window.hitungKembalian();
};


/* =========================================================
   RECEIPT PRINTING
   window.print() was printing the entire visible page (menu
   grid, tabs, etc.) instead of an actual receipt. This builds
   a proper 58mm thermal-style receipt in an isolated container
   and prints only that.
========================================================= */

function ensureStrukStyle() {
    if (document.getElementById('strukPrintStyle')) return;

    const style = document.createElement('style');
    style.id = 'strukPrintStyle';
    style.textContent = `
        #strukPrintArea { display: none; }
        @media print {
            body > *:not(#strukPrintArea) { display: none !important; }
            #strukPrintArea {
                display: block !important;
                width: 58mm;
                margin: 0;
                padding: 2mm;
                font-family: 'Courier New', Courier, monospace;
                font-size: 11px;
                line-height: 1.4;
                color: #000;
            }
            #strukPrintArea * { color: #000 !important; }
            #strukPrintArea .struk-center { text-align: center; }
            #strukPrintArea .struk-line { border-top: 1px dashed #000; margin: 4px 0; }
            #strukPrintArea .struk-row { display: flex; justify-content: space-between; gap: 6px; }
            #strukPrintArea .struk-item-name { flex: 1; word-break: break-word; }
            @page { margin: 0; size: 58mm auto; }
        }
    `;
    document.head.appendChild(style);
}

const logoShopeeFood = new URL(
    'https://cdn.jsdelivr.net/gh/MegumiNoHikari-Kun/chimchum-mlg@main/assets/img/shopeefood.png',
    window.location.href
).href;

const logoGrabFood = new URL(
    'https://cdn.jsdelivr.net/gh/MegumiNoHikari-Kun/chimchum-mlg@main/assets/img/grabfood.png',
    window.location.href
).href;

const logoGoFood = new URL(
    'https://cdn.jsdelivr.net/gh/MegumiNoHikari-Kun/chimchum-mlg@main/assets/img/gofood.png',
    window.location.href
).href;

console.log("URL ShopeeFood:", logoShopeeFood);
console.log("URL GrabFood:", logoGrabFood);
console.log("URL GoFood:", logoGoFood);

function buildStrukHTML(order) {
    const tanggal = new Date(order.created_at).toLocaleString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

    const itemsRows = order.items.map(i => {
        const subtotal = Number(i.harga) * Number(i.qty);

        return `
            <div class="struk-row">
                <span class="struk-item-name">
                    ${escapeHtml(i.nama)} x${i.qty}
                </span>
                <span>${rupiah(subtotal)}</span>
            </div>
        `;
    }).join('');

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
            <strong>ChimChum Malang</strong><br>
            Dimsum &amp; Snack<br>
            Sawojajar, Malang
        </div>

        <div class="struk-line"></div>

        <div>No: ${escapeHtml(order.order_id)}</div>
        <div>${escapeHtml(tanggal)}</div>
        <div>Meja/Nama: ${escapeHtml(order.customer_name)}</div>

        <div class="struk-line"></div>

        ${itemsRows}

        <div class="struk-line"></div>

        <div class="struk-row">
            <strong>
                <span>TOTAL</span>
                <span>${rupiah(order.grand_total)}</span>
            </strong>
        </div>

        <div class="struk-row">
            <span>Bayar</span>
            <span>${escapeHtml(order.payment_method)}</span>
        </div>

        ${bayarRows}

        <div class="struk-line"></div>

        <!-- DELIVERY PLATFORM -->
        <div class="struk-center struk-delivery">
            <div class="delivery-title">
                Tersedia juga di
            </div>

            <div class="struk-center struk-delivery">
                <div style="font-size:10px;">Tersedia di</div>
            
                <div class="delivery-logos">
                   <img
                       src="${logoShopeeFood}"
                       alt="ShopeeFood"
                       onerror="console.error('Gagal memuat logo ShopeeFood dari:', this.src)"
                   >
                   <img
                       src="${logoGrabFood}"
                       alt="GrabFood"
                       onerror="console.error('Gagal memuat logo GrabFood dari:', this.src)"
                   >
                   <img
                       src="${logoGoFood}"
                       alt="GoFood"
                       onerror="console.error('Gagal memuat logo GoFood dari:', this.src)"
                   >
               </div>
               
            </div>
        </div>

        <div class="struk-line"></div>

        <div class="struk-center">
            Terima kasih atas kunjungan Anda!
        </div>
    `;
}

function cetakStrukKasir(order) {
    ensureStrukStyle();

    let area = document.getElementById('strukPrintArea');
    if (!area) {
        area = document.createElement('div');
        area.id = 'strukPrintArea';
        document.body.appendChild(area);
    }

    area.innerHTML = buildStrukHTML(order);
   // Beri jeda 200-500ms agar browser sempat memuat gambar logo
    setTimeout(() => {
        window.print();
    }, 300);
    // window.print();
}

window.addEventListener('afterprint', () => {
    const area = document.getElementById('strukPrintArea');
    if (area) area.innerHTML = '';
});


/* =========================================================
   SUBMIT ORDER (CREATE)
   Was referenced by kasir.html onclick but never implemented —
   this is the actual missing "write" half of the CRUD.
========================================================= */

window.submitKasirOrder = async function () {
    try {
        const namaMeja = document.getElementById('kasirNomorMeja')?.value.trim();
        const wa = document.getElementById('kasirWaPelanggan')?.value.trim() || null;
        const metodeBayar = document.getElementById('kasirMetodeBayar')?.value || 'Cash';
        const uangBayar = Number(document.getElementById('kasirUangBayar')?.value) || 0;
        const printStruk = document.getElementById('printStrukCheck')?.checked;

        const items = Object.values(kasirCart);

        if (!namaMeja) {
            alert('Nama / Meja wajib diisi.');
            return;
        }
        if (items.length === 0) {
            alert('Keranjang masih kosong.');
            return;
        }
        if (metodeBayar === 'Cash' && uangBayar < currentKasirGrandTotal) {
            alert('Uang tunai diterima kurang dari total tagihan.');
            return;
        }

        await authReady;
        if (!supabase) throw new Error('Supabase tidak tersedia.');

        // Matches the real `orders` schema you sent:
        // id (auto uuid), order_id (text), customer_name, phone, address,
        // items (jsonb), grand_total (numeric), payment_method, status,
        // created_at, payment_proof. There's no order_type or cash_received/
        // change column, so cash-received/kembalian info for Cash payments is
        // recorded in `address` (unused for Dine-In orders) instead of being lost.
        const kembalian = uangBayar - currentKasirGrandTotal;
        const addressNote = metodeBayar === 'Cash'
            ? `Dine-In | Uang diterima: ${rupiah(uangBayar)} | Kembalian: ${rupiah(kembalian)}`
            : 'Dine-In';

        const now = new Date();

        const yy = String(now.getFullYear()).slice(-2);
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const hh = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        
        const randomNum = Math.floor(10 + Math.random() * 9000);
        
        const order_id = `DINEIN-${yy}${mm}${dd}${hh}${min}-${randomNum}`;
        
        const orderPayload = {
         order_id: order_id,
         customer_name: namaMeja,
         phone: wa,
         address: addressNote,
         items: items.map(i => ({
             id: i.id,
             nama: i.nama,
             harga: i.harga,
             qty: i.qty
         })),
         grand_total: currentKasirGrandTotal,
         payment_method: metodeBayar,
         status: 'new',
         created_at: new Date().toISOString(),
         payment_proof: null
        };

        const { data, error } = await supabase
            .from('orders')
            .insert(orderPayload)
            .select();

        if (error) throw error;

        console.log('✅ Order tersimpan:', data);

        if (printStruk) {
            cetakStrukKasir({
                ...orderPayload,
                _uangBayar: uangBayar,
                _kembalian: kembalian
            });
        }

        alert('Transaksi berhasil disimpan.');

        // reset form
        window.clearKasirCart();
        document.getElementById('kasirNomorMeja').value = '';
        document.getElementById('kasirWaPelanggan').value = '';
        document.getElementById('kasirUangBayar').value = '';
        window.hitungKembalian();

        window.loadOrders();

    } catch (error) {
        console.error('❌ Error submit order:', error);
        alert('Gagal menyimpan transaksi: ' + (error?.message || error));
    }
};


/* =========================================================
   LOAD ORDERS (READ)
========================================================= */

window.loadOrders = async () => {
    console.log('🟠 loadOrders() MULAI');

    try {
        await authReady;
        if (!supabase) throw new Error('Supabase tidak tersedia.');

        const { data, error } = await supabase
            .from('orders')
            .select('*')
            .order('created_at', { ascending: false });

        console.log('📦 DATA ORDERS:', data, '🔴 ERROR:', error);

        if (error) throw error;

        cachedOrders = data || [];
        renderOrderSummary();
        renderKasirOrders();

    } catch (error) {
        console.error('❌ Error load orders:', error);
        cachedOrders = [];
        renderOrderSummary();
        renderKasirOrders();
    }
};


/* =========================================================
   ORDER STATUS DEFINITIONS
========================================================= */

const STATUS_LIST = [
    { value: 'new', label: 'New', color: '#d97706' },
    { value: 'proses', label: 'Proses', color: '#2563eb' },
    { value: 'delivery', label: 'Delivery', color: '#7c3aed' },
    { value: 'selesai', label: 'Selesai', color: '#059669' },
    { value: 'batal', label: 'Batal', color: '#dc2626' }
];

function statusLabel(value) {
    return STATUS_LIST.find(s => s.value === value.toLowerCase())?.label || value;
}

function statusColorOf(value) {
    return STATUS_LIST.find(s => s.value === value.toLowerCase())?.color || '#64748b';
}


/* =========================================================
   RENDER ORDER SUMMARY CARDS (#orderSummary)
========================================================= */

function renderOrderSummary() {
    const container = document.getElementById('orderSummary');
    if (!container) return;

    const total = cachedOrders.length;
    const revenue = cachedOrders
        .filter(o => String(o.status).toLowerCase() === 'selesai')
        .reduce((sum, o) => sum + Number(o.grand_total ?? 0), 0);

    const cardStyle = 'background:white;border-radius:16px;padding:18px;box-shadow:0 1px 3px rgba(0,0,0,0.05);border:1px solid #f1f5f9;';

    const statusCardsHTML = STATUS_LIST.map(s => {
        const count = cachedOrders.filter(o => String(o.status).toLowerCase() === s.value).length;
        return `
            <div style="${cardStyle}">
                <div style="font-size:11px;color:var(--gray);text-transform:uppercase;font-weight:600;">${s.label}</div>
                <div style="font-size:22px;font-weight:700;margin-top:4px;color:${s.color};">${count}</div>
            </div>
        `;
    }).join('');

    container.innerHTML = `
        <div style="${cardStyle}">
            <div style="font-size:11px;color:var(--gray);text-transform:uppercase;font-weight:600;">Total Pesanan</div>
            <div style="font-size:22px;font-weight:700;margin-top:4px;">${total}</div>
        </div>
        ${statusCardsHTML}
        <div style="${cardStyle}">
            <div style="font-size:11px;color:var(--gray);text-transform:uppercase;font-weight:600;">Revenue (Selesai)</div>
            <div style="font-size:22px;font-weight:700;margin-top:4px;color:var(--primary);">${rupiah(revenue)}</div>
        </div>
    `;
}


/* =========================================================
   ORDER STATUS FILTER BAR
   filterKasirOrders() existed before but had no visible UI to
   trigger it — this injects a row of filter buttons above the
   orders table (once), wired to that function.
========================================================= */

function renderOrderFilterBar() {
    if (document.getElementById('orderFilterBar')) return;

    const summaryEl = document.getElementById('orderSummary');
    if (!summaryEl) return;

    const bar = document.createElement('div');
    bar.id = 'orderFilterBar';
    bar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;';

    const allBtn = { value: 'all', label: 'Semua', color: '#334155' };
    [allBtn, ...STATUS_LIST].forEach(s => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.statusFilter = s.value;
        btn.textContent = s.label;
        btn.style.cssText = `
            padding:8px 16px;border-radius:9999px;font-size:12px;font-weight:600;
            border:1px solid ${s.color};background:white;color:${s.color};cursor:pointer;
        `;
        btn.onclick = () => {
            window.filterKasirOrders(s.value);
            bar.querySelectorAll('button').forEach(b => {
                const active = b.dataset.statusFilter === s.value;
                b.style.background = active ? b.dataset.color || s.color : 'white';
                b.style.color = active ? 'white' : (STATUS_LIST.find(x => x.value === b.dataset.statusFilter)?.color || '#334155');
            });
        };
        if (s.value === 'all') {
            btn.style.background = '#334155';
            btn.style.color = 'white';
        }
        bar.appendChild(btn);
    });

    summaryEl.insertAdjacentElement('afterend', bar);
}


/* =========================================================
   RENDER ORDERS TABLE (#orderTableBody)
   Fixed to target the actual <tbody> in kasir.html instead of
   a nonexistent div container, and to output <tr> rows matching
   the table's <thead> columns.
========================================================= */

function renderKasirOrders() {
    renderOrderFilterBar();

    const tbody = document.getElementById('orderTableBody');
    if (!tbody) {
        console.warn('⚠️ #orderTableBody tidak ditemukan.');
        return;
    }

    let orders = [...cachedOrders];

    if (currentFilterStatus !== 'all') {
        orders = orders.filter(order =>
            String(order.status ?? '').trim().toLowerCase() === currentFilterStatus.toLowerCase()
        );
    }

    if (orders.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align:center; color:#aaa; padding:35px;">
                    Belum ada pesanan.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = orders.map(order => {
        const id = order.id ?? '-';
        const status = String(order.status ?? 'new');
        const total = Number(order.grand_total ?? 0);
        const items = Array.isArray(order.items) ? order.items : [];
        const itemsText = items.map(i => `${escapeHtml(i.nama ?? i.name ?? '')} x${i.qty ?? 1}`).join(', ') || '-';

        const statusColor = statusColorOf(status);
        const statusOptionsHTML = STATUS_LIST.map(s =>
            `<option value="${s.value}" ${status.toLowerCase() === s.value ? 'selected' : ''}>${s.label}</option>`
        ).join('');

        return `
            <tr>
                <td>${escapeHtml(formatWaktu(order.created_at))}</td>
                <td>${escapeHtml(order.customer_name ?? order.nama ?? '-')}</td>
                <td>${escapeHtml(order.phone ?? order.wa ?? '-')}</td>
                <td>${escapeHtml(order.address ?? '-')} / ${escapeHtml(order.payment_method ?? '-')}</td>
                <td><span style="color:${statusColor};font-weight:600;">${escapeHtml(statusLabel(status))}</span></td>
                <td style="max-width:220px;">${itemsText}</td>
                <td>${rupiah(total)}</td>
                <td>
                    <select onchange="updateOrderStatus('${id}', this.value)" style="margin:0;padding:6px 8px;font-size:12px;width:auto;">
                        ${statusOptionsHTML}
                    </select>
                    <button type="button" class="btn-delete" style="margin-top:4px;" onclick="deleteKasirOrder('${id}')">Hapus</button>
                </td>
            </tr>
        `;
    }).join('');
}


/* =========================================================
   UPDATE ORDER STATUS (UPDATE)
========================================================= */

window.updateOrderStatus = async function (id, newStatus) {
    try {
        await authReady;
        if (!supabase) throw new Error('Supabase tidak tersedia.');

        const { error } = await supabase
            .from('orders')
            .update({ status: newStatus })
            .eq('id', id);

        if (error) throw error;

        window.loadOrders();

    } catch (error) {
        console.error('❌ Error update status order:', error);
        alert('Gagal mengubah status: ' + (error?.message || error));
    }
};


/* =========================================================
   DELETE ORDER (DELETE)
========================================================= */

window.deleteKasirOrder = async function (id) {
    if (!confirm('Hapus pesanan ini?')) return;

    try {
        await authReady;
        if (!supabase) throw new Error('Supabase tidak tersedia.');

        const { error } = await supabase
            .from('orders')
            .delete()
            .eq('id', id);

        if (error) throw error;

        window.loadOrders();

    } catch (error) {
        console.error('❌ Error delete order:', error);
        alert('Gagal menghapus pesanan: ' + (error?.message || error));
    }
};

window.filterKasirOrders = function (status) {
    currentFilterStatus = String(status || 'all');
    renderKasirOrders();
};


/* =========================================================
   EVENT LISTENERS
========================================================= */

function setupKasirEvents() {
    const searchMenuKasir = document.getElementById('searchMenuKasir');
    const filterKategoriKasir = document.getElementById('filterKategoriKasir');
    const metodeBayar = document.getElementById('kasirMetodeBayar');

    if (searchMenuKasir) searchMenuKasir.addEventListener('input', jalankanFilterKasir);
    if (filterKategoriKasir) filterKategoriKasir.addEventListener('change', jalankanFilterKasir);
    if (metodeBayar) window.toggleCashSection(); // set initial visibility on load

    console.log('✅ Event listener kasir terpasang.');
}


/* =========================================================
   START KASIR
========================================================= */

async function startKasir() {
    try {
        console.log('🚀 START KASIR MODULE');
        setupKasirEvents();
        await initKasirDashboard();
        console.log('✅ KASIR MODULE SELESAI');
    } catch (error) {
        console.error('❌ Gagal initialize kasir:', error);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startKasir, { once: true });
} else {
    startKasir();
}
