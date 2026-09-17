import { supabase, authReady } from '../supabase.js';

let ingredientsData = [];
let productsData = [];
let recipesData = [];
let filterStatus = 'all';
let isDemoMode = false;
let supabaseClient = null;
let suppliersData = []; 

const appId = typeof __app_id !== 'undefined' ? __app_id : 'dimsum-master';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};

const supabaseUrl = window.SUPABASE_URL || 'https://your-supabase-project.supabase.co';
const supabaseKey = window.SUPABASE_KEY || 'your-supabase-anon-key';

window.showModal = function(title, message, icon = '💡') {
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-message').innerText = message;
    document.getElementById('modal-icon').innerText = icon;
    document.getElementById('notification-modal').classList.remove('hidden');
}

window.closeModal = function() {
    document.getElementById('notification-modal').classList.add('hidden');
}

window.switchTab = function(tabName) {
    ['recipes', 'mapping', 'calculator', 'orders', 'ingredients'].forEach(t => {
        const sec = document.getElementById(`section-${t}`);
        const btn = document.getElementById(`tab-btn-${t}`);
        if (sec) sec.classList.add('hidden');
        if (btn) btn.className = "px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-orange-600 transition";
    });
    const activeSec = document.getElementById(`section-${tabName}`);
    const activeBtn = document.getElementById(`tab-btn-${tabName}`);
    if (activeSec) activeSec.classList.remove('hidden');
    if (activeBtn) activeBtn.className = "px-3.5 py-2 rounded-xl text-xs font-semibold bg-white text-orange-600 shadow-sm transition";
    
    if (tabName === 'calculator') updateCalcProductOptions();
    if (tabName === 'mapping') renderMappingUI();
    if (tabName === 'ingredients') { renderIngredientsTable(); }
    if (tabName === 'orders') loadPurchaseOrders();
}

window.openRecipeModal = function() {
    resetRecipeForm();
    document.getElementById('recipeModal').classList.remove('hidden');
}

window.closeRecipeModal = function() {
    document.getElementById('recipeModal').classList.add('hidden');
}

async function initApp() {
    try {
        await authReady;
        if (typeof supabase !== 'undefined' && supabase.createClient) {
            supabaseClient = supabase;
        } else {
            try {
                supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);
            } catch(err) {
                isDemoMode = true;
            }
        }

        if (supabaseClient && !isDemoMode) {
            await loadDataFromSupabase();
        } else {
            isDemoMode = true;
            loadMockData();
        }
    } catch (err) {
        console.warn("⚠️ [DB DEBUG] Init error, falling back to demo:", err);
        isDemoMode = true;
        loadMockData();
    }
}

async function loadDataFromSupabase() {
    try {
        const { data: ing, error: ingErr } = await supabaseClient.from('ingredients').select('*');
        if (ingErr) console.error("❌ Error fetching ingredients:", ingErr);
        if (ing) ingredientsData = ing;

        const prodResult = await supabaseClient.from('products').select('*');
        if (prodResult.error) console.error("❌ Error fetching products:", prodResult.error);
        if (prodResult.data) productsData = prodResult.data;

        const { data: rec, error: recErr } = await supabaseClient.from('recipes').select('*');
        if (recErr) console.error("❌ Error fetching recipes:", recErr);
        if (rec) recipesData = rec;

        const { data: sup, error: supErr } = await supabaseClient.from('suppliers').select('*');
        if (supErr) console.error("❌ Error fetching suppliers:", supErr);
        if (sup) suppliersData = sup;

        updateUI();
    } catch (e) {
        console.error("❌ Supabase fetch exception:", e);
        loadMockData();
    }
}

function loadMockData() {
    ingredientsData = [
        { id: 'ing1', name: 'Ayam Fillet Dada', stock: 5000, unit: 'gram', price: 45000 },
        { id: 'ing2', name: 'Udang Kupas', stock: 2000, unit: 'gram', price: 90000 },
        { id: 'ing3', name: 'Tepung Tapioka', stock: 1500, unit: 'gram', price: 12000 },
        { id: 'ing4', name: 'Kulit Dimsum', stock: 300, unit: 'pcs', price: 250 },
        { id: 'ing5', name: 'Minyak Wijen', stock: 500, unit: 'ml', price: 35000 }
    ];
    productsData = [
        { id: 'prod_1', name: 'Lumpia Ayam Goreng', qty: 8, unit: 'pcs', stok: 3, resep_id: 'rec_1', foto: 'https://placehold.co/40' },
        { id: 'prod_2', name: 'Dimsum Udang Spesial', qty: 50, unit: 'pcs', stok: 0, resep_id: null, foto: 'https://placehold.co/40' }
    ];
    recipesData = [
        {
            id: 'rec_1',
            name: 'Standar Adonan Dasar Ayam',
            items: [
                { ingredientId: 'ing1', amount: 1000 },
                { ingredientId: 'ing3', amount: 150 },
                { ingredientId: 'ing4', amount: 4 }
            ]
        }
    ];
    suppliersData = [
        { id: 'sup_1', name: 'PT Bahan Pangan Utama', phone: '628123456789' },
        { id: 'sup_2', name: 'Toko Supplier Makmur Jaya', phone: '628987654321' }
    ];
    updateUI();
}

function updateUI() {
    const totalProdEl = document.getElementById('statTotalProducts');
    const totalRecEl = document.getElementById('statTotalRecipes');
    if (totalProdEl) totalProdEl.innerText = productsData.length;
    if (totalRecEl) totalRecEl.innerText = recipesData.length;
    
    checkLowStockProducts();
    renderRecipes();
    renderMappingUI();
    renderIngredientsTable();
    updateCalcProductOptions();
}

function checkLowStockProducts() {
    const banner = document.getElementById('lowStockAlertBanner');
    const listContainer = document.getElementById('lowStockProductsList');
    if (!banner || !listContainer) return;

    const lowStockItems = productsData.filter(p => {
        const stockVal = Number(p.stok !== undefined ? p.stok : p.stock) || 0;
        return stockVal <= 5;
    });

    if (lowStockItems.length > 0) {
        banner.classList.remove('hidden');
        listContainer.innerHTML = lowStockItems.map(p => {
            const stockVal = p.stok !== undefined ? p.stok : p.stock;
            return `
                <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold border bg-rose-100 text-rose-800 border-rose-300">
                    <i class="fa-solid fa-box-archive"></i> ${escapeHtml(p.name || p.nama)} (Stok: ${stockVal})
                </span>
            `;
        }).join('');
    } else {
        banner.classList.add('hidden');
    }
}

window.renderRecipes = function() {
    const searchInput = document.getElementById('recipeSearch');
    const query = searchInput ? (searchInput.value || '').toLowerCase() : '';
    const tbody = document.getElementById('recipeTableBody');
    if (!tbody) return;

    const filtered = recipesData.filter(rec => rec.name.toLowerCase().includes(query));
    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center py-10 text-slate-400">Belum ada master resep yang cocok.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(rec => {
        const linkedProducts = productsData.filter(p => String(p.resep_id) === String(rec.id));
        const linkedHtml = linkedProducts.length > 0 ? linkedProducts.map(p => `<span class="bg-orange-50 text-orange-700 px-2 py-0.5 rounded font-semibold text-[10px] mr-1">${escapeHtml(p.name || p.nama)}</span>`).join('') : '<span class="text-slate-400 italic">Belum ada menu</span>';
        
        const itemsList = (rec.items || []).map(item => {
            const ing = ingredientsData.find(i => String(i.id) === String(item.ingredientId));
            return `• ${ing ? escapeHtml(ing.name) : 'Bahan Terhapus'}: <strong>${item.amount} ${ing ? ing.unit : ''}</strong>`;
        }).join('<br>');

        return `
            <tr class="hover:bg-slate-50 transition">
                <td class="p-4 font-medium text-orange-600">${escapeHtml(rec.name)}</td>
                <td class="p-4 text-slate-600">${itemsList || 'Tidak ada bahan'}</td>
                <td class="p-4">${linkedHtml}</td>
                <td class="p-4 text-right space-x-2">
                    <button onclick="editRecipe('${rec.id}')" class="text-orange-600 hover:text-orange-800 font-semibold px-2.5 py-1 bg-orange-50 rounded-lg">Edit</button>
                    <button onclick="deleteRecipe('${rec.id}')" class="text-rose-600 hover:text-rose-800 font-semibold px-2.5 py-1 bg-rose-50 rounded-lg">Hapus</button>
                </td>
            </tr>
        `;
    }).join('');
}

window.renderMappingUI = function() {
    const container = document.getElementById('mapping-products-container');
    if (!container) return;

    const searchInput = document.getElementById('mappingSearch');
    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
    let filtered = productsData.filter(p => (p.name || p.nama || '').toLowerCase().includes(query));

    if (filtered.length === 0) {
        container.innerHTML = `<tr><td colspan="4" class="text-center py-10 text-slate-400">Tidak ada menu ditemukan.</td></tr>`;
        return;
    }

    container.innerHTML = filtered.map(prod => {
        const currentRecipeId = prod.resep_id || '';
        const stockVal = Number(prod.stok !== undefined ? prod.stok : prod.stock) || 0;
        let statusBadge = `<span class="bg-emerald-50 text-emerald-700 px-2.5 py-0.5 rounded-full font-semibold text-[10px]">Aman (${stockVal})</span>`;
        if (stockVal <= 0) statusBadge = `<span class="bg-rose-50 text-rose-700 px-2.5 py-0.5 rounded-full font-semibold text-[10px]">Habis (0)</span>`;
        else if (stockVal <= 5) statusBadge = `<span class="bg-amber-50 text-amber-700 px-2.5 py-0.5 rounded-full font-semibold text-[10px]">Menipis (${stockVal})</span>`;

        let selectOptions = '<option value="">-- Belum Dipilih --</option>';
        recipesData.forEach(r => {
            const isSel = String(r.id) === String(currentRecipeId) ? 'selected' : '';
            selectOptions += `<option value="${r.id}" ${isSel}>${escapeHtml(r.name)}</option>`;
        });

        return `
            <tr class="hover:bg-slate-50 transition">
                <td class="p-4"><img src="${prod.foto || prod.image || 'https://placehold.co/40'}" class="w-10 h-10 object-cover rounded-lg" onerror="this.src='https://placehold.co/40'"></td>
                <td class="p-4 font-semibold text-slate-800">${escapeHtml(prod.name || prod.nama)} (${prod.qty || 1} ${prod.unit || 'pcs'})</td>
                <td class="p-4">${statusBadge}</td>
                <td class="p-4">
                    <select id="map-select-${prod.id}" onchange="updateMenuRecipeMapping('${prod.id}')" class="border border-slate-200 rounded-xl px-3 py-2 text-xs bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-500 font-medium">
                        ${selectOptions}
                    </select>
                </td>
            </tr>
        `;
    }).join('');
}

window.updateMenuRecipeMapping = async function(productId) {
    const selectEl = document.getElementById(`map-select-${productId}`);
    if (!selectEl) return;
    const recipeId = selectEl.value ? selectEl.value : null;

    productsData = productsData.map(p => String(p.id) === String(productId) ? { ...p, resep_id: recipeId } : p);

    if (supabaseClient && !isDemoMode) {
        await supabaseClient.from('products').update({ resep_id: recipeId }).eq('id', productId);
    }
    renderRecipes();
    renderMappingUI();
    updateCalcProductOptions();
    showModal("Tersimpan", "Relasi menu dan resep berhasil diperbarui!", "✅");
}

function updateCalcProductOptions() {
    const select = document.getElementById('calc-product-select');
    if (!select) return;
    const currentVal = select.value;
    let html = '<option value="">-- Pilih Produk Dimsum --</option>';
    productsData.forEach(prod => {
        const selected = String(prod.id) === String(currentVal) ? 'selected' : '';
        const stockVal = prod.stok !== undefined ? prod.stok : (prod.stock !== undefined ? prod.stock : 0);
        html += `<option value="${prod.id}" ${selected}>${escapeHtml(prod.name || prod.nama)} (Stok: ${stockVal})</option>`;
    });
    select.innerHTML = html;
    window.updateCalcPreview();
}

window.updateCalcPreview = function() {
    const selectEl = document.getElementById('calc-product-select');
    const batchInput = document.getElementById('calc-batch-input');
    const tbody = document.getElementById('calc-result-tbody');
    const labelTarget = document.getElementById('calc-target-label');
    if (!selectEl || !tbody) return;

    const productId = selectEl.value;
    const batchMultiplier = batchInput ? (parseFloat(batchInput.value) || 0) : 0;

    if (!productId) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-slate-400">Silakan pilih produk dimsum terlebih dahulu.</td></tr>`;
        if (labelTarget) labelTarget.innerText = "Menunggu pilihan produk...";
        return;
    }

    const prod = productsData.find(p => String(p.id) === String(productId));
    const recipe = prod && prod.resep_id ? recipesData.find(r => String(r.id) === String(prod.resep_id)) : null;

    if (!recipe) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-amber-600">Belum ada resep yang di-link ke produk ini.</td></tr>`;
        if (labelTarget) labelTarget.innerText = "Resep belum diset";
        return;
    }

    const totalOutputPcs = batchMultiplier * (prod ? (prod.qty || 1) : 1);
    if (labelTarget) labelTarget.innerText = `Target: ${batchMultiplier} Batch (~${totalOutputPcs} ${prod?.unit || 'pcs'})`;

    tbody.innerHTML = (recipe.items || []).map(item => {
        const ing = ingredientsData.find(i => String(i.id) === String(item.ingredientId));
        const name = ing ? escapeHtml(ing.name) : 'Bahan Dihapus';
        const unit = ing ? ing.unit : '';
        const currentStock = ing ? Number(ing.stock) : 0;
        const totalNeeded = item.amount * batchMultiplier;
        const shortage = totalNeeded - currentStock;

        let statusBadge = shortage <= 0 ? 
            `<span class="bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full font-semibold border border-emerald-200">Aman</span>` :
            `<span class="bg-rose-50 text-rose-700 px-2.5 py-1 rounded-full font-semibold border border-rose-200">Kurang: ${shortage.toFixed(1)} ${unit}</span>`;

        return `
            <tr class="hover:bg-slate-50 transition">
                <td class="p-4 font-medium text-slate-800">${name}</td>
                <td class="p-4 font-bold text-orange-600">${totalNeeded.toFixed(1)} ${unit}</td>
                <td class="p-4 text-slate-600">${currentStock} ${unit}</td>
                <td class="p-4">${statusBadge}</td>
            </tr>
        `;
    }).join('');
}

window.exportShoppingList = function() {
    const selectEl = document.getElementById('calc-product-select');
    const batchInput = document.getElementById('calc-batch-input');
    if (!selectEl || !selectEl.value) {
        showModal("Perhatian", "Pilih produk terlebih dahulu.", "⚠️");
        return;
    }
    const prod = productsData.find(p => String(p.id) === String(selectEl.value));
    const recipe = prod && prod.resep_id ? recipesData.find(r => String(r.id) === String(prod.resep_id)) : null;
    const batchMultiplier = parseFloat(batchInput.value) || 1;

    let text = `📋 DAFTAR BELANJA & RESTOK DIMSUM\nMenu: ${prod?.name || prod?.nama}\nJumlah: ${batchMultiplier} Batch\n------------------------------------\n`;
    (recipe?.items || []).forEach(item => {
        const ing = ingredientsData.find(i => String(i.id) === String(item.ingredientId));
        const totalNeeded = item.amount * batchMultiplier;
        const shortage = Math.max(0, totalNeeded - (ing ? Number(ing.stock) : 0));
        text += `- ${ing?.name || 'Bahan'}: Butuh ${totalNeeded.toFixed(1)} ${ing?.unit} (Kurang: ${shortage.toFixed(1)} ${ing?.unit})\n`;
    });

    const dummy = document.createElement("textarea");
    document.body.appendChild(dummy);
    dummy.value = text;
    dummy.select();
    document.execCommand("copy");
    document.body.removeChild(dummy);
    showModal("Berhasil Disalin!", "Daftar belanja telah disalin ke clipboard.", "📋");
}

window.processRestockDeduction = async function() {
    const selectEl = document.getElementById('calc-product-select');
    const batchInput = document.getElementById('calc-batch-input');
    if (!selectEl || !selectEl.value) {
        showModal("Perhatian", "Pilih produk dimsum terlebih dahulu.", "⚠️");
        return;
    }
    
    const productId = selectEl.value;
    const batchMultiplier = parseFloat(batchInput.value) || 0;
    const prod = productsData.find(p => String(p.id) === String(productId));
    const recipe = prod && prod.resep_id ? recipesData.find(r => String(r.id) === String(prod.resep_id)) : null;

    if (!recipe) {
        showModal("Perhatian", "Resep untuk produk ini belum diatur.", "⚠️");
        return;
    }

    if (!confirm(`Proses produksi ${batchMultiplier} batch ${prod.name || prod.nama}? Stok bahan baku gudang akan otomatis dikurangi.`)) return;

    for (const item of recipe.items) {
        const ing = ingredientsData.find(i => String(i.id) === String(item.ingredientId));
        if (ing) {
            const totalNeeded = item.amount * batchMultiplier;
            ing.stock = Math.max(0, Number(ing.stock) - totalNeeded);
            if (supabaseClient && !isDemoMode) {
                await supabaseClient.from('ingredients').update({ stock: ing.stock }).eq('id', ing.id);
            }
        }
    }

    if (supabaseClient && !isDemoMode) await loadDataFromSupabase();
    else updateUI();

    showModal("Berhasil Diproses!", "Stok bahan baku di gudang telah dikurangi sesuai kebutuhan resep.", "✅");
};

window.openOrderModal = function() {
    const selectEl = document.getElementById('calc-product-select');
    const batchInput = document.getElementById('calc-batch-input');
    if (!selectEl || !selectEl.value) {
        showModal("Perhatian", "Pilih produk terlebih dahulu untuk membuat order stok.", "⚠️");
        return;
    }

    const productId = selectEl.value;
    const batchMultiplier = parseFloat(batchInput.value) || 1;
    const prod = productsData.find(p => String(p.id) === String(productId));
    const recipe = prod && prod.resep_id ? recipesData.find(r => String(r.id) === String(prod.resep_id)) : null;

    if (!recipe) {
        showModal("Perhatian", "Resep untuk produk ini belum diatur.", "⚠️");
        return;
    }

    filterSupplierOptions('');
    
    const previewContainer = document.getElementById('order-items-preview');
    let itemsHtml = '';
    let hasShortage = false;

    (recipe.items || []).forEach((item, index) => {
        const ing = ingredientsData.find(i => String(i.id) === String(item.ingredientId));
        const name = ing ? ing.name : 'Bahan';
        const unit = ing ? ing.unit : '';
        const totalNeeded = item.amount * batchMultiplier;
        const currentStock = ing ? Number(ing.stock) : 0;
        const shortage = Math.max(0, totalNeeded - currentStock);

        if (shortage > 0) {
            hasShortage = true;
            itemsHtml += `
                <div class="flex items-center justify-between gap-2 p-2 bg-white rounded-xl border border-slate-200">
                    <label class="flex items-center gap-2 cursor-pointer flex-1">
                        <input type="checkbox" class="order-item-checkbox rounded text-orange-600 w-4 h-4" 
                               value="${ing ? ing.id : ''}" 
                               data-name="${escapeHtml(name)}"
                               data-qty="${shortage}"
                               data-unit="${unit}"
                               data-price="${ing?.price || 0}"
                               checked>
                        <span class="text-slate-800 font-medium">${escapeHtml(name)}</span>
                    </label>
                    <span class="text-slate-500 text-xs bg-slate-100 px-2 py-0.5 rounded-md font-semibold">
                        Kurang: ${shortage.toFixed(1)} ${unit}
                    </span>
                </div>
            `;
        }
    });

    if (!hasShortage) {
        itemsHtml = `<div class="text-emerald-600 font-semibold text-center py-2">Semua stok bahan baku aman! Tidak ada kekurangan untuk batch ini.</div>`;
    }

    previewContainer.innerHTML = itemsHtml;
    document.getElementById('orderModal').classList.remove('hidden');
};

window.filterSupplierOptions = function() {
    const query = (document.getElementById('supplierSearchInput')?.value || '').toLowerCase().trim();
    const supSelect = document.getElementById('order-supplier-select');
    const filtered = suppliersData.filter(s => (s.name || s.nama || '').toLowerCase().includes(query));
    supSelect.innerHTML = '<option value="">-- Pilih Supplier --</option>' + filtered.map(s => `
        <option value="${s.id}">${escapeHtml(s.name || s.nama)}</option>
    `).join('');
};

window.closeOrderModal = function() {
    document.getElementById('orderModal').classList.add('hidden');
};

window.submitOrder = async function(e) {
    e.preventDefault();
    const supplierId = document.getElementById('order-supplier-select').value;
    const notes = document.getElementById('order-notes').value;

    if (!supplierId) {
        showModal("Perhatian", "Pilih supplier terlebih dahulu.", "⚠️");
        return;
    }

    const checkedItems = document.querySelectorAll('.order-item-checkbox:checked');
    if (checkedItems.length === 0) {
        showModal("Perhatian", "Pilih minimal 1 bahan yang ingin di-order.", "⚠️");
        return;
    }

    let orderItems = [];
    let grandTotal = 0;

    checkedItems.forEach(cb => {
        const ingredientId = cb.value;
        const ingredientName = cb.getAttribute('data-name');
        const quantity = parseFloat(cb.getAttribute('data-qty'));
        const unit = cb.getAttribute('data-unit');
        const unitPrice = parseFloat(cb.getAttribute('data-price')) || 0;
        const subtotal = quantity * unitPrice;

        grandTotal += subtotal;
        orderItems.push({ ingredient_id: ingredientId || null, ingredient_name: ingredientName, quantity, unit, unit_price: unitPrice, subtotal });
    });

    const jakartaDateString = new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" });
    const jakartaDate = new Date(jakartaDateString);

    const newOrder = {
        id: 'po_' + Date.now(),
        supplier_id: supplierId,
        order_date: jakartaDate.toISOString(),
        status: 'pending',
        total_amount: grandTotal,
        notes: notes,
        items: orderItems
    };

    try {
        if (supabaseClient && !isDemoMode) {
            const { data: orderData, error: orderError } = await supabaseClient
                .from('purchase_orders')
                .insert([{
                    supplier_id: supplierId,
                    order_date: jakartaDate.toISOString(),
                    status: 'pending',
                    total_amount: grandTotal,
                    notes: notes
                }])
                .select()
                .single();

            if (orderError) throw orderError;

            const orderId = orderData.id;
            const itemsWithId = orderItems.map(item => ({ ...item, order_id: orderId }));

            const { error: itemsError } = await supabaseClient
                .from('purchase_order_items')
                .insert(itemsWithId);

            if (itemsError) throw itemsError;
        } else {
            let localOrders = JSON.parse(localStorage.getItem('dimsum_purchase_orders') || '[]');
            localOrders.unshift(newOrder);
            localStorage.setItem('dimsum_purchase_orders', JSON.stringify(localOrders));
        }

        closeOrderModal();
        showModal("Order Berhasil Dibuat!", `Purchase Order berhasil dicatat dengan total estimasi Rp ${grandTotal.toLocaleString('id-ID')}.`, "✅");
        switchTab('orders');
    } catch (err) {
        console.error("Gagal simpan PO:", err);
        showModal("Gagal", `Terjadi kesalahan saat menyimpan PO: ${err.message}`, "❌");
    }
};

window.loadPurchaseOrders = async function() {
    const tbody = document.getElementById('orders-table-tbody');
    let ordersList = [];

    if (supabaseClient && !isDemoMode) {
        const { data, error } = await supabaseClient.from('purchase_orders').select('*, purchase_order_items(*)');
        if (!error && data) ordersList = data;
    } else {
        ordersList = JSON.parse(localStorage.getItem('dimsum_purchase_orders') || '[]');
    }

    if (ordersList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-slate-400">Belum ada riwayat Purchase Order.</td></tr>`;
        return;
    }

    tbody.innerHTML = ordersList.map(po => {
        const sup = suppliersData.find(s => String(s.id) === String(po.supplier_id));
        const supName = sup ? (sup.name || sup.nama) : 'Supplier Umum';
        const supPhone = sup ? (sup.phone || '') : '';
        const formattedDate = new Date(po.order_date).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' });

        let statusBadge = po.status === 'completed' ? 
            `<span class="bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full font-semibold border border-emerald-200">Selesai (Closed)</span>` :
            `<span class="bg-amber-50 text-amber-700 px-2.5 py-1 rounded-full font-semibold border border-amber-200">Pending</span>`;

        const itemsArr = po.items || po.purchase_order_items || [];
        const itemsSummary = itemsArr.map(i => `• ${i.ingredient_name}: <strong>${i.quantity} ${i.unit}</strong>`).join('<br>');

        const waMessage = `Halo ${supName}, saya ingin melakukan order bahan baku berikut:\n\n` +
            itemsArr.map(i => `- ${i.ingredient_name}: *${i.quantity} ${i.unit}*`).join('\n') +
            `\n\nCatatan: ${po.notes || '-'}\nTotal Estimasi: Rp ${(po.total_amount || 0).toLocaleString('id-ID')}\nTerima kasih!`;
        const encodedWaUrl = `https://wa.me/${supPhone}?text=${encodeURIComponent(waMessage)}`;

        return `
            <tr class="hover:bg-slate-50 transition align-top">
                <td class="p-4 font-medium text-slate-800">${formattedDate} WIB</td>
                <td class="p-4 font-bold text-slate-900">${escapeHtml(supName)}</td>
                <td class="p-4">${statusBadge}</td>
                <td class="p-4 font-bold text-orange-600">Rp ${(po.total_amount || 0).toLocaleString('id-ID')}</td>
                <td class="p-4 text-slate-600">
                    <div class="mb-1 text-slate-500 italic text-[11px]">${escapeHtml(po.notes || '-')}</div>
                    <div class="text-[11px] bg-slate-50 p-2 rounded-xl border border-slate-100">${itemsSummary || 'Tidak ada item'}</div>
                </td>
                <td class="p-4 text-right space-y-1.5">
                    <a href="${encodedWaUrl}" target="_blank" class="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-xl font-semibold text-[11px] shadow-sm transition">
                        <i class="fa-brands fa-whatsapp text-sm"></i> Kirim WA
                    </a>
                    <div>
                        <button onclick="togglePOStatus('${po.id}')" class="text-xs text-orange-600 hover:underline font-semibold">Ubah Status</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
};

window.togglePOStatus = async function(poId) {
    let ordersList = [];
    if (supabaseClient && !isDemoMode) {
        const { data } = await supabaseClient.from('purchase_orders').select('*').eq('id', poId).single();
        if (data) {
            const newStatus = data.status === 'pending' ? 'completed' : 'pending';
            await supabaseClient.from('purchase_orders').update({ status: newStatus }).eq('id', poId);
        }
    } else {
        ordersList = JSON.parse(localStorage.getItem('dimsum_purchase_orders') || '[]');
        ordersList = ordersList.map(po => {
            if (po.id === poId) po.status = po.status === 'pending' ? 'completed' : 'pending';
            return po;
        });
        localStorage.setItem('dimsum_purchase_orders', JSON.stringify(ordersList));
    }
    loadPurchaseOrders();
};

window.handleIngredientSubmit = async function(e) {
    e.preventDefault();
    const id = document.getElementById('ingredient-edit-id').value || 'ing_' + Date.now();
    const name = document.getElementById('ing-name').value;
    const stock = parseFloat(document.getElementById('ing-stock').value);
    const unit = document.getElementById('ing-unit').value;
    const price = parseFloat(document.getElementById('ing-price').value) || 0;
    const payload = { id, name, stock, unit, price };

    if (supabaseClient && !isDemoMode) {
        await supabaseClient.from('ingredients').upsert([payload]);
        await loadDataFromSupabase();
    } else {
        const idx = ingredientsData.findIndex(i => String(i.id) === String(id));
        if (idx >= 0) ingredientsData[idx] = payload;
        else ingredientsData.push(payload);
        updateUI();
    }
    resetIngredientForm();
    showModal("Sukses", "Bahan baku berhasil disimpan!", "✅");
}

window.renderIngredientsTable = function() {
    const query = (document.getElementById('ingSearch')?.value || '').toLowerCase();
    const tbody = document.getElementById('ingredients-table-tbody');
    if (!tbody) return;

    const filtered = ingredientsData.filter(i => i.name.toLowerCase().includes(query));
    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-slate-400">Belum ada data bahan baku.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(ing => `
        <tr class="hover:bg-slate-50 transition">
            <td class="p-3.5 font-medium text-slate-800">${escapeHtml(ing.name)}</td>
            <td class="p-3.5 font-semibold">${ing.stock}</td>
            <td class="p-3.5 text-slate-500">${ing.unit}</td>
            <td class="p-3.5 text-slate-600">Rp ${(ing.price || 0).toLocaleString('id-ID')}</td>
            <td class="p-3.5 text-right space-x-2">
                <button onclick="editIngredient('${ing.id}')" class="text-orange-600 hover:text-orange-800 font-semibold px-2.5 py-1 bg-orange-50 rounded-lg">Edit</button>
                <button onclick="deleteIngredient('${ing.id}')" class="text-rose-600 hover:text-rose-800 font-semibold px-2.5 py-1 bg-rose-50 rounded-lg">Hapus</button>
            </td>
        </tr>
    `).join('');
}

window.editIngredient = function(id) {
    const ing = ingredientsData.find(i => String(i.id) === String(id));
    if (!ing) return;
    document.getElementById('ingredient-edit-id').value = ing.id;
    document.getElementById('ing-name').value = ing.name;
    document.getElementById('ing-stock').value = ing.stock;
    document.getElementById('ing-unit').value = ing.unit;
    document.getElementById('ing-price').value = ing.price || 0;
    document.getElementById('ingredient-form-title').innerText = "Edit Bahan Baku";
}

window.resetIngredientForm = function() {
    document.getElementById('ingredient-form').reset();
    document.getElementById('ingredient-edit-id').value = '';
    document.getElementById('ingredient-form-title').innerText = "Tambah / Edit Bahan Baku";
}

window.deleteIngredient = async function(id) {
    if (!confirm("Hapus bahan ini?")) return;
    if (supabaseClient && !isDemoMode) {
        await supabaseClient.from('ingredients').delete().eq('id', id);
        await loadDataFromSupabase();
    } else {
        ingredientsData = ingredientsData.filter(i => String(i.id) !== String(id));
        updateUI();
    }
    showModal("Terhapus", "Bahan baku berhasil dihapus.", "🗑️");
}

window.addRecipeIngredientRow = function(selectedIngId = '', amountVal = '') {
    const container = document.getElementById('recipe-ingredients-container');
    if (!container) return;
    const rowId = 'row_' + Math.random().toString(36).substring(2, 9);
    let optionsHtml = '<option value="">-- Pilih Bahan --</option>';
    ingredientsData.forEach(ing => {
        const selected = String(ing.id) === String(selectedIngId) ? 'selected' : '';
        optionsHtml += `<option value="${ing.id}" ${selected}>${escapeHtml(ing.name)} (${ing.unit})</option>`;
    });

    const div = document.createElement('div');
    div.className = 'flex items-center gap-2 bg-slate-50 p-2 rounded-xl border border-slate-100';
    div.id = rowId;
    div.innerHTML = `
        <select class="recipe-ing-select flex-1 border border-slate-200 rounded-lg p-1.5 text-xs bg-white focus:outline-none">
            ${optionsHtml}
        </select>
        <input type="number" step="any" placeholder="Jumlah" value="${amountVal}" class="recipe-ing-amount w-24 border border-slate-200 rounded-lg p-1.5 text-xs bg-white focus:outline-none">
        <button type="button" onclick="document.getElementById('${rowId}').remove()" class="text-rose-500 hover:text-rose-700 p-1 text-xs font-bold">✕</button>
    `;
    container.appendChild(div);
}

window.handleRecipeSubmit = async function(e) {
    e.preventDefault();
    const id = document.getElementById('recipe-edit-id').value || 'rec_' + Date.now();
    const name = document.getElementById('recipe-name').value;
    const itemRows = document.querySelectorAll('#recipe-ingredients-container > div');
    const items = [];

    itemRows.forEach(row => {
        const ingredientId = row.querySelector('.recipe-ing-select').value;
        const amount = parseFloat(row.querySelector('.recipe-ing-amount').value);
        if (ingredientId && !isNaN(amount)) items.push({ ingredientId, amount });
    });

    if (items.length === 0) {
        showModal("Perhatian", "Resep harus memiliki minimal 1 bahan baku.", "⚠️");
        return;
    }

    const payload = { id, name, description: name, items };
    if (supabaseClient && !isDemoMode) {
        await supabaseClient.from('recipes').upsert([payload]);
        await loadDataFromSupabase();
    } else {
        const idx = recipesData.findIndex(r => String(r.id) === String(id));
        if (idx >= 0) recipesData[idx] = payload;
        else recipesData.push(payload);
        updateUI();
    }
    closeRecipeModal();
    showModal("Sukses", "Master resep berhasil disimpan!", "✅");
}

window.editRecipe = function(id) {
    const rec = recipesData.find(r => String(r.id) === String(id));
    if (!rec) return;
    document.getElementById('recipe-edit-id').value = rec.id;
    document.getElementById('recipe-name').value = rec.name;
    document.getElementById('modalTitle').innerText = "Edit Master Resep";
    const container = document.getElementById('recipe-ingredients-container');
    if (container) {
        container.innerHTML = '';
        (rec.items || []).forEach(item => addRecipeIngredientRow(item.ingredientId, item.amount));
    }
    document.getElementById('recipeModal').classList.remove('hidden');
}

window.resetRecipeForm = function() {
    document.getElementById('recipeForm').reset();
    document.getElementById('recipe-edit-id').value = '';
    document.getElementById('modalTitle').innerText = "Buat Master Resep";
    const container = document.getElementById('recipe-ingredients-container');
    if (container) {
        container.innerHTML = '';
        addRecipeIngredientRow();
    }
}

window.deleteRecipe = async function(id) {
    if (!confirm("Hapus master resep ini?")) return;
    if (supabaseClient && !isDemoMode) {
        await supabaseClient.from('products').update({ resep_id: null }).eq('resep_id', id);
        await supabaseClient.from('recipes').delete().eq('id', id);
        await loadDataFromSupabase();
    } else {
        recipesData = recipesData.filter(r => String(r.id) !== String(id));
        productsData = productsData.map(p => String(p.resep_id) === String(id) ? { ...p, resep_id: null } : p);
        updateUI();
    }
    showModal("Terhapus", "Master resep berhasil dihapus.", "🗑️");
}

function escapeHtml(str) {
    return String(str || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

window.onload = function() {
    initApp();
    addRecipeIngredientRow();
};
