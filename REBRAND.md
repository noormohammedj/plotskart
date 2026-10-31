# Rebrand: PocketPlot → Plotskart

The code, website, docs and Android project now say **Plotskart** and use the app id **`in.plotskart.app`**.
This file lists what still has to be changed **outside the code**, in the order to do it, plus what changed inside.

## Domain plan

| Address | What it serves |
| --- | --- |
| `plotskart.in`, `www.plotskart.in` | Sales website (`website/`) |
| `app.plotskart.in` | Web app (`dist/`) |
| `api.plotskart.in` | API proxy in front of Supabase (later phase) |
| `demo.plotskart.in` | Demo app (separate Supabase project, later phase; until then point it at the app site) |
| `app.plotskart.in/config.json` | Remote config (later phase) |
| `no-reply@plotskart.in` | Sender for sign-in and notification emails |

## What you need to do

### 1. DNS and Netlify (do first: every link in the code now points at plotskart.in)
1. At your domain registrar, add the DNS records Netlify asks for (Netlify → Domain management → *Add a domain*).
2. **Sales site** (the site whose id is in `package.json` → `deploy:website`): add `plotskart.in` as the primary
   domain and `www.plotskart.in` as an alias. Wait for HTTPS to turn on.
3. **App site** (the one linked in `.netlify/`, currently named `pocketplot-n2r`): add `app.plotskart.in` as the
   primary domain and, for now, `demo.plotskart.in` as an alias. Wait for HTTPS.
4. Optional: rename both Netlify sites (Site configuration → *Change site name*) to e.g. `plotskart-app` and
   `plotskart-site`. The old `*.netlify.app` addresses stop working when you rename, so do it after the custom
   domains are live.
5. Publish both: `npm run deploy` and `npm run deploy:website`. **Not done yet**: nothing has been published
   since the rebrand, so the live sites still show the old name.

### 2. Supabase (project ref `yyrxjsqhmfoncunjurga` stays the same)
1. **Project display name**: Settings → General → rename to Plotskart (the ref and URL do not change).
2. **Auth → URL configuration**: Site URL `https://app.plotskart.in`. Redirect URLs: `https://app.plotskart.in/**`,
   `https://demo.plotskart.in/**`, `http://localhost:5173/**`, `in.plotskart.app://**`.
3. **Auth → Email templates**: replace the old name in every template (Magic Link, Confirm signup, Invite, Change
   email), e.g. `Your Plotskart sign-in code is {{ .Token }}`.
4. **Auth → SMTP settings**: sender `no-reply@plotskart.in`, name `Plotskart`. You need an email service for the
   domain (Zoho Mail, Google Workspace, Amazon SES, Resend or Brevo) and its SPF, DKIM and DMARC records in DNS,
   or sign-in emails will land in spam.
5. **Database**: `npx supabase db push` applies both pending migrations together:
   `20261029000000_rename_cron_jobs.sql` (cron job names) and `20261030000000_save_layout_lock_plots.sql`
   (fixes the layout-save race in AUDIT.md §2). Rollbacks for both are in `supabase/rollbacks/`.
6. **Edge functions**: redeploy the three whose text changed:
   `npx supabase functions deploy deliver demo-start lead --use-api`.

### 3. Firebase (push notifications)
1. Firebase console → Project settings → *Add app* → **Android**, package `in.plotskart.app`. Download
   `google-services.json` into `android/app/`. There is no `google-services.json` in the project yet, so nothing
   breaks today, but push won't work on Android until this is in place.
2. *Add app* → **iOS**, bundle id `in.plotskart.app`. Download `GoogleService-Info.plist` into `ios/App/App/` once
   the iOS project is created on a Mac. Upload the APNs key under Cloud Messaging.
3. Remove the old `com.pocketplot.app` apps from Firebase once nothing uses them.
4. `FCM_SERVICE_ACCOUNT` stays the same if you keep the same Firebase project.

### 4. WhatsApp (Meta) and SMS (MSG91)
1. **WhatsApp display name**: change the business display name to Plotskart in WhatsApp Manager (Meta reviews it).
2. **WhatsApp templates** `booking_confirmation`, `registration_reminder`, `payment_reminder`: the code only uses
   their names, which have no brand in them. If any template body or footer mentions the old name, create a new
   version with Plotskart and wait for approval.
3. **MSG91 / DLT**: if your DLT sender ID (header) or template text contains the old name, register a new header
   (e.g. `PLTSKT`) and new templates on the DLT portal, then put the new template ids in the
   `MSG91_TEMPLATE_*` secrets.

### 5. App stores
Nothing has been uploaded yet, so `in.plotskart.app` becomes the permanent id on the first upload. Use the
Plotskart name, icon and screenshots in the Play Console and App Store Connect listings.

### 6. Images to retake after the sites are live
These are pictures, so the text change didn't reach them:
- `website/shots/*.webp` and `website/og.jpg`: app screenshots and the link preview still show the old name in the
  app's header. Retake them from the rebranded demo (the capture script in README → *Sales page*).
- `pricing/deck/img/`: same screenshots, used in the investor deck. Retake, then rebuild the deck.

## Things to know
- **Users sign in again on the new domain.** Browser storage belongs to each web address, so moving from
  `*.netlify.app` to `app.plotskart.in` starts every browser fresh (sign-in and theme). The storage migration below
  only helps people who keep using the same address.
- **Storage keys**: `pp-*` keys (theme, demo flag, demo tab, demo sign-ins, demo resume key) become `plotskart-*`.
  `src/lib/storageMigration.ts` copies them over once on first load and deletes the old keys; `index.html` reads
  the old theme key as a fallback so the theme doesn't flash. Normal sign-ins use Supabase's own key
  (`sb-<ref>-auth-token`), which doesn't change.
- **Demo companies** created before the rebrand have `@demo.pocketplot.app` emails. They keep working and are deleted
  by the cleanup job within 3 days.
- **Prototype**: `pocketplot.html` is now `plotskart.html`; its sample data uses a new storage key, so it starts from
  fresh sample data once.
- **Folder name**: the project folder on your computer is still called `PocketPlot`. Rename it in Explorer when
  no app has it open (it doesn't affect the code).
- **Old copies kept**: `pricing/PocketPlot_Investor_Plan.pdf` was open in another program, so it wasn't deleted.
  The new files are `pricing/Plotskart_*`.
- **No git commit**: git isn't installed on this computer and the folder isn't a repository, so this change isn't a
  separate commit. A copy of the project from before the rebrand was saved outside the project folder.

## What changed in the code
- Name and copy: every UI string, page title, README, sales site, demo copy, push title, enquiry email and the
  investor deck and pricing workbook (`pricing/Plotskart_*`).
- `capacitor.config.ts`: `appId: 'in.plotskart.app'`, `appName: 'Plotskart'`. Android: `namespace` and
  `applicationId` in `android/app/build.gradle`, `strings.xml`, and `MainActivity` moved to
  `android/app/src/main/java/in/plotskart/app/`.
- Links: sales site `https://plotskart.in`, app `https://app.plotskart.in`, demo `https://demo.plotskart.in/?demo`,
  demo emails `@demo.plotskart.in`.
- `package.json` name `plotskart`; `supabase/config.toml` project_id `plotskart` (local CLI only).
- pg_cron jobs renamed to `plotskart-daily-reminders` and `plotskart-demo-cleanup` by a new migration, with a
  tested rollback (`npm run test:db`).
- The old name is left only in the migrations that already ran on production (they are history and must not
  change), in the new rename migration and in its rollback (which must name the old jobs), and in this file.
