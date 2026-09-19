import { supabase, authReady } from '../supabase.js';

// =========================================================
// STATE & VARIABLES
// =========================================================
let products = [];
let filterStatus = 'all'; // Status: 'all', 'aman', 'menipis', 'habis'
let selectedKategori = 'all';

// State Pagination
let currentPage = 1;
const itemsPerPage = 5;
let filteredProductsCache = []; 

// =========================================================
// HELPER: NOTIFICATION (Pengganti Alert)
// =========================================================
window.showStatus = function(message, type = 'error') {
    let box = document.getElementById('statusBox');
    
    // Auto-inject UI Notifikasi jika tidak ada di HTML
    if (!box) {
        box = document.createElement('div');
        box.id = 'statusBox';
        document.body.appendChild(box);
    }

    box.className = 'fixed top-6 right-6 z-50 rounded-xl px-4 py-3 text-sm border flex items-center justify-between shadow-xl transition-all font-medium';
    
    if (type === 'error') {
        box.classList.add('bg-red-50', 'border-red-200', 'text-red-700');
        box.innerHTML = `<i class="fa-solid fa-circle-exclamation mr-2"></i> ${message}`;
    } else {
        box.classList.add('bg-emerald-50', 'border-emerald-200', 'text-emerald-700');
        box.innerHTML = `<i class="fa-solid fa-circle-check mr-2"></i> ${message}`;
    }

    // Auto hapus setelah 3.5 detik
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
    renderSummary(); // Summary selalu pakai global data
    window.applyFiltersAndRender();
};

// =========================================================
// KATEGORI & FILTERING
// =========================================================
function extractCategories() {
    let select = document.getElementById('kategoriFilter');
    
    // Auto-inject Dropdown Kategori ke HTML jika belum ada
    if (!select) {
        const searchInput = document.getElementById('stokSearch');
        if (searchInput) {
            select = document.createElement('select');
            select.id = 'kategoriFilter';
            select.className = 'bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-xs outline-none cursor-pointer focus:border-orange-400 focus:bg-white transition w-full md:w-auto mb-3 md:mb-0 mr-0 md:mr-3';
            select.onchange = window.applyFiltersAndRender;
            searchInput.parentNode.insertBefore(select, searchInput);
        } else {
            return;
        }
    }

    // Ekstrak kategori unik dari data Supabase
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
// RENDER SUMMARY (SELALU GLOBAL)
// =========================================================
function renderSummary() {
    const summaryContainer = document.getElementById('stokSummary');
    if(!summaryContainer) return;

    // Menghitung SELURUH produk, mengabaikan pencarian & dropdown kategori
    let total = products.length, aman = 0, menipis = 0, habis = 0;
    
    products.forEach(p => {
        const st = Number(p.stok) || 0;
        if (st <= 0) habis++;
        else if (st <= 10) menipis++;
        else aman++;
    });

    const activeClass = (target) => filterStatus === target 
        ? 'ring-2 ring-orange-500 bg-orange-50/30 shadow-md' 
        : 'border-slate-200 bg-white hover:bg-slate-50 opacity-80 hover:opacity-100';

    summaryContainer.innerHTML = `
        <div onclick="setFilter('all')" class="border rounded-2xl p-4 cursor-pointer transition ${activeClass('all')}">
            <div class="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Total Produk</div>
            <div class="text-2xl font-bold text-slate-800 mt-1">${total}</div>
        </div>
        <div onclick="setFilter('aman')" class="border rounded-2xl p-4 cursor-pointer transition ${activeClass('aman')}">
            <div class="text-[11px] font-semibold text-emerald-600/80 uppercase tracking-wide">Stok Aman</div>
            <div class="text-2xl font-bold text-emerald-600 mt-1">${aman}</div>
        </div>
        <div onclick="setFilter('menipis')" class="border rounded-2xl p-4 cursor-pointer transition ${activeClass('menipis')}">
            <div class="text-[11px] font-semibold text-amber-600/80 uppercase tracking-wide">Menipis</div>
            <div class="text-2xl font-bold text-amber-600 mt-1">${menipis}</div>
        </div>
        <div onclick="setFilter('habis')" class="border rounded-2xl p-4 cursor-pointer transition ${activeClass('habis')}">
            <div class="text-[11px] font-semibold text-rose-600/80 uppercase tracking-wide">Stok Habis</div>
            <div class="text-2xl font-bold text-rose-600 mt-1">${habis}</div>
        </div>
    `;
}

// =========================================================
// LOGIKA FILTER TABEL
// =========================================================
window.applyFiltersAndRender = function() {
    const searchInput = document.getElementById('stokSearch');
    const kw = searchInput ? searchInput.value.toLowerCase().trim() : '';
    
    const catSelect = document.getElementById('kategoriFilter');
    selectedKategori = catSelect ? catSelect.value : 'all';

    // Filter KHUSUS untuk TABEL berdasarkan gabungan Ketiganya
    filteredProductsCache = products.filter(p => {
        // 1. Cek Pencarian (Nama)
        const nameMatch = String(p.nama || p.name || '').toLowerCase().includes(kw);
        
        // 2. Cek Dropdown Kategori
        const cat = String(p.kategori || p.category || '').trim();
        const catMatch = selectedKategori === 'all' || cat === selectedKategori;
        
        // 3. Cek Status (Aman/Menipis/Habis)
        const st = Number(p.stok) || 0;
        let statusMatch = true;
        if (filterStatus === 'habis') statusMatch = st <= 0;
        else if (filterStatus === 'menipis') statusMatch = st > 0 && st <= 10;
        else if (filterStatus === 'aman') statusMatch = st > 10;

        return nameMatch && catMatch && statusMatch;
    });

    // Reset halaman ke 1 tiap kali parameter pencarian berubah
    currentPage = 1;
    renderTable();
};

window.setFilter = function(st) {
    filterStatus = st;
    renderSummary(); // Hanya memperbarui styling kotak klik
    window.applyFiltersAndRender(); // Update isi tabel
};

// =========================================================
// PAGINATION UI & LOGIC
// =========================================================
function ensurePaginationUI() {
    let container = document.getElementById('paginationContainer');
    // Auto-inject UI Pagination di bawah tabel jika HTML belum memilikinya
    if (!container) {
        const tableBody = document.getElementById('stokTableBody');
        if (tableBody) {
            const wrapper = tableBody.closest('.overflow-x-auto') || tableBody.parentNode;
            container = document.createElement('div');
            container.id = 'paginationContainer';
            container.className = 'flex flex-col sm:flex-row justify-between items-center gap-4 mt-5 pt-4 border-t border-slate-100';
            wrapper.parentNode.insertBefore(container, wrapper.nextSibling);
        }
    }
    return container;
}

window.changePage = function(direction) {
    const totalPages = Math.ceil(filteredProductsCache.length / itemsPerPage);
    if (direction === 'prev' && currentPage > 1) currentPage--;
    else if (direction === 'next' && currentPage < totalPages) currentPage++;
    window.renderTable();
};

window.goToPage = function(page) {
    currentPage = page;
    window.renderTable();
};

// =========================================================
// RENDER TABEL UTAMA
// =========================================================
window.renderTable = function() {
    const tbody = document.getElementById('stokTableBody');
    if(!tbody) return;

    const totalItems = filteredProductsCache.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;

    // Mencegah bug out-of-bounds saat filter mempersempit jumlah halaman
    if (currentPage > totalPages) currentPage = totalPages;

    // RENDER DATA
    if (totalItems === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-12 text-slate-400">Tidak ada produk yang cocok dengan filter.</td></tr>`;
    } else {
        const startIdx = (currentPage - 1) * itemsPerPage;
        const paginatedData = filteredProductsCache.slice(startIdx, startIdx + itemsPerPage);

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

    // RENDER PAGINATION
    const container = ensurePaginationUI();
    if (container) {
        if (totalItems === 0) {
            container.innerHTML = ''; // Sembunyikan pagination jika kosong
        } else {
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
    }
};

// =========================================================
// UPDATE STOCK DB
// =========================================================
window.modStock = async function(id, val) {
    val = Math.max(0, Number(val) || 0);
    
    // Update Optimistis agar UI tidak terasa lemot/lag
    products = products.map(p => String(p.id) === String(id) ? { ...p, stok: val } : p);
    renderSummary(); 
    window.applyFiltersAndRender();

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
    const v = Number(document.getElementById(`stok-${id}`).value);
    window.modStock(id, v);
};

// =========================================================
// INIT
// =========================================================
// Memaksa Input Search memanggil applyFiltersAndRender bukan renderTable langsung
const searchEl = document.getElementById('stokSearch');
if(searchEl) searchEl.oninput = window.applyFiltersAndRender;

loadStok();
