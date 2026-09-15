import { supabase, authReady } from '../supabase.js';

let ingredientsData = [];
let productsData = [];
let recipesData = [];
let filterStatus = 'all';
let isDemoMode = false;
let supabaseClient = null;

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
    ['recipes', 'calculator', 'ingredients'].forEach(t => {
        const sec = document.getElementById(`section-${t}`);
        const btn = document.getElementById(`tab-btn-${t}`);
        if (sec) sec.classList.add('hidden');
        if (btn) btn.className = "px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-orange-600 transition";
    });
    
    const activeSec = document.getElementById(`section-${tabName}`);
    const activeBtn = document.getElementById(`tab-btn-${tabName}`);
    if (activeSec) activeSec.classList.remove('hidden');
    if (activeBtn) activeBtn.className = "px-4 py-2 rounded-xl text-xs font-semibold bg-white text-orange-600 shadow-sm transition";

    if (tabName === 'calculator') updateCalcProductOptions();
    if (tabName === 'ingredients') {
        renderProductsSummary();
        renderProductsTable();
    }
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
        if (supabase) {
            supabaseClient = supabase;
            await loadDataFromSupabase();
        } else {
            isDemoMode = true;
            loadMockData();
        }
    } catch (err) {
        console.warn("Init error, falling back to demo:", err);
        isDemoMode = true;
        loadMockData();
    }
}

async function loadDataFromSupabase() {
    try {
        const { data: ing } = await supabaseClient.from('ingredients').select('*');
        if (ing) ingredientsData = ing;

        let prodResult = await supabaseClient.from('products').select('*');
        if (prodResult.error) {
            prodResult = await supabaseClient.from('producs').select('*');
        }
        if (prodResult.data) productsData = prodResult.data;

        const { data: rec } = await supabaseClient.from('recipes').select('*');
        if (rec) recipesData = rec;

        updateUI();
    } catch (e) {
        console.error("Supabase fetch error:", e);
        loadMockData();
    }
}

function loadMockData() {
    ingredientsData = [
        { id: 'ing1', name: 'Ayam Fillet Dada', stock: 5000, unit: 'gram' },
        { id: 'ing2', name: 'Udang Kupas', stock: 2000, unit: 'gram' },
        { id: 'ing3', name: 'Tepung Tapioka', stock: 1500, unit: 'gram' },
        { id: 'ing4', name: 'Kulit Dimsum', stock: 300, unit: 'pcs' },
        { id: 'ing5', name: 'Minyak Wijen', stock: 500, unit: 'ml' }
    ];
    productsData = [
        { id: 'prod_1', name: 'Lumpia Ayam Goreng', qty: 4, unit: 'pcs', stok: 2, foto: 'https://placehold.co/40' },
        { id: 'prod_2', name: 'Dimsum Udang Spesial', qty: 50, unit: 'pcs', stok: 0, foto: 'https://placehold.co/40' }
    ];
    recipesData = [
        {
            id: 'rec_1',
            product_id: 'prod_1',
            name: 'Standar Adonan Lumpia',
            items: [
                { ingredientId: 'ing1', amount: 1000 },
                { ingredientId: 'ing3', amount: 150 },
                { ingredientId: 'ing4', amount: 4 }
            ]
        }
    ];
    updateUI();
}

function updateUI() {
    const totalProdEl = document.getElementById('statTotalProducts');
    const totalRecEl = document.getElementById('statTotalRecipes');
    if (totalProdEl) totalProdEl.innerText = productsData.length;
    if (totalRecEl) totalRecEl.innerText = recipesData.length;
    
    checkLowStockProducts();
    updateProductDropdowns();

    renderRecipes();
    renderIngredientsTable();
    renderProductsSummary();
    renderProductsTable();
    updateCalcProductOptions();
}

function updateProductDropdowns() {
    const recipeSelect = document.getElementById('recipe-product-select');
    if (!recipeSelect) return;
    let recipeHtml = '<option value="">-- Pilih Produk dari Tabel products --</option>';
    productsData.forEach(prod => {
        const stockVal = prod.stok !== undefined ? prod.stok : (prod.stock !== undefined ? prod.stock : 0);
        recipeHtml += `<option value="${prod.id}">${escapeHtml(prod.name || prod.nama)} (Stok: ${stockVal} | Isi: ${prod.qty || 1} ${prod.unit || 'pcs'})</option>`;
    });
    recipeSelect.innerHTML = recipeHtml;
}

function checkLowStockProducts() {
    const banner = document.getElementById('lowStockAlertBanner');
    const listContainer = document.getElementById('lowStockProductsList');
    if (!banner || !listContainer) return;
    
    const lowStockItems = productsData.filter(p => {
        const currentStock = p.stok !== undefined ? Number(p.stok) : (p.stock !== undefined ? Number(p.stock) : 0);
        return currentStock <= 5;
    });

    if (lowStockItems.length > 0) {
        banner.classList.remove('hidden');
        listContainer.innerHTML = lowStockItems.map(p => {
            const stockVal = p.stok !== undefined ? p.stok : (p.stock !== undefined ? p.stock : 0);
            const badgeColor = stockVal <= 0 ? 'bg-rose-200 text-rose-900 border-rose-300' : 'bg-amber-100 text-amber-800 border-amber-200';
            return `
                <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold border ${badgeColor}">
                    <i class="fa-solid fa-box-archive"></i> ${escapeHtml(p.name || p.nama)} 
                    <span class="bg-white/80 px-1.5 py-0.5 rounded-md text-[10px]">Stok: ${stockVal}</span>
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

    const filtered = recipesData.filter(rec => {
        const prod = productsData.find(p => p.id === rec.product_id);
        const prodName = prod ? (prod.name || prod.nama || '').toLowerCase() : '';
        return rec.name.toLowerCase().includes(query) || prodName.includes(query);
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-10 text-slate-400">Belum ada master resep yang cocok.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(rec => {
        const prod = productsData.find(p => p.id === rec.product_id);
        const prodName = prod ? `${prod.name || prod.nama}` : '<span class="text-rose-500">Produk Tidak Ditemukan</span>';
        const stockVal = prod ? (prod.stok !== undefined ? Number(prod.stok) : (prod.stock !== undefined ? Number(prod.stock) : 0)) : 0;
        
        let stockBadge = '';
        if (stockVal <= 0) {
            stockBadge = `<span class="bg-rose-100 text-rose-700 px-2 py-0.5 rounded-md font-bold border border-rose-200 animate-pulse">Habis (0)</span>`;
        } else if (stockVal <= 5) {
            stockBadge = `<span class="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-md font-bold border border-amber-200">Menipis (${stockVal})</span>`;
        } else {
            stockBadge = `<span class="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-md font-semibold">${stockVal}</span>`;
        }

        const prodQty = prod ? `<span class="bg-orange-50 text-orange-700 px-2 py-0.5 rounded-md font-medium">${prod.qty || 1} ${prod.unit || 'pcs'}</span>` : '-';

        const itemsList = (rec.items || []).map(item => {
            const ing = ingredientsData.find(i => i.id === item.ingredientId);
            return `• ${ing ? escapeHtml(ing.name) : 'Bahan Terhapus'}: <strong class="text-slate-800">${item.amount} ${ing ? ing.unit : ''}</strong>`;
        }).join('<br>');

        return `
            <tr class="hover:bg-slate-50/70 transition">
                <td class="p-3.5 font-semibold text-slate-800">${escapeHtml(prodName)}</td>
                <td class="p-3.5">${stockBadge}</td>
                <td class="p-3.5">${prodQty}</td>
                <td class="p-3.5 font-medium text-orange-600">${escapeHtml(rec.name)}</td>
                <td class="p-3.5 text-slate-600 leading-relaxed">${itemsList || 'Tidak ada bahan'}</td>
                <td class="p-3.5 text-right space-x-2">
                    <button onclick="editRecipe('${rec.id}')" class="text-orange-600 hover:text-orange-800 font-semibold px-2.5 py-1 bg-orange-50 rounded-lg">Edit</button>
                    <button onclick="deleteRecipe('${rec.id}')" class="text-rose-600 hover:text-rose-800 font-semibold px-2.5 py-1 bg-rose-50 rounded-lg">Hapus</button>
                </td>
            </tr>
        `;
    }).join('');
}

window.handleIngredientSubmit = async function(e) {
    e.preventDefault();
    const id = document.getElementById('ingredient-edit-id').value || 'ing_' + Date.now();
    const name = document.getElementById('ing-name').value;
    const stock = parseFloat(document.getElementById('ing-stock').value);
    const unit = document.getElementById('ing-unit').value;
    const payload = { id, name, stock, unit };

    if (supabaseClient && !isDemoMode) {
        const { error } = await supabaseClient.from('ingredients').upsert([payload]);
        if (error) {
            showModal("Gagal", error.message, "❌");
            return;
        }
        loadDataFromSupabase();
    } else {
        const idx = ingredientsData.findIndex(i => i.id === id);
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
        tbody.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-slate-400">Belum ada data bahan baku.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(ing => `
        <tr class="hover:bg-slate-50 transition">
            <td class="p-3 font-medium text-slate-800">${escapeHtml(ing.name)}</td>
            <td class="p-3 text-slate-600 font-semibold">${ing.stock}</td>
            <td class="p-3 text-slate-500">${ing.unit}</td>
            <td class="p-3 text-right space-x-2">
                <button onclick="editIngredient('${ing.id}')" class="text-orange-600 hover:text-orange-800 font-semibold px-2.5 py-1 bg-orange-50 rounded-lg">Edit</button>
                <button onclick="deleteIngredient('${ing.id}')" class="text-rose-600 hover:text-rose-800 font-semibold px-2.5 py-1 bg-rose-50 rounded-lg">Hapus</button>
            </td>
        </tr>
    `).join('');
}

window.editIngredient = function(id) {
    const ing = ingredientsData.find(i => i.id === id);
    if (!ing) return;
    document.getElementById('ingredient-edit-id').value = ing.id;
    document.getElementById('ing-name').value = ing.name;
    document.getElementById('ing-stock').value = ing.stock;
    document.getElementById('ing-unit').value = ing.unit;
    document.getElementById('ingredient-form-title').innerText = "Edit Bahan Baku";
    switchTab('ingredients');
}

window.resetIngredientForm = function() {
    document.getElementById('ingredient-form').reset();
    document.getElementById('ingredient-edit-id').value = '';
    document.getElementById('ingredient-form-title').innerText = "Tambah / Edit Bahan Baku";
}

window.deleteIngredient = async function(id) {
    if (!confirm("Hapus bahan ini?")) return;
    if (supabaseClient && !isDemoMode) {
        const { error } = await supabaseClient.from('ingredients').delete().eq('id', id);
        if (error) {
            showModal("Gagal", error.message, "❌");
            return;
        }
        loadDataFromSupabase();
    } else {
        ingredientsData = ingredientsData.filter(i => i.id !== id);
        updateUI();
    }
    showModal("Terhapus", "Bahan baku berhasil dihapus.", "🗑️");
}

function renderProductsSummary() {
    let total = productsData.length, aman = 0, menipis = 0, habis = 0;
    productsData.forEach(p => {
        const st = Number(p.stok !== undefined ? p.stok : p.stock) || 0;
        if (st <= 0) habis++;
        else if (st <= 10) menipis++;
        else aman++;
    });

    const summaryEl = document.getElementById('stokSummary');
    if (!summaryEl) return;

    summaryEl.innerHTML = `
        <div onclick="setFilter('all')" class="border rounded-xl p-3 cursor-pointer hover:shadow-sm ${filterStatus==='all'?'border-slate-800 bg-slate-50':''}">
            <div class="text-[11px] text-slate-500">Total Produk</div>
            <div class="text-lg font-bold text-slate-800">${total}</div>
        </div>
        <div onclick="setFilter('aman')" class="border rounded-xl p-3 cursor-pointer hover:shadow-sm ${filterStatus==='aman'?'border-emerald-500 bg-emerald-50/50':''}">
            <div class="text-[11px] text-slate-500">Aman (>10)</div>
            <div class="text-lg font-bold text-emerald-600">${aman}</div>
        </div>
        <div onclick="setFilter('menipis')" class="border rounded-xl p-3 cursor-pointer hover:shadow-sm ${filterStatus==='menipis'?'border-amber-500 bg-amber-50/50':''}">
            <div class="text-[11px] text-slate-500">Menipis (1-10)</div>
            <div class="text-lg font-bold text-amber-600">${menipis}</div>
        </div>
        <div onclick="setFilter('habis')" class="border rounded-xl p-3 cursor-pointer hover:shadow-sm ${filterStatus==='habis'?'border-rose-500 bg-rose-50/50':''}">
            <div class="text-[11px] text-slate-500">Habis (0)</div>
            <div class="text-lg font-bold text-rose-600">${habis}</div>
        </div>
    `;
}

window.setFilter = function(st) {
    filterStatus = st;
    renderProductsSummary();
    renderProductsTable();
};

window.renderProductsTable = function() {
    const searchInput = document.getElementById('stokSearch');
    const kw = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const tbody = document.getElementById('stokTableBody');
    if (!tbody) return;

    let filtered = productsData.filter(p => (p.nama || p.name || '').toLowerCase().includes(kw));

    if (filterStatus !== 'all') {
        filtered = filtered.filter(p => {
            const st = Number(p.stok !== undefined ? p.stok : p.stock) || 0;
            if (filterStatus === 'habis') return st <= 0;
            if (filterStatus === 'menipis') return st > 0 && st <= 10;
            if (filterStatus === 'aman') return st > 10;
            return true;
        });
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-10 text-slate-400">Tidak ada produk ditemukan.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(p => {
        const st = Number(p.stok !== undefined ? p.stok : p.stock) || 0;
        let badge = `<span class="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-semibold text-[10px]">Aman</span>`;
        if (st <= 0) badge = `<span class="bg-rose-50 text-rose-700 px-2 py-0.5 rounded-full font-semibold text-[10px]">Habis</span>`;
        else if (st <= 10) badge = `<span class="bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full font-semibold text-[10px]">Menipis</span>`;

        const prodName = p.name || p.nama || 'Produk';
        const prodFoto = p.foto || p.image || 'https://placehold.co/40';

        return `
            <tr class="hover:bg-slate-50">
                <td class="p-3"><img src="${prodFoto}" class="w-10 h-10 object-cover rounded-lg" onerror="this.src='https://placehold.co/40'"></td>
                <td class="p-3 font-semibold text-slate-800">${escapeHtml(prodName)}</td>
                <td class="p-3">${p.qty || 1} ${p.unit || 'pcs'}</td>
                <td class="p-3 font-bold">${st}</td>
                <td class="p-3">${badge}</td>
                <td class="p-3">
                    <div class="flex items-center gap-1">
                        <button onclick="modStock('${p.id}', ${st - 1})" class="bg-slate-100 px-2.5 py-1 rounded font-bold">-</button>
                        <input type="number" value="${st}" id="stok-${p.id}" class="w-12 text-center bg-slate-50 border rounded p-1" onchange="inputStock('${p.id}')">
                        <button onclick="modStock('${p.id}', ${st + 1})" class="bg-slate-100 px-2.5 py-1 rounded font-bold">+</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
};

window.modStock = async function(id, val) {
    val = Math.max(0, Number(val) || 0);
    try {
        if (supabaseClient && !isDemoMode) {
            let updateRes = await supabaseClient.from('products').update({ stok: val }).eq('id', id);
            if (updateRes.error) {
                await supabaseClient.from('producs').update({ stok: val }).eq('id', id);
            }
        }
        productsData = productsData.map(p => String(p.id) === String(id) ? { ...p, stok: val, stock: val } : p);
        renderProductsSummary();
        renderProductsTable();
        checkLowStockProducts();
        updateProductDropdowns();
    } catch(e) { 
        showModal("Gagal", "Gagal update stok: " + e.message, "❌"); 
    }
};

window.inputStock = async function(id) {
    const inputEl = document.getElementById(`stok-${id}`);
    if (inputEl) {
        const v = Number(inputEl.value);
        await modStock(id, v);
    }
};

function updateCalcProductOptions() {
    const select = document.getElementById('calc-product-select');
    if (!select) return;
    const currentVal = select.value;
    let html = '<option value="">-- Pilih Produk Dimsum --</option>';
    
    productsData.forEach(prod => {
        const selected = prod.id === currentVal ? 'selected' : '';
        const stockVal = prod.stok !== undefined ? prod.stok : (prod.stock !== undefined ? prod.stock : 0);
        const displayLabel = `${prod.name || prod.nama || 'Produk'} (Stok: ${stockVal} | Isi: ${prod.qty || 1} ${prod.unit || 'pcs'})`;
        html += `<option value="${prod.id}" ${selected}>${escapeHtml(displayLabel)}</option>`;
    });
    select.innerHTML = html;
    updateCalcPreview();
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

    const recipe = recipesData.find(r => r.product_id === productId);
    const prod = productsData.find(p => p.id === productId);
    if (!recipe) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-amber-600">Belum ada resep yang di-link ke produk ini. Silakan buat resepnya di tab <strong>Master Resep</strong>.</td></tr>`;
        if (labelTarget) labelTarget.innerText = "Resep belum diset";
        return;
    }

    const totalOutputPcs = batchMultiplier * (prod ? (prod.qty || 1) : 1);
    if (labelTarget) labelTarget.innerText = `Target: ${batchMultiplier} Batch (~${totalOutputPcs} ${prod ? (prod.unit || 'pcs') : 'pcs'})`;

    tbody.innerHTML = (recipe.items || []).map(item => {
        const ing = ingredientsData.find(i => i.id === item.ingredientId);
        const name = ing ? escapeHtml(ing.name) : 'Bahan Telah Dihapus';
        const unit = ing ? ing.unit : '';
        const currentStock = ing ? ing.stock : 0;
        const totalNeeded = item.amount * batchMultiplier;
        const shortage = totalNeeded - currentStock;

        let statusBadge = '';
        if (shortage <= 0) {
            statusBadge = `<span class="bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full font-semibold border border-emerald-200">Stok Aman</span>`;
        } else {
            statusBadge = `<span class="bg-rose-50 text-rose-700 px-2.5 py-1 rounded-full font-semibold border border-rose-200">Kurang: ${shortage.toFixed(1)} ${unit}</span>`;
        }

        return `
            <tr class="hover:bg-slate-50 transition">
                <td class="p-4 font-medium text-slate-800">${name}</td>
                <td class="p-4 font-bold text-orange-600">${totalNeeded.toFixed(1)} <span class="font-normal text-slate-500">${unit}</span></td>
                <td class="p-4 text-slate-600">${currentStock} <span class="text-slate-400">${unit}</span></td>
                <td class="p-4">${statusBadge}</td>
            </tr>
        `;
    }).join('');
}

window.exportShoppingList = function() {
    const selectEl = document.getElementById('calc-product-select');
    const batchInput = document.getElementById('calc-batch-input');
    if (!selectEl) return;
    const productId = selectEl.value;
    const batchMultiplier = batchInput ? (parseFloat(batchInput.value) || 1) : 1;
    
    if (!productId) {
        showModal("Perhatian", "Pilih produk terlebih dahulu untuk menyalin daftar belanja.", "⚠️");
        return;
    }

    const prod = productsData.find(p => p.id === productId);
    const recipe = recipesData.find(r => r.product_id === productId);
    if (!recipe) {
        showModal("Perhatian", "Resep untuk produk ini belum diatur.", "⚠️");
        return;
    }

    let text = `📋 DAFTAR BELANJA & RESTOK DIMSUM\nMenu: ${prod ? (prod.name || prod.nama) : 'Produk'}\nJumlah: ${batchMultiplier} Batch\n------------------------------------\n`;
    
    (recipe.items || []).forEach(item => {
        const ing = ingredientsData.find(i => i.id === item.ingredientId);
        const name = ing ? ing.name : 'Bahan';
        const unit = ing ? ing.unit : '';
        const totalNeeded = item.amount * batchMultiplier;
        const currentStock = ing ? ing.stock : 0;
        const shortage = Math.max(0, totalNeeded - currentStock);

        text += `- ${name}: Butuh ${totalNeeded.toFixed(1)} ${unit} (Kurang: ${shortage.toFixed(1)} ${unit})\n`;
    });

    text += `------------------------------------\nGenerated by ChimChum Dimsum Master`;

    const dummy = document.createElement("textarea");
    document.body.appendChild(dummy);
    dummy.value = text;
    dummy.select();
    document.execCommand("copy");
    document.body.removeChild(dummy);

    showModal("Berhasil Disalin!", "Daftar kebutuhan belanja telah disalin ke clipboard. Bisa langsung dipaste ke WhatsApp!", "📋");
}

window.onProductSelectChanged = function() {
    const prodId = document.getElementById('recipe-product-select').value;
    const prod = productsData.find(p => p.id === prodId);
    const recipeNameInput = document.getElementById('recipe-name');
    if (prod && recipeNameInput && !recipeNameInput.value) {
        const pName = prod.name || prod.nama || 'Produk';
        recipeNameInput.value = `Resep ${pName} (${prod.qty || 1} ${prod.unit || 'pcs'})`;
    }
}

window.addRecipeIngredientRow = function(selectedIngId = '', amountVal = '') {
    const container = document.getElementById('recipe-ingredients-container');
    if (!container) return;
    const rowId = 'row_' + Math.random().toString(36).substring(2, 9);
    
    let optionsHtml = '<option value="">-- Pilih Bahan --</option>';
    ingredientsData.forEach(ing => {
        const selected = ing.id === selectedIngId ? 'selected' : '';
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
    const product_id = document.getElementById('recipe-product-select').value;
    const name = document.getElementById('recipe-name').value;

    const itemRows = document.querySelectorAll('#recipe-ingredients-container > div');
    const items = [];
    itemRows.forEach(row => {
        const ingredientId = row.querySelector('.recipe-ing-select').value;
        const amount = parseFloat(row.querySelector('.recipe-ing-amount').value);
        if (ingredientId && !isNaN(amount)) {
            items.push({ ingredientId, amount });
        }
    });

    if (!product_id) {
        showModal("Perhatian", "Pilih produk dari tabel products terlebih dahulu.", "⚠️");
        return;
    }

    if (items.length === 0) {
        showModal("Perhatian", "Resep harus memiliki minimal 1 bahan baku.", "⚠️");
        return;
    }

    const payload = { id, product_id, name, description: name, items };

    if (supabaseClient && !isDemoMode) {
        const { error } = await supabaseClient.from('recipes').upsert([payload]);
        if (error) {
            showModal("Gagal", error.message, "❌");
            return;
        }
        loadDataFromSupabase();
    } else {
        const idx = recipesData.findIndex(r => r.id === id);
        if (idx >= 0) recipesData[idx] = payload;
        else recipesData.push(payload);
        updateUI();
    }

    closeRecipeModal();
    showModal("Sukses", "Relasi master resep berhasil disimpan!", "✅");
}

window.editRecipe = function(id) {
    const rec = recipesData.find(r => r.id === id);
    if (!rec) return;
    document.getElementById('recipe-edit-id').value = rec.id;
    document.getElementById('recipe-product-select').value = rec.product_id || '';
    document.getElementById('recipe-name').value = rec.name;
    document.getElementById('modalTitle').innerText = "Edit Master Resep";
    
    const container = document.getElementById('recipe-ingredients-container');
    if (container) {
        container.innerHTML = '';
        (rec.items || []).forEach(item => {
            addRecipeIngredientRow(item.ingredientId, item.amount);
        });
    }
    document.getElementById('recipeModal').classList.remove('hidden');
}

window.resetRecipeForm = function() {
    const form = document.getElementById('recipeForm');
    if (form) form.reset();
    document.getElementById('recipe-edit-id').value = '';
    document.getElementById('modalTitle').innerText = "Atur Resep ke Produk";
    const container = document.getElementById('recipe-ingredients-container');
    if (container) {
        container.innerHTML = '';
        addRecipeIngredientRow();
    }
}

window.deleteRecipe = async function(id) {
    if (!confirm("Hapus relasi resep ini?")) return;
    if (supabaseClient && !isDemoMode) {
        const { error } = await supabaseClient.from('recipes').delete().eq('id', id);
        if (error) {
            showModal("Gagal", error.message, "❌");
            return;
        }
        loadDataFromSupabase();
    } else {
        recipesData = recipesData.filter(r => r.id !== id);
        updateUI();
    }
    showModal("Terhapus", "Master resep berhasil dihapus.", "🗑️");
}

function escapeHtml(str) {
    return String(str || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

window.onload = function() {
    initApp();
    addRecipeIngredientRow();
};
