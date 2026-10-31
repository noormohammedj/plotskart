# Plotskart: rules for every session

## Product
Plotskart (plotskart.in) is a B2B plot-inventory SaaS for real-estate developers in India and the UAE.
Roles: **owner**, **sales**, **broker**, **accountant**.

## Domains
| Address | Use |
| --- | --- |
| `plotskart.in` | Sales website (`website/`) |
| `app.plotskart.in` | Web app (`src/`, built to `dist/`) |
| `api.plotskart.in` | API proxy in front of Supabase |
| `demo.plotskart.in` | Demo app (separate Supabase project) |

## Stack
React + Vite + TypeScript, Capacitor 8 (app id `in.plotskart.app`), Supabase (Postgres, RLS, edge functions),
Firebase push, Meta WhatsApp Cloud API, MSG91 SMS.

## Rules
1. **All writes go through database functions** (security-definer RPCs that check the caller's role). The app never
   inserts, updates or deletes table rows directly.
2. **Money is `bigint` minor units** (paise for INR, fils for AED). Never `float`, `real`, `double precision` or
   JavaScript floating-point maths for money; format only at the edge.
3. **Every table has `company_id` with RLS** enabled and a policy scoped to the caller's company, plus an index on
   `company_id`. In policies, wrap `auth.uid()` and helper calls as `(select auth.uid())` so they run once per query.
4. **Never log PII**: no buyer names, phone numbers, emails, Aadhaar, PAN or document contents in logs, errors,
   analytics or edge-function output.
5. **Every migration is reversible and tested**: add a matching down script in `supabase/rollbacks/` and checks in
   `supabase/tests/` (`npm run test:db`) that apply the migration, roll it back and apply it again.
6. **Never edit production directly**: no SQL in the dashboard, no hand edits to live data. Changes go through
   migrations and deploy commands.
7. **Never hardcode a `*.supabase.co` URL.** Use configuration (`VITE_SUPABASE_URL`, later `api.plotskart.in` and
   remote config).
8. **Ask the user before any destructive migration** (dropping or renaming tables or columns, deleting data,
   tightening constraints on existing rows) and before running anything against production.

## Working notes
- The current schema still uses `org_id` (not `company_id`) and has money columns that predate rule 2; see
  `AUDIT.md` for the gaps. Don't widen them; fix them through planned migrations.
- Database tests run in PGlite: `npm run test:db`. Build with `npm run build`.
- On this Windows machine use `npx.cmd` / `npm.cmd` in PowerShell.
- `REBRAND.md` lists the outside-the-code steps of the rename to Plotskart.

## Mobile apps (Capacitor 8)
- Plan: `PLOTSKART-MOBILE-APP-PLAN.md`. Live status: `MOBILE-STATUS.md`; update it after every step.
- Commands: `npm run build:app` (web build + `cap sync`), `npm run android` (open Android Studio),
  `npm run android:apk` (debug APK), `npm run ios` (Mac only).
- Every native-only behaviour sits behind `Capacitor.isNativePlatform()` (see `src/lib/native.ts`); browsers must
  not notice any change. No demo, prices, plans or payment links inside the native apps.
- Sign-ins on phones live in `@capacitor/preferences` (`src/lib/authStorage.ts`), not WebView storage.
- Prefer official `@capacitor/*` plugins; `@capacitor-firebase/messaging` is kept for push (Firebase tokens on iOS).
- This laptop: `JAVA_HOME` = JDK 21 (Android Studio's Java 25 is too new for Gradle 8.14); emulator `plotskart_test`.
  Gradle builds outside OneDrive (`%USERPROFILE%\plotskart-android-build`) because OneDrive locks build files.
  Android SDK at `C:\Users\noorm\Android\Sdk`. Never install tools under AppData from Claude: the app's package container
  redirects new AppData folders to a private copy that the user's terminal and Android Studio can't see.
