import { supabase, authReady } from '../supabase.js';

// ============================================================
//  STATE & HELPERS
// ============================================================
const $ = (id) => document.getElementById(id);

const state = {
    data: [],
    demo: false,
    loading: true,
    error: null,
    query: '',
    sort: safeGet('supplierSort') || 'newest',
    saving: false,
    pendingDeleteId: null,
};
let client = null;

function safeGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function safeSet(key, val) { try { localStorage.setItem(key, val); } catch { /* abaikan */ } }

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(str) { return String(str ?? '').replace(/[&<>"']/g, (c) => ESC_MAP[c]); }

const findSupplier = (id) => state.data.find((s) => String(s.id) === String(id));
const val = (id) => ($(id)?.value || '').trim();

/** 0812-3456 789 -> 628123456789 (format wa.me) */
function toWa(phone) {
    let d = String(phone || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.startsWith('0')) d = '62' + d.slice(1);
    else if (d.startsWith('8')) d = '62' + d;
    return d;
}

/** "CV Berkah Tepung" -> "BT" (abaikan awalan badan usaha) */
function initials(name) {
    const skip = ['toko', 'cv', 'pt', 'ud', 'tb', 'pd'];
    const words = String(name || '').split(/\s+/).filter(Boolean);
    const main = words.filter((w) => !skip.includes(w.toLowerCase().replace(/\./g, '')));
    const src = main.length ? main : words;
    return (src.slice(0, 2).map((w) => w[0]).join('') || '?').toUpperCase();
}

// ============================================================
//  INIT & DATA
// ============================================================
async function initApp() {
    bindEvents();
    $('sortSelect').value = state.sort;
    render();

    try {
        await authReady;
        if (supabase) {
            client = supabase;
            await loadSuppliers();
        } else {
            console.log('⚠️ [SUPPLIER] Supabase tidak ditemukan. Mode Demo aktif.');
            enableDemo();
        }
    } catch (err) {
        console.warn('⚠️ [SUPPLIER] Init error, masuk Mode Demo:', err);
        enableDemo();
    }
}

async function loadSuppliers({ silent = false } = {}) {
    if (!silent) { state.loading = true; state.error = null; render(); }
    try {
        const { data, error } = await client.from('suppliers').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        state.data = data || [];
        state.error = null;
    } catch (e) {
        console.error('❌ [SUPPLIER] Gagal memuat:', e);
        // Sengaja TIDAK menampilkan data dummy: di produksi itu menyesatkan.
        state.error = e?.message || 'Gagal memuat data supplier.';
    } finally {
        state.loading = false;
        render();
    }
}

function enableDemo() {
    state.demo = true;
    state.loading = false;
    state.data = [
        { id: 'sup_1', name: 'Toko Daging Makmur', contact_person: 'Bpk. Hendra', phone: '08123456789', address: 'Jl. Pasar Baru No. 12', notes: 'Supplier ayam dan daging segar' },
        { id: 'sup_2', name: 'CV Berkah Tepung Sejahtera', contact_person: 'Ibu Siska', phone: '08987654321', address: 'Jl. Industri Raya No. 45', notes: 'Supplier tapioka dan maizena' },
    ];
    render();
}

// ============================================================
//  RENDER
// ============================================================
function getFiltered() {
    const q = state.query.toLowerCase().trim();
    let list = !q ? state.data : state.data.filter((s) =>
        [s.name, s.contact_person, s.phone, s.address, s.notes]
            .some((v) => String(v || '').toLowerCase().includes(q))
    );
    if (state.sort === 'name') {
        list = [...list].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'id', { sensitivity: 'base' }));
    }
    return list;
}

function render() {
    const tbody = $('suppliers-table-tbody');
    const cards = $('suppliers-cards');
    if (!tbody || !cards) return;

    const total = state.data.length;
    const list = getFiltered();

    $('statTotalSuppliers').textContent = state.query ? `${list.length} dari ${total}` : total;
    $('search-clear').classList.toggle('hidden', !state.query);
    $('search-kbd').classList.toggle('lg:inline', !state.query);
    $('demo-badge').classList.toggle('hidden', !state.demo);

    const setBlock = (html) => {
        tbody.innerHTML = `<tr><td colspan="4">${html}</td></tr>`;
        cards.innerHTML = html;
    };

    if (state.loading) {
        tbody.innerHTML = Array.from({ length: 6 }, () => `
            <tr><td class="px-4 py-3" colspan="4">
                <div class="flex gap-6 animate-pulse">
                    <div class="h-3.5 bg-slate-100 rounded w-1/4"></div>
                    <div class="h-3.5 bg-slate-100 rounded w-1/6"></div>
                    <div class="h-3.5 bg-slate-100 rounded flex-1"></div>
                </div>
            </td></tr>`).join('');
        cards.innerHTML = Array.from({ length: 5 }, () => `
            <div class="p-3 flex gap-3 animate-pulse">
                <div class="w-9 h-9 rounded-lg bg-slate-100"></div>
                <div class="flex-1 space-y-2 py-1"><div class="h-3 bg-slate-100 rounded w-2/3"></div><div class="h-2.5 bg-slate-100 rounded w-1/2"></div></div>
            </div>`).join('');
        return;
    }

    if (state.error) {
        return setBlock(stateBlock({
            icon: 'fa-solid fa-triangle-exclamation text-rose-500', tone: 'bg-rose-50',
            title: 'Data supplier gagal dimuat', sub: esc(state.error),
            action: `<button data-act="retry" class="btn-primary"><i class="fa-solid fa-rotate-right"></i> Coba lagi</button>`,
        }));
    }

    if (!total) {
        return setBlock(stateBlock({
            icon: 'fa-solid fa-truck-field',
            title: 'Belum ada supplier', sub: 'Tambahkan supplier pertama untuk mulai mencatat.',
            action: `<button data-act="add" class="btn-primary"><i class="fa-solid fa-plus"></i> Tambah Supplier</button>`,
        }));
    }

    if (!list.length) {
        return setBlock(stateBlock({
            icon: 'fa-solid fa-magnifying-glass',
            title: `Tidak ada hasil untuk “${esc(state.query)}”`, sub: 'Coba kata kunci lain: nama, PIC, nomor, alamat, atau catatan.',
            action: `<button data-act="clear-search" class="btn-ghost">Hapus pencarian</button>`,
        }));
    }

    tbody.innerHTML = list.map(rowHtml).join('');
    cards.innerHTML = list.map(cardHtml).join('');
}

function stateBlock({ icon, title, sub = '', action = '', tone = 'bg-slate-100' }) {
    return `
        <div class="py-12 px-4 text-center">
            <div class="w-12 h-12 mx-auto rounded-full ${tone} text-slate-400 flex items-center justify-center text-lg mb-3"><i class="${icon}"></i></div>
            <p class="font-semibold text-slate-700 text-sm">${title}</p>
            ${sub ? `<p class="text-xs text-slate-400 mt-1 max-w-sm mx-auto">${sub}</p>` : ''}
            ${action ? `<div class="mt-4">${action}</div>` : ''}
        </div>`;
}

function waButton(s, size = 'icon-btn') {
    const wa = toWa(s.phone);
    if (!wa) return '';
    return `<a data-act="wa" href="https://wa.me/${wa}" target="_blank" rel="noopener" class="${size} text-emerald-600 hover:bg-emerald-50" title="Chat WhatsApp"><i class="fa-brands fa-whatsapp text-[15px]"></i></a>`;
}

function rowHtml(s) {
    return `
        <tr data-id="${esc(s.id)}" data-act="edit" class="group cursor-pointer hover:bg-orange-50/50 transition-colors">
            <td class="px-4 py-2.5 align-top max-w-[280px]">
                <div class="font-semibold text-slate-800 truncate" title="${esc(s.name)}">${esc(s.name)}</div>
                ${s.notes ? `<div class="text-[11px] text-slate-400 truncate" title="${esc(s.notes)}"><i class="fa-regular fa-note-sticky mr-1"></i>${esc(s.notes)}</div>` : ''}
            </td>
            <td class="px-4 py-2.5 align-top whitespace-nowrap">
                <div class="text-slate-700">${esc(s.contact_person || '—')}</div>
                ${s.phone ? `<button data-act="copy" class="text-[11px] text-slate-400 hover:text-orange-600 font-mono" title="Klik untuk salin nomor">${esc(s.phone)} <i class="fa-regular fa-copy ml-0.5 opacity-0 group-hover:opacity-100"></i></button>` : ''}
            </td>
            <td class="px-4 py-2.5 align-top text-slate-500 max-w-[320px]">
                <div class="line-clamp-2" title="${esc(s.address)}">${esc(s.address || '—')}</div>
            </td>
            <td class="px-4 py-2 align-top text-right whitespace-nowrap">
                <div class="inline-flex items-center gap-0.5">
                    ${waButton(s)}
                    <button data-act="edit" class="icon-btn text-slate-500 hover:bg-slate-100 hover:text-orange-600" title="Edit"><i class="fa-solid fa-pen"></i></button>
                    <button data-act="delete" class="icon-btn text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Hapus"><i class="fa-solid fa-trash-can"></i></button>
                </div>
            </td>
        </tr>`;
}

function cardHtml(s) {
    const contact = [s.contact_person, s.phone].filter(Boolean).map(esc).join(' · ') || 'Tanpa kontak';
    return `
        <div data-id="${esc(s.id)}" data-act="edit" class="px-3 py-2.5 flex gap-3 items-start active:bg-slate-50 cursor-pointer">
            <div class="w-9 h-9 shrink-0 rounded-lg bg-orange-100 text-orange-700 font-bold text-[11px] flex items-center justify-center">${esc(initials(s.name))}</div>
            <div class="min-w-0 flex-1">
                <div class="font-semibold text-slate-800 truncate">${esc(s.name)}</div>
                <div class="text-[11px] text-slate-500 truncate">${contact}</div>
                ${s.address ? `<div class="text-[11px] text-slate-400 truncate"><i class="fa-solid fa-location-dot mr-1"></i>${esc(s.address)}</div>` : ''}
                ${s.notes ? `<div class="text-[11px] text-slate-400 italic truncate">${esc(s.notes)}</div>` : ''}
            </div>
            <div class="flex items-center gap-0.5 -mr-1">
                ${waButton(s, 'icon-btn-lg')}
                <button data-act="delete" class="icon-btn-lg text-slate-400 active:bg-rose-50 active:text-rose-600" title="Hapus"><i class="fa-solid fa-trash-can"></i></button>
            </div>
        </div>`;
}

// ============================================================
//  EVENTS
// ============================================================
function bindEvents() {
    $('btn-add').addEventListener('click', openSupplierModal);

    $('supplierSearch').addEventListener('input', (e) => { state.query = e.target.value; render(); });
    $('search-clear').addEventListener('click', () => { setQuery(''); $('supplierSearch').focus(); });
    $('sortSelect').addEventListener('change', (e) => { state.sort = e.target.value; safeSet('supplierSort', state.sort); render(); });

    $('suppliers-table-tbody').addEventListener('click', onListClick);
    $('suppliers-cards').addEventListener('click', onListClick);

    $('supplierForm').addEventListener('submit', handleSubmit);
    $('sup-name').addEventListener('input', checkDuplicate);
    $('sup-phone').addEventListener('input', updatePhoneHint);
    $('btn-confirm-delete').addEventListener('click', confirmDelete);

    // Tombol tutup + klik backdrop untuk semua modal
    document.querySelectorAll('[data-modal]').forEach((modal) => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal || e.target.closest('[data-close]')) closeModalEl(modal);
        });
    });

    document.addEventListener('keydown', onKeydown);
}

function onListClick(e) {
    const actEl = e.target.closest('[data-act]');
    if (!actEl) return;
    const act = actEl.dataset.act;

    if (act === 'wa') return; // biarkan link terbuka
    if (act === 'add') return openSupplierModal();
    if (act === 'clear-search') return setQuery('');
    if (act === 'retry') return loadSuppliers();

    // Jangan buka edit kalau user sedang memblok teks
    if (act === 'edit' && window.getSelection()?.toString()) return;

    const id = actEl.closest('[data-id]')?.dataset.id;
    if (!id) return;
    if (act === 'edit') editSupplier(id);
    else if (act === 'delete') askDelete(id);
    else if (act === 'copy') copyPhone(id);
}

function onKeydown(e) {
    const openModal = document.querySelector('[data-modal]:not(.hidden)');

    if (openModal) {
        if (e.key === 'Escape') closeModalEl(openModal);
        else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && openModal.id === 'supplierModal') {
            e.preventDefault();
            $('supplierForm').requestSubmit();
        }
        return;
    }

    const search = $('supplierSearch');
    if (e.key === 'Escape' && document.activeElement === search) {
        setQuery('');
        search.blur();
        return;
    }

    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === '/') { e.preventDefault(); search.focus(); search.select(); }
    else if (e.key.toLowerCase() === 'n') { e.preventDefault(); openSupplierModal(); }
}

function setQuery(q) {
    state.query = q;
    $('supplierSearch').value = q;
    render();
}

// ============================================================
//  MODAL
// ============================================================
function openModalEl(el) {
    el.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
}

function closeModalEl(el) {
    el.classList.add('hidden');
    if (!document.querySelector('[data-modal]:not(.hidden)')) document.body.classList.remove('overflow-hidden');
    if (el.id === 'confirmModal') state.pendingDeleteId = null;
}

function showModal(title, message, icon = '💡') {
    $('modal-title').innerText = title;
    $('modal-message').innerText = message;
    $('modal-icon').innerText = icon;
    openModalEl($('notification-modal'));
    $('notification-modal').querySelector('[data-close]')?.focus();
}

function toast(msg, type = 'success') {
    const wrap = $('toast-wrap');
    const el = document.createElement('div');
    const bg = type === 'error' ? 'bg-rose-600' : 'bg-slate-900';
    const icon = type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check text-emerald-400';
    el.className = `${bg} text-white text-xs font-medium pl-3 pr-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2 transition-all duration-300 opacity-0 translate-y-2`;
    el.innerHTML = `<i class="fa-solid ${icon}"></i><span></span>`;
    el.querySelector('span').textContent = msg;
    wrap.appendChild(el);
    requestAnimationFrame(() => el.classList.remove('opacity-0', 'translate-y-2'));
    setTimeout(() => {
        el.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => el.remove(), 300);
    }, 2400);
}

// ============================================================
//  FORM (TAMBAH / EDIT)
// ============================================================
function resetSupplierForm() {
    $('supplierForm').reset();
    $('supplier-edit-id').value = '';
    $('supplierModalTitle').innerText = 'Tambah Supplier';
    $('btn-save-label').innerText = 'Simpan';
    checkDuplicate();
    updatePhoneHint();
}

function openSupplierModal() {
    resetSupplierForm();
    openModalEl($('supplierModal'));
    setTimeout(() => $('sup-name').focus(), 50);
}

function closeSupplierModal() { closeModalEl($('supplierModal')); }

function editSupplier(id) {
    const s = findSupplier(id);
    if (!s) return;
    $('supplier-edit-id').value = s.id;
    $('sup-name').value = s.name || '';
    $('sup-contact').value = s.contact_person || '';
    $('sup-phone').value = s.phone || '';
    $('sup-address').value = s.address || '';
    $('sup-notes').value = s.notes || '';
    $('supplierModalTitle').innerText = 'Edit Supplier';
    $('btn-save-label').innerText = 'Simpan Perubahan';
    checkDuplicate();
    updatePhoneHint();
    openModalEl($('supplierModal'));
    setTimeout(() => $('sup-name').focus(), 50);
}

function checkDuplicate() {
    const name = val('sup-name').toLowerCase();
    const editId = $('supplier-edit-id').value;
    const dup = !!name && state.data.some((s) =>
        String(s.id) !== String(editId) && String(s.name || '').trim().toLowerCase() === name
    );
    $('sup-name-dup').classList.toggle('hidden', !dup);
}

function updatePhoneHint() {
    const wa = toWa(val('sup-phone'));
    const hint = $('sup-phone-hint');
    hint.innerHTML = wa
        ? `<i class="fa-brands fa-whatsapp text-emerald-500"></i> wa.me/${esc(wa)}`
        : 'Contoh: 0812-3456-789';
}

function setSaving(on) {
    state.saving = on;
    const btn = $('btn-save');
    btn.disabled = on;
    $('btn-save-spinner').classList.toggle('hidden', !on);
}

async function handleSubmit(e) {
    e.preventDefault();
    if (state.saving) return;

    const editId = $('supplier-edit-id').value;
    const payload = {
        id: editId || 'sup_' + Date.now(),
        name: val('sup-name'),
        contact_person: val('sup-contact'),
        phone: val('sup-phone'),
        address: val('sup-address'),
        notes: val('sup-notes'),
    };
    if (!payload.name) { $('sup-name').focus(); return; }

    setSaving(true);
    try {
        if (!state.demo && client) {
            const { error } = await client.from('suppliers').upsert([payload]);
            if (error) throw error;
            await loadSuppliers({ silent: true });
        } else {
            const idx = state.data.findIndex((s) => String(s.id) === String(payload.id));
            if (idx >= 0) state.data[idx] = { ...state.data[idx], ...payload };
            else state.data.unshift(payload);
            render();
        }
        closeSupplierModal();
        toast(editId ? 'Perubahan supplier disimpan' : 'Supplier baru ditambahkan');
    } catch (err) {
        showModal('Gagal menyimpan', err?.message || String(err), '❌');
    } finally {
        setSaving(false);
    }
}

// ============================================================
//  HAPUS & SALIN
// ============================================================
function askDelete(id) {
    const s = findSupplier(id);
    if (!s) return;
    state.pendingDeleteId = id;
    $('confirm-name').textContent = s.name || 'supplier ini';
    openModalEl($('confirmModal'));
    $('btn-confirm-delete').focus();
}

async function confirmDelete() {
    const id = state.pendingDeleteId;
    if (!id) return;
    const btn = $('btn-confirm-delete');
    btn.disabled = true;
    try {
        if (!state.demo && client) {
            const { error } = await client.from('suppliers').delete().eq('id', id);
            if (error) throw error;
            await loadSuppliers({ silent: true });
        } else {
            state.data = state.data.filter((s) => String(s.id) !== String(id));
            render();
        }
        closeModalEl($('confirmModal'));
        toast('Supplier dihapus');
    } catch (err) {
        closeModalEl($('confirmModal'));
        showModal('Gagal menghapus', err?.message || String(err), '❌');
    } finally {
        btn.disabled = false;
    }
}

async function copyPhone(id) {
    const s = findSupplier(id);
    if (!s?.phone) return;
    try {
        await navigator.clipboard.writeText(s.phone);
        toast(`Nomor ${s.phone} disalin`);
    } catch {
        toast('Gagal menyalin nomor', 'error');
    }
}

// ============================================================
//  EXPOSE (kompatibilitas dengan kode lama)
// ============================================================
Object.assign(window, {
    showModal,
    closeModal: () => closeModalEl($('notification-modal')),
    openSupplierModal,
    closeSupplierModal,
    resetSupplierForm,
    editSupplier,
    deleteSupplier: askDelete,
    renderSuppliersTable: render,
});

initApp();
