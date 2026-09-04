import { supabase, authReady } from '../supabase.js';
let products = [];
let filterStatus = 'all';

window.loadStok = async function() {
    await authReady;
    try {
        const { data } = await supabase.from('products').select('*');
        if (data) products = data;
    } catch(e) { console.warn(e); }
    renderSummary();
    renderTable();
};

function renderSummary() {
    let total = products.length, aman = 0, menipis = 0, habis = 0;
    products.forEach(p => {
        const st = Number(p.stok) || 0;
        if (st <= 0) habis++;
        else if (st <= 10) menipis++;
        else aman++;
    });

    document.getElementById('stokSummary').innerHTML = `
        <div onclick="setFilter('all')" class="border rounded-xl p-3 cursor-pointer hover:shadow-sm ${filterStatus==='all'?'border-slate-800 bg-slate-50':''}">
            <div class="text-[11px] text-slate-500">Total Produk</div>
            <div class="text-lg font-bold text-slate-800">${total}</div>
        </div>
        <div onclick="setFilter('aman')" class="border rounded-xl p-3 cursor-pointer hover:shadow-sm ${filterStatus==='aman'?'border-emerald-500 bg-emerald-50/50':''}">
            <div class="text-[11px] text-slate-500">Aman (>10)</div>
            <div class="text-lg font-bold text-emerald-600">${aman}</div>
        </div>
        <div onclick="setFilter('menipis')" class="border rounded-xl p-3 cursor-pointer hover:shadow-sm ${filterStatus==='menipis'?'border-amber-500 bg-amber-50/50':''}">
            <div class="text-[11px] text-slate-500">Menipis (1-10)</div>
            <div class="text-lg font-bold text-amber-600">${menipis}</div>
        </div>
        <div onclick="setFilter('habis')" class="border rounded-xl p-3 cursor-pointer hover:shadow-sm ${filterStatus==='habis'?'border-rose-500 bg-rose-50/50':''}">
            <div class="text-[11px] text-slate-500">Habis (0)</div>
            <div class="text-lg font-bold text-rose-600">${habis}</div>
        </div>
    `;
}

window.setFilter = function(st) {
    filterStatus = st;
    renderSummary();
    renderTable();
};

window.renderTable = function() {
    const kw = document.getElementById('stokSearch').value.toLowerCase().trim();
    const tbody = document.getElementById('stokTableBody');
    let filtered = products.filter(p => (p.nama || p.name || '').toLowerCase().includes(kw));

    if (filterStatus !== 'all') {
        filtered = filtered.filter(p => {
            const st = Number(p.stok) || 0;
            if (filterStatus === 'habis') return st <= 0;
            if (filterStatus === 'menipis') return st > 0 && st <= 10;
            if (filterStatus === 'aman') return st > 10;
            return true;
        });
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-10 text-slate-400">Tidak ada produk ditemukan.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(p => {
        const st = Number(p.stok) || 0;
        let badge = `<span class="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-semibold text-[10px]">Aman</span>`;
        if (st <= 0) badge = `<span class="bg-rose-50 text-rose-700 px-2 py-0.5 rounded-full font-semibold text-[10px]">Habis</span>`;
        else if (st <= 10) badge = `<span class="bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full font-semibold text-[10px]">Menipis</span>`;

        return `
            <tr class="hover:bg-slate-50">
                <td class="p-3"><img src="${p.foto || p.image || 'https://placehold.co/40'}" class="w-10 h-10 object-cover rounded-lg"></td>
                <td class="p-3 font-semibold text-slate-800">${p.nama || p.name}</td>
                <td class="p-3">${p.kategori || p.category || '-'}</td>
                <td class="p-3 font-bold">${st}</td>
                <td class="p-3">${badge}</td>
                <td class="p-3">
                    <div class="flex items-center gap-1">
                        <button onclick="modStock('${p.id}', ${st - 1})" class="bg-slate-100 px-2.5 py-1 rounded font-bold">-</button>
                        <input type="number" value="${st}" id="stok-${p.id}" class="w-12 text-center bg-slate-50 border rounded p-1" onchange="inputStock('${p.id}')">
                        <button onclick="modStock('${p.id}', ${st + 1})" class="bg-slate-100 px-2.5 py-1 rounded font-bold">+</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
};

window.modStock = async function(id, val) {
    val = Math.max(0, Number(val) || 0);
    await authReady;
    try {
        await supabase.from('products').update({ stok: val }).eq('id', id);
        products = products.map(p => String(p.id) === String(id) ? { ...p, stok: val } : p);
        renderSummary();
        renderTable();
    } catch(e) { alert('Gagal update stok: ' + e.message); }
};

window.inputStock = async function(id) {
    const v = Number(document.getElementById(`stok-${id}`).value);
    await modStock(id, v);
};

loadStok();
