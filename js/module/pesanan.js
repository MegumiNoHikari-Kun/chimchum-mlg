import { supabase, authReady } from '../supabase.js';

let cachedOrders = [];
let currentFilter = 'all';
let searchQuery = '';
let currentPage = 1;
let rowsPerPage = 10;

// Filter periode & sorting
let filterMonth = 'all'; // 'all' | 1..12
let filterYear = 'all';  // 'all' | 2026, dst
let sortKey = 'created_at';
let sortDir = 'desc';

const MONTH_NAMES = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const SORT_KEYS = ['created_at', 'customer_name', 'phone', 'payment_method', 'status', 'items', 'grand_total'];
const STATUS_RANK = { new: 0, disiapkan: 1, 'sedang diproses': 1, dikirim: 2, selesai: 3, cancel: 4 };

function rupiah(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }

const PAYMENT_STATUS_STYLES = {
    unpaid:   'bg-rose-50 text-rose-700 border-rose-200',
    pending:  'bg-amber-50 text-amber-700 border-amber-200',
    paid:     'bg-emerald-50 text-emerald-700 border-emerald-200',
    failed:   'bg-slate-100 text-slate-600 border-slate-300',
    refunded: 'bg-purple-50 text-purple-700 border-purple-200'
};

function paymentStatusSelect(key, current) {
    const val = (current || 'unpaid').toLowerCase();
    const opts = [
        ['unpaid', 'Belum Bayar'],
        ['pending', 'Menunggu Verifikasi'],
        ['paid', 'Lunas'],
        ['failed', 'Gagal'],
        ['refunded', 'Refund']
    ];
    return `
        <select onchange="updatePaymentStatus('${key}', this.value)" class="mt-1.5 border rounded-lg p-1 text-[11px] font-semibold cursor-pointer outline-none ${PAYMENT_STATUS_STYLES[val] || PAYMENT_STATUS_STYLES.unpaid}">
            ${opts.map(([v, label]) => `<option value="${v}" ${val === v ? 'selected' : ''}>${label}</option>`).join('')}
        </select>`;
}

function paymentProofLink(proof) {
    if (!proof || proof === 'Pending / Cash') {
        return `<span class="block mt-1.5 text-[10px] text-slate-400">Belum ada bukti</span>`;
    }

    // Fallback base64 (kalau upload ke storage gagal): buka lewat tab baru
    if (proof.startsWith('data:image')) {
        return `<a href="#" onclick="openProofImage(this); return false;" data-src="${proof}" class="inline-flex items-center gap-1 mt-1.5 text-[11px] font-semibold text-orange-600 hover:text-orange-700 underline">
                    <i class="fa-solid fa-image"></i> Lihat Bukti
                </a>`;
    }

    return `<a href="${proof}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 mt-1.5 text-[11px] font-semibold text-orange-600 hover:text-orange-700 underline">
                <i class="fa-solid fa-image"></i> Lihat Bukti
            </a>`;
}

window.openProofImage = function(el) {
    const src = el.dataset.src;
    const w = window.open('', '_blank');
    if (w) {
        w.document.write(`<title>Bukti Pembayaran</title><body style="margin:0;background:#111;display:flex;justify-content:center;align-items:center;min-height:100vh"><img src="${src}" style="max-width:100%;max-height:100vh"></body>`);
        w.document.close();
    }
};

/* ================= PERIODE (BULAN / TAHUN, zona WIB) ================= */
const ymFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit' });

function ymOf(o) {
    if (o._y === undefined) {
        if (!o.created_at) { o._y = 0; o._m = 0; }
        else {
            const p = {};
            ymFmt.formatToParts(new Date(o.created_at)).forEach(x => (p[x.type] = x.value));
            o._y = parseInt(p.year, 10) || 0;
            o._m = parseInt(p.month, 10) || 0;
        }
    }
    return o;
}

function getPeriodOrders() {
    if (filterYear === 'all' && filterMonth === 'all') return cachedOrders;
    return cachedOrders.filter(o => {
        ymOf(o);
        if (filterYear !== 'all' && o._y !== Number(filterYear)) return false;
        if (filterMonth !== 'all' && o._m !== Number(filterMonth)) return false;
        return true;
    });
}

function renderPeriodOptions() {
    const monthSel = document.getElementById('monthFilter');
    const yearSel = document.getElementById('yearFilter');

    if (monthSel) {
        monthSel.innerHTML = `<option value="all">Semua Bulan</option>` +
            MONTH_NAMES.map((n, i) => `<option value="${i + 1}">${n}</option>`).join('');
        monthSel.value = String(filterMonth);
    }
    if (yearSel) {
        const years = [...new Set(cachedOrders.map(o => ymOf(o)._y).filter(Boolean))];
        if (filterYear !== 'all' && !years.includes(Number(filterYear))) years.push(Number(filterYear));
        years.sort((a, b) => b - a);
        yearSel.innerHTML = `<option value="all">Semua Tahun</option>` +
            years.map(y => `<option value="${y}">${y}</option>`).join('');
        yearSel.value = String(filterYear);
    }
}

window.changeMonth = function(event) {
    filterMonth = event.target.value;
    currentPage = 1;
    renderSummary();
    renderTable();
};

window.changeYear = function(event) {
    filterYear = event.target.value;
    currentPage = 1;
    renderSummary();
    renderTable();
};

window.setThisMonth = function() {
    const p = {};
    ymFmt.formatToParts(new Date()).forEach(x => (p[x.type] = x.value));
    filterYear = String(parseInt(p.year, 10));
    filterMonth = String(parseInt(p.month, 10));
    currentPage = 1;
    renderPeriodOptions();
    renderSummary();
    renderTable();
};

window.resetFilters = function() {
    filterMonth = 'all';
    filterYear = 'all';
    currentFilter = 'all';
    searchQuery = '';
    sortKey = 'created_at';
    sortDir = 'desc';
    currentPage = 1;
    const input = document.getElementById('orderSearchInput');
    if (input) input.value = '';
    renderPeriodOptions();
    renderSummary();
    renderTable();
};

/* ================= SORTING ================= */
window.sortBy = function(key) {
    if (sortKey === key) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
        sortKey = key;
        // Waktu & Total enaknya mulai dari terbesar/terbaru, kolom teks mulai A-Z
        sortDir = (key === 'created_at' || key === 'grand_total') ? 'desc' : 'asc';
    }
    currentPage = 1;
    renderTable();
};

function updateSortIcons() {
    SORT_KEYS.forEach(k => {
        const el = document.getElementById('sort-' + k);
        if (!el) return;
        if (k === sortKey) {
            el.className = `fa-solid ${sortDir === 'asc' ? 'fa-sort-up' : 'fa-sort-down'} text-orange-500 ml-1`;
        } else {
            el.className = 'fa-solid fa-sort text-slate-300 ml-1';
        }
    });
}

function itemsText(o) {
    return Array.isArray(o.items) ? o.items.map(i => `${i.nama || i.name} (${i.qty}x)`).join(', ') : '';
}

function sortValue(o, key) {
    switch (key) {
        case 'created_at':     return o.created_at ? new Date(o.created_at).getTime() : 0;
        case 'customer_name':  return (o.customer_name || '').toLowerCase();
        case 'phone':          return String(o.phone || '').toLowerCase();
        case 'payment_method': return (o.payment_method || 'Cash').toLowerCase();
        case 'status':         return STATUS_RANK[(o.status || 'new').toLowerCase()] ?? 99;
        case 'items':          return itemsText(o).toLowerCase();
        case 'grand_total':    return Number(o.grand_total || 0);
        default:               return '';
    }
}

function compareOrders(a, b) {
    const va = sortValue(a, sortKey);
    const vb = sortValue(b, sortKey);
    let r;
    if (typeof va === 'number' && typeof vb === 'number') r = va - vb;
    else r = String(va).localeCompare(String(vb), 'id', { numeric: true, sensitivity: 'base' });
    return sortDir === 'asc' ? r : -r;
}

/* ================= SEARCH (semua kolom) ================= */
const STATUS_LABELS = { new: 'new baru', disiapkan: 'disiapkan diproses', 'sedang diproses': 'disiapkan diproses sedang diproses', dikirim: 'dikirim', selesai: 'selesai', cancel: 'cancel batal' };
const PAY_STATUS_LABELS = { unpaid: 'unpaid belum bayar', pending: 'pending menunggu verifikasi', paid: 'paid lunas', failed: 'failed gagal', refunded: 'refunded refund' };

function orderHaystack(o) {
    // Tanggal dihitung sekali lalu disimpan (created_at tidak berubah)
    if (o._tgl === undefined) {
        if (o.created_at) {
            const d = new Date(o.created_at);
            o._tgl = d.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }).toLowerCase();
            o._tglLong = d.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'long', year: 'numeric' }).toLowerCase();
        } else { o._tgl = ''; o._tglLong = ''; }
    }
    const status = (o.status || 'new').toLowerCase();
    const payStatus = (o.payment_status || 'unpaid').toLowerCase();
    const phoneDigits = String(o.phone || '').replace(/\D/g, '');
    const phoneAlt = phoneDigits.startsWith('62') ? '0' + phoneDigits.slice(2) : phoneDigits;
    const total = Number(o.grand_total || 0);

    return [
        o.customer_name, o.order_id, o.id,
        o.phone, phoneDigits, phoneAlt,
        o.payment_method || 'Cash',
        status, STATUS_LABELS[status] || '',
        payStatus, PAY_STATUS_LABELS[payStatus] || '',
        o.address,
        o._tgl, o._tglLong,
        itemsText(o),
        total, rupiah(total)
    ].map(v => String(v ?? '').toLowerCase()).join(' | ');
}

/* ================= LOAD ================= */
window.loadOrders = async function() {
    await authReady;
    let orders = [];
    try {
        const { data } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
        if (data) orders = data;
    } catch (e) { console.warn(e); }
    if (orders.length === 0) {
        orders = JSON.parse(localStorage.getItem('local_orders') || '[]');
    }
    cachedOrders = orders;
    currentPage = 1; // Reset to page 1 on fresh load
    renderPeriodOptions();
    renderSummary();
    renderTable();
};

function renderSummary() {
    const orders = getPeriodOrders(); // kartu ringkasan mengikuti filter bulan/tahun
    const counts = { all: orders.length, new: 0, disiapkan: 0, dikirim: 0, selesai: 0, cancel: 0 };
    orders.forEach(o => {
        const st = (o.status || 'new').toLowerCase();
        if (st === 'disiapkan' || st === 'sedang diproses') counts.disiapkan++;
        else if (counts[st] !== undefined) counts[st]++;
    });

    const cards = [
        { key: 'all', title: 'Total', count: counts.all, defaultColor: 'text-slate-700 border-slate-200 bg-white', icon: 'fa-receipt', iconClass: 'bg-slate-100 text-slate-600' },
        { key: 'new', title: 'Baru', count: counts.new, defaultColor: 'text-amber-600 border-amber-200 bg-amber-50/50', icon: 'fa-bell', iconClass: 'bg-blue-50 text-blue-600' },
        { key: 'disiapkan', title: 'Diproses', count: counts.disiapkan, defaultColor: 'text-blue-600 border-blue-200 bg-blue-50/50', icon: 'fa-fire-burner', iconClass: 'bg-amber-50 text-amber-600' },
        { key: 'dikirim', title: 'Dikirim', count: counts.dikirim, defaultColor: 'text-purple-600 border-purple-200 bg-purple-50/50', icon: 'fa-motorcycle', iconClass: 'bg-indigo-50 text-indigo-600' },
        { key: 'selesai', title: 'Selesai', count: counts.selesai, defaultColor: 'text-emerald-600 border-emerald-200 bg-emerald-50/50', icon: 'fa-circle-check', iconClass: 'bg-emerald-50 text-emerald-600' },
        { key: 'cancel', title: 'Batal', count: counts.cancel, defaultColor: 'text-rose-600 border-rose-200 bg-rose-50/50', icon: 'fa-circle-xmark', iconClass: 'bg-red-50 text-red-600' }
    ];

    const container = document.getElementById('orderSummary');
    if (container) {
        container.innerHTML = cards.map(c => {
            const isActive = currentFilter === c.key;
            const activeStyle = isActive
                ? 'border-2 border-orange-500 shadow-sm bg-orange-50/30 text-orange-700 font-semibold'
                : `border border-slate-200 hover:shadow-sm ${c.defaultColor}`;

            return `
                <div onclick="filterStatus('${c.key}')" class="rounded-xl p-4 cursor-pointer transition border ${activeStyle} flex items-center justify-between">
                    <div>
                        <div class="text-[11px] font-medium text-slate-500">${c.title}</div>
                        <div class="text-xl font-bold mt-1">${c.count}</div>
                    </div>
                    <div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${c.iconClass}">
                        <i class="fa-solid ${c.icon}"></i>
                    </div>
                </div>
            `;
        }).join('');
    }
}

window.filterStatus = function(status) {
    currentFilter = status;
    currentPage = 1;
    renderSummary();
    renderTable();
};

window.handleSearchInput = function(event) {
    searchQuery = (event.target.value || '').toLowerCase().trim();
    currentPage = 1;
    renderTable();
};

window.changeRowsPerPage = function(event) {
    rowsPerPage = parseInt(event.target.value) || 10;
    currentPage = 1;
    renderTable();
};

window.changePage = function(page) {
    currentPage = page;
    renderTable();
};

function renderTable() {
    const tbody = document.getElementById('ordersBody');
    if (!tbody) return;

    // 1) Periode bulan/tahun
    let filtered = [...getPeriodOrders()];

    // 2) Filter status (kartu ringkasan)
    if (currentFilter !== 'all') {
        filtered = filtered.filter(o => {
            const st = (o.status || 'new').toLowerCase();
            if (currentFilter === 'disiapkan') return st === 'disiapkan' || st === 'sedang diproses';
            return st === currentFilter;
        });
    }

    // 3) Pencarian di semua kolom; beberapa kata = semua kata harus cocok
    if (searchQuery) {
        const tokens = searchQuery.split(/\s+/).filter(Boolean);
        filtered = filtered.filter(o => {
            const hay = orderHaystack(o);
            return tokens.every(t => hay.includes(t));
        });
    }

    // 4) Sorting
    filtered.sort(compareOrders);
    updateSortIcons();

    const totalFiltered = filtered.length;
    const sumTotal = filtered.reduce((s, o) => s + Number(o.grand_total || 0), 0);
    const totalPages = Math.ceil(totalFiltered / rowsPerPage) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIndex = (currentPage - 1) * rowsPerPage;
    const paginatedOrders = filtered.slice(startIndex, startIndex + rowsPerPage);

    if (paginatedOrders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-10 text-slate-400">Tidak ada pesanan ditemukan.</td></tr>`;
        renderPaginationControls(0, 1, 1, 0);
        return;
    }

    tbody.innerHTML = paginatedOrders.map(o => {
        const tgl = o.created_at ? new Date(o.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : '-';
        const items = Array.isArray(o.items) ? o.items.map(i => `${i.nama || i.name} (${i.qty}x)`).join(', ') : '-';
        const status = (o.status || 'new').toLowerCase();
        const key = o.id || o.order_id;

        return `
            <tr class="hover:bg-slate-50/80 border-b border-slate-100">
                <td class="p-3 text-slate-500 text-xs">${tgl}</td>
                <td class="p-3 font-semibold text-slate-800 text-xs">${o.customer_name || '-'}<br><span class="font-normal text-[10px] text-slate-400">ID: ${o.order_id || '-'}</span></td>
                <td class="p-3 text-slate-600 text-xs">${o.phone || '-'}</td>
                <td class="p-3 font-medium text-slate-700 text-xs">
                    ${o.payment_method || 'Cash'}<br>
                    ${paymentStatusSelect(key, o.payment_status)}<br>
                    ${paymentProofLink(o.payment_proof)}<br>
                    
                    <span class="font-normal text-[11px] text-slate-400">${o.address || '-'}</span>
                </td>
                <td class="p-3">
                    <select onchange="updateStatus('${key}', this.value)" class="bg-slate-100 border border-slate-200 rounded-lg p-1.5 text-xs font-semibold cursor-pointer outline-none">
                        <option value="new" ${status === 'new' ? 'selected' : ''}>New</option>
                        <option value="disiapkan" ${status === 'disiapkan' || status === 'sedang diproses' ? 'selected' : ''}>Disiapkan</option>
                        <option value="dikirim" ${status === 'dikirim' ? 'selected' : ''}>Dikirim</option>
                        <option value="selesai" ${status === 'selesai' ? 'selected' : ''}>Selesai</option>
                        <option value="cancel" ${status === 'cancel' ? 'selected' : ''}>Cancel</option>
                    </select><br>
                     ${o.stock_restored ? '<span class="block mt-1 text-[10px] font-semibold text-emerald-600"><i class="fa-solid fa-rotate-left"></i> Stok dikembalikan</span>' : ''}
                </td>
                <td class="p-3 max-w-xs text-slate-600 text-xs">${items}</td>
                <td class="p-3 font-bold text-emerald-600 text-xs">${rupiah(o.grand_total || 0)}</td>
                <td class="p-3 flex items-center gap-1">
                    <button onclick="reprintOrder('${key}')" class="px-2.5 py-1.5 text-xs bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition" title="Cetak Struk">🖨️</button>
                    <button onclick="deleteOrder('${key}')" class="bg-rose-50 text-rose-600 hover:bg-rose-100 px-2.5 py-1.5 rounded-lg transition text-xs" title="Hapus"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>
        `;
    }).join('');

    renderPaginationControls(totalFiltered, currentPage, totalPages, sumTotal);
}

function renderPaginationControls(totalItems, page, totalPages, sumTotal) {
    let paginationContainer = document.getElementById('orderPagination');
    if (!paginationContainer) {
        const tableWrapper = document.getElementById('ordersBody')?.closest('.overflow-x-auto') || document.getElementById('ordersBody')?.parentElement;
        if (tableWrapper) {
            const div = document.createElement('div');
            div.id = 'orderPagination';
            div.className = 'flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 bg-white border-t border-slate-100 text-xs text-slate-600';
            tableWrapper.parentNode.insertBefore(div, tableWrapper.nextSibling);
            paginationContainer = div;
        } else {
            return;
        }
    }

    const startRecord = totalItems === 0 ? 0 : (page - 1) * rowsPerPage + 1;
    const endRecord = Math.min(page * rowsPerPage, totalItems);
    const btnBase = 'px-3 py-1.5 border border-slate-200 rounded-lg font-medium transition';
    const prevCls = page <= 1 ? 'opacity-40 cursor-not-allowed' : 'hover:bg-slate-100';
    const nextCls = page >= totalPages ? 'opacity-40 cursor-not-allowed' : 'hover:bg-slate-100';

    paginationContainer.innerHTML = `
        <div class="flex items-center gap-2 flex-wrap">
            <span>Menampilkan <b>${startRecord}-${endRecord}</b> dari <b>${totalItems}</b> pesanan${totalItems ? ` &middot; Total <b class="text-emerald-600">${rupiah(sumTotal)}</b>` : ''}</span>
            <select onchange="changeRowsPerPage(event)" class="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 outline-none text-xs">
                <option value="5" ${rowsPerPage === 5 ? 'selected' : ''}>5 per halaman</option>
                <option value="10" ${rowsPerPage === 10 ? 'selected' : ''}>10 per halaman</option>
                <option value="25" ${rowsPerPage === 25 ? 'selected' : ''}>25 per halaman</option>
                <option value="50" ${rowsPerPage === 50 ? 'selected' : ''}>50 per halaman</option>
            </select>
        </div>
        <div class="flex items-center gap-1">
            <button onclick="changePage(${page - 1})" ${page <= 1 ? 'disabled' : ''} class="${btnBase} ${prevCls}">Prev</button>
            <span class="px-3 py-1.5 font-medium text-slate-700">Halaman ${page} dari ${totalPages || 1}</span>
            <button onclick="changePage(${page + 1})" ${page >= totalPages ? 'disabled' : ''} class="${btnBase} ${nextCls}">Next</button>
        </div>
    `;
}

window.reprintOrder = (key) => {
    const order = cachedOrders.find(o => String(o.id) === String(key) || String(o.order_id) === String(key));
    if (!order) { console.warn("Pesanan tidak ditemukan."); return; }
    cetakStrukThermal(order.customer_name, order.phone, order.items, order.grand_total, order.payment_method || 'Online', order.grand_total, 0);
};

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

window.updateStatus = async function(key, val) {
    if (val === 'cancel' && !confirm('Batalkan pesanan ini? Stok produk akan dikembalikan.')) {
        renderTable(); // kembalikan dropdown ke nilai sebelumnya
        return;
    }

    await authReady;
    let restored;
    try {
        const { data, error } = await supabase.rpc('update_order_status', {
            p_key: String(key),
            p_status: val
        });
        if (error) throw error;
        restored = data?.stock_restored;
    } catch (e) {
        console.error('Gagal update status:', e);
        alert('Gagal mengubah status: ' + (e.message || e));
        renderTable(); // revert dropdown
        return;
    }

    const match = o => String(o.id) === String(key) || String(o.order_id) === String(key);
    cachedOrders = cachedOrders.map(o => {
        if (match(o)) { o.status = val; o.stock_restored = restored; }
        return o;
    });

    let localOrders = JSON.parse(localStorage.getItem('local_orders') || '[]');
    localOrders = localOrders.map(o => { if (match(o)) o.status = val; return o; });
    localStorage.setItem('local_orders', JSON.stringify(localOrders));

    renderSummary();
    renderTable();
};

window.updatePaymentStatus = async function(key, val) {
    await authReady;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(key));
    try {
        let q = supabase.from('orders').update({ payment_status: val });
        q = isUuid ? q.eq('id', key) : q.eq('order_id', key);
        const { error } = await q;
        if (error) throw error;
    } catch (e) {
        console.error('Gagal update payment_status:', e);
        alert('Gagal mengubah status pembayaran: ' + (e.message || e));
        renderTable(); // revert dropdown to the previous value
        return;
    }

    const match = o => String(o.id) === String(key) || String(o.order_id) === String(key);
    cachedOrders = cachedOrders.map(o => { if (match(o)) o.payment_status = val; return o; });

    let localOrders = JSON.parse(localStorage.getItem('local_orders') || '[]');
    localOrders = localOrders.map(o => { if (match(o)) o.payment_status = val; return o; });
    localStorage.setItem('local_orders', JSON.stringify(localOrders));

    renderTable();
};

window.deleteOrder = async function(key) {
    const match = o => String(o.id) === String(key) || String(o.order_id) === String(key);
    const order = cachedOrders.find(match);

    // Stok dikembalikan hanya jika belum pernah dikembalikan (belum cancel)
    const willRestore = !!order && (order.status || 'new').toLowerCase() !== 'cancel' && !order.stock_restored;
    const msg = willRestore
        ? 'Hapus pesanan ini? Stok produk akan dikembalikan.'
        : 'Hapus pesanan ini?';
    if (!confirm(msg)) return;

    await authReady;
    try {
        const { data, error } = await supabase.rpc('delete_order', { p_key: String(key) });
        if (error) throw error;

        // data.deleted === false -> tidak ada di database (mis. hanya tersimpan lokal), lanjut bersihkan tampilan
        if (data && data.skipped_items > 0) {
            alert(`Pesanan dihapus, tetapi ${data.skipped_items} produk tidak ditemukan sehingga stoknya tidak bisa dikembalikan. Cek stok produk secara manual.`);
        }
    } catch (e) {
        console.error('Gagal menghapus pesanan:', e);
        const hint = (e.code === 'PGRST202' || /delete_order/.test(e.message || ''))
            ? '\n\nPastikan fungsi SQL delete_order sudah dijalankan di Supabase.'
            : '';
        alert('Gagal menghapus pesanan: ' + (e.message || e) + hint);
        return; // jangan hilangkan dari tampilan kalau di database belum terhapus
    }

    cachedOrders = cachedOrders.filter(o => String(o.id) !== String(key) && String(o.order_id) !== String(key));
    let localOrders = JSON.parse(localStorage.getItem('local_orders') || '[]');
    localOrders = localOrders.filter(o => String(o.id) !== String(key) && String(o.order_id) !== String(key));
    localStorage.setItem('local_orders', JSON.stringify(localOrders));
    renderPeriodOptions();
    renderSummary();
    renderTable();
};

renderPeriodOptions();
loadOrders();
