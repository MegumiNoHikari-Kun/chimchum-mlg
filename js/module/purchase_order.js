import { supabase, authReady } from '../supabase.js';

    // =========================================================
    // CONFIG
    // =========================================================

    const DEBUG = true;

    let purchaseOrdersData = [];
    let suppliersData = [];
    let ingredientsData = [];

    let isDemoMode = false;
    let supabaseClient = null;
    let searchDebounceTimer = null;
    let confirmResolve = null;

    // =========================================================
    // DEBUG HELPER
    // =========================================================

    function debug(...args) {
        if (DEBUG) {
            console.log(
                '%c[PO DEBUG]',
                'background:#f97316;color:white;padding:2px 6px;border-radius:4px',
                ...args
            );
        }
    }

    function debugError(title, error, extra = null) {
        console.group(
            `%c[PO ERROR] ${title}`,
            'background:#dc2626;color:white;padding:3px 8px;border-radius:4px'
        );

        console.error('Error object:', error);

        if (error) {
            console.error('code:', error.code);
            console.error('message:', error.message);
            console.error('details:', error.details);
            console.error('hint:', error.hint);
        }

        if (extra) {
            console.error('Extra:', extra);
        }

        console.groupEnd();
    }

    function getSupabaseErrorMessage(error) {
        if (!error) return 'Unknown error';

        return [
            error.message ? `Message: ${error.message}` : '',
            error.code ? `Code: ${error.code}` : '',
            error.details ? `Details: ${error.details}` : '',
            error.hint ? `Hint: ${error.hint}` : ''
        ].filter(Boolean).join('\n');
    }

    // =========================================================
    // NOTIFICATION
    // =========================================================

    window.showModal = function(title, message, icon = '💡') {
        document.getElementById('modal-title').innerText = title;
        document.getElementById('modal-message').innerText = message;
        document.getElementById('modal-icon').innerText = icon;

        document.getElementById('notification-modal')
            .classList.remove('hidden');
    };

    window.closeModal = function() {
        document.getElementById('notification-modal')
            .classList.add('hidden');
    };

    window.showToast = function(message, type = 'success') {
        const el = document.getElementById('toast');

        el.textContent = message;
        el.className = 'toast show ' + type;

        clearTimeout(el._hideTimer);

        el._hideTimer = setTimeout(() => {
            el.classList.remove('show');
        }, 3200);
    };

    // =========================================================
    // CONFIRM MODAL
    // =========================================================

    function askConfirm(title, message) {
        document.getElementById('confirm-title').innerText = title;
        document.getElementById('confirm-message').innerText = message;

        document.getElementById('confirm-modal')
            .classList.remove('hidden');

        return new Promise(resolve => {
            confirmResolve = resolve;
        });
    }

    window.closeConfirmModal = function() {
        document.getElementById('confirm-modal')
            .classList.add('hidden');

        if (confirmResolve) {
            confirmResolve(false);
            confirmResolve = null;
        }
    };

    document.getElementById('confirm-ok-btn')
        .addEventListener('click', () => {

            document.getElementById('confirm-modal')
                .classList.add('hidden');

            if (confirmResolve) {
                confirmResolve(true);
                confirmResolve = null;
            }
        });

    // =========================================================
    // INIT
    // =========================================================

    window.onload = async function() {

        debug('Application starting...');

        try {

            debug('Waiting authReady...');

            await authReady;

            debug('authReady completed');

            if (!supabase) {
                throw new Error(
                    'Supabase client tidak tersedia.'
                );
            }

            supabaseClient = supabase;

            debug('Supabase client:', supabaseClient);

            isDemoMode = false;

            await loadAllData();

            debug('Initial data loaded');

        } catch (err) {

            debugError(
                'Supabase initialization failed',
                err
            );

            isDemoMode = true;

            loadMockData();

            showModal(
                "Mode Demo",
                "Supabase tidak terhubung.\n\n" +
                getSupabaseErrorMessage(err),
                "⚠️"
            );
        }
    };

    // =========================================================
    // LOAD ALL DATA
    // =========================================================

    async function loadAllData() {

        if (!supabaseClient) {
            throw new Error('Supabase client belum siap.');
        }

        debug('Loading all data...');

        const [
            supRes,
            ingRes,
            poRes,
            itemRes
        ] = await Promise.all([

            supabaseClient
                .from('suppliers')
                .select('*'),

            supabaseClient
                .from('ingredients')
                .select('*'),

            supabaseClient
                .from('purchase_orders')
                .select('*'),

            supabaseClient
                .from('purchase_order_items')
                .select('*')
        ]);

        debug('Suppliers response:', supRes);
        debug('Ingredients response:', ingRes);
        debug('Purchase Orders response:', poRes);
        debug('PO Items response:', itemRes);

        if (supRes.error) {
            debugError(
                'Loading suppliers failed',
                supRes.error
            );
            throw supRes.error;
        }

        if (ingRes.error) {
            debugError(
                'Loading ingredients failed',
                ingRes.error
            );
            throw ingRes.error;
        }

        if (poRes.error) {
            debugError(
                'Loading purchase_orders failed',
                poRes.error
            );
            throw poRes.error;
        }

        if (itemRes.error) {
            debugError(
                'Loading purchase_order_items failed',
                itemRes.error
            );
            throw itemRes.error;
        }

        suppliersData = (supRes.data || [])
            .sort((a, b) =>
                (a.name || a.nama || '')
                    .localeCompare(b.name || b.nama || '')
            );

        ingredientsData = (ingRes.data || [])
            .sort((a, b) =>
                (a.name || '')
                    .localeCompare(b.name || '')
            );

        const itemsData = itemRes.data || [];

        purchaseOrdersData = (poRes.data || [])
            .map(po => ({
                ...po,
                items: itemsData.filter(item =>
                    String(item.order_id) === String(po.id)
                )
            }))
            .sort((a, b) =>
                new Date(b.order_date) -
                new Date(a.order_date)
            );

        debug(
            `Loaded ${purchaseOrdersData.length} purchase orders`
        );

        renderPOTable();
    }

    // =========================================================
    // MOCK DATA
    // =========================================================

    function loadMockData() {

        suppliersData = [
            {
                id: 'sup_1',
                name: 'PT Bahan Pangan Utama',
                phone: '628123456789'
            },
            {
                id: 'sup_2',
                name: 'Toko Supplier Makmur Jaya',
                phone: '628987654321'
            }
        ];

        ingredientsData = [
            {
                id: 'ing_1',
                name: 'Ayam Fillet Dada',
                unit: 'gram',
                price: 45000
            },
            {
                id: 'ing_2',
                name: 'Udang Kupas',
                unit: 'gram',
                price: 90000
            },
            {
                id: 'ing_3',
                name: 'Kulit Dimsum',
                unit: 'pcs',
                price: 250
            }
        ];

        purchaseOrdersData = [
            {
                id: 'po_1',
                supplier_id: 'sup_1',
                order_date: new Date().toISOString(),
                status: 'pending',
                total_amount: 135000,
                notes: 'Segera kirim pagi hari',
                items: [
                    {
                        ingredient_id: 'ing_1',
                        ingredient_name: 'Ayam Fillet Dada',
                        quantity: 2000,
                        unit: 'gram',
                        unit_price: 45000,
                        subtotal: 90000
                    },
                    {
                        ingredient_id: 'ing_3',
                        ingredient_name: 'Kulit Dimsum',
                        quantity: 180,
                        unit: 'pcs',
                        unit_price: 250,
                        subtotal: 45000
                    }
                ]
            }
        ];

        renderPOTable();
    }

    // =========================================================
    // SEARCH
    // =========================================================

    window.onSearchInput = function() {

        clearTimeout(searchDebounceTimer);

        searchDebounceTimer = setTimeout(
            renderPOTable,
            250
        );
    };

    // =========================================================
    // TABLE
    // =========================================================

    window.renderPOTable = function() {

        const tbody =
            document.getElementById('po-table-tbody');

        const searchVal =
            (
                document.getElementById('poSearchInput')
                    ?.value || ''
            )
            .toLowerCase()
            .trim();

        const statusFilter =
            document.getElementById('poStatusFilter')
                ?.value || 'all';

        const filtered =
            purchaseOrdersData.filter(po => {

                const sup =
                    suppliersData.find(s =>
                        String(s.id) ===
                        String(po.supplier_id)
                    );

                const supName =
                    (
                        sup
                            ? (sup.name || sup.nama)
                            : ''
                    )
                    .toLowerCase();

                const notes =
                    (po.notes || '').toLowerCase();

                const matchSearch =
                    !searchVal ||
                    supName.includes(searchVal) ||
                    notes.includes(searchVal);

                const matchStatus =
                    statusFilter === 'all' ||
                    po.status === statusFilter;

                return matchSearch && matchStatus;
            });

        document.getElementById('poResultCount')
            .innerText =
            `${filtered.length} dari ${purchaseOrdersData.length} PO`;

        if (filtered.length === 0) {

            tbody.innerHTML = `
                <tr>
                    <td colspan="6"
                        class="p-10 text-center text-slate-400">

                        <i class="fa-solid fa-inbox
                            text-2xl mb-2 block text-slate-300">
                        </i>

                        Tidak ada data Purchase Order ditemukan.

                    </td>
                </tr>
            `;

            return;
        }

        tbody.innerHTML =
            filtered.map(po => {

                const sup =
                    suppliersData.find(s =>
                        String(s.id) ===
                        String(po.supplier_id)
                    );

                const supName =
                    sup
                        ? (sup.name || sup.nama)
                        : 'Supplier Umum';

                const supPhone =
                    sup ? (sup.phone || '') : '';

                const formattedDate =
                    new Date(po.order_date)
                        .toLocaleString(
                            'id-ID',
                            {
                                timeZone: 'Asia/Jakarta',
                                dateStyle: 'medium',
                                timeStyle: 'short'
                            }
                        );

                const statusBadge =
                    po.status === 'completed'
                        ? `
                            <span
                                class="bg-emerald-50
                                text-emerald-700
                                px-2.5 py-1 rounded-full
                                font-semibold
                                border border-emerald-200">
                                Selesai
                            </span>
                          `
                        : `
                            <span
                                class="bg-amber-50
                                text-amber-700
                                px-2.5 py-1 rounded-full
                                font-semibold
                                border border-amber-200">
                                Pending
                            </span>
                          `;

                const itemsArr = po.items || [];

                const itemsSummary =
                    itemsArr.map(i => `
                        • ${escapeHtml(
                            i.ingredient_name ||
                            i.name ||
                            'Bahan'
                        )}:

                        <strong>
                            ${formatNumber(i.quantity)}
                            ${escapeHtml(i.unit || '')}
                        </strong>

                        (Rp ${Number(
                            i.subtotal || 0
                        ).toLocaleString('id-ID')})
                    `).join('<br>');

                const waLines =
                    itemsArr.map(i =>
                        `- ${i.ingredient_name ||
                        i.name ||
                        'Bahan'}: *${formatNumber(
                            i.quantity
                        )} ${i.unit || ''}*`
                    ).join('\n');

                const waMessage =
                    `Halo ${supName}, saya ingin melakukan order bahan baku:\n\n` +
                    `${waLines}\n\n` +
                    `Catatan: ${po.notes || '-'}\n` +
                    `Total: Rp ${Number(
                        po.total_amount || 0
                    ).toLocaleString('id-ID')}\n` +
                    `Terima kasih!`;

                const encodedWaUrl =
                    `https://wa.me/${supPhone}?text=${
                        encodeURIComponent(waMessage)
                    }`;

                const waButton =
                    supPhone
                        ? `
                            <a href="${encodedWaUrl}"
                               target="_blank"
                               class="inline-flex items-center
                               gap-1.5 bg-emerald-600
                               hover:bg-emerald-700
                               text-white px-3 py-1.5
                               rounded-xl font-semibold
                               text-[11px] shadow-sm transition">

                                <i class="fa-brands
                                    fa-whatsapp text-sm">
                                </i>

                                Kirim WA
                            </a>
                          `
                        : `
                            <span
                                class="inline-flex items-center
                                gap-1.5 bg-slate-100
                                text-slate-400 px-3 py-1.5
                                rounded-xl font-semibold
                                text-[11px]">

                                Tanpa No. WA
                            </span>
                          `;

                return `
                    <tr
                        class="hover:bg-slate-50
                        transition align-top"
                        id="po-row-${po.id}">

                        <td class="p-4 font-medium">
                            ${formattedDate} WIB
                        </td>

                        <td class="p-4 font-bold">
                            ${escapeHtml(supName)}
                        </td>

                        <td class="p-4">
                            ${statusBadge}
                        </td>

                        <td class="p-4 font-bold
                            text-orange-600">

                            Rp ${Number(
                                po.total_amount || 0
                            ).toLocaleString('id-ID')}

                        </td>

                        <td class="p-4 text-slate-600">

                            <div
                                class="mb-1 text-slate-500
                                italic text-[11px]">

                                ${escapeHtml(
                                    po.notes || '-'
                                )}

                            </div>

                            <div
                                class="text-[11px]
                                bg-slate-50 p-2
                                rounded-xl
                                border border-slate-100">

                                ${itemsSummary ||
                                'Tidak ada item'}

                            </div>

                        </td>

                        <td class="p-4 text-right">

                            ${waButton}

                            <div
                                class="flex justify-end
                                gap-2 pt-2">

                                <button
                                    onclick="editPO('${po.id}')"
                                    class="text-xs text-orange-600
                                    hover:underline
                                    font-semibold">

                                    Edit
                                </button>

                                <button
                                    onclick="togglePOStatus('${po.id}', this)"
                                    class="text-xs text-slate-600
                                    hover:underline
                                    font-semibold">

                                    Status
                                </button>

                                <button
                                    onclick="deletePO('${po.id}', this)"
                                    class="text-xs text-rose-600
                                    hover:underline
                                    font-semibold">

                                    Hapus
                                </button>

                            </div>

                        </td>

                    </tr>
                `;
            }).join('');
    };

    // =========================================================
    // CREATE MODAL
    // =========================================================

    window.openCreatePOModal = function() {

        document.getElementById('po-edit-id').value = '';

        document.getElementById('poModalTitle')
            .innerText =
            "Buat Purchase Order Baru";

        document.getElementById('poForm').reset();

        const nowJakarta =
            new Date(
                new Date().toLocaleString(
                    "en-US",
                    {
                        timeZone: "Asia/Jakarta"
                    }
                )
            );

        const tzOffset =
            nowJakarta.getTimezoneOffset() *
            60000;

        document.getElementById('po-order-date')
            .value =
            (
                new Date(
                    nowJakarta - tzOffset
                )
            )
            .toISOString()
            .slice(0, 16);

        document.getElementById('supplierSearchBox')
            .value = '';

        renderSupplierSelect('');

        document.getElementById('po-items-container')
            .innerHTML = '';

        addPOItemRow();

        updateSupplierPhoneWarning();
        updateLiveTotal();

        document.getElementById('poModal')
            .classList.remove('hidden');
    };

    window.closePOModal = function() {
        document.getElementById('poModal')
            .classList.add('hidden');
    };

    // =========================================================
    // SUPPLIER
    // =========================================================

    window.renderSupplierSelect = function(
        selectedId = ''
    ) {

        const select =
            document.getElementById(
                'po-supplier-select'
            );

        const search =
            (
                document.getElementById(
                    'supplierSearchBox'
                )?.value || ''
            ).toLowerCase();

        const filtered =
            suppliersData.filter(s =>
                (s.name || s.nama || '')
                    .toLowerCase()
                    .includes(search)
            );

        select.innerHTML =
            '<option value="">-- Pilih Supplier --</option>' +

            filtered.map(s => `
                <option
                    value="${s.id}"
                    ${
                        String(s.id) ===
                        String(selectedId)
                            ? 'selected'
                            : ''
                    }>

                    ${escapeHtml(
                        s.name || s.nama
                    )}

                </option>
            `).join('');
    };

    window.filterSupplierDropdown =
        function() {
            renderSupplierSelect();
        };

    document.getElementById(
        'po-supplier-select'
    ).addEventListener(
        'change',
        updateSupplierPhoneWarning
    );

    function updateSupplierPhoneWarning() {

        const supId =
            document.getElementById(
                'po-supplier-select'
            ).value;

        const sup =
            suppliersData.find(s =>
                String(s.id) === String(supId)
            );

        document.getElementById(
            'supplierNoPhoneWarning'
        ).classList.toggle(
            'hidden',
            !supId || !!(sup && sup.phone)
        );
    }

    // =========================================================
    // ITEMS
    // =========================================================

    window.addPOItemRow =
        function(ingId = '', qty = 1) {

            const container =
                document.getElementById(
                    'po-items-container'
                );

            const rowId =
                'po_row_' +
                Math.random()
                    .toString(36)
                    .substring(2, 9);

            let options =
                '<option value="">-- Pilih Bahan Baku --</option>';

            ingredientsData.forEach(ing => {

                const priceLabel =
                    ing.price
                        ? ` — Rp ${Number(
                            ing.price
                        ).toLocaleString(
                            'id-ID'
                        )}/${ing.unit}`
                        : '';

                options += `
                    <option
                        value="${ing.id}"
                        ${
                            String(ing.id) ===
                            String(ingId)
                                ? 'selected'
                                : ''
                        }>

                        ${escapeHtml(ing.name)}
                        (${escapeHtml(
                            ing.unit || ''
                        )})
                        ${priceLabel}

                    </option>
                `;
            });

            const div =
                document.createElement('div');

            div.className =
                'flex flex-col gap-1';

            div.id = rowId;

            div.innerHTML = `
                <div
                    class="flex items-center gap-2
                    bg-slate-50 p-2 rounded-xl
                    border border-slate-100">

                    <select
                        class="po-item-select flex-1
                        border border-slate-200
                        rounded-lg p-1.5 text-xs
                        bg-white">

                        ${options}

                    </select>

                    <input
                        type="number"
                        step="any"
                        min="0"
                        placeholder="Jumlah"
                        value="${qty}"
                        class="po-item-qty w-24
                        border border-slate-200
                        rounded-lg p-1.5 text-xs
                        bg-white">

                    <span
                        class="po-item-subtotal
                        text-[11px]
                        text-slate-500
                        font-semibold
                        w-24 text-right">

                        Rp 0

                    </span>

                    <button
                        type="button"
                        onclick="removePOItemRow('${rowId}')"
                        class="text-rose-500
                        hover:text-rose-700
                        p-1 text-xs font-bold">

                        ✕

                    </button>

                </div>
            `;

            container.appendChild(div);

            div.querySelector(
                '.po-item-select'
            ).addEventListener(
                'change',
                () => {
                    updateRowSubtotal(div);
                    updateLiveTotal();
                }
            );

            div.querySelector(
                '.po-item-qty'
            ).addEventListener(
                'input',
                () => {
                    updateRowSubtotal(div);
                    updateLiveTotal();
                }
            );

            updateRowSubtotal(div);
            updateLiveTotal();
        };

    window.removePOItemRow =
        function(rowId) {

            const el =
                document.getElementById(rowId);

            if (el) el.remove();

            updateLiveTotal();
        };

    function updateRowSubtotal(rowEl) {

        const ingId =
            rowEl.querySelector(
                '.po-item-select'
            ).value;

        const qty =
            parseFloat(
                rowEl.querySelector(
                    '.po-item-qty'
                ).value
            ) || 0;

        const ing =
            ingredientsData.find(i =>
                String(i.id) === String(ingId)
            );

        const price =
            ing && ing.price
                ? Number(ing.price)
                : 0;

        rowEl.querySelector(
            '.po-item-subtotal'
        ).innerText =
            `Rp ${(
                qty * price
            ).toLocaleString('id-ID')}`;
    }

    function updateLiveTotal() {

        const rows =
            document.querySelectorAll(
                '#po-items-container > div'
            );

        let total = 0;

        const chosenIds = [];

        rows.forEach(row => {

            const select =
                row.querySelector(
                    '.po-item-select'
                );

            const ingId = select.value;

            const qty =
                parseFloat(
                    row.querySelector(
                        '.po-item-qty'
                    ).value
                ) || 0;

            const ing =
                ingredientsData.find(i =>
                    String(i.id) ===
                    String(ingId)
                );

            const price =
                ing && ing.price
                    ? Number(ing.price)
                    : 0;

            total += qty * price;

            if (ingId) {
                chosenIds.push(ingId);
            }

            select.classList.remove(
                'dup-warning'
            );
        });

        const dupSet =
            new Set(
                chosenIds.filter(
                    (id, idx) =>
                        chosenIds.indexOf(id) !== idx
                )
            );

        let hasDup = false;

        rows.forEach(row => {

            const select =
                row.querySelector(
                    '.po-item-select'
                );

            if (dupSet.has(select.value)) {

                select.classList.add(
                    'dup-warning'
                );

                hasDup = true;
            }
        });

        document.getElementById(
            'dupItemWarning'
        ).classList.toggle(
            'hidden',
            !hasDup
        );

        document.getElementById(
            'po-live-total'
        ).innerText =
            `Rp ${total.toLocaleString('id-ID')}`;
    }

    // =========================================================
    // SAVE / CREATE / EDIT
    // =========================================================

    window.handlePOSubmit =
        async function(e) {

            e.preventDefault();

            const editId =
                document.getElementById(
                    'po-edit-id'
                ).value.trim();

            const supplierId =
                document.getElementById(
                    'po-supplier-select'
                ).value;

            const orderDateVal =
                document.getElementById(
                    'po-order-date'
                ).value;

            const status =
                document.getElementById(
                    'po-status-select'
                ).value;

            const notes =
                document.getElementById(
                    'po-notes'
                ).value.trim();

            debug('========== SAVE PO ==========');

            debug('editId:', editId);
            debug('supplierId:', supplierId);
            debug('orderDate:', orderDateVal);
            debug('status:', status);
            debug('notes:', notes);

            if (!supplierId) {

                showModal(
                    "Perhatian",
                    "Pilih supplier terlebih dahulu.",
                    "⚠️"
                );

                return;
            }

            if (!orderDateVal) {

                showModal(
                    "Perhatian",
                    "Tanggal order wajib diisi.",
                    "⚠️"
                );

                return;
            }

            const rows =
                document.querySelectorAll(
                    '#po-items-container > div'
                );

            const items = [];

            let grandTotal = 0;

            const seenIngredients =
                new Set();

            let duplicateFound = false;

            rows.forEach(row => {

                const ingId =
                    row.querySelector(
                        '.po-item-select'
                    ).value;

                const qty =
                    parseFloat(
                        row.querySelector(
                            '.po-item-qty'
                        ).value
                    ) || 0;

                if (ingId && qty > 0) {

                    if (
                        seenIngredients.has(
                            ingId
                        )
                    ) {
                        duplicateFound = true;
                    }

                    seenIngredients.add(
                        ingId
                    );

                    const ing =
                        ingredientsData.find(i =>
                            String(i.id) ===
                            String(ingId)
                        );

                    const unitPrice =
                        ing && ing.price
                            ? Number(ing.price)
                            : 0;

                    const subtotal =
                        qty * unitPrice;

                    grandTotal += subtotal;

                    items.push({
                        ingredient_id: ingId,
                        ingredient_name:
                            ing
                                ? ing.name
                                : 'Bahan',
                        quantity: qty,
                        unit:
                            ing
                                ? ing.unit
                                : '',
                        unit_price:
                            unitPrice,
                        subtotal:
                            subtotal
                    });
                }
            });

            if (items.length === 0) {

                showModal(
                    "Perhatian",
                    "Masukkan minimal 1 bahan baku yang valid.",
                    "⚠️"
                );

                return;
            }

            if (duplicateFound) {

                showModal(
                    "Perhatian",
                    "Ada bahan baku yang dipilih lebih dari sekali.",
                    "⚠️"
                );

                return;
            }

            const poPayload = {
                supplier_id: supplierId,
                order_date:
                    new Date(
                        orderDateVal
                    ).toISOString(),
                status: status,
                total_amount: grandTotal,
                notes: notes
            };

            debug(
                'PO payload:',
                poPayload
            );

            debug(
                'Items payload:',
                items
            );

            setSubmitLoading(true);

            try {

                if (
                    !supabaseClient ||
                    isDemoMode
                ) {
                    throw new Error(
                        'Supabase tidak aktif / sedang Demo Mode.'
                    );
                }

                let poId = editId;

                // =================================================
                // CREATE
                // =================================================

                if (!poId) {

                    debug(
                        'INSERT purchase_orders...'
                    );

                    const result =
                        await supabaseClient
                            .from(
                                'purchase_orders'
                            )
                            .insert(
                                [poPayload]
                            )
                            .select('*')
                            .single();

                    debug(
                        'INSERT result:',
                        result
                    );

                    if (result.error) {
                        debugError(
                            'INSERT purchase_orders FAILED',
                            result.error,
                            poPayload
                        );

                        throw result.error;
                    }

                    if (!result.data?.id) {
                        throw new Error(
                            'INSERT berhasil tetapi ID PO tidak dikembalikan.'
                        );
                    }

                    poId =
                        result.data.id;

                    debug(
                        'New PO ID:',
                        poId
                    );
                }

                // =================================================
                // UPDATE
                // =================================================

                else {

                    debug(
                        'UPDATE purchase_orders...',
                        {
                            id: poId,
                            payload: poPayload
                        }
                    );

                    const updateResult =
                        await supabaseClient
                            .from(
                                'purchase_orders'
                            )
                            .update(
                                poPayload
                            )
                            .eq(
                                'id',
                                poId
                            )
                            .select('*');

                    debug(
                        'UPDATE purchase_orders result:',
                        updateResult
                    );

                    if (updateResult.error) {

                        debugError(
                            'UPDATE purchase_orders FAILED',
                            updateResult.error,
                            {
                                id: poId,
                                payload: poPayload
                            }
                        );

                        throw updateResult.error;
                    }

                    /*
                     * Supabase bisa mengembalikan data []
                     * jika tidak ada SELECT policy.
                     *
                     * Jadi data.length === 0 TIDAK dianggap
                     * sebagai update gagal.
                     */

                    debug(
                        'UPDATE selesai berdasarkan error === null'
                    );

                    // =================================================
                    // DELETE OLD ITEMS
                    // =================================================

                    debug(
                        'DELETE old purchase_order_items...',
                        {
                            order_id: poId
                        }
                    );

                    const deleteItemsResult =
                        await supabaseClient
                            .from(
                                'purchase_order_items'
                            )
                            .delete()
                            .eq(
                                'order_id',
                                poId
                            );

                    debug(
                        'DELETE old items result:',
                        deleteItemsResult
                    );

                    if (
                        deleteItemsResult.error
                    ) {

                        debugError(
                            'DELETE OLD ITEMS FAILED',
                            deleteItemsResult.error,
                            {
                                order_id: poId
                            }
                        );

                        throw deleteItemsResult.error;
                    }
                }

                // =================================================
                // INSERT ITEMS
                // =================================================

                const itemsWithId =
                    items.map(item => ({
                        ...item,
                        order_id: poId
                    }));

                debug(
                    'INSERT purchase_order_items...',
                    itemsWithId
                );

                const itemResult =
                    await supabaseClient
                        .from(
                            'purchase_order_items'
                        )
                        .insert(
                            itemsWithId
                        )
                        .select('*');

                debug(
                    'INSERT items result:',
                    itemResult
                );

                if (itemResult.error) {

                    debugError(
                        'INSERT purchase_order_items FAILED',
                        itemResult.error,
                        itemsWithId
                    );

                    throw itemResult.error;
                }

                // =================================================
                // RELOAD FROM DATABASE
                // =================================================

                debug(
                    'Reloading data from database...'
                );

                await loadAllData();

                debug(
                    'Database reload successful'
                );

                closePOModal();

                showToast(
                    editId
                        ? "Purchase Order berhasil diperbarui."
                        : "Purchase Order baru berhasil dibuat.",
                    "success"
                );

            } catch (err) {

                debugError(
                    'SAVE PO FAILED',
                    err,
                    {
                        editId,
                        supplierId,
                        status,
                        poPayload
                    }
                );

                showModal(
                    "Gagal Menyimpan",
                    getSupabaseErrorMessage(err),
                    "❌"
                );

            } finally {

                setSubmitLoading(false);
            }
        };

    // =========================================================
    // SUBMIT LOADING
    // =========================================================

    function setSubmitLoading(
        isLoading
    ) {

        const btn =
            document.getElementById(
                'po-submit-btn'
            );

        const label =
            document.getElementById(
                'po-submit-label'
            );

        btn.disabled = isLoading;

        label.innerHTML =
            isLoading
                ? '<span class="spinner-sm"></span> Menyimpan...'
                : 'Simpan Purchase Order';
    }

    // =========================================================
    // EDIT
    // =========================================================

    window.editPO =
        function(poId) {

            debug(
                'EDIT PO:',
                poId
            );

            const po =
                purchaseOrdersData.find(p =>
                    String(p.id) ===
                    String(poId)
                );

            if (!po) {

                debug(
                    'PO tidak ditemukan:',
                    poId
                );

                showModal(
                    "Error",
                    "Purchase Order tidak ditemukan.",
                    "❌"
                );

                return;
            }

            document.getElementById(
                'po-edit-id'
            ).value = po.id;

            document.getElementById(
                'poModalTitle'
            ).innerText =
                "Edit Purchase Order";

            document.getElementById(
                'supplierSearchBox'
            ).value = '';

            renderSupplierSelect(
                po.supplier_id
            );

            document.getElementById(
                'po-supplier-select'
            ).value =
                po.supplier_id;

            document.getElementById(
                'po-status-select'
            ).value =
                po.status || 'pending';

            document.getElementById(
                'po-notes'
            ).value =
                po.notes || '';

            const d =
                new Date(po.order_date);

            const tzOffset =
                d.getTimezoneOffset() *
                60000;

            document.getElementById(
                'po-order-date'
            ).value =
                (
                    new Date(
                        d - tzOffset
                    )
                )
                .toISOString()
                .slice(0, 16);

            const container =
                document.getElementById(
                    'po-items-container'
                );

            container.innerHTML = '';

            (po.items || []).forEach(item => {

                addPOItemRow(
                    item.ingredient_id ||
                    item.ingredientId,
                    item.quantity
                );
            });

            if (
                (po.items || []).length === 0
            ) {
                addPOItemRow();
            }

            updateSupplierPhoneWarning();
            updateLiveTotal();

            document.getElementById(
                'poModal'
            ).classList.remove('hidden');
        };

    // =========================================================
    // STATUS UPDATE
    // =========================================================

    window.togglePOStatus =
        async function(
            poId,
            btnEl
        ) {

            debug(
                '========== STATUS UPDATE =========='
            );

            debug(
                'PO ID:',
                poId
            );

            if (!supabaseClient) {

                showModal(
                    "Error",
                    "Supabase client belum siap.",
                    "❌"
                );

                return;
            }

            const po =
                purchaseOrdersData.find(p =>
                    String(p.id) ===
                    String(poId)
                );

            if (!po) {

                showModal(
                    "Error",
                    "Purchase Order tidak ditemukan.",
                    "❌"
                );

                return;
            }

            const oldStatus =
                po.status || 'pending';

            const newStatus =
                oldStatus === 'pending'
                    ? 'completed'
                    : 'pending';

            debug(
                'Old status:',
                oldStatus
            );

            debug(
                'New status:',
                newStatus
            );

            const rowEl =
                document.getElementById(
                    'po-row-' + poId
                );

            if (rowEl) {
                rowEl.classList.add(
                    'row-busy'
                );
            }

            if (btnEl) {
                btnEl.disabled = true;
            }

            try {

                const payload = {
                    status: newStatus
                };

                debug(
                    'Sending UPDATE:',
                    {
                        table: 'purchase_orders',
                        filter: {
                            id: poId
                        },
                        payload
                    }
                );

                const result =
                    await supabaseClient
                        .from(
                            'purchase_orders'
                        )
                        .update(payload)
                        .eq(
                            'id',
                            poId
                        )
                        .select('id,status');

                debug(
                    'Supabase STATUS response:',
                    result
                );

                if (result.error) {

                    debugError(
                        'STATUS UPDATE FAILED',
                        result.error,
                        {
                            poId,
                            payload
                        }
                    );

                    throw result.error;
                }

                /*
                 * Jangan gunakan:
                 *
                 * if (!result.data.length)
                 *
                 * sebagai indikator gagal.
                 *
                 * Karena RLS SELECT dapat menyebabkan
                 * data kosong meskipun UPDATE berhasil.
                 */

                debug(
                    'STATUS UPDATE tidak menghasilkan error.'
                );

                // Update local state
                po.status = newStatus;

                renderPOTable();

                // Ambil ulang data database
                await loadAllData();

                showToast(
                    `Status PO diubah menjadi "${
                        newStatus === 'completed'
                            ? 'Selesai'
                            : 'Pending'
                    }".`,
                    "success"
                );

            } catch (err) {

                debugError(
                    'STATUS UPDATE EXCEPTION',
                    err,
                    {
                        poId,
                        oldStatus,
                        newStatus
                    }
                );

                showModal(
                    "Gagal Update Status",
                    getSupabaseErrorMessage(err),
                    "❌"
                );

                if (rowEl) {
                    rowEl.classList.remove(
                        'row-busy'
                    );
                }

            } finally {

                if (btnEl) {
                    btnEl.disabled = false;
                }
            }
        };

    // =========================================================
    // DELETE
    // =========================================================

    window.deletePO =
        async function(
            poId,
            btnEl
        ) {

            debug(
                '========== DELETE PO =========='
            );

            debug(
                'PO ID:',
                poId
            );

            const confirmed =
                await askConfirm(
                    "Hapus Purchase Order ini?",
                    "Semua rincian bahan pada PO ini juga akan terhapus. Tindakan ini tidak dapat dibatalkan."
                );

            if (!confirmed) {

                debug(
                    'Delete cancelled by user'
                );

                return;
            }

            if (!supabaseClient) {

                showModal(
                    "Error",
                    "Supabase client belum siap.",
                    "❌"
                );

                return;
            }

            const rowEl =
                document.getElementById(
                    'po-row-' + poId
                );

            if (rowEl) {
                rowEl.classList.add(
                    'row-busy'
                );
            }

            if (btnEl) {
                btnEl.disabled = true;
            }

            try {

                // =================================================
                // DELETE ITEMS
                // =================================================

                debug(
                    'Deleting purchase_order_items...',
                    {
                        order_id: poId
                    }
                );

                const itemDelete =
                    await supabaseClient
                        .from(
                            'purchase_order_items'
                        )
                        .delete()
                        .eq(
                            'order_id',
                            poId
                        );

                debug(
                    'Delete items response:',
                    itemDelete
                );

                if (itemDelete.error) {

                    debugError(
                        'DELETE ITEMS FAILED',
                        itemDelete.error,
                        {
                            order_id: poId
                        }
                    );

                    throw itemDelete.error;
                }

                // =================================================
                // DELETE PO
                // =================================================

                debug(
                    'Deleting purchase_orders...',
                    {
                        id: poId
                    }
                );

                const poDelete =
                    await supabaseClient
                        .from(
                            'purchase_orders'
                        )
                        .delete()
                        .eq(
                            'id',
                            poId
                        );

                debug(
                    'Delete PO response:',
                    poDelete
                );

                if (poDelete.error) {

                    debugError(
                        'DELETE PURCHASE ORDER FAILED',
                        poDelete.error,
                        {
                            id: poId
                        }
                    );

                    throw poDelete.error;
                }

                // =================================================
                // UPDATE LOCAL DATA
                // =================================================

                purchaseOrdersData =
                    purchaseOrdersData.filter(
                        p =>
                            String(p.id) !==
                            String(poId)
                    );

                renderPOTable();

                // =================================================
                // VERIFY / RELOAD
                // =================================================

                debug(
                    'Reloading database after DELETE...'
                );

                await loadAllData();

                const stillExists =
                    purchaseOrdersData.some(
                        p =>
                            String(p.id) ===
                            String(poId)
                    );

                if (stillExists) {

                    throw new Error(
                        'DELETE tidak terverifikasi. Data PO masih ditemukan setelah reload.'
                    );
                }

                showToast(
                    "Purchase Order berhasil dihapus.",
                    "success"
                );

            } catch (err) {

                debugError(
                    'DELETE PO FAILED',
                    err,
                    {
                        poId
                    }
                );

                showModal(
                    "Gagal Menghapus",
                    getSupabaseErrorMessage(err),
                    "❌"
                );

                if (rowEl) {
                    rowEl.classList.remove(
                        'row-busy'
                    );
                }

            } finally {

                if (btnEl) {
                    btnEl.disabled = false;
                }
            }
        };

    // =========================================================
    // HELPERS
    // =========================================================

    function escapeHtml(str) {

        return String(str || '')
            .replace(
                /&/g,
                "&amp;"
            )
            .replace(
                /</g,
                "&lt;"
            )
            .replace(
                />/g,
                "&gt;"
            )
            .replace(
                /"/g,
                "&quot;"
            );
    }

    function formatNumber(n) {

        return Number(n || 0)
            .toLocaleString('id-ID');
    }
