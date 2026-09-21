import { supabase, authReady } from '../supabase.js';

// =========================================================
// CONFIG
// =========================================================

const STOCK_COL = 'stock';                    // nama kolom stok di tabel ingredients
const STOCK_RPC = 'adjust_ingredient_stock';  // fungsi SQL atomik (lihat purchase_order_stock.sql)
const TZ = 'Asia/Jakarta';

const STATUS = {
    pending:   { label: 'Pending', badge: 'bg-amber-50 text-amber-700 ring-amber-200' },
    completed: { label: 'Selesai', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200' }
};
const TABS = [['all', 'Semua'], ['pending', 'Pending'], ['completed', 'Selesai']];

const state = {
    pos: [], suppliers: [], ingredients: [],
    page: 1, size: 10, status: 'all', query: ''
};
let db;

// =========================================================
// HELPERS
// =========================================================

const $ = id => document.getElementById(id);
const same = (a, b) => String(a) === String(b);
const num = n => Number(n || 0).toLocaleString('id-ID');
const rp = n => 'Rp ' + num(n);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const errText = e =>
    [e?.message, e?.details, e?.hint].filter(Boolean).join('\n') || 'Terjadi kesalahan yang tidak diketahui.';

const fmtDate = d => new Date(d).toLocaleString('id-ID', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' });
// <input type="datetime-local"> <-> ISO, selalu dibaca sebagai WIB (GMT+7)
const toInputValue = d => new Date(d).toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 16).replace(' ', 'T');
const fromInputValue = v => new Date(`${v}:00+07:00`).toISOString();

const findPO = id => state.pos.find(p => same(p.id, id));
const supplierOf = id => state.suppliers.find(s => same(s.id, id));
const supplierName = s => s?.name || s?.nama || 'Supplier Umum';
const ingredientOf = id => state.ingredients.find(i => same(i.id, id));

// =========================================================
// FEEDBACK (toast, pesan, konfirmasi)
// =========================================================

let toastTimer;
function toast(message, type = 'success') {
    const el = $('toast');
    el.textContent = message;
    el.className = `toast show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3800);
}

function notify(title, message, icon = '⚠️') {
    $('msg-icon').textContent = icon;
    $('msg-title').textContent = title;
    $('msg-text').textContent = message;
    $('msg-dialog').showModal();
}

function confirmBox(title, message, okLabel) {
    const dlg = $('confirm-dialog');
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = message;
    $('confirm-ok').textContent = okLabel;
    dlg.returnValue = '';
    dlg.showModal();
    return new Promise(resolve =>
        dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true }));
}

// =========================================================
// STOK
// Aturan: stok hanya "terpakai" oleh PO berstatus Selesai.
//   Simpan / ubah status / hapus = selisih efek stok sebelum vs sesudah.
// =========================================================

// Map(ingredientId -> qty) yang sedang tercatat di stok oleh PO ini
function stockEffect(po) {
    const map = new Map();
    if (po?.status !== 'completed') return map;
    for (const it of po.items || []) {
        const id = String(it.ingredient_id);
        map.set(id, (map.get(id) || 0) + Number(it.quantity || 0));
    }
    return map;
}

function stockDelta(before, after) {
    const delta = new Map();
    for (const id of new Set([...before.keys(), ...after.keys()])) {
        const d = Math.round(((after.get(id) || 0) - (before.get(id) || 0)) * 1e6) / 1e6;
        if (d) delta.set(id, d);
    }
    return delta;
}

function stockNote(delta) {
    if (!delta.size) return '';
    const v = [...delta.values()];
    if (v.every(d => d > 0)) return ' Stok bahan bertambah.';
    if (v.every(d => d < 0)) return ' Stok bahan dikurangi.';
    return ' Stok bahan disesuaikan.';
}

async function adjustStock(id, delta) {
    const { error } = await db.rpc(STOCK_RPC, { p_ingredient_id: String(id), p_delta: delta });
    if (!error) return;

    // Fungsi SQL belum dibuat -> fallback baca lalu tulis (tidak atomik)
    if (!['PGRST202', '42883'].includes(error.code)) throw error;

    const { data, error: readErr } = await db.from('ingredients').select(STOCK_COL).eq('id', id).single();
    if (readErr) throw readErr;

    const next = Math.round((Number(data[STOCK_COL] || 0) + delta) * 1e6) / 1e6;
    const { data: rows, error: writeErr } =
        await db.from('ingredients').update({ [STOCK_COL]: next }).eq('id', id).select('id');
    if (writeErr) throw writeErr;
    if (!rows?.length) throw new Error('Stok tidak dapat diperbarui. Periksa policy UPDATE tabel ingredients.');
}

// Terapkan stok lebih dulu, jalankan aksi; kalau aksi gagal, stok dikembalikan.
async function withStock(delta, action) {
    const applied = [];
    try {
        for (const [id, d] of delta) {
            await adjustStock(id, d);
            applied.push([id, d]);
        }
        return await action();
    } catch (err) {
        for (const [id, d] of applied.reverse()) {
            await adjustStock(id, -d).catch(e => console.error('Rollback stok gagal:', id, e));
        }
        throw err;
    }
}

// =========================================================
// LOAD DATA
// =========================================================

async function loadAll() {
    const [sup, ing, po, items] = await Promise.all([
        db.from('suppliers').select('*'),
        db.from('ingredients').select('*').order('name'),
        db.from('purchase_orders').select('*').order('created_at', { ascending: false }),
        db.from('purchase_order_items').select('*')
    ]);

    const err = [sup, ing, po, items].find(r => r.error)?.error;
    if (err) throw err;

    const byOrder = new Map();
    for (const it of items.data) {
        const k = String(it.order_id);
        if (!byOrder.has(k)) byOrder.set(k, []);
        byOrder.get(k).push(it);
    }

    state.suppliers = sup.data || [];
    state.ingredients = ing.data || [];
    state.pos = (po.data || []).map(p => {
        const full = { ...p, items: byOrder.get(String(p.id)) || [] };
        full._search = buildSearchText(full);
        return full;
    });

    render();
}

async function load() {
    $('po-body').innerHTML = loadingRow();
    try {
        await authReady;
        if (!supabase) throw new Error('Supabase client tidak tersedia.');
        db = supabase;
        await loadAll();
    } catch (err) {
        console.error('Gagal memuat PO:', err);
        $('po-body').innerHTML = errorRow(errText(err));
    }
}

const refresh = () => loadAll().catch(err => notify('Gagal memuat ulang data', errText(err), '❌'));

// =========================================================
// SEARCH
// =========================================================

function buildSearchText(po) {
    const d = new Date(po.order_date);
    let dates = '';
    if (!isNaN(d)) {
        dates = [
            fmtDate(d),
            d.toLocaleDateString('id-ID', { timeZone: TZ, dateStyle: 'long' }),
            d.toLocaleDateString('id-ID', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }),
            d.toLocaleDateString('en-CA', { timeZone: TZ })
        ].join(' ');
        dates += ' ' + dates.replace(/(\d{2})\.(\d{2})/g, '$1:$2'); // jam: 14.30 & 14:30
    }

    const total = Number(po.total_amount || 0);
    const items = po.items
        .map(i => `${i.ingredient_name || ''} ${i.quantity} ${i.unit || ''} ${i.subtotal} ${num(i.subtotal)}`)
        .join(' ');

    return [
        dates,
        supplierName(supplierOf(po.supplier_id)),
        po.status === 'completed' ? 'selesai completed' : 'pending',
        total, num(total), 'rp',
        items,
        po.notes || ''
    ].join(' ').toLowerCase();
}

function filtered() {
    const tokens = state.query.split(/\s+/).filter(Boolean);
    return state.pos.filter(po =>
        (state.status === 'all' || po.status === state.status) &&
        tokens.every(t => po._search.includes(t)));
}

// =========================================================
// RENDER
// =========================================================

const colSpan = 6;
const loadingRow = () => `
    <tr><td colspan="${colSpan}" class="p-12 text-center text-slate-400">
        <div class="spinner-dark mx-auto mb-3"></div>Memuat Purchase Order…
    </td></tr>`;

const errorRow = msg => `
    <tr><td colspan="${colSpan}" class="p-12 text-center">
        <p class="font-semibold text-rose-600">Data tidak bisa dimuat</p>
        <p class="mx-auto mt-1 max-w-md whitespace-pre-line text-slate-500">${esc(msg)}</p>
        <button data-act="retry" class="btn-ghost mt-4">Coba lagi</button>
    </td></tr>`;

const emptyRow = hasFilter => `
    <tr><td colspan="${colSpan}" class="p-12 text-center text-slate-400">
        <i class="fa-solid fa-inbox mb-2 block text-2xl text-slate-300"></i>
        ${hasFilter ? 'Tidak ada PO yang cocok dengan pencarian.' : 'Belum ada Purchase Order. Klik “Buat PO Baru” untuk mulai.'}
    </td></tr>`;

function waUrl(po, sup) {
    let phone = String(sup?.phone || '').replace(/\D/g, '');
    if (!phone) return '';
    if (phone.startsWith('0')) phone = '62' + phone.slice(1);

    const lines = po.items.map(i => `- ${i.ingredient_name || 'Bahan'}: *${num(i.quantity)} ${i.unit || ''}*`).join('\n');
    const msg =
        `Halo ${supplierName(sup)}, saya ingin melakukan order bahan baku:\n\n${lines}\n\n` +
        `Catatan: ${po.notes || '-'}\nTotal: ${rp(po.total_amount)}\nTerima kasih!`;

    return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}

function rowHtml(po) {
    const sup = supplierOf(po.supplier_id);
    const st = STATUS[po.status] || STATUS.pending;
    const done = po.status === 'completed';
    const wa = waUrl(po, sup);

    const shown = po.items.slice(0, 3);
    const more = po.items.length - shown.length;
    const items = shown.map(i => `
        <li>${esc(i.ingredient_name || 'Bahan')}
            <b>${num(i.quantity)} ${esc(i.unit)}</b>
            <span class="text-slate-400">(${rp(i.subtotal)})</span></li>`).join('');

    return `
    <tr id="po-row-${esc(po.id)}" data-id="${esc(po.id)}" class="align-top transition hover:bg-slate-50">
        <td class="whitespace-nowrap p-4 font-medium">${fmtDate(po.order_date)} WIB</td>
        <td class="p-4 font-semibold">${esc(supplierName(sup))}</td>
        <td class="p-4"><span class="rounded-full px-2.5 py-1 font-semibold ring-1 ring-inset ${st.badge}">${st.label}</span></td>
        <td class="whitespace-nowrap p-4 font-bold text-orange-600">${rp(po.total_amount)}</td>
        <td class="p-4 text-slate-600">
            ${po.notes ? `<p class="mb-1.5 italic text-slate-500">${esc(po.notes)}</p>` : ''}
            <ul class="space-y-0.5 text-[11px]">
                ${items || '<li class="text-slate-400">Tidak ada item</li>'}
                ${more > 0 ? `<li class="text-slate-400">+${more} bahan lainnya</li>` : ''}
            </ul>
        </td>
        <td class="p-4">
            <div class="flex items-center justify-end gap-1">
                ${wa
                    ? `<a href="${wa}" target="_blank" rel="noopener" title="Kirim via WhatsApp" aria-label="Kirim via WhatsApp"
                          class="icon-btn text-emerald-600 hover:bg-emerald-50"><i class="fa-brands fa-whatsapp text-sm"></i></a>`
                    : `<span title="Supplier belum punya nomor WhatsApp" class="icon-btn cursor-not-allowed opacity-30"><i class="fa-brands fa-whatsapp text-sm"></i></span>`}
                <button data-act="edit" title="Edit" aria-label="Edit" class="icon-btn hover:text-orange-600"><i class="fa-solid fa-pen"></i></button>
                <button data-act="toggle" aria-label="Ubah status" class="icon-btn ${done ? 'hover:text-amber-600' : 'text-emerald-600 hover:bg-emerald-50'}"
                    title="${done ? 'Kembalikan ke Pending (stok dikurangi)' : 'Tandai Selesai (stok bertambah)'}">
                    <i class="fa-solid ${done ? 'fa-rotate-left' : 'fa-circle-check'}"></i></button>
                <button data-act="delete" title="Hapus" aria-label="Hapus" class="icon-btn hover:bg-rose-50 hover:text-rose-600"><i class="fa-solid fa-trash"></i></button>
            </div>
        </td>
    </tr>`;
}

function renderTabs() {
    const count = s => s === 'all' ? state.pos.length : state.pos.filter(p => p.status === s).length;
    $('status-tabs').innerHTML = TABS.map(([key, label]) => `
        <button data-status="${key}"
            class="rounded-lg px-3 py-1.5 text-xs font-semibold transition ${state.status === key
                ? 'bg-white text-orange-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'}">
            ${label} <span class="ml-0.5 font-medium text-slate-400">${count(key)}</span>
        </button>`).join('');
}

function pageList(current, total) {
    const out = [];
    for (let p = 1; p <= total; p++) {
        if (p === 1 || p === total || Math.abs(p - current) <= 1) out.push(p);
        else if (out.at(-1) !== '…') out.push('…');
    }
    return out;
}

function renderPager(total, pages, start) {
    $('po-info').textContent = total
        ? `Menampilkan ${start + 1}–${Math.min(start + state.size, total)} dari ${total}`
        : '';

    const btn = (label, page, { disabled = false, active = false } = {}) => `
        <button data-page="${page}" ${disabled ? 'disabled' : ''}
            class="min-w-8 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${active
                ? 'border-orange-500 bg-orange-500 text-white'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}">${label}</button>`;

    $('po-pager').innerHTML = pages < 2 ? '' :
        btn('‹', state.page - 1, { disabled: state.page === 1 }) +
        pageList(state.page, pages).map(p =>
            p === '…' ? '<span class="px-1 text-xs text-slate-400">…</span>' : btn(p, p, { active: p === state.page })
        ).join('') +
        btn('›', state.page + 1, { disabled: state.page === pages });
}

function render() {
    const list = filtered();
    const pages = Math.max(1, Math.ceil(list.length / state.size));
    state.page = Math.min(Math.max(1, state.page), pages);
    const start = (state.page - 1) * state.size;

    renderTabs();
    $('po-count').textContent = `${list.length} dari ${state.pos.length} PO`;
    $('po-body').innerHTML = list.length
        ? list.slice(start, start + state.size).map(rowHtml).join('')
        : emptyRow(state.query || state.status !== 'all');
    renderPager(list.length, pages, start);
}

// =========================================================
// FORM: SUPPLIER & ITEM
// =========================================================

function fillSuppliers(selected = '') {
    $('po-supplier').innerHTML =
        '<option value="">Pilih supplier</option>' +
        state.suppliers.map(s => `
            <option value="${esc(s.id)}" ${same(s.id, selected) ? 'selected' : ''}>${esc(supplierName(s))}</option>`).join('');
    updatePhoneWarning();
}

function updatePhoneWarning() {
    const id = $('po-supplier').value;
    $('phone-warning').classList.toggle('hidden', !id || !!supplierOf(id)?.phone);
}

function ingredientOptions(selected) {
    return '<option value="">Pilih bahan baku</option>' +
        state.ingredients.map(i => {
            const price = i.price ? ` — ${rp(i.price)}/${i.unit || ''}` : '';
            const stock = i[STOCK_COL] != null ? `, stok ${num(i[STOCK_COL])}` : '';
            return `<option value="${esc(i.id)}" ${same(i.id, selected) ? 'selected' : ''}>${esc(i.name)} (${esc(i.unit || '')})${price}${stock}</option>`;
        }).join('');
}

function addRow(ingId = '', qty = 1) {
    const row = document.createElement('div');
    row.className = 'item-row flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 p-2';
    row.innerHTML = `
        <select class="item-ing field min-w-40 flex-1 !py-1.5" aria-label="Bahan baku">${ingredientOptions(ingId)}</select>
        <div class="relative w-28">
            <input type="number" step="any" min="0" value="${qty}" class="item-qty field !py-1.5 !pr-10" aria-label="Jumlah">
            <span class="item-unit pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400"></span>
        </div>
        <span class="item-sub w-24 text-right text-[11px] font-semibold text-slate-500"></span>
        <button type="button" data-remove class="p-1 text-xs font-bold text-rose-500 hover:text-rose-700" aria-label="Hapus baris">✕</button>`;
    $('po-items').appendChild(row);
}

function recalc() {
    const rows = [...document.querySelectorAll('#po-items .item-row')];
    const seen = new Set();
    const dup = new Set();
    let total = 0;

    rows.forEach(row => {
        const id = row.querySelector('.item-ing').value;
        const ing = ingredientOf(id);
        const sub = (parseFloat(row.querySelector('.item-qty').value) || 0) * Number(ing?.price || 0);

        total += sub;
        row.querySelector('.item-unit').textContent = ing?.unit || '';
        row.querySelector('.item-sub').textContent = rp(sub);
        if (id) (seen.has(id) ? dup : seen).add(id);
    });

    rows.forEach(row => {
        const sel = row.querySelector('.item-ing');
        sel.classList.toggle('dup-warning', dup.has(sel.value));
    });

    $('dup-warning').classList.toggle('hidden', dup.size === 0);
    $('po-total').textContent = rp(total);
}

function readItems() {
    const items = [];
    const seen = new Set();
    let dup = false;
    let total = 0;

    document.querySelectorAll('#po-items .item-row').forEach(row => {
        const id = row.querySelector('.item-ing').value;
        const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
        if (!id || qty <= 0) return;

        if (seen.has(id)) dup = true;
        seen.add(id);

        const ing = ingredientOf(id);
        const unit_price = Number(ing?.price || 0);
        const subtotal = qty * unit_price;
        total += subtotal;

        items.push({
            ingredient_id: id,
            ingredient_name: ing?.name || 'Bahan',
            quantity: qty,
            unit: ing?.unit || '',
            unit_price,
            subtotal
        });
    });

    return { items, total, dup };
}

function updateStockHint() {
    const was = findPO($('po-edit-id').value)?.status === 'completed';
    const now = $('po-status').value === 'completed';

    $('stock-hint').textContent =
        now && was ? 'Selisih jumlah bahan akan disesuaikan ke stok.' :
        now        ? 'Saat disimpan, stok bahan bertambah sesuai jumlah pesanan.' :
        was        ? 'Stok yang sebelumnya ditambahkan akan dikurangi kembali.' :
                     'Stok tidak berubah selama PO masih Pending.';
}

// =========================================================
// FORM: BUKA / SIMPAN
// =========================================================

function openForm(po = null) {
    $('po-form').reset();
    $('po-edit-id').value = po?.id ?? '';
    $('po-title').textContent = po ? 'Edit Purchase Order' : 'Buat Purchase Order';
    $('po-date').value = toInputValue(po?.order_date ?? new Date());
    $('po-status').value = po?.status || 'pending';
    $('po-notes').value = po?.notes || '';

    fillSuppliers(po?.supplier_id);

    $('po-items').innerHTML = '';
    (po?.items?.length ? po.items : [{}]).forEach(i => addRow(i.ingredient_id, i.quantity));

    recalc();
    updateStockHint();
    $('po-dialog').showModal();
}

function setSaving(on) {
    $('po-submit').disabled = on;
    $('po-submit-label').innerHTML = on ? '<span class="spinner-sm"></span> Menyimpan…' : 'Simpan Purchase Order';
}

async function submitPO(e) {
    e.preventDefault();

    const editId = $('po-edit-id').value;
    const { items, total, dup } = readItems();

    if (!items.length) return notify('Bahan belum diisi', 'Tambahkan minimal satu bahan dengan jumlah lebih dari 0.');
    if (dup) return notify('Bahan ganda', 'Ada bahan yang dipilih lebih dari sekali. Gabungkan jumlahnya di satu baris.');

    const payload = {
        supplier_id: $('po-supplier').value,
        order_date: fromInputValue($('po-date').value),
        status: $('po-status').value,
        total_amount: total,
        notes: $('po-notes').value.trim()
    };

    // Selisih stok = efek PO baru - efek PO lama
    const delta = stockDelta(
        stockEffect(editId ? findPO(editId) : null),
        stockEffect({ status: payload.status, items })
    );

    const insertItems = async poId => {
        const { error } = await db.from('purchase_order_items')
            .insert(items.map(i => ({ ...i, order_id: poId })));
        if (error) throw error;
    };

    setSaving(true);
    try {
        await withStock(delta, async () => {
            if (editId) {
                const { error } = await db.from('purchase_orders').update(payload).eq('id', editId);
                if (error) throw error;

                const { error: delErr } = await db.from('purchase_order_items').delete().eq('order_id', editId);
                if (delErr) throw delErr;

                await insertItems(editId);
                return;
            }

            const { data, error } = await db.from('purchase_orders').insert(payload).select('id').single();
            if (error) throw error;

            try {
                await insertItems(data.id);
            } catch (itemErr) {
                await db.from('purchase_orders').delete().eq('id', data.id); // jangan tinggalkan PO kosong
                throw itemErr;
            }
        });

        if (!editId) state.page = 1;
        $('po-dialog').close();
        toast((editId ? 'Purchase Order diperbarui.' : 'Purchase Order dibuat.') + stockNote(delta));
        await refresh();
    } catch (err) {
        console.error('Simpan PO gagal:', err);
        notify('Gagal menyimpan', errText(err), '❌');
    } finally {
        setSaving(false);
    }
}

// =========================================================
// AKSI BARIS: STATUS & HAPUS
// =========================================================

const setBusy = (id, on) => $(`po-row-${id}`)?.classList.toggle('row-busy', on);
const fetchPO = async id => (await db.from('purchase_orders').select('id,status').eq('id', id).maybeSingle()).data;

async function toggleStatus(id) {
    const po = findPO(id);
    if (!po) return;

    const next = po.status === 'completed' ? 'pending' : 'completed';
    const delta = stockDelta(stockEffect(po), stockEffect({ ...po, status: next }));

    setBusy(id, true);
    try {
        await withStock(delta, async () => {
            const { error } = await db.from('purchase_orders').update({ status: next }).eq('id', id);
            if (error) throw error;

            // Pastikan benar-benar berubah (RLS bisa menolak tanpa error) agar stok tidak salah
            if ((await fetchPO(id))?.status !== next) {
                throw new Error('Status tidak berubah. Periksa policy (RLS) tabel purchase_orders.');
            }
        });

        toast(`Status diubah menjadi ${STATUS[next].label}.` + stockNote(delta));
        await refresh();
    } catch (err) {
        console.error('Ubah status gagal:', err);
        notify('Gagal mengubah status', errText(err), '❌');
    } finally {
        setBusy(id, false);
    }
}

async function deletePO(id) {
    const po = findPO(id);
    if (!po) return;

    const delta = stockDelta(stockEffect(po), new Map()); // PO Selesai -> stok dikembalikan (dikurangi)
    const ok = await confirmBox(
        'Hapus Purchase Order ini?',
        delta.size
            ? 'PO ini berstatus Selesai, jadi stok yang pernah ditambahkan akan dikurangi kembali. Rincian bahan ikut terhapus dan tindakan ini tidak dapat dibatalkan.'
            : 'Rincian bahan pada PO ini ikut terhapus. Tindakan ini tidak dapat dibatalkan.',
        'Ya, hapus'
    );
    if (!ok) return;

    setBusy(id, true);
    try {
        await withStock(delta, async () => {
            const { error: itemErr } = await db.from('purchase_order_items').delete().eq('order_id', id);
            if (itemErr) throw itemErr;

            const { error } = await db.from('purchase_orders').delete().eq('id', id);
            if (error) throw error;

            if (await fetchPO(id)) {
                throw new Error('PO masih ada setelah dihapus. Periksa policy (RLS) tabel purchase_orders.');
            }
        });

        toast('Purchase Order dihapus.' + stockNote(delta));
        await refresh();
    } catch (err) {
        console.error('Hapus PO gagal:', err);
        notify('Gagal menghapus', errText(err), '❌');
    } finally {
        setBusy(id, false);
    }
}

// =========================================================
// EVENTS
// =========================================================

let searchTimer;
$('po-search').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
        state.query = e.target.value.toLowerCase().trim();
        state.page = 1;
        render();
    }, 250);
});

$('status-tabs').addEventListener('click', e => {
    const btn = e.target.closest('[data-status]');
    if (!btn) return;
    state.status = btn.dataset.status;
    state.page = 1;
    render();
});

$('po-pager').addEventListener('click', e => {
    const btn = e.target.closest('[data-page]');
    if (!btn) return;
    state.page = Number(btn.dataset.page) || 1;
    render();
});

$('po-size').addEventListener('change', e => {
    state.size = Number(e.target.value) || 10;
    state.page = 1;
    render();
});

$('po-body').addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;

    const id = btn.closest('tr')?.dataset.id;
    const actions = {
        retry: load,
        edit: () => openForm(findPO(id)),
        toggle: () => toggleStatus(id),
        delete: () => deletePO(id)
    };
    actions[btn.dataset.act]?.();
});

$('btn-create').addEventListener('click', () => openForm());
$('po-form').addEventListener('submit', submitPO);
$('po-supplier').addEventListener('change', updatePhoneWarning);
$('po-status').addEventListener('change', updateStockHint);
$('po-close').addEventListener('click', () => $('po-dialog').close());
$('po-cancel').addEventListener('click', () => $('po-dialog').close());

$('po-add-row').addEventListener('click', () => {
    addRow();
    recalc();
    $('po-items').lastElementChild.querySelector('select').focus();
});

$('po-items').addEventListener('input', recalc);
$('po-items').addEventListener('change', recalc);
$('po-items').addEventListener('click', e => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    btn.closest('.item-row').remove();
    if (!$('po-items').children.length) addRow();
    recalc();
});

// Klik area gelap menutup dialog pesan/konfirmasi (form PO sengaja tidak, agar isian tidak hilang)
['msg-dialog', 'confirm-dialog'].forEach(id =>
    $(id).addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); }));

load();
