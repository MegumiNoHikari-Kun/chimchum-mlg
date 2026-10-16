import { supabase, authReady } from '../supabase.js';
let myChart = null;
function rupiah(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }

// Ambil HPP real dari tabel products -> map berdasarkan id & nama
async function loadProductHpp() {
    const byId = {};
    const byName = {};
    try {
        const { data, error } = await supabase.from('products').select('id, nama, name, hpp');
        if (error) throw error;
        (data || []).forEach(p => {
            const hpp = Number(p.hpp || 0);
            if (p.id !== undefined && p.id !== null) byId[String(p.id)] = hpp;
            const nm = (p.nama || p.name || '').toString().trim().toLowerCase();
            if (nm) byName[nm] = hpp;
        });
    } catch (e) {
        console.warn('Gagal load products:', e);
    }
    return { byId, byName };
}

function getItemHpp(item, hppMap) {
    const id = item.product_id ?? item.id;
    if (id !== undefined && id !== null && hppMap.byId[String(id)] !== undefined) {
        return hppMap.byId[String(id)];
    }
    const nm = (item.nama || item.name || '').toString().trim().toLowerCase();
    if (nm && hppMap.byName[nm] !== undefined) return hppMap.byName[nm];
    return null; // tidak ketemu di products
}

window.renderReport = async function() {
    const start = document.getElementById('tglMulai').value;
    const end = document.getElementById('tglAkhir').value;
    await authReady;

    let orders = [];
    try {
        const { data } = await supabase.from('orders').select('*');
        if (data) orders = data;
    } catch(e) { console.warn(e); }
    if (orders.length === 0) orders = JSON.parse(localStorage.getItem('local_orders') || '[]');

    const hppMap = await loadProductHpp();

    const filtered = orders.filter(o => {
        if (!o.created_at) return false;
        const d = o.created_at.split('T')[0];
        if (start && d < start) return false;
        if (end && d > end) return false;
        return (o.status || '').toLowerCase() !== 'cancel';
    });

    let omzetTotal = 0, hppTotal = 0, missingCount = 0;
    const daily = {};

    filtered.forEach(o => {
        const d = (o.created_at || '').split('T')[0] || 'Unknown';
        const omz = Number(o.grand_total || o.total_price || 0);
        omzetTotal += omz;

        let items = o.items;
        if (typeof items === 'string') {
            try { items = JSON.parse(items); } catch { items = []; }
        }

        let hpp = 0;
        if (Array.isArray(items)) {
            items.forEach(i => {
                const unitHpp = getItemHpp(i, hppMap);
                if (unitHpp === null) {
                    missingCount++;
                    // fallback: pakai hpp yang tersimpan di item (jika ada), kalau tidak 0
                    hpp += Number(i.hpp || 0) * Number(i.qty || 1);
                } else {
                    hpp += unitHpp * Number(i.qty || 1);
                }
            });
        }
        hppTotal += hpp;

        if (!daily[d]) daily[d] = { count: 0, omzet: 0, hpp: 0 };
        daily[d].count++;
        daily[d].omzet += omz;
        daily[d].hpp += hpp;
    });

    if (missingCount > 0) {
        console.warn(`${missingCount} item tidak ditemukan di tabel products (HPP dihitung 0 / dari item).`);
    }

    const profitTotal = omzetTotal - hppTotal;

    document.getElementById('summaryCards').innerHTML = `
        <div class="border rounded-xl p-3 bg-slate-50"><div class="text-[11px] text-slate-500">Total Omzet</div><div class="text-base font-bold text-orange-600">${rupiah(omzetTotal)}</div></div>
        <div class="border rounded-xl p-3 bg-slate-50"><div class="text-[11px] text-slate-500">Total HPP</div><div class="text-base font-bold text-rose-600">${rupiah(hppTotal)}</div></div>
        <div class="border rounded-xl p-3 bg-slate-50"><div class="text-[11px] text-slate-500">Profit Bersih</div><div class="text-base font-bold text-emerald-600">${rupiah(profitTotal)}</div></div>
        <div class="border rounded-xl p-3 bg-slate-50"><div class="text-[11px] text-slate-500">Total Transaksi</div><div class="text-base font-bold text-slate-800">${filtered.length}</div></div>
    `;

    const dates = Object.keys(daily).sort();
    const tbody = document.getElementById('reportTable');
    if (dates.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-10 text-slate-400">Tidak ada data transaksi.</td></tr>`;
    } else {
        tbody.innerHTML = dates.map(d => {
            const r = daily[d];
            const prof = r.omzet - r.hpp;
            return `
                <tr class="hover:bg-slate-50">
                    <td class="p-3 font-semibold">${d}</td>
                    <td class="p-3">${r.count} Transaksi</td>
                    <td class="p-3 font-bold text-orange-600">${rupiah(r.omzet)}</td>
                    <td class="p-3">${rupiah(r.hpp)}</td>
                    <td class="p-3 font-bold text-emerald-600">${rupiah(prof)}</td>
                </tr>
            `;
        }).join('');
    }

    const ctx = document.getElementById('reportChart');
    if (ctx) {
        if (myChart) myChart.destroy();
        myChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: dates,
                datasets: [
                    { label: 'Omzet (Rp)', data: dates.map(d => daily[d].omzet), backgroundColor: '#ff6b35', borderRadius: 4 },
                    { label: 'Profit (Rp)', data: dates.map(d => daily[d].omzet - daily[d].hpp), backgroundColor: '#2ecc71', borderRadius: 4 }
                ]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } } }
        });
    }
};

const today = new Date();
const first = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
const last = today.toISOString().split('T')[0];
document.getElementById('tglMulai').value = first;
document.getElementById('tglAkhir').value = last;
renderReport();
