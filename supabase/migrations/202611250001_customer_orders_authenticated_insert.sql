begin;

grant insert (
  user_id,
  reference,
  amount,
  items,
  payment_method,
  payment_status,
  order_status,
  phone_number
) on table public.customer_orders to authenticated;

drop policy if exists "Customers can create their own pending M-Pesa orders" on public.customer_orders;
create policy "Customers can create their own pending M-Pesa orders"
  on public.customer_orders for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and payment_method = 'mpesa'
    and payment_status = 'pending'
    and order_status = 'processing'
  );

commit;
