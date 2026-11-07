import { supabase, authReady } from '../supabase.js';

/* =========================================================
   KONFIGURASI
   ========================================================= */

const SOON_MS = 3 * 24 * 60 * 60 * 1000;   // "segera berakhir" = ≤ 3 hari
const QUOTA_WARN = 0.8;                    // kuota terpakai ≥ 80% = perlu perhatian

const FILTERS = [
    ['all', 'Semua'],
    ['active', 'Aktif'],
    ['attention', 'Perlu perhatian'],
    ['scheduled', 'Belum mulai'],
    ['inactive', 'Nonaktif'],
    ['expired', 'Kedaluwarsa'],
    ['depleted', 'Kuota habis']
];

const store = {
    get(key, fallback) {
        try { return localStorage.getItem('voucher.' + key) ?? fallback; } catch { return fallback; }
    },
    set(key, value) {
        try { localStorage.setItem('voucher.' + key, value); } catch { /* abaikan */ }
    }
};

/* =========================================================
   STATE
   ========================================================= */

const state = {
    vouchers: [],
    loading: true,
    error: null,
    q: '',
    filter: 'all',
    sort: store.get('sort', 'newest'),
    page: 1,
    perPage: Number(store.get('perPage', 25)) || 25,
    editingId: null,
    editingUsed: 0,
    snapshot: '',
    saving: false,
    busy: new Set(),
    lastFocus: null
};

/* =========================================================
   HELPER
   ========================================================= */

const $ = id => document.getElementById(id);

function rupiah(value) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0
    }).format(Math.round(Number(value) || 0));
}

const fmtNum = n => Number(n || 0).toLocaleString('id-ID');
const fmtPct = n => Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 });

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatTanggal(value, fallback = '∞') {
    if (!value) return fallback;
    return new Date(value).toLocaleString('id-ID', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

const pad = n => String(n).padStart(2, '0');

// ISO / Date -> "YYYY-MM-DDTHH:mm" untuk <input type="datetime-local">
function toLocalInput(value) {
    if (!value) return '';
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d)) return '';
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value) {
    return value ? new Date(value).toISOString() : null;
}

// "20.000" -> 20000 ; "" -> null
function parseMoney(str) {
    const d = String(str ?? '').replace(/\D/g, '');
    return d === '' ? null : Number(d);
}

function durasi(ms) {
    const m = Math.max(1, Math.round(ms / 60000));
    if (m < 60) return `${m} menit`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} jam`;
    return `${Math.round(h / 24)} hari`;
}

function getVoucherStatus(v, now = Date.now()) {
    const end = v.end_at ? new Date(v.end_at).getTime() : null;
    const start = v.start_at ? new Date(v.start_at).getTime() : null;
    const used = Number(v.used_count) || 0;
    const quota = v.quota == null ? null : Number(v.quota);

    if (!v.is_active) return { key: 'inactive', label: 'Nonaktif', tone: 'idle' };
    if (end !== null && end < now) return { key: 'expired', label: 'Kedaluwarsa', tone: 'bad' };
    if (start !== null && start > now) return { key: 'scheduled', label: 'Belum mulai', tone: 'info', hint: `Mulai ${durasi(start - now)} lagi` };
    if (quota !== null && used >= quota) return { key: 'depleted', label: 'Kuota habis', tone: 'bad' };

    const st = { key: 'active', label: 'Aktif', tone: 'ok' };
    if (end !== null && end - now <= SOON_MS) {
        st.attention = true;
        st.hint = `Berakhir ${durasi(end - now)} lagi`;
    } else if (quota && used / quota >= QUOTA_WARN) {
        st.attention = true;
        st.hint = `Sisa kuota ${fmtNum(quota - used)}`;
    }
    return st;
}

function discountLabel(v) {
    return v.discount_type === 'percent'
        ? `${fmtPct(v.discount_value)}%`
        : rupiah(v.discount_value);
}

const findVoucher = id => state.vouchers.find(x => String(x.id) === String(id));

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch { /* abaikan */ }
        ta.remove();
    }
}

/* =========================================================
   TOAST & KONFIRMASI (pengganti alert / confirm)
   ========================================================= */

function toast(message, type = 'success', opts = {}) {
    const icons = { success: 'fa-circle-check', error: 'fa-circle-exclamation', info: 'fa-circle-info' };
    const el = document.createElement('div');
    el.className = `v-toast v-toast--${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><span>${escapeHtml(message)}</span>`;

    const close = () => {
        if (el.classList.contains('is-out')) return;
        el.classList.add('is-out');
        setTimeout(() => el.remove(), 200);
    };

    if (opts.actionLabel && typeof opts.onAction === 'function') {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = opts.actionLabel;
        btn.addEventListener('click', () => { close(); opts.onAction(); });
        el.appendChild(btn);
    }

    $('vToasts').appendChild(el);
    setTimeout(close, opts.duration ?? (type === 'error' ? 6000 : 3800));
}

let confirmResolver = null;

function confirmDialog({ title, message = '', okText = 'Ya', cancelText = 'Batal', danger = true, icon = 'fa-triangle-exclamation' }) {
    $('vConfirmTitle').textContent = title;
    $('vConfirmMsg').textContent = message;
    $('vConfirmOk').textContent = okText;
    $('vConfirmOk').className = danger ? 'v-btn-danger' : 'v-btn-primary';
    $('vConfirmCancel').textContent = cancelText;
    $('vConfirmIcon').innerHTML = `<i class="fa-solid ${icon}"></i>`;
    $('vConfirmIcon').style.background = danger ? '' : 'var(--brand-50)';
    $('vConfirmIcon').style.color = danger ? '' : 'var(--brand)';

    const box = $('vConfirm');
    box.classList.add('open');
    box.setAttribute('aria-hidden', 'false');
    setTimeout(() => $('vConfirmCancel').focus(), 30);

    return new Promise(resolve => { confirmResolver = resolve; });
}

function closeConfirm(result) {
    const box = $('vConfirm');
    box.classList.remove('open');
    box.setAttribute('aria-hidden', 'true');
    if (confirmResolver) { confirmResolver(result); confirmResolver = null; }
}

const isConfirmOpen = () => $('vConfirm').classList.contains('open');

/* =========================================================
   READ
   ========================================================= */

async function loadVouchers({ silent = false } = {}) {
    const icon = $('vRefresh').querySelector('i');
    icon.classList.add('fa-spin-fast');

    if (!silent) {
        state.loading = true;
        state.error = null;
        render();
    }

    try {
        await authReady;
        if (!supabase) throw new Error('Supabase tidak tersedia.');

        const { data, error } = await supabase
            .from('vouchers')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        state.vouchers = data || [];
        state.error = null;
    } catch (error) {
        console.error('❌ Error load voucher:', error);
        state.error = error?.message || String(error);
        if (silent) toast('Gagal memuat ulang voucher: ' + state.error, 'error');
    } finally {
        state.loading = false;
        icon.classList.remove('fa-spin-fast');
        render();
    }
}

// tetap tersedia global (kompatibel dengan kode lama)
window.loadVouchers = () => loadVouchers({ silent: state.vouchers.length > 0 });

/* =========================================================
   RENDER
   ========================================================= */

function render() {
    renderStats();
    renderFilters();
    renderTable();
}

function computeAll() {
    const now = Date.now();
    return state.vouchers.map(v => ({ v, st: getVoucherStatus(v, now) }));
}

function renderStats() {
    const all = computeAll();
    const dash = state.loading && !state.vouchers.length;
    const n = x => dash ? '–' : fmtNum(x);

    const cards = [
        { filter: 'all', icon: 'fa-ticket', bg: 'var(--brand-50)', fg: 'var(--brand-600)', num: n(all.length), lbl: 'Total voucher' },
        { filter: 'active', icon: 'fa-circle-check', bg: 'var(--ok-bg)', fg: 'var(--ok)', num: n(all.filter(x => x.st.key === 'active').length), lbl: 'Aktif sekarang' },
        { filter: 'attention', icon: 'fa-bell', bg: 'var(--warn-bg)', fg: 'var(--warn)', num: n(all.filter(x => x.st.attention).length), lbl: 'Perlu perhatian' },
        { filter: 'usage', icon: 'fa-chart-simple', bg: 'var(--info-bg)', fg: 'var(--info)', num: n(all.reduce((s, x) => s + (Number(x.v.used_count) || 0), 0)), lbl: 'Total pemakaian' }
    ];

    $('vStats').innerHTML = cards.map(c => {
        const on = c.filter !== 'usage' && c.filter !== 'all' && state.filter === c.filter;
        const title = c.filter === 'usage' ? 'Urutkan berdasarkan pemakaian terbanyak' : `Tampilkan: ${c.lbl}`;
        return `
            <button type="button" class="v-stat ${on ? 'is-on' : ''}" data-filter="${c.filter}" title="${title}">
                <span class="v-stat__icon" style="background:${c.bg};color:${c.fg};"><i class="fa-solid ${c.icon}"></i></span>
                <span><span class="v-stat__num">${c.num}</span><br><span class="v-stat__lbl">${c.lbl}</span></span>
            </button>`;
    }).join('');
}

function renderFilters() {
    const all = computeAll();
    const count = key => key === 'all' ? all.length
        : key === 'attention' ? all.filter(x => x.st.attention).length
        : all.filter(x => x.st.key === key).length;

    $('vFilters').innerHTML = FILTERS.map(([key, label]) => {
        const c = count(key);
        if (c === 0 && key !== 'all' && key !== state.filter) return '';
        const on = state.filter === key;
        return `<button type="button" class="v-chip ${on ? 'is-on' : ''}" data-filter="${key}" aria-pressed="${on}">
                    ${label} <b>${c}</b>
                </button>`;
    }).join('');
}

function getView() {
    const q = state.q.toLowerCase();
    let list = computeAll();

    if (state.filter === 'attention') list = list.filter(x => x.st.attention);
    else if (state.filter !== 'all') list = list.filter(x => x.st.key === state.filter);

    if (q) {
        list = list.filter(({ v, st }) =>
            [v.code, v.description, st.label, discountLabel(v)]
                .some(s => String(s ?? '').toLowerCase().includes(q))
        );
    }

    const time = s => s ? new Date(s).getTime() : 0;
    const sorters = {
        newest: (a, b) => time(b.v.created_at) - time(a.v.created_at),
        oldest: (a, b) => time(a.v.created_at) - time(b.v.created_at),
        code: (a, b) => String(a.v.code).localeCompare(String(b.v.code), 'id'),
        usage: (a, b) => (Number(b.v.used_count) || 0) - (Number(a.v.used_count) || 0),
        ending: (a, b) => (a.v.end_at ? time(a.v.end_at) : Infinity) - (b.v.end_at ? time(b.v.end_at) : Infinity)
    };
    list.sort(sorters[state.sort] || sorters.newest);

    const pages = Math.max(1, Math.ceil(list.length / state.perPage));
    state.page = Math.min(Math.max(1, state.page), pages);
    const start = (state.page - 1) * state.perPage;

    return { list, pages, start, rows: list.slice(start, start + state.perPage) };
}

function emptyRow({ icon, title, text, btn, err }) {
    return `<tr><td colspan="7" class="v-empty ${err ? 'v-empty--err' : ''}">
        <div class="v-empty__icon"><i class="fa-solid ${icon}"></i></div>
        <h4>${title}</h4>
        <p>${text}</p>
        ${btn || ''}
    </td></tr>`;
}

function renderTable() {
    const tbody = $('voucherTableBody');
    const total = state.vouchers.length;
    $('vCount').textContent = `${fmtNum(total)} voucher`;

    if (state.loading && !total) {
        const sk = w => `<div class="v-skel" style="width:${w}%"></div>`;
        tbody.innerHTML = Array.from({ length: 6 }, () => `
            <tr><td>${sk(70)}</td><td>${sk(50)}</td><td>${sk(60)}</td><td>${sk(80)}</td><td>${sk(90)}</td><td>${sk(55)}</td><td>${sk(80)}</td></tr>
        `).join('');
        updatePager({ list: [], pages: 1, start: 0 });
        return;
    }

    if (state.error && !total) {
        tbody.innerHTML = emptyRow({
            err: true, icon: 'fa-plug-circle-xmark', title: 'Gagal memuat voucher',
            text: escapeHtml(state.error),
            btn: `<button type="button" class="v-btn-ghost" data-act="retry"><i class="fa-solid fa-rotate-right"></i> Coba lagi</button>`
        });
        updatePager({ list: [], pages: 1, start: 0 });
        return;
    }

    if (!total) {
        tbody.innerHTML = emptyRow({
            icon: 'fa-ticket', title: 'Belum ada voucher',
            text: 'Buat voucher pertama untuk memberi diskon ke pelanggan.',
            btn: `<button type="button" class="v-btn-primary" data-act="new"><i class="fa-solid fa-plus"></i> Buat Voucher</button>`
        });
        updatePager({ list: [], pages: 1, start: 0 });
        return;
    }

    const view = getView();

    if (!view.list.length) {
        tbody.innerHTML = emptyRow({
            icon: 'fa-magnifying-glass', title: 'Tidak ada yang cocok',
            text: state.q ? `Tidak ada voucher untuk “${escapeHtml(state.q)}” pada filter ini.` : 'Tidak ada voucher pada filter ini.',
            btn: `<button type="button" class="v-btn-ghost" data-act="reset"><i class="fa-solid fa-filter-circle-xmark"></i> Reset pencarian &amp; filter</button>`
        });
    } else {
        tbody.innerHTML = view.rows.map(({ v, st }) => rowHtml(v, st)).join('');
    }

    updatePager(view);
}

function rowHtml(v, st) {
    const id = escapeHtml(String(v.id));
    const used = Number(v.used_count) || 0;
    const quota = v.quota == null ? null : Number(v.quota);
    const pct = quota ? Math.min(100, Math.round(used / quota * 100)) : 0;
    const barTone = pct >= 100 ? 'bad' : pct >= QUOTA_WARN * 100 ? 'warn' : '';
    const busy = state.busy.has(String(v.id));

    const disc = v.discount_type === 'percent'
        ? `<strong>${fmtPct(v.discount_value)}%</strong><small>${v.max_discount ? `maks ${rupiah(v.max_discount)}` : 'tanpa batas maks.'}</small>`
        : `<strong>${rupiah(v.discount_value)}</strong><small>potongan langsung</small>`;

    const usage = quota !== null
        ? `<div class="v-usage__txt"><b>${fmtNum(used)}</b> / ${fmtNum(quota)}</div>
           <div class="v-bar" title="${pct}% terpakai"><i class="${barTone}" style="width:${pct}%"></i></div>`
        : `<div class="v-usage__txt"><b>${fmtNum(used)}</b> × dipakai</div><small>kuota tanpa batas</small>`;

    return `
        <tr class="v-row ${v.is_active ? '' : 'is-off'}">
            <td class="v-td-code" data-label="Kode">
                <span class="v-code">
                    <strong>${escapeHtml(v.code)}</strong>
                    <button type="button" class="v-copy" data-act="copy" data-id="${id}" title="Salin kode" aria-label="Salin kode ${escapeHtml(v.code)}"><i class="fa-regular fa-copy"></i></button>
                </span>
                ${v.description ? `<small class="v-desc" title="${escapeHtml(v.description)}">${escapeHtml(v.description)}</small>` : ''}
            </td>
            <td class="v-disc" data-label="Diskon">${disc}</td>
            <td data-label="Min. belanja">${Number(v.min_purchase) > 0 ? rupiah(v.min_purchase) : '<span class="v-muted">Tanpa minimal</span>'}</td>
            <td class="v-usage" data-label="Pemakaian">${usage}</td>
            <td data-label="Periode" style="font-size:12px;">
                ${escapeHtml(formatTanggal(v.start_at, 'Langsung berlaku'))}
                <small>s/d ${escapeHtml(formatTanggal(v.end_at, 'tanpa batas'))}</small>
            </td>
            <td data-label="Status">
                <span class="v-badge v-badge--${st.attention ? 'warn' : st.tone}">${st.label}</span>
                ${st.hint ? `<small class="${st.attention ? 'v-hint-warn' : ''}">${st.hint}</small>` : ''}
            </td>
            <td class="v-td-act">
                <span class="v-acts">
                    <label class="v-switch" title="${v.is_active ? 'Nonaktifkan' : 'Aktifkan'} voucher">
                        <input type="checkbox" data-act="toggle" data-id="${id}" ${v.is_active ? 'checked' : ''} ${busy ? 'disabled' : ''} aria-label="Aktif / nonaktifkan ${escapeHtml(v.code)}">
                        <span></span>
                    </label>
                    <span>
                        <button type="button" class="v-ibtn" data-act="edit" data-id="${id}" title="Edit"><i class="fa-solid fa-pen"></i></button>
                        <button type="button" class="v-ibtn" data-act="dup" data-id="${id}" title="Duplikat"><i class="fa-regular fa-clone"></i></button>
                        <button type="button" class="v-ibtn v-ibtn--danger" data-act="del" data-id="${id}" title="Hapus"><i class="fa-solid fa-trash-can"></i></button>
                    </span>
                </span>
            </td>
        </tr>`;
}

function updatePager({ list, pages, start }) {
    const n = list.length;
    $('vPagerInfo').textContent = n
        ? `${fmtNum(start + 1)}–${fmtNum(Math.min(start + state.perPage, n))} dari ${fmtNum(n)} voucher`
        : (state.vouchers.length ? 'Tidak ada hasil' : (state.loading ? 'Memuat...' : 'Belum ada voucher'));

    const p = state.page;
    const nums = new Set([1, pages, p - 1, p, p + 1].filter(x => x >= 1 && x <= pages));
    const sorted = [...nums].sort((a, b) => a - b);

    let html = `<button type="button" data-page="${p - 1}" ${p <= 1 ? 'disabled' : ''} aria-label="Sebelumnya"><i class="fa-solid fa-chevron-left"></i></button>`;
    sorted.forEach((x, i) => {
        if (i > 0 && x - sorted[i - 1] > 1) html += `<span class="v-pager__gap">…</span>`;
        html += `<button type="button" data-page="${x}" class="${x === p ? 'is-on' : ''}" ${x === p ? 'aria-current="page"' : ''}>${x}</button>`;
    });
    html += `<button type="button" data-page="${p + 1}" ${p >= pages ? 'disabled' : ''} aria-label="Berikutnya"><i class="fa-solid fa-chevron-right"></i></button>`;
    $('vPagerNav').innerHTML = html;
}

/* =========================================================
   FORM: input helper
   ========================================================= */

const currentType = () => document.querySelector('input[name="vType"]:checked')?.value || 'percent';

function bindMoney(el) {
    el.addEventListener('input', () => {
        if (el.dataset.mode === 'plain') return;
        const pos = el.selectionStart ?? el.value.length;
        const digitsBefore = el.value.slice(0, pos).replace(/\D/g, '').length;
        const d = el.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 13);
        el.value = d ? Number(d).toLocaleString('id-ID') : '';
        let i = 0, count = 0;
        while (i < el.value.length && count < digitsBefore) { if (/\d/.test(el.value[i])) count++; i++; }
        try { el.setSelectionRange(i, i); } catch { /* abaikan */ }
    });
}

function getValue() {
    const el = $('vValue');
    if (el.dataset.mode === 'plain') {
        const s = el.value.trim().replace(',', '.');
        return s === '' ? null : Number(s);
    }
    return parseMoney(el.value);
}

function setValue(n) {
    const el = $('vValue');
    if (n == null || n === '' || isNaN(n)) { el.value = ''; return; }
    el.value = el.dataset.mode === 'plain' ? String(Number(n)).replace('.', ',') : fmtNum(Math.round(n));
}

function setType(type) {
    const prev = getValue();
    const isPercent = type === 'percent';
    document.querySelectorAll('input[name="vType"]').forEach(r => { r.checked = r.value === type; });

    const el = $('vValue');
    el.dataset.mode = isPercent ? 'plain' : 'money';
    el.inputMode = isPercent ? 'decimal' : 'numeric';
    el.placeholder = isPercent ? '10' : '10.000';
    $('vValuePre').hidden = isPercent;
    $('vValueSuf').hidden = !isPercent;
    $('vMaxWrap').hidden = !isPercent;
    if (!isPercent) $('vMax').value = '';
    setValue(prev);
}

function sanitizeCode(s) {
    return String(s).toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9_-]/g, '');
}

function generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const rand = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    const val = getValue();
    let prefix = 'CHIM';
    if (val > 0) {
        prefix = currentType() === 'percent'
            ? `DISKON${Math.round(val)}`
            : `HEMAT${val >= 1000 ? Math.round(val / 1000) + 'K' : val}`;
    }
    return `${prefix}-${rand}`;
}

function serializeForm() {
    return JSON.stringify(['vCode', 'vDesc', 'vValue', 'vMax', 'vMin', 'vQuota', 'vStart', 'vEnd']
        .map(id => $(id).value).concat(currentType(), $('vActive').checked));
}

function applyPreset(preset) {
    const now = new Date();
    now.setSeconds(0, 0);

    if (preset === 'now') {
        $('vStart').value = toLocalInput(now);
    } else if (preset === 'none') {
        $('vEnd').value = '';
    } else {
        const base = $('vStart').value ? new Date($('vStart').value) : now;
        let end;
        if (preset === 'eom') {
            end = new Date(base.getFullYear(), base.getMonth() + 1, 0, 23, 59);
        } else {
            end = new Date(base);
            end.setDate(end.getDate() + Number(preset));
            end.setHours(23, 59, 0, 0);
        }
        $('vEnd').value = toLocalInput(end);
    }
    clearError('vEnd');
    updatePreview();
}

/* =========================================================
   FORM: validasi
   ========================================================= */

function readForm() {
    const errors = {};
    const code = sanitizeCode($('vCode').value.trim());
    const type = currentType();
    const value = getValue();
    const max = type === 'percent' ? parseMoney($('vMax').value) : null;
    const min = parseMoney($('vMin').value) ?? 0;
    const quotaRaw = $('vQuota').value.trim();
    const quota = quotaRaw === '' ? null : Number(quotaRaw);
    const startAt = fromLocalInput($('vStart').value);
    const endAt = fromLocalInput($('vEnd').value);

    if (!code) errors.vCode = 'Kode voucher wajib diisi.';
    else if (code.length < 3) errors.vCode = 'Kode minimal 3 karakter.';

    if (value == null || isNaN(value) || !(value > 0)) errors.vValue = 'Nilai diskon harus lebih dari 0.';
    else if (type === 'percent' && value > 100) errors.vValue = 'Diskon persen maksimal 100%.';

    if (max !== null && max <= 0) errors.vMax = 'Isi lebih dari 0, atau kosongkan.';

    if (quota !== null && !(Number.isInteger(quota) && quota >= 1)) {
        errors.vQuota = 'Kuota minimal 1 (bilangan bulat), atau kosongkan.';
    } else if (quota !== null && state.editingId && quota < state.editingUsed) {
        errors.vQuota = `Sudah dipakai ${fmtNum(state.editingUsed)}×, kuota tidak boleh lebih kecil.`;
    }

    if (startAt && endAt && new Date(endAt) <= new Date(startAt)) {
        errors.vEnd = 'Tanggal berakhir harus setelah tanggal mulai.';
    } else if (!state.editingId && endAt && new Date(endAt) < new Date()) {
        errors.vEnd = 'Tanggal berakhir sudah lewat.';
    }

    return {
        errors,
        payload: {
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
        }
    };
}

function fieldOf(id) {
    return document.querySelector(`[data-err-for="${id}"]`)?.closest('.v-field');
}

function clearError(id) {
    const f = fieldOf(id);
    if (f) f.classList.remove('is-invalid');
}

function clearErrors() {
    document.querySelectorAll('#vForm .v-field.is-invalid').forEach(f => f.classList.remove('is-invalid'));
}

function showErrors(errors) {
    const ids = Object.keys(errors);
    ids.forEach(id => {
        const el = document.querySelector(`[data-err-for="${id}"]`);
        if (!el) return;
        el.textContent = errors[id];
        el.closest('.v-field').classList.add('is-invalid');
    });
    if (ids[0]) {
        const input = $(ids[0]);
        input.focus();
        input.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    const box = document.querySelector('.v-modal__box');
    box.classList.remove('v-shake');
    void box.offsetWidth;
    box.classList.add('v-shake');
}

/* =========================================================
   FORM: pratinjau & simulasi
   ========================================================= */

function updatePreview() {
    const type = currentType();
    const isPercent = type === 'percent';
    const value = getValue();
    const max = isPercent ? parseMoney($('vMax').value) : null;
    const min = parseMoney($('vMin').value) ?? 0;
    const quotaRaw = $('vQuota').value.trim();
    const quota = quotaRaw === '' ? null : Number(quotaRaw);
    const start = $('vStart').value ? new Date($('vStart').value) : null;
    const end = $('vEnd').value ? new Date($('vEnd').value) : null;
    const code = sanitizeCode($('vCode').value) || 'KODE';
    const valid = value > 0 && !isNaN(value);

    $('pvCode').textContent = code;
    $('pvTitle').textContent = valid
        ? (isPercent ? `Diskon ${fmtPct(value)}%` : `Potongan ${rupiah(value)}`)
        : 'Diskon —';
    $('pvSub').textContent = $('vDesc').value.trim();

    const lines = [];
    if (isPercent) lines.push(['fa-arrow-down-up-lock', max ? `Maks. potongan ${rupiah(max)}` : 'Tanpa batas maksimal potongan']);
    lines.push(['fa-cart-shopping', min > 0 ? `Min. belanja ${rupiah(min)}` : 'Tanpa minimal belanja']);
    lines.push(['fa-users', quota ? `Kuota ${fmtNum(quota)}× pemakaian` : 'Kuota tanpa batas']);
    lines.push(['fa-calendar-days',
        `${start ? formatTanggal(start) : 'Langsung berlaku'} → ${end ? formatTanggal(end) : 'tanpa batas'}`]);
    $('pvLines').innerHTML = lines.map(([i, t]) => `<li><i class="fa-solid ${i}"></i><span>${escapeHtml(t)}</span></li>`).join('');

    const st = getVoucherStatus({
        is_active: $('vActive').checked,
        start_at: start, end_at: end, quota,
        used_count: state.editingId ? state.editingUsed : 0
    });
    $('pvStatus').innerHTML = `<span class="v-badge v-badge--${st.attention ? 'warn' : st.tone}">${st.label}</span>`;

    // Peringatan (tidak memblokir simpan)
    const warns = [];
    if (!isPercent && valid && min > 0 && value >= min) warns.push('Potongan ≥ minimal belanja — pelanggan bisa mendapat pesanan gratis.');
    if (!isPercent && valid && min === 0) warns.push('Tanpa minimal belanja: potongan bisa melebihi total pesanan kecil.');
    if (isPercent && valid && value >= 50 && !max) warns.push('Diskon besar tanpa batas maksimal. Pertimbangkan mengisi "Maks. potongan".');
    $('pvWarn').innerHTML = warns.map(w => `<div class="v-warn"><i class="fa-solid fa-lightbulb"></i><span>${escapeHtml(w)}</span></div>`).join('');

    // Simulasi
    const sub = parseMoney($('vSim').value) ?? 0;
    let sim;
    if (!valid || sub <= 0) {
        sim = `<div class="v-sim__note">Isi nilai diskon & contoh belanja untuk melihat hasil.</div>`;
    } else if (sub < min) {
        sim = `<div class="v-sim__note" style="color:var(--warn);"><i class="fa-solid fa-circle-info"></i> Belum memenuhi minimal belanja (kurang ${rupiah(min - sub)}).</div>`;
    } else {
        let disc = isPercent ? sub * value / 100 : value;
        if (isPercent && max) disc = Math.min(disc, max);
        disc = Math.round(Math.min(disc, sub));
        sim = `<div class="v-sim__res">
                <span class="v-muted">Subtotal</span><span>${rupiah(sub)}</span>
                <span class="v-muted">Potongan</span><span class="save">− ${rupiah(disc)}</span>
                <span class="tot">Bayar</span><span class="tot">${rupiah(sub - disc)}</span>
              </div>`;
    }
    $('pvSim').innerHTML = sim;
}

/* =========================================================
   MODAL: buka / tutup
   ========================================================= */

const isModalOpen = () => $('vModal').classList.contains('open');

function openForm(v = null, { duplicate = false } = {}) {
    state.lastFocus = document.activeElement;
    clearErrors();

    const editing = !!v && !duplicate;
    state.editingId = editing ? String(v.id) : null;
    state.editingUsed = editing ? (Number(v.used_count) || 0) : 0;

    const d = v || {};
    $('vCode').value = v ? (duplicate ? sanitizeCode(`${v.code}-COPY`) : v.code) : '';
    $('vDesc').value = d.description ?? '';
    setType(d.discount_type || 'percent');
    setValue(d.discount_value ?? null);
    $('vMax').value = d.max_discount ? fmtNum(d.max_discount) : '';
    $('vMin').value = Number(d.min_purchase) > 0 ? fmtNum(d.min_purchase) : '';
    $('vQuota').value = d.quota ?? '';
    $('vStart').value = duplicate ? '' : toLocalInput(d.start_at);
    $('vEnd').value = duplicate ? '' : toLocalInput(d.end_at);
    $('vActive').checked = v ? (duplicate ? true : !!v.is_active) : true;

    // Kode tidak diubah saat edit, karena sudah tercatat di order lama
    $('vCode').disabled = editing;
    $('vGen').disabled = editing;
    $('vCodeHint').textContent = editing
        ? 'Kode tidak bisa diubah karena mungkin sudah tercatat di transaksi.'
        : 'Huruf, angka, "-" dan "_". Spasi otomatis jadi "-".';
    $('vQuotaHint').textContent = editing && state.editingUsed > 0
        ? `Sudah dipakai ${fmtNum(state.editingUsed)}×. Kosongkan jika tanpa batas.`
        : 'Kosongkan jika tanpa batas.';

    const title = editing
        ? `<i class="fa-solid fa-pen"></i> Edit Voucher <span class="v-code"><strong>${escapeHtml(v.code)}</strong></span>`
        : duplicate
            ? `<i class="fa-regular fa-clone"></i> Duplikat dari <span class="v-code"><strong>${escapeHtml(v.code)}</strong></span>`
            : `<i class="fa-solid fa-ticket"></i> Tambah Voucher`;
    $('voucherFormTitle').innerHTML = title;
    $('btnSaveVoucher').querySelector('span').textContent = editing ? 'Simpan Perubahan' : 'Simpan Voucher';

    $('vModal').classList.add('open');
    $('vModal').setAttribute('aria-hidden', 'false');
    document.querySelector('.v-modal__body').scrollTop = 0;

    state.snapshot = serializeForm();
    updatePreview();

    setTimeout(() => {
        const target = editing ? $('vDesc') : $('vCode');
        target.focus();
        if (duplicate) target.select();
    }, 60);
}

async function closeForm(force = false) {
    if (!isModalOpen()) return;
    if (!force && !state.saving && serializeForm() !== state.snapshot) {
        const ok = await confirmDialog({
            title: 'Buang perubahan?',
            message: 'Perubahan pada form belum disimpan dan akan hilang.',
            okText: 'Buang perubahan',
            cancelText: 'Lanjut mengisi'
        });
        if (!ok) return;
    }
    $('vModal').classList.remove('open');
    $('vModal').setAttribute('aria-hidden', 'true');
    state.editingId = null;
    state.editingUsed = 0;
    if (state.lastFocus && document.contains(state.lastFocus)) state.lastFocus.focus();
}

/* =========================================================
   CREATE / UPDATE
   ========================================================= */

function setSaving(on) {
    state.saving = on;
    const btn = $('btnSaveVoucher');
    btn.disabled = on;
    btn.querySelector('i').className = on ? 'fa-solid fa-circle-notch fa-spin-fast' : 'fa-solid fa-floppy-disk';
    if (on) btn.querySelector('span').textContent = 'Menyimpan...';
    else btn.querySelector('span').textContent = state.editingId ? 'Simpan Perubahan' : 'Simpan Voucher';
}

async function saveVoucher() {
    if (state.saving) return;

    clearErrors();
    const { payload, errors } = readForm();
    if (Object.keys(errors).length) { showErrors(errors); return; }

    const editingId = state.editingId;
    setSaving(true);

    try {
        await authReady;
        if (!supabase) throw new Error('Supabase tidak tersedia.');

        if (editingId) {
            // jangan ubah code / used_count / created_at dari form
            const { code, ...update } = payload;
            const { error } = await supabase.from('vouchers').update(update).eq('id', editingId);
            if (error) throw error;
        } else {
            const { error } = await supabase.from('vouchers').insert(payload);
            if (error) throw error;
        }

        setSaving(false);
        await closeForm(true);
        toast(editingId ? `Voucher ${payload.code} diperbarui.` : `Voucher ${payload.code} berhasil dibuat.`, 'success', editingId ? {} : {
            actionLabel: 'Salin kode', onAction: () => copyText(payload.code).then(() => toast('Kode disalin.', 'info'))
        });
        state.page = editingId ? state.page : 1;
        await loadVouchers({ silent: true });

    } catch (error) {
        console.error('❌ Error simpan voucher:', error);
        // 23505 = unique violation (kode sudah ada)
        if (error?.code === '23505') {
            showErrors({ vCode: 'Kode ini sudah dipakai voucher lain. Gunakan kode lain.' });
        } else {
            toast('Gagal menyimpan voucher: ' + (error?.message || error), 'error');
        }
    } finally {
        if (state.saving) setSaving(false);
    }
}

/* =========================================================
   TOGGLE AKTIF (optimistic + urungkan)
   ========================================================= */

async function toggleVoucherActive(id) {
    const v = findVoucher(id);
    const key = String(id);
    if (!v || state.busy.has(key)) return;

    const next = !v.is_active;
    v.is_active = next;
    state.busy.add(key);
    render();

    try {
        await authReady;
        if (!supabase) throw new Error('Supabase tidak tersedia.');
        const { error } = await supabase.from('vouchers').update({ is_active: next }).eq('id', v.id);
        if (error) throw error;

        toast(`Voucher ${v.code} ${next ? 'diaktifkan' : 'dinonaktifkan'}.`, 'success', {
            actionLabel: 'Urungkan', onAction: () => toggleVoucherActive(id)
        });
    } catch (error) {
        console.error('❌ Error toggle voucher:', error);
        v.is_active = !next;
        toast('Gagal mengubah status: ' + (error?.message || error), 'error');
    } finally {
        state.busy.delete(key);
        render();
    }
}

/* =========================================================
   DELETE
   ========================================================= */

async function deleteVoucher(id) {
    const v = findVoucher(id);
    if (!v) return;

    const used = Number(v.used_count) || 0;
    const ok = await confirmDialog({
        title: `Hapus voucher ${v.code}?`,
        message: (used > 0
            ? `Voucher ini sudah dipakai ${fmtNum(used)}×. Order lama tidak terpengaruh, tetapi voucher tidak bisa dipakai lagi.`
            : 'Voucher akan dihapus permanen dan tidak bisa dikembalikan.')
            + (v.is_active ? '\n\nTips: cukup nonaktifkan jika hanya ingin menghentikan sementara.' : ''),
        okText: 'Hapus',
        icon: 'fa-trash-can'
    });
    if (!ok) return;

    try {
        await authReady;
        if (!supabase) throw new Error('Supabase tidak tersedia.');
        const { error } = await supabase.from('vouchers').delete().eq('id', v.id);
        if (error) throw error;

        state.vouchers = state.vouchers.filter(x => String(x.id) !== String(id));
        render();
        toast(`Voucher ${v.code} dihapus.`, 'success');
    } catch (error) {
        console.error('❌ Error hapus voucher:', error);
        toast('Gagal menghapus voucher: ' + (error?.message || error), 'error');
    }
}

// kompatibel dengan pemanggilan lama
window.saveVoucher = saveVoucher;
window.editVoucher = id => { const v = findVoucher(id); if (v) openForm(v); };
window.toggleVoucherActive = toggleVoucherActive;
window.deleteVoucher = deleteVoucher;
window.resetVoucherForm = () => closeForm(true);

/* =========================================================
   EVENT
   ========================================================= */

function resetFilters() {
    state.q = '';
    state.filter = 'all';
    state.page = 1;
    $('vSearch').value = '';
    $('vSearchWrap').classList.remove('has-q');
    render();
}

function scrollListTop() {
    $('vScroll').scrollTop = 0;
}

function bindEvents() {
    // Pencarian
    let timer;
    $('vSearch').addEventListener('input', e => {
        $('vSearchWrap').classList.toggle('has-q', !!e.target.value);
        clearTimeout(timer);
        timer = setTimeout(() => {
            state.q = e.target.value.trim();
            state.page = 1;
            renderTable();
        }, 150);
    });
    $('vSearchClear').addEventListener('click', () => {
        $('vSearch').value = '';
        $('vSearchWrap').classList.remove('has-q');
        state.q = '';
        state.page = 1;
        renderTable();
        $('vSearch').focus();
    });

    // Filter chip & kartu ringkasan
    const onFilter = e => {
        const b = e.target.closest('[data-filter]');
        if (!b) return;
        const f = b.dataset.filter;
        if (f === 'usage') {
            state.sort = 'usage';
            $('vSort').value = 'usage';
            store.set('sort', 'usage');
            state.filter = 'all';
        } else {
            state.filter = (b.closest('#vStats') && state.filter === f) ? 'all' : f;
        }
        state.page = 1;
        render();
        scrollListTop();
    };
    $('vFilters').addEventListener('click', onFilter);
    $('vStats').addEventListener('click', onFilter);

    // Urutan & per halaman
    $('vSort').value = state.sort;
    $('vSort').addEventListener('change', e => {
        state.sort = e.target.value;
        store.set('sort', state.sort);
        state.page = 1;
        renderTable();
    });
    $('vPerPage').value = String(state.perPage);
    if ($('vPerPage').value !== String(state.perPage)) { state.perPage = 25; $('vPerPage').value = '25'; }
    $('vPerPage').addEventListener('change', e => {
        state.perPage = parseInt(e.target.value, 10) || 25;
        store.set('perPage', state.perPage);
        state.page = 1;
        renderTable();
    });
    $('vPagerNav').addEventListener('click', e => {
        const b = e.target.closest('[data-page]');
        if (!b || b.disabled) return;
        state.page = Number(b.dataset.page);
        renderTable();
        scrollListTop();
    });

    // Header
    $('vRefresh').addEventListener('click', () => loadVouchers({ silent: state.vouchers.length > 0 }));
    $('vOpenAdd').addEventListener('click', () => openForm());

    // Aksi di tabel (event delegation)
    const tbody = $('voucherTableBody');
    tbody.addEventListener('click', e => {
        const el = e.target.closest('[data-act]');
        if (!el || el.dataset.act === 'toggle') return;
        const { act, id } = el.dataset;
        const v = id != null ? findVoucher(id) : null;

        if (act === 'edit' && v) openForm(v);
        else if (act === 'dup' && v) openForm(v, { duplicate: true });
        else if (act === 'del') deleteVoucher(id);
        else if (act === 'copy' && v) copyText(v.code).then(() => toast(`Kode ${v.code} disalin.`, 'info', { duration: 2000 }));
        else if (act === 'new') openForm();
        else if (act === 'reset') resetFilters();
        else if (act === 'retry') loadVouchers();
    });
    tbody.addEventListener('change', e => {
        const el = e.target.closest('input[data-act="toggle"]');
        if (el) toggleVoucherActive(el.dataset.id);
    });
    tbody.addEventListener('dblclick', e => {
        if (e.target.closest('button, input, label')) return;
        const row = e.target.closest('tr.v-row');
        const id = row?.querySelector('[data-act="edit"]')?.dataset.id;
        const v = id && findVoucher(id);
        if (v) openForm(v);
    });

    // Form
    const form = $('vForm');
    form.addEventListener('submit', e => { e.preventDefault(); saveVoucher(); });
    form.addEventListener('input', e => {
        if (e.target.id) clearError(e.target.id);
        updatePreview();
    });
    form.addEventListener('change', e => {
        if (e.target.name === 'vType') { setType(e.target.value); clearError('vValue'); }
        updatePreview();
    });
    document.querySelectorAll('[data-money]').forEach(bindMoney);
    bindMoney($('vValue'));

    $('vCode').addEventListener('input', e => {
        const el = e.target;
        const pos = el.selectionStart ?? el.value.length;
        const before = sanitizeCode(el.value.slice(0, pos)).length;
        const clean = sanitizeCode(el.value);
        if (clean !== el.value) {
            el.value = clean;
            try { el.setSelectionRange(before, before); } catch { /* abaikan */ }
        }
    });
    $('vGen').addEventListener('click', () => {
        $('vCode').value = generateCode();
        clearError('vCode');
        updatePreview();
        $('vCode').focus();
    });
    document.querySelectorAll('[data-preset]').forEach(b =>
        b.addEventListener('click', () => applyPreset(b.dataset.preset)));

    // Modal
    $('vClose').addEventListener('click', () => closeForm());
    $('vCancel').addEventListener('click', () => closeForm());
    $('vModal').addEventListener('mousedown', e => { if (e.target === $('vModal')) closeForm(); });

    // Konfirmasi
    $('vConfirmOk').addEventListener('click', () => closeConfirm(true));
    $('vConfirmCancel').addEventListener('click', () => closeConfirm(false));
    $('vConfirm').addEventListener('mousedown', e => { if (e.target === $('vConfirm')) closeConfirm(false); });

    // Keyboard
    document.addEventListener('keydown', e => {
        if (isConfirmOpen()) {
            if (e.key === 'Escape') { e.preventDefault(); closeConfirm(false); }
            return;
        }
        if (isModalOpen()) {
            if (e.key === 'Escape') { e.preventDefault(); closeForm(); }
            else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); saveVoucher(); }
            return;
        }
        const tag = document.activeElement?.tagName;
        const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || document.activeElement?.isContentEditable;
        if (e.ctrlKey || e.metaKey || e.altKey) return;

        if (e.key === '/' && !typing) { e.preventDefault(); $('vSearch').focus(); $('vSearch').select(); }
        else if ((e.key === 'n' || e.key === 'N') && !typing) { e.preventDefault(); openForm(); }
        else if (e.key === 'Escape' && document.activeElement === $('vSearch')) {
            if ($('vSearch').value) $('vSearchClear').click();
            else $('vSearch').blur();
        }
    });

    // Status berbasis waktu (kedaluwarsa / mulai) diperbarui tiap menit
    setInterval(() => { if (!state.loading && !isModalOpen()) render(); }, 60000);
}

/* =========================================================
   START
   ========================================================= */

bindEvents();
loadVouchers();
