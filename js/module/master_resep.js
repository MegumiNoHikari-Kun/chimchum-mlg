import { supabase, authReady } from '../supabase.js';

let ingredientsData = [];
let productsData = [];
let recipesData = [];
let filterStatus = 'all';
let isDemoMode = false;
let supabaseClient = null;
let suppliersData = []; 

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
    ['recipes', 'mapping', 'calculator', 'ingredients'].forEach(t => {
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
    if (tabName === 'mapping') renderMappingUI();
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
            // console.log("🔍 [DB DEBUG] Supabase client initialized. Loading data...");
            await loadDataFromSupabase();
        } else {
            // console.log("⚠️ [DB DEBUG] Supabase not found. Running in Demo Mode.");
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
        // console.log("🔍 [DB DEBUG] Fetching ingredients, products, and recipes from Supabase...");
        
        const { data: ing, error: ingErr } = await supabaseClient.from('ingredients').select('*');
        if (ingErr) console.error("❌ [DB DEBUG] Error fetching ingredients:", ingErr);
        if (ing) ingredientsData = ing;

        const prodResult = await supabaseClient.from('products').select('*');
        if (prodResult.error) console.error("❌ [DB DEBUG] Error fetching products:", prodResult.error);
        if (prodResult.data) {
            productsData = prodResult.data;
            // console.log("🔍 [DB DEBUG] Loaded products with resep_id mapping:", productsData.map(p => ({ id: p.id, name: p.name || p.nama, resep_id: p.resep_id })));
        }

        const { data: rec, error: recErr } = await supabaseClient.from('recipes').select('*');
        if (recErr) console.error("❌ [DB DEBUG] Error fetching recipes:", recErr);
        if (rec) recipesData = rec;

        const { data: sup, error: supErr } = await supabaseClient.from('suppliers').select('*');
        if (supErr) console.error("❌ [DB DEBUG] Error fetching suppliers:", supErr);
        if (sup) suppliersData = sup;

        // console.log("✅ [DB DEBUG] Loaded Data -> Products:", productsData.length, "| Recipes:", recipesData.length, "| Ingredients:", ingredientsData.length);
        updateUI();
    } catch (e) {
        console.error("❌ [DB DEBUG] Supabase fetch exception:", e);
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
        { id: 'prod_1', name: 'Lumpia Ayam Goreng', qty: 8, unit: 'pcs', stok: 10, resep_id: 'rec_1', foto: 'https://placehold.co/40' },
        { id: 'prod_2', name: 'Dimsum Udang Spesial', qty: 50, unit: 'pcs', stok: 0, resep_id: null, foto: 'https://placehold.co/40' },
        { id: 'prod_3', name: 'Dimsum Ayam Original', qty: 1, unit: 'pcs', stok: 15, resep_id: 'rec_1', foto: 'https://placehold.co/40' }
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
        { id: 'sup_1', name: 'PT Bahan Pangan Utama', phone: '08123456789' },
        { id: 'sup_2', name: 'Toko Supplier Makmur', phone: '08987654321' }
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
    renderProductsSummary();
    renderProductsTable();
    updateCalcProductOptions();
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

    const filtered = recipesData.filter(rec => rec.name.toLowerCase().includes(query));
    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center py-10 text-slate-400">Belum ada master resep yang cocok.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(rec => {
        const linkedProducts = productsData.filter(p => String(p.resep_id) === String(rec.id));
        
        const linkedProductsHtml = linkedProducts.length > 0 ? linkedProducts.map(prod => {
            const stockVal = prod.stok !== undefined ? Number(prod.stok) : (prod.stock !== undefined ? Number(prod.stock) : 0);
            let stockBadge = '';
            if (stockVal <= 0) {
                stockBadge = `<span class="bg-rose-100 text-rose-700 px-1.5 py-0.2 rounded font-bold text-[9px] animate-pulse">Habis (0)</span>`;
            } else if (stockVal <= 5) {
                stockBadge = `<span class="bg-amber-100 text-amber-700 px-1.5 py-0.2 rounded font-bold text-[9px]">Menipis (${stockVal})</span>`;
            } else {
                stockBadge = `<span class="bg-emerald-50 text-emerald-700 px-1.5 py-0.2 rounded font-semibold text-[9px]">Stok: ${stockVal}</span>`;
            }
            return `<div class="mb-1 flex items-center gap-1.5 flex-wrap"><strong class="text-slate-800">${escapeHtml(prod.name || prod.nama)}</strong> ${stockBadge}</div>`;
        }).join('') : '<span class="text-slate-400 italic">Belum ada menu yang menggunakan resep ini</span>';

        const itemsList = (rec.items || []).map(item => {
            const ing = ingredientsData.find(i => String(i.id) === String(item.ingredientId));
            return `• ${ing ? escapeHtml(ing.name) : 'Bahan Terhapus'}: <strong class="text-slate-800">${item.amount} ${ing ? ing.unit : ''}</strong>`;
        }).join('<br>');

        return `
            <tr class="hover:bg-slate-50/70 transition">
                <td class="p-3.5 font-medium text-orange-600">${escapeHtml(rec.name)}</td>
                <td class="p-3.5 text-slate-600 leading-relaxed">${itemsList || 'Tidak ada bahan'}</td>
                <td class="p-3.5 space-y-1">${linkedProductsHtml}</td>
                <td class="p-3.5 text-right space-x-2">
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

    if (productsData.length === 0) {
        container.innerHTML = `<tr><td colspan="4" class="text-center py-10 text-slate-400">Belum ada produk/menu di tabel products.</td></tr>`;
        return;
    }

    const searchInput = document.getElementById('mappingSearch');
    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

    let filteredProducts = productsData;
    if (query) {
        filteredProducts = productsData.filter(p => {
            const pName = (p.name || p.nama || '').toLowerCase();
            return pName.includes(query);
        });
    }

    if (filteredProducts.length === 0) {
        container.innerHTML = `<tr><td colspan="4" class="text-center py-10 text-slate-400">Tidak ada menu yang sesuai dengan pencarian "${escapeHtml(query)}".</td></tr>`;
        return;
    }

    container.innerHTML = filteredProducts.map(prod => {
        const currentRecipeId = prod.resep_id || '';
        const stockVal = prod.stok !== undefined ? Number(prod.stok) : (prod.stock !== undefined ? Number(prod.stock) : 0);
        const prodQty = prod.qty !== undefined ? prod.qty : 1;
        const prodUnit = prod.unit !== undefined ? prod.unit : 'pcs';
        
        let statusBadge = `<span class="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-semibold text-[10px]">Aman (${stockVal})</span>`;
        if (stockVal <= 0) statusBadge = `<span class="bg-rose-50 text-rose-700 px-2.5 py-0.5 rounded-full font-semibold text-[10px]">Habis (0)</span>`;
        else if (stockVal <= 5) statusBadge = `<span class="bg-amber-50 text-amber-700 px-2.5 py-0.5 rounded-full font-semibold text-[10px]">Menipis (${stockVal})</span>`;

        let selectOptions = '<option value="">-- Belum Dipilih --</option>';
        recipesData.forEach(r => {
            const isSel = String(r.id) === String(currentRecipeId) ? 'selected' : '';
            selectOptions += `<option value="${r.id}" ${isSel}>${escapeHtml(r.name)}</option>`;
        });

        return `
            <tr class="hover:bg-slate-50 transition">
                <td class="p-3.5"><img src="${prod.foto || prod.image || 'https://placehold.co/40'}" class="w-10 h-10 object-cover rounded-lg" onerror="this.src='https://placehold.co/40'"></td>
                <td class="p-3.5 font-semibold text-slate-800">${escapeHtml(prod.name || prod.nama)} (${prodQty} ${prodUnit})</td>
                <td class="p-3.5">${statusBadge}</td>
                <td class="p-3.5">
                    <div class="flex items-center gap-2">
                        <select id="map-select-${prod.id}" onchange="updateMenuRecipeMapping('${prod.id}')" class="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-xs bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-500">
                            ${selectOptions}
                        </select>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

window.updateMenuRecipeMapping = async function(productId) {
    const selectEl = document.getElementById(`map-select-${productId}`);
    if (!selectEl) return;
    const recipeId = selectEl.value ? selectEl.value : null;

    // console.log(`🔍 [DB DEBUG] Updating mapping for Product ID: ${productId} -> Recipe ID: ${recipeId}`);

    // Update local state immediately for snappy UX
    productsData = productsData.map(p => String(p.id) === String(productId) ? { ...p, resep_id: recipeId } : p);

    if (supabaseClient && !isDemoMode) {
        try {
            // console.log(`📤 [DB DEBUG] Sending update to Supabase table 'products' with filter eq('id', ${productId})`);
            
            const { data, error } = await supabaseClient
                .from('products')
                .update({ resep_id: recipeId })
                .eq('id', productId)
                .select();

            if (error) {
                console.error("❌ [DB DEBUG] Supabase update error details:", error);
                showModal("Gagal Supabase", `Error: ${error.message}. Periksa RLS policy tabel products.`, "❌");
                return;
            }

            // console.log("✅ [DB DEBUG] Supabase update confirmed. Response data:", data);
        } catch (e) {
            console.error("❌ [DB DEBUG] Supabase mapping update exception:", e);
            showModal("Gagal", "Terjadi kesalahan koneksi ke Supabase.", "❌");
            return;
        }
    } else {
        // console.log("ℹ️ [DB DEBUG] Running in demo mode. Saved locally.");
    }

    renderRecipes();
    renderMappingUI();
    updateCalcProductOptions();
    showModal("Tersimpan", "Relasi menu dan resep berhasil disimpan ke Supabase!", "✅");
}

function updateCalcProductOptions() {
    const select = document.getElementById('calc-product-select');
    if (!select) return;
    const currentVal = select.value;
    let html = '<option value="">-- Pilih Produk Dimsum --</option>';
    productsData.forEach(prod => {
        const selected = String(prod.id) === String(currentVal) ? 'selected' : '';
        const stockVal = prod.stok !== undefined ? prod.stok : (prod.stock !== undefined ? prod.stock : 0);
        
        // Format penamaan produk: Nama Produk (Stok: X)
        const displayLabel = `${prod.name || prod.nama || 'Produk'} (Stok: ${stockVal})`;
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

    const prod = productsData.find(p => String(p.id) === String(productId));
    const recipe = prod && prod.resep_id ? recipesData.find(r => String(r.id) === String(prod.resep_id)) : null;

    if (!recipe) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-amber-600">Belum ada resep yang di-link ke produk ini. Silakan atur di tab <strong>Kawinkan Menu & Resep</strong>.</td></tr>`;
        if (labelTarget) labelTarget.innerText = "Resep belum diset";
        return;
    }

    const totalOutputPcs = batchMultiplier * (prod ? (prod.qty || 1) : 1);
    if (labelTarget) labelTarget.innerText = `Target: ${batchMultiplier} Batch (~${totalOutputPcs} ${prod ? (prod.unit || 'pcs') : 'pcs'})`;

    tbody.innerHTML = (recipe.items || []).map(item => {
        const ing = ingredientsData.find(i => String(i.id) === String(item.ingredientId));
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

    const prod = productsData.find(p => String(p.id) === String(productId));
    const recipe = prod && prod.resep_id ? recipesData.find(r => String(r.id) === String(prod.resep_id)) : null;

    if (!recipe) {
        showModal("Perhatian", "Resep untuk produk ini belum diatur di tab Kawinkan Menu & Resep.", "⚠️");
        return;
    }

    let text = `📋 DAFTAR BELANJA & RESTOK DIMSUM\nMenu: ${prod ? (prod.name || prod.nama) : 'Produk'}\nJumlah: ${batchMultiplier} Batch\n------------------------------------\n`;
    (recipe.items || []).forEach(item => {
        const ing = ingredientsData.find(i => String(i.id) === String(item.ingredientId));
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
    showModal("Berhasil Disalin!", "Daftar kebutuhan belanja telah disalin ke clipboard.", "📋");
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

// 1. TOMBOL PROSES: Mengurangi stok gudang (ingredients)
window.processRestockDeduction = async function() {
    const selectEl = document.getElementById('calc-product-select');
    const batchInput = document.getElementById('calc-batch-input');
    if (!selectEl || !selectEl.value) {
        showModal("Perhatian", "Pilih produk dimsum terlebih dahulu.", "⚠️");
        return;
    }
    
    const productId = selectEl.value;
    const batchMultiplier = batchInput ? (parseFloat(batchInput.value) || 0) : 0;
    if (batchMultiplier <= 0) {
        showModal("Perhatian", "Jumlah batch harus lebih dari 0.", "⚠️");
        return;
    }

    const prod = productsData.find(p => String(p.id) === String(productId));
    const recipe = prod && prod.resep_id ? recipesData.find(r => String(r.id) === String(prod.resep_id)) : null;

    if (!recipe) {
        showModal("Perhatian", "Resep untuk produk ini belum diatur.", "⚠️");
        return;
    }

    if (!confirm(`Proses produksi ${batchMultiplier} batch ${prod.name || prod.nama}? Stok bahan baku di gudang akan otomatis dikurangi.`)) {
        return;
    }

    // Hitung pengurangan & update local/database
    for (const item of recipe.items) {
        const ing = ingredientsData.find(i => String(i.id) === String(item.ingredientId));
        if (ing) {
            const totalNeeded = item.amount * batchMultiplier;
            const newStock = Math.max(0, Number(ing.stock) - totalNeeded);
            ing.stock = newStock;

            if (supabaseClient && !isDemoMode) {
                await supabaseClient.from('ingredients').update({ stock: newStock }).eq('id', ing.id);
            }
        }
    }

    if (supabaseClient && !isDemoMode) {
        await loadDataFromSupabase();
    } else {
        updateUI();
    }

    showModal("Berhasil Diproses!", "Stok bahan baku di gudang telah dikurangi sesuai kebutuhan resep.", "✅");
};

// 2. TOMBOL ORDER STOK: Membuka form order & konek ke master suppliers
window.openOrderModal = function() {
    const selectEl = document.getElementById('calc-product-select');
    const batchInput = document.getElementById('calc-batch-input');
    if (!selectEl || !selectEl.value) {
        showModal("Perhatian", "Pilih produk terlebih dahulu untuk membuat order stok.", "⚠️");
        return;
    }

    const productId = selectEl.value;
    const batchMultiplier = batchInput ? (parseFloat(batchInput.value) || 1) : 1;
    const prod = productsData.find(p => String(p.id) === String(productId));
    const recipe = prod && prod.resep_id ? recipesData.find(r => String(r.id) === String(prod.resep_id)) : null;

    if (!recipe) {
        showModal("Perhatian", "Resep untuk produk ini belum diatur.", "⚠️");
        return;
    }

    // Render dropdown supplier
    const supSelect = document.getElementById('order-supplier-select');
    supSelect.innerHTML = '<option value="">-- Pilih Supplier --</option>' + suppliersData.map(s => `
        <option value="${s.id}">${escapeHtml(s.name || s.nama)}</option>
    `).join('');

    // Render preview bahan yang kurang
    const previewContainer = document.getElementById('order-items-preview');
    let itemsHtml = '';
    let hasShortage = false;

    (recipe.items || []).forEach(item => {
        const ing = ingredientsData.find(i => String(i.id) === String(item.ingredientId));
        const name = ing ? ing.name : 'Bahan';
        const unit = ing ? ing.unit : '';
        const totalNeeded = item.amount * batchMultiplier;
        const currentStock = ing ? ing.stock : 0;
        const shortage = Math.max(0, totalNeeded - currentStock);

        if (shortage > 0) {
            hasShortage = true;
            itemsHtml += `<div>• <strong>${escapeHtml(name)}</strong>: Kurang <strong>${shortage.toFixed(1)} ${unit}</strong></div>`;
        }
    });

    if (!hasShortage) {
        itemsHtml = `<div class="text-emerald-600 font-semibold">Semua stok bahan baku aman! Tidak ada kekurangan untuk batch ini.</div>`;
    }

    previewContainer.innerHTML = itemsHtml;
    document.getElementById('orderModal').classList.remove('hidden');
};

window.closeOrderModal = function() {
    document.getElementById('orderModal').classList.add('hidden');
};

window.submitOrder = async function(e) {
    e.preventDefault();
    const supplierId = document.getElementById('order-supplier-select').value;
    const notes = document.getElementById('order-notes').value;

    if (!supplierId) {
        showModal("Perhatian", "Silakan pilih supplier terlebih dahulu.", "⚠️");
        return;
    }

    const selectEl = document.getElementById('calc-product-select');
    const batchInput = document.getElementById('calc-batch-input');
    const productId = selectEl ? selectEl.value : '';
    const batchMultiplier = batchInput ? (parseFloat(batchInput.value) || 1) : 1;

    const prod = productsData.find(p => String(p.id) === String(productId));
    const recipe = prod && prod.resep_id ? recipesData.find(r => String(r.id) === String(prod.resep_id)) : null;

    if (!recipe) {
        showModal("Perhatian", "Resep produk tidak ditemukan.", "⚠️");
        return;
    }

    // Hitung item yang kurang dan susun data detail order
    let orderItems = [];
    let grandTotal = 0;

    (recipe.items || []).forEach(item => {
        const ing = ingredientsData.find(i => String(i.id) === String(item.ingredientId));
        const totalNeeded = item.amount * batchMultiplier;
        const currentStock = ing ? Number(ing.stock) : 0;
        const shortage = Math.max(0, totalNeeded - currentStock);

        if (shortage > 0) {
            // Asumsi harga satuan diambil dari data bahan (ing.price) atau default 0 jika belum diset
            const unitPrice = ing && ing.price ? Number(ing.price) : 0; 
            const subtotal = shortage * unitPrice;
            grandTotal += subtotal;

            orderItems.push({
                ingredient_id: ing ? ing.id : null,
                ingredient_name: ing ? ing.name : 'Bahan',
                quantity: shortage,
                unit: ing ? ing.unit : '',
                unit_price: unitPrice,
                subtotal: subtotal
            });
        }
    });

    if (orderItems.length === 0) {
        showModal("Informasi", "Tidak ada kekurangan bahan untuk di-order pada batch ini.", "ℹ️");
        closeOrderModal();
        return;
    }

    try {
        if (supabaseClient && !isDemoMode) {
            // 1. Simpan header order ke tabel purchase_orders
            const { data: orderData, error: orderError } = await supabaseClient
                .from('purchase_orders')
                .insert([{
                    supplier_id: supplierId,
                    status: 'pending', // Status awal order
                    total_amount: grandTotal,
                    notes: notes
                }])
                .select()
                .single();

            if (orderError) throw orderError;

            // 2. Masukkan ID order utama ke masing-masing item detail, lalu simpan ke purchase_order_items
            const orderId = orderData.id;
            const itemsWithId = orderItems.map(item => ({ ...item, order_id: orderId }));

            const { error: itemsError } = await supabaseClient
                .from('purchase_order_items')
                .insert(itemsWithId);

            if (itemsError) throw itemsError;
        }

        const selectedSupplier = suppliersData.find(s => String(s.id) === String(supplierId));
        closeOrderModal();
        showModal("Order Berhasil Disimpan!", `Pesanan ke ${selectedSupplier?.name || 'Supplier'} berhasil dicatat ke database dengan total estimasi Rp ${grandTotal.toLocaleString('id-ID')}.`, "✅");

    } catch (err) {
        console.error("❌ [DB ERROR] Gagal menyimpan order:", err);
        showModal("Gagal", `Terjadi kesalahan saat menyimpan order: ${err.message}`, "❌");
    }
};

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
            await supabaseClient.from('products').update({ stok: val }).eq('id', id);
        }
        productsData = productsData.map(p => String(p.id) === String(id) ? { ...p, stok: val, stock: val } : p);
        renderProductsSummary();
        renderProductsTable();
        checkLowStockProducts();
        updateCalcProductOptions();
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
        if (ingredientId && !isNaN(amount)) {
            items.push({ ingredientId, amount });
        }
    });

    if (items.length === 0) {
        showModal("Perhatian", "Resep harus memiliki minimal 1 bahan baku.", "⚠️");
        return;
    }

    const payload = { id, name, description: name, items };
    if (supabaseClient && !isDemoMode) {
        const { error } = await supabaseClient.from('recipes').upsert([payload]);
        if (error) {
            showModal("Gagal", error.message, "❌");
            return;
        }
        loadDataFromSupabase();
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
    document.getElementById('modalTitle').innerText = "Buat Master Resep";
    const container = document.getElementById('recipe-ingredients-container');
    if (container) {
        container.innerHTML = '';
        addRecipeIngredientRow();
    }
}

window.deleteRecipe = async function(id) {
    if (!confirm("Hapus master resep ini? Semua menu yang terikat akan terlepas.")) return;
    if (supabaseClient && !isDemoMode) {
        await supabaseClient.from('products').update({ resep_id: null }).eq('resep_id', id);
        const { error } = await supabaseClient.from('recipes').delete().eq('id', id);
        if (error) {
            showModal("Gagal", error.message, "❌");
            return;
        }
        loadDataFromSupabase();
    } else {
        recipesData = recipesData.filter(r => String(r.id) !== String(id));
        productsData = productsData.app ? productsData : productsData.map(p => String(p.resep_id) === String(id) ? { ...p, resep_id: null } : p);
        updateUI();
    }
    showModal("Terhapus", "Master resep berhasil dihapus.", "🗑️");
}

function escapeHtml(str) {
    return String(str || '').replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">").replace(/"/g, "\"").replace(/'/g, "'");
}

window.onload = function() {
    initApp();
    addRecipeIngredientRow();
};
