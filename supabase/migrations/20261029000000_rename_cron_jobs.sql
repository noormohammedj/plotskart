-- Rebrand: rename the two pg_cron jobs to plotskart-*, keeping each job's schedule and command.
-- Rollback: supabase/rollbacks/20261029000000_rename_cron_jobs.down.sql
do $$
declare j record;
begin
  for j in select jobname, schedule, command from cron.job
           where jobname in ('pocketplot-daily-reminders', 'pocketplot-demo-cleanup') loop
    perform cron.unschedule(j.jobname);
    perform cron.schedule(replace(j.jobname, 'pocketplot-', 'plotskart-'), j.schedule, j.command);
  end loop;
end $$;
