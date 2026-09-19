import {
    supabase,
    authReady
} from '../supabase.js';

// =========================================================
// STATE
// =========================================================
let products = [];
let usingLocalStorage = false;
let isSaving = false;
let isDeleting = false;

// State Pagination
let currentPage = 1;
const itemsPerPage = 5;
let filteredProducts = []; // Menyimpan hasil pencarian

// =========================================================
// DOM HELPER
// =========================================================
const $ = (id) => document.getElementById(id);

// =========================================================
// FORMAT RUPIAH
// =========================================================
function rupiah(value) {
    const number = Number(value || 0);
    return 'Rp ' + number.toLocaleString('id-ID');
}

// =========================================================
// ESCAPE HTML
// =========================================================
function escapeHtml(value) {
    if (value === null || value === undefined) {
        return '';
    }
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// =========================================================
// GETTERS
// =========================================================
function getProductName(product) {
    return String(product?.nama ?? product?.name ?? '').trim();
}

function getProductCategory(product) {
    return String(product?.kategori ?? product?.category ?? '').trim();
}

function getProductPrice(product) {
    return Number(product?.harga ?? product?.price ?? 0);
}

function getProductHpp(product) {
    return Number(product?.hpp ?? 0);
}

function getProductStock(product) {
    return Number(product?.stok ?? product?.stock ?? 0);
}

function getProductImage(product) {
    return String(product?.foto ?? product?.image ?? '').trim();
}

function getProductDescription(product) {
    return String(product?.deskripsi ?? product?.desc ?? '').trim();
}

// =========================================================
// URL IMAGE
// =========================================================
function validImageUrl(url) {
    if (!url) return false;
    try {
        const parsed = new URL(url);
        return (parsed.protocol === 'http:' || parsed.protocol === 'https:');
    } catch {
        return false;
    }
}

function fallbackImage() {
    return 'https://placehold.co/80x80?text=Produk';
}

// =========================================================
// LOCAL STORAGE
// =========================================================
function saveLocalProducts() {
    try {
        localStorage.setItem('local_products', JSON.stringify(products));
    } catch (error) {
        console.warn('LocalStorage gagal:', error);
    }
}

// =========================================================
// STATUS MESSAGE & CONNECTION
// =========================================================
function showStatus(message, type = 'success') {
    const box = $('statusBox');
    if (!box) return;

    box.className = 'mb-5 rounded-xl px-4 py-3 text-xs border';

    if (type === 'success') {
        box.classList.add('bg-emerald-50', 'text-emerald-700', 'border-emerald-200');
        box.innerHTML = '<i class="fa-solid fa-circle-check mr-2"></i>' + escapeHtml(message);
    } else if (type === 'warning') {
        box.classList.add('bg-amber-50', 'text-amber-700', 'border-amber-200');
        box.innerHTML = '<i class="fa-solid fa-triangle-exclamation mr-2"></i>' + escapeHtml(message);
    } else {
        box.classList.add('bg-red-50', 'text-red-700', 'border-red-200');
        box.innerHTML = '<i class="fa-solid fa-circle-exclamation mr-2"></i>' + escapeHtml(message);
    }
    
    box.classList.remove('hidden');
}

function hideStatus() {
    $('statusBox')?.classList.add('hidden');
}

function setConnectionStatus(connected, localMode = false) {
    const element = $('connectionStatus');
    if (!element) return;

    element.classList.remove('hidden');

    if (localMode) {
        element.className = 'text-[10px] text-amber-600';
        element.innerHTML = '<i class="fa-solid fa-hard-drive mr-1"></i> Mode Local Storage';
        return;
    }

    if (connected) {
        element.className = 'text-[10px] text-emerald-600';
        element.innerHTML = '<i class="fa-solid fa-circle-check mr-1"></i> Terhubung ke Supabase';
    } else {
        element.className = 'text-[10px] text-red-600';
        element.innerHTML = '<i class="fa-solid fa-circle-xmark mr-1"></i> Supabase tidak terhubung';
    }
}

// =========================================================
// MODAL CONTROLS
// =========================================================
function openModal(mode = 'add') {
    const modalOverlay = $('productModalOverlay');
    const modalContent = $('productModalContent');
    const formTitle = $('formTitle');
    const btnSaveText = $('btnSaveText');
    const btnCancelEdit = $('btnCancelEdit');

    if (!modalOverlay || !modalContent) return;

    modalOverlay.classList.remove('hidden');
    
    setTimeout(() => {
        modalOverlay.classList.remove('opacity-0');
        modalContent.classList.remove('scale-95', 'translate-y-10');
    }, 10);

    if (mode === 'edit') {
        if(formTitle) formTitle.innerHTML = '<i class="fa-solid fa-pen-to-square text-sky-500"></i> Edit Produk';
        if(btnSaveText) btnSaveText.textContent = 'Update Produk';
        if(btnCancelEdit) btnCancelEdit.classList.remove('hidden');
    } else {
        if(formTitle) formTitle.innerHTML = '<i class="fa-solid fa-plus-circle text-orange-500"></i> Tambah Produk';
        if(btnSaveText) btnSaveText.textContent = 'Simpan Produk';
        if(btnCancelEdit) btnCancelEdit.classList.add('hidden');
        resetForm();
    }
}

function closeModal() {
    const modalOverlay = $('productModalOverlay');
    const modalContent = $('productModalContent');

    if (!modalOverlay || !modalContent) return;

    modalOverlay.classList.add('opacity-0');
    modalContent.classList.add('scale-95', 'translate-y-10');
    
    setTimeout(() => {
        modalOverlay.classList.add('hidden');
        resetForm();
    }, 300);
}

// =========================================================
// PAGINATION CONTROLS
// =========================================================
function renderPaginationInfo(totalItems, totalPages) {
    const countInfo = $('productCount');
    const pageInfoMobile = $('pageInfoMobile');
    
    if (totalItems === 0) {
        if (countInfo) countInfo.textContent = 'Tidak ada produk ditemukan';
        if (pageInfoMobile) pageInfoMobile.textContent = 'Page 0 of 0';
        return;
    }

    const startIdx = ((currentPage - 1) * itemsPerPage) + 1;
    const endIdx = Math.min(currentPage * itemsPerPage, totalItems);
    
    if (countInfo) {
        countInfo.innerHTML = `Menampilkan <span class="font-medium text-slate-700">${startIdx}</span> sampai <span class="font-medium text-slate-700">${endIdx}</span> dari <span class="font-medium text-slate-700">${totalItems}</span> produk`;
    }
    if (pageInfoMobile) {
        pageInfoMobile.textContent = `Page ${currentPage} of ${totalPages}`;
    }

    const btnPrev = $('btnPrevPage');
    const btnNext = $('btnNextPage');
    
    if (btnPrev) btnPrev.disabled = currentPage === 1;
    if (btnNext) btnNext.disabled = currentPage === totalPages;

    const pageNumbersContainer = $('pageNumbers');
    if (pageNumbersContainer) {
        let buttonsHTML = '';
        let startPage = Math.max(1, currentPage - 2);
        let endPage = Math.min(totalPages, startPage + 4);
        
        if (endPage - startPage < 4 && startPage > 1) {
            startPage = Math.max(1, endPage - 4);
        }

        for (let i = startPage; i <= endPage; i++) {
            if (i === currentPage) {
                buttonsHTML += `<button class="w-8 h-8 rounded-lg bg-orange-500 text-white flex items-center justify-center text-xs font-medium shadow-sm">${i}</button>`;
            } else {
                buttonsHTML += `<button data-page="${i}" class="btn-page-number w-8 h-8 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center justify-center text-xs font-medium transition">${i}</button>`;
            }
        }
        pageNumbersContainer.innerHTML = buttonsHTML;
    }
}

function changePage(direction) {
    const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);
    
    if (direction === 'prev' && currentPage > 1) {
        currentPage--;
        renderTable(filteredProducts);
    } else if (direction === 'next' && currentPage < totalPages) {
        currentPage++;
        renderTable(filteredProducts);
    }
}

function goToPage(pageNumber) {
    const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);
    if (pageNumber >= 1 && pageNumber <= totalPages) {
        currentPage = pageNumber;
        renderTable(filteredProducts);
    }
}

// =========================================================
// AUTH CHECK
// =========================================================
async function checkAuth() {
    try {
        await authReady;
        const { data, error } = await supabase.auth.getSession();
        if (error) {
            console.warn('getSession error:', error);
            return null;
        }
        return data?.session || null;
    } catch (error) {
        console.warn('Auth check gagal:', error);
        return null;
    }
}

// =========================================================
// LOAD PRODUCTS
// =========================================================
async function loadProducts() {
    const tbody = $('prodTable');

    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center py-10 text-slate-400">
                    <i class="fa-solid fa-circle-notch loading-spinner text-orange-500 mr-2"></i>
                    Memuat produk...
                </td>
            </tr>
        `;
    }

    try {
        await authReady;
        const { data, error } = await supabase
            .from('products')
            .select('*')
            .order('nama', { ascending: true });

        if (error) throw error;

        products = Array.isArray(data) ? data : [];
        filteredProducts = [...products];

        usingLocalStorage = false;
        setConnectionStatus(true, false);
        saveLocalProducts();
        
        renderTable(filteredProducts);
    } catch (error) {
        console.error('Supabase load error:', error);
        let localData = [];

        try {
            const stored = localStorage.getItem('local_products');
            localData = stored ? JSON.parse(stored) : [];
        } catch {
            localData = [];
        }

        products = Array.isArray(localData) ? localData : [];
        filteredProducts = [...products];

        usingLocalStorage = true;
        setConnectionStatus(false, true);
        
        renderTable(filteredProducts);
        showStatus('Supabase gagal mengambil data. Mode Local Storage digunakan. ' + getErrorMessage(error), 'warning');
    }
}

// =========================================================
// RENDER TABLE
// =========================================================
function renderTable(dataList) {
    const tbody = $('prodTable');
    if (!tbody) return;

    const list = Array.isArray(dataList) ? dataList : [];

    // Pagination Logic
    const totalItems = list.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
    
    if (currentPage > totalPages) currentPage = totalPages;

    renderPaginationInfo(totalItems, totalPages);

    if (totalItems === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center py-12">
                    <div class="flex flex-col items-center">
                        <div class="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-3">
                            <i class="fa-solid fa-box-open text-slate-400"></i>
                        </div>
                        <p class="text-xs font-semibold text-slate-500">Belum ada produk</p>
                        <p class="text-[10px] text-slate-400 mt-1">Tambahkan produk menggunakan form.</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    // Slice array data sesuai pagination
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const paginatedList = list.slice(startIndex, endIndex);

    tbody.innerHTML = paginatedList.map(product => {
        const id = product?.id ?? '';
        const name = getProductName(product) || '-';
        const category = getProductCategory(product) || '-';
        const price = getProductPrice(product);
        const hpp = getProductHpp(product);
        const stock = getProductStock(product);
        const image = getProductImage(product);
        const imageSrc = validImageUrl(image) ? image : fallbackImage();

        let stockClass = 'text-emerald-600';
        if (stock <= 0) stockClass = 'text-red-600';
        else if (stock <= 5) stockClass = 'text-amber-600';

        return `
            <tr class="hover:bg-slate-50 transition">
                <td class="p-3">
                    <img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(name)}" loading="lazy" class="w-12 h-12 object-cover rounded-xl shadow-sm border border-slate-100" onerror="this.onerror=null;this.src='${fallbackImage()}'">
                </td>
                <td class="p-3">
                    <div class="font-semibold text-slate-800">${escapeHtml(name)}</div>
                    ${getProductDescription(product) ? `<div class="text-[10px] text-slate-400 mt-1 max-w-xs truncate">${escapeHtml(getProductDescription(product))}</div>` : ''}
                </td>
                <td class="p-3">
                    <span class="bg-slate-100 text-slate-600 px-2 py-1 rounded-lg text-[10px] font-medium">${escapeHtml(category)}</span>
                </td>
                <td class="p-3 font-bold text-orange-600">${rupiah(price)}</td>
                <td class="p-3 text-slate-600">${rupiah(hpp)}</td>
                <td class="p-3 font-bold ${stockClass}">${stock}</td>
                <td class="p-3">
                    <div class="flex gap-1">
                        <button type="button" data-action="edit" data-id="${escapeHtml(id)}" class="bg-sky-50 text-sky-600 hover:bg-sky-100 p-2 rounded-lg transition" title="Edit">
                            <i class="fa-solid fa-pen pointer-events-none"></i>
                        </button>
                        <button type="button" data-action="delete" data-id="${escapeHtml(id)}" class="bg-rose-50 text-rose-600 hover:bg-rose-100 p-2 rounded-lg transition" title="Hapus">
                            <i class="fa-solid fa-trash pointer-events-none"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// =========================================================
// FILTER & SEARCH
// =========================================================
function filterTable() {
    const searchInput = $('p-search');
    if(!searchInput) return;

    const keyword = searchInput.value.toLowerCase().trim();
    const btnClear = $('btnClearProductSearch');

    if (!keyword) {
        if(btnClear) btnClear.classList.add('hidden');
        filteredProducts = [...products];
        renderTable(filteredProducts);
        return;
    }

    if(btnClear) btnClear.classList.remove('hidden');

    filteredProducts = products.filter(product => {
        const name = getProductName(product).toLowerCase();
        const category = getProductCategory(product).toLowerCase();
        const description = getProductDescription(product).toLowerCase();

        return (name.includes(keyword) || category.includes(keyword) || description.includes(keyword));
    });

    currentPage = 1; // Reset halaman ke 1 saat pencarian
    renderTable(filteredProducts);
}

function clearSearch() {
    const searchInput = $('p-search');
    if (searchInput) searchInput.value = '';
    filterTable();
}

// =========================================================
// FORM DATA
// =========================================================
function getFormData() {
    const nama = $('p-nama').value.trim();
    const kategori = $('p-kategori').value.trim().toLowerCase();
    const hargaRaw = $('p-harga').value.trim();
    const hppRaw = $('p-hpp').value.trim();
    const stokRaw = $('p-stok').value.trim();
    const foto = $('p-foto').value.trim();
    const deskripsi = $('p-deskripsi').value.trim();

    const harga = Number(hargaRaw);
    const hpp = hppRaw === '' ? 0 : Number(hppRaw);
    const stok = stokRaw === '' ? 0 : Number(stokRaw);

    if (!nama) throw new Error('Nama produk wajib diisi.');
    if (!Number.isFinite(harga) || harga <= 0) throw new Error('Harga jual harus lebih besar dari 0.');
    if (!Number.isFinite(hpp) || hpp < 0) throw new Error('HPP tidak boleh negatif.');
    if (!Number.isFinite(stok) || stok < 0 || !Number.isInteger(stok)) throw new Error('Stok harus berupa angka bulat 0 atau lebih.');
    if (foto && !validImageUrl(foto)) throw new Error('URL foto tidak valid.');

    return { nama, kategori, harga, hpp, stok, foto, deskripsi };
}

// =========================================================
// RESET FORM
// =========================================================
function resetForm() {
    if($('p-id')) $('p-id').value = '';
    if($('p-nama')) $('p-nama').value = '';
    if($('p-kategori')) $('p-kategori').value = '';
    if($('p-harga')) $('p-harga').value = '';
    if($('p-hpp')) $('p-hpp').value = '';
    if($('p-stok')) $('p-stok').value = '';
    if($('p-foto')) $('p-foto').value = '';
    if($('p-deskripsi')) $('p-deskripsi').value = '';

    $('btnCancelEdit')?.classList.add('hidden');
    if($('formTitle')) $('formTitle').innerHTML = '<i class="fa-solid fa-plus-circle text-orange-500"></i> Tambah Produk';
    if($('btnSaveText')) $('btnSaveText').textContent = 'Simpan Produk';

    hidePhotoPreview();
}

// =========================================================
// EDIT PRODUCT
// =========================================================
function editProduct(id) {
    const product = products.find(item => String(item?.id) === String(id));

    if (!product) {
        showStatus('Produk tidak ditemukan di data aplikasi.', 'error');
        return;
    }

    if($('p-id')) $('p-id').value = product.id ?? '';
    if($('p-nama')) $('p-nama').value = getProductName(product);
    if($('p-kategori')) $('p-kategori').value = getProductCategory(product);
    if($('p-harga')) $('p-harga').value = getProductPrice(product) || '';
    if($('p-hpp')) $('p-hpp').value = getProductHpp(product) || '';
    if($('p-stok')) $('p-stok').value = getProductStock(product);
    if($('p-foto')) $('p-foto').value = getProductImage(product);
    if($('p-deskripsi')) $('p-deskripsi').value = getProductDescription(product);

    updatePhotoPreview();
    openModal('edit'); 
}

// =========================================================
// PHOTO PREVIEW
// =========================================================
function hidePhotoPreview() {
    $('photoPreview')?.classList.add('hidden');
    if($('previewImage')) $('previewImage').src = '';
}

function updatePhotoPreview() {
    const url = $('p-foto')?.value.trim();
    if (!url || !validImageUrl(url)) {
        hidePhotoPreview();
        return;
    }
    const image = $('previewImage');
    if(!image) return;
    image.onerror = () => hidePhotoPreview();
    image.onload = () => $('photoPreview')?.classList.remove('hidden');
    image.src = url;
}

// =========================================================
// SAVE PRODUCT
// =========================================================
async function saveProduct() {
    if (isSaving) return;
    isSaving = true;

    const button = $('btnSave');
    const buttonText = $('btnSaveText');

    if(button) button.disabled = true;
    if(buttonText) buttonText.textContent = 'Menyimpan...';

    try {
        const id = $('p-id')?.value.trim();
        const payload = getFormData();

        // LOCAL STORAGE MODE
        if (usingLocalStorage) {
            if (id) {
                const index = products.findIndex(item => String(item.id) === String(id));
                if (index === -1) throw new Error('Produk tidak ditemukan di Local Storage.');
                
                products[index] = { ...products[index], ...payload };
                showStatus('Produk berhasil diperbarui di Local Storage.', 'success');
            } else {
                const newId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
                products.unshift({ id: newId, ...payload, created_at: new Date().toISOString() });
                showStatus('Produk berhasil ditambahkan ke Local Storage.', 'success');
            }

            saveLocalProducts();
            filteredProducts = [...products]; 
            renderTable(filteredProducts);
            closeModal();
            return;
        }

        // SUPABASE MODE
        await checkAuth();

        if (id) {
            // UPDATE
            const { data: updatedRows, error: updateError } = await supabase
                .from('products')
                .update(payload)
                .eq('id', id)
                .select('*');

            if (updateError) throw updateError;
            if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
                throw new Error('UPDATE gagal. ID tidak ditemukan atau RLS policy memblokir.');
            }

            showStatus('Produk berhasil diperbarui dari database Supabase.', 'success');
            closeModal(); 
            await loadProducts();
            return;
        }

        // INSERT
        const { data: insertedRows, error: insertError } = await supabase
            .from('products')
            .insert([payload])
            .select('*');

        if (insertError) throw insertError;
        if (!Array.isArray(insertedRows) || insertedRows.length === 0) {
            throw new Error('INSERT tidak menghasilkan row baru.');
        }

        showStatus('Produk baru berhasil disimpan di Supabase.', 'success');
        closeModal(); 
        await loadProducts();

    } catch (error) {
        console.error('SAVE PRODUCT ERROR:', error);
        showStatus(formatSupabaseError(error), 'error');
    } finally {
        isSaving = false;
        if(button) button.disabled = false;
        if(buttonText) buttonText.textContent = $('p-id')?.value.trim() ? 'Update Produk' : 'Simpan Produk';
    }
}

// =========================================================
// DELETE PRODUCT
// =========================================================
async function deleteProduct(id) {
    if (isDeleting) return;

    const product = products.find(item => String(item?.id) === String(id));
    const productName = product ? getProductName(product) : 'produk ini';
    
    if (!confirm(`Hapus "${productName}"?\n\nData yang dihapus tidak dapat dikembalikan.`)) return;

    isDeleting = true;

    try {
        if (usingLocalStorage) {
            const before = products.length;
            products = products.filter(item => String(item.id) !== String(id));
            if (products.length === before) throw new Error('Produk tidak ditemukan.');
            
            saveLocalProducts();
            filteredProducts = [...products]; 
            
            const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);
            if (currentPage > totalPages && currentPage > 1) currentPage--;
            
            renderTable(filteredProducts);
            showStatus('Produk berhasil dihapus dari Local Storage.', 'success');
            return;
        }

        const { data: deletedRows, error: deleteError } = await supabase
            .from('products')
            .delete()
            .eq('id', id)
            .select('*');

        if (deleteError) throw deleteError;
        if (!Array.isArray(deletedRows) || deletedRows.length === 0) {
            throw new Error('Gagal menghapus. ID tidak ditemukan atau RLS policy memblokir.');
        }

        showStatus('Produk berhasil dihapus dari Supabase.', 'success');
        await loadProducts();
        
    } catch (error) {
        console.error('DELETE PRODUCT ERROR:', error);
        showStatus(formatSupabaseError(error), 'error');
    } finally {
        isDeleting = false;
    }
}

// =========================================================
// ERROR FORMATTER
// =========================================================
function getErrorMessage(error) {
    if (!error) return 'Unknown error';
    return (error.message || error.error_description || error.details || error.hint || String(error));
}

function formatSupabaseError(error) {
    const message = getErrorMessage(error);
    const lower = message.toLowerCase();

    if (lower.includes('row-level security') || lower.includes('permission denied') || lower.includes('rls')) {
        return 'Supabase menolak operasi karena RLS. Periksa policy SELECT, INSERT, UPDATE, dan DELETE pada tabel products.';
    }
    if (lower.includes('jwt') || lower.includes('invalid token') || lower.includes('token is expired')) {
        return 'Session Supabase tidak valid atau sudah expired. Silakan login kembali.';
    }
    if (lower.includes('duplicate') || lower.includes('unique')) {
        return 'Data duplikat. Nilai yang harus unik sudah digunakan.';
    }
    if (lower.includes('column') && lower.includes('does not exist')) {
        return 'Kolom database tidak ditemukan. Pastikan nama kolom products sesuai dengan kode.';
    }
    if (lower.includes('relation') && lower.includes('does not exist')) {
        return 'Tabel products tidak ditemukan di Supabase.';
    }
    return 'Operasi database gagal: ' + message;
}

// =========================================================
// EVENTS
// =========================================================
// Form Events
$('btnSave')?.addEventListener('click', saveProduct);
$('p-foto')?.addEventListener('input', updatePhotoPreview);

// Modal Events
$('btnOpenAddModal')?.addEventListener('click', () => openModal('add'));
$('btnCloseModal')?.addEventListener('click', closeModal);
$('btnCancelModal')?.addEventListener('click', closeModal);
$('btnCancelEdit')?.addEventListener('click', closeModal); 
$('productModalOverlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'productModalOverlay') closeModal();
});

// Search & Refresh Events
$('btnRefresh')?.addEventListener('click', async () => {
    hideStatus();
    await loadProducts();
});
$('p-search')?.addEventListener('input', filterTable);
$('btnClearProductSearch')?.addEventListener('click', clearSearch);

// Pagination Events
$('btnPrevPage')?.addEventListener('click', () => changePage('prev'));
$('btnNextPage')?.addEventListener('click', () => changePage('next'));
$('pageNumbers')?.addEventListener('click', event => {
    const button = event.target.closest('button[data-page]');
    if (!button) return;
    const page = parseInt(button.dataset.page);
    if (page) goToPage(page);
});

// Table Event Delegation (Edit & Delete)
$('prodTable')?.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const action = button.dataset.action;
    const id = button.dataset.id;

    if (!id) {
        showStatus('ID produk kosong. Periksa kolom id di database.', 'error');
        return;
    }

    if (action === 'edit') editProduct(id);
    if (action === 'delete') deleteProduct(id);
});

// =========================================================
// INITIALIZE
// =========================================================
(async function init() {
    try {
        await authReady;
        await checkAuth();
        await loadProducts();
    } catch (error) {
        console.error('INITIALIZATION ERROR:', error);
        showStatus(getErrorMessage(error), 'error');
    }
})();
