// /js/app.js

const modules = {
    "/admin.html": "./module/admin.js",
    "/index.html": "./module/index.js",
    "/kasir.html": "./module/kasir.js",
    "/laporan.html": "./module/laporan.js",
    "/master_resep.html": "./module/master_resep.js",
    "/master_supplier.html": "./module/master_supplier.js",
    "/pesanan.html": "./module/pesanan.js",
    "/stok.html": "./module/stok.js"
};

// Ambil nama/path halaman saat ini
const currentPage = window.location.pathname;

// Cari module yang sesuai
const modulePath = modules[currentPage];

if (modulePath) {
    try {
        await import(modulePath);

        console.log(`Module berhasil dimuat: ${modulePath}`);
    } catch (error) {
        console.error(`Gagal memuat module: ${modulePath}`, error);
    }
} else {
    console.warn(`Tidak ada module untuk halaman: ${currentPage}`);
}
