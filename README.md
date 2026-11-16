# ChimChum Malang — Web Toko & Admin

Website pemesanan online dan dashboard admin untuk **ChimChum Malang** (dimsum & crispy chicken).
Dibangun sebagai situs statis (HTML + JavaScript modul) yang di-deploy ke **Vercel**, dengan **Supabase** sebagai database, autentikasi, dan penyimpanan file.

Live: https://chimchummlg.vercel.app

---

## Daftar Isi
- [Fitur](#fitur)
- [Teknologi](#teknologi)
- [Struktur Folder](#struktur-folder)
- [Halaman](#halaman)
- [Logika Stok](#logika-stok)
- [Database](#database)
- [Setup dari Nol](#setup-dari-nol)
- [Alur Kerja Harian](#alur-kerja-harian)
- [Troubleshooting](#troubleshooting)

---

## Fitur

**Pelanggan (publik)**
- Katalog menu per kategori, pencarian, keranjang (tersimpan di browser)
- Stok tampil langsung dan berkurang saat item masuk keranjang
- Checkout dengan data pemesan, voucher diskon, pembayaran QRIS / Cash + upload bukti bayar
- Kirim pesanan ke WhatsApp toko dan lacak status pesanan (`/lacak.html/<order_id>`)
- Info toko (jam buka, alamat, peta, link GoFood / GrabFood / ShopeeFood) dan testimoni

**Admin (login)**
- Kasir (take away / delivery) dan Kasir Dine In, cetak struk
- Pesanan masuk & manage order (ubah status, batal, hapus) dengan pengembalian stok otomatis
- Stok siap jual + stok setengah jadi
- Master resep, kalkulator produksi, proses produksi
- Bahan baku, supplier, purchase order (restok bahan)
- Produk, voucher, testimoni, pengaturan toko, user
- Laporan keuangan, analisa pelanggan, kalkulator HPP

---

## Teknologi

| Bagian | Dipakai |
|---|---|
| Frontend | HTML, JavaScript ES Modules (tanpa build step), Tailwind CSS (CDN), Font Awesome |
| Backend | Supabase: Postgres, Auth, Storage, Realtime, RPC (fungsi SQL) |
| Hosting | Vercel (static) |

Tidak ada `npm install` atau proses build. Semua file langsung dilayani apa adanya.

---

## Struktur Folder

```
├── index.html              # Landing page / toko online (publik)
├── lacak.html              # Lacak pesanan (publik)
├── login.html              # Login admin
├── admin.html              # Shell dashboard admin (memuat halaman lain via menu)
├── kasir.html              # Kasir take away / delivery
├── kasir_dine_in.html      # Kasir dine in
├── pesanan.html            # Pesanan masuk
├── manageorder.html        # Kelola semua pesanan
├── stok.html               # Stok siap jual + stok setengah jadi
├── master_resep.html       # Resep, produksi, bahan baku
├── produk.html             # Kelola produk / menu
├── purchase_orders.html    # Purchase order ke supplier
├── master_supplier.html    # Data supplier
├── voucher.html            # Voucher diskon
├── testimoni.html          # Upload testimoni
├── master-toko.html        # Pengaturan toko
├── usersetup.html          # Kelola user admin
├── laporan.html            # Laporan keuangan
├── analisa.html            # Analisa pelanggan
├── hpp.html                # Kalkulator HPP
├── css/kasir.css
├── assets/                 # Logo, QRIS, foto menu
├── js/
│   ├── supabase.js         # Koneksi Supabase (URL + anon key) & authReady
│   └── module/             # Logika per halaman (index.js, kasir.js, stok.js, ...)
│       ├── auth-guard.js   # Cek login & role sebelum halaman admin dimuat
│       └── store-settings.js
├── supabase/               # File SQL (migrasi & fungsi)
└── vercel.json             # Rewrite URL (/admin, /kasir, /lacak.html/:id)
```

---

## Halaman

| URL | File | Akses | Keterangan |
|---|---|---|---|
| `/` | `index.html` | Publik | Toko online |
| `/lacak.html/<order_id>` | `lacak.html` | Publik | Lacak pesanan |
| `/login.html` | `login.html` | Publik | Login admin |
| `/admin` | `admin.html` | Admin | Dashboard, membuka halaman di bawah lewat menu samping |
| `/kasir` | `kasir.html` | Admin | Kasir |
| — | `stok.html`, `master_resep.html`, `produk.html`, dll. | Admin | Dimuat di dalam `admin.html` |

Halaman admin memanggil `requireAuth(['admin'])` dari `js/module/auth-guard.js` sebelum memuat JS-nya.

---

## Logika Stok

Stok dikelola **dua tingkat**, karena beberapa menu memakai dimsum yang sama.
Contoh: Shumai Original isi 8 dan Shumai Mentai isi 6 sama-sama memakai dimsum dari resep "Dimsum Original".

```
BAHAN MENTAH            STOK SETENGAH JADI (per resep)        MENU (porsi siap jual)
(ingredients.stock)     (recipes.stok, satuan pcs)            (products.stok, otomatis)

Paha fillet, kulit,  ──► Resep "Dimsum Original" = 100 pcs ──► Shumai Original isi 8 → 12 porsi
tapioka, saos, ...       Proses produksi                   ├─► Shumai Original isi 4 → 25 porsi
                                                           └─► Shumai Mentai isi 6   → 16 porsi
```

| Kejadian | Efek |
|---|---|
| **Proses produksi** (Master Resep → Kalkulator) | Bahan mentah berkurang sesuai resep × batch, stok resep **+pcs** |
| **Order** (web / kasir) | Stok resep **−(isi per porsi × qty)** |
| **Batal / hapus order** | Stok resep dikembalikan |
| **Aktif lagi dari batal** | Stok resep dipotong lagi (ditolak kalau tidak cukup) |
| **Koreksi / stock opname** | Halaman Stok → Stok Setengah Jadi, atau tombol −/+ di kartu resep |

Aturan:
- Hanya resep yang **stok setengah jadinya diaktifkan** (`recipes.pakai_stok = true`) yang memakai sistem ini. Aktifkan lewat tombol *Aktifkan stok setengah jadi* di kartu resep.
- Menu terhubung ke resep lewat **Master Resep → Menu & Resep** (`products.resep_id`).
- **Isi per porsi** (`products.porsi_pcs`) diisi otomatis dari kolom **Isi** produk (mis. `8 pcs`), atau dari nama (`... Isi 8 pcs`) kalau kolom Isi kosong.
- `products.stok` untuk menu otomatis = `floor(stok resep / isi per porsi)`, dihitung oleh trigger database. Jangan diedit manual (form Produk & halaman Stok sudah menguncinya).
- Menu tanpa resep berstok (mis. Es Teh, dibuat saat dipesan) tetap memakai `products.stok` manual.
- Di **web & kasir**, sisa stok menu yang satu resep saling mengurangi di keranjang sebelum checkout.

---

## Database

### Tabel utama
| Tabel | Isi |
|---|---|
| `products` | Menu: `nama`, `kategori`, `isi`, `harga`, `hpp`, `stok`, `foto`, `resep_id`, `porsi_pcs` |
| `recipes` | Resep: `name`, `items` (jsonb `[{ingredientId, amount}]` per 1 batch), `pakai_stok`, `stok`, `output_qty` |
| `ingredients` | Bahan baku: `name`, `unit`, `stock`, `price`, `supplier_id` |
| `orders` | Pesanan: `order_id`, `items` (jsonb `[{id, qty, nama, harga}]`), `status`, `payment_*`, `stock_restored`, voucher, total |
| `suppliers`, `purchase_orders`, `purchase_order_items` | Pembelian bahan |
| `vouchers` | Voucher diskon |
| `store_settings` | Pengaturan toko (1 baris) |
| `usersetup` | Role user admin (`username` = email login, `role`) — dicek oleh `auth-guard.js` |
| `store_admins` | User yang boleh mengubah pengaturan toko |

### View
| View | Isi |
|---|---|
| `product_stock_source` | Menu yang memakai stok resep: `product_id`, `porsi_pcs`, `recipe_id`, `recipe_stok`, `porsi_tersedia`. Dibaca oleh web & kasir. |

### Fungsi RPC
| Fungsi | Dipakai oleh | Kegunaan |
|---|---|---|
| `reduce_product_stock(p_product_id, p_quantity)` | Web, Kasir | Potong stok saat order (stok resep atau stok manual). Return `false` kalau tidak cukup. |
| `update_order_status(p_key, p_status)` | Pesanan, Manage Order, Kasir | Ubah status; kembalikan / potong stok saat ke/dari `cancel` |
| `delete_order(p_key)` | Pesanan | Hapus order + kembalikan stok |
| `produce_batch(p_recipe_id, p_batch)` | Master Resep | Potong bahan mentah + tambah stok resep (satu transaksi) |
| `adjust_recipe_stock(p_recipe_id, p_delta)` | Stok, Master Resep | Koreksi stok resep (selisih, atomik) |
| `adjust_ingredient_stock(p_ingredient_id, p_delta)` | Purchase Order | Tambah stok bahan saat PO diterima |
| `apply_product_stock(...)`, `sync_product_stok()` | Internal | Inti logika stok & sinkron `products.stok` |
| `check_voucher`, `redeem_voucher` | Web, Kasir | Voucher |
| `is_store_admin` | Master Toko | Cek admin |

### File SQL (`supabase/`)
Jalankan berurutan di **Supabase → SQL Editor**. Semua aman dijalankan ulang.

| Urutan | File | Isi |
|---|---|---|
| 1 | `storesetting.sql` | Tabel & aturan pengaturan toko |
| 2 | `migrasi_stok_resep.sql` | Logika stok setengah jadi (kolom, view, trigger, semua fungsi stok) |
| 3 | `trigger_porsi_pcs.sql` | Isi per porsi otomatis dari kolom Isi / nama produk |
| 4 | `grant_view_landingpage.sql` | Izin baca `product_stock_source` untuk pengunjung (web publik) |

> `migrasi_logic_stok.sql` (v2) sudah digantikan oleh `migrasi_stok_resep.sql` (v3). Jangan dijalankan lagi.

---

## Setup dari Nol

1. **Supabase**
   - Buat project, lalu jalankan file SQL di atas.
   - Storage: buat bucket publik `payment-proofs` (bukti bayar) dan `testimoni`.
   - Auth: buat user admin (email + password), lalu tambahkan baris di tabel `usersetup` dengan `username` = email tersebut dan `role` = `admin`. Untuk bisa mengubah Master Toko, tambahkan juga `user_id`-nya ke tabel `store_admins`.
   - (Opsional) Database → Publications → `supabase_realtime`: aktifkan untuk `products`, `recipes`, `orders` supaya halaman Stok & Kasir ikut ter-update dari perangkat lain.
2. **Koneksi**: isi `SUPABASE_URL` dan anon key di `js/supabase.js`.
   Anon key memang publik; keamanan data dijaga oleh RLS policy di Supabase.
3. **Deploy**: hubungkan repo ini ke Vercel (framework: *Other*, tanpa build command, output = root). Setiap push ke `main` otomatis deploy.
4. **Tes lokal**: jalankan server statis apa saja dari root repo, mis. `npx serve .` atau `python -m http.server`, lalu buka `http://localhost:...`. Jangan dibuka lewat `file://` karena ES Modules butuh server.

---

## Alur Kerja Harian

1. **Pagi / setelah produksi**: Master Resep → Kalkulator → pilih menu & jumlah batch → **Proses produksi**. Stok resep bertambah, bahan mentah berkurang.
2. **Jualan**: order dari web atau kasir otomatis memotong stok resep. Sisa porsi tiap menu terlihat di kasir & web.
3. **Batal**: ubah status ke Batal di Pesanan / Manage Order, stok kembali otomatis.
4. **Stock opname**: Halaman Stok → Stok Setengah Jadi → isi jumlah pcs hasil hitung fisik.
5. **Belanja bahan**: Master Resep → Kalkulator → *Order (PO) bahan kurang*, lalu terima PO di Purchase Order untuk menambah stok bahan.
6. **Menu baru**: tambah di Produk (isi kolom **Isi**, mis. `6 pcs`), lalu hubungkan ke resep di Master Resep → Menu & Resep.

---

## Troubleshooting

| Gejala | Penyebab & solusi |
|---|---|
| Stok menu tidak bisa diedit di Produk / Stok | Menu terhubung ke resep berstok. Ubah stok resepnya (halaman Stok atau kartu resep). |
| Stok menu tidak berubah setelah produksi | Stok setengah jadi resep belum diaktifkan, atau menu belum terhubung ke resep itu. |
| Order memotong 1 pcs saja | Kolom **Isi** produk kosong dan nama tidak mengandung "Isi N pcs". Isi kolom Isi. |
| Web tidak menampilkan stok bersama | `grant_view_landingpage.sql` belum dijalankan (pengunjung tidak bisa membaca view). Web otomatis kembali ke stok per menu. |
| Error `function ... does not exist` (PGRST202) | File SQL belum dijalankan di Supabase. |
| Error `row-level security` | RLS policy belum mengizinkan aksi itu untuk user / role yang login. |
| Halaman admin kosong / balik ke login | Sesi habis atau user bukan admin. Login ulang. |
