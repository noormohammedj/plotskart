-- Accountant: records money in and out, sees finance and reports, but cannot manage the team,
-- change prices or layouts. Added on its own because a new enum value can't be used in the
-- same transaction that creates it.
alter type public.user_role add value if not exists 'accountant';
