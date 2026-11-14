import { supabase as db, authReady } from '../supabase.js';

// =========================================================
// KONFIGURASI & STATE
// =========================================================
const LOW_STOCK = 5;
const PLACEHOLDER = 'https://placehold.co/80x80?text=Produk';
const TABS = ['recipes', 'mapping', 'calculator', 'ingredients'];
const UNITS = [
    ['gram', 'gram (g)'], ['kg', 'kilogram (kg)'], ['ml', 'mililiter (ml)'], ['liter', 'liter (l)'],
    ['pcs', 'pcs / butir'], ['sdt', 'sendok teh (sdt)'], ['sdm', 'sendok makan (sdm)']
];

const S = { ingredients: [], products: [], recipes: [], suppliers: [] };
let orderDraft = []; // bahan yang kurang, dipakai oleh modal order

// =========================================================
// HELPER
// =========================================================
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = n => (Number(n) || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 });
const rp = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const same = (a, b) => String(a) === String(b);
const msg = (e, fallback = 'Terjadi kesalahan.') =>
    e?.message ? e.message + (/row-level security|permission denied/i.test(e.message) ? ' (periksa RLS policy)' : '') : fallback;
const emptyRow = (cols, html) => `<tr><td colspan="${cols}" class="empty">${html}</td></tr>`;

// Getter fleksibel: kolom bahasa Indonesia atau Inggris
const pName = p => p.nama ?? p.name ?? 'Produk';
const pStock = p => Number(p.stok ?? p.stock) || 0;
const pPhoto = p => p.foto || p.image || PLACEHOLDER;
const recName = r => r.name ?? r.description ?? 'Tanpa nama';
const supName = s => s.name ?? s.nama ?? 'Supplier';
const ingById = id => S.ingredients.find(i => same(i.id, id));
const recById = id => S.recipes.find(r => same(r.id, id));
const isMapped = p => !!p.resep_id && !!recById(p.resep_id);
const sortBy = (arr, fn) => arr.sort((a, b) => String(fn(a)).localeCompare(String(fn(b)), 'id'));

// Biaya bahan per 1 batch & jumlah resep yang memakai suatu bahan
const recipeCost = items => (items ?? []).reduce((s, it) =>
    s + (Number(it.amount) || 0) * (Number(ingById(it.ingredientId)?.price) || 0), 0);
const usageCount = id => S.recipes.filter(r => (r.items ?? []).some(it => same(it.ingredientId, id))).length;

const stockBadge = st =>
    st <= 0 ? '<span class="badge b-bad">Habis (0)</span>'
    : st <= LOW_STOCK ? `<span class="badge b-warn">Menipis (${st})</span>`
    : `<span class="badge b-ok">Aman (${st})</span>`;

// =========================================================
// UI KIT: toast, modal, konfirmasi, tombol sibuk
// =========================================================
function toast(message, type = 'success') {
    const style = {
        success: ['bg-emerald-600', 'fa-circle-check'],
        error: ['bg-rose-600', 'fa-circle-exclamation'],
        warn: ['bg-amber-500', 'fa-triangle-exclamation'],
        info: ['bg-slate-800', 'fa-circle-info']
    }[type];
    const el = document.createElement('div');
    el.className = `${style[0]} text-white text-xs font-medium px-4 py-3 rounded-xl shadow-lg flex items-start gap-2 transition duration-300 opacity-0 translate-y-2`;
    el.innerHTML = `<i class="fa-solid ${style[1]} mt-0.5"></i><span class="whitespace-pre-line">${esc(message)}</span>`;
    $('toasts').appendChild(el);
    requestAnimationFrame(() => el.classList.remove('opacity-0', 'translate-y-2'));
    setTimeout(() => {
        el.classList.add('opacity-0');
        setTimeout(() => el.remove(), 300);
    }, type === 'error' ? 6000 : 3200);
}

const openModal = id => $(id).classList.remove('hidden');
const closeModal = id => { spClose(); $(id).classList.add('hidden'); };

function confirmBox({ title, message, okText = 'Ya, lanjutkan', danger = false }) {
    return new Promise(resolve => {
        const ok = $('confirmOk'), cancel = $('confirmCancel');
        $('confirmTitle').textContent = title;
        $('confirmMessage').textContent = message;
        $('confirmIcon').className = danger ? 'fa-solid fa-triangle-exclamation text-rose-500' : 'fa-solid fa-circle-question text-orange-500';
        ok.textContent = okText;
        ok.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
        const finish = v => { ok.onclick = cancel.onclick = null; closeModal('confirmModal'); resolve(v); };
        ok.onclick = () => finish(true);
        cancel.onclick = () => finish(false);
        openModal('confirmModal');
        ok.focus();
    });
}

// Kunci tombol + spinner selama proses berjalan (mencegah klik ganda)
async function busy(btn, fn) {
    if (!btn) return fn();
    if (btn.dataset.busy) return;
    const html = btn.innerHTML;
    btn.dataset.busy = '1';
    btn.classList.add('opacity-60', 'pointer-events-none');
    btn.innerHTML = `<i class="fa-solid fa-circle-notch spin"></i> ${esc(btn.textContent.trim())}`;
    try { return await fn(); }
    finally {
        delete btn.dataset.busy;
        btn.classList.remove('opacity-60', 'pointer-events-none');
        btn.innerHTML = html;
    }
}

// =========================================================
// TAB
// =========================================================
function showTab(name) {
    if (!TABS.includes(name)) name = 'recipes';
    spClose();
    TABS.forEach(t => $('panel-' + t).classList.toggle('hidden', t !== name));
    document.querySelectorAll('.tab').forEach(b => {
        const on = b.dataset.tab === name;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on);
    });
    history.replaceState(null, '', '#' + name);
}

// =========================================================
// LOAD DATA (4 tabel paralel)
// =========================================================
async function loadData() {
    const names = ['ingredients', 'products', 'recipes', 'suppliers'];
    const failed = [];

    try {
        const res = await Promise.all(names.map(n => db.from(n).select('*')));
        names.forEach((n, i) => {
            if (res[i].error) { failed.push(n); console.error(`Gagal memuat ${n}:`, res[i].error); }
            else S[n] = res[i].data ?? [];
        });
    } catch (err) {
        console.error('Gagal memuat data:', err);
        failed.push('koneksi');
    }

    sortBy(S.ingredients, i => i.name ?? '');
    sortBy(S.products, pName);
    sortBy(S.recipes, recName);
    sortBy(S.suppliers, supName);

    $('loadError').classList.toggle('hidden', !failed.length);
    if (failed.length) $('loadErrorMsg').textContent = `Gagal memuat: ${failed.join(', ')}. Periksa koneksi atau RLS policy.`;

    renderAll();
}

function renderAll() {
    renderStats();
    renderLowStock();
    renderRecipes();
    renderMapping();
    renderIngredients();
    renderCalcOptions();
}

// =========================================================
// RENDER: statistik & peringatan stok
// =========================================================
function renderStats() {
    const unmapped = S.products.filter(p => !isMapped(p)).length;
    $('statRecipes').textContent = S.recipes.length;
    $('statProducts').textContent = S.products.length;
    $('statUnmapped').textContent = unmapped;
    $('unmappedBadge').textContent = unmapped;
    $('unmappedBadge').classList.toggle('hidden', !unmapped);
}

function renderLowStock() {
    const low = S.products.filter(p => pStock(p) <= LOW_STOCK).sort((a, b) => pStock(a) - pStock(b));
    $('lowStock').classList.toggle('hidden', !low.length);
    $('lowStockList').innerHTML =
        low.slice(0, 10).map(p =>
            `<button type="button" class="badge bg-white border hover:shadow-sm transition ${pStock(p) <= 0 ? 'border-rose-300 text-rose-700' : 'border-amber-300 text-amber-700'}"
                data-action="calc-product" data-id="${esc(p.id)}" title="Hitung produksi ${esc(pName(p))}">${esc(pName(p))}: ${pStock(p)}</button>`
        ).join('') +
        (low.length > 10 ? `<span class="badge bg-white border border-slate-200 text-slate-500">+${low.length - 10} lainnya</span>` : '');
}

// =========================================================
// TAB 1: MASTER RESEP
// =========================================================
const RECIPE_PREVIEW = 5; // jumlah bahan yang tampil sebelum "lihat semua"

// Ringkasan satu resep: biaya, bahan per baris, dan batch maksimal dari stok gudang
function recipeInfo(r) {
    const rows = (r.items ?? []).map(it => {
        const ing = ingById(it.ingredientId);
        const amount = Number(it.amount) || 0;
        const stock = Number(ing?.stock) || 0;
        return {
            ing, amount, stock,
            cost: amount * (Number(ing?.price) || 0),
            canMake: ing && amount > 0 ? stock / amount : 0
        };
    });
    const cost = rows.reduce((s, x) => s + x.cost, 0);
    const valid = rows.filter(x => x.amount > 0);
    const limiter = valid.reduce((min, x) => (!min || x.canMake < min.canMake ? x : min), null);
    const maxBatch = limiter ? Math.floor(limiter.canMake * 10) / 10 : 0;
    // bahan termahal di atas agar komposisi penting terlihat dulu
    rows.sort((a, b) => b.cost - a.cost || String(a.ing?.name ?? '').localeCompare(String(b.ing?.name ?? ''), 'id'));
    return { rows, cost, maxBatch, limiter };
}

function compRow(x, total) {
    const share = total > 0 ? Math.round(x.cost / total * 100) : 0;
    const ok = x.ing && x.stock >= x.amount;
    return `<li class="py-1.5" title="${x.ing ? `Stok ${num(x.stock)} ${esc(x.ing.unit)} · ${rp(x.cost)} (${share}% biaya)` : 'Bahan sudah dihapus'}">
        <div class="flex items-center justify-between gap-3 text-xs">
            <span class="flex items-center min-w-0">
                <span class="dot ${!x.ing ? 'bg-slate-300' : ok ? 'bg-emerald-500' : 'bg-rose-500'}"></span>
                ${x.ing ? `<span class="truncate text-slate-700">${esc(x.ing.name)}</span>` : '<em class="text-rose-500">Bahan terhapus</em>'}
            </span>
            <span class="whitespace-nowrap text-slate-500"><strong class="text-slate-800">${num(x.amount)}</strong> ${esc(x.ing?.unit)}</span>
        </div>
        <div class="h-1 bg-slate-100 rounded-full mt-1 overflow-hidden"><div class="h-full bg-orange-300 rounded-full" style="width:${share}%"></div></div>
    </li>`;
}

function renderRecipes() {
    const q = $('recipeSearch').value.toLowerCase().trim();
    const list = S.recipes.filter(r =>
        !q ||
        recName(r).toLowerCase().includes(q) ||
        (r.items ?? []).some(it => String(ingById(it.ingredientId)?.name ?? '').toLowerCase().includes(q))
    );

    if (!list.length) {
        $('recipeBody').innerHTML = `<div class="card empty-card sm:col-span-2 xl:col-span-3">${S.recipes.length
            ? 'Tidak ada resep yang cocok dengan pencarian.'
            : '<i class="fa-solid fa-book-open text-2xl text-orange-200 block mb-2"></i>Belum ada resep.<br><button class="btn btn-primary mt-3" data-action="new-recipe"><i class="fa-solid fa-plus"></i> Buat resep pertama</button>'}</div>`;
        return;
    }

    $('recipeBody').innerHTML = list.map(r => {
        const { rows, cost, maxBatch, limiter } = recipeInfo(r);
        const menus = S.products.filter(p => same(p.resep_id, r.id));
        const head = rows.slice(0, RECIPE_PREVIEW), rest = rows.slice(RECIPE_PREVIEW);

        const batchTone = maxBatch >= 1 ? 'text-emerald-600' : maxBatch > 0 ? 'text-amber-600' : 'text-rose-600';
        const limitTxt = limiter?.ing && rows.length > 1 ? `Dibatasi ${esc(limiter.ing.name)}` : '&nbsp;';

        const menuChips = menus.length
            ? menus.map(p => {
                const st = pStock(p);
                const tone = st <= 0 ? 'border-rose-200 text-rose-700 bg-rose-50' : st <= LOW_STOCK ? 'border-amber-200 text-amber-700 bg-amber-50' : 'border-slate-200 text-slate-700 bg-white';
                return `<button type="button" class="badge border ${tone} hover:border-orange-300" data-action="calc-product" data-id="${esc(p.id)}" title="Hitung produksi ${esc(pName(p))}">
                    ${esc(pName(p))} <span class="ml-1 opacity-60">${st}</span></button>`;
            }).join('')
            : '<button type="button" class="text-[11px] text-slate-400 italic hover:text-orange-600" data-tab="mapping">Belum dipakai menu. Hubungkan <i class="fa-solid fa-arrow-right text-[9px]"></i></button>';

        return `<article class="card recipe-card p-4 flex flex-col gap-3">
            <header class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                    <h3 class="font-bold text-sm text-slate-800 leading-snug">${esc(recName(r))}</h3>
                    <p class="text-[11px] text-slate-400">${rows.length} bahan · ${menus.length} menu</p>
                </div>
                <div class="acts flex gap-1 shrink-0">
                    <button class="btn btn-sm bg-orange-50 text-orange-600 hover:bg-orange-100" data-action="edit-recipe" data-id="${esc(r.id)}" title="Edit resep" aria-label="Edit resep ${esc(recName(r))}"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn btn-sm bg-rose-50 text-rose-600 hover:bg-rose-100" data-action="delete-recipe" data-id="${esc(r.id)}" title="Hapus resep" aria-label="Hapus resep ${esc(recName(r))}"><i class="fa-solid fa-trash"></i></button>
                </div>
            </header>

            <div class="grid grid-cols-2 gap-2">
                <div class="rounded-xl bg-slate-50 px-3 py-2">
                    <p class="text-[10px] font-semibold text-slate-400">Biaya / batch</p>
                    <p class="text-sm font-bold text-slate-800">${cost ? rp(cost) : '<span class="text-slate-400 font-medium text-xs">Harga belum diisi</span>'}</p>
                </div>
                <div class="rounded-xl bg-slate-50 px-3 py-2 min-w-0">
                    <p class="text-[10px] font-semibold text-slate-400">Stok cukup untuk</p>
                    <p class="text-sm font-bold ${batchTone}">${num(maxBatch)} batch</p>
                    <p class="text-[10px] text-slate-400 truncate">${limitTxt}</p>
                </div>
            </div>

            <div>
                <p class="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Komposisi per batch</p>
                ${rows.length ? `<ul class="divide-y divide-slate-50">${head.map(x => compRow(x, cost)).join('')}</ul>
                ${rest.length ? `<details${q ? ' open' : ''}>
                    <summary class="text-[11px] font-semibold text-orange-600 hover:text-orange-700 pt-1">
                        <span class="more-label">+ ${rest.length} bahan lainnya</span><span class="less-label">Sembunyikan</span>
                    </summary>
                    <ul class="divide-y divide-slate-50">${rest.map(x => compRow(x, cost)).join('')}</ul>
                </details>` : ''}` : '<p class="text-xs text-slate-400 py-2">Tidak ada bahan</p>'}
            </div>

            <footer class="pt-3 border-t border-slate-100 mt-auto">
                <p class="text-[10px] font-semibold text-slate-400 mb-1.5">Dipakai oleh menu <span class="font-normal">(angka = stok jual)</span></p>
                <div class="flex flex-wrap gap-1.5">${menuChips}</div>
            </footer>
        </article>`;
    }).join('');
}

function recipeRow(ingId = '', amount = '') {
    const opts = S.ingredients.map(i =>
        `<option value="${esc(i.id)}"${same(i.id, ingId) ? ' selected' : ''}>${esc(i.name)}</option>`).join('');
    return `<div class="recipe-row flex items-center gap-2">
        <select class="field flex-1 min-w-0" aria-label="Bahan"><option value="">-- Pilih bahan --</option>${opts}</select>
        <input type="number" min="0" step="any" inputmode="decimal" placeholder="Jumlah" value="${esc(amount)}" class="field amt" aria-label="Jumlah">
        <span class="unit w-10 text-[11px] text-slate-400 shrink-0">${esc(ingById(ingId)?.unit)}</span>
        <button type="button" class="text-rose-500 hover:text-rose-700 p-1.5" data-action="del-row" title="Hapus baris" aria-label="Hapus baris"><i class="fa-solid fa-xmark"></i></button>
    </div>`;
}

function addRecipeRow(ingId, amount) {
    $('recipeRows').insertAdjacentHTML('beforeend', recipeRow(ingId, amount));
    const row = $('recipeRows').lastElementChild;
    spEnhance(row.querySelector('select'), { placeholder: 'Cari bahan...', empty: 'Bahan tidak ditemukan' });
    return row;
}

function readRecipeRows() {
    return [...$('recipeRows').querySelectorAll('.recipe-row')].map(row => ({
        ingredientId: row.querySelector('select').value,
        amount: parseFloat(row.querySelector('input').value)
    }));
}

function updateRecipeCost() {
    const items = readRecipeRows().filter(it => it.ingredientId && it.amount > 0);
    $('recipeCost').textContent = rp(recipeCost(items));
}

function openRecipe(id) {
    if (!S.ingredients.length) {
        toast('Tambahkan bahan baku dulu sebelum membuat resep.', 'warn');
        return showTab('ingredients');
    }
    const r = id ? recById(id) : null;
    $('recipeId').value = r?.id ?? '';
    $('recipeName').value = r ? recName(r) : '';
    $('recipeTitle').textContent = r ? 'Edit master resep' : 'Buat master resep';
    $('recipeRows').innerHTML = '';
    (r?.items?.length ? r.items : [{}]).forEach(it => addRecipeRow(it.ingredientId, it.amount));
    updateRecipeCost();
    openModal('recipeModal');
    $('recipeName').focus();
}

async function saveRecipe(e) {
    e.preventDefault();
    const name = $('recipeName').value.trim();
    const items = readRecipeRows().filter(it => it.ingredientId && it.amount > 0); // baris kosong diabaikan
    const duplicate = new Set(items.map(it => it.ingredientId)).size !== items.length;

    if (!name) return toast('Nama resep wajib diisi.', 'warn');
    if (!items.length) return toast('Resep minimal punya 1 bahan dengan jumlah lebih dari 0.', 'warn');
    if (duplicate) return toast('Ada bahan yang dipilih lebih dari sekali.', 'warn');

    const editing = $('recipeId').value;
    await busy(e.submitter, async () => {
        const { error } = await db.from('recipes').upsert([{ id: editing || 'rec_' + Date.now(), name, description: name, items }]);
        if (error) return toast(msg(error), 'error');
        closeModal('recipeModal');
        await loadData();
        toast(editing ? 'Resep diperbarui.' : 'Resep dibuat.');
    });
}

async function deleteRecipe(id) {
    const r = recById(id);
    if (!r) return;
    const linked = S.products.filter(p => same(p.resep_id, id)).length;
    const ok = await confirmBox({
        title: 'Hapus resep?',
        message: `"${recName(r)}" akan dihapus.` + (linked ? `\n${linked} menu yang memakai resep ini akan dilepas.` : ''),
        okText: 'Hapus', danger: true
    });
    if (!ok) return;

    const unlink = await db.from('products').update({ resep_id: null }).eq('resep_id', id);
    if (unlink.error) return toast(msg(unlink.error), 'error');
    const { error } = await db.from('recipes').delete().eq('id', id);
    if (error) return toast(msg(error), 'error');

    await loadData();
    toast('Resep dihapus.');
}

// =========================================================
// TAB 2: MENU & RESEP
// =========================================================
function renderMapping() {
    const q = $('mappingSearch').value.toLowerCase().trim();
    let list = S.products.filter(p => pName(p).toLowerCase().includes(q));
    if ($('onlyUnmapped').checked) list = list.filter(p => !isMapped(p));

    $('mappingBody').innerHTML = list.length ? list.map(p => {
        const opts = S.recipes.map(r =>
            `<option value="${esc(r.id)}"${same(r.id, p.resep_id) ? ' selected' : ''}>${esc(recName(r))}</option>`).join('');
        return `<tr>
            <td><img src="${esc(pPhoto(p))}" alt="" loading="lazy" class="w-10 h-10 rounded-lg object-cover" onerror="this.onerror=null;this.src='${PLACEHOLDER}'"></td>
            <td>
                <div class="font-semibold text-slate-800">${esc(pName(p))}</div>
                ${p.isi ? `<div class="text-[11px] text-slate-400">Isi: ${esc(p.isi)}</div>` : ''}
            </td>
            <td>${stockBadge(pStock(p))}</td>
            <td><select class="field ${isMapped(p) ? '' : 'border-rose-200'}" data-map="${esc(p.id)}" aria-label="Resep untuk ${esc(pName(p))}"><option value="">-- Belum dipilih --</option>${opts}</select></td>
        </tr>`;
    }).join('') : emptyRow(4, S.products.length ? 'Tidak ada menu yang cocok.' : 'Belum ada menu di tabel products.');
}

async function onMappingChange(e) {
    const sel = e.target.closest('select[data-map]');
    if (!sel) return;
    const p = S.products.find(x => same(x.id, sel.dataset.map));
    if (!p) return;

    const prev = p.resep_id ?? '';
    const next = sel.value || null;
    sel.disabled = true;
    const { data, error } = await db.from('products').update({ resep_id: next }).eq('id', p.id).select('id');
    sel.disabled = false;

    if (error || !data?.length) { // gagal: kembalikan pilihan lama
        sel.value = String(prev);
        return toast(msg(error, 'Tidak ada baris yang berubah. Periksa RLS policy tabel products.'), 'error');
    }

    p.resep_id = next;
    sel.classList.toggle('border-rose-200', !next);
    renderStats();
    renderRecipes();
    renderCalcOptions(); // label "belum ada resep" di dropdown kalkulator ikut diperbarui
    toast(next ? `${pName(p)} memakai resep "${recName(recById(next))}".` : `Resep dilepas dari ${pName(p)}.`);
}

// =========================================================
// TAB 3: KALKULATOR RESTOK
// =========================================================
function calcContext() {
    const prod = S.products.find(p => same(p.id, $('calcProduct').value));
    const batch = parseFloat($('calcBatch').value) || 0;
    const recipe = prod?.resep_id ? recById(prod.resep_id) : null;

    // Gabungkan bahan ganda (jika ada) agar perhitungan & pengurangan stok akurat
    const merged = new Map();
    (recipe?.items ?? []).forEach(it => merged.set(String(it.ingredientId), (merged.get(String(it.ingredientId)) || 0) + (Number(it.amount) || 0)));

    const lines = [...merged].map(([id, per]) => {
        const ing = ingById(id);
        const need = round2(per * batch);
        const stock = Number(ing?.stock) || 0;
        return {
            ing, per, need, stock,
            name: ing?.name ?? 'Bahan terhapus',
            unit: ing?.unit ?? '',
            price: Number(ing?.price) || 0,
            short: ing ? round2(Math.max(0, need - stock)) : 0
        };
    });

    // Batch maksimal yang bisa dibuat dari stok sekarang (dibulatkan ke bawah 0,1)
    const usable = lines.filter(l => l.per > 0);
    const maxBatch = usable.length && usable.every(l => l.ing)
        ? Math.floor(Math.min(...usable.map(l => l.stock / l.per)) * 10) / 10
        : 0;

    return { prod, batch, recipe, lines, maxBatch };
}

function renderCalcOptions() {
    const sel = $('calcProduct'), current = sel.value;
    sel.innerHTML = '<option value="">-- Pilih menu --</option>' + S.products.map(p =>
        `<option value="${esc(p.id)}" data-s="${esc(pName(p))}">${esc(pName(p))} (stok ${pStock(p)})${isMapped(p) ? '' : ' - belum ada resep'}</option>`).join('');
    sel.value = current;
    spEnhance(sel, { placeholder: 'Cari menu...', empty: 'Menu tidak ditemukan' }); // sekaligus spSync
    renderCalc();
}

function selectCalcProduct(id) {
    const sel = $('calcProduct');
    sel.value = id;
    spSync(sel);
    renderCalc();
    showTab('calculator');
}

function renderCalc() {
    const { prod, batch, recipe, lines, maxBatch } = calcContext();
    const body = $('calcBody'), label = $('calcLabel');
    const ready = !!(prod && recipe && batch > 0 && lines.length);

    $('btnProduce').disabled = !ready;
    $('btnOrder').disabled = !ready;
    $('calcSummary').innerHTML = '';

    if (!prod) {
        label.textContent = 'Menunggu pilihan menu...';
        body.innerHTML = emptyRow(4, 'Pilih menu dan tentukan jumlah batch di atas.');
        return;
    }
    if (!recipe) {
        label.textContent = 'Resep belum diatur';
        body.innerHTML = emptyRow(4, 'Menu ini belum punya resep. <button class="font-semibold text-orange-600 underline" data-tab="mapping">Atur di tab Menu &amp; Resep</button>');
        return;
    }
    if (!(batch > 0)) {
        label.textContent = 'Jumlah batch belum valid';
        body.innerHTML = emptyRow(4, 'Isi jumlah batch lebih dari 0.');
        return;
    }

    const output = prod.qty ? ` (sekitar ${num(batch * prod.qty)} ${prod.unit || 'pcs'})` : '';
    label.textContent = `Target: ${num(batch)} batch${output}`;

    const lacking = lines.filter(l => l.short > 0);
    const shopCost = lacking.reduce((s, l) => s + l.short * l.price, 0);
    const prodCost = lines.reduce((s, l) => s + l.need * l.price, 0);

    $('calcSummary').innerHTML = [
        lacking.length
            ? `<span class="badge b-bad">${lacking.length} bahan kurang</span><span class="badge b-warn">Estimasi belanja ${rp(shopCost)}</span>`
            : '<span class="badge b-ok">Semua stok aman</span>',
        maxBatch >= 0.1
            ? `<button type="button" class="badge bg-white border border-slate-200 text-slate-600 hover:border-orange-300" data-action="set-max" title="Pakai jumlah ini">Stok cukup untuk maks ${num(maxBatch)} batch</button>`
            : '<span class="badge bg-white border border-slate-200 text-slate-500">Stok belum cukup untuk 0,1 batch</span>',
        prodCost ? `<span class="badge bg-white border border-slate-200 text-slate-600">Biaya bahan ${rp(prodCost)}</span>` : ''
    ].join('');

    body.innerHTML = lines.map(l => `<tr class="${l.short > 0 || !l.ing ? 'bg-rose-50/40' : ''}">
        <td class="font-medium text-slate-800">${esc(l.name)}</td>
        <td class="font-bold text-orange-600">${num(l.need)} <span class="font-normal text-slate-400">${esc(l.unit)}</span></td>
        <td>${num(l.stock)} <span class="text-slate-400">${esc(l.unit)}</span></td>
        <td>${!l.ing ? '<span class="badge b-warn">Bahan terhapus</span>'
            : l.short > 0 ? `<span class="badge b-bad">Kurang ${num(l.short)} ${esc(l.unit)}</span>`
            : '<span class="badge b-ok">Aman</span>'}</td>
    </tr>`).join('');
}

function setBatch(v) {
    $('calcBatch').value = round2(v);
    renderCalc();
}

async function produce(btn) {
    const { prod, batch, lines } = calcContext();
    const usable = lines.filter(l => l.ing);
    const lacking = usable.filter(l => l.short > 0).map(l => l.name);

    const ok = await confirmBox({
        title: 'Proses produksi?',
        message: `Produksi ${num(batch)} batch ${pName(prod)}.\nStok ${usable.length} bahan baku akan dikurangi.` +
            (lacking.length ? `\n\nStok tidak cukup untuk: ${lacking.join(', ')}. Stok bahan tersebut menjadi 0.` : ''),
        okText: 'Proses & kurangi stok', danger: lacking.length > 0
    });
    if (!ok) return;

    await busy(btn, async () => {
        const res = await Promise.all(usable.map(l =>
            db.from('ingredients').update({ stock: round2(Math.max(0, l.stock - l.need)) }).eq('id', l.ing.id).select('id')));
        const failed = res.filter(r => r.error || !r.data?.length);
        await loadData();
        failed.length
            ? toast(`${failed.length} bahan gagal diperbarui. ${msg(failed[0].error, 'Periksa RLS policy tabel ingredients.')}`, 'error')
            : toast('Stok bahan baku berhasil dikurangi.');
    });
}

// =========================================================
// SEARCHABLE PICKER (enhancement di atas <select> biasa)
// Dipakai untuk: pilih menu, pilih bahan di resep, pilih supplier.
// =========================================================
const SP = { panel: null, input: null, list: null, sel: null, items: [], idx: -1 };

function spInit() {
    if (SP.panel) return;
    const p = document.createElement('div');
    p.className = 'hidden fixed bg-white border border-slate-200 rounded-xl shadow-xl p-2';
    p.style.zIndex = 9999;
    p.innerHTML = `
        <input type="text" class="field w-full mb-2" placeholder="Cari..." autocomplete="off">
        <div class="max-h-52 overflow-y-auto" role="listbox"></div>`;
    document.body.appendChild(p);
    SP.panel = p; SP.input = p.firstElementChild; SP.list = p.lastElementChild;

    SP.input.addEventListener('input', () => spRender(SP.input.value));
    SP.input.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!SP.items.length) return;
            SP.idx = (SP.idx + (e.key === 'ArrowDown' ? 1 : -1) + SP.items.length) % SP.items.length;
            spHighlight();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (SP.items[SP.idx]) spPick(SP.items[SP.idx].value);
        } else if (e.key === 'Escape') {
            e.preventDefault(); e.stopPropagation(); spClose(true);
        } else if (e.key === 'Tab') {
            spClose();
        }
    });
    SP.list.addEventListener('click', e => {
        const el = e.target.closest('[data-v]');
        if (el) spPick(el.dataset.v);
    });
    SP.list.addEventListener('mousemove', e => {
        const el = e.target.closest('.sp-item');
        if (el && +el.dataset.i !== SP.idx) { SP.idx = +el.dataset.i; spHighlight(); }
    });

    // tutup saat klik di luar; reposisi saat scroll/resize (keyboard HP bisa memicu resize)
    document.addEventListener('mousedown', e => {
        if (SP.sel && !SP.panel.contains(e.target) && !SP.sel._sp.btn.contains(e.target)) spClose();
    });
    window.addEventListener('resize', spPosition);
    window.addEventListener('scroll', e => { if (SP.sel && !SP.panel.contains(e.target)) spPosition(); }, true);
}

function spEnhance(sel, opts = {}) {
    if (!sel._sp) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `${sel.className} flex items-center justify-between gap-2 text-left`;
        btn.setAttribute('aria-haspopup', 'listbox');
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-label', sel.getAttribute('aria-label') || 'Pilih');
        btn.innerHTML = `<span class="truncate"></span>
            <svg class="w-3.5 h-3.5 shrink-0 text-slate-400" viewBox="0 0 20 20" fill="currentColor"><path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4z"/></svg>`;
        btn.addEventListener('click', () => (SP.sel === sel ? spClose() : spOpen(sel)));
        sel.before(btn);
        sel.style.display = 'none';
        sel.tabIndex = -1;
        sel._sp = {
            btn, label: btn.firstElementChild,
            ph: opts.placeholder || 'Cari...',
            empty: opts.empty || 'Tidak ditemukan'
        };

        // klik <label for="..."> ikut membuka picker
        if (sel.id) {
            const lbl = document.querySelector(`label[for="${sel.id}"]`);
            lbl?.addEventListener('click', e => { e.preventDefault(); spOpen(sel); });
        }
    }
    spSync(sel);
}

// panggil setiap kali select diubah lewat kode (sel.value = ..., sel.disabled = ...)
function spSync(sel) {
    if (!sel?._sp) return;
    const { btn, label } = sel._sp;
    const o = sel.options[sel.selectedIndex];
    label.textContent = o ? o.textContent : '';
    label.classList.toggle('text-slate-400', !sel.value);
    btn.disabled = sel.disabled;
    btn.classList.toggle('opacity-50', sel.disabled);
}

function spOpen(sel) {
    if (sel.disabled) return;
    spInit();
    if (SP.sel) spClose();
    SP.sel = sel;
    SP.input.placeholder = sel._sp.ph;
    SP.input.setAttribute('aria-label', sel._sp.ph);
    SP.panel.classList.remove('hidden');
    SP.input.value = '';
    spRender('');
    spPosition();
    sel._sp.btn.setAttribute('aria-expanded', 'true');
    SP.input.focus();
}

function spClose(refocus) {
    if (!SP.sel) return;
    const btn = SP.sel._sp.btn;
    SP.panel.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
    SP.sel = null;
    if (refocus) btn.focus();
}

function spPick(v) {
    const sel = SP.sel;
    if (!sel) return;
    sel.value = v;
    spSync(sel);
    spClose(true);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
}

function spRender(q = '') {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const cur = SP.sel.value;
    SP.items = [...SP.sel.options]
        .map(o => ({
            value: o.value,
            label: o.textContent,
            key: (o.dataset.s || o.textContent).toLowerCase()   // data-s = teks khusus untuk dicari
        }))
        .filter(o => o.value === '' ? !words.length : words.every(w => o.key.includes(w)));
    SP.idx = words.length ? 0 : Math.max(0, SP.items.findIndex(o => o.value === cur));

    SP.list.innerHTML = SP.items.length
        ? SP.items.map((o, i) => `
            <div role="option" class="sp-item px-2.5 py-2 rounded-lg text-xs cursor-pointer ${o.value === '' ? 'text-slate-400 italic' : 'text-slate-700'} ${o.value === cur ? 'font-semibold' : ''}"
                 data-v="${esc(o.value)}" data-i="${i}" aria-selected="${o.value === cur}">${esc(o.label)}</div>`).join('')
        : `<div class="px-2.5 py-3 text-xs text-slate-400 text-center">${esc(SP.sel._sp.empty)}</div>`;
    spHighlight();
}

function spHighlight() {
    SP.list.querySelectorAll('.sp-item').forEach((el, i) => {
        const on = i === SP.idx;
        el.classList.toggle('bg-orange-50', on);
        if (on) el.scrollIntoView({ block: 'nearest' });
    });
}

function spPosition() {
    if (!SP.sel) return;
    const r = SP.sel._sp.btn.getBoundingClientRect();
    const w = Math.max(r.width, 240);
    const p = SP.panel.style;
    p.width = w + 'px';
    p.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
    const spaceBelow = innerHeight - r.bottom;
    if (spaceBelow < 280 && r.top > spaceBelow) {   // buka ke atas kalau di bawah tidak muat
        p.top = 'auto';
        p.bottom = (innerHeight - r.top + 4) + 'px';
    } else {
        p.bottom = 'auto';
        p.top = (r.bottom + 4) + 'px';
    }
}

// =========================================================
// ORDER (PO) KE SUPPLIER
// =========================================================
const orderSel = i => $('orderRows').querySelector(`select[data-sup="${i}"]`);
const orderCb = i => $('orderRows').querySelector(`input[type=checkbox][data-i="${i}"]`);

function openOrder() {
    orderDraft = calcContext().lines.filter(l => l.ing && l.short > 0);
    if (!orderDraft.length) return toast('Semua stok aman, tidak ada bahan yang perlu di-order.', 'info');

    const hasSup = S.suppliers.length > 0;
    const supOpts = S.suppliers.map(s => `<option value="${esc(s.id)}">${esc(supName(s))}</option>`).join('');
    $('orderBulkWrap').classList.toggle('hidden', !hasSup);
    $('orderNoSup').classList.toggle('hidden', hasSup);
    $('orderBulk').innerHTML = '<option value="">Atur supplier untuk semua bahan...</option>' + supOpts;
    $('orderNotes').value = '';
    $('orderRows').innerHTML = orderDraft.map((l, i) => `
        <div class="order-row flex items-center gap-3 p-2.5 rounded-xl border border-slate-200 bg-white transition">
            <input type="checkbox" data-i="${i}" checked class="w-4 h-4 accent-orange-500 shrink-0" aria-label="Order ${esc(l.name)}">
            <div class="flex-1 min-w-0">
                <div class="text-xs font-semibold text-slate-800 truncate">${esc(l.name)}</div>
                <div class="order-info text-[11px] text-slate-500">Kurang ${num(l.short)} ${esc(l.unit)}${l.price ? `, ${rp(l.short * l.price)}` : ''}</div>
            </div>
            ${hasSup ? `<select data-sup="${i}" class="field sup" aria-label="Supplier untuk ${esc(l.name)}"><option value="">Belum ditentukan</option>${supOpts}</select>` : ''}
        </div>`).join('');

    if (hasSup) {
        spEnhance($('orderBulk'), { placeholder: 'Cari supplier...', empty: 'Supplier tidak ditemukan' });
        $('orderRows').querySelectorAll('select[data-sup]').forEach(s =>
            spEnhance(s, { placeholder: 'Cari supplier...', empty: 'Supplier tidak ditemukan' }));
    }

    updateOrderTotal();
    openModal('orderModal');
}

function pickedOrder() {
    return [...$('orderRows').querySelectorAll('input[type=checkbox]:checked')].map(cb => ({
        i: cb.dataset.i,
        line: orderDraft[cb.dataset.i],
        supplierId: orderSel(cb.dataset.i)?.value || null
    }));
}

function updateOrderTotal() {
    const picked = pickedOrder();
    $('orderTotal').textContent = rp(picked.reduce((s, x) => s + x.line.short * x.line.price, 0));
    $('orderSubmit').disabled = !picked.length;
}

function onOrderRowChange(e) {
    if (e.target.type === 'checkbox') {
        const sel = orderSel(e.target.dataset.i);
        if (sel) { sel.disabled = !e.target.checked; spSync(sel); }
        e.target.closest('.order-row').classList.toggle('opacity-50', !e.target.checked);
    }
    updateOrderTotal();
}

// Bulk: terapkan ke semua baris yang aktif, lalu kembalikan ke placeholder
function onBulkSupplier(e) {
    const v = e.target.value;
    if (!v) return;
    $('orderRows').querySelectorAll('select[data-sup]:not(:disabled)').forEach(s => { s.value = v; spSync(s); });
    e.target.value = '';
    spSync(e.target);
}

// Tandai baris yang PO-nya sudah tersimpan agar tidak terkirim dua kali saat dicoba ulang
function markOrderDone(i) {
    const cb = orderCb(i), sel = orderSel(i);
    cb.checked = false;
    cb.disabled = true;
    if (sel) { sel.disabled = true; spSync(sel); }
    const row = cb.closest('.order-row');
    row.classList.add('opacity-50');
    row.querySelector('.order-info').insertAdjacentHTML('beforeend', ' <span class="text-emerald-600 font-semibold">- PO dibuat</span>');
}

async function createPO(supplierId, lines, notes) {
    const total = round2(lines.reduce((s, l) => s + l.short * l.price, 0));
    const poNotes = supplierId ? notes : [notes, 'Supplier belum ditentukan'].filter(Boolean).join(' - ');

    const { data: po, error } = await db.from('purchase_orders')
        .insert([{ supplier_id: supplierId, status: 'pending', total_amount: total, notes: poNotes || null }])
        .select().single();
    if (error) throw error;

    const { error: itemsError } = await db.from('purchase_order_items').insert(lines.map(l => ({
        order_id: po.id,
        ingredient_id: l.ing.id,
        ingredient_name: l.name,
        quantity: l.short,
        unit: l.unit,
        unit_price: l.price,
        subtotal: round2(l.short * l.price)
    })));
    if (itemsError) { // batalkan PO agar tidak ada PO kosong
        await db.from('purchase_orders').delete().eq('id', po.id);
        throw itemsError;
    }
    return total;
}

async function submitOrder(e) {
    e.preventDefault();
    const picked = pickedOrder();
    if (!picked.length) return toast('Pilih minimal satu bahan.', 'warn');

    const groups = new Map(); // supplierId ('' = belum ditentukan) -> [{ i, line }]
    picked.forEach(x => {
        const key = x.supplierId ?? '';
        groups.set(key, [...(groups.get(key) ?? []), x]);
    });
    const notes = $('orderNotes').value.trim();

    await busy(e.submitter, async () => {
        const summary = [];
        for (const [key, rows] of groups) {
            try {
                const total = await createPO(key || null, rows.map(r => r.line), notes);
                rows.forEach(r => markOrderDone(r.i));
                const who = key ? supName(S.suppliers.find(s => same(s.id, key)) ?? {}) : 'Belum ditentukan';
                summary.push(`${who}: ${rows.length} bahan, ${rp(total)}`);
            } catch (err) {
                console.error('Gagal membuat PO:', err);
                updateOrderTotal();
                return toast(`Gagal membuat PO. ${msg(err)}` + (summary.length ? `\n${summary.length} PO sebelumnya sudah tersimpan (ditandai di daftar).` : ''), 'error');
            }
        }
        closeModal('orderModal');
        toast(`${summary.length} PO berhasil dibuat.\n${summary.join('\n')}`);
    });
}

// =========================================================
// TAB 4: BAHAN BAKU
// =========================================================
function renderIngredients() {
    const q = $('ingSearch').value.toLowerCase().trim();
    const list = S.ingredients.filter(i => String(i.name ?? '').toLowerCase().includes(q));
    $('ingCount').textContent = `${list.length} bahan`;

    $('ingBody').innerHTML = list.length ? list.map(i => {
        const used = usageCount(i.id);
        const empty = !(Number(i.stock) > 0);
        return `<tr>
            <td>
                <div class="font-medium text-slate-800">${esc(i.name)}</div>
                <div class="text-[11px] text-slate-400">${used ? `Dipakai di ${used} resep` : 'Belum dipakai resep'}</div>
            </td>
            <td class="font-semibold ${empty ? 'text-rose-600' : ''}">${num(i.stock)}</td>
            <td class="text-slate-500">${esc(i.unit)}</td>
            <td>${rp(i.price)}</td>
            <td class="text-right whitespace-nowrap">
                <button class="btn btn-sm bg-orange-50 text-orange-600 hover:bg-orange-100" data-action="edit-ing" data-id="${esc(i.id)}" title="Edit bahan" aria-label="Edit bahan"><i class="fa-solid fa-pen"></i></button>
                <button class="btn btn-sm bg-rose-50 text-rose-600 hover:bg-rose-100" data-action="delete-ing" data-id="${esc(i.id)}" title="Hapus bahan" aria-label="Hapus bahan"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>`;
    }).join('') : emptyRow(5, S.ingredients.length ? 'Tidak ada bahan yang cocok.' : 'Belum ada bahan baku. Tambahkan lewat formulir di samping.');
}

function editIngredient(id) {
    const i = ingById(id);
    if (!i) return;
    const unit = $('ingUnit');
    if (i.unit && ![...unit.options].some(o => o.value === i.unit)) unit.add(new Option(i.unit, i.unit)); // satuan lama di luar daftar
    $('ingId').value = i.id;
    $('ingName').value = i.name ?? '';
    $('ingStock').value = i.stock ?? 0;
    unit.value = i.unit;
    $('ingPrice').value = i.price || '';
    $('ingTitle').textContent = 'Edit bahan baku';
    $('ingCancel').classList.remove('hidden');
    $('ingForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('ingName').focus();
}

function resetIngredientForm() {
    $('ingForm').reset();
    $('ingId').value = '';
    $('ingTitle').textContent = 'Tambah bahan baku';
    $('ingCancel').classList.add('hidden');
}

async function saveIngredient(e) {
    e.preventDefault();
    const id = $('ingId').value;
    const name = $('ingName').value.trim();
    const stock = parseFloat($('ingStock').value);
    const price = parseFloat($('ingPrice').value) || 0;

    if (!name) return toast('Nama bahan wajib diisi.', 'warn');
    if (!(stock >= 0)) return toast('Stok harus berupa angka 0 atau lebih.', 'warn');
    if (S.ingredients.some(i => !same(i.id, id) && String(i.name).trim().toLowerCase() === name.toLowerCase())) {
        return toast(`Bahan "${name}" sudah ada.`, 'warn');
    }

    await busy(e.submitter, async () => {
        const { error } = await db.from('ingredients').upsert([{ id: id || 'ing_' + Date.now(), name, stock, unit: $('ingUnit').value, price }]);
        if (error) return toast(msg(error), 'error');
        resetIngredientForm();
        await loadData();
        toast(id ? 'Bahan diperbarui.' : 'Bahan ditambahkan.');
    });
}

async function deleteIngredient(id) {
    const i = ingById(id);
    if (!i) return;
    const used = usageCount(id);
    const ok = await confirmBox({
        title: 'Hapus bahan baku?',
        message: `"${i.name}" akan dihapus.` + (used ? `\nBahan ini dipakai di ${used} resep dan akan tampil sebagai "Bahan terhapus" di sana.` : ''),
        okText: 'Hapus', danger: true
    });
    if (!ok) return;

    const { error } = await db.from('ingredients').delete().eq('id', id);
    if (error) return toast(msg(error), 'error');
    if (same($('ingId').value, id)) resetIngredientForm();
    await loadData();
    toast('Bahan baku dihapus.');
}

// =========================================================
// EVENT
// =========================================================
const ACTIONS = {
    reload: b => busy(b, loadData),
    'new-recipe': () => openRecipe(),
    'edit-recipe': b => openRecipe(b.dataset.id),
    'delete-recipe': b => deleteRecipe(b.dataset.id),
    'add-row': () => addRecipeRow().querySelector('button').focus(),
    'del-row': b => {
        b.closest('.recipe-row').remove();
        if (!$('recipeRows').children.length) addRecipeRow();
        updateRecipeCost();
    },
    'edit-ing': b => editIngredient(b.dataset.id),
    'delete-ing': b => deleteIngredient(b.dataset.id),
    'reset-ing': () => resetIngredientForm(),
    'show-unmapped': () => { $('onlyUnmapped').checked = true; renderMapping(); showTab('mapping'); },
    'calc-product': b => selectCalcProduct(b.dataset.id),
    batch: b => setBatch(Math.max(0.5, (parseFloat($('calcBatch').value) || 0) + Number(b.dataset.step))),
    'set-max': () => setBatch(calcContext().maxBatch),
    produce,
    order: () => openOrder()
};

// Klik backdrop menutup modal (hanya jika tekan & lepas mouse sama-sama di backdrop)
let downTarget = null;
document.addEventListener('mousedown', e => { downTarget = e.target; });

document.addEventListener('click', e => {
    if (e.target.classList?.contains('modal') && downTarget === e.target) {
        return e.target.querySelector('[data-close]')?.click();
    }
    const close = e.target.closest('[data-close]');
    if (close) return closeModal(close.closest('.modal').id);
    const tab = e.target.closest('[data-tab]');
    if (tab) return showTab(tab.dataset.tab);
    const btn = e.target.closest('[data-action]');
    if (btn) ACTIONS[btn.dataset.action]?.(btn);
});

// Esc menutup modal paling atas
document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    [...document.querySelectorAll('.modal:not(.hidden)')].pop()?.querySelector('[data-close]')?.click();
});

$('recipeSearch').addEventListener('input', renderRecipes);
$('mappingSearch').addEventListener('input', renderMapping);
$('onlyUnmapped').addEventListener('change', renderMapping);
$('ingSearch').addEventListener('input', renderIngredients);
$('calcProduct').addEventListener('change', renderCalc);
$('calcBatch').addEventListener('input', renderCalc);
$('mappingBody').addEventListener('change', onMappingChange);
$('recipeRows').addEventListener('input', updateRecipeCost);
$('recipeRows').addEventListener('change', e => {
    if (e.target.matches('select')) e.target.closest('.recipe-row').querySelector('.unit').textContent = ingById(e.target.value)?.unit ?? '';
    updateRecipeCost();
});
$('orderRows').addEventListener('change', onOrderRowChange);
$('orderBulk').addEventListener('change', onBulkSupplier);
$('recipeForm').addEventListener('submit', saveRecipe);
$('ingForm').addEventListener('submit', saveIngredient);
$('orderForm').addEventListener('submit', submitOrder);

// =========================================================
// INIT
// =========================================================
(async function init() {
    $('ingUnit').innerHTML = UNITS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    showTab(location.hash.slice(1));
    try {
        await authReady;
        await loadData();
    } catch (err) {
        console.error('INIT ERROR:', err);
        $('loadError').classList.remove('hidden');
        $('loadErrorMsg').textContent = msg(err);
    }
})();
