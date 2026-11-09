import { supabase, authReady } from '../supabase.js';
import {
    DEFAULT_STORE, STORE_FIELDS, toHHMM, displayTime, formatWaDisplay, normalizeWaNumber,
    isStoreOpen, extractEmbedSrc, extractLatLng, buildMapEmbedUrl, safeUrl
} from './store-settings.js';

const $ = (id) => document.getElementById(id);
const form = $('store-form');
const fields = [...document.querySelectorAll('[data-field]')];

const REQUIRED = ['store_name', 'wa_number', 'open_days', 'open_time', 'close_time', 'address', 'hero_title'];
const URL_FIELDS = ['maps_url', 'shopeefood_url', 'grabfood_url', 'gofood_url'];
const NUMBER_FIELDS = ['latitude', 'longitude'];

let original = {};      // nilai terakhir yang tersimpan di database
let saving = false;

/* =========================================================
   UTIL
   ========================================================= */
let toastTimer;
function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.classList.remove('opacity-0', 'translate-y-2');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('opacity-0', 'translate-y-2'), 2200);
}

function showScreen(name) {
    ['loading', 'login', 'denied', 'app'].forEach(s => $(`screen-${s}`).classList.toggle('hidden', s !== name));
}

function input(key) {
    return document.querySelector(`[data-field="${key}"]`);
}

/* =========================================================
   AUTH
   ========================================================= */
async function route() {
    showScreen('loading');
    try { await authReady; } catch { /* lanjut, cek session manual */ }

    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;

    if (!user || user.is_anonymous) {
        showScreen('login');
        $('login-email').focus();
        return;
    }

    const { data: isAdmin, error } = await supabase.rpc('is_store_admin');
    if (error) console.error('[ADMIN] is_store_admin error:', error);

    if (!isAdmin) {
        $('denied-email').textContent = user.email || 'ini';
        showScreen('denied');
        return;
    }

    $('admin-email').textContent = user.email || '';
    showScreen('app');
    await loadSettings();
}

$('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('login-btn');
    const err = $('login-error');
    err.classList.add('hidden');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch spin"></i>';

    const { error } = await supabase.auth.signInWithPassword({
        email: $('login-email').value.trim(),
        password: $('login-password').value
    });

    btn.disabled = false;
    btn.textContent = 'Masuk';

    if (error) {
        err.textContent = /invalid/i.test(error.message) ? 'Email atau password salah.' : error.message;
        err.classList.remove('hidden');
        $('login-form').classList.add('shake');
        setTimeout(() => $('login-form').classList.remove('shake'), 400);
        return;
    }
    $('login-password').value = '';
    route();
});

$('toggle-password').addEventListener('click', () => {
    const pw = $('login-password');
    const show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    $('toggle-password').innerHTML = `<i class="fa-regular ${show ? 'fa-eye-slash' : 'fa-eye'}"></i>`;
});

document.querySelectorAll('[data-logout]').forEach(btn => btn.addEventListener('click', async () => {
    if (isDirty() && !confirm('Ada perubahan yang belum disimpan. Tetap keluar?')) return;
    await supabase.auth.signOut();
    original = {};
    route();
}));

/* =========================================================
   LOAD & FILL
   ========================================================= */
async function loadSettings() {
    $('load-error').classList.add('hidden');
    const { data, error } = await supabase.from('store_settings').select('*').eq('id', 1).maybeSingle();

    if (error) {
        $('load-error').innerHTML = `<b>Gagal memuat data toko.</b> Pastikan file <code>store_settings.sql</code> sudah dijalankan di Supabase.<br><span class="text-xs">${error.message}</span>`;
        $('load-error').classList.remove('hidden');
    }

    const row = data || DEFAULT_STORE;
    const values = {};
    STORE_FIELDS.forEach(k => {
        let v = row[k] ?? '';
        if (k === 'open_time' || k === 'close_time') v = toHHMM(v);
        if (k === 'wa_number') v = v ? '0' + String(v).replace(/^62/, '') : '';
        values[k] = String(v);
    });

    fillForm(values);
    original = readForm();
    if (!data && !error) {
        toast('Data toko belum ada — isi lalu Simpan untuk membuatnya');
        original = {};   // semua dianggap perubahan baru
    }
    updateLastUpdated(data);
    refreshAll();
}

function fillForm(values) {
    fields.forEach(el => { el.value = values[el.dataset.field] ?? ''; });
}

function readForm() {
    const out = {};
    fields.forEach(el => { out[el.dataset.field] = el.value.trim(); });
    return out;
}

function updateLastUpdated(row) {
    const el = $('last-updated');
    if (!row?.updated_at) { el.textContent = ''; return; }
    const when = new Date(row.updated_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' });
    el.textContent = `Terakhir diubah: ${when} WIB`;
}

/* =========================================================
   VALIDASI & PAYLOAD
   ========================================================= */
function validate() {
    const v = readForm();
    const errors = [];
    fields.forEach(el => el.classList.remove('invalid'));
    const bad = (key, msg) => { input(key)?.classList.add('invalid'); errors.push({ key, msg }); };

    REQUIRED.forEach(k => { if (!v[k]) bad(k, 'Wajib diisi'); });

    if (v.wa_number && !/^62\d{8,13}$/.test(normalizeWaNumber(v.wa_number))) {
        bad('wa_number', 'Nomor WhatsApp tidak valid');
    }
    URL_FIELDS.forEach(k => { if (v[k] && !safeUrl(v[k])) bad(k, 'Link harus diawali https://'); });

    const hasLat = v.latitude !== '';
    const hasLng = v.longitude !== '';
    if (hasLat !== hasLng) bad(hasLat ? 'longitude' : 'latitude', 'Isi latitude dan longitude sekaligus');
    if (hasLat && (Number(v.latitude) < -90 || Number(v.latitude) > 90)) bad('latitude', 'Latitude harus -90 s/d 90');
    if (hasLng && (Number(v.longitude) < -180 || Number(v.longitude) > 180)) bad('longitude', 'Longitude harus -180 s/d 180');

    if (v.maps_embed_url && !/^https:\/\/(www\.)?google\.[a-z.]+\/maps/i.test(extractEmbedSrc(v.maps_embed_url))) {
        bad('maps_embed_url', 'Kode embed harus dari Google Maps');
    }
    return errors;
}

function toPayload() {
    const v = readForm();
    const p = { id: 1 };
    STORE_FIELDS.forEach(k => {
        let val = v[k];
        if (k === 'wa_number') val = normalizeWaNumber(val);
        if (k === 'maps_embed_url') val = extractEmbedSrc(val);
        if (NUMBER_FIELDS.includes(k)) val = val === '' ? null : Number(val);
        else if (val === '' && !REQUIRED.includes(k)) val = null;
        p[k] = val;
    });
    return p;
}

/* =========================================================
   SIMPAN
   ========================================================= */
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (saving) return;

    const errors = validate();
    if (errors.length) {
        const first = input(errors[0].key);
        first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        first?.focus({ preventScroll: true });
        toast(`${errors[0].msg}${errors.length > 1 ? ` (+${errors.length - 1} lainnya)` : ''}`);
        return;
    }

    saving = true;
    const btn = $('btn-save');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch spin"></i> Menyimpan...';

    const { data, error } = await supabase.from('store_settings').upsert(toPayload()).select().single();

    saving = false;
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan';

    if (error) {
        console.error('[ADMIN] Simpan gagal:', error);
        const denied = error.code === '42501' || /row-level security/i.test(error.message);
        toast(denied ? 'Akun ini tidak punya izin mengubah data toko' : `Gagal menyimpan: ${error.message}`);
        refreshDirty();
        return;
    }

    // Rapikan nomor WA yang sudah dinormalisasi
    input('wa_number').value = '0' + data.wa_number.replace(/^62/, '');
    input('maps_embed_url').value = data.maps_embed_url || '';
    original = readForm();
    updateLastUpdated(data);
    refreshAll();
    try { localStorage.removeItem('chimchum_store_settings'); } catch { /* abaikan */ }
    toast('✓ Data toko tersimpan. Web toko langsung memakai data baru.');
});

$('btn-reset').addEventListener('click', () => {
    if (!confirm('Batalkan semua perubahan yang belum disimpan?')) return;
    fillForm(original);
    fields.forEach(el => el.classList.remove('invalid'));
    refreshAll();
});

/* =========================================================
   DIRTY STATE & PRATINJAU
   ========================================================= */
function isDirty() {
    const now = readForm();
    return fields.some(el => (now[el.dataset.field] ?? '') !== (original[el.dataset.field] ?? ''));
}

function refreshDirty() {
    const now = readForm();
    let count = 0;
    fields.forEach(el => {
        const changed = (now[el.dataset.field] ?? '') !== (original[el.dataset.field] ?? '');
        el.classList.toggle('changed', changed);
        if (changed) count++;
    });
    $('btn-save').disabled = count === 0 || saving;
    $('btn-reset').disabled = count === 0 || Object.keys(original).length === 0;
    $('dirty-status').innerHTML = count
        ? `<i class="fa-solid fa-circle text-amber-400 text-[8px] mr-1.5 align-middle"></i>${count} perubahan belum disimpan`
        : '<i class="fa-solid fa-circle-check text-emerald-500 mr-1"></i>Semua tersimpan';
}

let mapTimer;
function refreshPreviews() {
    const v = readForm();

    // WhatsApp
    const wa = normalizeWaNumber(v.wa_number);
    $('wa-display-preview').textContent = wa ? formatWaDisplay(wa) : '-';
    $('wa-test').href = wa ? `https://wa.me/${wa}` : '#';

    // Jam
    const preview = { open_time: v.open_time, close_time: v.close_time };
    $('hours-preview').textContent = v.open_time && v.close_time
        ? `${v.open_days ? v.open_days + ' ' : ''}${displayTime(v.open_time)} – ${displayTime(v.close_time)}`
        : '-';
    if (v.open_time && v.close_time) {
        const open = isStoreOpen(preview);
        $('open-now-preview').textContent = open ? '● Buka sekarang' : '● Sedang tutup';
        $('open-now-preview').className = `ml-auto font-semibold ${open ? 'text-emerald-600' : 'text-red-500'}`;
    }

    // Link test
    document.querySelectorAll('[data-test-link]').forEach(a => {
        const url = safeUrl($(a.dataset.testLink).value);
        a.href = url || '#';
        a.classList.toggle('opacity-40', !url);
        a.classList.toggle('pointer-events-none', !url);
    });

    // Hero
    $('pv-badge').textContent = v.hero_badge;
    $('pv-badge').classList.toggle('hidden', !v.hero_badge);
    $('pv-title').textContent = v.hero_title || 'Judul hero';
    $('pv-highlight').textContent = v.hero_highlight;
    $('pv-subtitle').textContent = v.hero_subtitle;
    $('subtitle-count').textContent = `(${v.hero_subtitle.length}/220)`;

    // Peta (debounce agar iframe tidak reload tiap ketikan)
    clearTimeout(mapTimer);
    mapTimer = setTimeout(() => {
        const src = buildMapEmbedUrl({
            maps_embed_url: v.maps_embed_url,
            latitude: v.latitude === '' ? NaN : v.latitude,
            longitude: v.longitude === '' ? NaN : v.longitude,
            address: v.address,
            store_name: v.store_name
        });
        const iframe = $('map-preview');
        if (iframe.getAttribute('src') !== src) iframe.setAttribute('src', src);
    }, 600);
}

function refreshAll() {
    refreshDirty();
    refreshPreviews();
}

form.addEventListener('input', (e) => {
    e.target.classList?.remove('invalid');
    refreshAll();
});

/* ---------- Kode embed / link maps → isi koordinat otomatis ---------- */
function fillLatLngFrom(text) {
    const pos = extractLatLng(text);
    if (!pos) return false;
    input('latitude').value = pos.lat;
    input('longitude').value = pos.lng;
    return true;
}

input('maps_embed_url').addEventListener('change', () => {
    const el = input('maps_embed_url');
    const src = extractEmbedSrc(el.value);
    if (src !== el.value.trim()) el.value = src;   // simpan src-nya saja, bukan seluruh <iframe>
    if (src && fillLatLngFrom(src)) toast('Koordinat diisi otomatis dari kode embed');
    refreshAll();
});

input('maps_url').addEventListener('change', () => {
    if (input('latitude').value) return;
    if (fillLatLngFrom(input('maps_url').value)) {
        toast('Koordinat diisi otomatis dari link Maps');
        refreshAll();
    }
});

input('wa_number').addEventListener('blur', () => {
    const el = input('wa_number');
    const wa = normalizeWaNumber(el.value);
    if (/^62\d{8,13}$/.test(wa)) el.value = '0' + wa.slice(2);
    refreshAll();
});

$('btn-geolocate').addEventListener('click', () => {
    if (!navigator.geolocation) return toast('Browser tidak mendukung lokasi');
    const btn = $('btn-geolocate');
    btn.innerHTML = '<i class="fa-solid fa-circle-notch spin mr-1"></i>Mencari lokasi...';
    navigator.geolocation.getCurrentPosition((pos) => {
        input('latitude').value = pos.coords.latitude.toFixed(7);
        input('longitude').value = pos.coords.longitude.toFixed(7);
        if (input('maps_embed_url').value && confirm('Kosongkan kode embed supaya peta memakai koordinat baru?')) {
            input('maps_embed_url').value = '';
        }
        btn.innerHTML = '<i class="fa-solid fa-location-crosshairs mr-1"></i>Pakai lokasi saya sekarang (saat berada di toko)';
        toast(`Lokasi didapat (akurasi ±${Math.round(pos.coords.accuracy)} m)`);
        refreshAll();
    }, (err) => {
        btn.innerHTML = '<i class="fa-solid fa-location-crosshairs mr-1"></i>Pakai lokasi saya sekarang (saat berada di toko)';
        toast(err.code === 1 ? 'Izin lokasi ditolak' : 'Gagal mengambil lokasi');
    }, { enableHighAccuracy: true, timeout: 15000 });
});

window.addEventListener('beforeunload', (e) => {
    if (isDirty()) { e.preventDefault(); e.returnValue = ''; }
});

route();
