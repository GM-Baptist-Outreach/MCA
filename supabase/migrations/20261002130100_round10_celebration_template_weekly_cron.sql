-- Round 10 (additive): celebration email template and the Monday weekly
-- summary cron. Marker: MCA_R10_TEMPLATE_CRON

insert into public.email_templates (key, name, description, subject, body_html, enabled, variables, default_subject, default_body_html)
values (
  'celebration',
  'Celebration (level or school year finished)',
  'Sent when a student finishes a PACE level in a subject, or every PACE of a school year, through an uploaded test. Turn it on or off under Automatic emails above.',
  'Congratulations, {{student_name}}! {{celebration_title}}',
  $html$<div style="font-family: Georgia, serif; color: #1a1a2e; max-width: 600px;">
  <p style="font-size: 40px; margin: 0;">&#127881;</p>
  <h2 style="margin-top: 8px;">Congratulations, {{student_name}}!</h2>
  <p>Hi {{parent_first_name}},</p>
  <p>We just recorded a big milestone: <strong>{{student_name}} {{celebration_line}}</strong>. That takes steady, faithful work, and we're proud of you both.</p>
  <p>Sign in to the Parent Portal to see the celebration and what's next: <a href="{{portal_url}}">{{portal_url}}</a></p>
  <p>"Whatever you do, work at it with all your heart." Colossians 3:23</p>
  <p>Midwest Christian Academy · (844) 663-4477</p>
</div>$html$,
  true,
  '["parent_first_name", "student_name", "celebration_title", "celebration_line", "portal_url"]'::jsonb,
  'Congratulations, {{student_name}}! {{celebration_title}}',
  $html$<div style="font-family: Georgia, serif; color: #1a1a2e; max-width: 600px;">
  <p style="font-size: 40px; margin: 0;">&#127881;</p>
  <h2 style="margin-top: 8px;">Congratulations, {{student_name}}!</h2>
  <p>Hi {{parent_first_name}},</p>
  <p>We just recorded a big milestone: <strong>{{student_name}} {{celebration_line}}</strong>. That takes steady, faithful work, and we're proud of you both.</p>
  <p>Sign in to the Parent Portal to see the celebration and what's next: <a href="{{portal_url}}">{{portal_url}}</a></p>
  <p>"Whatever you do, work at it with all your heart." Colossians 3:23</p>
  <p>Midwest Christian Academy · (844) 663-4477</p>
</div>$html$
)
on conflict (key) do nothing;

-- Mondays 12:00 UTC = 8:00 AM Eastern (7:00 AM in winter). The function
-- checks the Settings switch and logs a "skipped" run when it's off.
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'mca-weekly-summary';
end $$;

select cron.schedule(
  'mca-weekly-summary',
  '0 12 * * 1',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'mca_project_url')
           || '/functions/v1/weekly-summary',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'mca_anon_key'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'mca_anon_key'),
      'x-cron-secret', public.mca_get_cron_secret()
    ),
    body := '{"action":"send"}'::jsonb,
    timeout_milliseconds := 120000
  ) as request_id;
  $cron$
);
