import { supabase, authReady } from '../supabase.js';

// =========================================================
// STATE
// =========================================================
let products = [];
let filterStatus = 'all'; // 'all', 'aman', 'menipis', 'habis'
let selectedKategori = 'all';

// State Pagination
let currentPage = 1;
const itemsPerPage = 5;
let filteredProductsCache = []; // Menyimpan hasil filter untuk pagination

// =========================================================
// HELPER: STATUS NOTIFICATION
// =========================================================
function showStatus(message, type = 'error') {
    const box = document.getElementById('statusBox');
    const msgContainer = document.getElementById('statusMessage');
    
    if (!box || !msgContainer) {
        // Fallback to alert if UI element is missing
        if (type === 'error') alert("Error: " + message);
        return;
    }

    box.classList.remove('hidden', 'bg-red-50', 'border-red-200', 'text-red-700', 'bg-emerald-50', 'border-emerald-200', 'text-emerald-700', 'bg-amber-50', 'border-amber-200', 'text-amber-700');
    
    let icon = '';
    if (type === 'error') {
        box.classList.add('bg-red-50', 'border-red-200', 'text-red-700');
        icon = '<i class="fa-solid fa-circle-exclamation text-red-500 text-sm"></i>';
    } else if (type === 'success') {
        box.classList.add('bg-emerald-50', 'border-emerald-200', 'text-emerald-700');
        icon = '<i class="fa-solid fa-circle-check text-emerald-500 text-sm"></i>';
    } else {
        box.classList.add('bg-amber-50', 'border-amber-200', 'text-amber-700');
        icon = '<i class="fa-solid fa-triangle-exclamation text-amber-500 text-sm"></i>';
    }

    msgContainer.innerHTML = `${icon} <span class="font-medium">${message}</span>`;
    box.classList.remove('hidden');

    // Auto hide after 4 seconds
    setTimeout(() => { box.classList.add('hidden'); }, 4000);
}

window.hideStatus = function() {
    const box = document.getElementById('statusBox');
    if(box) box.classList.add('hidden');
}

// =========================================================
// LOAD DATA
// =========================================================
window.loadStok = async function() {
    const connStatus = document.getElementById('connectionStatus');
    
    try {
        await authReady;
        const { data, error } = await supabase.from('products').select('*');
        if (error) throw error;
        
        if (data) products = data;
        
        if(connStatus) {
            connStatus.innerHTML = '<i class="fa-solid fa-circle-check text-emerald-500 mr-1"></i> Terhubung';
            connStatus.classList.replace('text-amber-600', 'text-emerald-600');
            connStatus.classList.replace('bg-amber-50', 'bg-emerald-50');
            connStatus.classList.replace('border-amber-200', 'border-emerald-200');
        }

    } catch(e) { 
        console.warn('Gagal memuat dari Supabase:', e); 
        showStatus('Gagal memuat data stok dari server.', 'error');
        if(connStatus) {
            connStatus.innerHTML = '<i class="fa-solid fa-circle-xmark text-red-500 mr-1"></i> Gagal';
            connStatus.classList.replace('text-amber-600', 'text-red-600');
            connStatus.classList.replace('bg-amber-50', 'bg-red-50');
            connStatus.classList.replace('border-amber-200', 'border-red-200');
        }
    }

    extractCategories();
    applyFiltersAndRender();
};

// =========================================================
// KATEGORI & FILTERING
// =========================================================
function extractCategories() {
    const select = document.getElementById('kategoriFilter');
    if(!select) return;

    const categories = new Set();
    products.forEach(p => {
        const cat = (p.kategori || p.category || '').trim();
        if (cat) categories.add(cat);
    });

    select.innerHTML = '<option value="all">Semua Kategori</option>';
    Array.from(categories).sort().forEach(cat => {
        select.innerHTML += `<option value="${cat}">${cat}</option>`;
    });
}

// Terpicu ketika user mengetik pencarian, mengubah filter box, atau dropdown kategori
window.applyFiltersAndRender = function() {
    const searchInput = document.getElementById('stokSearch');
    const kw = searchInput ? searchInput.value.toLowerCase().trim() : '';
    
    const catSelect = document.getElementById('kategoriFilter');
    selectedKategori = catSelect ? catSelect.value : 'all';

    // Filter berdasarkan Kategori & Pencarian (untuk Summary)
    const baseFiltered = products.filter(p => {
        const matchName = (p.nama || p.name || '').toLowerCase().includes(kw);
        const matchCat = selectedKategori === 'all' || (p.kategori || p.category) === selectedKategori;
        return matchName && matchCat;
    });

    renderSummary(baseFiltered);

    // Filter tambahan berdasarkan Status Stok (untuk Tabel)
    filteredProductsCache = baseFiltered.filter(p => {
        const st = Number(p.stok) || 0;
        if (filterStatus === 'habis') return st <= 0;
        if (filterStatus === 'menipis') return st > 0 && st <= 10;
        if (filterStatus === 'aman') return st > 10;
        return true;
    });

    // Reset ke halaman 1 setiap kali filter berubah
    currentPage = 1;
    renderTable();
};

// Terpicu ketika user klik kotak Ringkasan (Aman/Menipis/Habis)
window.setFilter = function(st) {
    filterStatus = st;
    applyFiltersAndRender();
};

// =========================================================
// RENDER SUMMARY (KOTAK ATAS)
// =========================================================
function renderSummary(baseData) {
    const summaryContainer = document.getElementById('stokSummary');
    if(!summaryContainer) return;

    let total = baseData.length, aman = 0, menipis = 0, habis = 0;
    baseData.forEach(p => {
        const st = Number(p.stok) || 0;
        if (st <= 0) habis++;
        else if (st <= 10) menipis++;
        else aman++;
    });

    const activeClass = (target) => filterStatus === target ? 'ring-2 ring-orange-400 bg-white shadow-md' : 'bg-white hover:bg-slate-50 opacity-80 hover:opacity-100';

    summaryContainer.innerHTML = `
        <div onclick="setFilter('all')" class="border border-slate-200 rounded-2xl p-4 cursor-pointer transition ${activeClass('all')}">
            <div class="flex justify-between items-start">
                <div>
                    <div class="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Total Produk</div>
                    <div class="text-2xl font-bold text-slate-800 mt-1">${total}</div>
                </div>
                <div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500"><i class="fa-solid fa-boxes-stacked text-xs"></i></div>
            </div>
        </div>

        <div onclick="setFilter('aman')" class="border border-emerald-200 rounded-2xl p-4 cursor-pointer transition ${activeClass('aman')}">
            <div class="flex justify-between items-start">
                <div>
                    <div class="text-[11px] font-semibold text-emerald-600/80 uppercase tracking-wide">Stok Aman</div>
                    <div class="text-2xl font-bold text-emerald-600 mt-1">${aman}</div>
                </div>
                <div class="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-500"><i class="fa-solid fa-check text-xs"></i></div>
            </div>
        </div>

        <div onclick="setFilter('menipis')" class="border border-amber-200 rounded-2xl p-4 cursor-pointer transition ${activeClass('menipis')}">
            <div class="flex justify-between items-start">
                <div>
                    <div class="text-[11px] font-semibold text-amber-600/80 uppercase tracking-wide">Menipis</div>
                    <div class="text-2xl font-bold text-amber-600 mt-1">${menipis}</div>
                </div>
                <div class="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center text-amber-500"><i class="fa-solid fa-triangle-exclamation text-xs"></i></div>
            </div>
        </div>

        <div onclick="setFilter('habis')" class="border border-rose-200 rounded-2xl p-4 cursor-pointer transition ${activeClass('habis')}">
            <div class="flex justify-between items-start">
                <div>
                    <div class="text-[11px] font-semibold text-rose-600/80 uppercase tracking-wide">Stok Habis</div>
                    <div class="text-2xl font-bold text-rose-600 mt-1">${habis}</div>
                </div>
                <div class="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center text-rose-500"><i class="fa-solid fa-xmark text-xs"></i></div>
            </div>
        </div>
    `;
}

// =========================================================
// PAGINATION CONTROLS
// =========================================================
window.changePage = function(direction) {
    const totalPages = Math.ceil(filteredProductsCache.length / itemsPerPage) || 1;
    
    if (direction === 'prev' && currentPage > 1) {
        currentPage--;
        renderTable();
    } else if (direction === 'next' && currentPage < totalPages) {
        currentPage++;
        renderTable();
    }
}

window.goToPage = function(page) {
    currentPage = page;
    renderTable();
}

function renderPaginationUI(totalItems, totalPages) {
    // Info Texts
    const tableInfo = document.getElementById('tableInfo');
    const paginationInfoText = document.getElementById('paginationInfoText');
    const pageInfoMobile = document.getElementById('pageInfoMobile');
    
    const startIdx = totalItems === 0 ? 0 : ((currentPage - 1) * itemsPerPage) + 1;
    const endIdx = Math.min(currentPage * itemsPerPage, totalItems);

    if (tableInfo) tableInfo.textContent = `${totalItems} produk ditemukan`;
    if (paginationInfoText) paginationInfoText.innerHTML = `Menampilkan <span class="font-medium text-slate-700">${startIdx}</span> - <span class="font-medium text-slate-700">${endIdx}</span> dari <span class="font-medium text-slate-700">${totalItems}</span> produk`;
    if (pageInfoMobile) pageInfoMobile.textContent = `Page ${currentPage} of ${totalPages}`;

    // Buttons Disable/Enable State
    const btnPrev = document.getElementById('btnPrevPage');
    const btnNext = document.getElementById('btnNextPage');
    if (btnPrev) btnPrev.disabled = currentPage === 1;
    if (btnNext) btnNext.disabled = currentPage === totalPages || totalItems === 0;

    // Generate Page Numbers
    const pageNumbersContainer = document.getElementById('pageNumbers');
    if (pageNumbersContainer) {
        let buttonsHTML = '';
        let startP = Math.max(1, currentPage - 2);
        let endP = Math.min(totalPages, startP + 4);
        if (endP - startP < 4 && startP > 1) startP = Math.max(1, endP - 4);

        for (let i = startP; i <= endP; i++) {
            if (i === currentPage) {
                buttonsHTML += `<button class="w-8 h-8 rounded-lg bg-orange-500 text-white flex items-center justify-center text-xs font-medium shadow-sm">${i}</button>`;
            } else {
                buttonsHTML += `<button onclick="goToPage(${i})" class="w-8 h-8 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center justify-center text-xs font-medium transition">${i}</button>`;
            }
        }
        pageNumbersContainer.innerHTML = buttonsHTML;
    }
}

// =========================================================
// RENDER TABLE
// =========================================================
window.renderTable = function() {
    const tbody = document.getElementById('stokTableBody');
    if(!tbody) return;

    const totalItems = filteredProductsCache.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;

    // Ensure valid page if filter causes data to shrink
    if (currentPage > totalPages) currentPage = totalPages;

    renderPaginationUI(totalItems, totalPages);

    if (totalItems === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-16"><div class="flex flex-col items-center"><div class="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center mb-3"><i class="fa-solid fa-box-open text-slate-300 text-xl"></i></div><p class="text-xs font-semibold text-slate-500">Tidak ada produk ditemukan.</p></div></td></tr>`;
        return;
    }

    // SLICE DATA FOR PAGINATION
    const startIndex = (currentPage - 1) * itemsPerPage;
    const paginatedData = filteredProductsCache.slice(startIndex, startIndex + itemsPerPage);

    tbody.innerHTML = paginatedData.map(p => {
        const st = Number(p.stok) || 0;
        let badge = `<span class="bg-emerald-50 border border-emerald-200 text-emerald-700 px-2.5 py-1 rounded-lg font-semibold text-[10px]"><i class="fa-solid fa-check mr-1"></i>Aman</span>`;
        if (st <= 0) badge = `<span class="bg-rose-50 border border-rose-200 text-rose-700 px-2.5 py-1 rounded-lg font-semibold text-[10px]"><i class="fa-solid fa-xmark mr-1"></i>Habis</span>`;
        else if (st <= 10) badge = `<span class="bg-amber-50 border border-amber-200 text-amber-700 px-2.5 py-1 rounded-lg font-semibold text-[10px]"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Menipis</span>`;

        // Escape HTML for safety
        const safeName = String(p.nama || p.name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const safeCat = String(p.kategori || p.category || '-').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const safeImg = p.foto || p.image || 'https://placehold.co/80';

        return `
            <tr class="hover:bg-slate-50 transition">
                <td class="p-3"><img src="${safeImg}" class="w-10 h-10 object-cover rounded-xl shadow-sm border border-slate-100" onerror="this.src='https://placehold.co/80?text=Error'"></td>
                <td class="p-3 font-semibold text-slate-800">${safeName}</td>
                <td class="p-3"><span class="bg-slate-100 text-slate-600 px-2 py-1 rounded-md text-[10px] font-medium">${safeCat}</span></td>
                <td class="p-3 text-center font-bold text-slate-700 text-base">${st}</td>
                <td class="p-3 text-center">${badge}</td>
                <td class="p-3">
                    <div class="flex items-center justify-center gap-1.5">
                        <button onclick="modStock('${p.id}', ${st - 1})" class="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-red-500 transition font-bold shadow-sm" title="Kurangi 1">-</button>
                        <input type="number" value="${st}" id="stok-${p.id}" class="w-14 text-center text-sm font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-1.5 outline-none focus:border-orange-400 focus:bg-white transition" onchange="inputStock('${p.id}')">
                        <button onclick="modStock('${p.id}', ${st + 1})" class="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-emerald-500 transition font-bold shadow-sm" title="Tambah 1">+</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
};

// =========================================================
// UPDATE STOCK
// =========================================================
window.modStock = async function(id, val) {
    val = Math.max(0, Number(val) || 0);
    
    // Optimistic UI Update (Update layar dulu biar terasa cepat)
    const originalProducts = [...products]; 
    products = products.map(p => String(p.id) === String(id) ? { ...p, stok: val } : p);
    applyFiltersAndRender(); 

    try {
        await authReady;
        const { error } = await supabase.from('products').update({ stok: val }).eq('id', id);
        
        if (error) throw error;
        showStatus('Stok berhasil diperbarui.', 'success');

    } catch(e) { 
        // Jika gagal, kembalikan ke state awal
        products = originalProducts;
        applyFiltersAndRender();
        
        console.warn('Gagal update stok:', e);
        showStatus('Gagal mengupdate stok di database.', 'error'); 
    }
};

window.inputStock = async function(id) {
    const inputEl = document.getElementById(`stok-${id}`);
    if(inputEl) {
        const v = Number(inputEl.value);
        await modStock(id, v);
    }
};

// INITIALIZE
loadStok();
