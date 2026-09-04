import { supabase, authReady } from '../supabase.js';

let cachedProducts = [];
let cachedOrders = [];
let kasirCart = {};
let currentKasirGrandTotal = 0;
let currentFilterStatus = 'all';

function rupiah(n) { return 'Rp ' + Number(n).toLocaleString('id-ID'); }

function getJakartaISOString() {
const now = new Date();
const jakartaOffset = 7 * 60;
const localTime = new Date(now.getTime() + (now.getTimezoneOffset() + jakartaOffset) * 60000);
return localTime.toISOString().replace('Z', '+07:00');
}

// LOGIN AUTHENTICATION CHECK AGAINST usersetup TABLE
window.handleKasirLogin = async function(e) {
e.preventDefault();
const usernameInput = document.getElementById('loginUsername').value.trim();
const passwordInput = document.getElementById('loginPassword').value.trim();
const errorEl = document.getElementById('loginError');
errorEl.style.display = 'none';

await authReady;
try {
    const { data, error } = await supabase
        .from('usersetup')
        .select('*')
        .eq('username', usernameInput)
        .maybeSingle();

    if (error) throw error;

    if (data && (data.password === passwordInput || data.pass === passwordInput)) {
        sessionStorage.setItem('kasir_logged_in', 'true');
        sessionStorage.setItem('kasir_user', usernameInput);
        document.getElementById('loginOverlay').style.display = 'none';
        initKasirDashboard();
    } else {
        errorEl.innerText = 'Username atau password salah!';
        errorEl.style.display = 'block';
    }
} catch (err) {
    console.warn('Login verification exception:', err);
    // Fallback default accounts
    if ((usernameInput === 'kasir' && passwordInput === 'kasirchimchum123') || (usernameInput === 'admin' && passwordInput === 'chimchum123')) {
        sessionStorage.setItem('kasir_logged_in', 'true');
        sessionStorage.setItem('kasir_user', usernameInput);
        document.getElementById('loginOverlay').style.display = 'none';
        initKasirDashboard();
    } else {
        errorEl.innerText = 'Username atau password salah / gagal verifikasi.';
        errorEl.style.display = 'block';
    }
}
};

window.logoutKasir = function() {
if (confirm("Keluar dari panel kasir?")) {
    sessionStorage.removeItem('kasir_logged_in');
    sessionStorage.removeItem('kasir_user');
    document.getElementById('loginOverlay').style.display = 'flex';
    document.getElementById('loginUsername').value = '';
    document.getElementById('loginPassword').value = '';
}
};

window.switchTab = (tabId, element) => {
document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
document.getElementById(tabId).classList.add('active');
element.classList.add('active');

if (tabId === 'tab-pesanan') window.loadOrders();
};

window.addEventListener('DOMContentLoaded', async () => {
if (sessionStorage.getItem('kasir_logged_in') === 'true') {
    document.getElementById('loginOverlay').style.display = 'none';
    initKasirDashboard();
} else {
    document.getElementById('loginOverlay').style.display = 'flex';
}
});

async function initKasirDashboard() {
await window.loadProducts();
await window.loadOrders();
}

window.loadProducts = async () => {
await authReady;

try {
    const { data, error } = await supabase
        .from("products")
        .select("*");

    if (error) throw error;

    // PENTING: masukkan hasil Supabase ke cache
    cachedProducts = data || [];

    console.log("Produk dari Supabase:", cachedProducts);

    // Buat kategori unik, abaikan perbedaan huruf besar/kecil
    const kategoriMap = new Map();

    cachedProducts.forEach(p => {
        const kategori = (p.category || p.kategori || '').trim();

        if (kategori) {
            const key = kategori.toLowerCase();

            if (!kategoriMap.has(key)) {
                kategoriMap.set(key, kategori);
            }
        }
    });

    updateKasirKategoriDropdown(new Set(kategoriMap.values()));

    // Tampilkan produk
    renderKasirMenu();

} catch (err) {
    console.error("Error load produk:", err);

    cachedProducts = [];

    document.getElementById('kasirMenuList').innerHTML =
        `<p style="color:#dc2626; padding:20px;">
            Gagal mengambil produk dari database.
            <br>
            <small>${err.message || err}</small>
        </p>`;
}
};

function updateKasirKategoriDropdown(kategoriSet) {
const el = document.getElementById('filterKategoriKasir');

el.innerHTML = `
    <option value="Semua">Semua</option>
    ${Array.from(kategoriSet)
        .sort((a, b) => a.localeCompare(b, 'id'))
        .map(k => `<option value="${k}">${k}</option>`)
        .join('')}
`;
}

function jalankanFilterKasir() {
const kataKunci = document.getElementById('searchMenuKasir').value.toLowerCase();
const kategoriTerpilih = document.getElementById('filterKategoriKasir').value;
document.querySelectorAll('.kasir-item-card').forEach(card => {
    const nama = card.querySelector('h4').innerText.toLowerCase();
    const kat  = card.dataset.kategori || 'Umum';
    const ok = nama.includes(kataKunci) &&
       (
           kategoriTerpilih === 'Semua' ||
           kat.trim().toLowerCase() === kategoriTerpilih.trim().toLowerCase()
       );
    card.style.display = ok ? 'block' : 'none';
});
}

document.getElementById('searchMenuKasir').addEventListener('input', jalankanFilterKasir);
document.getElementById('filterKategoriKasir').addEventListener('change', jalankanFilterKasir);

window.toggleCashSection = () => {
const metode  = document.getElementById("kasirMetodeBayar").value;
const section = document.getElementById("sectionKalkulatorCash");
section.style.display = (metode === "Cash") ? "block" : "none";
window.hitungKembalian();
};

window.hitungKembalian = () => {
if (document.getElementById("kasirMetodeBayar").value !== "Cash") return;
const uangBayar = Number(document.getElementById("kasirUangBayar").value) || 0;
const kembalian = uangBayar - currentKasirGrandTotal;
const el = document.getElementById("kasirKembalian");
if (uangBayar === 0) {
    el.innerText = "Rp 0"; el.style.color = "var(--dark)";
} else if (kembalian < 0) {
    el.innerText = "Uang Kurang!"; el.style.color = "red";
} else {
    el.innerText = rupiah(kembalian); el.style.color = "var(--success)";
}
};

window.setUangCepat = (nominal) => {
document.getElementById("kasirUangBayar").value = nominal;
window.hitungKembalian();
};

window.setUangPas = () => {
document.getElementById("kasirUangBayar").value = currentKasirGrandTotal;
window.hitungKembalian();
};

function renderKasirMenu() {
const list = document.getElementById('kasirMenuList');
if (cachedProducts.length === 0) {
    list.innerHTML = "<p style='color:#aaa; padding:20px;'>Produk belum tersedia.</p>";
    return;
}
list.innerHTML = cachedProducts.map(p => {
    const nama = p.name || p.nama || '';
    const harga = p.price || p.harga || 0;
    const kategori = p.category || p.kategori || 'Umum';
    const foto = p.image || p.foto || '';
    const stok = Number(p.stok) || 100;
    const habis = stok <= 0;
    
    return `
      <div class="kasir-item-card"
           data-kategori="${kategori}"
           style="${habis ? 'opacity:.45;pointer-events:none;' : ''}"
           onclick="addToKasirCart('${p.id}', \`${nama}\`, ${harga}, ${stok})">
        <img src="${foto}" onerror="this.src='https://placehold.co/150'">
        <h4>${nama}</h4>
        <p style="margin-top:4px; font-size:13px;">${rupiah(harga)}</p>
      </div>`;
}).join('');
}

window.addToKasirCart = (id, nama, harga, stok) => {
if (kasirCart[id]) kasirCart[id].qty++;
else kasirCart[id] = { id, nama, harga, qty: 1, stok: stok };
updateKasirCartUI();
};

window.changeKasirQty = (id, delta) => {
if (!kasirCart[id]) return;
const next    = kasirCart[id].qty + delta;
if (next <= 0) delete kasirCart[id];
else kasirCart[id].qty = next;
updateKasirCartUI();
};

function updateKasirCartUI() {
const items = Object.values(kasirCart);
const cartEl = document.getElementById('kasirCartItems');

if (items.length === 0) {
    cartEl.innerHTML = `<p style="text-align:center; color:#aaa; font-size:13px; padding:30px 0;">Belum ada item dipilih.</p>`;
    document.getElementById("kasirGrandTotal").innerText = rupiah(0);
    currentKasirGrandTotal = 0;
    window.hitungKembalian();
    return;
}

let grandTotal = 0;
cartEl.innerHTML = items.map(item => {
    const subtotal = item.qty * item.harga;
    grandTotal += subtotal;
    return `
      <div class="receipt-item">
        <div style="max-width:55%;">
          <div style="font-weight:600; font-size:13px;">${item.nama}</div>
          <div style="font-size:11px; color:var(--gray);">${rupiah(item.harga)}</div>
        </div>
        <div class="receipt-qty-control" style="display:flex; align-items:center; gap:6px;">
          <button onclick="changeKasirQty('${item.id}', -1)">−</button>
          <span style="font-weight:700; font-size:13px; min-width:15px; text-align:center;">${item.qty}</span>
          <button onclick="changeKasirQty('${item.id}', 1)">+</button>
        </div>
        <div style="font-weight:600; font-size:13px; min-width:60px; text-align:right;">
          ${rupiah(subtotal)}
        </div>
      </div>`;
}).join('');

document.getElementById("kasirGrandTotal").innerText = rupiah(grandTotal);
currentKasirGrandTotal = grandTotal;
window.hitungKembalian();
}

function cetakStrukThermal(noMeja, waPelanggan, items, grandTotal, metodeBayar, uangBayar, kembalian) {
const printWindow = window.open('', '_blank', 'width=350,height=600');
const tgl = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
const itemsHtml = items.map(i => `
  <div style="display:flex; justify-content:space-between; margin-bottom:5px; font-size:12px;">
    <span>${i.nama || i.name} x${i.qty}</span>
    <span>${rupiah(i.qty * (i.harga || i.price))}</span>
  </div>`).join('');

printWindow.document.write(`
  <html><head>
    <title>Struk - ChimChum</title>
    <style>
      @page { margin:0; }
      body { font-family:'Courier New',monospace; width:48mm; padding:2mm; color:#000; font-size:11px; }
      .center { text-align:center; }
      .line { border-top:1px dashed #000; margin:6px 0; }
      .bold { font-weight:bold; }
    </style>
  </head><body>
    <div class="center bold" style="font-size:14px;">CHIMCHUM MALANG</div>
    <div class="center" style="font-size:10px;">Dimsum Mentai & Crispy Chicken</div>
    <div class="line"></div>
    <div style="font-size:11px; line-height:1.4;">
      Waktu : ${tgl}<br>
      Pelanggan : ${noMeja}
    </div>
    <div class="line"></div>
    ${itemsHtml}
    <div class="line"></div>
    <div style="display:flex; justify-content:space-between; font-size:12px;" class="bold">
      <span>TOTAL:</span><span>${rupiah(grandTotal)}</span>
    </div>
    <div class="line"></div>
    <div style="display:flex; justify-content:space-between; font-size:11px;">
      <span>Bayar (${metodeBayar}):</span><span>${rupiah(uangBayar)}</span>
    </div>
    <div style="display:flex; justify-content:space-between; font-size:11px;">
      <span>Kembalian:</span><span>${rupiah(kembalian)}</span>
    </div>
    <div class="line"></div>
    <div class="center" style="font-size:10px; margin-top:8px;">Terima Kasih!</div>
    <script>window.onload=function(){window.print();setTimeout(()=>window.close(),300);}<\/script>
  </body></html>`);
printWindow.document.close();
}

window.submitKasirOrder = async () => {
const items = Object.values(kasirCart);
if (items.length === 0) { alert("Struk kasir kosong!"); return; }

const noMeja = document.getElementById("kasirNomorMeja").value.trim();
if (!noMeja) { alert("Harap isi nama pelanggan / nomor meja!"); return; }

const waPelanggan = document.getElementById("kasirWaPelanggan").value.trim();
const metodeBayar = document.getElementById("kasirMetodeBayar").value;
const statusPrint = document.getElementById("printStrukCheck").checked;
const grandTotal = currentKasirGrandTotal;

let uangBayar = grandTotal;
let kembalian = 0;

if (metodeBayar === "Cash") {
    uangBayar = Number(document.getElementById("kasirUangBayar").value) || 0;
    if (uangBayar < grandTotal) {
        alert("Uang tunai kurang dari total tagihan!");
        return;
    }
    kembalian = uangBayar - grandTotal;
}

const orderId = 'KSR-' + Math.floor(1000 + Math.random() * 9000);
const jakartaISOString = getJakartaISOString();

const orderData = {
    order_id: orderId,
    customer_name: "Dine-In (" + noMeja + ")",
    phone: waPelanggan || "-",
    address: "Makan di Tempat",
    items: items.map(i => ({ nama: i.nama, qty: i.qty, harga: i.harga })),
    grand_total: grandTotal,
    payment_method: metodeBayar,
    status: "new",
    created_at: jakartaISOString
};

try {
    await authReady;
    const { data, error } = await supabase
        .from("orders")
        .insert([orderData])
        .select()
        .single();
    
    if (error) {
        console.error("Supabase insert error:", error);
        alert("Gagal menyimpan pesanan ke database.\n\n" + error.message);
        return;
    }
} catch (err) {
    console.error("Supabase order insert error:", err);
}

let localOrders = JSON.parse(localStorage.getItem('local_orders') || '[]');
localOrders.push(orderData);
localStorage.setItem('local_orders', JSON.stringify(localOrders));

alert("🎉 Transaksi Kasir Berhasil Disimpan!");

if (statusPrint) {
    cetakStrukThermal(noMeja, waPelanggan, items, grandTotal, metodeBayar, uangBayar, kembalian);
}

kasirCart = {};
document.getElementById("kasirNomorMeja").value = "";
document.getElementById("kasirWaPelanggan").value = "";
document.getElementById("kasirUangBayar").value = "";
updateKasirCartUI();
window.loadOrders();
};

function renderOrderSummary(list) {
const summaryEl = document.getElementById("orderSummary");
const counts = { all: list.length, new: 0, disiapkan: 0, dikirim: 0, selesai: 0, cancel: 0 };
list.forEach(o => {
    const st = (o.status || 'new').toLowerCase();
    if (counts[st] !== undefined) counts[st]++;
});

const cards = [
    { key: 'all', title: 'Semua', count: counts.all, color: '#475569' },
    { key: 'new', title: 'Baru', count: counts.new, color: '#f59e0b' },
    { key: 'disiapkan', title: 'Disiapkan', count: counts.disiapkan, color: '#3b82f6' },
    { key: 'dikirim', title: 'Dikirim', count: counts.dikirim, color: '#8b5cf6' },
    { key: 'selesai', title: 'Selesai', count: counts.selesai, color: '#10b981' },
    { key: 'cancel', title: 'Cancel', count: counts.cancel, color: '#ef4444' },
];

summaryEl.innerHTML = cards.map(c => `
    <div onclick="filterOrdersByStatus('${c.key}')" style="background:white; padding:16px; border-radius:14px; box-shadow:0 1px 3px rgba(0,0,0,0.05); cursor:pointer; border:2px solid ${currentFilterStatus === c.key ? c.color : '#f1f5f9'}; transition:all 0.2s;">
        <div style="font-size:12px; color:var(--gray); font-weight:500;">${c.title}</div>
        <div style="font-size:24px; font-weight:700; color:${c.color}; margin-top:2px;">${c.count}</div>
    </div>
`).join('');
}

window.filterOrdersByStatus = (status) => {
currentFilterStatus = status;
renderOrderSummary(cachedOrders);
renderOrdersTable();
};

function renderOrdersTable() {
const tbody = document.getElementById("orderTableBody");
let list = [...cachedOrders];

if (currentFilterStatus !== 'all') {
    list = list.filter(o => (o.status || 'new').toLowerCase() === currentFilterStatus);
}

if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:35px;color:#aaa;">Tidak ada pesanan dalam status ini.</td></tr>`;
    return;
}

tbody.innerHTML = list.map(o => {
    const tgl = o.created_at ? new Date(o.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : '-';
    const items = o.items || [];
    const itemsStr = Array.isArray(items) ? items.map(i => `${i.nama || i.name} (${i.qty}x)`).join(', ') : '-';
    const currentStatus = (o.status || 'new').toLowerCase();
    const recordKey = o.id || o.order_id;

    return `
        <tr>
            <td style="font-size:12px; color:var(--gray);">${tgl}</td>
            <td><b>${o.customer_name || '-'}</b><br><span style="font-size:11px; color:#94a3b8;">ID: ${o.order_id || '-'}</span></td>
            <td>${o.phone || '-'}</td>
            <td><span style="font-weight:500; font-size:12px;">${o.address || '-'}</span></td>
            <td>
                <select onchange="updateOrderStatus('${recordKey}', this.value)" style="padding:6px 10px; font-size:12px; border-radius:8px; font-weight:600; margin:0;">
                    <option value="new" ${currentStatus === 'new' ? 'selected' : ''}>New</option>
                    <option value="disiapkan" ${currentStatus === 'disiapkan' ? 'selected' : ''}>Disiapkan</option>
                    <option value="dikirim" ${currentStatus === 'dikirim' ? 'selected' : ''}>Dikirim</option>
                    <option value="selesai" ${currentStatus === 'selesai' ? 'selected' : ''}>Selesai</option>
                    <option value="cancel" ${currentStatus === 'cancel' ? 'selected' : ''}>Cancel</option>
                </select>
            </td>
            <td style="font-size:13px; max-width:250px;">${itemsStr}</td>
            <td style="color:var(--success); font-weight:700;">${rupiah(o.grand_total || 0)}</td>
            <td>
                <div style="display:flex; gap:6px;">
                    <button onclick="reprintOrder('${recordKey}')" style="padding:6px 10px; font-size:12px; background:#f1f5f9; color:var(--dark);" title="Cetak Struk">🖨️</button>
                    <button onclick="deleteOrder('${recordKey}')" class="btn-delete" style="padding:6px 10px; font-size:12px;" title="Hapus"><i class="fa-solid fa-trash"></i></button>
                </div>
            </td>
        </tr>
    `;
}).join('');
}

window.loadOrders = async () => {
await authReady;
let list = [];
try {
    const { data, error } = await supabase.from("orders").select("*").order('created_at', { ascending: false });
    if (error) throw error;
    if (data) list = data;
} catch (e) {
    console.error("Supabase load orders error:", e);
}
if (list.length === 0) {
    list = JSON.parse(localStorage.getItem('local_orders') || '[]');
}
cachedOrders = list;
renderOrderSummary(cachedOrders);
renderOrdersTable();
};

window.updateOrderStatus = async function(key, newStatus) {
try {
await authReady;
const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(key));
const column = isUUID ? "id" : "order_id";

const { data, error } = await supabase
  .from("orders")
  .update({ status: newStatus })
  .eq(column, key)
  .select("id, order_id, status");

if (error) throw error;

let localOrders = JSON.parse(localStorage.getItem("local_orders") || "[]");
localOrders = localOrders.map(order => {
  if (String(order.id) === String(key) || String(order.order_id) === String(key)) {
    return { ...order, status: newStatus };
  }
  return order;
});
localStorage.setItem("local_orders", JSON.stringify(localOrders));
await window.loadOrders();
alert("Status pesanan berhasil diperbarui!");
} catch (error) {
console.error("GAGAL UPDATE STATUS:", error);
alert("Status gagal disimpan ke database Supabase.\n\n" + error.message);
}
};

window.reprintOrder = (key) => {
const order = cachedOrders.find(o => String(o.id) === String(key) || String(o.order_id) === String(key));
if (!order) { alert("Pesanan tidak ditemukan."); return; }
cetakStrukThermal(order.customer_name, order.phone, order.items, order.grand_total, order.payment_method || 'Online', order.grand_total, 0);
};

window.deleteOrder = async (key) => {
    if (!confirm("Hapus pesanan ini?")) return;
    try {
        await authReady;
        let query = supabase.from("orders").delete();
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(key))) {
            query = query.eq("id", key);
        } else {
            query = query.eq("order_id", key);
        }
        const { error } = await query;
        if (error) throw error;
    
        cachedOrders = cachedOrders.filter(o => String(o.id) !== String(key) && String(o.order_id) !== String(key));
        let localOrders = JSON.parse(localStorage.getItem("local_orders") || "[]");
        localOrders = localOrders.filter(o => String(o.id) !== String(key) && String(o.order_id) !== String(key));
        localStorage.setItem("local_orders", JSON.stringify(localOrders));
    
        renderOrderSummary(cachedOrders);
        renderOrdersTable();
        alert("Pesanan berhasil dihapus.");
    } catch (error) {
        console.error("DELETE ORDER ERROR:", error);
        alert("Gagal menghapus pesanan.\n\n" + (error.message || "Unknown error"));
    }
};
