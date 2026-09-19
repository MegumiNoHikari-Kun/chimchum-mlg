import { supabase, authReady } from '../supabase.js';

let allOrders = [];
let filteredOrders = [];

let currentPage = 1;
let pageSize = 20;

let searchKeyword = '';
let statusFilter = 'all';

let selectedOrder = null;


/* =========================================================
   INIT
========================================================= */

async function initManageOrder() {
    bindEvents();
    await loadOrders();
}


/*
 * Jika DOM sudah siap, langsung init.
 * Jika belum, tunggu DOMContentLoaded.
 */
if (document.readyState === 'loading') {

    document.addEventListener(
        'DOMContentLoaded',
        initManageOrder,
        { once: true }
    );

} else {

    initManageOrder();

}


/* =========================================================
   EVENT
========================================================= */

function bindEvents() {

    const searchInput = document.getElementById('searchInput');
    const statusEl = document.getElementById('statusFilter');
    const pageSizeEl = document.getElementById('pageSize');
    const clearFilterBtn = document.getElementById('clearFilterBtn');

    if (searchInput) {
        searchInput.addEventListener('input', debounce(() => {
            searchKeyword = searchInput.value.trim().toLowerCase();
            currentPage = 1;
            applyFilters();
        }, 250));
    }

    if (statusEl) {
        statusEl.addEventListener('change', () => {
            statusFilter = statusEl.value;
            currentPage = 1;
            applyFilters();
        });
    }

    if (pageSizeEl) {
        pageSizeEl.addEventListener('change', () => {
            pageSize = Number(pageSizeEl.value) || 20;
            currentPage = 1;
            renderTable();
        });
    }

    if (clearFilterBtn) {
        clearFilterBtn.addEventListener('click', resetFilters);
    }

    /*
     * Tutup modal jika klik backdrop
     */
    ['detailModal', 'proofModal'].forEach(id => {

        const modal = document.getElementById(id);

        if (!modal) return;

        modal.addEventListener('click', event => {
            if (event.target === modal) {
                closeModal(id);
            }
        });
    });

    /*
     * ESC untuk tutup modal
     */
    document.addEventListener('keydown', event => {

        if (event.key !== 'Escape') return;

        closeModal('detailModal');
        closeModal('proofModal');
    });
}


/* =========================================================
   LOAD ORDERS
========================================================= */

window.loadOrders = loadOrders;

async function loadOrders() {

    setLoadingState();

    let orders = [];
    let supabaseSuccess = false;

    try {

        await authReady;

        console.log('[MANAGE ORDER] Loading orders...');

        const {
            data,
            error
        } = await supabase
            .from('orders')
            .select('*')
            .order('created_at', {
                ascending: false
            });

        if (error) {
            console.error('[MANAGE ORDER] Supabase error:', error);
        } else if (Array.isArray(data)) {

            orders = data;
            supabaseSuccess = true;

            console.log(
                '[MANAGE ORDER] Supabase orders:',
                data.length
            );
        }

    } catch (error) {

        console.error(
            '[MANAGE ORDER] Supabase exception:',
            error
        );
    }


    /*
     * FALLBACK LOCAL STORAGE
     */
    if (!supabaseSuccess) {

        try {

            const localOrders = JSON.parse(
                localStorage.getItem('local_orders') || '[]'
            );

            if (Array.isArray(localOrders)) {
                orders = localOrders;

                console.log(
                    '[MANAGE ORDER] LocalStorage orders:',
                    orders.length
                );
            }

        } catch (error) {

            console.error(
                '[MANAGE ORDER] localStorage error:',
                error
            );
        }
    }


    /*
     * NORMALISASI DATA
     */
    allOrders = orders
        .map(normalizeOrder)
        .sort((a, b) => {

            const dateA = new Date(a.created_at || 0).getTime();
            const dateB = new Date(b.created_at || 0).getTime();

            return dateB - dateA;
        });


    currentPage = 1;

    applyFilters();
}


/* =========================================================
   NORMALIZE ORDER
========================================================= */

function normalizeOrder(order) {

    const normalized = {
        ...order,

        order_id: String(
            order?.order_id ||
            order?.id ||
            ''
        ).trim(),

        customer_name:
            order?.customer_name ||
            order?.name ||
            '-',

        phone:
            order?.phone ||
            order?.whatsapp ||
            '-',

        address:
            order?.address ||
            order?.alamat ||
            '-',

        payment_method:
            order?.payment_method ||
            'Cash',

        payment_proof:
            order?.payment_proof ||
            '',

        status:
            normalizeStatus(order?.status),

        items:
            Array.isArray(order?.items)
                ? order.items
                : [],

        grand_total:
            Number(
                order?.grand_total ??
                order?.total_price ??
                order?.total ??
                0
            ),

        created_at:
            order?.created_at ||
            null
    };

    return normalized;
}


/* =========================================================
   NORMALIZE STATUS
========================================================= */

function normalizeStatus(status) {

    const value = String(status || 'new')
        .trim()
        .toLowerCase();

    const aliases = {
        pending: 'new',
        baru: 'new',
        diproses: 'disiapkan',
        processing: 'disiapkan',
        proses: 'disiapkan',
        shipped: 'dikirim',
        selesai: 'selesai',
        completed: 'selesai',
        complete: 'selesai',
        cancelled: 'cancel',
        canceled: 'cancel',
        batal: 'cancel'
    };

    return aliases[value] || value;
}


/* =========================================================
   FILTER
========================================================= */

function applyFilters() {

    filteredOrders = allOrders.filter(order => {

        /*
         * STATUS
         */
        if (
            statusFilter !== 'all' &&
            normalizeStatus(order.status) !== statusFilter
        ) {
            return false;
        }


        /*
         * SEARCH
         */
        if (searchKeyword) {

            const searchable = [
                order.order_id,
                order.customer_name,
                order.phone,
                order.address,
                order.payment_method,
                order.status
            ]
                .map(value => String(value || '').toLowerCase())
                .join(' ');

            if (!searchable.includes(searchKeyword)) {
                return false;
            }
        }

        return true;
    });


    /*
     * Pastikan halaman tidak melebihi total halaman
     */
    const totalPages = Math.max(
        1,
        Math.ceil(filteredOrders.length / pageSize)
    );

    if (currentPage > totalPages) {
        currentPage = totalPages;
    }

    renderSummary();
    renderTable();
    renderFilterState();
}


/* =========================================================
   SUMMARY
========================================================= */

function renderSummary() {

    const container =
        document.getElementById('summaryCards');

    if (!container) return;

    const counts = {
        total: allOrders.length,
        new: 0,
        disiapkan: 0,
        dikirim: 0,
        selesai: 0,
        cancel: 0
    };


    allOrders.forEach(order => {

        const status =
            normalizeStatus(order.status);

        if (
            Object.prototype.hasOwnProperty.call(
                counts,
                status
            )
        ) {
            counts[status]++;
        }
    });


    const cards = [
        {
            key: 'total',
            label: 'Total Order',
            icon: 'fa-receipt',
            iconClass: 'bg-slate-100 text-slate-600'
        },
        {
            key: 'new',
            label: 'New',
            icon: 'fa-bell',
            iconClass: 'bg-blue-50 text-blue-600'
        },
        {
            key: 'disiapkan',
            label: 'Diproses',
            icon: 'fa-fire-burner',
            iconClass: 'bg-amber-50 text-amber-600'
        },
        {
            key: 'dikirim',
            label: 'Dikirim',
            icon: 'fa-motorcycle',
            iconClass: 'bg-indigo-50 text-indigo-600'
        },
        {
            key: 'selesai',
            label: 'Selesai',
            icon: 'fa-circle-check',
            iconClass: 'bg-emerald-50 text-emerald-600'
        },
        {
            key: 'cancel',
            label: 'Batal',
            icon: 'fa-circle-xmark',
            iconClass: 'bg-red-50 text-red-600'
        },
        {
            key: 'filtered',
            label: 'Ditampilkan',
            icon: 'fa-filter',
            iconClass: 'bg-brand-50 text-brand-600'
        }
    ];


    container.innerHTML = cards.map(card => {

        const value =
            card.key === 'filtered'
                ? filteredOrders.length
                : counts[card.key];

        return `
            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-3.5">
                <div class="flex items-center justify-between gap-2">
                    <div>
                        <p class="text-[10px] uppercase tracking-wide font-semibold text-slate-400">
                            ${escapeHTML(card.label)}
                        </p>

                        <p class="text-xl font-bold text-slate-900 mt-1">
                            ${value}
                        </p>
                    </div>

                    <div class="w-9 h-9 rounded-xl flex items-center justify-center ${card.iconClass}">
                        <i class="fa-solid ${card.icon}"></i>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}


/* =========================================================
   TABLE
========================================================= */

function renderTable() {

    const tbody =
        document.getElementById('orderTableBody');

    const emptyState =
        document.getElementById('emptyState');

    const resultInfo =
        document.getElementById('resultInfo');

    if (!tbody) return;


    const total = filteredOrders.length;

    const totalPages = Math.max(
        1,
        Math.ceil(total / pageSize)
    );


    const start =
        (currentPage - 1) * pageSize;

    const end =
        Math.min(start + pageSize, total);

    const pageOrders =
        filteredOrders.slice(start, end);


    /*
     * RESULT INFO
     */
    if (resultInfo) {

        if (total === 0) {
            resultInfo.textContent =
                'Tidak ada pesanan.';
        } else {

            resultInfo.textContent =
                `Menampilkan ${start + 1}-${end} dari ${total} pesanan`;
        }
    }


    /*
     * EMPTY
     */
    if (pageOrders.length === 0) {

        tbody.innerHTML = '';

        if (emptyState) {
            emptyState.classList.remove('hidden');
        }

    } else {

        if (emptyState) {
            emptyState.classList.add('hidden');
        }

        tbody.innerHTML =
            pageOrders.map(renderOrderRow).join('');
    }


    renderPagination(
        total,
        totalPages,
        start,
        end
    );
}


/* =========================================================
   TABLE ROW
========================================================= */

function renderOrderRow(order) {

    const status = getStatusMeta(order.status);

    const proofAvailable =
        hasPaymentProof(order);


    const itemCount =
        Array.isArray(order.items)
            ? order.items.reduce(
                (total, item) =>
                    total +
                    Number(
                        item?.qty ||
                        item?.quantity ||
                        1
                    ),
                0
            )
            : 0;


    return `
        <tr class="hover:bg-slate-50 transition">

            <!-- PESANAN -->
            <td class="px-4 py-3 align-top">
                <div>
                    <button
                        type="button"
                        onclick="window.showOrderDetail('${escapeJS(order.order_id)}')"
                        class="font-bold text-brand-600 hover:text-brand-700 hover:underline text-left">
                        ${escapeHTML(order.order_id || '-')}
                    </button>

                    <div class="text-[11px] text-slate-400 mt-1">
                        ${itemCount} item
                    </div>
                </div>
            </td>


            <!-- PEMESAN -->
            <td class="px-4 py-3 align-top">
                <div class="font-semibold text-slate-800">
                    ${escapeHTML(order.customer_name)}
                </div>

                <div class="text-xs text-slate-400 mt-0.5">
                    ${escapeHTML(order.phone)}
                </div>

                ${
                    order.address &&
                    order.address !== '-'
                    ? `
                        <div
                            class="text-[11px] text-slate-400 mt-1 max-w-[230px] truncate"
                            title="${escapeHTML(order.address)}">
                            ${escapeHTML(order.address)}
                        </div>
                    `
                    : ''
                }
            </td>


            <!-- PEMBAYARAN -->
            <td class="px-4 py-3 align-top">

                <div class="font-medium text-slate-700">
                    ${escapeHTML(order.payment_method)}
                </div>

                ${
                    proofAvailable
                    ? `
                        <button
                            type="button"
                            onclick="window.showPaymentProof('${escapeJS(order.order_id)}')"
                            class="mt-1 text-xs text-brand-600 hover:text-brand-700 font-semibold">
                            <i class="fa-solid fa-image mr-1"></i>
                            Lihat Bukti
                        </button>
                    `
                    : `
                        <span class="text-[11px] text-slate-400">
                            Tidak ada bukti
                        </span>
                    `
                }

            </td>


            <!-- TOTAL -->
            <td class="px-4 py-3 align-top">
                <div class="font-bold text-slate-900 whitespace-nowrap">
                    Rp ${formatRupiah(order.grand_total)}
                </div>
            </td>


            <!-- STATUS -->
            <td class="px-4 py-3 align-top">
                <span class="${status.className}">
                    ${escapeHTML(status.label)}
                </span>
            </td>


            <!-- WAKTU -->
            <td class="px-4 py-3 align-top">
                <div class="text-xs font-medium text-slate-700 whitespace-nowrap">
                    ${formatDate(order.created_at)}
                </div>

                <div class="text-[11px] text-slate-400">
                    ${formatTime(order.created_at)} WIB
                </div>
            </td>


            <!-- AKSI -->
            <td class="px-4 py-3 align-top text-right">

                <button
                    type="button"
                    onclick="window.showOrderDetail('${escapeJS(order.order_id)}')"
                    class="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-slate-100 hover:bg-brand-50 hover:text-brand-600 text-slate-600 transition"
                    title="Detail">
                    <i class="fa-solid fa-eye"></i>
                </button>

                ${
                    proofAvailable
                    ? `
                        <button
                            type="button"
                            onclick="window.showPaymentProof('${escapeJS(order.order_id)}')"
                            class="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-slate-100 hover:bg-brand-50 hover:text-brand-600 text-slate-600 transition ml-1"
                            title="Bukti Pembayaran">
                            <i class="fa-solid fa-receipt"></i>
                        </button>
                    `
                    : ''
                }

            </td>

        </tr>
    `;
}


/* =========================================================
   PAGINATION
========================================================= */

function renderPagination(
    total,
    totalPages,
    start,
    end
) {

    const info =
        document.getElementById('paginationInfo');

    const pagination =
        document.getElementById('pagination');

    if (!pagination) return;


    if (info) {

        if (total === 0) {
            info.textContent = '';
        } else {

            info.textContent =
                `${start + 1}-${end} / ${total}`;
        }
    }


    if (totalPages <= 1) {

        pagination.innerHTML = '';
        return;
    }


    const buttons = [];


    /*
     * PREVIOUS
     */
    buttons.push(`
        <button
            type="button"
            onclick="window.goToPage(${currentPage - 1})"
            ${currentPage === 1 ? 'disabled' : ''}
            class="w-9 h-9 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed">
            <i class="fa-solid fa-chevron-left text-xs"></i>
        </button>
    `);


    /*
     * PAGE NUMBERS
     */
    const pages = getPaginationPages(
        currentPage,
        totalPages
    );


    pages.forEach(page => {

        if (page === '...') {

            buttons.push(`
                <span class="w-9 h-9 flex items-center justify-center text-slate-400">
                    ...
                </span>
            `);

            return;
        }


        const active =
            page === currentPage;


        buttons.push(`
            <button
                type="button"
                onclick="window.goToPage(${page})"
                class="w-9 h-9 rounded-lg border text-sm font-semibold transition
                ${
                    active
                    ? 'bg-brand-500 text-white border-brand-500'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-100'
                }">
                ${page}
            </button>
        `);
    });


    /*
     * NEXT
     */
    buttons.push(`
        <button
            type="button"
            onclick="window.goToPage(${currentPage + 1})"
            ${currentPage === totalPages ? 'disabled' : ''}
            class="w-9 h-9 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed">
            <i class="fa-solid fa-chevron-right text-xs"></i>
        </button>
    `);


    pagination.innerHTML =
        buttons.join('');
}


window.goToPage = function(page) {

    const totalPages =
        Math.max(
            1,
            Math.ceil(filteredOrders.length / pageSize)
        );


    const target =
        Number(page);


    if (
        !Number.isFinite(target) ||
        target < 1 ||
        target > totalPages
    ) {
        return;
    }


    currentPage = target;

    renderTable();


    const table =
        document.getElementById('orderTableBody');

    if (table) {
        table.closest('section')?.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
    }
};


function getPaginationPages(current, total) {

    if (total <= 7) {
        return Array.from(
            { length: total },
            (_, i) => i + 1
        );
    }


    const pages = [1];


    if (current > 4) {
        pages.push('...');
    }


    const start =
        Math.max(2, current - 1);

    const end =
        Math.min(total - 1, current + 1);


    for (let i = start; i <= end; i++) {
        pages.push(i);
    }


    if (current < total - 3) {
        pages.push('...');
    }


    pages.push(total);

    return pages;
}


/* =========================================================
   DETAIL
========================================================= */

window.showOrderDetail = function(orderId) {

    const order =
        allOrders.find(
            item =>
                String(item.order_id).toUpperCase() ===
                String(orderId).toUpperCase()
        );


    if (!order) {
        showToast('Pesanan tidak ditemukan.', 'error');
        return;
    }


    selectedOrder = order;


    const modal =
        document.getElementById('detailModal');

    const title =
        document.getElementById('detailOrderId');

    const content =
        document.getElementById('detailContent');


    if (!modal || !content) return;


    if (title) {
        title.textContent =
            order.order_id || '-';
    }


    content.innerHTML =
        renderDetailContent(order);


    openModal('detailModal');
};


/* =========================================================
   DETAIL CONTENT
========================================================= */

function renderDetailContent(order) {

    const status =
        getStatusMeta(order.status);


    const items =
        Array.isArray(order.items)
            ? order.items
            : [];


    const itemsHTML =
        items.length
            ? items.map((item, index) => {

                const name =
                    item?.nama ||
                    item?.name ||
                    item?.product_name ||
                    'Item';


                const qty =
                    Number(
                        item?.qty ||
                        item?.quantity ||
                        1
                    );


                const price =
                    Number(
                        item?.price ||
                        item?.harga ||
                        item?.unit_price ||
                        0
                    );


                const subtotal =
                    price * qty;


                return `
                    <div class="flex items-start justify-between gap-3 py-3 border-b border-slate-100 last:border-none">

                        <div class="min-w-0">
                            <div class="font-semibold text-slate-800">
                                ${escapeHTML(name)}
                            </div>

                            <div class="text-xs text-slate-400 mt-0.5">
                                ${qty} × Rp ${formatRupiah(price)}
                            </div>
                        </div>

                        <div class="font-semibold text-slate-800 whitespace-nowrap">
                            Rp ${formatRupiah(subtotal)}
                        </div>

                    </div>
                `;
            }).join('')
            : `
                <div class="py-5 text-center text-sm text-slate-400">
                    Tidak ada rincian item.
                </div>
            `;


    return `
        <div class="space-y-5">

            <!-- HEADER -->
            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">

                <div>
                    <p class="text-xs text-slate-400">
                        ID Pesanan
                    </p>

                    <p class="font-bold text-xl text-slate-900">
                        ${escapeHTML(order.order_id || '-')}
                    </p>
                </div>

                <span class="${status.className}">
                    ${escapeHTML(status.label)}
                </span>

            </div>


            <!-- CUSTOMER -->
            <div class="grid sm:grid-cols-2 gap-3">

                ${detailBox(
                    'Nama Pemesan',
                    order.customer_name
                )}

                ${detailBox(
                    'No. WhatsApp',
                    order.phone
                )}

                ${detailBox(
                    'Metode Pembayaran',
                    order.payment_method
                )}

                ${detailBox(
                    'Waktu Pemesanan',
                    formatFullDate(order.created_at)
                )}

                <div class="sm:col-span-2">
                    ${detailBox(
                        'Alamat',
                        order.address
                    )}
                </div>

            </div>


            <!-- ITEMS -->
            <div>

                <div class="flex items-center justify-between mb-2">
                    <h3 class="font-bold text-slate-900">
                        Rincian Pesanan
                    </h3>

                    <span class="text-xs text-slate-400">
                        ${items.length} jenis item
                    </span>
                </div>

                <div class="border border-slate-200 rounded-2xl px-4">
                    ${itemsHTML}
                </div>

            </div>


            <!-- TOTAL -->
            <div class="bg-brand-50 border border-brand-100 rounded-2xl p-4">

                <div class="flex items-center justify-between">

                    <span class="font-semibold text-slate-700">
                        Total Pembayaran
                    </span>

                    <span class="font-bold text-xl text-brand-600">
                        Rp ${formatRupiah(order.grand_total)}
                    </span>

                </div>

            </div>


            <!-- PAYMENT PROOF -->
            <div>

                <div class="flex items-center justify-between mb-2">

                    <h3 class="font-bold text-slate-900">
                        Bukti Pembayaran
                    </h3>

                    ${
                        hasPaymentProof(order)
                        ? `
                            <button
                                type="button"
                                onclick="window.showPaymentProof('${escapeJS(order.order_id)}')"
                                class="text-xs text-brand-600 font-semibold hover:text-brand-700">
                                Buka
                                <i class="fa-solid fa-arrow-up-right-from-square ml-1"></i>
                            </button>
                        `
                        : ''
                    }

                </div>

                ${
                    renderProofPreview(order)
                }

            </div>


            <!-- STATUS UPDATE -->
            <div class="pt-4 border-t border-slate-200">

                <label class="block text-xs font-semibold text-slate-500 mb-2">
                    Ubah Status Pesanan
                </label>

                <div class="flex flex-col sm:flex-row gap-2">

                    <select
                        id="detailStatusSelect"
                        class="flex-1 px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-500">

                        ${renderStatusOptions(order.status)}

                    </select>

                    <button
                        type="button"
                        onclick="window.updateOrderStatus()"
                        class="px-5 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold text-sm transition">
                        <i class="fa-solid fa-floppy-disk mr-1"></i>
                        Simpan Status
                    </button>

                </div>

            </div>

        </div>
    `;
}


/* =========================================================
   DETAIL BOX
========================================================= */

function detailBox(label, value) {

    return `
        <div class="bg-slate-50 rounded-xl border border-slate-100 p-3">

            <p class="text-[10px] uppercase tracking-wide font-semibold text-slate-400">
                ${escapeHTML(label)}
            </p>

            <p class="text-sm font-semibold text-slate-800 mt-1 break-words">
                ${escapeHTML(value || '-')}
            </p>

        </div>
    `;
}


/* =========================================================
   STATUS OPTIONS
========================================================= */

function renderStatusOptions(currentStatus) {

    const statuses = [
        ['new', 'New'],
        ['disiapkan', 'Diproses'],
        ['dikirim', 'Dikirim'],
        ['selesai', 'Selesai'],
        ['cancel', 'Batal']
    ];


    return statuses.map(([value, label]) => `
        <option
            value="${value}"
            ${value === normalizeStatus(currentStatus) ? 'selected' : ''}>
            ${label}
        </option>
    `).join('');
}


/* =========================================================
   UPDATE STATUS
========================================================= */

window.updateOrderStatus = async function() {

    if (!selectedOrder) {
        return;
    }


    const select =
        document.getElementById(
            'detailStatusSelect'
        );


    if (!select) return;


    const newStatus =
        normalizeStatus(select.value);


    const oldStatus =
        normalizeStatus(selectedOrder.status);


    if (newStatus === oldStatus) {

        showToast(
            'Status tidak berubah.',
            'info'
        );

        return;
    }


    const button =
        document.querySelector(
            '#detailContent button[onclick="window.updateOrderStatus()"]'
        );


    if (button) {
        button.disabled = true;
        button.innerHTML =
            '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Menyimpan...';
    }


    let updated = false;


    /*
     * UPDATE SUPABASE
     */
    try {

        await authReady;


        const {
            error
        } = await supabase
            .from('orders')
            .update({
                status: newStatus
            })
            .eq(
                'order_id',
                selectedOrder.order_id
            );


        if (error) {

            console.error(
                '[MANAGE ORDER] Update error:',
                error
            );

        } else {

            updated = true;

            console.log(
                '[MANAGE ORDER] Status updated:',
                selectedOrder.order_id,
                newStatus
            );
        }

    } catch (error) {

        console.error(
            '[MANAGE ORDER] Update exception:',
            error
        );
    }


    /*
     * LOCAL STORAGE
     *
     * Jika Supabase gagal, tetap update lokal.
     */
    if (!updated) {

        try {

            const localOrders =
                JSON.parse(
                    localStorage.getItem(
                        'local_orders'
                    ) || '[]'
                );


            if (Array.isArray(localOrders)) {

                const index =
                    localOrders.findIndex(
                        item =>
                            String(
                                item?.order_id || ''
                            ).toUpperCase() ===
                            String(
                                selectedOrder.order_id
                            ).toUpperCase()
                    );


                if (index !== -1) {

                    localOrders[index].status =
                        newStatus;


                    localStorage.setItem(
                        'local_orders',
                        JSON.stringify(localOrders)
                    );


                    updated = true;
                }
            }

        } catch (error) {

            console.error(
                '[MANAGE ORDER] Local update error:',
                error
            );
        }
    }


    if (!updated) {

        if (button) {
            button.disabled = false;
            button.innerHTML =
                '<i class="fa-solid fa-floppy-disk mr-1"></i> Simpan Status';
        }


        showToast(
            'Gagal mengubah status pesanan.',
            'error'
        );

        return;
    }


    /*
     * UPDATE STATE LOCAL
     */
    selectedOrder.status =
        newStatus;


    const target =
        allOrders.find(
            order =>
                String(order.order_id).toUpperCase() ===
                String(selectedOrder.order_id).toUpperCase()
        );


    if (target) {
        target.status = newStatus;
    }


    applyFilters();


    /*
     * Render kembali detail agar badge ikut berubah
     */
    const detailContent =
        document.getElementById('detailContent');

    if (detailContent) {
        detailContent.innerHTML =
            renderDetailContent(selectedOrder);
    }


    showToast(
        'Status pesanan berhasil diperbarui.',
        'success'
    );
};


/* =========================================================
   PAYMENT PROOF
========================================================= */

window.showPaymentProof = function(orderId) {

    const order =
        allOrders.find(
            item =>
                String(item.order_id).toUpperCase() ===
                String(orderId).toUpperCase()
        );


    if (!order) {

        showToast(
            'Pesanan tidak ditemukan.',
            'error'
        );

        return;
    }


    const modal =
        document.getElementById('proofModal');

    const title =
        document.getElementById('proofOrderId');

    const content =
        document.getElementById('proofContent');


    if (!modal || !content) return;


    if (title) {
        title.textContent =
            order.order_id || '-';
    }


    content.innerHTML =
        renderProofModal(order);


    openModal('proofModal');
};


/* =========================================================
   PROOF PREVIEW
========================================================= */

function renderProofPreview(order) {

    if (!hasPaymentProof(order)) {

        return `
            <div class="bg-slate-50 border border-slate-100 rounded-2xl p-8 text-center">

                <div class="w-12 h-12 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-2">
                    <i class="fa-solid fa-image"></i>
                </div>

                <p class="text-sm font-medium text-slate-500">
                    Belum ada bukti pembayaran
                </p>

            </div>
        `;
    }


    const proof =
        String(order.payment_proof);


    if (isImageData(proof)) {

        return `
            <button
                type="button"
                onclick="window.showPaymentProof('${escapeJS(order.order_id)}')"
                class="block w-full group">

                <div class="rounded-2xl overflow-hidden border border-slate-200 bg-slate-50">

                    <img
                        src="${escapeAttribute(proof)}"
                        alt="Bukti pembayaran ${escapeAttribute(order.order_id)}"
                        class="w-full max-h-72 object-contain group-hover:scale-[1.01] transition">

                </div>

            </button>
        `;
    }


    return `
        <div class="bg-slate-50 border border-slate-200 rounded-2xl p-5">

            <div class="flex items-center gap-3">

                <div class="w-11 h-11 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center">
                    <i class="fa-solid fa-file-lines"></i>
                </div>

                <div class="min-w-0 flex-1">

                    <p class="text-sm font-semibold text-slate-800">
                        Bukti pembayaran tersedia
                    </p>

                    <p class="text-xs text-slate-400 truncate mt-0.5">
                        ${escapeHTML(proof)}
                    </p>

                </div>

                <a
                    href="${safeURL(proof)}"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="px-3 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-xs font-semibold">
                    Buka
                </a>

            </div>

        </div>
    `;
}


/* =========================================================
   PROOF MODAL
========================================================= */

function renderProofModal(order) {

    if (!hasPaymentProof(order)) {

        return `
            <div class="text-center py-12 text-slate-400">

                <i class="fa-solid fa-image-slash text-3xl mb-3"></i>

                <p class="font-medium">
                    Tidak ada bukti pembayaran.
                </p>

            </div>
        `;
    }


    const proof =
        String(order.payment_proof);


    if (isImageData(proof)) {

        return `
            <div class="w-full">

                <div class="bg-slate-100 rounded-2xl p-3 border border-slate-200">

                    <img
                        src="${escapeAttribute(proof)}"
                        alt="Bukti pembayaran"
                        class="w-full max-h-[70vh] object-contain rounded-xl">

                </div>

                <div class="mt-3 text-center">

                    <a
                        href="${escapeAttribute(proof)}"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="inline-flex items-center gap-2 text-sm text-brand-600 font-semibold hover:text-brand-700">
                        <i class="fa-solid fa-up-right-from-square"></i>
                        Buka gambar di tab baru
                    </a>

                </div>

            </div>
        `;
    }


    return `
        <div class="w-full">

            <div class="bg-slate-50 rounded-2xl border border-slate-200 p-6 text-center">

                <div class="w-16 h-16 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center mx-auto mb-4 text-2xl">
                    <i class="fa-solid fa-file-lines"></i>
                </div>

                <p class="font-semibold text-slate-800 mb-1">
                    File bukti pembayaran
                </p>

                <div class="mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white max-h-48 flex items-center justify-center">
                  <img src="${escapeHTML(proof)}" alt="Bukti Pembayaran" class="w-full h-full object-cover">
              </div>
      
              <div class="w-16 h-16 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center mx-auto mb-4 text-2xl">
                  <i class="fa-solid fa-file-lines"></i>
              </div>

                <a
                    href="${safeURL(proof)}"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold">
                    <i class="fa-solid fa-arrow-up-right-from-square"></i>
                    Buka Bukti Pembayaran
                </a>

            </div>

        </div>
    `;
}


/* =========================================================
   HAS PAYMENT PROOF
========================================================= */

function hasPaymentProof(order) {

    const proof =
        String(
            order?.payment_proof || ''
        ).trim();


    if (!proof) {
        return false;
    }


    const normalized =
        proof.toLowerCase();


    return ![
        'pending / cash',
        'pending',
        'cash',
        '-',
        'null',
        'undefined'
    ].includes(normalized);
}


/* =========================================================
   IMAGE DATA
========================================================= */

function isImageData(value) {

    return String(value || '')
        .trim()
        .toLowerCase()
        .startsWith('data:image/');
}


/* =========================================================
   STATUS META
========================================================= */

function getStatusMeta(status) {

    const value =
        normalizeStatus(status);


    const map = {

        new: {
            label: 'New',
            className:
                'inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-blue-100 text-blue-700'
        },

        disiapkan: {
            label: 'Diproses',
            className:
                'inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-amber-100 text-amber-700'
        },

        dikirim: {
            label: 'Dikirim',
            className:
                'inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-indigo-100 text-indigo-700'
        },

        selesai: {
            label: 'Selesai',
            className:
                'inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-emerald-100 text-emerald-700'
        },

        cancel: {
            label: 'Batal',
            className:
                'inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-red-100 text-red-700'
        }
    };


    return map[value] || {
        label: value || '-',
        className:
            'inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-slate-100 text-slate-600'
    };
}


/* =========================================================
   MODAL
========================================================= */

window.closeModal = function(id) {

    const modal =
        document.getElementById(id);

    if (!modal) return;

    modal.classList.add('hidden');
    modal.classList.remove('flex');
};


function openModal(id) {

    const modal =
        document.getElementById(id);

    if (!modal) return;

    modal.classList.remove('hidden');
    modal.classList.add('flex');

    document.body.classList.add('overflow-hidden');
}


window.closeAllModals = function() {

    closeModal('detailModal');
    closeModal('proofModal');

    document.body.classList.remove(
        'overflow-hidden'
    );
};


/*
 * Pastikan body kembali normal ketika modal ditutup
 */
const originalCloseModal =
    window.closeModal;

window.closeModal = function(id) {

    originalCloseModal(id);

    const detail =
        document.getElementById('detailModal');

    const proof =
        document.getElementById('proofModal');


    const anyOpen =
        detail &&
        !detail.classList.contains('hidden')
        ||
        proof &&
        !proof.classList.contains('hidden');


    if (!anyOpen) {
        document.body.classList.remove(
            'overflow-hidden'
        );
    }
};


/* =========================================================
   FILTER STATE
========================================================= */

function renderFilterState() {

    const button =
        document.getElementById(
            'clearFilterBtn'
        );


    if (!button) return;


    const active =
        searchKeyword ||
        statusFilter !== 'all';


    button.classList.toggle(
        'hidden',
        !active
    );
}


/* =========================================================
   RESET FILTER
========================================================= */

function resetFilters() {

    searchKeyword = '';
    statusFilter = 'all';
    currentPage = 1;


    const search =
        document.getElementById('searchInput');

    const status =
        document.getElementById('statusFilter');


    if (search) {
        search.value = '';
    }


    if (status) {
        status.value = 'all';
    }


    applyFilters();
}


window.resetOrderFilters =
    resetFilters;


/* =========================================================
   LOADING
========================================================= */

function setLoadingState() {

    const tbody =
        document.getElementById(
            'orderTableBody'
        );


    const resultInfo =
        document.getElementById(
            'resultInfo'
        );


    if (resultInfo) {
        resultInfo.textContent =
            'Memuat pesanan...';
    }


    if (tbody) {

        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="px-4 py-16 text-center">

                    <div class="text-slate-400">

                        <i class="fa-solid fa-spinner fa-spin text-2xl text-brand-500 mb-3"></i>

                        <p class="text-sm font-medium">
                            Memuat pesanan...
                        </p>

                    </div>

                </td>
            </tr>
        `;
    }
}


/* =========================================================
   DATE FORMAT
========================================================= */

function formatDate(value) {

    if (!value) return '-';


    const date =
        new Date(value);


    if (Number.isNaN(date.getTime())) {
        return '-';
    }


    return date.toLocaleDateString(
        'id-ID',
        {
            timeZone: 'Asia/Jakarta',
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        }
    );
}


function formatTime(value) {

    if (!value) return '-';


    const date =
        new Date(value);


    if (Number.isNaN(date.getTime())) {
        return '-';
    }


    return date.toLocaleTimeString(
        'id-ID',
        {
            timeZone: 'Asia/Jakarta',
            hour: '2-digit',
            minute: '2-digit'
        }
    );
}


function formatFullDate(value) {

    if (!value) return '-';


    const date =
        new Date(value);


    if (Number.isNaN(date.getTime())) {
        return '-';
    }


    return date.toLocaleString(
        'id-ID',
        {
            timeZone: 'Asia/Jakarta',
            day: '2-digit',
            month: 'long',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }
    ) + ' WIB';
}


/* =========================================================
   RUPIAH
========================================================= */

function formatRupiah(value) {

    return Number(
        value || 0
    ).toLocaleString(
        'id-ID'
    );
}


/* =========================================================
   TOAST
========================================================= */

function showToast(message, type = 'info') {

    const existing =
        document.getElementById(
            'manageOrderToast'
        );


    if (existing) {
        existing.remove();
    }


    const colors = {

        success:
            'bg-emerald-600',

        error:
            'bg-red-600',

        info:
            'bg-slate-800',

        warning:
            'bg-amber-600'
    };


    const icons = {

        success:
            'fa-circle-check',

        error:
            'fa-circle-xmark',

        info:
            'fa-circle-info',

        warning:
            'fa-triangle-exclamation'
    };


    const toast =
        document.createElement('div');


    toast.id =
        'manageOrderToast';


    toast.className =
        `fixed bottom-5 right-5 z-[100] ${colors[type] || colors.info} text-white px-4 py-3 rounded-xl shadow-xl flex items-center gap-2 text-sm font-medium max-w-sm`;


    toast.innerHTML = `
        <i class="fa-solid ${icons[type] || icons.info}"></i>
        <span>${escapeHTML(message)}</span>
    `;


    document.body.appendChild(toast);


    setTimeout(() => {

        toast.style.opacity = '0';
        toast.style.transform =
            'translateY(8px)';
        toast.style.transition =
            'all .2s ease';


        setTimeout(() => {
            toast.remove();
        }, 220);

    }, 3000);
}


/* =========================================================
   DEBOUNCE
========================================================= */

function debounce(fn, delay = 250) {

    let timer;


    return function (...args) {

        clearTimeout(timer);


        timer = setTimeout(() => {
            fn.apply(this, args);
        }, delay);
    };
}


/* =========================================================
   ESCAPE HTML
========================================================= */

function escapeHTML(value) {

    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}


/* =========================================================
   ESCAPE ATTRIBUTE
========================================================= */

function escapeAttribute(value) {

    return escapeHTML(value);
}


/* =========================================================
   ESCAPE JS STRING
========================================================= */

function escapeJS(value) {

    return String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"')
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n');
}


/* =========================================================
   SAFE URL
========================================================= */

function safeURL(value) {

    const raw =
        String(value || '').trim();


    /*
     * Data image diperbolehkan karena digunakan
     * sebagai gambar.
     */
    if (
        raw.toLowerCase().startsWith(
            'data:image/'
        )
    ) {
        return raw;
    }


    try {

        const url =
            new URL(
                raw,
                window.location.origin
            );


        const protocol =
            url.protocol.toLowerCase();


        /*
         * Hanya izinkan HTTP/HTTPS.
         */
        if (
            protocol !== 'http:' &&
            protocol !== 'https:'
        ) {
            return '#';
        }


        return url.href;

    } catch {

        return '#';
    }
}


/* =========================================================
   DEBUG API
========================================================= */

window.manageOrderState = function() {

    return {
        allOrders,
        filteredOrders,
        currentPage,
        pageSize,
        searchKeyword,
        statusFilter,
        selectedOrder
    };
};


/* =========================================================
   DELETE BUKTI TRANSFER LAMA
========================================================= */

const PAYMENT_PROOF_BUCKET = 'payment-proofs';
const DELETE_AFTER_DAYS = 30;

window.deleteOldPaymentProofs = deleteOldPaymentProofs;


async function deleteOldPaymentProofs() {

    const button =
        document.getElementById('deleteOldProofsBtn');


    try {

        await authReady;


        /*
         * Ambil order terbaru langsung dari Supabase
         */
        const {
            data: orders,
            error
        } = await supabase
            .from('orders')
            .select(
                'id, order_id, status, created_at, payment_proof'
            )
            .order('created_at', {
                ascending: true
            });


        if (error) {
            throw error;
        }


        /*
         * Batas 30 hari
         */
        const cutoffDate =
            new Date(
                Date.now() -
                DELETE_AFTER_DAYS *
                24 *
                60 *
                60 *
                1000
            );


        /*
         * CARI ORDER YANG MEMENUHI SYARAT
         *
         * status     = selesai
         * umur       > 30 hari
         * payment_proof tersedia
         */
        const eligibleOrders =
            (orders || []).filter(order => {

                const status =
                    normalizeStatus(order.status);


                const createdAt =
                    new Date(order.created_at);


                return (
                    status === 'selesai' &&
                    !Number.isNaN(createdAt.getTime()) &&
                    createdAt < cutoffDate &&
                    hasPaymentProof(order)
                );
            });


        /*
         * Tidak ada file yang perlu dihapus
         */
        if (eligibleOrders.length === 0) {

            showToast(
                'Tidak ada bukti transfer >30 hari yang memenuhi syarat.',
                'info'
            );

            return;
        }


        /*
         * KONFIRMASI
         */
        const confirmed =
            confirm(
                `Ditemukan ${eligibleOrders.length} bukti transfer yang memenuhi syarat.\n\n` +
                `Syarat:\n` +
                `• Status: Selesai\n` +
                `• Umur: lebih dari 30 hari\n` +
                `• Bukti pembayaran tersedia\n\n` +
                `File akan dihapus permanen dari Storage.\n\n` +
                `Lanjutkan?`
            );


        if (!confirmed) {
            return;
        }


        /*
         * DISABLE BUTTON
         */
        if (button) {

            button.disabled = true;

            button.innerHTML = `
                <i class="fa-solid fa-spinner fa-spin mr-2"></i>
                Menghapus...
            `;
        }


        let successCount = 0;
        let failedCount = 0;

        const failedOrders = [];


        /*
         * PROSES SATU PER SATU
         */
        for (const order of eligibleOrders) {

            try {

                console.log(
                    '[DELETE PROOF] Processing:',
                    order.order_id
                );


                /*
                 * AMBIL PATH STORAGE
                 */
                const storagePath =
                    getStoragePath(
                        order.payment_proof,
                        PAYMENT_PROOF_BUCKET
                    );


                if (!storagePath) {

                    failedCount++;

                    failedOrders.push({
                        order_id:
                            order.order_id,

                        reason:
                            'Storage path tidak ditemukan'
                    });

                    continue;
                }


                console.log(
                    '[DELETE PROOF] Storage path:',
                    storagePath
                );


                /*
                 * HAPUS FILE DARI STORAGE
                 */
                const {
                    error: storageError
                } = await supabase
                    .storage
                    .from(PAYMENT_PROOF_BUCKET)
                    .remove([
                        storagePath
                    ]);


                if (storageError) {
                    throw storageError;
                }


                /*
                 * SET payment_proof = NULL
                 */
                const {
                    error: updateError
                } = await supabase
                    .from('orders')
                    .update({
                        payment_proof: null
                    })
                    .eq(
                        'id',
                        order.id
                    );


                if (updateError) {
                    throw updateError;
                }


                successCount++;


                console.log(
                    '[DELETE PROOF] SUCCESS:',
                    order.order_id
                );

            } catch (error) {

                failedCount++;


                failedOrders.push({
                    order_id:
                        order.order_id,

                    reason:
                        error?.message ||
                        'Unknown error'
                });


                console.error(
                    '[DELETE PROOF] FAILED:',
                    order.order_id,
                    error
                );
            }
        }


        /*
         * REFRESH TABLE
         */
        await loadOrders();


        /*
         * HASIL
         */
        let message =
            `${successCount} bukti transfer berhasil dihapus.`;


        if (failedCount > 0) {

            message +=
                ` ${failedCount} gagal dihapus.`;
        }


        showToast(
            message,
            failedCount > 0
                ? 'warning'
                : 'success'
        );


        console.log(
            '================================'
        );

        console.log(
            'HAPUS BUKTI TRANSFER'
        );

        console.log(
            'Total memenuhi syarat:',
            eligibleOrders.length
        );

        console.log(
            'Berhasil:',
            successCount
        );

        console.log(
            'Gagal:',
            failedCount
        );

        console.log(
            '================================'
        );


        if (failedOrders.length > 0) {

            console.table(
                failedOrders
            );
        }


    } catch (error) {

        console.error(
            '[DELETE PROOF] ERROR:',
            error
        );


        showToast(
            error?.message ||
            'Gagal menghapus bukti transfer.',
            'error'
        );

    } finally {

        /*
         * ENABLE BUTTON KEMBALI
         */
        if (button) {

            button.disabled = false;

            button.innerHTML = `
                <i class="fa-solid fa-trash-can mr-2"></i>
                Hapus Bukti >30 Hari
            `;
        }
    }
}


/* =========================================================
   GET STORAGE PATH
========================================================= */

function getStoragePath(
    value,
    bucketName
) {

    if (!value) {
        return null;
    }


    const raw =
        String(value).trim();


    if (!raw) {
        return null;
    }


    /*
     * Data URI bukan file Storage
     */
    if (
        raw
            .toLowerCase()
            .startsWith('data:image/')
    ) {
        return null;
    }


    /*
     * Jika database menyimpan langsung path:
     *
     * ORD-123.jpg
     * 2026/09/ORD-123.jpg
     */
    if (
        !raw.startsWith('http://') &&
        !raw.startsWith('https://')
    ) {

        return raw.replace(
            /^\/+/,
            ''
        );
    }


    try {

        const url =
            new URL(raw);


        const pathname =
            decodeURIComponent(
                url.pathname
            );


        const marker =
            '/storage/v1/object/';


        const markerIndex =
            pathname.indexOf(marker);


        if (markerIndex === -1) {
            return null;
        }


        let afterMarker =
            pathname.substring(
                markerIndex +
                marker.length
            );


        /*
         * Hilangkan:
         *
         * public/
         * sign/
         * authenticated/
         */
        afterMarker =
            afterMarker.replace(
                /^(public|sign|authenticated)\//,
                ''
            );


        /*
         * Pastikan bucket benar
         */
        if (
            !afterMarker.startsWith(
                `${bucketName}/`
            )
        ) {
            return null;
        }


        /*
         * Ambil path setelah nama bucket
         */
        return afterMarker.substring(
            bucketName.length + 1
        );


    } catch (error) {

        console.error(
            '[DELETE PROOF] Invalid URL:',
            error
        );

        return null;
    }
}


// function getStoragePath(value, bucketName) {
//   if (!value) return null;

//   const raw = String(value).trim();

//   if (!raw) return null;

//   // Data URI bukan file Storage
//   if (raw.startsWith('data:image/')) {
//     return null;
//   }

//   // Kalau payment_proof sudah berupa path:
//   // contoh:
//   // ORD-123.jpg
//   // 2026/ORD-123.jpg
//   if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
//     return raw.replace(/^\/+/, '');
//   }

//   try {
//     const url = new URL(raw);
//     const pathname = decodeURIComponent(url.pathname);

//     /*
//       Contoh URL Supabase:

//       /storage/v1/object/public/payment-proofs/ORD-123.jpg

//       /storage/v1/object/sign/payment-proofs/ORD-123.jpg

//       /storage/v1/object/authenticated/payment-proofs/ORD-123.jpg
//     */

//     const marker = `/storage/v1/object/`;

//     const markerIndex = pathname.indexOf(marker);

//     if (markerIndex === -1) {
//       return null;
//     }

//     let afterMarker = pathname.substring(
//       markerIndex + marker.length
//     );

//     // Hapus tipe akses:
//     // public/
//     // sign/
//     // authenticated/
//     afterMarker = afterMarker.replace(
//       /^(public|sign|authenticated)\//,
//       ''
//     );

//     // Pastikan URL memang menuju bucket yang kita targetkan
//     if (!afterMarker.startsWith(`${bucketName}/`)) {
//       return null;
//     }

//     return afterMarker.substring(
//       bucketName.length + 1
//     );

//   } catch (error) {
//     console.error('Gagal membaca payment_proof:', error);
//     return null;
//   }
// }



/* =========================================================
   AUTO REFRESH OPTIONAL
   Tidak diaktifkan otomatis supaya tidak membebani Supabase.
========================================================= */

// Jika ingin auto refresh setiap 60 detik:
//
// setInterval(() => {
//     loadOrders();
// }, 60000);
