begin;

create table if not exists public.store_products (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(trim(name)) between 1 and 120),
  category text not null check (char_length(trim(category)) between 1 and 80),
  price integer not null check (price > 0),
  image_url text not null default '/products/fresh-milk.png',
  description text not null default '',
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists store_products_active_created_idx
  on public.store_products (is_active, created_at desc);

alter table public.store_products enable row level security;
revoke all on table public.store_products from anon, authenticated;
grant all on table public.store_products to service_role;

insert into public.store_products (name, category, price, image_url, description, stock_quantity)
values
  ('Fresh Milk', 'Dairy & Eggs', 70, '/products/fresh-milk.png', 'Fresh everyday milk.', 24),
  ('Bread', 'Bakery', 65, '/products/fresh-bread.png', 'Freshly baked bread.', 18),
  ('Rice', 'Pantry Staples', 180, '/products/rice.png', 'A pantry essential for everyday meals.', 32),
  ('Apples', 'Fruit & Veg', 30, '/products/apples.png', 'Crisp apples, sold individually.', 40),
  ('Eggs', 'Dairy & Eggs', 25, '/products/eggs.png', 'Fresh eggs, priced per egg.', 24),
  ('Juice', 'Drinks', 100, '/products/juice.png', 'A refreshing fruit drink.', 15)
on conflict (name) do nothing;

commit;
