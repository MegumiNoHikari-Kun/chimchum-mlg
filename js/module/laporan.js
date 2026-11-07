import { supabase, authReady } from '../supabase.js';

// ============================================================
//  Helpers
// ============================================================
const $ = (id) => document.getElementById(id);
let myChart = null;
let lastRows = [];      // dipakai untuk export CSV
let lastRange = { start: '', end: '' };
let busy = false;

const CANCEL_STATUSES = ['cancel', 'canceled', 'cancelled', 'batal', 'dibatalkan'];
const MAX_FILL_DAYS = 92; // isi tanggal kosong di chart jika rentang <= ini

function rupiah(n) {
    return 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID');
}
function rupiahShort(n) {
    const v = Number(n || 0), a = Math.abs(v);
    const f = (x) => x.toLocaleString('id-ID', { maximumFractionDigits: 1 });
    if (a >= 1e9) return f(v / 1e9) + ' M';
    if (a >= 1e6) return f(v / 1e6) + ' jt';
    if (a >= 1e3) return f(v / 1e3) + ' rb';
    return f(v);
}
function persen(n) {
    return (Number.isFinite(n) ? n : 0).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + '%';
}

// Tanggal lokal (bukan UTC) -> 'YYYY-MM-DD'
function toKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
function parseKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
}
function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
}
// created_at (timestamptz UTC) -> tanggal lokal toko
function keyFromCreatedAt(s) {
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d) ? null : toKey(d);
}
function fmtTanggal(key, opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) {
    return parseKey(key).toLocaleDateString('id-ID', opts);
}
function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ============================================================
//  Data
// ============================================================
async function loadProductHpp() {
    const byId = {};
    const byName = {};
    try {
        const { data, error } = await supabase.from('products').select('*');
        if (error) throw error;
        (data || []).forEach((p) => {
            const hpp = Number(p.hpp || 0);
            if (p.id !== undefined && p.id !== null) byId[String(p.id)] = hpp;
            const nm = (p.nama || p.name || p.nama_produk || p.title || '').toString().trim().toLowerCase();
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
    return null;
}

// Ambil order sesuai rentang langsung dari server (lebih ringan daripada select semua)
async function fetchOrders(start, end) {
    try {
        let q = supabase.from('orders').select('*');
        if (start) q = q.gte('created_at', parseKey(start).toISOString());
        if (end) q = q.lt('created_at', addDays(parseKey(end), 1).toISOString());
        const { data, error } = await q;
        if (error) throw error;
        return { orders: data || [], source: 'server' };
    } catch (e) {
        console.warn('Gagal load orders dari server, pakai data lokal:', e);
        const local = JSON.parse(localStorage.getItem('local_orders') || '[]');
        return { orders: local, source: 'local' };
    }
}

// ============================================================
//  UI states
// ============================================================
function setBusy(on) {
    busy = on;
    const btn = $('btnFilter');
    if (btn) {
        btn.disabled = on;
        btn.querySelector('i').className = on ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-rotate-right';
    }
}

function showLoading() {
    $('summaryCards').innerHTML = Array.from({ length: 4 }).map(() => `
        <div class="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
            <div class="skeleton h-3 w-20 mb-3"></div>
            <div class="skeleton h-6 w-32 mb-2"></div>
            <div class="skeleton h-3 w-24"></div>
        </div>`).join('');
    $('reportTable').innerHTML = Array.from({ length: 5 }).map(() => `
        <tr>${Array.from({ length: 6 }).map(() => `<td class="p-3.5"><div class="skeleton h-3 w-full"></div></td>`).join('')}</tr>`).join('');
    $('reportFoot').innerHTML = '';
    $('alerts').innerHTML = '';
}

function alertBox(type, icon, html) {
    const styles = {
        warn: 'bg-amber-50 border-amber-200 text-amber-800',
        info: 'bg-sky-50 border-sky-200 text-sky-800',
        error: 'bg-rose-50 border-rose-200 text-rose-800',
    };
    return `<div class="flex items-start gap-2.5 border rounded-xl px-3.5 py-2.5 text-xs ${styles[type]}">
        <i class="fa-solid ${icon} mt-0.5"></i><div>${html}</div></div>`;
}

function card({ label, value, sub, icon, tone }) {
    const tones = {
        orange: ['bg-orange-100 text-orange-500', 'text-slate-800'],
        rose: ['bg-rose-100 text-rose-500', 'text-slate-800'],
        emerald: ['bg-emerald-100 text-emerald-600', 'text-emerald-600'],
        red: ['bg-rose-100 text-rose-600', 'text-rose-600'],
        slate: ['bg-slate-100 text-slate-600', 'text-slate-800'],
    };
    const [iconCls, valCls] = tones[tone] || tones.slate;
    return `
        <div class="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
            <div class="flex items-center justify-between mb-2">
                <span class="text-[11px] font-medium text-slate-500">${label}</span>
                <span class="w-7 h-7 rounded-lg grid place-items-center text-xs ${iconCls}"><i class="fa-solid ${icon}"></i></span>
            </div>
            <div class="text-base md:text-lg font-bold tabular truncate ${valCls}" title="${value}">${value}</div>
            <div class="text-[11px] text-slate-400 mt-0.5 truncate">${sub}</div>
        </div>`;
}

function marginBadge(m, hasOmzet) {
    if (!hasOmzet) return '<span class="text-slate-300">–</span>';
    const cls = m < 0 ? 'bg-rose-50 text-rose-600'
        : m < 20 ? 'bg-amber-50 text-amber-600'
        : 'bg-emerald-50 text-emerald-600';
    return `<span class="inline-block px-2 py-0.5 rounded-md font-semibold ${cls}">${persen(m)}</span>`;
}

// ============================================================
//  Render
// ============================================================
window.renderReport = async function () {
    if (busy) return;

    let start = $('tglMulai').value;
    let end = $('tglAkhir').value;
    if (start && end && start > end) {
        [start, end] = [end, start];
        $('tglMulai').value = start;
        $('tglAkhir').value = end;
    }
    lastRange = { start, end };

    setBusy(true);
    showLoading();

    try {
        await authReady;
        const [{ orders, source }, hppMap] = await Promise.all([fetchOrders(start, end), loadProductHpp()]);

        // Filter tetap dijalankan di client (untuk data lokal & tanggal zona waktu lokal)
        const filtered = orders.filter((o) => {
            const d = keyFromCreatedAt(o.created_at);
            if (!d) return false;
            if (start && d < start) return false;
            if (end && d > end) return false;
            return !CANCEL_STATUSES.includes((o.status || '').toString().trim().toLowerCase());
        });

        let omzetTotal = 0, hppTotal = 0, missingCount = 0;
        const missingNames = new Set();
        const daily = {};

        filtered.forEach((o) => {
            const d = keyFromCreatedAt(o.created_at);
            const omz = Number(o.grand_total || o.total_price || 0);
            omzetTotal += omz;

            let items = o.items;
            if (typeof items === 'string') {
                try { items = JSON.parse(items); } catch { items = []; }
            }

            let hpp = 0;
            if (Array.isArray(items)) {
                items.forEach((i) => {
                    const qty = Number(i.qty || 1);
                    const unitHpp = getItemHpp(i, hppMap);
                    if (unitHpp === null) {
                        missingCount++;
                        missingNames.add((i.nama || i.name || 'Tanpa nama').toString());
                        hpp += Number(i.hpp || 0) * qty; // fallback HPP yang tersimpan di item
                    } else {
                        hpp += unitHpp * qty;
                    }
                });
            }
            hppTotal += hpp;

            if (!daily[d]) daily[d] = { count: 0, omzet: 0, hpp: 0 };
            daily[d].count++;
            daily[d].omzet += omz;
            daily[d].hpp += hpp;
        });

        const profitTotal = omzetTotal - hppTotal;
        const marginTotal = omzetTotal ? (profitTotal / omzetTotal) * 100 : 0;
        const avgTrx = filtered.length ? omzetTotal / filtered.length : 0;

        // ---------- Alerts ----------
        const alerts = [];
        if (source === 'local') {
            alerts.push(alertBox('error', 'fa-cloud-arrow-down',
                '<b>Gagal terhubung ke server.</b> Data di bawah berasal dari penyimpanan lokal perangkat ini dan mungkin tidak lengkap.'));
        }
        if (missingCount > 0) {
            const names = [...missingNames].slice(0, 5).map(escapeHtml).join(', ');
            const more = missingNames.size > 5 ? ` dan ${missingNames.size - 5} lainnya` : '';
            alerts.push(alertBox('warn', 'fa-triangle-exclamation',
                `<b>${missingCount} item</b> tidak ditemukan di data produk, jadi HPP-nya memakai nilai yang tersimpan di transaksi (atau 0). Profit bisa terlihat lebih besar dari aslinya.<br><span class="opacity-80">Produk: ${names}${more}</span>`));
        }
        $('alerts').innerHTML = alerts.join('');

        // ---------- Cards ----------
        const rangeLabel = start && end
            ? (start === end ? fmtTanggal(start, { day: 'numeric', month: 'short', year: 'numeric' })
                : `${fmtTanggal(start, { day: 'numeric', month: 'short' })} – ${fmtTanggal(end, { day: 'numeric', month: 'short', year: 'numeric' })}`)
            : 'Semua periode';

        $('summaryCards').innerHTML = [
            card({ label: 'Total Omzet', value: rupiah(omzetTotal), sub: rangeLabel, icon: 'fa-sack-dollar', tone: 'orange' }),
            card({ label: 'Total HPP', value: rupiah(hppTotal), sub: omzetTotal ? `${persen((hppTotal / omzetTotal) * 100)} dari omzet` : '–', icon: 'fa-boxes-stacked', tone: 'rose' }),
            card({ label: 'Profit Bersih', value: rupiah(profitTotal), sub: `Margin ${persen(marginTotal)}`, icon: profitTotal < 0 ? 'fa-arrow-trend-down' : 'fa-arrow-trend-up', tone: profitTotal < 0 ? 'red' : 'emerald' }),
            card({ label: 'Total Transaksi', value: filtered.length.toLocaleString('id-ID'), sub: `Rata-rata ${rupiah(avgTrx)}`, icon: 'fa-receipt', tone: 'slate' }),
        ].join('');

        // ---------- Table (terbaru di atas) ----------
        const dataDates = Object.keys(daily).sort();
        lastRows = dataDates.map((d) => {
            const r = daily[d];
            const profit = r.omzet - r.hpp;
            return { date: d, count: r.count, omzet: r.omzet, hpp: r.hpp, profit, margin: r.omzet ? (profit / r.omzet) * 100 : 0 };
        });

        const tbody = $('reportTable');
        const tfoot = $('reportFoot');
        if (lastRows.length === 0) {
            tbody.innerHTML = `
                <tr><td colspan="6" class="text-center py-14 text-slate-400">
                    <i class="fa-regular fa-folder-open text-3xl mb-2 block text-slate-300"></i>
                    Tidak ada transaksi pada periode ini.
                    <div class="text-[11px] mt-1">Coba pilih rentang tanggal lain.</div>
                </td></tr>`;
            tfoot.innerHTML = '';
            $('tableInfo').textContent = '';
        } else {
            tbody.innerHTML = [...lastRows].reverse().map((r) => `
                <tr class="hover:bg-orange-50/40 transition">
                    <td class="p-3.5 font-medium text-slate-800 whitespace-nowrap">${fmtTanggal(r.date)}</td>
                    <td class="p-3.5 text-right">${r.count.toLocaleString('id-ID')}</td>
                    <td class="p-3.5 text-right font-semibold text-slate-800">${rupiah(r.omzet)}</td>
                    <td class="p-3.5 text-right text-slate-500">${rupiah(r.hpp)}</td>
                    <td class="p-3.5 text-right font-semibold ${r.profit < 0 ? 'text-rose-600' : 'text-emerald-600'}">${rupiah(r.profit)}</td>
                    <td class="p-3.5 text-right">${marginBadge(r.margin, r.omzet > 0)}</td>
                </tr>`).join('');

            tfoot.innerHTML = `
                <tr class="bg-slate-50 font-bold text-slate-800 border-t-2 border-slate-200">
                    <td class="p-3.5">Total</td>
                    <td class="p-3.5 text-right">${filtered.length.toLocaleString('id-ID')}</td>
                    <td class="p-3.5 text-right">${rupiah(omzetTotal)}</td>
                    <td class="p-3.5 text-right">${rupiah(hppTotal)}</td>
                    <td class="p-3.5 text-right ${profitTotal < 0 ? 'text-rose-600' : 'text-emerald-600'}">${rupiah(profitTotal)}</td>
                    <td class="p-3.5 text-right">${marginBadge(marginTotal, omzetTotal > 0)}</td>
                </tr>`;
            $('tableInfo').textContent = `${lastRows.length} hari dengan transaksi`;
        }
        $('btnExport').disabled = lastRows.length === 0;

        // ---------- Chart ----------
        renderChart(daily, dataDates, start, end);
        $('chartRange').textContent = rangeLabel;
    } catch (e) {
        console.error(e);
        $('alerts').innerHTML = alertBox('error', 'fa-circle-exclamation', '<b>Laporan gagal dimuat.</b> Periksa koneksi lalu coba lagi.');
        $('summaryCards').innerHTML = '';
        $('reportTable').innerHTML = `<tr><td colspan="6" class="text-center py-10 text-slate-400">Gagal memuat data.</td></tr>`;
    } finally {
        setBusy(false);
    }
};

function renderChart(daily, dataDates, start, end) {
    const ctx = $('reportChart');
    if (!ctx || typeof Chart === 'undefined') return;

    // Isi tanggal kosong supaya tren tidak "melompat"
    let labels = dataDates;
    if (start && end) {
        const days = Math.round((parseKey(end) - parseKey(start)) / 86400000) + 1;
        if (days > 0 && days <= MAX_FILL_DAYS) {
            labels = Array.from({ length: days }, (_, i) => toKey(addDays(parseKey(start), i)));
        }
    }

    const empty = dataDates.length === 0;
    $('chartEmpty').classList.toggle('hidden', !empty);
    ctx.classList.toggle('invisible', empty);

    const omzet = labels.map((d) => daily[d]?.omzet || 0);
    const profit = labels.map((d) => (daily[d] ? daily[d].omzet - daily[d].hpp : 0));
    const trx = labels.map((d) => daily[d]?.count || 0);

    if (myChart) myChart.destroy();
    myChart = new Chart(ctx, {
        data: {
            labels,
            datasets: [
                {
                    type: 'bar', label: 'Omzet', data: omzet, order: 2,
                    backgroundColor: 'rgba(255,107,53,.85)', hoverBackgroundColor: '#ff6b35',
                    borderRadius: 6, maxBarThickness: 36,
                },
                {
                    type: 'line', label: 'Profit', data: profit, order: 1,
                    borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,.12)', fill: true,
                    tension: 0.35, borderWidth: 2.5, pointRadius: labels.length > 31 ? 0 : 3,
                    pointHoverRadius: 5, pointBackgroundColor: '#10b981',
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 8, font: { family: 'Poppins', size: 11 } } },
                tooltip: {
                    backgroundColor: '#1e293b', padding: 10, cornerRadius: 10,
                    titleFont: { family: 'Poppins', size: 12 }, bodyFont: { family: 'Poppins', size: 11 },
                    callbacks: {
                        title: (items) => fmtTanggal(labels[items[0].dataIndex], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
                        label: (c) => ` ${c.dataset.label}: ${rupiah(c.parsed.y)}`,
                        afterBody: (items) => `\n ${trx[items[0].dataIndex]} transaksi`,
                    },
                },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        font: { family: 'Poppins', size: 10 }, color: '#94a3b8', maxRotation: 0, autoSkip: true, autoSkipPadding: 12,
                        callback: (v, i) => fmtTanggal(labels[i], { day: 'numeric', month: 'short' }),
                    },
                },
                y: {
                    beginAtZero: true,
                    grid: { color: '#f1f5f9' },
                    border: { display: false },
                    ticks: { font: { family: 'Poppins', size: 10 }, color: '#94a3b8', callback: (v) => rupiahShort(v) },
                },
            },
        },
    });
}

// ============================================================
//  Export CSV
// ============================================================
function exportCsv() {
    if (!lastRows.length) return;
    const header = ['Tanggal', 'Jumlah Transaksi', 'Omzet', 'HPP', 'Profit', 'Margin (%)'];
    const lines = lastRows.map((r) => [r.date, r.count, Math.round(r.omzet), Math.round(r.hpp), Math.round(r.profit), r.margin.toFixed(1)]);
    const csv = [header, ...lines].map((row) => row.join(';')).join('\n'); // ';' agar rapi di Excel Indonesia
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `laporan-chimchum_${lastRange.start || 'awal'}_${lastRange.end || 'akhir'}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
}

// ============================================================
//  Preset tanggal & init
// ============================================================
function presetRange(name) {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    switch (name) {
        case 'today': return [t, t];
        case '7d': return [addDays(t, -6), t];
        case '30d': return [addDays(t, -29), t];
        case 'lastmonth': return [new Date(t.getFullYear(), t.getMonth() - 1, 1), new Date(t.getFullYear(), t.getMonth(), 0)];
        case 'month':
        default: return [new Date(t.getFullYear(), t.getMonth(), 1), t];
    }
}

function setActivePreset(name) {
    document.querySelectorAll('#presetGroup [data-preset]').forEach((b) => {
        b.classList.toggle('active', b.dataset.preset === name);
    });
}

function applyPreset(name) {
    const [s, e] = presetRange(name);
    $('tglMulai').value = toKey(s);
    $('tglAkhir').value = toKey(e);
    setActivePreset(name);
    renderReport();
}

document.querySelectorAll('#presetGroup [data-preset]').forEach((b) => {
    b.addEventListener('click', () => applyPreset(b.dataset.preset));
});
['tglMulai', 'tglAkhir'].forEach((id) => {
    $(id).addEventListener('change', () => {
        setActivePreset(null);
        if ($('tglMulai').value && $('tglAkhir').value) renderReport();
    });
});
$('btnExport').addEventListener('click', exportCsv);

applyPreset('month');
