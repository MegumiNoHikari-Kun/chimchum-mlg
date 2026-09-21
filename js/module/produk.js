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

// State Foto
let isUploading = false;

const STORAGE_BUCKET = 'menu';
const MAX_INPUT_SIZE = 15 * 1024 * 1024;  // batas file asli yang boleh dipilih
const MAX_UPLOAD_SIZE = 2 * 1024 * 1024;  // batas setelah dikompres
const MAX_IMAGE_DIMENSION = 1280;         // sisi terpanjang (px)
const IMAGE_EXT = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp'
};

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

function getProductIsi(product) {
    return String(product?.isi ?? '').trim();
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
                <td colspan="8" class="text-center py-10 text-slate-400">
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
                <td class="p-3 text-slate-600">${escapeHtml(getProductIsi(product) || '-')}</td>
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
        const isi = getProductIsi(product).toLowerCase();
        const description = getProductDescription(product).toLowerCase();

        return (name.includes(keyword) || category.includes(keyword) || isi.includes(keyword) || description.includes(keyword));
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
    const isi = $('p-isi').value.trim();
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

    return { nama, kategori, isi: isi || null, harga, hpp, stok, foto, deskripsi };
}

// =========================================================
// RESET FORM
// =========================================================
function resetForm() {
    if($('p-id')) $('p-id').value = '';
    if($('p-nama')) $('p-nama').value = '';
    if($('p-kategori')) $('p-kategori').value = '';
    if($('p-isi')) $('p-isi').value = '';
    if($('p-harga')) $('p-harga').value = '';
    if($('p-hpp')) $('p-hpp').value = '';
    if($('p-stok')) $('p-stok').value = '';
    if($('p-foto')) $('p-foto').value = '';
    if($('p-deskripsi')) $('p-deskripsi').value = '';

    $('btnCancelEdit')?.classList.add('hidden');
    if($('formTitle')) $('formTitle').innerHTML = '<i class="fa-solid fa-plus-circle text-orange-500"></i> Tambah Produk';
    if($('btnSaveText')) $('btnSaveText').textContent = 'Simpan Produk';

    hidePhotoPreview();
    hideUploadMessage();
    if ($('p-foto-file')) $('p-foto-file').value = '';
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
    if($('p-isi')) $('p-isi').value = getProductIsi(product);
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
// UPLOAD FOTO KE SUPABASE STORAGE
// =========================================================
function showUploadMessage(message, type = 'success') {
    const el = $('uploadMessage');
    if (!el) return;

    el.classList.remove('hidden', 'text-emerald-600', 'text-red-600', 'text-slate-500');
    el.classList.add(type === 'success' ? 'text-emerald-600' : type === 'error' ? 'text-red-600' : 'text-slate-500');
    el.textContent = message;
}

function hideUploadMessage() {
    $('uploadMessage')?.classList.add('hidden');
}

function setUploadState(uploading, label = 'Mengunggah...') {
    isUploading = uploading;

    const labelEl = $('uploadLabel');
    const text = $('uploadLabelText');
    const icon = $('uploadIcon');
    const saveBtn = $('btnSave');

    if (text) text.textContent = uploading ? label : 'Upload Foto';
    if (icon) icon.className = uploading
        ? 'fa-solid fa-circle-notch loading-spinner'
        : 'fa-solid fa-cloud-arrow-up';

    labelEl?.classList.toggle('opacity-60', uploading);
    labelEl?.classList.toggle('pointer-events-none', uploading);
    if (saveBtn) saveBtn.disabled = uploading;
}

class UploadValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'UploadValidationError';
    }
}

function formatBytes(bytes) {
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function validateImageFile(file) {
    if (!IMAGE_EXT[file.type]) {
        throw new UploadValidationError('Format file harus JPG, PNG, atau WEBP.');
    }
    if (file.size > MAX_INPUT_SIZE) {
        throw new UploadValidationError(
            `File terlalu besar (${formatBytes(file.size)}). Maksimal ${formatBytes(MAX_INPUT_SIZE)}.`
        );
    }
}

function canvasToBlob(canvas, type, quality) {
    return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

async function compressImage(file) {
    let bitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch {
        throw new UploadValidationError('File gambar tidak bisa dibaca. Coba file lain.');
    }

    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));

    // Sudah kecil dan dimensinya aman: langsung pakai file asli
    if (scale === 1 && file.size <= 500 * 1024) {
        bitmap.close?.();
        return file;
    }

    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; // latar putih (PNG transparan tidak jadi hitam)
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    // Turunkan kualitas bertahap sampai ukuran <= 2 MB
    for (const quality of [0.82, 0.7, 0.55, 0.4]) {
        let blob = await canvasToBlob(canvas, 'image/webp', quality);
        if (!blob || blob.type !== 'image/webp') {
            blob = await canvasToBlob(canvas, 'image/jpeg', quality); // fallback browser lama
        }
        if (blob && blob.size <= MAX_UPLOAD_SIZE) {
            return new File([blob], 'menu.' + IMAGE_EXT[blob.type], { type: blob.type });
        }
    }

    throw new UploadValidationError('Gambar masih terlalu besar setelah dikompres. Coba foto dengan resolusi lebih kecil.');
}

function buildFilePath(file) {
    const rand = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10);
    return `${Date.now()}-${rand}.${IMAGE_EXT[file.type]}`;
}

async function uploadProductImage(file) {
    await authReady;

    const filePath = buildFilePath(file);

    const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(filePath, file, {
            cacheControl: '3600',
            upsert: false,
            contentType: file.type
        });

    if (uploadError) throw uploadError;

    // Ambil URL publik
    const { data } = supabase.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(filePath);

    return { path: filePath, url: data.publicUrl };
}

function formatStorageError(error) {
    const message = getErrorMessage(error);
    const lower = message.toLowerCase();

    if (lower.includes('bucket not found')) {
        return `Bucket "${STORAGE_BUCKET}" tidak ditemukan di Supabase Storage.`;
    }
    if (lower.includes('row-level security') || lower.includes('violates') || lower.includes('unauthorized')) {
        return 'Upload ditolak oleh policy Storage. Pastikan sudah login dan policy INSERT untuk bucket menu sudah dibuat.';
    }
    if (lower.includes('payload too large') || lower.includes('exceeded')) {
        return 'Ukuran file melebihi batas bucket.';
    }
    return 'Upload gagal: ' + message;
}

async function handleFileSelected(event) {
    const input = event.target;
    const originalFile = input.files?.[0];
    if (!originalFile || isUploading) return;

    hideUploadMessage();

    try {
        validateImageFile(originalFile);

        setUploadState(true, 'Memproses...');
        const file = await compressImage(originalFile);

        setUploadState(true, 'Mengunggah...');
        const { url } = await uploadProductImage(file);

        $('p-foto').value = url;
        updatePhotoPreview();

        const sizeInfo = file === originalFile
            ? formatBytes(file.size)
            : `${formatBytes(originalFile.size)} → ${formatBytes(file.size)}`;
        showUploadMessage(`Foto berhasil diupload (${sizeInfo}). URL sudah terisi.`, 'success');
    } catch (error) {
        if (error instanceof UploadValidationError) {
            console.warn('Upload ditolak:', error.message); // bukan error sistem
            showUploadMessage(error.message, 'error');
        } else {
            console.error('UPLOAD ERROR:', error);
            showUploadMessage(formatStorageError(error), 'error');
        }
    } finally {
        setUploadState(false);
        input.value = '';
    }
}

async function copyPhotoUrl() {
    const input = $('p-foto');
    const url = input?.value.trim();

    if (!url) {
        showUploadMessage('Belum ada URL foto.', 'error');
        return;
    }

    try {
        await navigator.clipboard.writeText(url);
        showUploadMessage('URL berhasil disalin.', 'success');
    } catch {
        input.select(); // fallback: user bisa Ctrl+C manual
    }
}

// =========================================================
// SAVE PRODUCT
// =========================================================
async function saveProduct() {
    if (isSaving) return;
    if (isUploading) {
        showUploadMessage('Tunggu upload foto selesai.', 'error');
        return;
    }
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

            showStatus('Produk berhasil diperbarui dari database.', 'success');
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

        showStatus('Produk baru berhasil disimpan di Database.', 'success');
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

        showStatus('Produk berhasil dihapus dari Database.', 'success');
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
        return 'Tabel products tidak ditemukan di Database.';
    }
    return 'Operasi database gagal: ' + message;
}

// =========================================================
// EVENTS
// =========================================================
// Form Events
$('btnSave')?.addEventListener('click', saveProduct);
$('p-foto')?.addEventListener('input', updatePhotoPreview);
$('p-foto-file')?.addEventListener('change', handleFileSelected);
$('btnCopyUrl')?.addEventListener('click', copyPhotoUrl);

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
