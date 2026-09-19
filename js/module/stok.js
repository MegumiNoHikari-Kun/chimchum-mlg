import { supabase, authReady } from '../supabase.js';

// =========================================================
// STATE & VARIABLES
// =========================================================
let products = [];
let filteredProducts = [];
let filterStatus = 'all'; // Status: 'all', 'aman', 'menipis', 'habis'
let selectedKategori = 'all';

// State Pagination
let currentPage = 1;
const itemsPerPage = 5;

// =========================================================
// HELPER: NOTIFICATION
// =========================================================
window.showStatus = function(message, type = 'error') {
    let box = document.getElementById('statusBox');
    if (!box) {
        box = document.createElement('div');
        box.id = 'statusBox';
        document.body.appendChild(box);
    }

    box.className = 'fixed top-6 right-6 z-50 rounded-xl px-4 py-3 text-sm border flex items-center justify-between shadow-xl transition-all font-medium bg-white';
    
    if (type === 'error') {
        box.classList.add('bg-red-50', 'border-red-200', 'text-red-700');
        box.innerHTML = `<i class="fa-solid fa-circle-exclamation mr-2"></i> ${message}`;
    } else {
        box.classList.add('bg-emerald-50', 'border-emerald-200', 'text-emerald-700');
        box.innerHTML = `<i class="fa-solid fa-circle-check mr-2"></i> ${message}`;
    }

    setTimeout(() => { box.remove(); }, 3500);
}

// =========================================================
// LOAD DATA
// =========================================================
window.loadStok = async function() {
    try {
        await authReady;
        const { data, error } = await supabase.from('products').select('*');
        if (error) throw error;
        if (data) products = data;
    } catch(e) { 
        console.warn('Gagal memuat dari Supabase:', e); 
        window.showStatus('Gagal memuat data dari server.', 'error');
    }
    
    extractCategories();
    window.filterData();
};

// =========================================================
// KATEGORI & FILTERING
// =========================================================
function extractCategories() {
    const select = document.getElementById('kategoriFilter');
    if (!select) return;

    const categories = new Set();
    products.forEach(p => {
        const cat = String(p.kategori || p.category || '').trim();
        if (cat) categories.add(cat);
    });

    const currentVal = select.value;
    select.innerHTML = '<option value="all">Semua Kategori</option>';
    
    Array.from(categories).sort().forEach(cat => {
        select.innerHTML += `<option value="${cat}">${cat}</option>`;
    });
    
    if (categories.has(currentVal)) select.value = currentVal;
}

// =========================================================
// RENDER SUMMARY (Disesuaikan dengan Filter Search & Kategori)
// =========================================================
function renderSummary() {
    const summaryContainer = document.getElementById('stokSummary');
    if(!summaryContainer) return;

    const searchInput = document.getElementById('stokSearch');
    const kw = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const catSelect = document.getElementById('kategoriFilter');
    const currentCat = catSelect ? catSelect.value : 'all';

    // Base products hanya terpengaruh search dan kategori, mengabaikan status tab
    const baseProducts = products.filter(p => {
        const nameMatch = String(p.nama || p.name || '').toLowerCase().includes(kw);
        const cat = String(p.kategori || p.category || '').trim();
        const catMatch = currentCat === 'all' || cat === currentCat;
        return nameMatch && catMatch;
    });

    let total = baseProducts.length, aman = 0, menipis = 0, habis = 0;
    
    baseProducts.forEach(p => {
        const st = Number(p.stok) || 0;
        if (st <= 0) habis++;
        else if (st <= 10) menipis++;
        else aman++;
    });

    const activeClass = (target) => filterStatus === target 
        ? 'ring-2 ring-orange-500 bg-orange-50/30 shadow-md' 
        : 'border-slate-200 bg-white hover:bg-slate-50 opacity-80 hover:opacity-100';

    summaryContainer.innerHTML = `
        <div onclick="window.setStatusFilter('all')" class="border rounded-2xl p-4 cursor-pointer transition ${activeClass('all')}">
            <div class="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Total Produk</div>
            <div class="text-2xl font-bold text-slate-800 mt-1">${total}</div>
        </div>
        <div onclick="window.setStatusFilter('aman')" class="border rounded-2xl p-4 cursor-pointer transition ${activeClass('aman')}">
            <div class="text-[11px] font-semibold text-emerald-600/80 uppercase tracking-wide">Stok Aman</div>
            <div class="text-2xl font-bold text-emerald-600 mt-1">${aman}</div>
        </div>
        <div onclick="window.setStatusFilter('menipis')" class="border rounded-2xl p-4 cursor-pointer transition ${activeClass('menipis')}">
            <div class="text-[11px] font-semibold text-amber-600/80 uppercase tracking-wide">Menipis</div>
            <div class="text-2xl font-bold text-amber-600 mt-1">${menipis}</div>
        </div>
        <div onclick="window.setStatusFilter('habis')" class="border rounded-2xl p-4 cursor-pointer transition ${activeClass('habis')}">
            <div class="text-[11px] font-semibold text-rose-600/80 uppercase tracking-wide">Stok Habis</div>
            <div class="text-2xl font-bold text-rose-600 mt-1">${habis}</div>
        </div>
    `;
}

// =========================================================
// LOGIKA UTAMA FILTER (Pencarian + Kategori + Status)
// =========================================================
window.filterData = function() {
    const searchInput = document.getElementById('stokSearch');
    const kw = searchInput ? searchInput.value.toLowerCase().trim() : '';
    
    const catSelect = document.getElementById('kategoriFilter');
    selectedKategori = catSelect ? catSelect.value : 'all';

    filteredProducts = products.filter(p => {
        const nameMatch = String(p.nama || p.name || '').toLowerCase().includes(kw);
        const cat = String(p.kategori || p.category || '').trim();
        const catMatch = selectedKategori === 'all' || cat === selectedKategori;
        
        const st = Number(p.stok) || 0;
        let statusMatch = true;
        if (filterStatus === 'habis') statusMatch = st <= 0;
        else if (filterStatus === 'menipis') statusMatch = st > 0 && st <= 10;
        else if (filterStatus === 'aman') statusMatch = st > 10;

        return nameMatch && catMatch && statusMatch;
    });

    currentPage = 1; // Reset ke halaman 1 setiap filter/pencarian berubah
    renderSummary();
    window.renderTable();
};

window.setStatusFilter = function(status) {
    filterStatus = status;
    window.filterData();
};

// =========================================================
// PAGINATION & TABLE RENDERING
// =========================================================
window.changePage = function(direction) {
    const totalPages = Math.ceil(filteredProducts.length / itemsPerPage) || 1;
    if (direction === 'prev' && currentPage > 1) currentPage--;
    else if (direction === 'next' && currentPage < totalPages) currentPage++;
    window.renderTable();
};

window.goToPage = function(page) {
    currentPage = page;
    window.renderTable();
};

window.renderTable = function() {
    const tbody = document.getElementById('stokTableBody');
    if(!tbody) return;

    const totalItems = filteredProducts.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;

    if (currentPage > totalPages) currentPage = totalPages;

    const tableInfo = document.getElementById('tableInfo');
    if (tableInfo) tableInfo.textContent = `${totalItems} produk ditemukan`;

    if (totalItems === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-12 text-slate-400">Tidak ada produk yang cocok dengan filter.</td></tr>`;
    } else {
        const startIdx = (currentPage - 1) * itemsPerPage;
        const paginatedData = filteredProducts.slice(startIdx, startIdx + itemsPerPage);

        tbody.innerHTML = paginatedData.map(p => {
            const st = Number(p.stok) || 0;
            let badge = `<span class="bg-emerald-50 border border-emerald-200 text-emerald-700 px-2.5 py-1 rounded-lg font-semibold text-[10px]">Aman</span>`;
            if (st <= 0) badge = `<span class="bg-rose-50 border border-rose-200 text-rose-700 px-2.5 py-1 rounded-lg font-semibold text-[10px]">Habis</span>`;
            else if (st <= 10) badge = `<span class="bg-amber-50 border border-amber-200 text-amber-700 px-2.5 py-1 rounded-lg font-semibold text-[10px]">Menipis</span>`;

            return `
                <tr class="hover:bg-slate-50 transition">
                    <td class="p-3"><img src="${p.foto || p.image || 'https://placehold.co/40'}" class="w-10 h-10 object-cover rounded-xl border border-slate-100 shadow-sm"></td>
                    <td class="p-3 font-semibold text-slate-800">${p.nama || p.name}</td>
                    <td class="p-3"><span class="bg-slate-100 text-slate-600 px-2 py-1 rounded-md text-[10px] font-medium">${p.kategori || p.category || '-'}</span></td>
                    <td class="p-3 font-bold text-center text-slate-700">${st}</td>
                    <td class="p-3 text-center">${badge}</td>
                    <td class="p-3">
                        <div class="flex items-center justify-center gap-1.5">
                            <button onclick="modStock('${p.id}', ${st - 1})" class="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-red-500 transition font-bold shadow-sm">-</button>
                            <input type="number" value="${st}" id="stok-${p.id}" class="w-14 text-center text-sm font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-1.5 outline-none focus:border-orange-400 focus:bg-white transition" onchange="inputStock('${p.id}')">
                            <button onclick="modStock('${p.id}', ${st + 1})" class="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-emerald-500 transition font-bold shadow-sm">+</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // Render Pagination Controls
    const container = document.getElementById('paginationContainer') || document.querySelector('.border-t.border-slate-100.mt-5');
    if (container && totalItems > 0) {
        const startNum = ((currentPage - 1) * itemsPerPage) + 1;
        const endNum = Math.min(currentPage * itemsPerPage, totalItems);
        
        let pagesHTML = '';
        let startP = Math.max(1, currentPage - 2);
        let endP = Math.min(totalPages, startP + 4);
        if (endP - startP < 4 && startP > 1) startP = Math.max(1, endP - 4);

        for (let i = startP; i <= endP; i++) {
            if (i === currentPage) {
                pagesHTML += `<button class="w-8 h-8 rounded-lg bg-orange-500 text-white flex items-center justify-center text-xs font-medium shadow-sm">${i}</button>`;
            } else {
                pagesHTML += `<button onclick="goToPage(${i})" class="w-8 h-8 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center justify-center text-xs font-medium transition">${i}</button>`;
            }
        }

        container.innerHTML = `
            <div class="text-[11px] text-slate-500">Menampilkan <span class="font-bold text-slate-700">${startNum}-${endNum}</span> dari <span class="font-bold text-slate-700">${totalItems}</span> produk</div>
            <div class="flex items-center gap-1">
                <button onclick="changePage('prev')" ${currentPage === 1 ? 'disabled' : ''} class="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 text-xs font-medium disabled:opacity-50 transition">Prev</button>
                <div class="flex gap-1 hidden sm:flex">${pagesHTML}</div>
                <button onclick="changePage('next')" ${currentPage === totalPages ? 'disabled' : ''} class="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 text-xs font-medium disabled:opacity-50 transition">Next</button>
            </div>
        `;
    }
};

// =========================================================
// UPDATE STOCK DB
// =========================================================
window.modStock = async function(id, val) {
    val = Math.max(0, Number(val) || 0);
    
    products = products.map(p => String(p.id) === String(id) ? { ...p, stok: val } : p);
    window.filterData();

    try {
        await authReady;
        const { error } = await supabase.from('products').update({ stok: val }).eq('id', id);
        if (error) throw error;
        window.showStatus('Stok berhasil diperbarui', 'success');
    } catch(e) { 
        window.showStatus('Gagal update stok di server: ' + e.message, 'error'); 
    }
};

window.inputStock = function(id) {
    const el = document.getElementById(`stok-${id}`);
    if (el) window.modStock(id, Number(el.value));
};

// Event listener pencarian otomatis
const searchEl = document.getElementById('stokSearch');
if(searchEl) searchEl.oninput = window.fiterData;
