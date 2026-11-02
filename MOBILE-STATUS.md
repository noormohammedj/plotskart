# Plotskart mobile apps: status

The live tracker for [PLOTSKART-MOBILE-APP-PLAN.md](PLOTSKART-MOBILE-APP-PLAN.md). Updated after every piece of work.
Goal: a fully working Plotskart app in the Google Play Store and the Apple App Store.

**Status:** ⬜ to do · 🔵 in progress · ✅ done · ⏳ waiting on Noor · 🧪 built, needs a real-phone test

Last updated: 28 Oct 2026 (Phase 2, waiting on Firebase)

## Where we left (start here next time)

Noor is creating the Firebase project (B1) and deciding the Apple Developer enrolment (see Noor's to-do list).
When Firebase is in: rebuild, register a phone on the emulator, get Noor's OK to push migration 20261103000000
to production, test a real push end to end, then Phase 3.

## Blockers from the Phase 0 audit

| # | Blocker | Who | Phase | Status |
|---|---|---|---|---|
| B1 | Push can't send: no Firebase project, no `google-services.json`, no `FCM_SERVICE_ACCOUNT` secret | Noor creates Firebase project; Claude wires it | 2 | ⏳ |
| B2 | Logins kept in WebView storage, which phones can wipe | Claude | 1 | ✅ |
| B3 | Anyone can sign up, so Apple requires account deletion inside the app | Claude builds; Noor approves the rule | 3 | ⬜ |
| B4 | Sign-in codes go through Supabase's built-in mailer (a few emails an hour) | Noor picks a mail provider; Claude sets SMTP | 1 | ⏳ |
| B5 | Device-token table has no company column and the app writes it directly (CLAUDE.md rules 1 and 3) | Claude | 2 | ✅ migration 20261103000000 + rollback + 13 tests; not on production yet |
| B6 | Demo inside the app links to plotskart.in prices (store purchase rules) | Claude: hide demo on native | 1 | ✅ |
| B7 | No refresh when the app comes back from the background ("booked by someone else" shows late) | Claude | 1 | ✅ |
| B8 | WhatsApp, Maps, document links and receipt printing don't work right inside the app | Claude | 1 and 2 | ✅ links (Phase 1); receipts share as PDF (Phase 2) |
| B9 | 3D allows 2× pixels and big shadows on cheap phones | Claude | 1 | ✅ |
| B10 | Android project out of date (old web files, version 1.0, no signing, missing plugins); no iOS project | Claude; signing key with Noor | 1 and 4 | 🔵 plugins, icons, iOS project done; signing and versions in Phase 4 |

## Phases

| Phase | What | Status |
|---|---|---|
| 0 | Audit | ✅ 28 Oct |
| 1 | Native shell: sessions, iOS project, back button, keyboard, status bar, splash, links, resume refresh, offline banner, icons, no sales/demo | ✅ built and emulator-tested 28 Oct; waiting for Noor's review |
| 2 | Push, camera for layouts, share receipts | 🔵 built and emulator-tested 28 Oct except sending pushes, which waits for Firebase (B1) |
| 3 | Account deletion, permission texts, privacy policy and terms, store listing, review account | ⬜ |
| 4 | Signed Android build; iOS cloud build to TestFlight | ⬜ |
| 5 | Real-device test checklist, then submit | ⬜ |

### Phase 1 detail

| Item | Status | Notes |
|---|---|---|
| Logins survive app restarts (`@capacitor/preferences`) | ✅ | B2. `src/lib/authStorage.ts`. Emulator: an old WebView session moved across, survived a WebView wipe and two restarts. Recheck on a real phone in Phase 5. |
| `npm run build:app` / `npm run android` / `npm run android:apk` scripts | ✅ | `scripts/gradle.mjs` runs Gradle on Windows and Mac |
| iOS project (`npx cap add ios`, Swift Package Manager) | ✅ | No CocoaPods. Builds on the Mac (Xcode 27.2) and runs in the iPhone 18 Pro simulator to the sign-in screen, 30 Oct |
| Hide demo and anything sales-related on native | ✅ | B6. No demo link, `?demo` ignored in the apps; no prices anywhere after sign-in (checked in Phase 0) |
| Refresh and reconnect when the app resumes | ✅ | B7. Emulator: after 4 s in the background the app reloaded and rejoined the live channel |
| Open WhatsApp, phone, Maps and documents in their own apps | ✅ | B8. Emulator: Maps link opened Google Maps; wa.me went to Android (emulator has no WhatsApp, so Chrome). Documents open in an in-app browser. "Print" is hidden in the apps until receipt sharing (Phase 2) |
| Android back button: press twice on Home to exit | ✅ | Emulator: sheet closes, then back a screen, then "Press back again", then exits |
| Status bar, splash (#0B1418), keyboard | 🧪 | Splash: brand colour on Android 12+ (checked). Status bar icons follow the theme; on WebViews older than Chrome 140 they stay dark on Android's white bar (checked on the emulator's Chrome 124). Keyboard: fields scroll above it; the emulator only shows its floating bar, so check on a real phone |
| Offline banner | ✅ | Emulator: Wi-Fi and data off shows the banner; back on hides it |
| Lighter 3D on low-end phones | ✅ | B9. ≤4 cores or ≤4 GB: 1.25× pixels, plainer shadows. Emulator (4 cores, 2 GB) drew 3D at 485 px wide instead of 776. Real cheap-phone check in Phase 5 |
| Icons and splash images (`@capacitor/assets`) | ✅ | Sources in `assets/` (drawn from the Plotskart mark); 74 Android and 7 iOS images |
| Custom SMTP for sign-in codes | ⏳ | B4 |
| Test on a cheap Android and Noor's phone | ⬜ | Emulator `plotskart_test` (Pixel 6, Android 15) works meanwhile |
| Ask for notification permission at a sensible moment, not straight after sign-in | ⬜ | Seen on the emulator; fix with push in Phase 2 |

## This laptop's Android setup

- Android Studio: `C:\Program Files\Android\Android Studio`
- Android SDK: `C:\Users\noorm\Android\Sdk` (platform 36, build tools 36, emulator, Android 15 image); `ANDROID_HOME` and `android/local.properties` (not committed) point there.
  Not under AppData: the Claude app runs in a Windows package container that saves new AppData folders into its own private copy,
  so the user's terminal and Android Studio couldn't see an SDK installed there (moved 28 Oct).
- JDK 21 for Gradle: `%LOCALAPPDATA%\Programs\jdk21\jdk-21.0.13.0.2+1` (set `JAVA_HOME` to it; Android Studio's own Java 25 is too new for Gradle 8.14)
- Emulator: `plotskart_test` (laptop keyboard passes through: `hw.keyboard=yes` in its `config.ini`); start it with `C:\Users\noorm\Android\Sdk\emulator\emulator.exe -avd plotskart_test`. Debug build: `npm run android:apk` (about 6.5 MB APK in `%USERPROFILE%\plotskart-android-build\app\outputs\apk\debug`)

### Phase 2 detail

| Item | Status | Notes |
|---|---|---|
| Device tokens through database functions, scoped to the company (B5) | ✅ | `register_device` / `unregister_device`; direct writes revoked; a phone that changes hands moves to the new person. 13 checks in `npm run test:db` (198 pass). Needs `supabase db push` to production with Noor's OK |
| Ask for notification permission at a sensible moment | ✅ | "Get alerts on this phone" card on Home (phones only), never on sign-in. Android says "denied" before it has ever asked, so the app records when it asked. Emulator: card shows, Allow works, card goes |
| Send pushes (FCM HTTP v1 in `deliver`, already written) | ⏳ | Waits for B1: Firebase project, `google-services.json`, `GoogleService-Info.plist`, `FCM_SERVICE_ACCOUNT` secret. Emulator today: permission granted, then "Default FirebaseApp is not initialized", handled without a crash |
| Tap a notification opens the plot | ⬜ | Code exists in `src/lib/push.ts`; test once pushes arrive |
| Brokers never get finance alerts | ⬜ | Recipients are chosen by the database functions that write `notifications`; check with real pushes |
| Camera for layouts (`@capacitor/camera`) | ✅ | New project: Take a photo / Choose from gallery / Choose a PDF or file; Edit layout: same. Same upload and AI reading as the browser. No Android permissions needed; iOS camera and photo texts added. Emulator: camera opens, cancelling returns cleanly. Not tested: a real photo through the AI reader (costs a read) |
| Share receipts as PDF (`@capacitor/share` + `@capacitor/filesystem` + `jspdf`) | ✅ | "Share as PDF" on the receipt (phones only; browsers keep Print). One A4 page drawn with the app's fonts, so ₹ prints. Emulator: share sheet opens with `Receipt-DEM-00018.pdf`; PDF checked. Says "Flat" on apartment receipts |
| Haptics on booking | ⬜ | Optional; not done |

## Noor's to-do list

| Item | Why | Status |
|---|---|---|
| Apple Developer Program: enrol at developer.apple.com/programs/enroll (or the Apple Developer iPhone app), US$99/yr. Use a new Apple Account on a plotskart.in mailbox (set one up first), not a personal Apple ID. Organisation if Plotskart is a registered Pvt Ltd/LLP (get the free D-U-N-S number first); otherwise Individual now, convert later | Needed for TestFlight and the App Store; organisation enrolment can take weeks | ⏳ Plotskart belongs to INRAA Solution Pvt Limited, registration in progress (28 Oct). Once incorporated: get the D-U-N-S number, then enrol as an organisation |
| Google Play Console as an organisation (INRAA Solution Pvt Limited; also needs the D-U-N-S number) | Needed for Play; personal accounts must run a closed test first | ⏳ after incorporation |
| Name the company on plotskart.in (footer, privacy policy, terms): "Plotskart is a product of INRAA Solution Pvt Limited" | Apple and Google check the website belongs to the organisation | ⬜ once the legal name is final |
| Firebase project "Plotskart" (Android app `in.plotskart.app` + iOS app) | Push notifications (B1) | ⬜ |
| **After Apple approves the developer account:** Apple Developer → Keys → new key with Apple Push Notifications service (APNs) → download the `.p8` (shown only once; keep it outside the repo, in the password manager). Then Firebase → Project settings → Cloud Messaging → Apple app configuration → APNs Authentication Key → Upload, with the Key ID and Team ID | iPhone push won't arrive without it | ⏳ waiting on Apple |
| Mail provider for sign-in codes (e.g. Resend, Brevo, Zoho, GoDaddy mailbox) | B4 | ⬜ |
| Android Studio on this laptop | Installed 28 Oct (with SDK 36, build tools, emulator, JDK 21) | ✅ |
| Test phones: a cheap Android (₹8–12k) and an iPhone | Phase 1 and 5 tests | ⬜ |
| Mac | Set up 30 Oct: Xcode 27.2 + iOS 27.2 simulator, Node 24 in `~/.local/node`, repo at `~/Developer/plotskart`. The iOS app builds and runs in the simulator. For now it uses Noor's personal Apple account; the store app must be created under the organisation "PLOTSKART powered by INRAA Solution Pvt Limited" once incorporated | ✅ |
| Business tier wording ("your logo inside the Plotskart app") | Apple rule 4.2.6 | ⬜ |

## Still to check on a real phone (Phase 5)

- A real layout photo from the camera through the AI reader
- Camera on a low-memory phone: Android may close the app while the camera is open (handle `appRestoredResult` if it happens)
- Receipt PDF shared into WhatsApp

- Keyboard over the plot sheet and finance forms
- Status bar and notch with a current WebView (Chrome 140+ draws the page behind the bar)
- 3D smoothness on a ₹8–12k Android
- WhatsApp links opening WhatsApp

## Decisions

| Date | Decision |
|---|---|
| 28 Oct 2026 | Track the work in this file, updated after every step. |
| 28 Oct 2026 | Recommended: keep `@capacitor-firebase/messaging` (gives a Firebase token on iPhone too) instead of `@capacitor/push-notifications`. Awaiting Noor's OK. |
| 28 Oct 2026 | Recommended: no demo inside the native apps; store reviewers get a fixed review account (Phase 3). Awaiting Noor's OK. |

## Log

- 28 Oct 2026: Phase 0 audit done. Tracker created.
- 28 Oct 2026: Android Studio, SDK, emulator and JDK 21 installed; the Android app builds and runs on the emulator.
- 28 Oct 2026: Phone layout audit: the project toolbar made pages wider than the phone (cut off, odd sideways scroll); fixed, and sideways-scrolling tabs, tables and charts now fade at the edge with more. Every screen checked at 360, 390 and 412 px and on the emulator.
- 28 Oct 2026: Phase 2 built (except sending pushes): device tokens via database functions (B5), alerts card, camera for layouts, receipts shared as PDF. All emulator-tested.
- 28 Oct 2026: Emulator wouldn't start from Noor's terminal: the SDK had been saved inside the Claude app's private AppData copy. Moved it to `C:\Users\noorm\Android\Sdk`, build output to `%USERPROFILE%\plotskart-android-build`.
- 28 Oct 2026: Phase 1 built and tested on the emulator: build scripts, demo hidden (B6), refresh on resume (B7),
  outside links (B8), back twice to exit, status bar, splash, keyboard handling, offline banner, lighter 3D (B9),
  icons and splash images, iOS project (SPM). Fixed on the way: Gradle builds outside OneDrive (it locked files),
  JAVA_HOME set to JDK 21 for this Windows user. Waiting for Noor's review before Phase 2.
- 28 Oct 2026: B2 built: sign-in kept in native storage on phones, moved across once from WebView storage; web and demo unchanged. Tested on the emulator: passes.
- 30 Oct 2026: Mac set up (Xcode 27.2, iOS 27.2 simulator, Node 24). `npm run build` + `cap sync ios` + Xcode build succeed; the app launches in the iPhone 18 Pro simulator to the sign-in screen. Runs without `GoogleService-Info.plist` (push stays off until the Firebase iOS app exists). Signing: personal Apple account for now; move to the INRAA Solution Pvt Limited organisation account once incorporated.
- 31 Oct 2026: iPhone signing set up with Noor's free Personal Team (NL7J62CPU4), Debug only, under the separate bundle ID `in.plotskart.app.dev` so `in.plotskart.app` stays free for the INRAA Solution Pvt Limited organisation account. Release keeps `in.plotskart.app` and has no team. Signed build for the iPhone 15 succeeds; free-account installs expire after 7 days. When Firebase is added, the Debug build needs its own iOS app entry for `in.plotskart.app.dev`.
- 31 Oct 2026: Phone app tabs per Noor's spec. Owner/accountant: Home, Projects, Alerts, Finance, Team; sales/broker: Home, Projects, Alerts, Team (no Finance; Activity on the bell). Web menu unchanged. New: team performance (earned today + month race with commission, pipeline) on Home and Team (`src/lib/teamBoard.ts`, `TeamPerformance`); Team tab for sales/brokers (`MyTeam`: own earned/paid/pending, pipeline, sold); Alerts add commission to pay, bills to pay (marketing first) and latest bookings/sales; Finance cost heads Approvals, Layout development, Water tank, Compound wall, Survey & stones, plus cost per sq ft (land purchase rate, development, all-in, margin); 3D layouts show schools, hospitals, stations and shops within 5 km from OpenStreetMap when the project has a location; "Use my current location" on new projects (iOS and Android location permission added). No migration needed: members already read their own commission payments. Typecheck, build and `npm run test:db` (239) pass; app launches in the simulator. Not yet checked signed in: needs a test company (live and demo share one Supabase project).
- 31 Oct 2026: Checked signed in with a demo company at phone width (owner, then Priya and Ravi as sales): 5 tabs for the owner; Team performance on Home; Alerts show commission to pay and bills to pay (owner only), and the alerts now come before the WhatsApp and timing settings; cost per sq ft adds up; sales staff get no Finance, no "Add a project", and their own earned/paid/pending and pipeline; a test sale by Priya showed as "Earned today ₹47,425" for Ravi, with the sale notification. Nearby places: the public OpenStreetMap servers were all overloaded (429/504/timeouts), so the app now tries two mirrors, gives up quietly and never caches an empty answer; pins checked with sample places. Follow-up: look places up once per project on the server and store them, so phones never depend on the busy public servers. Note: live and demo share one Supabase project (CLAUDE.md says separate).
- 2 Nov 2026: New phone design, phase 1 (Noor's "clean iOS app" brief; built as a new phone UI in the same project so iPhone and Android both get it, same database). Code in `src/m/`; runs in the iPhone/Android apps, and in a browser with `?ui=phone` (`?ui=web` to go back). Web app unchanged. Tabs for everyone: Home, Projects, Race, Alerts, More. Owner/accountant Home = executive dashboard (portfolio ring, sold/collected this month, cash, due from buyers, profit by project, 6-month sales and cash-flow charts, team race top 3 with "who needs what" coaching, coming-up dates). Sales/broker Home = monthly target ring, weekly streak, race position, commission today/paid/pending, pipeline. Race: podium, animated lanes, Today/This month/Last month/Streaks, points (booking 1, registration 2, sale 3); owner sets monthly targets. Alerts: booked, sold, registered, cancelled (available again), payments, filters by type. Screens not yet redesigned (project page, new project, finance, team admin, reminders, activity, receipts) open inside the new shell with their current look. Haptics via `@capacitor/haptics`. New migration `20261105000000_sales_targets` (+ rollback, tests pass); applied to Supabase on 2 Nov 2026 with Noor's go-ahead (`supabase db push`, dry run first: it was the only pending migration). Checked live: the demo owner set a target (5 units, ₹50 L) and the race shows it. Checked in the browser with the demo company (owner, then Priya) in light and dark, and in the iPhone 18 Pro simulator (signed in as Rihana): Home and Projects draw correctly. Fixed on the way: iOS zoomed the whole app ~10% after a small text box was tapped and never zoomed back, so the phone apps now turn page zoom off (`lockZoom` in `src/lib/native.ts`; browsers keep pinch-zoom); page entrance animations no longer pin the + button and sheets to the page.
- 2 Nov 2026: Phone app phase 2, customer showcase (`src/m/Showcase.tsx`, route `#/show/<project>`, "Show customer" on every project card). Full-screen, customer-safe (no buyers, commission or costs): cover with starting price and how much is taken ("only N left" when few remain), live 3D layout (tap a plot to open it), amenities, nearby places (OpenStreetMap, 5 km), price journey (past rates, today's rate, projections at +4 and +10 years, worked out in whole paise; growth = owner's figure or the average yearly growth since the oldest past rate), what's coming up nearby, the open plots with size, facing and price, and "Share with the customer on WhatsApp" (text summary with a map link). Sticky section chips follow the scroll. Owner edits it at `#/show/<project>/edit` (pitch, amenities, past rates, growth %, developments). Migration `20261106000000_project_showcase` (3 tables + `save_showcase`; rollback and tests pass). Applied to Supabase on 2 Nov 2026 with Noor's go-ahead (only pending migration). Checked live: the demo owner saved a showcase for Jatwada Greens (pitch, 7 amenities, 2016 ₹650 and 2021 ₹1,100, a metro line due 2029); the price chart shows 11.0% a year, ₹2,811 in 2030 and ₹5,267 in 2036, which match a hand calculation. iPhone 18 Pro simulator: the showcase opens from the project card with the 3D layout.
- 2 Nov 2026: Test pass before commit. (1) 3D view no longer traps page scrolling: it starts parked (page scrolls past it with finger or mouse wheel), "Tap to explore in 3D" turns on orbit/zoom, "Done" or scrolling it off screen parks it again. Checked in the browser (wheel over the 3D view scrolled the page 500 px) and in the iPhone 18 Pro simulator (finger swipes starting on the 3D view scroll the page). Applies to the web project page too. (2) Race scoring moved to `src/m/raceCore.ts` with `npm run test:race`: 33 checks (points, today, commission, pipeline, cancellations, month and year edges, future-dated events, Monday-based streaks, targets, coaching) plus a stress run of 200 people, 50,000 plots and 100,000 events in about 90 ms. Fixed: a booking or sale that is later cancelled no longer earns points (book-and-cancel could farm points); coaching keeps one tip per person and always leaves room for a win; no "quiet" nag for someone who hit their target. (3) Owner dashboard figures match the web Finance and Home pages for the demo company (profit, cost, collected, value per project; cash; month figures; due from buyers). (4) Live race test on the demo company: Priya booked and sold plot A6 (test buyer) from the showcase; the race showed 4 points, ₹22,675 earned and her streak back to 4 weeks; the owner got both alerts and the dashboard moved (sold this month ₹16.8 L, collected ₹6.0 L). (5) UI sweep of every phone screen at 320, 375/390 and 430 px as owner and as sales: nothing wider than the screen, no text clipped mid-word. Fixed: row details and reminder titles wrap instead of being cut off; earnings boxes wrap on small phones; big headline numbers scale down on narrow screens (₹22,675 overflowed the target card at 320 px). Also fixed: an open plot no longer stays on top after changing tabs; new-alert dots also mark alerts that arrive while the Alerts screen is opening.
