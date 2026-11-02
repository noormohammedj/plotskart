# WhatsApp alerts: Meta setup

Plotskart sends every WhatsApp message from **one Plotskart business number**. Each message names the developer it
is sent for (for example "– Sai Developers"). Three kinds of message:

1. **Buyer messages**: booking confirmation, payment reminder before each due date, registration reminder 2 days ahead.
2. **Team alerts**: owner and sales staff get new bookings, sales, payments and overdue buyers.
3. **Owner daily summary**: one morning message with the day's dues, registrations and overdue total.

Meta only allows business-initiated messages through **approved templates**, so the texts below are submitted to Meta
once and then reused. Do the steps in order; steps 1–4 take minutes, business verification (step 2) can take a few days.

## 1. Meta Business account
1. Go to https://business.facebook.com → **Create account**.
2. Business name: your **legal business name** exactly as on your documents (e.g. "Yellow Chord" if that is the
   registered firm). Plotskart can be the display name later.
3. Add your business email and address in Coimbatore.

## 2. Business verification (needed for more than 250 messages a day and for the "Plotskart" display name)
1. Business settings → **Security Center** → **Start verification**.
2. Have ready, all with the **same name and address**: GST certificate, Udyam/MSME certificate or the firm's PAN, and a
   utility bill or bank statement.
3. Website: `https://plotskart.in`. Meta checks that the site shows the business name and address. Tell me the legal
   name and address and I'll add them to the website footer before you submit.

## 3. App and WhatsApp test number (works before verification)
1. https://developers.facebook.com → **My Apps → Create app** → use case **Other** → type **Business** → name
   "Plotskart Messaging" → link it to the business from step 1.
2. In the app, **Add product → WhatsApp → Set up**. Meta creates a WhatsApp Business Account and a **test number**.
3. Under **API Setup**, add up to 5 of your own phone numbers as recipients. Messages to these work immediately,
   which is how we'll test.

## 4. Real Plotskart number
1. Use a number that is **not on WhatsApp** (a new SIM, or a landline that can receive an SMS/voice code). If it is on the
   WhatsApp app, delete that WhatsApp account first.
2. WhatsApp Manager → **Phone numbers → Add phone number** → display name **Plotskart** → category "Professional
   services" → verify with the code.
3. **Payment method**: WhatsApp Manager → **Settings → Payment methods** → add a card (billed per message, about ₹0.15
   per utility message in India).

## 5. Permanent access token
1. Business settings → **Users → System users → Add** → name "plotskart-server", role **Admin**.
2. **Assign assets**: the app (full control) and the WhatsApp account (full control).
3. **Generate new token** → app "Plotskart Messaging" → expiry **Never** → permissions
   `whatsapp_business_messaging` and `whatsapp_business_management`.
4. Copy the token **once**. Don't paste it into chat; you'll type it into Supabase yourself in step 7.
5. Note the **Phone number ID** and **WhatsApp Business Account ID** (WhatsApp → API Setup). These are not secret.

## 6. Message templates
WhatsApp Manager → **Message templates → Create template**. For each one: category **Utility**, language
**English**, name exactly as below, body exactly as below. Variables are `{{1}}`, `{{2}}`, … For "sample values", use
the examples given. No header, no buttons.

### Buyer messages

**`booking_confirmation`**
```
Dear {{1}}, thank you for booking plot {{2}} at {{3}}. Advance received: {{4}}. Balance {{5}} is due by {{6}}. – {{7}}
```
Samples: Arjun Kumar · B7 · Jatwada Greens · ₹3,00,000 · ₹17,82,000 · 25 Nov 2026 · Sai Developers

**`payment_reminder`**
```
Dear {{1}}, a balance of {{2}} for plot {{3}} at {{4}} is due on {{5}}. Please pay before the due date to keep your booking. – {{6}}
```
Samples: Arjun Kumar · ₹5,00,000 · B7 · Jatwada Greens · 25 Nov 2026 · Sai Developers

**`registration_reminder`**
```
Dear {{1}}, registration of plot {{2}} at {{3}} is scheduled on {{4}} at the Sub-Registrar office. Please bring Aadhaar, PAN, 2 passport photos and the balance of {{5}}. – {{6}}
```
Samples: Arjun Kumar · B7 · Jatwada Greens · 28 Nov 2026 · ₹0 · Sai Developers

### Team alerts

**`team_plot_booked`**
```
{{1}} booked plot {{2}} at {{3}} for {{4}}. Advance received: {{5}}.
```
Samples: Ravi Kumar · B7 · Jatwada Greens · Arjun Kumar · ₹3,00,000

**`team_plot_sold`**
```
{{1}} marked plot {{2}} at {{3}} as sold to {{4}}. Registration date: {{5}}.
```
Samples: Priya Shankar · C5 · Jatwada Greens · Meera Joshi · 28 Nov 2026

**`team_payment_received`**
```
{{1}} recorded a payment of {{2}} for plot {{3}} at {{4}}. Balance still due: {{5}}.
```
Samples: Anita Desai · ₹2,00,000 · B7 · Jatwada Greens · ₹15,82,000

**`team_payment_overdue`**
```
Payment overdue: plot {{1}} at {{2}}. {{3}} has not paid {{4}} due on {{5}}.
```
Samples: B7 · Jatwada Greens · Arjun Kumar · ₹5,00,000 · 25 Nov 2026

### Owner daily summary

**`owner_daily_summary`**
```
Good morning {{1}}. Today for {{2}}: {{3}} payments due worth {{4}}, {{5}} registrations, and {{6}} overdue worth {{7}}. Open Plotskart for details.
```
Samples: Noor · Sai Developers · 4 · ₹12,00,000 · 1 · 3 · ₹9,50,000

Approval usually takes minutes to a few hours. If one is rejected, send me Meta's reason.

### Project broadcast (marketing)

This one is different: category **Marketing** (not Utility), and it has one button.

**`new_project_launch`**
```
Hi {{1}}, {{2}} at {{3}} is now open. Plots from {{4}} ({{5}} per sq ft). Reply to book a site visit. – {{6}}
```
Samples: Ravi · Jatwada Greens · Mauje Jatwada, Chh. Sambhajinagar · ₹15,44,750 · ₹1,850 · Sai Developers

Button: **Add button → Marketing opt-out**, text `Stop promotions`. Customers who tap it (or reply STOP) are marked
"Said STOP" in the app and never get another broadcast.

Rules for marketing messages, so the number stays healthy:
- Only send to people who **agreed** to hear about new projects. The app sends only to customers ticked "Agreed to get
  new project offers"; booking updates are not consent to offers.
- Meta charges per marketing message (about ₹0.80–1.10 each in India) and counts them against the plan's monthly
  messages in Plotskart.
- How many different people you can message per day depends on the number's tier: 250 before business verification,
  then 1,000, 10,000 and up as the number keeps a good quality rating. Plotskart sends at most 1,000 per broadcast and
  never the same project to the same person twice within 7 days.
- If many people block or report the messages, Meta lowers the quality rating and can pause the number. Send to
  interested people, not to bought lists.

## 7. Connect it to Plotskart
In Supabase → **Edge Functions → Secrets**, add (type the values yourself):

| Name | Value |
| --- | --- |
| `WHATSAPP_TOKEN` | the permanent token from step 5 |
| `WHATSAPP_PHONE_NUMBER_ID` | Phone number ID (test number first, real number later) |
| `WHATSAPP_APP_SECRET` | app → **App settings → Basic → App secret** (checks that status updates really come from Meta) |
| `WHATSAPP_VERIFY_TOKEN` | any long random text; you'll enter the same text in Meta in step 8 |

## 8. Delivery receipts (after I deploy the webhook)
App → **WhatsApp → Configuration → Webhook → Edit**:
- Callback URL: `https://yyrxjsqhmfoncunjurga.supabase.co/functions/v1/whatsapp-webhook`
  (moves to `https://api.plotskart.in/functions/v1/whatsapp-webhook` once the API proxy exists).
- Verify token: the same text as `WHATSAPP_VERIFY_TOKEN`.
- Subscribe to the **messages** field.

This lets Plotskart show "delivered" and "read" for every message, and stop messaging anyone who replies STOP.

## Rules to know
- **Team alerts are opt-in per person**: each owner, salesperson or broker turns them on in the app under
  **Reminders → My WhatsApp alerts** with their own number; the owner also ticks the morning summary there.
- **Consent**: Meta requires that buyers agree to WhatsApp messages. The booking form will get a "Customer agreed to
  updates on WhatsApp" tick box; messages only go to buyers who agreed.
- **Limits**: an unverified business can start about 250 conversations a day; verification raises that.
- **Demo companies** never send real WhatsApp or SMS.
