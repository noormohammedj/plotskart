-- Undo 20261105000000_sales_targets.sql: monthly targets go (they only feed the team race screen).
drop function if exists public.set_sales_target(uuid, date, int, bigint);
drop table if exists public.sales_targets;
