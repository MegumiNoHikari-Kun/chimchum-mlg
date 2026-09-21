import { supabase as db, authReady } from '../supabase.js';

// =========================================================
// STATE
// =========================================================
const S = { ingredients: [], products: [], recipes: [] };

// =========================================================
// HELPER (pola sama seperti master_resep.js)
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
const pPrice = p => Number(p.harga ?? p.price) || 0;
const ingById = id => S.ingredients.find(i => same(i.id, id));
const recById = id => S.recipes.find(r => same(r.id, id));
const isMapped = p => !!p.resep_id && !!recById(p.resep_id);
const sortBy = (arr, fn) => arr.sort((a, b) => String(fn(a)).localeCompare(String(fn(b)), 'id'));

// =========================================================
// TOAST
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

// =========================================================
// LOAD DATA
// =========================================================
async function loadData() {
    const names = ['ingredients', 'products', 'recipes'];
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

    sortBy(S.products, pName);

    $('loadError').classList.toggle('hidden', !failed.length);
    if (failed.length) $('loadErrorMsg').textContent = `Gagal memuat: ${failed.join(', ')}. Periksa koneksi atau RLS policy.`;

    renderProductOptions();
}

// =========================================================
// PILIHAN MENU
// =========================================================
function renderProductOptions() {
    const sel = $('hppProduct');
    const current = sel.value;
    sel.innerHTML = '<option value="">-- Pilih menu --</option>' + S.products.map(p =>
        `<option value="${esc(p.id)}">${esc(pName(p))}${isMapped(p) ? '' : ' - belum ada resep'}</option>`
    ).join('');
    sel.value = current;
    renderCalc();
}

// =========================================================
// KALKULATOR HPP
// =========================================================
function calcContext() {
    const prod = S.products.find(p => same(p.id, $('hppProduct').value));
    const recipe = prod?.resep_id ? recById(prod.resep_id) : null;

    // Gabungkan bahan yang sama agar tidak dobel dihitung
    const merged = new Map();
    (recipe?.items ?? []).forEach(it =>
        merged.set(String(it.ingredientId), (merged.get(String(it.ingredientId)) || 0) + (Number(it.amount) || 0))
    );

    const lines = [...merged].map(([id, amount]) => {
        const ing = ingById(id);
        const price = Number(ing?.price) || 0;
        const subtotal = round2(amount * price);
        return {
            ing,
            name: ing?.name ?? 'Bahan terhapus',
            unit: ing?.unit ?? '',
            amount: round2(amount),
            price,
            subtotal
        };
    });

    return { prod, recipe, lines };
}

function renderCalc() {
    const { prod, recipe, lines } = calcContext();
    const body = $('hppBody');
    const label = $('hppLabel');

    $('hppResult').classList.add('hidden');

    if (!prod) {
        label.textContent = 'Menunggu pilihan menu...';
        body.innerHTML = emptyRow(3, 'Pilih menu terlebih dahulu untuk melihat rincian bahan.');
        return;
    }
    if (!recipe) {
        label.textContent = 'Resep belum diatur';
        body.innerHTML = emptyRow(3, 'Menu ini belum punya resep. Atur dulu di tab Menu &amp; Resep pada Master Resep.');
        return;
    }
    if (!lines.length) {
        label.textContent = 'Resep kosong';
        body.innerHTML = emptyRow(3, 'Resep ini belum memiliki bahan.');
        return;
    }

    label.textContent = `Resep: ${esc(recipe.name ?? recipe.description ?? '-')}`;

    const totalBahan = lines.reduce((s, l) => s + l.subtotal, 0);

    body.innerHTML = lines.map(l => `<tr>
        <td class="font-medium text-slate-800">${esc(l.name)}${!l.ing ? ' <span class="badge b-warn">Terhapus</span>' : ''}</td>
        <td>${num(l.amount)} <span class="text-slate-400">${esc(l.unit)}</span></td>
        <td class="text-right font-semibold text-slate-700">${rp(l.subtotal)}</td>
    </tr>`).join('');

    $('hppTotalBahan').textContent = rp(totalBahan);

    computeResult(prod, totalBahan);
}

function computeResult(prod, totalBahan) {
    const batch = parseFloat($('hppBatch').value) || 1;
    const output = parseFloat($('hppOutput').value) || 0;
    const extra = parseFloat($('hppExtra').value) || 0;
    const margin = parseFloat($('hppMargin').value) || 0;

    const resultBox = $('hppResult');

    if (!(output > 0)) {
        resultBox.classList.add('hidden');
        $('hppExtraHint').textContent = 'Isi jumlah hasil produksi (pcs per batch) untuk menghitung HPP.';
        return;
    }
    $('hppExtraHint').textContent = '';

    const totalBiaya = totalBahan + extra;
    const totalUnit = output; // per 1 batch resep
    const hppPerUnit = totalUnit > 0 ? totalBiaya / totalUnit : 0;
    const hargaSaran = hppPerUnit * (1 + margin / 100);
    const hargaJualSaatIni = pPrice(prod);

    const totalBiayaBatchDipilih = totalBiaya * batch;
    const totalUnitBatchDipilih = totalUnit * batch;

    resultBox.classList.remove('hidden');
    $('hppTotalBiaya').textContent = rp(totalBiaya);
    $('hppTotalUnit').textContent = `${num(totalUnit)} pcs`;
    $('hppPerUnit').textContent = rp(hppPerUnit);
    $('hppHargaSaran').textContent = rp(hargaSaran);

    $('hppBatchInfo').textContent =
        batch > 1
            ? `Untuk ${num(batch)} batch: total biaya ${rp(totalBiayaBatchDipilih)}, menghasilkan ${num(totalUnitBatchDipilih)} pcs.`
            : '';

    const currentBox = $('hppCurrentPrice');
    if (hargaJualSaatIni > 0) {
        const profit = hargaJualSaatIni - hppPerUnit;
        const marginAktual = hargaJualSaatIni > 0 ? (profit / hargaJualSaatIni) * 100 : 0;
        currentBox.classList.remove('hidden');
        $('hppHargaSekarang').textContent = rp(hargaJualSaatIni);
        $('hppProfit').textContent = rp(profit);
        $('hppProfit').className = 'font-bold ' + (profit >= 0 ? 'text-emerald-600' : 'text-rose-600');
        $('hppMarginAktual').textContent = `${num(marginAktual)}%`;
        $('hppMarginBadge').className = 'badge ' + (profit >= 0 ? 'b-ok' : 'b-bad');
        $('hppMarginBadge').textContent = profit >= 0 ? 'Untung' : 'Rugi';
    } else {
        currentBox.classList.add('hidden');
    }
}

// =========================================================
// EVENT
// =========================================================
const ACTIONS = {
    reload: () => loadData()
};

document.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (btn) ACTIONS[btn.dataset.action]?.(btn);
});

$('hppProduct').addEventListener('change', renderCalc);
$('hppBatch').addEventListener('input', renderCalc);
$('hppOutput').addEventListener('input', renderCalc);
$('hppExtra').addEventListener('input', renderCalc);
$('hppMargin').addEventListener('input', renderCalc);

// =========================================================
// INIT
// =========================================================
(async function init() {
    try {
        await authReady;
        await loadData();
    } catch (err) {
        console.error('INIT ERROR:', err);
        $('loadError').classList.remove('hidden');
        $('loadErrorMsg').textContent = msg(err);
    }
})();
