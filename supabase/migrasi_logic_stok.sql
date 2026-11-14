-- =====================================================================
-- MIGRASI v2: Stok 2 tingkat (bahan mentah -> setengah jadi -> menu)
-- ChimChum Malang — Supabase
--
--  PRODUKSI : resep x batch  -> bahan mentah (termasuk saos) berkurang
--                            -> stok SETENGAH JADI bertambah (mis. "Dimsum (pcs)")
--  ORDER    : menu x qty     -> stok SETENGAH JADI berkurang sebanyak isi menu
--             (Shumai Original isi 8 = -8 pcs, Shumai Mentai isi 6 = -6 pcs)
--
--  * Stok setengah jadi disimpan sebagai baris di tabel ingredients (unit pcs).
--  * recipes.output_ingredient_id : resep ini menghasilkan stok setengah jadi apa.
--    Resep Original & Mentai boleh menunjuk ke stok yang SAMA.
--  * products.porsi_pcs : isi per porsi (dibaca otomatis dari "Isi N pcs").
--  * products.stok dihitung OTOMATIS = floor(stok setengah jadi / porsi_pcs),
--    jadi kasir / web / halaman Stok yang membaca products.stok tetap jalan.
--  * Produk yang resepnya belum punya output (Es Teh, Wonton) tetap pakai
--    products.stok manual seperti sebelumnya.
--  * Nama & parameter fungsi lama tidak berubah -> frontend order tidak perlu diubah.
--
-- Jalankan seluruh file sekali di SQL Editor. Aman dijalankan ulang.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Kolom baru
-- ---------------------------------------------------------------------
alter table public.products
  add column if not exists porsi_pcs numeric not null default 1;

alter table public.recipes
  add column if not exists output_ingredient_id text,
  add column if not exists output_qty numeric not null default 1;  -- pcs dihasilkan per 1 batch

update public.products
   set porsi_pcs = coalesce(substring(nama from '(?i)isi\s*(\d+)')::numeric, 1)
 where porsi_pcs = 1;

-- ---------------------------------------------------------------------
-- 2. Produk -> stok setengah jadi yang dipakai
-- ---------------------------------------------------------------------
create or replace view public.product_stock_source as
select p.id::text             as product_id,
       p.nama                 as product_name,
       p.porsi_pcs,
       r.output_ingredient_id as wip_id,
       i.name                 as wip_name,
       i.stock                as wip_stock,
       greatest(0, floor(i.stock / nullif(p.porsi_pcs, 0)))::int as porsi_tersedia
from public.products p
join public.recipes r     on r.id = p.resep_id
join public.ingredients i on i.id = r.output_ingredient_id;

-- ---------------------------------------------------------------------
-- 3. Sinkron products.stok dari stok setengah jadi
-- ---------------------------------------------------------------------
create or replace function public.sync_product_stok()
returns void
language sql
security definer
set search_path to 'public'
as $$
  update public.products p
     set stok = s.porsi_tersedia
    from public.product_stock_source s
   where p.id::text = s.product_id
     and p.stok is distinct from s.porsi_tersedia;
$$;

create or replace function public.trg_sync_product_stok()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.sync_product_stok();
  return null;
end;
$$;

drop trigger if exists trg_ingredients_sync on public.ingredients;
create trigger trg_ingredients_sync
after insert or update of stock on public.ingredients
for each statement execute function public.trg_sync_product_stok();

drop trigger if exists trg_recipes_sync on public.recipes;
create trigger trg_recipes_sync
after insert or update of output_ingredient_id or delete on public.recipes
for each statement execute function public.trg_sync_product_stok();

drop trigger if exists trg_products_recipe_sync on public.products;
create trigger trg_products_recipe_sync
after update of resep_id, porsi_pcs on public.products
for each statement execute function public.trg_sync_product_stok();

-- ---------------------------------------------------------------------
-- 4. PRODUKSI: potong bahan mentah + tambah stok setengah jadi (atomik)
--    Perilaku pengurangan sama seperti tombol lama: stok bahan tidak di bawah 0.
-- ---------------------------------------------------------------------
create or replace function public.produce_batch(p_recipe_id text, p_batch numeric)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rec    public.recipes%rowtype;
  v_added  numeric := 0;
  v_name   text;
  v_rows   int;
begin
  if coalesce(p_batch, 0) <= 0 then
    raise exception 'Jumlah batch harus lebih dari 0';
  end if;

  select * into v_rec from recipes where id = p_recipe_id for update;
  if not found then
    raise exception 'Resep % tidak ditemukan', p_recipe_id;
  end if;

  -- Potong bahan mentah sesuai resep x batch
  update ingredients i
     set stock = round(greatest(0, coalesce(i.stock, 0) - agg.need), 2)
    from (select e->>'ingredientId' as ing_id,
                 sum((e->>'amount')::numeric) * p_batch as need
            from jsonb_array_elements(coalesce(v_rec.items, '[]'::jsonb)) e
           where coalesce((e->>'amount')::numeric, 0) > 0
           group by 1) agg
   where i.id = agg.ing_id
     and i.id is distinct from v_rec.output_ingredient_id;
  get diagnostics v_rows = row_count;

  -- Tambah stok setengah jadi
  if v_rec.output_ingredient_id is not null then
    v_added := p_batch * v_rec.output_qty;
    update ingredients
       set stock = coalesce(stock, 0) + v_added
     where id = v_rec.output_ingredient_id
    returning name into v_name;
  end if;

  return jsonb_build_object(
    'bahan_dikurangi', v_rows,
    'output_id',   v_rec.output_ingredient_id,
    'output_name', v_name,
    'output_added', v_added
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 5. ORDER: ubah stok untuk 1 produk x qty
--    p_sign = -1 (order / aktif lagi), +1 (batal / hapus)
--    Return false kalau stok kurang (hanya saat p_sign = -1).
-- ---------------------------------------------------------------------
create or replace function public.apply_product_stock(
  p_product_id text, p_qty int, p_sign int)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_src  public.product_stock_source%rowtype;
  v_need numeric;
  v_rows int;
begin
  if coalesce(p_qty, 0) <= 0 then
    return true;
  end if;

  select * into v_src from product_stock_source where product_id = p_product_id;

  if found then
    -- Produk dari stok setengah jadi
    v_need := v_src.porsi_pcs * p_qty;
    if p_sign < 0 then
      update ingredients set stock = stock - v_need
       where id = v_src.wip_id and stock >= v_need;
    else
      update ingredients set stock = coalesce(stock, 0) + v_need
       where id = v_src.wip_id;
    end if;
  else
    -- Produk tanpa stok setengah jadi: products.stok manual seperti dulu
    if p_sign < 0 then
      update products set stok = coalesce(stok, 0) - p_qty
       where id::text = p_product_id and coalesce(stok, 0) >= p_qty;
    else
      update products set stok = coalesce(stok, 0) + p_qty
       where id::text = p_product_id;
    end if;
  end if;

  get diagnostics v_rows = row_count;
  return v_rows > 0 or p_sign > 0;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Fungsi lama (nama & parameter sama)
-- ---------------------------------------------------------------------
create or replace function public.reduce_product_stock(p_product_id uuid, p_quantity integer)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  return public.apply_product_stock(p_product_id::text, p_quantity, -1);
end;
$$;

create or replace function public.update_order_status(p_key text, p_status text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_order public.orders%rowtype;
  v_item  jsonb;
  v_qty   int;
begin
  select * into v_order
    from public.orders
   where id::text = p_key or order_id = p_key
   for update;

  if not found then
    raise exception 'Pesanan tidak ditemukan';
  end if;

  if p_status = 'cancel' and not v_order.stock_restored then
    for v_item in select * from jsonb_array_elements(coalesce(v_order.items, '[]'::jsonb)) loop
      v_qty := coalesce((v_item->>'qty')::int, 0);
      continue when v_qty <= 0 or (v_item->>'id') is null;
      perform public.apply_product_stock(v_item->>'id', v_qty, +1);
    end loop;

    update public.orders
       set status = p_status, stock_restored = true, stock_restored_at = now()
     where id = v_order.id;

  elsif p_status <> 'cancel' and v_order.stock_restored then
    for v_item in select * from jsonb_array_elements(coalesce(v_order.items, '[]'::jsonb)) loop
      v_qty := coalesce((v_item->>'qty')::int, 0);
      continue when v_qty <= 0 or (v_item->>'id') is null;
      if not public.apply_product_stock(v_item->>'id', v_qty, -1) then
        raise exception 'Stok % tidak mencukupi untuk mengaktifkan kembali pesanan',
          coalesce(v_item->>'nama', v_item->>'name', v_item->>'id');
      end if;
    end loop;

    update public.orders
       set status = p_status, stock_restored = false, stock_restored_at = null
     where id = v_order.id;

  else
    update public.orders set status = p_status where id = v_order.id;
  end if;

  return jsonb_build_object('status', p_status,
    'stock_restored', (select stock_restored from public.orders where id = v_order.id));
end;
$$;

create or replace function public.delete_order(p_key text)
returns jsonb
language plpgsql
set search_path to 'public'
as $$
declare
  v_order    public.orders%rowtype;
  v_item     jsonb;
  v_qty      int;
  v_rows     int;
  v_restored boolean := false;
  v_done     int := 0;
  v_skipped  int := 0;
begin
  select * into v_order
    from public.orders
   where order_id = p_key or id::text = p_key
   limit 1
   for update;

  if not found then
    return jsonb_build_object('deleted', false, 'reason', 'not_found');
  end if;

  if lower(coalesce(v_order.status, 'new')) <> 'cancel'
     and coalesce(v_order.stock_restored, false) = false then
    for v_item in select * from jsonb_array_elements(coalesce(v_order.items::jsonb, '[]'::jsonb)) loop
      v_qty := coalesce((v_item->>'qty')::int, 0);
      continue when v_qty <= 0 or (v_item->>'id') is null;
      if exists (select 1 from public.products where id::text = v_item->>'id') then
        perform public.apply_product_stock(v_item->>'id', v_qty, +1);
        v_done := v_done + 1;
      else
        v_skipped := v_skipped + 1;
      end if;
    end loop;
    v_restored := true;
  end if;

  delete from public.orders where id = v_order.id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'Pesanan tidak bisa dihapus (tidak ada izin).';
  end if;

  return jsonb_build_object(
    'deleted', true,
    'stock_restored', v_restored,
    'restored_items', v_done,
    'skipped_items', v_skipped
  );
end;
$$;

commit;


-- =====================================================================
-- SETUP DATA (jalankan setelah migrasi; sesuaikan angka stok awal)
-- =====================================================================

-- A. Buat stok setengah jadi (isi stock dengan hasil hitung fisik sekarang)
-- insert into ingredients (id, name, unit, stock, price) values
--   ('wip_dimsum', 'Dimsum Setengah Jadi', 'pcs', 0, 0),
--   ('wip_lumpia', 'Lumpia Setengah Jadi', 'pcs', 0, 0),
--   ('wip_keju',   'Dimsum Keju Setengah Jadi', 'pcs', 0, 0)
-- on conflict (id) do nothing;

-- B. Hubungkan resep -> stok setengah jadi
--    Original & Mentai ke stok yang SAMA
-- update recipes set output_ingredient_id = 'wip_dimsum'
--  where id in ('8dd7a743-e7d6-4214-8d97-b41d350fb8ba',        -- Dimsum Original (1 Pcs)
--               'rec_219cfe40-4a2e-46fd-b536-8c1bfd1dfee1');   -- Dimsum Mentai (1 pcs)
-- update recipes set output_ingredient_id = 'wip_lumpia'
--  where id = 'rec_4785b597-5642-4df0-9792-dd6d5db8ea5e';      -- Lumpia Ayam Kukus & Goreng
-- update recipes set output_ingredient_id = 'wip_keju'
--  where id = 'rec_77849b39-4071-4ed5-b4b8-ab98e05c992c';      -- Dimsum Goreng Keju

-- C. Cek: semua produk Shumai Mentai harus pakai resep Mentai / Original
-- select nama, porsi_pcs, resep_id from products order by nama;

-- D. Lihat hasil
-- select product_name, porsi_pcs, wip_name, wip_stock, porsi_tersedia
--   from product_stock_source order by product_name;

-- E. Isi stok awal setengah jadi (contoh 100 pcs)
-- update ingredients set stock = 100 where id = 'wip_dimsum';
