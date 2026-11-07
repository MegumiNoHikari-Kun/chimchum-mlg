import { supabase, authReady } from '../supabase.js';

// =========================================================
// CONFIG
// =========================================================

const STOCK_COL = 'stock';                    // nama kolom stok di tabel ingredients
const PRICE_COL = 'price';                    // harga master per satuan stok di tabel ingredients
const STOCK_RPC = 'adjust_ingredient_stock';  // fungsi SQL atomik (lihat purchase_order_stock.sql)
const TZ = 'Asia/Jakarta';
const PREF_UPDATE_PRICE = 'chimchum.po.updateMasterPrice';

const STATUS = {
    pending:    { label: 'Pending', badge: 'bg-amber-50 text-amber-700 ring-amber-200' },
    processing: { label: 'Proses',  badge: 'bg-sky-50 text-sky-700 ring-sky-200' },
    completed:  { label: 'Selesai', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200' }
};
const FLOW = ['pending', 'processing', 'completed'];   // urutan alur
const nextOf = s => FLOW[FLOW.indexOf(s) + 1];
const prevOf = s => FLOW[FLOW.indexOf(s) - 1];

const ADVANCE = {   // tombol "maju" per status saat ini
    pending:    { icon: 'fa-play',         short: 'Proses',  cls: 'text-sky-600 hover:bg-sky-50',         btn: 'bg-sky-500 hover:bg-sky-600',         title: 'Mulai proses (Pending → Proses)' },
    processing: { icon: 'fa-circle-check', short: 'Selesai', cls: 'text-emerald-600 hover:bg-emerald-50', btn: 'bg-emerald-500 hover:bg-emerald-600', title: 'Tandai Selesai (stok bertambah)' }
};
const BACK_TITLE = {  // tombol "mundur" per status saat ini
    processing: 'Kembalikan ke Pending',
    completed:  'Kembalikan ke Proses (stok dikurangi)'
};

const TABS = [['all', 'Semua'], ...FLOW.map(k => [k, STATUS[k].label])];

const state = {
    pos: [], suppliers: [], ingredients: [],
    page: 1, size: 10, status: 'all', query: ''
};
let db;

// =========================================================
// SATUAN & KONVERSI
// Stok selalu disimpan dalam satuan bahan (ingredients.unit).
// Saat beli, user boleh pakai satuan lain yang sejenis (mis. stok "gram", beli "kg").
// Harga per satuan terkecil = total harga / jumlah dalam gram (massa) atau ml (volume).
// =========================================================

const UNIT_DEFS = {
    mg:  { dim: 'mass', factor: 0.001, label: 'mg' },
    g:   { dim: 'mass', factor: 1,     label: 'gram' },
    ons: { dim: 'mass', factor: 100,   label: 'ons' },
    kg:  { dim: 'mass', factor: 1000,  label: 'kg' },
    ml:  { dim: 'vol',  factor: 1,     label: 'ml' },
    l:   { dim: 'vol',  factor: 1000,  label: 'liter' }
};
const UNIT_ALIAS = {
    mg: 'mg', miligram: 'mg', milligram: 'mg',
    g: 'g', gr: 'g', grm: 'g', gram: 'g', grams: 'g',
    ons: 'ons',
    kg: 'kg', kilo: 'kg', kilogram: 'kg',
    ml: 'ml', cc: 'ml', mililiter: 'ml', milliliter: 'ml',
    l: 'l', lt: 'l', ltr: 'l', liter: 'l', litre: 'l'
};
const SMALLEST = { mass: 'g', vol: 'ml' };   // satuan terkecil untuk info harga
const LARGE    = { mass: 'kg', vol: 'l' };   // satuan besar untuk tampilan ringkas

const unitKey = u => UNIT_ALIAS[String(u ?? '').trim().toLowerCase()] || null;
const unitLabel = (key, fallback = '') => UNIT_DEFS[key]?.label || fallback || 'unit';
const round = (n, d = 6) => Math.round(Number(n || 0) * 10 ** d) / 10 ** d;

// Faktor konversi from -> to (1 kalau tidak sejenis / tidak dikenal)
function ratio(from, to) {
    const a = UNIT_DEFS[unitKey(from)], b = UNIT_DEFS[unitKey(to)];
    return a && b && a.dim === b.dim ? a.factor / b.factor : 1;
}

// Satuan terkecil untuk satuan stok tertentu; null = satuan tanpa konversi (pcs, butir, pack…)
function smallestOf(stockUnit) {
    const k = unitKey(stockUnit);
    return k ? SMALLEST[UNIT_DEFS[k].dim] : null;
}

// Harga per satuan terkecil → { price, unit }. Mis. 150.000 / 5.000 gram = { price: 30, unit: 'gram' }
function perSmallest(subtotal, qty, stockUnit) {
    const small = smallestOf(stockUnit);
    const qtySmall = Number(qty || 0) * (small ? ratio(stockUnit, small) : 1);
    if (!(qtySmall > 0)) return null;
    return { price: Number(subtotal || 0) / qtySmall, unit: small ? unitLabel(small) : (stockUnit || 'unit') };
}

// Pilihan satuan beli yang sejenis dengan satuan stok
function unitOptions(stockUnit) {
    const k = unitKey(stockUnit);
    if (!k) return [{ value: '', label: stockUnit || 'unit' }];
    const dim = UNIT_DEFS[k].dim;
    return Object.entries(UNIT_DEFS)
        .filter(([key, d]) => d.dim === dim && (key !== 'mg' || k === 'mg'))
        .map(([key, d]) => ({ value: key, label: d.label }));
}

// Satuan tampilan yang enak dibaca: 5000 gram → 5 kg, 750 gram → 750 gram
function bestUnit(qty, stockUnit) {
    const k = unitKey(stockUnit);
    if (!k) return { key: '', qty };
    const dim = UNIT_DEFS[k].dim;
    const small = SMALLEST[dim], big = LARGE[dim];
    const inSmall = Number(qty) * ratio(k, small);
    const inBig = inSmall / UNIT_DEFS[big].factor;
    if (Math.abs(inBig) >= 1 && Math.abs(inBig * 1000 - Math.round(inBig * 1000)) < 1e-6) {
        return { key: big, qty: round(inBig) };
    }
    return { key: small, qty: round(inSmall) };
}

function prettyQty(qty, stockUnit) {
    if (!unitKey(stockUnit)) return `${num(qty)} ${stockUnit || ''}`.trim();
    const b = bestUnit(Number(qty || 0), stockUnit);
    return `${num(b.qty)} ${unitLabel(b.key)}`;
}

// =========================================================
// HELPERS
// =========================================================

const $ = id => document.getElementById(id);
const same = (a, b) => String(a) === String(b);
const num = (n, max = 3) => Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: max });
const fmtInt = n => num(Math.round(Number(n || 0)), 0);
const rp = n => 'Rp ' + fmtInt(n);
const rpUnit = n => 'Rp ' + num(n, Math.abs(n) < 100 ? 2 : 0);   // harga per satuan (bisa desimal)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const errText = e =>
    [e?.message, e?.details, e?.hint].filter(Boolean).join('\n') || 'Terjadi kesalahan yang tidak diketahui.';

// "150.000", "150rb", "150k", "1,5jt", "Rp 150.000" → 150000
function parseRupiah(v) {
    let s = String(v ?? '').toLowerCase().replace(/rp|\s/g, '');
    let mult = 1;
    const m = s.match(/(rb|ribu|k|jt|juta)$/);
    if (m) {
        mult = /^(jt|juta)$/.test(m[1]) ? 1e6 : 1e3;
        s = s.slice(0, -m[1].length);
        if (/^\d+\.\d{1,2}$/.test(s)) s = s.replace('.', ',');   // "1.5jt" = 1,5 juta
    }
    s = s.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s);
    return Number.isFinite(n) && n > 0 ? Math.round(n * mult) : 0;
}

const fmtDate = d => new Date(d).toLocaleString('id-ID', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' });
// <input type="datetime-local"> <-> ISO, selalu dibaca sebagai WIB (GMT+7)
const toInputValue = d => new Date(d).toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 16).replace(' ', 'T');
const fromInputValue = v => new Date(`${v}:00+07:00`).toISOString();

const findPO = id => state.pos.find(p => same(p.id, id));
const supplierOf = id => state.suppliers.find(s => same(s.id, id));
const supplierName = s => s?.name || s?.nama || 'Supplier Umum';
const ingredientOf = id => state.ingredients.find(i => same(i.id, id));

const pref = {
    get updatePrice() { try { return localStorage.getItem(PREF_UPDATE_PRICE) === '1'; } catch { return false; } },
    set updatePrice(v) { try { localStorage.setItem(PREF_UPDATE_PRICE, v ? '1' : '0'); } catch { /* abaikan */ } }
};

// =========================================================
// FEEDBACK (toast, pesan, konfirmasi)
// =========================================================

let toastTimer;
function toast(message, type = 'success') {
    const el = $('toast');
    el.textContent = message;
    el.className = `toast show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 4200);
}

function notify(title, message, icon = '⚠️') {
    $('msg-icon').textContent = icon;
    $('msg-title').textContent = title;
    $('msg-text').textContent = message;
    $('msg-dialog').showModal();
}

function confirmBox(title, message, okLabel, { icon = '🗑️', danger = true } = {}) {
    const dlg = $('confirm-dialog');
    $('confirm-icon').textContent = icon;
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = message;
    $('confirm-ok').textContent = okLabel;
    $('confirm-ok').className = `btn-primary flex-1 ${danger ? '!bg-rose-600 hover:!bg-rose-700' : ''}`;
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
        const d = round((after.get(id) || 0) - (before.get(id) || 0));
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

    const next = round(Number(data[STOCK_COL] || 0) + delta);
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
// HARGA MASTER (opsional): harga bahan = harga beli per satuan stok dari PO terakhir
// =========================================================

async function updateMasterPrices(items) {
    let ok = 0;
    const failed = [];
    for (const it of items || []) {
        const price = Number(it.unit_price);
        if (!(price > 0)) continue;

        const write = val => db.from('ingredients').update({ [PRICE_COL]: val }).eq('id', it.ingredient_id).select('id');
        let { data, error } = await write(round(price, 4));
        if (error?.code === '22P02') ({ data, error } = await write(Math.round(price)));   // kolom integer

        if (error || !data?.length) failed.push(it.ingredient_name || 'Bahan');
        else ok++;
    }
    return { ok, failed };
}

const priceNote = r =>
    !r ? '' :
    r.failed.length ? ` Harga master gagal diperbarui: ${r.failed.join(', ')}.` :
    r.ok ? ` Harga master ${r.ok} bahan diperbarui.` : '';

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
    setListMessage(loadingHtml());
    try {
        await authReady;
        if (!supabase) throw new Error('Supabase client tidak tersedia.');
        db = supabase;
        await loadAll();
    } catch (err) {
        console.error('Gagal memuat PO:', err);
        setListMessage(errorHtml(errText(err)));
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
        .map(i => `${i.ingredient_name || ''} ${i.quantity} ${i.unit || ''} ${prettyQty(i.quantity, i.unit)} ${i.subtotal} ${fmtInt(i.subtotal)}`)
        .join(' ');

    return [
        dates,
        supplierName(supplierOf(po.supplier_id)),
        `${STATUS[po.status]?.label || 'Pending'} ${po.status}`,
        total, fmtInt(total), 'rp',
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

const loadingHtml = () => `
    <div class="spinner-dark mx-auto mb-3"></div>
    <p class="text-slate-400">Memuat Purchase Order…</p>`;

const errorHtml = msg => `
    <p class="font-semibold text-rose-600">Data tidak bisa dimuat</p>
    <p class="mx-auto mt-1 max-w-md whitespace-pre-line text-slate-500">${esc(msg)}</p>
    <button data-act="retry" class="btn-ghost mt-4">Coba lagi</button>`;

const emptyHtml = hasFilter => `
    <i class="fa-solid fa-inbox mb-2 block text-3xl text-slate-300"></i>
    <p class="text-slate-400">${hasFilter ? 'Tidak ada PO yang cocok dengan pencarian.' : 'Belum ada Purchase Order. Tekan “Buat PO baru” untuk mulai.'}</p>`;

function setListMessage(html) {
    $('po-body').innerHTML = `<tr><td colspan="6" class="p-12 text-center">${html}</td></tr>`;
    $('po-cards').innerHTML = `<div class="rounded-3xl border border-slate-200 bg-white p-10 text-center text-sm sm:col-span-2">${html}</div>`;
    $('po-info').textContent = '';
    $('po-pager').innerHTML = '';
}

function waUrl(po, sup) {
    let phone = String(sup?.phone || '').replace(/\D/g, '');
    if (!phone) return '';
    if (phone.startsWith('0')) phone = '62' + phone.slice(1);

    const lines = po.items.map(i => `- ${i.ingredient_name || 'Bahan'}: *${prettyQty(i.quantity, i.unit)}*`).join('\n');
    const msg =
        `Halo ${supplierName(sup)}, saya ingin melakukan order bahan baku:\n\n${lines}\n\n` +
        `Catatan: ${po.notes || '-'}\nTotal: ${rp(po.total_amount)}\nTerima kasih!`;

    return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}

const badgeHtml = status =>
    `<span class="inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${STATUS[status].badge}">${STATUS[status].label}</span>`;

function itemsHtml(po, max = 3) {
    const shown = po.items.slice(0, max);
    const more = po.items.length - shown.length;
    const li = shown.map(i => {
        const p = perSmallest(i.subtotal, i.quantity, i.unit);
        return `
        <li class="flex flex-wrap items-baseline gap-x-1.5">
            <span class="text-slate-700">${esc(i.ingredient_name || 'Bahan')}</span>
            <b class="text-slate-800">${esc(prettyQty(i.quantity, i.unit))}</b>
            <span class="text-slate-400">${rp(i.subtotal)}${p && i.subtotal ? ` · ${rpUnit(p.price)}/${esc(p.unit)}` : ''}</span>
        </li>`;
    }).join('');
    return `
        <ul class="space-y-1">
            ${li || '<li class="text-slate-400">Tidak ada item</li>'}
            ${more > 0 ? `<li class="text-slate-400">+${more} bahan lainnya</li>` : ''}
        </ul>`;
}

// Tombol aksi (dipakai tabel & kartu)
function actionButtons(po, status, { withAdvance = true } = {}) {
    const next = nextOf(status), prev = prevOf(status);
    const wa = waUrl(po, supplierOf(po.supplier_id));
    return `
        ${wa
            ? `<a href="${wa}" target="_blank" rel="noopener" title="Kirim via WhatsApp" aria-label="Kirim via WhatsApp"
                  class="icon-btn text-emerald-600 hover:bg-emerald-50"><i class="fa-brands fa-whatsapp text-base lg:text-sm"></i></a>`
            : `<span title="Supplier belum punya nomor WhatsApp" class="icon-btn cursor-not-allowed opacity-30"><i class="fa-brands fa-whatsapp text-base lg:text-sm"></i></span>`}
        <button data-act="edit" title="Edit" aria-label="Edit" class="icon-btn hover:text-orange-600"><i class="fa-solid fa-pen"></i></button>
        ${prev
            ? `<button data-act="status" data-to="${prev}" title="${BACK_TITLE[status]}" aria-label="${BACK_TITLE[status]}"
                  class="icon-btn hover:text-amber-600"><i class="fa-solid fa-rotate-left"></i></button>`
            : '<span class="icon-btn invisible" aria-hidden="true"></span>'}
        ${withAdvance ? (next
            ? `<button data-act="status" data-to="${next}" title="${ADVANCE[status].title}" aria-label="${ADVANCE[status].title}"
                  class="icon-btn ${ADVANCE[status].cls}"><i class="fa-solid ${ADVANCE[status].icon}"></i></button>`
            : '<span class="icon-btn invisible" aria-hidden="true"></span>') : ''}
        <button data-act="delete" title="Hapus" aria-label="Hapus" class="icon-btn hover:bg-rose-50 hover:text-rose-600"><i class="fa-solid fa-trash"></i></button>`;
}

// Baris tabel (layar lebar)
function rowHtml(po) {
    const sup = supplierOf(po.supplier_id);
    const status = STATUS[po.status] ? po.status : 'pending';
    return `
    <tr data-id="${esc(po.id)}" class="align-top transition hover:bg-slate-50">
        <td class="whitespace-nowrap p-4 font-medium">${fmtDate(po.order_date)} WIB</td>
        <td class="p-4 font-semibold">${esc(supplierName(sup))}</td>
        <td class="p-4">${badgeHtml(status)}</td>
        <td class="whitespace-nowrap p-4 font-bold text-orange-600">${rp(po.total_amount)}</td>
        <td class="p-4 text-slate-600">
            ${po.notes ? `<p class="mb-1.5 italic text-slate-500">${esc(po.notes)}</p>` : ''}
            <div class="text-[11px]">${itemsHtml(po)}</div>
        </td>
        <td class="p-4">
            <div class="flex items-center justify-end gap-1">${actionButtons(po, status)}</div>
        </td>
    </tr>`;
}

// Kartu (HP & tablet)
function cardHtml(po) {
    const sup = supplierOf(po.supplier_id);
    const status = STATUS[po.status] ? po.status : 'pending';
    const next = nextOf(status);
    return `
    <article data-id="${esc(po.id)}" class="flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm transition">
        <div data-act="edit" class="flex-1 cursor-pointer p-4 pb-3">
            <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                    <p class="truncate text-sm font-semibold text-slate-900">${esc(supplierName(sup))}</p>
                    <p class="mt-0.5 text-xs text-slate-400">${fmtDate(po.order_date)} WIB</p>
                </div>
                ${badgeHtml(status)}
            </div>
            <div class="mt-3 text-xs">${itemsHtml(po, 4)}</div>
            ${po.notes ? `<p class="mt-2 line-clamp-2 text-xs italic text-slate-500">“${esc(po.notes)}”</p>` : ''}
        </div>
        <div class="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2.5">
            <div class="pl-1">
                <p class="text-[10px] font-medium uppercase tracking-wide text-slate-400">Total</p>
                <p class="text-base font-bold text-orange-600">${rp(po.total_amount)}</p>
            </div>
            <div class="flex items-center gap-0.5">
                ${actionButtons(po, status, { withAdvance: false })}
                ${next ? `<button data-act="status" data-to="${next}" title="${ADVANCE[status].title}"
                    class="ml-1 inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold text-white transition active:scale-95 ${ADVANCE[status].btn}">
                    <i class="fa-solid ${ADVANCE[status].icon}"></i>${ADVANCE[status].short}</button>` : ''}
            </div>
        </div>
    </article>`;
}

function renderStats() {
    const monthKey = d => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ }).slice(0, 7);
    const nowKey = monthKey(new Date());
    const sum = arr => arr.reduce((s, p) => s + Number(p.total_amount || 0), 0);

    const done = state.pos.filter(p => p.status === 'completed' && monthKey(p.order_date) === nowKey);
    const open = state.pos.filter(p => p.status !== 'completed');
    const month = new Date().toLocaleDateString('id-ID', { timeZone: TZ, month: 'long' });
    const supplierCount = new Set(state.pos.map(p => String(p.supplier_id))).size;

    const tile = (label, value, sub, icon, extra = '') => `
        <div class="stat ${extra}">
            <div class="flex items-center gap-2 text-[11px] font-medium text-slate-500">
                <i class="fa-solid ${icon} text-orange-400"></i>${label}
            </div>
            <p class="mt-1 truncate text-base font-bold text-slate-900 sm:text-lg">${value}</p>
            <p class="text-[11px] text-slate-400">${sub}</p>
        </div>`;

    $('po-stats').innerHTML =
        tile(`Belanja ${month}`, rp(sum(done)), `${done.length} PO selesai`, 'fa-wallet', 'col-span-2 sm:col-span-1') +
        tile('Belum diterima', rp(sum(open)), `${open.length} PO pending/proses`, 'fa-truck-ramp-box') +
        tile('Total PO', num(state.pos.length), `${supplierCount} supplier`, 'fa-file-invoice');
}

function renderTabs() {
    const count = s => s === 'all' ? state.pos.length : state.pos.filter(p => p.status === s).length;
    $('status-tabs').innerHTML = TABS.map(([key, label]) => `
        <button data-status="${key}" role="tab" aria-selected="${state.status === key}"
            class="shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition sm:py-1.5 ${state.status === key
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
            class="h-9 min-w-9 rounded-lg border px-2.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${active
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

    renderStats();
    renderTabs();
    $('po-count').textContent = `${list.length} dari ${state.pos.length} PO`;

    if (list.length) {
        const page = list.slice(start, start + state.size);
        $('po-body').innerHTML = page.map(rowHtml).join('');
        $('po-cards').innerHTML = page.map(cardHtml).join('');
    } else {
        setListMessage(emptyHtml(state.query || state.status !== 'all'));
    }
    renderPager(list.length, pages, start);
}

// =========================================================
// FORM: SUPPLIER
// =========================================================

function setSupplier(id = '') {
    const valid = supplierOf(id) ? id : '';
    $('po-supplier').value = valid;
    $('po-supplier-search').value = COMBOS.supplier.label(valid);
    updatePhoneWarning();
}

function updatePhoneWarning() {
    const id = $('po-supplier').value;
    $('phone-warning').classList.toggle('hidden', !id || !!supplierOf(id)?.phone);
}

// ---------- Combobox yang bisa dicari (supplier & bahan baku) ----------
// Pola HTML: <input type="text" data-combo="jenis"> + <input type="hidden"> (id terpilih) dalam satu pembungkus.
// Satu menu melayang `#combo-menu` dipakai bersama supaya tidak terpotong area scroll.

const menu = { el: $('combo-menu'), input: null, filter: '' };

const hiddenOf = input => input.parentElement.querySelector('input[type="hidden"]');
const comboOf = input => COMBOS[input.dataset.combo];

const ingLabel = id => {
    const i = ingredientOf(id);
    return i ? `${i.name}${i.unit ? ` (${i.unit})` : ''}` : '';
};

// "Rp 15.000/kg · Rp 15/gram"
function masterPriceText(ing) {
    const price = Number(ing?.[PRICE_COL] || 0);
    if (!(price > 0)) return '';
    const main = `${rpUnit(price)}/${ing.unit || 'unit'}`;
    const small = smallestOf(ing.unit);
    if (!small || unitKey(ing.unit) === small) return main;
    return `${main} · ${rpUnit(price / ratio(ing.unit, small))}/${unitLabel(small)}`;
}

// Tiap jenis combobox: label teks, daftar opsi, dan apa yang terjadi setelah dipilih.
const COMBOS = {
    supplier: {
        empty: 'Supplier tidak ditemukan',
        label: id => { const s = supplierOf(id); return s ? supplierName(s) : ''; },
        options: () => state.suppliers.map(s => ({
            id: s.id,
            title: supplierName(s),
            sub: s.phone ? `WA ${s.phone}` : 'Belum ada nomor WA'
        })),
        changed: updatePhoneWarning,
        next: () => $('po-date')
    },

    ingredient: {
        empty: 'Bahan tidak ditemukan',
        label: ingLabel,
        options: input => {
            // Bahan yang sudah dipilih di baris lain tidak bisa dipilih lagi
            const taken = new Set([...document.querySelectorAll('#po-items .item-ing')].map(h => h.value));
            taken.delete(hiddenOf(input).value);
            taken.delete('');

            return state.ingredients.map(i => ({
                id: i.id,
                title: i.name,
                sub: [i.unit, masterPriceText(i)].filter(Boolean).join(' — '),
                right: i[STOCK_COL] != null ? `stok ${prettyQty(i[STOCK_COL], i.unit)}` : '',
                disabled: taken.has(String(i.id)),
                disabledNote: 'sudah dipilih'
            }));
        },
        changed: input => onIngredientChanged(input.closest('.item-row')),
        next: input => input.closest('.item-row').querySelector('.item-qty')
    }
};

function positionMenu() {
    const r = menu.input.getBoundingClientRect();
    const vv = window.visualViewport;                       // ikut keyboard HP
    const viewTop = vv ? vv.offsetTop : 0;
    const viewBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;

    const width = Math.min(Math.max(r.width, 280), window.innerWidth - 16);
    const below = viewBottom - r.bottom;
    const above = r.top - viewTop;
    const openUp = below < 220 && above > below;

    Object.assign(menu.el.style, {
        width: `${width}px`,
        left: `${Math.max(8, Math.min(r.left, window.innerWidth - width - 8))}px`,
        top: openUp ? '' : `${r.bottom + 4}px`,
        bottom: openUp ? `${window.innerHeight - r.top + 4}px` : '',
        maxHeight: `${Math.max(120, Math.min(300, (openUp ? above : below) - 12))}px`
    });
}

function setActive(li) {
    menu.el.querySelectorAll('[data-active]').forEach(o => {
        o.removeAttribute('data-active');
        o.classList.remove('bg-orange-50');
    });
    if (!li) return;
    li.setAttribute('data-active', '');
    li.classList.add('bg-orange-50');
    li.scrollIntoView({ block: 'nearest' });
}

const enabledOptions = () => [...menu.el.querySelectorAll('[role="option"]:not([aria-disabled="true"])')];

function renderMenu() {
    const cfg = comboOf(menu.input);
    const current = hiddenOf(menu.input).value;
    const tokens = menu.filter.toLowerCase().split(/\s+/).filter(Boolean);

    const list = cfg.options(menu.input)
        .filter(o => tokens.every(t => `${o.title} ${o.sub || ''}`.toLowerCase().includes(t)))
        .slice(0, 100);

    menu.el.innerHTML = list.length
        ? list.map(o => `
            <li role="option" data-id="${esc(o.id)}" ${o.disabled ? 'aria-disabled="true"' : ''}
                class="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 sm:py-2 ${o.disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}">
                <span class="min-w-0">
                    <span class="block truncate font-medium text-slate-800">${esc(o.title)}</span>
                    ${o.sub ? `<span class="block truncate text-[11px] text-slate-400">${esc(o.sub)}</span>` : ''}
                </span>
                <span class="shrink-0 text-right text-[11px] text-slate-500">${esc(o.disabled ? o.disabledNote : o.right || '')}</span>
            </li>`).join('')
        : `<li class="px-3 py-4 text-center text-slate-400">${cfg.empty}</li>`;

    const opts = enabledOptions();
    setActive(opts.find(o => same(o.dataset.id, current)) || opts[0]);
}

function openMenu(input, filter = '', selectText = true) {
    menu.input = input;
    menu.filter = filter;
    if (selectText) input.select();
    menu.el.classList.remove('hidden');
    input.setAttribute('aria-expanded', 'true');
    positionMenu();
    renderMenu();
}

function closeMenu() {
    if (!menu.input) return;
    menu.input.setAttribute('aria-expanded', 'false');
    menu.el.classList.add('hidden');
    menu.input = null;
}

function chooseOption(id) {
    const input = menu.input;
    const cfg = comboOf(input);

    hiddenOf(input).value = id;
    input.value = cfg.label(id);
    closeMenu();
    cfg.changed(input);

    const next = cfg.next(input);
    next?.focus();
    if (next?.type === 'number') next.select();
}

function onComboKey(e) {
    const input = e.target;
    const isOpen = menu.input === input;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!isOpen) return openMenu(input);

        const opts = enabledOptions();
        if (!opts.length) return;
        const at = opts.findIndex(o => o.hasAttribute('data-active'));
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setActive(opts[(at + step + opts.length) % opts.length]);
    } else if (e.key === 'Enter' && isOpen) {
        e.preventDefault(); // jangan submit form
        const active = menu.el.querySelector('[data-active]');
        if (active) chooseOption(active.dataset.id);
    } else if (e.key === 'Escape' && isOpen) {
        e.preventDefault(); // tutup menu saja, bukan seluruh dialog
        e.stopPropagation();
        closeMenu();
    }
}

function onComboBlur(input) {
    const hidden = hiddenOf(input);
    if (!input.value.trim()) hidden.value = '';                 // dikosongkan = batal pilih
    input.value = comboOf(input).label(hidden.value);           // teks yang tidak dipilih dikembalikan
    if (menu.input === input) closeMenu();
    comboOf(input).changed(input);
}

// =========================================================
// FORM: BARIS BAHAN (jumlah + satuan beli + total harga nota)
// =========================================================

function addRow({ ingredient_id = '', quantity = '', subtotal = null } = {}) {
    const valid = ingredientOf(ingredient_id) ? String(ingredient_id) : '';
    const row = document.createElement('div');
    row.className = 'item-row rounded-2xl border border-slate-200 bg-white p-3 shadow-sm';
    row.innerHTML = `
        <div class="flex items-start gap-2">
            <div class="min-w-0 flex-1">
                <input type="text" data-combo="ingredient" class="item-search field font-medium" value="${esc(ingLabel(valid))}"
                       placeholder="Cari bahan baku…" autocomplete="off" role="combobox" aria-expanded="false"
                       aria-controls="combo-menu" aria-label="Bahan baku">
                <input type="hidden" class="item-ing" value="${esc(valid)}">
            </div>
            <button type="button" data-remove class="icon-btn text-rose-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Hapus baris">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
        <div class="mt-2 grid grid-cols-2 gap-2">
            <label class="block min-w-0">
                <span class="mini-label">Jumlah beli</span>
                <span class="flex">
                    <input type="number" step="any" min="0" inputmode="decimal" placeholder="0"
                           class="item-qty field min-w-0 rounded-r-none" aria-label="Jumlah beli">
                    <select class="item-unit field w-auto shrink-0 rounded-l-none border-l-0 bg-slate-50 !px-2" aria-label="Satuan beli"></select>
                </span>
            </label>
            <label class="block min-w-0">
                <span class="mini-label">Total harga (nota)</span>
                <span class="relative block">
                    <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">Rp</span>
                    <input type="text" inputmode="numeric" autocomplete="off" placeholder="0"
                           class="item-price field pl-9 text-right font-semibold" aria-label="Total harga beli">
                </span>
            </label>
        </div>
        <div class="item-info mt-2 rounded-lg bg-orange-50/70 px-2.5 py-1.5 text-[11px] leading-relaxed"></div>`;
    $('po-items').appendChild(row);

    row.dataset.ing = valid;
    const ing = ingredientOf(valid);
    const shown = ing && Number(quantity) > 0
        ? bestUnit(Number(quantity), ing.unit)
        : { key: unitKey(ing?.unit) || '', qty: quantity };

    fillUnits(row, ing, shown.key);
    row.querySelector('.item-qty').value = shown.qty === '' || shown.qty == null ? '' : shown.qty;

    if (subtotal != null) {
        row.querySelector('.item-price').value = fmtInt(subtotal);
        row.dataset.priceManual = '1';
    } else {
        autofill(row);
    }
    return row;
}

function fillUnits(row, ing, selected) {
    const sel = row.querySelector('.item-unit');
    const opts = ing ? unitOptions(ing.unit) : [{ value: '', label: 'satuan' }];
    sel.innerHTML = opts.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
    const fallback = unitKey(ing?.unit) || '';
    sel.value = opts.some(o => o.value === selected) ? selected : (opts.some(o => o.value === fallback) ? fallback : opts[0].value);
    sel.disabled = opts.length < 2;
}

// Nilai satu baris: jumlah dikonversi ke satuan stok
function rowCalc(row) {
    const id = row.querySelector('.item-ing').value;
    const ing = ingredientOf(id);
    const qtyIn = parseFloat(row.querySelector('.item-qty').value) || 0;
    const purchKey = row.querySelector('.item-unit').value;
    const baseQty = ing ? round(qtyIn * ratio(purchKey || ing.unit, ing.unit)) : 0;
    const subtotal = parseRupiah(row.querySelector('.item-price').value);
    return { id, ing, qtyIn, purchKey, baseQty, subtotal, manual: !!row.dataset.priceManual };
}

// Selama harga belum diketik manual, isi estimasi dari harga master
function autofill(row) {
    if (row.dataset.priceManual) return;
    const { ing, baseQty } = rowCalc(row);
    const master = Number(ing?.[PRICE_COL] || 0);
    row.querySelector('.item-price').value = master > 0 && baseQty > 0 ? fmtInt(baseQty * master) : '';
}

function onIngredientChanged(row) {
    const id = row.querySelector('.item-ing').value;
    if (row.dataset.ing !== id) {
        if (row.dataset.ing) row.dataset.priceManual = '';   // ganti bahan = harga lama tidak berlaku
        row.dataset.ing = id;
        fillUnits(row, ingredientOf(id));
        autofill(row);
    }
    recalc();
}

function rowInfoHtml(r) {
    if (!r.ing) return '<span class="text-slate-400">Pilih bahan, lalu isi jumlah & total harga sesuai nota.</span>';

    const small = smallestOf(r.ing.unit);
    const smallLabel = small ? unitLabel(small) : (r.ing.unit || 'unit');
    const stock = r.ing[STOCK_COL] != null
        ? `<div class="text-slate-400">Stok sekarang: ${esc(prettyQty(r.ing[STOCK_COL], r.ing.unit))}</div>` : '';

    if (!(r.baseQty > 0) || !(r.subtotal > 0)) {
        return `<span class="text-slate-500">Isi jumlah & total harga → harga per ${esc(smallLabel)} dihitung otomatis.</span>${stock}`;
    }

    const p = perSmallest(r.subtotal, r.baseQty, r.ing.unit);
    const parts = [`<b class="text-orange-700">${rpUnit(p.price)}</b> / ${esc(p.unit)}`];
    if (r.purchKey && r.purchKey !== small && r.qtyIn > 0) {
        parts.push(`${rpUnit(r.subtotal / r.qtyIn)} / ${esc(unitLabel(r.purchKey))}`);
    }

    let cmp = '';
    const master = Number(r.ing[PRICE_COL] || 0);
    if (!r.manual) {
        cmp = '<span class="text-slate-400">estimasi dari harga master — sesuaikan dengan nota</span>';
    } else if (master > 0) {
        const masterSmall = master / (small ? ratio(r.ing.unit, small) : 1);
        const diff = (p.price / masterSmall - 1) * 100;
        cmp = Math.abs(diff) < 0.5
            ? '<span class="chip bg-slate-100 text-slate-600">sama dengan harga master</span>'
            : `<span class="chip ${diff > 0 ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-700'}">
                   ${diff > 0 ? '▲' : '▼'} ${num(Math.abs(diff), 1)}% vs master (${rpUnit(masterSmall)}/${esc(smallLabel)})</span>`;
    }

    return `
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span class="text-slate-700">≈ ${parts.join(' · ')}</span>${cmp}
        </div>${stock}`;
}

function recalc() {
    const rows = [...document.querySelectorAll('#po-items .item-row')];
    const seen = new Set();
    const dup = new Set();
    let total = 0, count = 0;

    rows.forEach(row => {
        const r = rowCalc(row);
        if (r.ing && r.baseQty > 0) { total += r.subtotal; count++; }
        if (r.id) (seen.has(r.id) ? dup : seen).add(r.id);
        row.querySelector('.item-info').innerHTML = rowInfoHtml(r);
        row.querySelector('.item-price').classList.toggle('text-slate-400', !r.manual);
    });

    rows.forEach(row => {
        const id = row.querySelector('.item-ing').value;
        row.querySelector('.item-search').classList.toggle('dup-warning', dup.has(id));
    });

    $('dup-warning').classList.toggle('hidden', dup.size === 0);
    $('po-total').textContent = rp(total);
    $('po-item-count').textContent = count ? `· ${count} bahan` : '';
}

function readItems() {
    const items = [];
    const seen = new Set();
    let dup = false, missingQty = false, noPrice = 0, total = 0;

    document.querySelectorAll('#po-items .item-row').forEach(row => {
        const r = rowCalc(row);
        if (!r.id) return;
        if (!(r.baseQty > 0)) { missingQty = true; return; }

        if (seen.has(r.id)) dup = true;
        seen.add(r.id);

        const subtotal = Math.round(r.subtotal);
        if (!subtotal) noPrice++;
        total += subtotal;

        items.push({
            ingredient_id: r.id,
            ingredient_name: r.ing.name || 'Bahan',
            quantity: r.baseQty,                          // selalu dalam satuan stok
            unit: r.ing.unit || '',
            unit_price: round(subtotal / r.baseQty, 4),   // harga per satuan stok
            subtotal
        });
    });

    return { items, total, dup, missingQty, noPrice };
}

function updateStockHint() {
    const was = findPO($('po-edit-id').value)?.status === 'completed';
    const now = $('po-status').value === 'completed';

    $('stock-hint').textContent =
        now && was ? 'Selisih jumlah bahan akan disesuaikan ke stok.' :
        now        ? 'Saat disimpan, stok bahan bertambah sesuai jumlah pesanan.' :
        was        ? 'Stok yang sebelumnya ditambahkan akan dikurangi kembali.' :
                     'Stok tidak berubah selama PO belum Selesai.';
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
    $('po-update-price').checked = pref.updatePrice;

    setSupplier(po?.supplier_id);

    $('po-items').innerHTML = '';
    if (po?.items?.length) po.items.forEach(i => addRow(i));
    else addRow();

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
    const { items, total, dup, missingQty, noPrice } = readItems();

    if (!$('po-supplier').value) return notify('Supplier belum dipilih', 'Pilih supplier dari daftar yang muncul saat Anda mengetik.');
    if (!$('po-date').value) return notify('Tanggal belum diisi', 'Isi tanggal dan jam order.');
    if (missingQty) return notify('Jumlah belum diisi', 'Ada bahan yang jumlahnya masih kosong atau 0. Isi jumlahnya atau hapus barisnya.');
    if (!items.length) return notify('Bahan belum diisi', 'Tambahkan minimal satu bahan dengan jumlah lebih dari 0.');
    if (dup) return notify('Bahan ganda', 'Ada bahan yang dipilih lebih dari sekali. Gabungkan jumlahnya di satu baris.');
    if (noPrice) {
        const go = await confirmBox(
            'Ada bahan tanpa harga',
            `${noPrice} bahan belum diisi total harganya, jadi harga per satuannya tercatat Rp 0. Tetap simpan?`,
            'Tetap simpan', { icon: '💸', danger: false });
        if (!go) return;
    }

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
        const rows = items.map(i => ({ ...i, order_id: poId }));
        let { error } = await db.from('purchase_order_items').insert(rows);
        if (error?.code === '22P02') {   // kolom unit_price bertipe integer → kirim versi bulat
            ({ error } = await db.from('purchase_order_items')
                .insert(rows.map(r => ({ ...r, unit_price: Math.round(r.unit_price) }))));
        }
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

        const priceRes = payload.status === 'completed' && $('po-update-price').checked
            ? await updateMasterPrices(items) : null;

        if (!editId) state.page = 1;
        $('po-dialog').close();
        toast((editId ? 'Purchase Order diperbarui.' : 'Purchase Order dibuat.') + stockNote(delta) + priceNote(priceRes),
              priceRes?.failed.length ? 'error' : 'success');
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

const setBusy = (id, on) =>
    document.querySelectorAll(`#po-list [data-id="${CSS.escape(String(id))}"]`)
        .forEach(el => el.classList.toggle('row-busy', on));
const fetchPO = async id => (await db.from('purchase_orders').select('id,status').eq('id', id).maybeSingle()).data;

async function changeStatus(id, next) {
    const po = findPO(id);
    if (!po || !STATUS[next] || next === po.status) return;

    const delta = stockDelta(stockEffect(po), stockEffect({ ...po, status: next }));

    setBusy(id, true);
    try {
        await withStock(delta, async () => {
            const { error } = await db.from('purchase_orders').update({ status: next }).eq('id', id);
            if (error) throw error;

            // Pastikan benar-benar berubah (RLS bisa menolak tanpa error) agar stok tidak salah
            if ((await fetchPO(id))?.status !== next) {
                throw new Error('Status tidak berubah. Periksa policy (RLS) atau constraint kolom status di tabel purchase_orders.');
            }
        });

        const priceRes = next === 'completed' && pref.updatePrice ? await updateMasterPrices(po.items) : null;

        toast(`Status diubah menjadi ${STATUS[next].label}.` + stockNote(delta) + priceNote(priceRes),
              priceRes?.failed.length ? 'error' : 'success');
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
    btn.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
});

$('po-pager').addEventListener('click', e => {
    const btn = e.target.closest('[data-page]');
    if (!btn) return;
    state.page = Number(btn.dataset.page) || 1;
    render();
    $('po-list').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

$('po-size').addEventListener('change', e => {
    state.size = Number(e.target.value) || 10;
    state.page = 1;
    render();
});

// Aksi tabel & kartu (didelegasikan)
$('po-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;

    const id = btn.closest('[data-id]')?.dataset.id;
    const actions = {
        retry: load,
        edit: () => openForm(findPO(id)),
        status: () => changeStatus(id, btn.dataset.to),
        delete: () => deletePO(id)
    };
    actions[btn.dataset.act]?.();
});

$('btn-create').addEventListener('click', () => openForm());
$('fab-create').addEventListener('click', () => openForm());
$('po-form').addEventListener('submit', submitPO);
$('po-status').addEventListener('change', updateStockHint);
$('po-update-price').addEventListener('change', e => { pref.updatePrice = e.target.checked; });
$('po-close').addEventListener('click', () => $('po-dialog').close());
$('po-cancel').addEventListener('click', () => $('po-dialog').close());

$('po-add-row').addEventListener('click', () => {
    const row = addRow();
    recalc();
    row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    row.querySelector('.item-search').focus(); // langsung membuka daftar bahan
});

// Combobox (supplier & bahan) didelegasikan di level form
const isCombo = e => e.target.matches('[data-combo]');

$('po-form').addEventListener('focusin', e => {
    if (isCombo(e)) return openMenu(e.target);
    if (e.target.matches('.item-price, .item-qty')) e.target.select();   // ketik langsung menimpa
});

$('po-form').addEventListener('focusout', e => {
    if (isCombo(e)) return onComboBlur(e.target);

    // Rapikan harga: "150rb" → "150.000". Dikosongkan = kembali ke estimasi harga master
    if (e.target.matches('.item-price')) {
        const row = e.target.closest('.item-row');
        const v = parseRupiah(e.target.value);
        e.target.value = v ? fmtInt(v) : '';
        if (!v) { row.dataset.priceManual = ''; autofill(row); }
        recalc();
    }
});

$('po-form').addEventListener('keydown', e => { if (isCombo(e)) onComboKey(e); });

$('po-form').addEventListener('input', e => {
    const t = e.target;
    if (isCombo(e)) {
        if (menu.input !== t) return openMenu(t, t.value, false);
        menu.filter = t.value;
        positionMenu();
        renderMenu();
        return;
    }

    const row = t.closest('.item-row');
    if (!row) return;
    if (t.matches('.item-price')) row.dataset.priceManual = t.value.trim() ? '1' : '';
    else autofill(row);   // jumlah / satuan berubah → estimasi ikut berubah
    recalc();
});

$('po-items').addEventListener('click', e => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    btn.closest('.item-row').remove();
    if (!$('po-items').children.length) addRow();
    recalc();
});

// Menu combobox: mousedown ditahan agar input tidak kehilangan fokus sebelum klik terbaca
menu.el.addEventListener('mousedown', e => e.preventDefault());
menu.el.addEventListener('mouseover', e => {
    const li = e.target.closest('[role="option"]');
    if (li && li.getAttribute('aria-disabled') !== 'true') setActive(li);
});
menu.el.addEventListener('click', e => {
    const li = e.target.closest('[role="option"]');
    if (li && li.getAttribute('aria-disabled') !== 'true') chooseOption(li.dataset.id);
});

// Saat isi dialog di-scroll (termasuk scroll otomatis karena keyboard HP), menu ikut dipindah;
// ditutup hanya kalau input-nya sudah keluar dari area terlihat.
$('po-dialog').addEventListener('scroll', e => {
    if (!menu.input || menu.el.contains(e.target) || !e.target.getBoundingClientRect) return;
    const r = menu.input.getBoundingClientRect();
    const box = e.target.getBoundingClientRect();
    if (r.bottom < box.top || r.top > box.bottom) closeMenu();
    else positionMenu();
}, true);
$('po-dialog').addEventListener('close', closeMenu);

const reposition = () => menu.input && positionMenu();
window.addEventListener('resize', reposition);
window.visualViewport?.addEventListener('resize', reposition);
window.visualViewport?.addEventListener('scroll', reposition);

// Klik area gelap menutup dialog pesan/konfirmasi (form PO sengaja tidak, agar isian tidak hilang)
['msg-dialog', 'confirm-dialog'].forEach(id =>
    $(id).addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); }));

// "/" untuk langsung mencari (keyboard desktop)
document.addEventListener('keydown', e => {
    if (e.key === '/' && !document.querySelector('dialog[open]') && !/input|textarea|select/i.test(document.activeElement?.tagName)) {
        e.preventDefault();
        $('po-search').focus();
    }
});

$('po-status').innerHTML = FLOW.map(k => `<option value="${k}">${STATUS[k].label}</option>`).join('');
load();
