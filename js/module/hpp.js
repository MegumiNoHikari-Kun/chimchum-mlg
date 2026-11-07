import { supabase as db, authReady } from '../supabase.js';

// =========================================================
// STATE
// =========================================================
const S = { ingredients: [], products: [], recipes: [], loading: false, summaryText: '' };
const STORE_KEY = 'chimchum:hpp:v1';
const INPUT_IDS = ['hppQty', 'hppExtra', 'hppTarget', 'hppMode', 'hppRound', 'hppBatch'];

// =========================================================
// HELPER
// =========================================================
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 2) => (Number(n) || 0).toLocaleString('id-ID', { maximumFractionDigits: d });
const rp = n => {
    const r = Math.round(Number(n) || 0);
    return (r < 0 ? '-' : '') + 'Rp ' + Math.abs(r).toLocaleString('id-ID');
};
// Rupiah dengan desimal (untuk harga per gram/ml yang bisa pecahan)
const rpx = n => 'Rp ' + (Number(n) || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 });
const pct = (a, b) => (b > 0 ? (a / b) * 100 : 0);
const same = (a, b) => String(a) === String(b);
const readNum = id => Math.max(0, parseFloat($(id).value) || 0);
const msg = (e, fallback = 'Terjadi kesalahan.') =>
    e?.message ? e.message + (/row-level security|permission denied/i.test(e.message) ? ' (periksa RLS policy)' : '') : fallback;
const emptyRow = (cols, html) => `<tr><td colspan="${cols}" class="empty">${html}</td></tr>`;
const sortBy = (arr, fn) => arr.sort((a, b) => String(fn(a)).localeCompare(String(fn(b)), 'id'));
const roundUp = (v, step) => (step > 0 ? Math.ceil(v / step - 1e-9) * step : v);

// Getter fleksibel: kolom bahasa Indonesia atau Inggris
const pName = p => p?.nama ?? p?.name ?? 'Produk';
const pPrice = p => Number(p?.harga ?? p?.price) || 0;
const pIsi = p => Number(p?.isi ?? p?.isi_per_menu ?? p?.pcs) || null;
const iName = i => i?.name ?? i?.nama ?? 'Bahan';
const iUnit = i => i?.unit ?? i?.satuan ?? '';
const iPrice = i => Number(i?.price ?? i?.harga) || 0;
const rName = r => r?.name ?? r?.nama ?? r?.description ?? '-';

const ingById = id => S.ingredients.find(i => same(i.id, id));
const recById = id => S.recipes.find(r => same(r.id, id));
const isMapped = p => !!p.resep_id && !!recById(p.resep_id);
const currentProduct = () => S.products.find(p => same(p.id, $('hppProduct').value)) || null;

// items resep bisa berupa array atau string JSON
function recipeItems(r) {
    let items = r?.items ?? [];
    if (typeof items === 'string') {
        try { items = JSON.parse(items); } catch { items = []; }
    }
    return Array.isArray(items) ? items : [];
}

// localStorage aman (bisa gagal di mode private / iframe)
const store = {
    read() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; } },
    write(d) { try { localStorage.setItem(STORE_KEY, JSON.stringify(d)); } catch { /* abaikan */ } }
};

// =========================================================
// TOAST
// =========================================================
function toast(message, type = 'success') {
    const style = {
        success: ['bg-emerald-600', 'fa-circle-check'],
        error: ['bg-rose-600', 'fa-circle-exclamation'],
        warn: ['bg-amber-500', 'fa-triangle-exclamation'],
        info: ['bg-slate-800', 'fa-circle-info']
    }[type] ?? ['bg-slate-800', 'fa-circle-info'];
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
function setLoading(on) {
    S.loading = on;
    document.querySelectorAll('[data-action="reload"]').forEach(b => {
        b.disabled = on;
        b.querySelector('i')?.classList.toggle('spin', on);
    });
    $('hppProduct').disabled = on;
}

async function loadData() {
    if (S.loading) return null;
    setLoading(true);
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
    } finally {
        setLoading(false);
    }

    sortBy(S.products, pName);

    $('loadError').classList.toggle('hidden', !failed.length);
    if (failed.length) $('loadErrorMsg').textContent = `Gagal memuat: ${failed.join(', ')}. Periksa koneksi atau RLS policy.`;

    renderProductOptions();
    return failed.length === 0;
}

// =========================================================
// PILIHAN MENU
// =========================================================
function initialProductId() {
    try {
        const fromUrl = new URL(location.href).searchParams.get('menu');
        if (fromUrl) return fromUrl;
    } catch { /* abaikan */ }
    return store.read()._last ?? '';
}

function renderProductOptions() {
    const sel = $('hppProduct');
    const wanted = sel.value || initialProductId();

    if (!S.products.length) {
        sel.innerHTML = '<option value="">Belum ada menu</option>';
    } else {
        const opt = p => `<option value="${esc(p.id)}">${esc(pName(p))}</option>`;
        const ready = S.products.filter(isMapped);
        const notReady = S.products.filter(p => !isMapped(p));
        sel.innerHTML = '<option value="">— Pilih menu —</option>' +
            (ready.length ? `<optgroup label="Siap dihitung (${ready.length})">${ready.map(opt).join('')}</optgroup>` : '') +
            (notReady.length ? `<optgroup label="Belum ada resep (${notReady.length})">${notReady.map(opt).join('')}</optgroup>` : '');
    }

    sel.value = S.products.some(p => same(p.id, wanted)) ? String(wanted) : '';
    applyParams();
    render();
}

// Isi input dari parameter tersimpan (per menu), atau default
function applyParams() {
    const prod = currentProduct();
    const all = store.read();
    const saved = prod ? all.p?.[prod.id] : null;
    $('hppQty').value = saved?.qty ?? pIsi(prod) ?? 1;
    $('hppExtra').value = saved?.extra ?? '';
    $('hppTarget').value = saved?.target ?? all.g?.target ?? '';
    $('hppMode').value = all.g?.mode === 'margin' ? 'margin' : 'markup';
    $('hppRound').value = ['0', '100', '500', '1000'].includes(String(all.g?.round)) ? String(all.g.round) : '0';
}

function saveParams() {
    const prod = currentProduct();
    const all = store.read();
    all.g = { mode: $('hppMode').value, round: $('hppRound').value, target: $('hppTarget').value };
    all.p = all.p || {};
    if (prod) {
        all.p[prod.id] = { qty: $('hppQty').value, extra: $('hppExtra').value, target: $('hppTarget').value };
        all._last = prod.id;
    }
    store.write(all);
}

function onProductChange() {
    applyParams();
    const prod = currentProduct();
    const all = store.read();
    all._last = prod?.id ?? '';
    store.write(all);
    try {
        const u = new URL(location.href);
        prod ? u.searchParams.set('menu', prod.id) : u.searchParams.delete('menu');
        history.replaceState(null, '', u);
    } catch { /* abaikan */ }
    render();
}

// =========================================================
// KALKULATOR HPP
// =========================================================
function calcContext() {
    const prod = currentProduct();
    const recipe = prod?.resep_id ? recById(prod.resep_id) : null;
    const qty = readNum('hppQty');                                  // isi per menu (pcs)
    const batch = Math.max(1, Math.round(readNum('hppBatch')) || 1); // jumlah menu yang diproduksi

    // Gabungkan bahan yang sama. amount di resep = kebutuhan untuk 1 PCS.
    const merged = new Map();
    recipeItems(recipe).forEach(it => {
        const id = String(it.ingredientId ?? it.ingredient_id ?? it.bahan_id ?? '');
        if (!id) return;
        merged.set(id, (merged.get(id) || 0) + (Number(it.amount ?? it.jumlah) || 0));
    });

    // Tanpa pembulatan di tengah hitungan agar subtotal akurat
    const lines = [...merged].map(([id, perPcs]) => {
        const ing = ingById(id);
        const price = ing ? iPrice(ing) : 0;
        const perMenu = perPcs * qty;
        return {
            ing,
            name: ing ? iName(ing) : 'Bahan terhapus',
            unit: ing ? iUnit(ing) : '',
            price,
            perPcs,
            perMenu,
            perBatch: perMenu * batch,
            subtotal: perMenu * price
        };
    }).sort((a, b) => b.subtotal - a.subtotal || a.name.localeCompare(b.name, 'id'));

    const totalBahan = lines.reduce((s, l) => s + l.subtotal, 0);
    const extra = readNum('hppExtra');
    const hpp = totalBahan + extra;

    return { prod, recipe, qty, batch, lines, totalBahan, extra, hpp };
}

function stateOf(ctx) {
    if (S.loading && !S.products.length) return { msg: 'Memuat data...' };
    if (!S.products.length) return { msg: 'Belum ada menu. Tambahkan menu di Master Menu.', link: true };
    if (!ctx.prod) return { msg: 'Pilih menu untuk mulai menghitung HPP.' };
    if (!ctx.recipe) return { msg: 'Menu ini belum punya resep. Atur dulu di Master Menu.', link: true };
    if (!ctx.lines.length) return { msg: 'Resep ini belum memiliki bahan.', link: true };
    if (!(ctx.qty > 0)) return { msg: 'Isi "Isi per menu" (minimal 1 pcs) untuk menghitung HPP.', soft: true };
    return null;
}

// Harga jual dari HPP + target. markup = laba/HPP, margin = laba/harga jual.
function suggestPrice(hpp, target, mode) {
    if (!(target > 0)) return { raw: null, valid: false, reason: 'Isi target keuntungan untuk melihat saran harga jual.' };
    if (mode === 'margin') {
        if (target >= 100) return { raw: null, valid: false, reason: 'Margin harus di bawah 100%.' };
        return { raw: hpp / (1 - target / 100), valid: true };
    }
    return { raw: hpp * (1 + target / 100), valid: true };
}

function render() {
    const ctx = calcContext();
    const state = stateOf(ctx);
    renderMeta(ctx);
    renderTable(ctx, state);
    renderSummary(ctx, state);
    $('hppTargetHint').textContent = $('hppMode').value === 'margin'
        ? 'Margin = laba ÷ harga jual. Cth: HPP Rp 7.000, margin 30% → Rp 10.000.'
        : 'Markup = laba ÷ HPP. Cth: HPP Rp 10.000, markup 30% → Rp 13.000.';
}

function renderMeta({ prod, recipe }) {
    const el = $('prodMeta');
    if (!prod) { el.innerHTML = ''; return; }
    const price = pPrice(prod);
    el.innerHTML = [
        recipe
            ? `<span class="badge b-ok"><i class="fa-solid fa-book-open mr-1"></i>${esc(rName(recipe))}</span>`
            : '<span class="badge b-bad"><i class="fa-solid fa-circle-xmark mr-1"></i>Belum ada resep</span>',
        price > 0
            ? `<span class="badge b-muted">Harga jual: ${rp(price)}</span>`
            : '<span class="badge b-warn">Harga jual belum diatur</span>'
    ].join('');
}

function renderTable(ctx, state) {
    const { lines, qty, batch, totalBahan, recipe } = ctx;
    const showBatch = batch > 1 && qty > 0;
    const cols = showBatch ? 7 : 6;

    $('hppHead').innerHTML = `<tr>
        <th>Bahan baku</th>
        <th class="text-right">Per 1 pcs</th>
        <th class="text-right">Per menu (×${fmt(qty)})</th>
        ${showBatch ? `<th class="text-right">Untuk ${fmt(batch, 0)} menu</th>` : ''}
        <th class="text-right">Harga / satuan</th>
        <th class="text-right">Subtotal</th>
        <th class="text-right">Porsi</th>
    </tr>`;

    $('hppLabel').textContent = recipe ? `Resep: ${rName(recipe)} · per 1 pcs` : 'Menunggu pilihan menu';

    if (state && !state.soft) {
        $('hppBody').innerHTML = emptyRow(cols, esc(state.msg));
        $('hppFoot').innerHTML = '';
        return;
    }

    const unit = u => (u ? ` <span class="u">${esc(u)}</span>` : '');
    $('hppBody').innerHTML = lines.map(l => {
        const share = pct(l.subtotal, totalBahan);
        const flag = !l.ing
            ? ' <span class="badge b-bad">Terhapus</span>'
            : !(l.price > 0) ? ' <span class="badge b-warn">Harga kosong</span>' : '';
        return `<tr>
            <td class="font-medium text-slate-800">${esc(l.name)}${flag}</td>
            <td class="text-right tabular-nums text-slate-500">${fmt(l.perPcs, 3)}${unit(l.unit)}</td>
            <td class="text-right tabular-nums">${fmt(l.perMenu, 3)}${unit(l.unit)}</td>
            ${showBatch ? `<td class="text-right tabular-nums">${fmt(l.perBatch, 3)}${unit(l.unit)}</td>` : ''}
            <td class="text-right tabular-nums text-slate-500">${l.price > 0 ? rpx(l.price) + (l.unit ? `<span class="u">/${esc(l.unit)}</span>` : '') : '-'}</td>
            <td class="text-right tabular-nums font-semibold text-slate-700">${rp(l.subtotal)}</td>
            <td class="text-right">
                <div class="share"><div class="share-bar"><span style="width:${Math.min(100, share).toFixed(1)}%"></span></div><span class="tabular-nums w-10">${fmt(share, 1)}%</span></div>
            </td>
        </tr>`;
    }).join('');

    $('hppFoot').innerHTML = `<tr>
        <td colspan="${cols - 2}">Total biaya bahan per menu</td>
        <td class="text-right tabular-nums text-orange-600">${rp(totalBahan)}</td>
        <td></td>
    </tr>`;
}

function renderSummary(ctx, state) {
    const emptyBox = $('sumEmpty');
    const body = $('sumBody');

    if (state) {
        emptyBox.classList.remove('hidden');
        body.classList.add('hidden');
        $('sumEmptyMsg').textContent = state.msg;
        $('sumEmptyLink').classList.toggle('hidden', !state.link);
        S.summaryText = '';
        return;
    }
    emptyBox.classList.add('hidden');
    body.classList.remove('hidden');

    const { prod, qty, batch, lines, totalBahan, extra, hpp } = ctx;
    const target = readNum('hppTarget');
    const mode = $('hppMode').value;
    const step = Number($('hppRound').value) || 0;
    const modeLabel = mode === 'margin' ? 'margin' : 'markup';

    // --- Rincian HPP
    $('sumBahan').textContent = rp(totalBahan);
    $('sumExtra').textContent = rp(extra);
    $('sumHpp').textContent = rp(hpp);
    $('sumHppPcs').textContent = `${rp(hpp / qty)} / pcs · isi ${fmt(qty)} pcs`;

    // --- Peringatan data bahan
    const missing = lines.filter(l => !l.ing || !(l.price > 0)).length;
    $('sumWarn').classList.toggle('hidden', !missing);
    $('sumWarnMsg').textContent = `${missing} bahan terhapus atau belum punya harga. HPP bisa lebih rendah dari sebenarnya.`;

    // --- Saran harga jual
    const sug = suggestPrice(hpp, target, mode);
    let finalPrice = null;
    if (!sug.valid) {
        $('sumSaran').textContent = '—';
        $('sumSaranNote').textContent = sug.reason;
    } else {
        finalPrice = roundUp(sug.raw, step);
        const laba = finalPrice - hpp;
        const rounded = step > 0 && Math.round(finalPrice) !== Math.round(sug.raw);
        $('sumSaran').textContent = rp(finalPrice);
        $('sumSaranNote').textContent =
            `Laba ${rp(laba)} / menu · margin ${fmt(pct(laba, finalPrice), 1)}% · markup ${fmt(pct(laba, hpp), 1)}%` +
            (rounded ? `\nDibulatkan dari ${rp(sug.raw)}` : '');
    }

    // --- Perbandingan dengan harga jual sekarang
    const cur = pPrice(prod);
    const cmp = $('cmpBox');
    let cmpText = '';
    if (cur > 0) {
        const profit = cur - hpp;
        const marginNow = pct(profit, cur);
        const markupNow = pct(profit, hpp);
        let badge = ['Untung', 'b-ok'];
        let note = target > 0 && sug.valid ? 'Harga sekarang sudah memenuhi target.' : '';

        if (profit < 0) {
            badge = ['Rugi', 'b-bad'];
            note = `Harga jual di bawah HPP. Naikkan minimal ${rp(-profit)} agar tidak rugi.`;
        } else if (Math.round(profit) === 0) {
            badge = ['Impas', 'b-warn'];
            note = 'Harga jual sama dengan HPP, belum ada laba.';
        } else if (sug.valid && cur + 0.5 < sug.raw) {
            badge = ['Di bawah target', 'b-warn'];
            note = `Kurang ${rp(sug.raw - cur)} untuk mencapai ${modeLabel} ${fmt(target)}%.`;
        }

        cmp.classList.remove('hidden');
        $('cmpHarga').textContent = rp(cur);
        $('cmpProfit').textContent = rp(profit);
        $('cmpProfit').className = 'font-bold tabular-nums ' + (profit >= 0 ? 'text-emerald-600' : 'text-rose-600');
        $('cmpMargin').textContent = `${fmt(marginNow, 1)}%`;
        $('cmpMarkup').textContent = `${fmt(markupNow, 1)}%`;
        $('cmpBadge').className = 'badge ' + badge[1];
        $('cmpBadge').textContent = badge[0];
        $('cmpNote').textContent = note;
        $('cmpNote').classList.toggle('hidden', !note);
        cmpText = `Harga jual sekarang: ${rp(cur)} (laba ${rp(profit)}, margin ${fmt(marginNow, 1)}%) - ${badge[0]}`;
    } else {
        cmp.classList.add('hidden');
    }
    $('cmpMissing').classList.toggle('hidden', cur > 0);

    // --- Simulasi produksi
    const batchBox = $('batchBox');
    batchBox.classList.toggle('hidden', !(batch > 1));
    if (batch > 1) {
        $('batchTotal').textContent = rp(hpp * batch);
        $('batchInfo').textContent =
            `${fmt(batch, 0)} menu · ${fmt(qty * batch)} pcs · bahan ${rp(totalBahan * batch)} + tambahan ${rp(extra * batch)}`;
    }

    // --- Teks ringkasan untuk disalin
    S.summaryText = [
        `HPP ${pName(prod)}`,
        `Isi per menu: ${fmt(qty)} pcs`,
        `Biaya bahan: ${rp(totalBahan)}`,
        `Biaya tambahan: ${rp(extra)}`,
        `HPP per menu: ${rp(hpp)} (${rp(hpp / qty)} / pcs)`,
        finalPrice != null ? `Saran harga jual (${modeLabel} ${fmt(target)}%): ${rp(finalPrice)}` : '',
        cmpText,
        '',
        'Rincian bahan per menu:',
        ...lines.map(l => `- ${l.name}: ${fmt(l.perMenu, 3)} ${l.unit} = ${rp(l.subtotal)}`)
    ].filter((v, i, a) => v !== '' || a[i - 1] !== '').join('\n').trim();
}

// =========================================================
// EVENT
// =========================================================
async function copySummary() {
    if (!S.summaryText) return toast('Belum ada hasil untuk disalin.', 'warn');
    try {
        await navigator.clipboard.writeText(S.summaryText);
        toast('Ringkasan HPP disalin.');
    } catch {
        toast('Gagal menyalin. Browser tidak mengizinkan akses clipboard.', 'error');
    }
}

const ACTIONS = {
    reload: async () => {
        const ok = await loadData();
        if (ok === true) toast('Data diperbarui.');
        else if (ok === false) toast('Sebagian data gagal dimuat.', 'warn');
    },
    copy: () => copySummary()
};

document.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (btn && !btn.disabled) ACTIONS[btn.dataset.action]?.(btn);
});

$('hppProduct').addEventListener('change', onProductChange);
INPUT_IDS.forEach(id => {
    const el = $(id);
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => { saveParams(); render(); });
});

// Cegah angka berubah tanpa sengaja saat scroll di atas input number
document.querySelectorAll('input[type="number"]').forEach(el =>
    el.addEventListener('wheel', () => { if (document.activeElement === el) el.blur(); }, { passive: true })
);

// =========================================================
// INIT
// =========================================================
(async function init() {
    try {
        await authReady;
        await loadData();
    } catch (err) {
        console.error('INIT ERROR:', err);
        setLoading(false);
        $('loadError').classList.remove('hidden');
        $('loadErrorMsg').textContent = msg(err);
    }
})();
