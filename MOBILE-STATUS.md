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
| iOS project (`npx cap add ios`, Swift Package Manager) | ✅ | No CocoaPods; can't be compiled on Windows (Phase 4 cloud Mac) |
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
| Mac | Not required (iOS builds run on a cloud Mac). A used Mac mini (M1 or newer) makes iOS testing much faster; decide before Phase 4 | ⬜ |
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
