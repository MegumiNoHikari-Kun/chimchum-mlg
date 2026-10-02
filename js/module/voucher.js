import { supabase, authReady } from '../supabase.js';

/* ================= STATE ================= */

let cachedVouchers = [];

/* ================= HELPER ================= */

function rupiah(value) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency', currency: 'IDR', minimumFractionDigits: 0
    }).format(Number(value) || 0);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatTanggal(value) {
    if (!value) return '∞';
    return new Date(value).toLocaleString('id-ID', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

// ISO (UTC) -> format "YYYY-MM-DDTHH:mm" untuk <input type="datetime-local">
function toLocalInput(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// nilai input -> ISO, atau null jika kosong
function fromLocalInput(value) {
    return value ? new Date(value).toISOString() : null;
}

function numOrNull(value) {
    const s = String(value ?? '').trim();
    return s === '' ? null : Number(s);
}

function $(id) { return document.getElementById(id); }

function getVoucherStatus(v) {
    const now = new Date();
    if (!v.is_active) return { label: 'Nonaktif', color: '#64748b' };
    if (v.end_at && new Date(v.end_at) < now) return { label: 'Kedaluwarsa', color: '#dc2626' };
    if (v.start_at && new Date(v.start_at) > now) return { label: 'Belum mulai', color: '#d97706' };
    if (v.quota !== null && v.used_count >= v.quota) return { label: 'Kuota habis', color: '#dc2626' };
    return { label: 'Aktif', color: '#059669' };
}


/* ================= READ ================= */

window.loadVouchers = async function () {
    try {
        await authReady;
        if (!supabase) throw new Error('Supabase tidak tersedia.');

        const { data, error } = await supabase
            .from('vouchers')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        cachedVouchers = data || [];
        renderVouchers();
    } catch (error) {
        console.error('❌ Error load voucher:', error);
        $('voucherTableBody').innerHTML = `
            <tr><td colspan="7" style="text-align:center;color:#dc2626;padding:30px;">
                Gagal memuat voucher: ${escapeHtml(error?.message || error)}
            </td></tr>`;
    }
};

function renderVouchers() {
    const tbody = $('voucherTableBody');

    if (cachedVouchers.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#aaa;padding:35px;">Belum ada voucher.</td></tr>`;
        return;
    }

    tbody.innerHTML = cachedVouchers.map(v => {
        const status = getVoucherStatus(v);

        const diskonText = v.discount_type === 'percent'
            ? `${Number(v.discount_value)}%` +
              (v.max_discount ? `<br><small style="color:#777;">maks ${rupiah(v.max_discount)}</small>` : '')
            : rupiah(v.discount_value);

        const pemakaian = `${v.used_count}${v.quota !== null ? ` / ${v.quota}` : ' / ∞'}`;
        const safeId = JSON.stringify(v.id);

        return `
            <tr>
                <td>
                    <strong>${escapeHtml(v.code)}</strong>
                    ${v.description ? `<br><small style="color:#777;">${escapeHtml(v.description)}</small>` : ''}
                </td>
                <td>${diskonText}</td>
                <td>${rupiah(v.min_purchase)}</td>
                <td>${pemakaian}</td>
                <td style="font-size:12px;">
                    ${escapeHtml(formatTanggal(v.start_at))}<br>s/d ${escapeHtml(formatTanggal(v.end_at))}
                </td>
                <td><span class="v-badge" style="background:${status.color};">${status.label}</span></td>
                <td style="white-space:nowrap;">
                    <button type="button" class="v-btn" onclick='editVoucher(${safeId})' title="Edit">✏️</button>
                    <button type="button" class="v-btn" onclick='toggleVoucherActive(${safeId})' title="Aktif / nonaktifkan">
                        ${v.is_active ? '⏸️' : '▶️'}
                    </button>
                    <button type="button" class="v-btn v-btn--danger" onclick='deleteVoucher(${safeId})' title="Hapus">🗑️</button>
                </td>
            </tr>
        `;
    }).join('');
}


/* ================= FORM ================= */

window.onVoucherTypeChange = function () {
    const isPercent = $('vType').value === 'percent';
    $('vValueLabel').textContent = isPercent ? 'Nilai Diskon (%) *' : 'Nilai Diskon (Rp) *';
    $('vMaxWrap').style.display = isPercent ? 'block' : 'none';
    if (!isPercent) $('vMax').value = '';
};

window.resetVoucherForm = function () {
    $('vId').value = '';
    $('vCode').value = '';
    $('vCode').disabled = false;
    $('vDesc').value = '';
    $('vType').value = 'percent';
    $('vValue').value = '';
    $('vMax').value = '';
    $('vMin').value = '0';
    $('vQuota').value = '';
    $('vStart').value = '';
    $('vEnd').value = '';
    $('vActive').checked = true;

    $('voucherFormTitle').innerHTML = '<i class="fa-solid fa-ticket"></i> Tambah Voucher';
    $('btnCancelEdit').style.display = 'none';
    window.onVoucherTypeChange();
};

function readForm() {
    const code = $('vCode').value.trim().toUpperCase();
    const type = $('vType').value;
    const value = Number($('vValue').value);
    const min = Number($('vMin').value) || 0;
    const quota = numOrNull($('vQuota').value);
    const max = type === 'percent' ? numOrNull($('vMax').value) : null;
    const startAt = fromLocalInput($('vStart').value);
    const endAt = fromLocalInput($('vEnd').value);

    if (!code) throw new Error('Kode voucher wajib diisi.');
    if (!/^[A-Z0-9_-]+$/.test(code)) throw new Error('Kode hanya boleh huruf, angka, "-" dan "_" (tanpa spasi).');
    if (!(value > 0)) throw new Error('Nilai diskon harus lebih dari 0.');
    if (type === 'percent' && value > 100) throw new Error('Diskon persen tidak boleh lebih dari 100.');
    if (min < 0) throw new Error('Minimal belanja tidak boleh negatif.');
    if (quota !== null && quota < 1) throw new Error('Kuota minimal 1 (atau kosongkan untuk tanpa batas).');
    if (startAt && endAt && new Date(endAt) <= new Date(startAt)) {
        throw new Error('Tanggal berakhir harus setelah tanggal mulai.');
    }

    return {
        code,
        description: $('vDesc').value.trim() || null,
        discount_type: type,
        discount_value: value,
        max_discount: max,
        min_purchase: min,
        quota,
        start_at: startAt,
        end_at: endAt,
        is_active: $('vActive').checked
    };
}


/* ================= CREATE / UPDATE ================= */

window.saveVoucher = async function () {
    const btn = $('btnSaveVoucher');

    try {
        const payload = readForm();
        const id = $('vId').value;

        btn.disabled = true;
        await authReady;
        if (!supabase) throw new Error('Supabase tidak tersedia.');

        if (id) {
            // jangan ubah used_count / created_at dari form
            const { error } = await supabase.from('vouchers').update(payload).eq('id', id);
            if (error) throw error;
        } else {
            const { error } = await supabase.from('vouchers').insert(payload);
            if (error) throw error;
        }

        alert(id ? 'Voucher berhasil diperbarui.' : 'Voucher berhasil ditambahkan.');
        window.resetVoucherForm();
        await window.loadVouchers();

    } catch (error) {
        console.error('❌ Error simpan voucher:', error);
        // 23505 = unique violation (kode sudah ada)
        if (error?.code === '23505') {
            alert('Kode voucher sudah dipakai. Gunakan kode lain.');
        } else {
            alert('Gagal menyimpan voucher: ' + (error?.message || error));
        }
    } finally {
        btn.disabled = false;
    }
};


/* ================= EDIT (isi form) ================= */

window.editVoucher = function (id) {
    const v = cachedVouchers.find(x => String(x.id) === String(id));
    if (!v) return;

    $('vId').value = v.id;
    $('vCode').value = v.code;
    $('vDesc').value = v.description ?? '';
    $('vType').value = v.discount_type;
    $('vValue').value = v.discount_value;
    $('vMax').value = v.max_discount ?? '';
    $('vMin').value = v.min_purchase ?? 0;
    $('vQuota').value = v.quota ?? '';
    $('vStart').value = toLocalInput(v.start_at);
    $('vEnd').value = toLocalInput(v.end_at);
    $('vActive').checked = !!v.is_active;

    // Kode tidak diubah saat edit, karena sudah tercatat di order lama
    $('vCode').disabled = true;

    $('voucherFormTitle').innerHTML = `<i class="fa-solid fa-pen"></i> Edit Voucher: ${escapeHtml(v.code)}`;
    $('btnCancelEdit').style.display = 'inline-block';
    window.onVoucherTypeChange();

    window.scrollTo({ top: 0, behavior: 'smooth' });
};


/* ================= TOGGLE AKTIF ================= */

window.toggleVoucherActive = async function (id) {
    const v = cachedVouchers.find(x => String(x.id) === String(id));
    if (!v) return;

    try {
        await authReady;
        const { error } = await supabase
            .from('vouchers')
            .update({ is_active: !v.is_active })
            .eq('id', id);

        if (error) throw error;
        await window.loadVouchers();
    } catch (error) {
        console.error('❌ Error toggle voucher:', error);
        alert('Gagal mengubah status: ' + (error?.message || error));
    }
};


/* ================= DELETE ================= */

window.deleteVoucher = async function (id) {
    const v = cachedVouchers.find(x => String(x.id) === String(id));
    if (!v) return;

    if (!confirm(`Hapus voucher ${v.code}?\nOrder lama yang memakai voucher ini tidak terpengaruh.`)) return;

    try {
        await authReady;
        const { error } = await supabase.from('vouchers').delete().eq('id', id);
        if (error) throw error;

        if ($('vId').value === String(id)) window.resetVoucherForm();
        await window.loadVouchers();
    } catch (error) {
        console.error('❌ Error hapus voucher:', error);
        alert('Gagal menghapus voucher: ' + (error?.message || error));
    }
};


/* ================= START ================= */

window.resetVoucherForm();
window.loadVouchers();
