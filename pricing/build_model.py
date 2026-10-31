"""Builds Plotskart_Pricing_Model.xlsx: usage, monthly cost, plan prices, startup costs and a 36-month funding plan.
Every figure is a formula fed from the Assumptions tab, so changing an input reprices everything."""
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

OUT = "Plotskart_Pricing_Model.xlsx"
FONT = "Arial"
BLUE, BLACK, GREEN = "0000FF", "000000", "008000"
HEAD_FILL = PatternFill("solid", fgColor="14212A")
SECTION_FILL = PatternFill("solid", fgColor="E3EAE6")
KEY_FILL = PatternFill("solid", fgColor="FFFF00")
INR = '"₹"#,##0;("₹"#,##0);"-"'
INR2 = '"₹"#,##0.00;("₹"#,##0.00);"-"'
USD = '"$"#,##0.00;("$"#,##0.00);"-"'
NUM = '#,##0;(#,##0);"-"'
DEC = '#,##0.00;(#,##0.00);"-"'
PCT = '0.0%;(0.0%);"-"'

wb = Workbook()
A = {}  # assumption name -> absolute reference on the Assumptions sheet


def f(color=BLACK, bold=False, size=10, italic=False):
    return Font(name=FONT, color=color, bold=bold, size=size, italic=italic)


def header(ws, row, texts):
    for c, t in enumerate(texts, start=1):
        cell = ws.cell(row=row, column=c, value=t)
        cell.font = Font(name=FONT, bold=True, color="FFFFFF", size=10)
        cell.fill = HEAD_FILL
        cell.alignment = Alignment(vertical="center", wrap_text=True)


def section(ws, row, text, width=5):
    for c in range(1, width + 1):
        ws.cell(row=row, column=c).fill = SECTION_FILL
    ws.cell(row=row, column=1, value=text).font = f(bold=True, size=11)


def note(ws, row, col, text):
    ws.cell(row=row, column=col, value=text).font = f(size=9, italic=True)


# ---------------------------------------------------------------- Assumptions
ws = wb.active
ws.title = "Assumptions"
ws["A1"] = "Plotskart pricing model: assumptions"
ws["A1"].font = f(bold=True, size=14)
ws["A2"] = ("Legend: blue = input you can change · yellow = key lever · black = formula · green = link to another tab. "
            "Prices exclude 18% GST. Change any blue cell and every tab recalculates.")
ws["A2"].font = f(italic=True, size=9)
ws.merge_cells("A2:D2")
header(ws, 4, ["Item", "Value", "Unit", "Source / note"])

PCT_KEYS = {"gst", "incentive", "pg_fee", "contingency", "churn", "margin", "yearly_share"}
KEY_CELLS = {"new_team", "new_business", "members", "projects", "margin", "list_mult"}
rows = [
    ("Scenario (from you)", None),
    ("new_team", "New Team-plan companies per month", 20, "companies", "Your figure"),
    ("new_business", "New Business-plan companies per month", 2, "companies", "Your figure"),
    ("new_customers", "New companies signing up per month", "=B7+B8", "companies", "Team + Business"),
    ("yearly_share", "Customers who pay yearly instead of monthly", 0.05, "of new customers", "Your figure: 5%"),
    ("members", "Team members per company", 15, "users", "Your figure: 10-15. Costed at 15, the busier end"),
    ("projects", "Projects running per company", 7, "projects", "Your figure: 6-7 at a time. Costed at 7"),
    ("layouts", "Layouts added or re-read per company per month", 5, "layouts", "Your earlier figure: at least 5 layout plans a month"),
    ("retries", "AI read attempts per layout (re-uploads, better photo)", 3, "reads", "Estimate: people retry blurry or partial photos"),
    ("Currency and AI", None),
    ("fx", "US dollar to rupee", 96, "₹ per $", "Market rate Aug-Sep 2026 ≈ ₹95.5-96"),
    ("ai_cost_usd", "AI cost per layout read (150-plot layout)", 0.34, "$ per read", "Measured: 107-plot Jatwada read cost $0.241 on Claude Opus 5.5. Scaled to 150 plots"),
    ("Supabase (backend)", None),
    ("sb_pro", "Supabase Pro plan", 25, "$ / month", "supabase.com/pricing: $25/mo, unlimited API requests, includes $10 compute credit"),
    ("sb_compute", "Base compute (Small instance, net of credit)", 5, "$ / month", "Small $15 − $10 credit"),
    ("sb_step_companies", "Companies per extra compute step", 50, "companies", "Estimate: one compute upgrade per ~50 companies"),
    ("sb_step_usd", "Cost of each extra compute step", 50, "$ / month", "Estimate: Small → Medium ($60) → Large ($110)"),
    ("lim_egress", "Pro limit: egress", 250, "GB / month", "supabase.com/pricing ($0.09/GB beyond)"),
    ("lim_storage", "Pro limit: file storage", 100, "GB", "supabase.com/pricing"),
    ("lim_edge", "Pro limit: edge function calls", 2000000, "calls / month", "supabase.com/pricing ($2 per million beyond)"),
    ("lim_rt", "Pro limit: realtime messages", 5000000, "messages / month", "supabase.com/pricing ($2.50 per million beyond)"),
    ("lim_conn", "Pro limit: realtime connections at once", 500, "connections", "supabase.com/pricing (more with bigger compute)"),
    ("lim_db", "Pro limit: database disk", 8, "GB", "supabase.com/pricing ($0.125/GB beyond)"),
    ("over_rt", "Overage: realtime messages", 2.5, "$ per million", "supabase.com/pricing"),
    ("over_edge", "Overage: edge function calls", 2, "$ per million", "supabase.com/pricing"),
    ("over_egress", "Overage: egress", 0.09, "$ per GB", "supabase.com/pricing"),
    ("over_conn", "Overage: peak realtime connections", 10, "$ per 1,000", "supabase.com/pricing"),
    ("Other tech", None),
    ("netlify", "Netlify Pro (app + sales site hosting)", 20, "$ / month", "netlify.com/pricing"),
    ("email", "Email sending for sign-in codes", 20, "$ / month", "Estimate: entry paid plan (Brevo/Resend)"),
    ("apple", "Apple developer account", 99, "$ / year", "Apple Developer Program"),
    ("google_play", "Google Play developer account", 25, "$ / year", "One-time $25, shown per year"),
    ("domain", "Domain name", 1000, "₹ / year", "Estimate"),
    ("tools", "Monitoring, backups, misc tools", 2000, "₹ / month", "Estimate"),
    ("Messaging", None),
    ("cust_per_project", "Customers with a booking or balance per project", 40, "customers", "Estimate"),
    ("msgs_per_customer", "WhatsApp messages per customer per month", 4, "messages", "Booking confirmation + instalment reminders + registration alert. Same count again by SMS"),
    ("wa_rate", "WhatsApp utility message price", 0.145, "₹ / message", "AiSensy: India utility ₹0.145 (Meta rate via BSP)"),
    ("sms_rate", "SMS price (MSG91 transactional)", 0.22, "₹ / SMS", "MSG91: ₹0.16-0.25 by volume"),
    ("gst", "GST on vendor bills you cannot offset", 0.18, "rate", "18% GST on SMS/WhatsApp bills (assume not claimed)"),
    ("Office and people (your figures, ₹ per month)", None),
    ("sales", "Sales team", 100000, "₹ / month", "Your figure"),
    ("marketing", "Marketing team", 150000, "₹ / month", "Your figure"),
    ("support", "Support team", 60000, "₹ / month", "Your figure"),
    ("ads", "Ads", 60000, "₹ / month", "Your figure"),
    ("seats", "Shared workspace seats, Coimbatore", 4, "seats", "Your figure"),
    ("seat_rate", "Shared workspace price per seat", 8000, "₹ / month", "Your figure. Electricity and internet included"),
    ("ca", "CA and accountant (ROC filings, GST returns, TDS, books)", 10000, "₹ / month", "Estimate: ₹5,000-15,000 for a small Pvt Ltd"),
    ("founder", "Founder / CEO salary (from launch)", 200000, "₹ / month", "Your figure"),
    ("founder_pre", "Founder / CEO salary during the build months", 0, "₹ / month", "Your figure: none while building"),
    ("support_hours", "Support hours available per month", 352, "hours", "Assumed 2 support people × 176 h. Only used to cost onboarding time"),
    ("Other", None),
    ("incentive", "Sales incentive on setup fees", 0.05, "of setup fee", "Estimate"),
    ("pg_fee", "Payment gateway fee (Razorpay)", 0.02, "of collections", "Razorpay standard ~2%"),
    ("contingency", "Contingency on all costs", 0.10, "of costs", "Estimate"),
    ("churn", "Monthly churn (customers who stop)", 0.02, "per month", "Estimate"),
    ("Pricing levers", None),
    ("margin", "Profit margin built into every price", 0.30, "of price", "Price = cost ÷ (1 − margin)"),
    ("list_mult", "List price multiple (struck-out price)", 3, "× launch price", "Your rule: list = 3× derived price, launch offer = derived price"),
    ("year_months", "Months charged for a yearly plan", 10, "months", "Yearly plan = 2 months free"),
    ("dev_rate", "Developer cost per hour (branding work)", 600, "₹ / hour", "Estimate"),
]
r = 5
for item in rows:
    if item[1] is None:
        r += 1
        section(ws, r, item[0], 4)
        r += 1
        continue
    name, label, value, unit, src = item
    ws.cell(row=r, column=1, value=label).font = f()
    c = ws.cell(row=r, column=2, value=value)
    c.font = f(BLACK if isinstance(value, str) else BLUE)
    if name in PCT_KEYS:
        c.number_format = PCT
    elif unit.startswith("$"):
        c.number_format = USD
    elif isinstance(value, str):
        c.number_format = NUM
    elif unit.startswith("₹") and value < 10:
        c.number_format = INR2
    elif unit.startswith("₹"):
        c.number_format = INR
    else:
        c.number_format = NUM
    if name in KEY_CELLS:
        c.fill = KEY_FILL
    ws.cell(row=r, column=3, value=unit).font = f(size=9)
    note(ws, r, 4, src)
    A[name] = f"Assumptions!$B${r}"
    r += 1
for col, w in zip("ABCD", [52, 14, 16, 90]):
    ws.column_dimensions[col].width = w

# ---------------------------------------------------------------- Usage
us = wb.create_sheet("Usage")
us["A1"] = "Backend usage: how many reads and writes, and does Supabase Pro cover it?"
us["A1"].font = f(bold=True, size=14)
us["A2"] = "Per-person activity is estimated from what the app requests. Supabase does not charge per read or write."
us["A2"].font = f(italic=True, size=9)
header(us, 4, ["Activity per company per working day", "People / jobs", "Times per day", "Rows read or written each", "Per day", "How it was counted"])
U = {}
act = [
    ("opens", "App opens by sales staff and brokers", f"={A['members']}-2", 6, 8, "Field users × 6 opens; each open loads profile, plots, org, team, projects, notifications, accounts"),
    ("sheets", "Plot details opened by field staff", f"={A['members']}-2", 20, 4, "History, payments, instalments, documents"),
    ("office", "Owner and accountant: finance screens", 2, 18, 7, "Ledger, costs, funding, commissions, accounts, assets"),
    ("actions", "Bookings, sales, payments, price changes, expenses", 1, f"={A['projects']}*5", 20, "~5 actions per project per day. Each writes plot + history + payment + ledger + ~14 notifications + customer message"),
    ("reminders", "Daily reminder job (plots due)", 1, f"={A['projects']}*3", 17, "~3 reminders per project per day. Each = 1 log + ~15 notifications + 1 customer message"),
]
r = 5
for key, label, count, per, calls, src in act:
    us.cell(row=r, column=1, value=label).font = f()
    for col, v in ((2, count), (3, per), (4, calls)):
        c = us.cell(row=r, column=col, value=v)
        c.font = f(GREEN if isinstance(v, str) else BLUE)
        c.number_format = NUM
    us.cell(row=r, column=5, value=f"=B{r}*C{r}*D{r}").number_format = NUM
    note(us, r, 6, src)
    U[key] = r
    r += 1
us.cell(row=r, column=1, value="Working days per month").font = f()
us.cell(row=r, column=2, value=26).font = f(BLUE)
days = f"$B${r}"
r += 1
us.cell(row=r, column=1, value="Companies on the platform after 12 months").font = f()
us.cell(row=r, column=2, value="=Funding!O8+Funding!O9").font = f(GREEN)
us.cell(row=r, column=2).number_format = NUM
n = f"$B${r}"
r += 2

section(us, r, "Per month", 6)
r += 1
header(us, r, ["Measure", "Per company", "All companies at month 12", "Supabase Pro limit", "Share of limit used", "Note"])
r += 1
cust = f"{A['projects']}*{A['cust_per_project']}"
metrics = [
    ("Database reads", f"=(E{U['opens']}+E{U['sheets']}+E{U['office']})*{days}", None, "Not billed: unlimited API requests"),
    ("Database rows written", f"=(E{U['actions']}+E{U['reminders']})*{days}", None, "Not billed: unlimited API requests"),
    ("Realtime messages", f"=(C{U['actions']}*45+C{U['reminders']}*{A['members']})*{days}", A["lim_rt"], "Each change reaches every open phone (~45 messages per action)"),
    ("Edge function calls (push, WhatsApp, SMS)", f"=(C{U['actions']}*{A['members']}+C{U['reminders']}*({A['members']}+1))*{days}", A["lim_edge"], "One call per notification and per customer message. Above the limit: $2 per million"),
    ("Egress (GB)", f"=((E{U['opens']}+E{U['sheets']}+E{U['office']})*25/1024/1024+B{U['opens']}*C{U['opens']}*0.6/1024)*{days}", A["lim_egress"], "~25 KB per read + 0.6 MB layout picture per map view. Above: $0.09/GB"),
    ("New file storage (GB)", f"=({A['layouts']}*{A['retries']}*0.6+30)/1024", A["lim_storage"], "Layout pictures + ~30 MB documents per month"),
    ("Peak live connections", f"={A['members']}*0.5", A["lim_conn"], "About half the team online at the busiest hour. Bigger compute raises this"),
    ("AI layout reads", f"={A['layouts']}*{A['retries']}", None, "Billed by Anthropic, not Supabase"),
    ("WhatsApp messages", f"={cust}*{A['msgs_per_customer']}", None, "Billed by Meta"),
    ("SMS", f"={cust}*{A['msgs_per_customer']}", None, "Billed by MSG91"),
]
first = r
for label, per_co, limit, src in metrics:
    fmt = DEC if "GB" in label else NUM
    us.cell(row=r, column=1, value=label).font = f()
    us.cell(row=r, column=2, value=per_co).number_format = fmt
    us.cell(row=r, column=3, value=f"=B{r}*{n}").number_format = fmt
    if limit:
        us.cell(row=r, column=4, value=f"={limit}").font = f(GREEN)
        us.cell(row=r, column=4).number_format = NUM
        us.cell(row=r, column=5, value=f"=IFERROR(C{r}/D{r},0)").number_format = PCT
    else:
        us.cell(row=r, column=4, value="no limit").font = f(size=9)
    note(us, r, 6, src)
    r += 1
last = r - 1
r += 1
us.cell(row=r, column=1, value="Database size after 12 months (GB)").font = f()
us.cell(row=r, column=3, value=f"=B{first+1}*{n}/2*12*0.5/1024/1024").number_format = DEC
us.cell(row=r, column=4, value=f"={A['lim_db']}").font = f(GREEN)
us.cell(row=r, column=5, value=f"=IFERROR(C{r}/D{r},0)").number_format = PCT
note(us, r, 6, "~0.5 KB per row written; on average half the month-12 companies over the year")
r += 2
us.cell(row=r, column=1, value="Verdict").font = f(bold=True)
us.cell(row=r, column=2, value=(f'=IF(MAX(E{first}:E{r-2})<1,"Supabase Pro covers it; extra compute is added as companies grow",'
                                 f'"Some limits pass 100% by month 12: small overage charges, covered by the compute steps and contingency")')).font = f(bold=True)
for col, w in zip("ABCDEF", [52, 16, 24, 20, 18, 80]):
    us.column_dimensions[col].width = w

# ---------------------------------------------------------------- Monthly Cost
mc = wb.create_sheet("Monthly Cost")
mc["A1"] = "Monthly operating cost"
mc["A1"].font = f(bold=True, size=14)
mc["A2"] = "Fixed costs are paid every month whatever the number of customers. Variable costs grow with each company."
mc["A2"].font = f(italic=True, size=9)
header(mc, 4, ["Cost line", "₹ per month", "Group", "How it is worked out"])
C = {}
fixed = [
    ("sb", "Supabase Pro + base compute", f"=({A['sb_pro']}+{A['sb_compute']})*{A['fx']}", "Running", "Dollar price × exchange rate"),
    ("net", "Netlify Pro hosting", f"={A['netlify']}*{A['fx']}", "Running", ""),
    ("email", "Email for sign-in codes", f"={A['email']}*{A['fx']}", "Running", ""),
    ("stores", "App store accounts", f"=({A['apple']}+{A['google_play']})/12*{A['fx']}", "Running", "Yearly fees spread over 12 months"),
    ("domain", "Domain", f"={A['domain']}/12", "Running", ""),
    ("tools", "Monitoring and tools", f"={A['tools']}", "Running", ""),
    ("office", "Shared workspace, Coimbatore", f"={A['seats']}*{A['seat_rate']}", "Running", "Seats × price per seat (your figures)"),
    ("ca", "CA and accountant", f"={A['ca']}", "Running", ""),
    ("founder", "Founder salary", f"={A['founder']}", "Running", "Your figure"),
    ("support", "Support team", f"={A['support']}", "Running", "Your figure"),
    ("sales", "Sales team", f"={A['sales']}", "Acquisition", "Your figure"),
    ("mkt", "Marketing team", f"={A['marketing']}", "Acquisition", "Your figure"),
    ("ads", "Ads", f"={A['ads']}", "Acquisition", "Your figure"),
]
r = 5
section(mc, r, "Fixed costs", 4)
r += 1
for key, label, formula, group, src in fixed:
    mc.cell(row=r, column=1, value=label).font = f()
    mc.cell(row=r, column=2, value=formula).number_format = INR
    mc.cell(row=r, column=3, value=group).font = f(size=9)
    note(mc, r, 4, src)
    C[key] = r
    r += 1
f0, f1 = C["sb"], r - 1
rows_sum = [
    ("fixed", "Total fixed costs", f"=SUM(B{f0}:B{f1})"),
    ("fixed_c", "Total fixed costs with contingency", f"=B{{fixed}}*(1+{A['contingency']})"),
    ("acq", "Acquisition (sales, marketing, ads) with contingency", f'=SUMIF(C{f0}:C{f1},"Acquisition",B{f0}:B{f1})*(1+{A["contingency"]})'),
    ("run", "Running overhead (office, founder, support, tech) with contingency", f'=SUMIF(C{f0}:C{f1},"Running",B{f0}:B{f1})*(1+{A["contingency"]})'),
]
for key, label, formula in rows_sum:
    mc.cell(row=r, column=1, value=label).font = f(bold=True)
    c = mc.cell(row=r, column=2, value=formula.format(**C))
    c.number_format = INR
    c.font = f(bold=True)
    C[key] = r
    r += 1
r += 1
section(mc, r, "Variable cost per company per month", 4)
r += 1
var = [
    ("v_ai", "AI layout reads", f"={A['layouts']}*{A['retries']}*{A['ai_cost_usd']}*{A['fx']}", "Layouts × attempts × cost per read"),
    ("v_wa", "WhatsApp messages", f"={A['projects']}*{A['cust_per_project']}*{A['msgs_per_customer']}*{A['wa_rate']}*(1+{A['gst']})", "Projects × customers × messages, incl. GST on the bill"),
    ("v_sms", "SMS", f"={A['projects']}*{A['cust_per_project']}*{A['msgs_per_customer']}*{A['sms_rate']}*(1+{A['gst']})", "Same count as WhatsApp"),
    ("v_infra", "Extra database compute + usage overage",
     f"=({A['sb_step_usd']}/{A['sb_step_companies']}+Usage!B{first+2}/1000000*{A['over_rt']}+Usage!B{first+3}/1000000*{A['over_edge']}"
     f"+Usage!B{first+4}*{A['over_egress']}+Usage!B{first+6}/1000*{A['over_conn']})*{A['fx']}",
     "Compute step per 50 companies, plus this company's realtime, function, egress and connection usage at overage rates (allowances ignored)"),
]
for key, label, formula, src in var:
    mc.cell(row=r, column=1, value=label).font = f()
    mc.cell(row=r, column=2, value=formula).number_format = INR
    note(mc, r, 4, src)
    C[key] = r
    r += 1
mc.cell(row=r, column=1, value="Variable cost per company (with contingency)").font = f(bold=True)
c = mc.cell(row=r, column=2, value=f"=SUM(B{C['v_ai']}:B{r-1})*(1+{A['contingency']})")
c.number_format = INR
c.font = f(bold=True)
C["var"] = r
r += 2
section(mc, r, "Unit costs used for pricing", 4)
r += 1
units = [
    ("avg_active", "Average paying companies in the first 12 months", "=AVERAGE(Funding!D8:O8)+AVERAGE(Funding!D9:O9)", NUM, "Running overhead is shared across this base"),
    ("oh_per_co", "Running overhead per company per month", f"=B{C['run']}/B{{avg_active}}", INR, "Running overhead ÷ average companies"),
    ("cac", "Acquisition cost per new company", f"=B{C['acq']}/{A['new_customers']}", INR, "Sales + marketing + ads ÷ new companies a month. Recovered by the setup fee"),
    ("per_read", "Cost of one AI layout read", f"={A['ai_cost_usd']}*{A['fx']}*(1+{A['contingency']})", INR2, ""),
    ("per_msg", "Cost of one customer reminder (WhatsApp + SMS)", f"=({A['wa_rate']}+{A['sms_rate']})*(1+{A['gst']})*(1+{A['contingency']})", INR2, ""),
    ("per_hour", "Support cost per hour", f"={A['support']}/{A['support_hours']}", INR2, "Used to cost onboarding time"),
    ("infra", "Extra compute per company", f"=B{C['v_infra']}*(1+{A['contingency']})", INR, ""),
]
for key, label, formula, fmt, src in units:
    C[key] = r
    r += 1
r = C["avg_active"]
for key, label, formula, fmt, src in units:
    mc.cell(row=r, column=1, value=label).font = f()
    mc.cell(row=r, column=2, value=formula.format(**C)).number_format = fmt
    note(mc, r, 4, src)
    r += 1
for col, w in zip("ABCD", [62, 16, 13, 70]):
    mc.column_dimensions[col].width = w

# ---------------------------------------------------------------- Pricing
pr = wb.create_sheet("Pricing")
pr["A1"] = "Plan prices: derived from cost, list price at 3×"
pr["A1"].font = f(bold=True, size=14)
pr["A2"] = ("Monthly price = (variable cost + share of running overhead) ÷ (1 − margin). Setup = (acquisition + onboarding) ÷ (1 − margin). "
            "List (struck out) = launch × 3. Prices exclude 18% GST.")
pr["A2"].font = f(italic=True, size=9)
plans = ["Starter", "Team", "Business"]
header(pr, 4, ["Plan inputs", *plans, "Note"])
inputs = [
    ("users", "Users included", [3, f"={A['members']}", 30], NUM, "Team = your 10-15 member scenario"),
    ("projects", "Projects", [2, f"={A['projects']}", 15], NUM, "Team = your 6-7 projects"),
    ("reads", "AI layout reads included per month", [5, f"={A['layouts']}*{A['retries']}", 30], NUM, ""),
    ("msgs", "Customer reminders included per month (WhatsApp + SMS pairs)", [300, f"={A['projects']}*{A['cust_per_project']}*{A['msgs_per_customer']}", 2500], NUM, ""),
    ("dedicated", "Dedicated database and hosting ($ / month)", [0, 0, 55], USD, "Business: own Supabase project ($35) + hosting ($20)"),
    ("oh_w", "Share of running overhead (Team = 1)", [0.4, 1, 2.5], DEC, "Bigger accounts use more support and office time"),
    ("cac_w", "Share of acquisition cost (Team = 1)", [0.6, 1, 2], DEC, "Bigger accounts take longer to sell"),
    ("onboard", "Onboarding hours (load layouts, train team)", [4, 10, 24], DEC, ""),
    ("dev", "Branding / custom work hours", [0, 0, 60], DEC, "Business: your name and logo, store listing"),
]
P = {}
r = 5
for key, label, vals, fmt, src in inputs:
    pr.cell(row=r, column=1, value=label).font = f()
    for i, v in enumerate(vals):
        c = pr.cell(row=r, column=2 + i, value=v)
        c.font = f(GREEN if isinstance(v, str) else BLUE)
        c.number_format = fmt
    note(pr, r, 5, src)
    P[key] = r
    r += 1
L = "'Monthly Cost'!"


def plan_block(title, lines, total_label, total_key):
    global r
    r += 1
    section(pr, r, title, 5)
    r += 1
    start = r
    for key, label, fn in lines:
        pr.cell(row=r, column=1, value=label).font = f()
        for i in range(3):
            col = get_column_letter(2 + i)
            pr.cell(row=r, column=2 + i, value=fn(col)).number_format = INR
        P[key] = r
        r += 1
    pr.cell(row=r, column=1, value=total_label).font = f(bold=True)
    for i in range(3):
        col = get_column_letter(2 + i)
        c = pr.cell(row=r, column=2 + i, value=f"=SUM({col}{start}:{col}{r-1})")
        c.number_format = INR
        c.font = f(bold=True)
    P[total_key] = r
    r += 1


plan_block("Monthly cost of one company", [
    ("c_ai", "AI layout reads", lambda col: f"={col}{P['reads']}*{L}$B${C['per_read']}"),
    ("c_msg", "WhatsApp + SMS", lambda col: f"={col}{P['msgs']}*{L}$B${C['per_msg']}"),
    ("c_infra", "Database and hosting", lambda col: f"={L}$B${C['infra']}+{col}{P['dedicated']}*{A['fx']}"),
    ("c_oh", "Share of running overhead (office, founder, support, tech)", lambda col: f"={col}{P['oh_w']}*{L}$B${C['oh_per_co']}"),
], "Monthly cost", "cost")
plan_block("One-time setup cost", [
    ("s_cac", "Share of acquisition (sales, marketing, ads)", lambda col: f"={col}{P['cac_w']}*{L}$B${C['cac']}"),
    ("s_ai", "Reading every project layout at onboarding", lambda col: f"={col}{P['projects']}*{A['retries']}*{L}$B${C['per_read']}"),
    ("s_work", "Onboarding + custom work", lambda col: f"={col}{P['onboard']}*{L}$B${C['per_hour']}+{col}{P['dev']}*{A['dev_rate']}"),
], "Setup cost", "setup_cost")

r += 1
section(pr, r, "Prices (rounded up to ..999)", 5)
r += 1
header(pr, r, ["Price", *plans, "Rule"])
r += 1
price_rows = [
    ("launch_setup", "Setup fee (launch, one-time)", "=CEILING({col}%(setup_cost)s/(1-{m})/(1-{inc}-{pg}),1000)-1", "Setup cost ÷ (1 − margin), grossed up for incentive and gateway"),
    ("launch_month", "Monthly (launch)", "=CEILING({col}%(cost)s/(1-{m})/(1-{pg}),500)-1", "Monthly cost ÷ (1 − margin), grossed up for gateway"),
    ("launch_year", "Yearly (launch)", "={col}%(launch_month)s*{ym}", "10 months' price, 2 months free"),
    ("list_setup", "Setup fee (list, struck out)", "={col}%(launch_setup)s*{lm}", "Launch × list multiple"),
    ("list_month", "Monthly (list, struck out)", "={col}%(launch_month)s*{lm}", ""),
    ("list_year", "Yearly (list, struck out)", "={col}%(launch_year)s*{lm}", ""),
    ("first_year", "First-year bill at launch price (setup + yearly)", "={col}%(launch_setup)s+{col}%(launch_year)s", ""),
    ("margin_m", "Margin on the monthly price", "=IFERROR(1-{col}%(cost)s/{col}%(launch_month)s,0)", ""),
    ("per_user", "Monthly price per user", "=IFERROR({col}%(launch_month)s/{col}%(users)s,0)", "Compare with per-user CRMs below"),
]
for key, *_ in price_rows:
    P[key] = r
    r += 1
r = P["launch_setup"]
subs = dict(m=A["margin"], inc=A["incentive"], pg=A["pg_fee"], ym=A["year_months"], lm=A["list_mult"])
for key, label, tmpl, src in price_rows:
    pr.cell(row=r, column=1, value=label).font = f(bold=key.startswith("launch"))
    for i in range(3):
        col = get_column_letter(2 + i)
        formula = (tmpl % {k: v for k, v in P.items()}).format(col=col, **subs)
        c = pr.cell(row=r, column=2 + i, value=formula)
        c.number_format = PCT if key == "margin_m" else INR
        if key.startswith("launch"):
            c.font = f(bold=True)
            c.fill = KEY_FILL
    note(pr, r, 5, src)
    r += 1
r += 1
section(pr, r, "What competitors charge (15-user team)", 5)
r += 1
header(pr, r, ["Product", "₹ per month", "", "", "Source"])
r += 1
comp = [
    ("Plotskart Team (launch)", f"=C{P['launch_month']}", "This model"),
    ("Kylas (flat, unlimited users)", 12999, "kylas.io: ₹12,999/month flat"),
    ("Sell.Do (per user)", f"=34.99*15*{A['fx']}", "Capterra: from $34.99 per user per month"),
    ("LeadSquared Pro (10 users, claimed)", 25000, "Kylas comparison page: ₹25,000/month for 10 users"),
]
for label, val, src in comp:
    pr.cell(row=r, column=1, value=label).font = f(bold=label.startswith("Plotskart"))
    c = pr.cell(row=r, column=2, value=val)
    c.number_format = INR
    c.font = f(BLUE if isinstance(val, (int, float)) else BLACK)
    note(pr, r, 5, src)
    r += 1
for col, w in zip("ABCDE", [58, 16, 16, 16, 64]):
    pr.column_dimensions[col].width = w

# ---------------------------------------------------------------- prices used in the plan
# The plan runs on the prices published on the sales site. The derived prices above are shown next to them.
r += 1
section(pr, r, "Prices used in the plan (published on the sales site)", 5)
r += 1
header(pr, r, ["Price", *plans, "Note"])
r += 1
for key, label, vals in (("pub_setup", "Setup fee", [11999, 21999, 98999]), ("pub_month", "Monthly", [1999, 4999, 18499])):
    pr.cell(row=r, column=1, value=label).font = f(bold=True)
    for i, v in enumerate(vals):
        c = pr.cell(row=r, column=2 + i, value=v)
        c.font = f(BLUE)
        c.number_format = INR
    note(pr, r, 5, "plotskart.in")
    P[key] = r
    r += 1
pr.cell(row=r, column=1, value="Margin on the published monthly price").font = f()
for i in range(3):
    col = get_column_letter(2 + i)
    pr.cell(row=r, column=2 + i, value=f"=IFERROR(1-{col}{P['cost']}/{col}{P['pub_month']},0)").number_format = PCT
P["pub_margin"] = r
r += 1
pr.cell(row=r, column=1, value="Derived monthly price minus published").font = f()
for i in range(3):
    col = get_column_letter(2 + i)
    pr.cell(row=r, column=2 + i, value=f"={col}{P['launch_month']}-{col}{P['pub_month']}").number_format = INR
note(pr, r, 5, "Positive = the cost-based price is now above the published one")
r += 1
Pp = "Pricing!"
plan_ref = {
    "team": dict(setup=f"{Pp}$C${P['pub_setup']}", month=f"{Pp}$C${P['pub_month']}",
                 var=f"({Pp}$C${P['c_ai']}+{Pp}$C${P['c_msg']}+{Pp}$C${P['c_infra']})",
                 onboard=f"({Pp}$C${P['s_ai']}+{Pp}$C${P['dev']}*{A['dev_rate']})"),
    "business": dict(setup=f"{Pp}$D${P['pub_setup']}", month=f"{Pp}$D${P['pub_month']}",
                     var=f"({Pp}$D${P['c_ai']}+{Pp}$D${P['c_msg']}+{Pp}$D${P['c_infra']})",
                     onboard=f"({Pp}$D${P['s_ai']}+{Pp}$D${P['dev']}*{A['dev_rate']})"),
}

# ---------------------------------------------------------------- Startup Costs
sc = wb.create_sheet("Startup Costs")
sc["A1"] = "One-time startup costs (before and at launch)"
sc["A1"].font = f(bold=True, size=14)
sc["A2"] = "Blue cells are estimates you can change. Development is costed in days at the day rate below."
sc["A2"].font = f(italic=True, size=9)
sc["A4"] = "Developer day rate (freelance full-stack)"
sc["A4"].font = f(bold=True)
sc["B4"] = 6000
sc["B4"].font = f(BLUE)
sc["B4"].fill = KEY_FILL
sc["B4"].number_format = INR
note(sc, 4, 5, "Estimate: ~₹1.3 lakh a month senior freelancer in Tamil Nadu")
RATE = "$B$4"
header(sc, 6, ["Item", "Qty", "Unit cost (₹)", "Total (₹)", "Note / source"])
groups = [
    ("Company and legal", [
        ("Private limited registration (2 directors, CA filing, DSC, stamp duty)", 1, 20000, "2026 guides: ₹7,000-25,000 all-in for 2 directors (taxaj.com, agileregulatory.com)"),
        ("Trademark 'Plotskart' in 2 classes (software 9, SaaS 42)", 2, 4500, "Startup/MSME e-filing ₹4,500 per class (needs DPIIT/MSME); company rate ₹9,000"),
        ("Trademark attorney fee", 1, 6000, "Estimate"),
        ("DPIIT startup recognition, GST, PAN/TAN, current account", 1, 0, "Free / bundled with SPICe+"),
        ("Terms, privacy policy (DPDP Act), customer agreement", 1, 25000, "Estimate: lawyer drafting"),
    ]),
    ("Product work still to build", [
        ("Subscription billing: Razorpay, GST invoices, plan limits, usage meters", 15, "rate", "Not built yet"),
        ("Self-serve company sign-up and an admin console for support", 10, "rate", "Not built yet"),
        ("WhatsApp: Meta business verification, 3 templates approved, live testing", 4, "rate", "Code is built; account setup and approval left"),
        ("SMS: DLT headers and templates, MSG91 flows, live testing", 3, "rate", "Code is built; registration left"),
        ("Android Play Store release (signing, listing, review)", 4, "rate", ""),
        ("iPhone App Store release (push certificates, listing, review)", 6, "rate", ""),
        ("Phone-number (SMS code) sign-in and desktop web push", 5, "rate", "Listed under 'Not built yet' in README"),
        ("Backups, monitoring, error tracking", 3, "rate", ""),
        ("Testing and bug-fix buffer", 10, "rate", ""),
        ("External security review / penetration test", 1, 60000, "Estimate: small web-app pen test"),
        ("Mac for iPhone builds", 1, 100000, "iOS apps can only be built on a Mac"),
    ]),
    ("Vendor accounts and first credits", [
        ("Apple developer account (1 year)", 1, "=99*" + A["fx"], "$99/year"),
        ("Google Play developer account", 1, "=25*" + A["fx"], "$25 one-time"),
        ("SMS DLT entity registration", 1, 5900, "One-time ₹5,900 on one operator portal (Infobip, Fast2SMS guides)"),
        ("WhatsApp Business: Meta verification", 1, 0, "Free on Cloud API direct"),
        ("WhatsApp message credits (prepaid)", 1, 10000, "Float for the first months"),
        ("MSG91 SMS credits (prepaid)", 1, 10000, "Float for the first months"),
        ("Claude API credits (prepaid)", 1, "=200*" + A["fx"], "$200 ≈ 560 layout reads"),
        ("Domain names (.in and .com)", 1, 2500, ""),
    ]),
    ("Office and team setup (Coimbatore)", [
        ("Shared workspace deposit, 4 seats (refundable)", 1, f"={A['seats']}*{A['seat_rate']}", "Estimate: one month's fee; workspace is furnished, power and internet included"),
        ("Tablets for the sales team to show layouts to buyers", 4, 15000, "Your figure: 4 × ₹15,000"),
        ("Basic laptops for marketing and support", 3, 30000, "Estimate: entry-level laptop"),
        ("Hiring: job portals and recruiter fees", 1, 40000, "Estimate"),
    ]),
    ("Launch marketing", [
        ("Brand kit: logo, brochures, visiting cards, demo videos", 1, 60000, "Estimate"),
        ("Launch dinner for layout owners: Coimbatore, Chennai, Dindigul, Madurai", 4, 50000, "Your figure: ₹25,000-50,000 per city; costed at ₹50,000"),
    ]),
]
r = 7
sub_rows = []
S = {}
for title, items in groups:
    section(sc, r, title, 5)
    r += 1
    start = r
    for label, qty, unit, src in items:
        sc.cell(row=r, column=1, value=label).font = f()
        q = sc.cell(row=r, column=2, value=qty)
        q.font = f(BLUE)
        q.number_format = NUM
        u = sc.cell(row=r, column=3, value=f"={RATE}" if unit == "rate" else unit)
        u.font = f(GREEN if isinstance(unit, str) else BLUE)
        u.number_format = INR
        sc.cell(row=r, column=4, value=f"=B{r}*C{r}").number_format = INR
        note(sc, r, 5, src)
        r += 1
    sc.cell(row=r, column=1, value=f"Subtotal: {title}").font = f(bold=True)
    c = sc.cell(row=r, column=4, value=f"=SUM(D{start}:D{r-1})")
    c.number_format = INR
    c.font = f(bold=True)
    sub_rows.append(r)
    S[title] = r
    r += 2
sc.cell(row=r, column=1, value="Subtotal before contingency").font = f(bold=True)
sc.cell(row=r, column=4, value="=" + "+".join(f"D{x}" for x in sub_rows)).number_format = INR
S["pre_cont"] = r
r += 1
sc.cell(row=r, column=1, value="Miscellaneous and contingency").font = f()
sc.cell(row=r, column=2, value=0.10).font = f(BLUE)
sc.cell(row=r, column=2).number_format = PCT
sc.cell(row=r, column=4, value=f"=D{S['pre_cont']}*B{r}").number_format = INR
S["misc"] = r
r += 1
sc.cell(row=r, column=1, value="Total one-time startup cost").font = f(bold=True)
c = sc.cell(row=r, column=4, value=f"=D{S['pre_cont']}+D{S['misc']}")
c.number_format = INR
c.font = f(bold=True)
c.fill = KEY_FILL
S["total"] = r
r += 1
sc.cell(row=r, column=1, value="of which refundable deposit").font = f(size=9, italic=True)
sc.cell(row=r, column=4, value=f"=D{S['Office and team setup (Coimbatore)']-4}").number_format = INR
for col, w in zip("ABCDE", [66, 8, 16, 16, 70]):
    sc.column_dimensions[col].width = w
ONE_TIME = f"'Startup Costs'!$D${S['total']}"

# ---------------------------------------------------------------- Funding
fd = wb.create_sheet("Funding")
fd["A1"] = "Funding need, runway and return of investment"
fd["A1"].font = f(bold=True, size=14)
fd["A2"] = ("Two build months before launch (office, support, CA and tech; no founder salary), then 36 months of sales at the published prices. "
            "One-time startup costs are spent in Build 1. 5% of new customers pay a year upfront and renew yearly. GST and income tax pass through.")
fd["A2"].font = f(italic=True, size=9)
PRE, POST = 2, 36
cols = [f"Build {i}" for i in range(1, PRE + 1)] + [f"M{i}" for i in range(1, POST + 1)]
NCOL = len(cols)
first_col, last_col = "B", get_column_letter(1 + NCOL)
first_post = get_column_letter(2 + PRE)
scenarios = [
    ("Ideal case: 20 Team + 2 Business sales a month from launch", [20] * POST, [2] * POST),
    ("Realistic ramp: reaches 20 Team + 2 Business by month 7", [3, 6, 9, 12, 15, 18] + [20] * (POST - 6), [0, 0, 1, 1, 1, 2] + [2] * (POST - 6)),
    ("Slow: half the sales (10 Team + 1 Business by month 7)", [2, 3, 5, 6, 8, 10] + [10] * (POST - 6), [0, 0, 0, 0, 1, 0] + [1] * (POST - 6)),
]
pre_cost = f"({L}$B${C['run']}+({A['founder_pre']}-{A['founder']})*(1+{A['contingency']}))"
fixed_c = f"{L}$B${C['fixed_c']}"
ys, churn, ym = A["yearly_share"], A["churn"], A["year_months"]
T, B = plan_ref["team"], plan_ref["business"]
LABELS = {
    "nt": "New Team sales", "nb": "New Business sales", "at": "Paying Team companies", "ab": "Paying Business companies",
    "rs": "Setup fees", "rm": "Subscriptions (monthly + yearly prepaid)", "rev": "Revenue", "cost": "Costs (incl. one-time in Build 1)",
    "net": "Net cash this month", "cum": "Cash position (before investor money)", "drawn": "Investor money drawn to date",
    "tranche": "Investor money needed this month",
}
r = 4
blocks = []
for title, team_ramp, bus_ramp in scenarios:
    section(fd, r, title, 8)
    r += 1
    header(fd, r, ["₹", *cols])
    r += 1
    keys = list(LABELS)
    R_ = {k: r + i for i, k in enumerate(keys)}
    R_["pos_i"], R_["pay_i"] = r + len(keys), r + len(keys) + 1
    for key in keys:
        rr = R_[key]
        fd.cell(row=rr, column=1, value=LABELS[key]).font = f(bold=key in ("net", "cum", "tranche"))
        for i in range(NCOL):
            col, prev = get_column_letter(2 + i), get_column_letter(1 + i)
            k = i - PRE
            post = k >= 0
            back = get_column_letter(2 + i - 12) if k >= 12 else None
            if key == "nt":
                v = team_ramp[k] if post else 0
            elif key == "nb":
                v = bus_ramp[k] if post else 0
            elif key in ("at", "ab"):
                src = R_["nt" if key == "at" else "nb"]
                v = f"={col}{src}" if i == 0 else f"=ROUND({prev}{rr}*(1-{churn}),0)+{col}{src}"
            elif key == "rs":
                v = f"={col}{R_['nt']}*{T['setup']}+{col}{R_['nb']}*{B['setup']}"
            elif key == "rm":
                v = (f"=({col}{R_['at']}*{T['month']}+{col}{R_['ab']}*{B['month']})*(1-{ys})"
                     f"+({col}{R_['nt']}*{T['month']}+{col}{R_['nb']}*{B['month']})*{ym}*{ys}")
                if back:
                    v += f"+({back}{R_['nt']}*{T['month']}+{back}{R_['nb']}*{B['month']})*{ym}*{ys}*(1-{churn})^12"
                if k >= 24:
                    back2 = get_column_letter(2 + i - 24)
                    v += f"+({back2}{R_['nt']}*{T['month']}+{back2}{R_['nb']}*{B['month']})*{ym}*{ys}*(1-{churn})^24"
            elif key == "rev":
                v = f"={col}{R_['rs']}+{col}{R_['rm']}"
            elif key == "cost":
                if post:
                    v = (f"={fixed_c}+{col}{R_['at']}*{T['var']}+{col}{R_['ab']}*{B['var']}"
                         f"+{col}{R_['nt']}*{T['onboard']}+{col}{R_['nb']}*{B['onboard']}"
                         f"+{col}{R_['rs']}*{A['incentive']}+{col}{R_['rev']}*{A['pg_fee']}")
                else:
                    v = f"={pre_cost}" + (f"+{ONE_TIME}" if i == 0 else "")
            elif key == "net":
                v = f"={col}{R_['rev']}-{col}{R_['cost']}"
            elif key == "cum":
                v = f"={col}{R_['net']}" if i == 0 else f"={prev}{rr}+{col}{R_['net']}"
            elif key == "drawn":
                v = f"=MAX(0,-{col}{R_['cum']})" if i == 0 else f"=MAX({prev}{rr},-{col}{R_['cum']})"
            else:
                v = f"={col}{R_['drawn']}" if i == 0 else f"={col}{R_['drawn']}-{prev}{R_['drawn']}"
            c = fd.cell(row=rr, column=2 + i, value=v)
            c.number_format = NUM if key in ("nt", "nb", "at", "ab") else INR
            if key in ("nt", "nb") and post:
                c.font = f(BLUE)
            if key in ("net", "cum", "tranche"):
                c.font = f(bold=True)
    for key, src, test in (("pos_i", "net", ">0"), ("pay_i", "cum", ">=0")):
        fd.cell(row=R_[key], column=1, value=f"helper: column where {src} {test}").font = f(size=8, italic=True, color="808080")
        for i in range(NCOL):
            col = get_column_letter(2 + i)
            v = f"=IF({col}{R_[src]}{test},COLUMN()-1,999)" if (i >= PRE or key == "pay_i") else 999
            fd.cell(row=R_[key], column=2 + i, value=v).font = f(size=8, color="808080")
    blocks.append((title, R_))
    r = R_["pay_i"] + 2

HDR = f"{first_col}$5:{last_col}$5"
def ycol(y, end=False):
    return get_column_letter(1 + PRE + (12 * y if end else 12 * (y - 1) + 1))

section(fd, r, "Summary", 8)
r += 1
header(fd, r, ["", "Ideal", "Realistic", "Slow", "", "", "", "How it is worked out"])
r += 1
summary = [
    ("one", "One-time startup costs", lambda b: f"={ONE_TIME}", INR, "Startup Costs tab"),
    ("prelaunch", "Two build months (no founder salary)", lambda b: f"={pre_cost}*2", INR, ""),
    ("peak", "Investor money needed in total (before buffer)", lambda b: f"={last_col}{b['drawn']}", INR, "Deepest point of the cash line"),
    ("pos_month", "First month with a profit", lambda b: f'=IF(MIN({first_col}{b["pos_i"]}:{last_col}{b["pos_i"]})=999,"after M36",INDEX({HDR},1,MIN({first_col}{b["pos_i"]}:{last_col}{b["pos_i"]})))', None, "Revenue above costs; from here the business funds itself"),
    ("pay_month", "Investment earned back (cash position ≥ 0)", lambda b: f'=IF(MIN({first_col}{b["pay_i"]}:{last_col}{b["pay_i"]})=999,"after M36",INDEX({HDR},1,MIN({first_col}{b["pay_i"]}:{last_col}{b["pay_i"]})))', None, "All money put in has come back as profit"),
    ("rev1", "Revenue year 1", lambda b: f"=SUM({ycol(1)}{b['rev']}:{ycol(1, True)}{b['rev']})", INR, ""),
    ("rev2", "Revenue year 2", lambda b: f"=SUM({ycol(2)}{b['rev']}:{ycol(2, True)}{b['rev']})", INR, ""),
    ("rev3", "Revenue year 3", lambda b: f"=SUM({ycol(3)}{b['rev']}:{ycol(3, True)}{b['rev']})", INR, ""),
    ("pro1", "Profit year 1 (after build months and one-time costs)", lambda b: f"=SUM({first_col}{b['net']}:{ycol(1, True)}{b['net']})", INR, ""),
    ("pro2", "Profit year 2", lambda b: f"=SUM({ycol(2)}{b['net']}:{ycol(2, True)}{b['net']})", INR, ""),
    ("pro3", "Profit year 3", lambda b: f"=SUM({ycol(3)}{b['net']}:{ycol(3, True)}{b['net']})", INR, ""),
    ("cash36", "Cash generated by M36 (after paying back the investment)", lambda b: f"={last_col}{b['cum']}", INR, ""),
    ("cos36", "Paying companies at M36", lambda b: f"={last_col}{b['at']}+{last_col}{b['ab']}", NUM, ""),
    ("mrr36", "Monthly subscription revenue at M36", lambda b: f"={last_col}{b['at']}*{T['month']}+{last_col}{b['ab']}*{B['month']}", INR, "All customers at monthly price"),
]
SM = {}
for key, label, fn, fmt, src in summary:
    fd.cell(row=r, column=1, value=label).font = f(bold=key in ("peak", "pos_month", "pay_month"))
    for i, (_, b) in enumerate(blocks):
        c = fd.cell(row=r, column=2 + i, value=fn(b))
        if fmt:
            c.number_format = fmt
    note(fd, r, 8, src)
    SM[key] = r
    r += 1
r += 1
section(fd, r, "Investor ask (ideal case)", 8)
r += 1
fd.cell(row=r, column=1, value="Safety buffer (months of fixed costs)").font = f()
fd.cell(row=r, column=2, value=3).font = f(BLUE)
fd.cell(row=r, column=2).fill = KEY_FILL
note(fd, r, 8, "Cover for slower sales or a late launch")
buf = r
r += 1
ask_rows = [
    ("ask", "Amount to raise (ideal need + buffer, rounded up to ₹5 lakh)", f"=CEILING(B{SM['peak']}+B{buf}*{fixed_c},500000)", INR),
    ("burn", "Monthly fixed costs after launch", f"={fixed_c}", INR),
    ("runway0", "Runway if no sales came in at all (months after one-time costs and build)", f"=(B{{ask}}-B{SM['one']}-B{SM['prelaunch']})/B{{burn}}", DEC),
    ("left_real", "Money left at the lowest point, realistic ramp", f"=B{{ask}}-C{SM['peak']}", INR),
    ("left_slow", "Money left at the lowest point, slow case", f"=B{{ask}}-D{SM['peak']}", INR),
    ("x36", "Cash at M36 for each ₹1 raised (ideal)", f"=IFERROR((B{SM['cash36']}+B{{ask}})/B{{ask}},0)", '0.0"x"'),
]
for key, *_ in ask_rows:
    SM[key] = r
    r += 1
r = SM["ask"]
for key, label, formula, fmt in ask_rows:
    fd.cell(row=r, column=1, value=label).font = f(bold=key == "ask")
    c = fd.cell(row=r, column=2, value=formula.format(**SM))
    c.number_format = fmt
    if key == "ask":
        c.font = f(bold=True)
        c.fill = KEY_FILL
    r += 1
fd.column_dimensions["A"].width = 62
for i in range(NCOL):
    fd.column_dimensions[get_column_letter(2 + i)].width = 13
for sheet in wb.worksheets:
    sheet.freeze_panes = "A5" if sheet.title != "Funding" else "B4"
wb.calculation.fullCalcOnLoad = True
wb.save(OUT)
print("saved", OUT)
