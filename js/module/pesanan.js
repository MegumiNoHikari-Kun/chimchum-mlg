import { supabase, authReady } from '../supabase.js';

let cachedOrders = [];
let currentFilter = 'all';
let searchQuery = '';
let currentPage = 1;
let rowsPerPage = 10;

function rupiah(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }

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
    renderSummary(cachedOrders);
    renderTable();
};

function renderSummary(orders) {
    const counts = { all: orders.length, new: 0, disiapkan: 0, dikirim: 0, selesai: 0, cancel: 0 };
    orders.forEach(o => {
        const st = (o.status || 'new').toLowerCase();
        if (st === 'disiapkan' || st === 'sedang diproses') counts.disiapkan++;
        else if (counts[st] !== undefined) counts[st]++;
    });

    // const cards = [
    //     { key: 'all', title: 'Total', count: counts.all, defaultColor: 'text-slate-700 border-slate-200 bg-white' },
    //     { key: 'new', title: 'Baru', count: counts.new, defaultColor: 'text-amber-600 border-amber-200 bg-amber-50/50' },
    //     { key: 'disiapkan', title: 'Diproses', count: counts.disiapkan, defaultColor: 'text-blue-600 border-blue-200 bg-blue-50/50' },
    //     { key: 'dikirim', title: 'Dikirim', count: counts.dikirim, defaultColor: 'text-purple-600 border-purple-200 bg-purple-50/50' },
    //     { key: 'selesai', title: 'Selesai', count: counts.selesai, defaultColor: 'text-emerald-600 border-emerald-200 bg-emerald-50/50' },
    //     { key: 'cancel', title: 'Batal', count: counts.cancel, defaultColor: 'text-rose-600 border-rose-200 bg-rose-50/50' }
    // ];
    const cards = [
        {
            key: 'all',
            title: 'Total',
            label: 'Total Order',
            count: counts.all,
            defaultColor: 'text-slate-700 border-slate-200 bg-white',
            icon: 'fa-receipt',
            iconClass: 'bg-slate-100 text-slate-600'
        },
        {
            key: 'new',
            title: 'Baru',
            label: 'New',
            count: counts.new,
            defaultColor: 'text-amber-600 border-amber-200 bg-amber-50/50',
            icon: 'fa-bell',
            iconClass: 'bg-blue-50 text-blue-600'
        },
        {
            key: 'disiapkan',
            title: 'Diproses',
            label: 'Diproses',
            count: counts.disiapkan,
            defaultColor: 'text-blue-600 border-blue-200 bg-blue-50/50',
            icon: 'fa-fire-burner',
            iconClass: 'bg-amber-50 text-amber-600'
        },
        {
            key: 'dikirim',
            title: 'Dikirim',
            label: 'Dikirim',
            count: counts.dikirim,
            defaultColor: 'text-purple-600 border-purple-200 bg-purple-50/50',
            icon: 'fa-motorcycle',
            iconClass: 'bg-indigo-50 text-indigo-600'
        },
        {
            key: 'selesai',
            title: 'Selesai',
            label: 'Selesai',
            count: counts.selesai,
            defaultColor: 'text-emerald-600 border-emerald-200 bg-emerald-50/50',
            icon: 'fa-circle-check',
            iconClass: 'bg-emerald-50 text-emerald-600'
        },
        {
            key: 'cancel',
            title: 'Batal',
            label: 'Batal',
            count: counts.cancel,
            defaultColor: 'text-rose-600 border-rose-200 bg-rose-50/50',
            icon: 'fa-circle-xmark',
            iconClass: 'bg-red-50 text-red-600'
        }
    ];

    const container = document.getElementById('orderSummary');
    if (container) {
        container.innerHTML = cards.map(c => {
            const isActive = currentFilter === c.key;
            // If active, override border to thick/bold orange border with orange accent text/bg
            const activeStyle = isActive 
                ? 'border-2 border-orange-500 shadow-sm bg-orange-50/30 text-orange-700 font-semibold' 
                : `border border-slate-200 hover:shadow-sm ${c.defaultColor}`;

            return `
                <div onclick="filterStatus('${c.key}')" class="rounded-xl p-3 cursor-pointer transition ${activeStyle}">
                    <div class="text-[11px] font-medium text-slate-500">${c.title}</div>
                    <div class="text-lg font-bold mt-1">${c.count}</div>
                    <div class="w-9 h-9 rounded-xl flex items-center justify-center ${c.iconClass}">
                        <i class="fa-solid ${c.icon}"></i>
                    </div>
                </div>
                
            `;
        }).join('');
    }
}

window.filterStatus = function(status) {
    currentFilter = status;
    currentPage = 1; // Reset to page 1 on filter change
    renderSummary(cachedOrders); // Re-render summary to update active orange border state
    renderTable();
};

window.handleSearchInput = function(event) {
    searchQuery = (event.target.value || '').toLowerCase().trim();
    currentPage = 1; // Reset to page 1 on search
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

    let filtered = [...cachedOrders];

    // Apply Status Filter
    if (currentFilter !== 'all') {
        filtered = filtered.filter(o => {
            const st = (o.status || 'new').toLowerCase();
            if (currentFilter === 'disiapkan') return st === 'disiapkan' || st === 'sedang diproses';
            return st === currentFilter;
        });
    }

    // Apply Comprehensive Search Filter across all fields
    if (searchQuery) {
        filtered = filtered.filter(o => {
            const name = (o.customer_name || '').toLowerCase();
            const orderId = (o.order_id || '').toLowerCase();
            const idKey = String(o.id || '').toLowerCase();
            const phone = (o.phone || '').toLowerCase();
            const payment = (o.payment_method || '').toLowerCase();
            const status = (o.status || 'new').toLowerCase();
            const address = (o.address || '').toLowerCase();
            
            const tgl = o.created_at ? new Date(o.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }).toLowerCase() : '';
            const items = Array.isArray(o.items) ? o.items.map(i => `${i.nama || i.name} (${i.qty}x)`).join(', ').toLowerCase() : '';

            return name.includes(searchQuery) || 
                   orderId.includes(searchQuery) || 
                   idKey.includes(searchQuery) || 
                   phone.includes(searchQuery) || 
                   payment.includes(searchQuery) || 
                   status.includes(searchQuery) || 
                   address.includes(searchQuery) ||
                   tgl.includes(searchQuery) || 
                   items.includes(searchQuery);
        });
    }

    const totalFiltered = filtered.length;
    const totalPages = Math.ceil(totalFiltered / rowsPerPage) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIndex = (currentPage - 1) * rowsPerPage;
    const paginatedOrders = filtered.slice(startIndex, startIndex + rowsPerPage);

    if (paginatedOrders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-10 text-slate-400">Tidak ada pesanan ditemukan.</td></tr>`;
        renderPaginationControls(0, 1, 1);
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
                <td class="p-3 font-medium text-slate-700 text-xs">${o.payment_method || 'Cash'}<br><span class="font-normal text-[11px] text-slate-400">${o.address || '-'}</span></td>
                <td class="p-3">
                    <select onchange="updateStatus('${key}', this.value)" class="bg-slate-100 border border-slate-200 rounded-lg p-1.5 text-xs font-semibold cursor-pointer outline-none">
                        <option value="new" ${status === 'new' ? 'selected' : ''}>New</option>
                        <option value="disiapkan" ${status === 'disiapkan' || status === 'sedang diproses' ? 'selected' : ''}>Disiapkan</option>
                        <option value="dikirim" ${status === 'dikirim' ? 'selected' : ''}>Dikirim</option>
                        <option value="selesai" ${status === 'selesai' ? 'selected' : ''}>Selesai</option>
                        <option value="cancel" ${status === 'cancel' ? 'selected' : ''}>Cancel</option>
                    </select>
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

    renderPaginationControls(totalFiltered, currentPage, totalPages);
}

function renderPaginationControls(totalItems, page, totalPages) {
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

    paginationContainer.innerHTML = `
        <div class="flex items-center gap-2">
            <span>Menampilkan <b>${startRecord}-${endRecord}</b> dari <b>${totalItems}</b> pesanan</span>
            <select onchange="changeRowsPerPage(event)" class="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 outline-none text-xs">
                <option value="5" ${rowsPerPage === 5 ? 'selected' : ''}>5 per halaman</option>
                <option value="10" ${rowsPerPage === 10 ? 'selected' : ''}>10 per halaman</option>
                <option value="25" ${rowsPerPage === 25 ? 'selected' : ''}>25 per halaman</option>
                <option value="50" ${rowsPerPage === 50 ? 'selected' : ''}>50 per halaman</option>
            </select>
        </div>
        <div class="flex items-center gap-1">
            <button onclick="changePage(${page - 1})" ${page <= 1 ? 'disabled class="opacity-40 cursor-not-allowed"' : 'class="hover:bg-slate-100"'} class="px-3 py-1.5 border border-slate-200 rounded-lg font-medium transition">Prev</button>
            <span class="px-3 py-1.5 font-medium text-slate-700">Halaman ${page} dari ${totalPages || 1}</span>
            <button onclick="changePage(${page + 1})" ${page >= totalPages ? 'disabled class="opacity-40 cursor-not-allowed"' : 'class="hover:bg-slate-100"'} class="px-3 py-1.5 border border-slate-200 rounded-lg font-medium transition">Next</button>
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
    await authReady;
    try {
        let q = supabase.from('orders').update({ status: val });
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(key))) q = q.eq('id', key);
        else q = q.eq('order_id', key);
        await q;
    } catch(e) { console.warn(e); }
    cachedOrders = cachedOrders.map(o => {
        if (String(o.id) === String(key) || String(o.order_id) === String(key)) o.status = val;
        return o;
    });
    let localOrders = JSON.parse(localStorage.getItem('local_orders') || '[]');
    localOrders = localOrders.map(o => {
        if (String(o.id) === String(key) || String(o.order_id) === String(key)) o.status = val;
        return o;
    });
    localStorage.setItem('local_orders', JSON.stringify(localOrders));
    renderSummary(cachedOrders);
    renderTable();
};

window.deleteOrder = async function(key) {
    if (!confirm("Hapus pesanan ini?")) return;
    await authReady;
    try {
        let q = supabase.from('orders').delete();
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(key))) q = q.eq('id', key);
        else q = q.eq('order_id', key);
        await q;
    } catch(e) { console.warn(e); }
    cachedOrders = cachedOrders.filter(o => String(o.id) !== String(key) && String(o.order_id) !== String(key));
    let localOrders = JSON.parse(localStorage.getItem('local_orders') || '[]');
    localOrders = localOrders.filter(o => String(o.id) !== String(key) && String(o.order_id) !== String(key));
    localStorage.setItem('local_orders', JSON.stringify(localOrders));
    renderSummary(cachedOrders);
    renderTable();
};

loadOrders();
