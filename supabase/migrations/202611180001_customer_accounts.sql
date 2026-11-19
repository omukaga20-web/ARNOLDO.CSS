create table if not exists public.customer_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text unique,
  full_name text not null default '',
  phone_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists customer_profiles_phone_number_unique
  on public.customer_profiles (phone_number)
  where phone_number is not null and phone_number <> '';

create table if not exists public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null default 'Home' check (char_length(label) between 1 and 40),
  recipient_name text not null check (char_length(trim(recipient_name)) between 2 and 120),
  phone_number text not null check (char_length(phone_number) between 9 and 18),
  address_line1 text not null check (char_length(trim(address_line1)) between 3 and 200),
  address_line2 text check (address_line2 is null or char_length(address_line2) <= 200),
  city text not null check (char_length(trim(city)) between 2 and 80),
  county text check (county is null or char_length(county) <= 80),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists customer_addresses_one_default_per_user
  on public.customer_addresses (user_id)
  where is_default;
create index if not exists customer_addresses_user_created_idx
  on public.customer_addresses (user_id, created_at desc);

create table if not exists public.customer_cart_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  product_name text not null check (char_length(product_name) between 1 and 100),
  quantity integer not null check (quantity between 1 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, product_name)
);
create index if not exists customer_cart_items_user_idx
  on public.customer_cart_items (user_id, updated_at desc);

create table if not exists public.customer_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  reference uuid not null unique,
  amount integer not null check (amount > 0),
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  payment_method text not null check (payment_method in ('mpesa', 'card')),
  payment_status text not null default 'pending' check (payment_status in ('pending', 'completed', 'failed', 'cancelled')),
  order_status text not null default 'processing' check (order_status in ('processing', 'packed', 'out_for_delivery', 'delivered', 'cancelled')),
  phone_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists customer_orders_user_created_idx
  on public.customer_orders (user_id, created_at desc)
  where user_id is not null;
create index if not exists customer_orders_payment_status_idx
  on public.customer_orders (payment_status, updated_at desc);

create table if not exists public.customer_admins (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

create or replace function public.set_customer_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_customer_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  customer_name text;
  customer_phone text;
begin
  customer_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), '');
  customer_phone := nullif(trim(new.raw_user_meta_data ->> 'phone_number'), '');

  insert into public.customer_profiles (user_id, email, full_name, phone_number)
  values (new.id, lower(new.email), customer_name, customer_phone)
  on conflict (user_id) do update
    set email = excluded.email,
        full_name = case when excluded.full_name <> '' then excluded.full_name else public.customer_profiles.full_name end,
        phone_number = coalesce(excluded.phone_number, public.customer_profiles.phone_number),
        updated_at = now();

  return new;
end;
$$;

revoke all on function public.set_customer_updated_at() from public;
revoke all on function public.handle_new_customer_auth_user() from public;

drop trigger if exists customer_profiles_set_updated_at on public.customer_profiles;
create trigger customer_profiles_set_updated_at
  before update on public.customer_profiles
  for each row execute function public.set_customer_updated_at();
drop trigger if exists customer_addresses_set_updated_at on public.customer_addresses;
create trigger customer_addresses_set_updated_at
  before update on public.customer_addresses
  for each row execute function public.set_customer_updated_at();
drop trigger if exists customer_cart_items_set_updated_at on public.customer_cart_items;
create trigger customer_cart_items_set_updated_at
  before update on public.customer_cart_items
  for each row execute function public.set_customer_updated_at();
drop trigger if exists customer_orders_set_updated_at on public.customer_orders;
create trigger customer_orders_set_updated_at
  before update on public.customer_orders
  for each row execute function public.set_customer_updated_at();

drop trigger if exists on_auth_user_created_customer_profile on auth.users;
create trigger on_auth_user_created_customer_profile
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute function public.handle_new_customer_auth_user();

alter table public.customer_profiles enable row level security;
alter table public.customer_addresses enable row level security;
alter table public.customer_cart_items enable row level security;
alter table public.customer_orders enable row level security;
alter table public.customer_admins enable row level security;

drop policy if exists "Customers can read their profile" on public.customer_profiles;
create policy "Customers can read their profile"
  on public.customer_profiles for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "Customers can update their profile" on public.customer_profiles;
create policy "Customers can update their profile"
  on public.customer_profiles for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Customers manage their addresses" on public.customer_addresses;
create policy "Customers manage their addresses"
  on public.customer_addresses for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Customers manage their cart items" on public.customer_cart_items;
create policy "Customers manage their cart items"
  on public.customer_cart_items for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Customers can read their orders" on public.customer_orders;
create policy "Customers can read their orders"
  on public.customer_orders for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.customer_profiles, public.customer_addresses, public.customer_cart_items, public.customer_orders, public.customer_admins from anon, authenticated;
grant select on table public.customer_profiles to authenticated;
grant update (full_name, phone_number) on table public.customer_profiles to authenticated;
grant select, insert, update, delete on table public.customer_addresses, public.customer_cart_items to authenticated;
grant select on table public.customer_orders to authenticated;
grant all on table public.customer_profiles, public.customer_addresses, public.customer_cart_items, public.customer_orders, public.customer_admins to service_role;

drop policy if exists "Admins can read customer admin allowlist" on public.customer_admins;
insert into public.customer_admins (email)
values ('omukaga20@gmail.com')
on conflict (email) do nothing;
