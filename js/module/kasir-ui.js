
/* =========================================================
   kasir-ui.js
   1. Toggle header & fullscreen (layout mode)
   2. Pagination daftar menu kasir
   ========================================================= */

/* ---------------------------------------------------------
   1. LAYOUT MODE
   --------------------------------------------------------- */
const KEY_HEADER_HIDDEN = 'kasirHeaderHidden';
const KEY_FULLSCREEN = 'kasirFullscreen';

const storage = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* abaikan */ }
  },
};

function updateFullscreenButton() {
  const button = document.querySelector('.btn-fullscreen');
  if (!button) return;

  const isFullscreen = document.body.classList.contains('fullscreen-mode');

  button.innerHTML = isFullscreen
    ? '<i class="fa-solid fa-compress"></i> Normal'
    : '<i class="fa-solid fa-expand"></i> Fullscreen';

  button.title = isFullscreen ? 'Kembali ke tampilan normal' : 'Fullscreen';
}

// Dipanggil dari atribut onclick di HTML, jadi harus global.
window.toggleKasirHeader = () => {
  const hidden = document.body.classList.toggle('header-hidden');
  storage.set(KEY_HEADER_HIDDEN, hidden ? '1' : '0');
};

window.toggleKasirFullscreen = () => {
  const full = document.body.classList.toggle('fullscreen-mode');
  storage.set(KEY_FULLSCREEN, full ? '1' : '0');
  updateFullscreenButton();
};

// Pulihkan pengaturan terakhir
if (storage.get(KEY_FULLSCREEN) === '1') document.body.classList.add('fullscreen-mode');
if (storage.get(KEY_HEADER_HIDDEN) === '1') document.body.classList.add('header-hidden');
updateFullscreenButton();


/* ---------------------------------------------------------
   2. PAGINATION MENU
   Tidak mengubah kasir.js: pagination membaca kartu yang
   dirender ke #kasirMenuList lalu menyembunyikan kartu di luar
   halaman aktif. Saat kasir.js merender ulang (cari / filter
   kategori), halaman kembali ke 1.
   --------------------------------------------------------- */
function initMenuPagination() {
  const list = document.getElementById('kasirMenuList');
  const btnPrev = document.getElementById('kasirPagerPrev');
  const btnNext = document.getElementById('kasirPagerNext');
  const info = document.getElementById('kasirPagerInfo');
  const count = document.getElementById('kasirPagerCount');
  if (!list || !btnPrev || !btnNext || !info || !count) return;

  const desktop = window.matchMedia('(min-width: 1025px)');
  const MOBILE_ROWS = 4;      // baris per halaman di layar < 1025px
  const FALLBACK_ROWS = 3;    // jika tinggi kartu belum bisa diukur

  let page = 1;
  let pageSize = 12;
  let signature = '';

  const getCards = () => Array.from(list.children);

  const getColumns = () => {
    const cols = getComputedStyle(list).gridTemplateColumns.split(' ').filter(Boolean).length;
    return Math.max(cols, 1);
  };

  // Desktop: hitung berapa baris yang muat di tinggi area menu
  const getRows = () => {
    if (!desktop.matches) return MOBILE_ROWS;

    const first = list.firstElementChild;
    if (!first) return FALLBACK_ROWS;

    const wasHidden = first.hidden;
    first.hidden = false;
    const cardHeight = first.offsetHeight;
    first.hidden = wasHidden;

    if (!cardHeight) return FALLBACK_ROWS;

    const gap = parseFloat(getComputedStyle(list).rowGap) || 0;
    return Math.max(1, Math.floor((list.clientHeight + gap) / (cardHeight + gap)));
  };

  const render = () => {
    const cards = getCards();
    const total = cards.length;

    pageSize = getColumns() * getRows();

    const pages = Math.max(1, Math.ceil(total / pageSize));
    page = Math.min(Math.max(page, 1), pages);

    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    cards.forEach((card, i) => { card.hidden = i < start || i >= end; });

    info.textContent = `Hal ${page} / ${pages}`;
    count.textContent = `${total} menu`;
    btnPrev.disabled = page <= 1;
    btnNext.disabled = page >= pages;
  };

  // Identitas daftar: kalau berubah (cari/filter), balik ke halaman 1.
  // Render ulang dengan isi yang sama tidak mereset halaman.
  const getSignature = () =>
    getCards()
      .map((card) => card.dataset.id || card.querySelector('h4')?.textContent.trim() || card.textContent.trim())
      .join('|');

  new MutationObserver(() => {
    const next = getSignature();
    if (next !== signature) {
      signature = next;
      page = 1;
    }
    render();
  }).observe(list, { childList: true });

  btnPrev.addEventListener('click', () => { page -= 1; render(); });
  btnNext.addEventListener('click', () => { page += 1; render(); });

  let frame = 0;
  const scheduleRender = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(render);
  };
  window.addEventListener('resize', scheduleRender);
  new ResizeObserver(scheduleRender).observe(list);

  signature = getSignature();
  render();
}

initMenuPagination();
