-- Undo 20261029000000_rename_cron_jobs.sql: give the pg_cron jobs their old names back.
do $$
declare j record;
begin
  for j in select jobname, schedule, command from cron.job
           where jobname in ('plotskart-daily-reminders', 'plotskart-demo-cleanup') loop
    perform cron.unschedule(j.jobname);
    perform cron.schedule(replace(j.jobname, 'plotskart-', 'pocketplot-'), j.schedule, j.command);
  end loop;
end $$;
