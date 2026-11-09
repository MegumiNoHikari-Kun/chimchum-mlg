-- =====================================================================
--  MASTER TOKO — ChimChum Malang
--  Jalankan seluruh file ini di Supabase Dashboard → SQL Editor → Run.
--  Aman dijalankan ulang (idempotent).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Daftar admin yang boleh mengubah data toko
--    (tidak ada policy = tidak bisa dibaca/diubah lewat API publik,
--     hanya lewat SQL Editor / dashboard)
-- ---------------------------------------------------------------------
create table if not exists public.store_admins (
    user_id    uuid primary key references auth.users(id) on delete cascade,
    created_at timestamptz not null default now()
);
alter table public.store_admins enable row level security;

-- true kalau user yang login (bukan anonymous) terdaftar sebagai admin
create or replace function public.is_store_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
       and exists (select 1 from public.store_admins where user_id = auth.uid());
$$;

grant execute on function public.is_store_admin() to anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. Tabel pengaturan toko (hanya 1 baris, id = 1)
-- ---------------------------------------------------------------------
create table if not exists public.store_settings (
    id              smallint primary key default 1 check (id = 1),

    -- Identitas & kontak
    store_name      text not null default 'ChimChum Malang',
    wa_number       text not null default '6285723785380'
                    check (wa_number ~ '^62[0-9]{8,13}$'),

    -- Jam operasional
    open_days       text not null default 'Setiap hari',
    open_time       time not null default '08:00',
    close_time      time not null default '20:00',
    services        text          default 'Take Away & Delivery',

    -- Alamat & lokasi
    address         text,
    area_label      text,                      -- teks singkat, cth: "Sawojajar, Malang"
    maps_url        text,                      -- link "Buka di Google Maps"
    latitude        double precision check (latitude  between -90  and 90),
    longitude       double precision check (longitude between -180 and 180),
    maps_embed_url  text,                      -- opsional, menimpa peta dari lat/long

    -- Aplikasi pesan antar (kosongkan untuk menyembunyikan tombolnya)
    shopeefood_url  text,
    grabfood_url    text,
    gofood_url      text,

    -- Hero banner
    hero_badge      text,
    hero_title      text,
    hero_highlight  text,                      -- bagian judul berwarna oranye
    hero_subtitle   text,

    updated_at      timestamptz not null default now(),
    updated_by      uuid references auth.users(id) on delete set null
);

-- Catat otomatis kapan & siapa yang terakhir mengubah
create or replace function public.store_settings_touch()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    new.updated_by := auth.uid();
    return new;
end;
$$;

drop trigger if exists trg_store_settings_touch on public.store_settings;
create trigger trg_store_settings_touch
    before insert or update on public.store_settings
    for each row execute function public.store_settings_touch();


-- ---------------------------------------------------------------------
-- 3. Row Level Security
--    - Semua pengunjung boleh BACA (dibutuhkan halaman toko)
--    - Hanya admin boleh TAMBAH / UBAH
--    - Tidak ada yang boleh HAPUS lewat API
-- ---------------------------------------------------------------------
alter table public.store_settings enable row level security;

drop policy if exists "store_settings_read_all"     on public.store_settings;
drop policy if exists "store_settings_admin_insert" on public.store_settings;
drop policy if exists "store_settings_admin_update" on public.store_settings;

create policy "store_settings_read_all"
    on public.store_settings for select
    to anon, authenticated
    using (true);

create policy "store_settings_admin_insert"
    on public.store_settings for insert
    to authenticated
    with check (public.is_store_admin());

create policy "store_settings_admin_update"
    on public.store_settings for update
    to authenticated
    using (public.is_store_admin())
    with check (public.is_store_admin());


-- ---------------------------------------------------------------------
-- 4. Data awal (sama dengan yang sebelumnya hardcode di index.html)
-- ---------------------------------------------------------------------
insert into public.store_settings (
    id, store_name, wa_number,
    open_days, open_time, close_time, services,
    address, area_label, maps_url, latitude, longitude, maps_embed_url,
    shopeefood_url, grabfood_url, gofood_url,
    hero_badge, hero_title, hero_highlight, hero_subtitle
) values (
    1, 'ChimChum Malang', '6285723785380',
    'Setiap hari', '08:00', '20:00', 'Take Away & Delivery',
    'Jl. Danau Laut Tawar 1 G2A 2 Sawojajar Kec. Kedungkandang, Kota Malang',
    'Sawojajar, Malang',
    'https://maps.app.goo.gl/8Cp16aFSZru1baPZA',
    -7.978526642993528, 112.65659704074243,
    'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d667.2785204619356!2d112.65659704074243!3d-7.978526642993528!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x2dd629aa6b6f81c7%3A0x2719c4c43ee2f41c!2sChimChum%20Malang!5e0!3m2!1sid!2sid!4v1788452703570!5m2!1sid!2sid',
    'https://spf.shopee.co.id/3qNA9eAiDU',
    'https://food.grab.com/id/id/restaurant/chimchum-malang-sawojajar-delivery/6-C8CEDF5YGJBHRX',
    'https://gofood.co.id',
    '🔥 Freshly Made',
    'Teman cerita saat',
    'kumpul bersama',
    'Makan, cerita, bahagia dengan orang tercinta. Pesan langsung di sini, bayar pakai QRIS, dan pesananmu langsung kami proses.'
)
on conflict (id) do nothing;


-- ---------------------------------------------------------------------
-- 5. Daftarkan admin
--    a) Buat dulu user di Dashboard → Authentication → Users → Add user
--       (email + password, centang "Auto Confirm User")
--    b) Ganti email di bawah lalu jalankan baris ini
-- ---------------------------------------------------------------------
-- insert into public.store_admins (user_id)
-- select id from auth.users where email = 'email-admin@contoh.com'
-- on conflict do nothing;
