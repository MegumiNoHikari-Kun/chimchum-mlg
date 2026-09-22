import { supabase, authReady } from '../supabase.js';

const STORAGE_BUCKET = 'testimoni';
const MAX_INPUT_SIZE = 15 * 1024 * 1024;
const MAX_UPLOAD_SIZE = 2 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1600;
const IMAGE_EXT = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp'
};

const $ = (id) => document.getElementById(id);

let isUploading = false;
let isDeletingFile = false;

// =========================================================
// STATUS MESSAGE
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

function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatBytes(bytes) {
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getErrorMessage(error) {
    if (!error) return 'Unknown error';
    return (error.message || error.error_description || error.details || error.hint || String(error));
}

function formatStorageError(error) {
    const message = getErrorMessage(error);
    const lower = message.toLowerCase();

    if (lower.includes('bucket not found')) {
        return `Bucket "${STORAGE_BUCKET}" tidak ditemukan di Supabase Storage. Buat bucket ini terlebih dahulu.`;
    }
    if (lower.includes('row-level security') || lower.includes('violates') || lower.includes('unauthorized')) {
        return 'Ditolak oleh policy Storage. Pastikan sudah login dan policy INSERT/DELETE untuk bucket testimoni sudah dibuat.';
    }
    if (lower.includes('payload too large') || lower.includes('exceeded')) {
        return 'Ukuran file melebihi batas bucket.';
    }
    return 'Operasi gagal: ' + message;
}

class UploadValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'UploadValidationError';
    }
}

// =========================================================
// VALIDASI & KOMPRESI GAMBAR
// =========================================================
function validateImageFile(file) {
    if (!IMAGE_EXT[file.type]) {
        throw new UploadValidationError(`${file.name}: format harus JPG, PNG, atau WEBP.`);
    }
    if (file.size > MAX_INPUT_SIZE) {
        throw new UploadValidationError(`${file.name}: terlalu besar (${formatBytes(file.size)}).`);
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
        throw new UploadValidationError(`${file.name}: file gambar tidak bisa dibaca.`);
    }

    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));

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
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    for (const quality of [0.82, 0.7, 0.55, 0.4]) {
        let blob = await canvasToBlob(canvas, 'image/webp', quality);
        if (!blob || blob.type !== 'image/webp') {
            blob = await canvasToBlob(canvas, 'image/jpeg', quality);
        }
        if (blob && blob.size <= MAX_UPLOAD_SIZE) {
            return new File([blob], 'testi.' + IMAGE_EXT[blob.type], { type: blob.type });
        }
    }

    throw new UploadValidationError(`${file.name}: masih terlalu besar setelah dikompres.`);
}

function buildFilePath(file) {
    const rand = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10);
    return `${Date.now()}-${rand}.${IMAGE_EXT[file.type]}`;
}

// =========================================================
// UPLOAD KE SUPABASE STORAGE
// =========================================================
async function uploadTestimonialImage(file) {
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
    return filePath;
}

// =========================================================
// HANDLE FILE DIPILIH (SUPPORT MULTIPLE)
// =========================================================
async function handleFilesSelected(fileList) {
    if (isUploading) return;
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    isUploading = true;
    const queueEl = $('uploadQueue');
    const progressEl = $('uploadProgress');
    const progressText = $('uploadProgressText');

    queueEl.classList.remove('hidden');
    progressEl.classList.remove('hidden');
    queueEl.innerHTML = files.map((file, i) => `
        <div id="queue-item-${i}" class="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-50 aspect-square flex items-center justify-center">
            <img src="${URL.createObjectURL(file)}" class="w-full h-full object-cover">
            <div class="absolute inset-0 bg-slate-900/50 flex items-center justify-center">
                <i class="fa-solid fa-circle-notch loading-spinner text-white"></i>
            </div>
        </div>
    `).join('');

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < files.length; i++) {
        progressText.textContent = `Mengunggah ${i + 1} dari ${files.length}...`;
        const itemEl = $(`queue-item-${i}`);

        try {
            validateImageFile(files[i]);
            const compressed = await compressImage(files[i]);
            await uploadTestimonialImage(compressed);

            successCount++;
            if (itemEl) {
                itemEl.querySelector('div').innerHTML = '<i class="fa-solid fa-check text-emerald-400 text-lg"></i>';
                itemEl.querySelector('div').className = 'absolute inset-0 bg-emerald-900/40 flex items-center justify-center';
            }
        } catch (error) {
            failCount++;
            console.error('Upload gagal:', error);
            if (itemEl) {
                itemEl.querySelector('div').innerHTML = '<i class="fa-solid fa-xmark text-red-300 text-lg"></i>';
                itemEl.querySelector('div').className = 'absolute inset-0 bg-red-900/40 flex items-center justify-center';
                itemEl.title = error instanceof UploadValidationError ? error.message : formatStorageError(error);
            }
        }
    }

    progressEl.classList.add('hidden');

    if (failCount === 0) {
        showStatus(`${successCount} testimoni berhasil diupload.`, 'success');
    } else if (successCount === 0) {
        showStatus(`Semua upload gagal (${failCount} file). Periksa detail di setiap thumbnail.`, 'error');
    } else {
        showStatus(`${successCount} berhasil, ${failCount} gagal diupload.`, 'warning');
    }

    setTimeout(() => {
        queueEl.classList.add('hidden');
        queueEl.innerHTML = '';
    }, 2000);

    isUploading = false;
    await loadGallery();
}

// =========================================================
// GALLERY (LIST + DELETE)
// =========================================================
async function loadGallery() {
    const gallery = $('testiGallery');
    const countEl = $('testiCount');
    if (!gallery) return;

    gallery.innerHTML = `
        <div class="col-span-full text-center py-10 text-slate-400">
            <i class="fa-solid fa-circle-notch loading-spinner text-orange-500 mr-2"></i>
            Memuat testimoni...
        </div>`;

    try {
        await authReady;
        const { data, error } = await supabase.storage
            .from(STORAGE_BUCKET)
            .list('', { limit: 200, sortBy: { column: 'created_at', order: 'desc' } });

        if (error) throw error;

        const files = (data || []).filter(f => f.name && !f.name.endsWith('/'));

        if (countEl) countEl.textContent = `${files.length} testimoni tersimpan`;

        if (files.length === 0) {
            gallery.innerHTML = `
                <div class="col-span-full text-center py-10">
                    <div class="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-3 mx-auto">
                        <i class="fa-solid fa-image text-slate-400"></i>
                    </div>
                    <p class="text-xs font-semibold text-slate-500">Belum ada testimoni</p>
                </div>`;
            return;
        }

        gallery.innerHTML = files.map(file => {
            const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(file.name);
            const url = urlData?.publicUrl || '';
            return `
                <div class="group relative rounded-xl overflow-hidden border border-slate-200 aspect-square">
                    <img src="${escapeHtml(url)}" alt="Testimoni" loading="lazy" class="w-full h-full object-cover">
                    <div class="absolute inset-0 bg-slate-900/0 group-hover:bg-slate-900/40 transition flex items-center justify-center">
                        <button
                            type="button"
                            data-file="${escapeHtml(file.name)}"
                            class="btn-delete-testi opacity-0 group-hover:opacity-100 transition bg-rose-500 hover:bg-rose-600 text-white w-9 h-9 rounded-full flex items-center justify-center"
                            title="Hapus testimoni ini"
                        >
                            <i class="fa-solid fa-trash text-xs"></i>
                        </button>
                    </div>
                </div>`;
        }).join('');
    } catch (error) {
        console.error('Gagal memuat galeri testimoni:', error);
        gallery.innerHTML = `
            <div class="col-span-full text-center py-10 text-red-500 text-xs">
                ${escapeHtml(formatStorageError(error))}
            </div>`;
    }
}

async function deleteTestimonial(fileName) {
    if (isDeletingFile) return;
    if (!confirm('Hapus testimoni ini? Data yang dihapus tidak dapat dikembalikan.')) return;

    isDeletingFile = true;
    try {
        await authReady;
        const { error } = await supabase.storage.from(STORAGE_BUCKET).remove([fileName]);
        if (error) throw error;

        showStatus('Testimoni berhasil dihapus.', 'success');
        await loadGallery();
    } catch (error) {
        console.error('Gagal menghapus testimoni:', error);
        showStatus(formatStorageError(error), 'error');
    } finally {
        isDeletingFile = false;
    }
}

// =========================================================
// EVENTS
// =========================================================
const fileInput = $('testi-file-input');
const dropZone = $('dropZone');

fileInput?.addEventListener('change', (e) => {
    handleFilesSelected(e.target.files);
    e.target.value = '';
});

dropZone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
});
dropZone?.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
});
dropZone?.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    handleFilesSelected(e.dataTransfer.files);
});

$('btnRefreshTesti')?.addEventListener('click', loadGallery);

$('testiGallery')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-delete-testi');
    if (!btn) return;
    const fileName = btn.dataset.file;
    if (fileName) deleteTestimonial(fileName);
});

// =========================================================
// INIT
// =========================================================
(async function init() {
    try {
        await authReady;
        await loadGallery();
    } catch (error) {
        console.error('INITIALIZATION ERROR:', error);
        showStatus(getErrorMessage(error), 'error');
    }
})();
