/* =========================================================
   KASIR UI — layout helpers
   - Fullscreen (laptop / tablet)
   - Jam di header
   - Status koneksi online/offline
   (Pagination menu lama diganti grid scroll + filter kategori di kasir.js)
========================================================= */

const fsSupported = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);

function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

function updateFullscreenIcon() {
    const on = isFullscreen();
    document.querySelectorAll('[data-fs-icon]').forEach(icon => {
        icon.className = on ? 'fa-solid fa-compress' : 'fa-solid fa-expand';
    });
    const btn = document.getElementById('btnFullscreen');
    if (btn) btn.title = on ? 'Keluar layar penuh' : 'Layar penuh';
    document.body.classList.toggle('is-fullscreen', on);
}

window.toggleKasirFullscreen = async function () {
    const el = document.documentElement;
    try {
        if (!isFullscreen()) {
            if (el.requestFullscreen) await el.requestFullscreen();
            else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
        } else {
            if (document.exitFullscreen) await document.exitFullscreen();
            else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        }
    } catch (err) {
        console.warn('Fullscreen tidak tersedia:', err);
    }
};

// Kompatibilitas dengan versi lama (tombol hide header sudah tidak dipakai)
window.toggleKasirHeader = function () {
    document.body.classList.toggle('header-collapsed');
};

function updateClock() {
    const el = document.getElementById('headerClock');
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleString('id-ID', {
        weekday: 'short', day: '2-digit', month: 'short',
        hour: '2-digit', minute: '2-digit'
    });
}

function updateConnection() {
    const badge = document.getElementById('connStatus');
    if (!badge) return;
    const online = navigator.onLine;
    badge.classList.toggle('is-offline', !online);
    badge.querySelector('span').textContent = online ? 'Online' : 'Offline';
    badge.querySelector('i').className = online ? 'fa-solid fa-signal' : 'fa-solid fa-plug-circle-xmark';
}

function initKasirUI() {
    const fsBtn = document.getElementById('btnFullscreen');
    if (fsBtn && !fsSupported) fsBtn.hidden = true;

    document.addEventListener('fullscreenchange', updateFullscreenIcon);
    document.addEventListener('webkitfullscreenchange', updateFullscreenIcon);

    updateClock();
    setInterval(updateClock, 15000);

    updateConnection();
    window.addEventListener('online', updateConnection);
    window.addEventListener('offline', updateConnection);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initKasirUI, { once: true });
} else {
    initKasirUI();
}
