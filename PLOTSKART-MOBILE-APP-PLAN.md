# Plotskart: web app → Android + iOS store apps

Instructions for Claude Code. Owner: Noor. Save this file in the repo root (`PocketPlot/`).

---

## What already exists (seen from the repo's folder structure, 28 Oct 2026)

- React + TypeScript + Vite app in `src/` (pages, components, `lib/scene3d.ts` for the 3D view, `lib/push.ts`, `lib/supabase.ts`).
- Supabase backend: migrations with matching rollbacks, edge functions (`deliver`, `read-layout`, `whatsapp-webhook`, `lead`, `demo-start`, `demo-switch`), DB tests in `supabase/tests/`.
- Web hosting on Netlify. Marketing site in `website/` and `plotskart.html`.
- **Capacitor is already set up.** `capacitor.config.ts` exists, the `android/` platform exists (package `in.plotskart`), and web assets were last synced into `android/app/src/main/assets/public` a while ago. **There is no `ios/` folder yet.**

So this is not a rebuild. It is: finish the native shell, add a few real native features, make it store-compliant, and set up builds that work from a Windows laptop.

---

## Rules for Claude Code (apply to every phase)

1. **One phase at a time.** Finish a phase, show what changed and what was tested, then STOP and wait for Noor's go-ahead.
2. **Browser users must not notice any change.** Wrap every native-only behaviour in `Capacitor.isNativePlatform()` / `Capacitor.getPlatform()`. The Netlify web app must keep working exactly as today.
3. **Do not touch** `website/`, `marketing/`, `pricing/`, `plotskart.html` or the site3d build, except where a phase says so.
4. **Database changes** follow the repo's existing pattern: a new migration in `supabase/migrations/` plus a matching `.down.sql` in `supabase/rollbacks/`. Run `supabase/tests/db.test.mjs` before and after.
5. **Never commit secrets.** That covers the Android keystore, App Store Connect API key, Firebase service account and FCM keys. The app bundle may only ever contain the Supabase **anon** key; the service-role key must never be in it. Check that `.env` is in `.gitignore`.
6. **Flag for Noor's careful review** (not a quick "looks fine") anything touching login, sessions, account deletion, customer personal data, push tokens, or money/finance screens.
7. Prefer official `@capacitor/*` plugins. Add a third-party plugin only if no official one exists, and say why.
8. Keep `CLAUDE.md` updated with the new commands and the mobile section when done.

---

## Phase 0: Audit only (no code changes)

Read and report back, in plain language:

- `package.json`: Capacitor version, router type (browser vs hash), build scripts.
- `capacitor.config.ts`: `appId`, `appName`, `webDir`, and whether `server.url` points at a live website. **We want the app to ship the built files inside it (bundled), not load the live website.** Apple rejects apps that are only a remote website.
- `vite.config.ts`: confirm the app build outputs only the app, not the marketing site.
- `src/lib/supabase.ts`: where the login session is stored. On phones, WebView storage can be wiped, which logs users out.
- `src/pages/Auth.tsx`: login method (email OTP code? magic link? password?). **Magic links need deep-link setup in an app; a typed OTP code does not.**
- `src/lib/push.ts`: what it does today. Web Push doesn't work inside the native app.
- Edge functions: their CORS headers. Native apps call from the origins `capacitor://localhost` (iOS) and `https://localhost` (Android); these must be allowed.
- Every external link: `wa.me`, `tel:`, `mailto:`, `https://` to other sites. Inside the app these must open the WhatsApp/phone/browser app, not inside the WebView.
- Any pricing, "upgrade", order or payment link reachable after login.
- Whether a user can **create an account** inside the app (decides whether in-app account deletion is mandatory).
- The size of the 3D code path and any WebGL settings: performance on cheap Android phones is the biggest technical risk.

Output: a short report plus a list of anything that blocks the later phases.

---

## Phase 1: A solid native shell (Android first, iOS project created)

1. **Bundled build**: `webDir: 'dist'`, no `server.url` in production. Add scripts:
   - `npm run build:app` → app build + `npx cap sync`
   - `npm run android` → build + open Android Studio
2. **Add iOS**: `npx cap add ios`. If the installed Capacitor version supports Swift Package Manager for iOS, use it instead of CocoaPods (CocoaPods needs a Mac). Commit the `ios/` folder. It can't be compiled on Windows; that happens in the cloud in Phase 4.
3. **Login sessions that survive**: give the Supabase client a storage adapter backed by `@capacitor/preferences` on native (localStorage stays on web). Migrate existing sessions once.
4. **Auth flow on native**: if login uses magic links, switch the native app to typed OTP codes (simplest, no deep links). Only set up Android App Links / iOS Universal Links if a link-based flow is truly needed, and ask Noor first.
5. **CORS**: allow `capacitor://localhost` and `https://localhost` in every edge function the app calls. Keep the existing web origins.
6. **Phone basics**:
   - Safe areas (notch/home bar) via `env(safe-area-inset-*)`. `viewport-fit=cover` is already set.
   - `@capacitor/status-bar` + `@capacitor/splash-screen` (brand colour `#0B1418`).
   - `@capacitor/keyboard`: inputs must not hide behind the keyboard (finance forms, plot sheet).
   - **Android back button** (`@capacitor/app`): close open sheet/modal → go back a page → on Home, press twice to exit.
   - External links via `@capacitor/app-launcher` / `@capacitor/browser`: WhatsApp, phone, email, PDFs.
   - **Realtime on resume**: when the app returns from background, reconnect the Supabase realtime channel and refetch, so "booked by someone else" shows straight away. The "no double booking" promise depends on this.
   - Offline banner via `@capacitor/network`. No offline editing (out of scope).
7. **Icons and splash** from one source image using `@capacitor/assets`.
8. **Hide sales/pricing inside the native apps**: no plan prices, "upgrade", order form or payment links after login. Selling happens on the website and on sales calls. Apple and Google both have billing rules for purchases inside apps, so keep the app login-only.

Test: Android build on a real cheap Android phone (₹8–12k class) and Noor's phone. Check login, 3D view, booking sync between two phones, back button, keyboard, notch.

---

## Phase 2: Native features (the reason the app deserves to be in the stores)

1. **Push notifications** (`@capacitor/push-notifications`, FCM for both Android and iOS)
   - New table for device tokens: user, company, platform, token, last seen. RLS: users manage only their own tokens. Migration + rollback.
   - Register the token after login; delete it on logout and on account deletion.
   - Extend the existing `deliver` function (or add `push-send`) to send through **FCM HTTP v1**. The service account goes in Supabase secrets.
   - Events: plot/flat booked or sold (team), special price set (team), instalment due tomorrow (owner/accountant/assigned salesperson), registration in 2 days.
   - Respect roles: brokers never get finance alerts.
   - Tapping a notification opens the right plot/project screen.
   - Keep `lib/push.ts` web push for browser users if it works today.
2. **Camera for layouts** (`@capacitor/camera`): on New Project / Edit Layout, add "Take photo" and "Choose from gallery", plus the existing PDF/file picker, feeding the same `read-layout` flow.
3. **Share receipts** (`@capacitor/share` + `@capacitor/filesystem`): on `Receipt.tsx`, create the receipt as a PDF or image and open the share sheet (WhatsApp first). This replaces any print/download flow on native.
4. Optional, only if quick: `@capacitor/haptics` on booking success.

Noor provides: a Firebase project, and the **APNs key (.p8)** from the Apple Developer account, uploaded to Firebase for iOS push.

---

## Phase 3: Store compliance

1. **Account deletion inside the app** (Apple requires this if users can create accounts in the app). Settings → Delete account → confirm → edge function. Decide with Noor:
   - Team member deletes self: remove login and personal data; keep company records (bookings, receipts) with the name replaced by "Former member".
   - **Owner deletion = deleting the company's data.** Needs a stronger confirmation and an export offer first. **Noor must approve the exact behaviour.**
2. **Permission texts**: iOS `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription` (plain, specific: "To photograph your layout drawing"). Android: only the permissions actually used, plus `POST_NOTIFICATIONS` for Android 13+.
3. **Privacy policy and terms pages** on plotskart.in (URLs needed by both stores). Draft text, mark it **DRAFT, needs Noor/legal review**.
4. **Data inventory** for the App Store privacy label and Play "Data safety" form: account data (name, phone, email), **buyer personal data entered by teams**, financial records, photos/drawings, device push tokens, any analytics. Write it as a table in `STORE-LISTING.md`.
5. **Review account**: a stable reviewer login (owner role, sample company) that is **not** reset by the 3-day demo cleanup. Put its credentials only in the store review notes, never in the code.
6. **Store listing pack** (`STORE-LISTING.md`): name, short + long description, keywords, category (Business), support URL, screenshots list (phone sizes for both stores), review notes explaining the B2B login.
7. **Out of scope**: per-client branded apps (Business tier). Do not build app variants/flavours. That's a separate decision for Noor because of Apple guideline 4.2.6.

---

## Phase 4: Builds and release, without a Mac

**Android (on the Windows laptop):**
- Generate the upload keystore **once**; Noor stores it plus its passwords outside the repo (password manager + offline backup). Losing it is painful.
- Signed **AAB** via Gradle; enroll in Play App Signing.
- Version script: one command bumps `versionName`/`versionCode` and the iOS version together.

**iOS (cloud Mac):**
- Pick one cloud builder, recommended **Codemagic** (has a free monthly macOS allowance; check current limits). Alternatives: Capawesome Cloud, Capgo Build.
- Claude Code writes the config (`codemagic.yaml`), using an **App Store Connect API key** that Noor creates and stores only in Codemagic's secrets.
- Pipeline: build → sign → upload to **TestFlight**.

**Release order:** Android internal testing → Android closed testing → iOS TestFlight → both production.

---

## Phase 5: Real-device test checklist (before submitting)

| Area | Check |
|---|---|
| Login | Login, stay logged in after closing the app for a day, logout, role switching |
| 3D | Smooth on a cheap Android and on iPhone; no crash after 5 minutes of turning/zooming |
| Live sync | Book on phone A → phone B shows yellow within a second, also after B was in the background |
| Layout | Camera photo → AI read → edit → save |
| Push | Booking alert arrives; tapping it opens that plot; broker gets no finance alerts |
| Receipt | Share to WhatsApp as PDF |
| Phone basics | Back button, keyboard, notch, large system font, dark mode, airplane mode banner |
| No sales | No prices/upgrade/payment anywhere inside the native apps |
| Delete | Account deletion works and matches the agreed rule |

---

## Noor's to-do list (not code; start now, some take weeks)

1. **Apple Developer Program**: enroll as an **organisation** (the seller name shown will be your company). Needs a registered entity and a D-U-N-S number (free, can take days to weeks). $99/year.
2. **Google Play Console**: an **organisation** account ($25 one-time). Check the current rule: new *personal* accounts must run a closed test with testers for a minimum period before going to production.
3. **Firebase project** for push; upload the APNs .p8 key once Apple is approved.
4. **Test phones**: a second-hand iPhone and a cheap Android.
5. **Business tier decision**: change "your name and logo in the app stores" to "your logo inside the Plotskart app", or require each Business client to have their own Apple developer account.
6. **Privacy policy + terms**: review the drafts from Phase 3.

## Rough timeline (solo, with Claude Code)

| Phase | Time |
|---|---|
| 0 | half a day |
| 1 | 3–5 days |
| 2 | 4–6 days |
| 3 | 2–3 days |
| 4 | 1–2 days, plus Apple/Google account waiting time |
| 5 | 2–3 days, then 1–3 rounds of store review |

**Total: about 3–5 weeks** of part-time work, with the Apple organisation enrollment usually the slowest step.
