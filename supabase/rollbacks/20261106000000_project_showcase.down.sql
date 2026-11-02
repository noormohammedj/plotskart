-- Undo 20261106000000_project_showcase.sql: the customer showcase details go (projects and plots are untouched).
drop function if exists public.save_showcase(uuid, jsonb);
drop table if exists public.project_developments;
drop table if exists public.project_price_points;
drop table if exists public.project_showcase;
