// Pengaturan toko (Master Toko) — dipakai halaman toko & halaman admin.
// DEFAULT_STORE dipakai kalau database belum bisa diakses, supaya halaman tetap tampil.

export const DEFAULT_STORE = {
    store_name: 'ChimChum Malang',
    wa_number: '6285723785380',
    open_days: 'Setiap hari',
    open_time: '08:00',
    close_time: '20:00',
    services: 'Take Away & Delivery',
    address: 'Jl. Danau Laut Tawar 1 G2A 2 Sawojajar Kec. Kedungkandang, Kota Malang',
    area_label: 'Sawojajar, Malang',
    maps_url: 'https://maps.app.goo.gl/8Cp16aFSZru1baPZA',
    latitude: -7.978526642993528,
    longitude: 112.65659704074243,
    maps_embed_url: 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d667.2785204619356!2d112.65659704074243!3d-7.978526642993528!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x2dd629aa6b6f81c7%3A0x2719c4c43ee2f41c!2sChimChum%20Malang!5e0!3m2!1sid!2sid!4v1788452703570!5m2!1sid!2sid',
    shopeefood_url: 'https://spf.shopee.co.id/3qNA9eAiDU',
    grabfood_url: 'https://food.grab.com/id/id/restaurant/chimchum-malang-sawojajar-delivery/6-C8CEDF5YGJBHRX',
    gofood_url: 'https://gofood.co.id',
    hero_badge: '🔥 Freshly Made',
    hero_title: 'Teman cerita saat',
    hero_highlight: 'kumpul bersama',
    hero_subtitle: 'Makan, cerita, bahagia dengan orang tercinta. Pesan langsung di sini, bayar pakai QRIS, dan pesananmu langsung kami proses.'
};

export const STORE_FIELDS = Object.keys(DEFAULT_STORE);

const CACHE_KEY = 'chimchum_store_settings';

/** Ambil pengaturan dari Supabase. Kalau gagal, pakai cache terakhir lalu default. */
export async function fetchStoreSettings(supabase) {
    try {
        const { data, error } = await supabase
            .from('store_settings')
            .select('*')
            .eq('id', 1)
            .maybeSingle();
        if (error) throw error;
        if (data) {
            const merged = mergeStore(data);
            try { localStorage.setItem(CACHE_KEY, JSON.stringify(merged)); } catch { /* abaikan */ }
            return merged;
        }
    } catch (e) {
        console.warn('[STORE] Gagal memuat pengaturan toko, memakai cadangan:', e);
    }
    return getCachedStore();
}

/** Pengaturan dari cache browser (instan, sebelum database menjawab). */
export function getCachedStore() {
    try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
        if (cached) return mergeStore(cached);
    } catch { /* abaikan */ }
    return { ...DEFAULT_STORE };
}

/** Isi kolom yang kosong (null) dengan nilai default, kecuali link & embed yang sengaja dikosongkan. */
function mergeStore(row) {
    const out = { ...DEFAULT_STORE };
    const optional = ['maps_embed_url', 'shopeefood_url', 'grabfood_url', 'gofood_url', 'maps_url', 'area_label', 'services', 'hero_badge'];
    for (const key of STORE_FIELDS) {
        const v = row[key];
        if (v === null || v === undefined) {
            if (optional.includes(key) && key in row) out[key] = '';
            continue;
        }
        out[key] = v;
    }
    out.open_time = toHHMM(out.open_time);
    out.close_time = toHHMM(out.close_time);
    return out;
}

/** "08:00:00" → "08:00" */
export function toHHMM(t) {
    const m = String(t || '').match(/^(\d{1,2}):(\d{2})/);
    return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
}

/** "08:00" → "08.00" (format jam Indonesia) */
export function displayTime(t) {
    return toHHMM(t).replace(':', '.');
}

/** "6285723785380" → "0857-2378-5380" */
export function formatWaDisplay(wa) {
    const local = '0' + String(wa || '').replace(/\D/g, '').replace(/^62/, '');
    return local.replace(/^(\d{4})(\d{4})(\d+)$/, '$1-$2-$3');
}

/** "0857 2378 5380" / "+62857..." → "6285723785380" */
export function normalizeWaNumber(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (d.startsWith('0')) d = '62' + d.slice(1);
    else if (d.startsWith('8')) d = '62' + d;
    return d;
}

/** Apakah toko sedang buka (waktu Jakarta). Mendukung jam lewat tengah malam, cth 16.00–02.00. */
export function isStoreOpen(store, now = new Date()) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(now).map(x => [x.type, x.value]));
    const nowMin = Number(p.hour) * 60 + Number(p.minute);
    const toMin = (t) => { const [h, m] = toHHMM(t).split(':').map(Number); return h * 60 + m; };
    const open = toMin(store.open_time);
    const close = toMin(store.close_time);
    if (Number.isNaN(open) || Number.isNaN(close) || open === close) return true; // 24 jam
    return open < close ? (nowMin >= open && nowMin < close) : (nowMin >= open || nowMin < close);
}

/** Ambil src dari kode <iframe ...> Google Maps, atau kembalikan URL apa adanya. */
export function extractEmbedSrc(input) {
    const s = String(input || '').trim();
    const m = s.match(/src=["']([^"']+)["']/i);
    return m ? m[1] : s;
}

/** Coba ambil koordinat dari URL embed / link Google Maps. */
export function extractLatLng(input) {
    const s = decodeURIComponent(String(input || ''));
    let m = s.match(/!3d(-?\d+(?:\.\d+)?)!2d(-?\d+(?:\.\d+)?)/);      // embed: !3d<lat>!2d<lng>
    if (m) return { lat: Number(m[1]), lng: Number(m[2]) };
    m = s.match(/!2d(-?\d+(?:\.\d+)?)!3d(-?\d+(?:\.\d+)?)/);           // embed: !2d<lng>!3d<lat>
    if (m) return { lat: Number(m[2]), lng: Number(m[1]) };
    m = s.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);              // link: /@lat,lng,17z
    if (m) return { lat: Number(m[1]), lng: Number(m[2]) };
    m = s.match(/[?&](?:q|ll|query)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
    if (m) return { lat: Number(m[1]), lng: Number(m[2]) };
    return null;
}

/** URL iframe peta: pakai embed khusus kalau diisi, kalau tidak dibuat dari koordinat. */
export function buildMapEmbedUrl(store) {
    const custom = extractEmbedSrc(store.maps_embed_url);
    if (custom && /^https:\/\/(www\.)?google\.[a-z.]+\/maps/i.test(custom)) return custom;
    const lat = Number(store.latitude);
    const lng = Number(store.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return `https://maps.google.com/maps?q=${lat},${lng}&z=17&hl=id&output=embed`;
    }
    return `https://maps.google.com/maps?q=${encodeURIComponent(store.address || store.store_name)}&z=16&hl=id&output=embed`;
}

/** Hanya izinkan link http(s) supaya tidak bisa diisi "javascript:..." */
export function safeUrl(url) {
    const s = String(url || '').trim();
    return /^https?:\/\//i.test(s) ? s : '';
}
