# spigen-gcx-automation

Internal automation scripts for the Spigen GCX (Global Customer Experience) team — Amazon review monitoring, Seller Central scraping, MCF order tracking, daily reporting, and CS workflow tooling.

---

## Repository structure

```
spigen-gcx-automation/
│
├── SC_Review_Scraper/          # Python — Playwright scraper for Amazon Seller Central reviews
├── amazon_dp_scraper/          # Python — Amazon /dp/ product detail scraper (Playwright, async)
├── amazon_child_asin_scraper/  # Python — Amazon parent→child ASIN resolver + rating/review scraper
│
├── MasterTrigger/              # GAS — daily review distribution job (all products)
├── Apify/
│   ├── APIFY_Axesso/           # GAS — Apify/Axesso review scrape + sheet distribution (legacy master)
│   ├── Glx26_Monday → see Glx26_Monday/ at root
│   ├── Pixel10a_Apify/         # GAS — Pixel 10a per-product Apify trigger
│   ├── Power_Acc_Apify/        # GAS — Power Accessories per-product Apify trigger
│   ├── SDA_Apify/              # GAS — Screen & Display Accessories per-product Apify trigger
│   ├── iPh17e_Apify/           # GAS — iPhone 17e per-product Apify trigger
│   ├── 유지훈P_Apify/           # GAS — 유지훈P per-product Apify trigger
│   └── apify-amazon-dp-scraper/ # Apify Actor — Amazon /dp/ scraper (cloud-run version)
│
├── Glx26_Monday/               # GAS — Galaxy S26 Apify trigger + Monday.com board sync
│
├── MCF_Tracking/               # GAS — MCF order tracking, SP-API fee/tracking lookup, daily Chat alert
├── CX_Dashboard/               # GAS — SP-API data dashboard (orders, sales, inventory, feedback)
├── Bi-Weekly/                  # GAS — Bi-weekly CX report Slides auto-updater with arc charts
├── SheetMirror/                # GAS — Chunk-copy `26년 전체문의` to a read-only dashboard sheet
├── TCTChatLog_GCX/             # GAS — Lazada/Shopee Esc T2 alerts + daily close report to Google Chat
├── TicketDailyReport/          # GAS — Zendesk daily ticket report with charts sent to Google Chat
├── TriggerAlert/               # GAS — Monday.com board → Google Sheets sync
│
├── Tampermonkey_GCX/           # Tampermonkey userscripts — MCF autofill (EU + JP), invoice download
├── tampermonkey_scripts/       # Tampermonkey full export (includes .options.json / .storage.json)
│
└── reference/                  # Internal reference docs
```

---

## Projects

### Python scrapers

| Project | Description | README |
|---------|-------------|--------|
| [SC_Review_Scraper](SC_Review_Scraper/) | Scrapes Amazon Seller Central reviews across US/EU/JP/IN with Playwright. Parallel by top-level domain; EU countries (DE→IT→FR→ES→UK) scrape sequentially on one shared tab. Enriches reviews with reviewer image URLs. | [README](SC_Review_Scraper/README.md) |
| [amazon_dp_scraper](amazon_dp_scraper/) | Async Playwright scraper for Amazon `/dp/` pages — rating, review count, title, spec table. Up to 8 domains simultaneously, dual-sheet Excel output (English + local-language). | [README](amazon_dp_scraper/README.md) |
| [amazon_child_asin_scraper](amazon_child_asin_scraper/) | Selenium scraper that resolves parent ASINs into child variants and extracts per-child rating/review counts. Detects shared variation review pools. | [README](amazon_child_asin_scraper/README.md) |

### Google Apps Script — Review automation

| Project | Product | Description | README |
|---------|---------|-------------|--------|
| [MasterTrigger](MasterTrigger/) | All | Daily job that reads the `"finalize"` filter view from each product's source sheet and distributes new reviews into destination spreadsheets. Handles dedup, `=dr()` formula injection, and `tem` sheet refresh. | [README](MasterTrigger/README.md) |
| [Apify/APIFY_Axesso](Apify/APIFY_Axesso/) | All | Legacy master script (same logic as MasterTrigger). Also contains `Code.gs` for Apify run lifecycle and `Product.gs` for aggregate rating/review fetch. | [README](Apify/APIFY_Axesso/README.md) |
| [Glx26_Monday](Glx26_Monday/) | Galaxy S26 | Per-product Apify trigger + Monday.com board sync for Galaxy S26 review sheet. | [README](Glx26_Monday/README.md) |
| [Apify/Pixel10a_Apify](Apify/Pixel10a_Apify/) | Pixel 10a | Per-product Apify trigger for Pixel 10a review sheet. | [README](Apify/Pixel10a_Apify/README.md) |
| [Apify/iPh17e_Apify](Apify/iPh17e_Apify/) | iPhone 17e | Per-product Apify trigger for iPhone 17e review sheet. | [README](Apify/iPh17e_Apify/README.md) |
| [Apify/SDA_Apify](Apify/SDA_Apify/) | SDA | Per-product Apify trigger for Screen & Display Accessories review sheet. | [README](Apify/SDA_Apify/README.md) |
| [Apify/Power_Acc_Apify](Apify/Power_Acc_Apify/) | Power Acc. | Per-product Apify trigger for Power Accessories review sheet. | [README](Apify/Power_Acc_Apify/README.md) |
| [Apify/유지훈P_Apify](Apify/유지훈P_Apify/) | 유지훈P | Per-product Apify trigger for 유지훈P review sheet. | [README](Apify/유지훈P_Apify/README.md) |

### Google Apps Script — Operations & reporting

| Project | Description | README |
|---------|-------------|--------|
| [MCF_Tracking](MCF_Tracking/) | Multi-Channel Fulfillment order tracking. SP-API custom formulas (`=AMZTK()`, `=MCFFee()`), backfill functions, `onEdit` automation, and daily Google Chat alert for orders missing tracking numbers. | [README](MCF_Tracking/README.md) |
| [CX_Dashboard](CX_Dashboard/) | SP-API data dashboard — refreshes Marketplaces, Orders, Sales Metrics, Customer Feedback, and FBA Inventory into dedicated sheets via menu actions or custom formulas. | [README](CX_Dashboard/README.md) |
| [Bi-Weekly](Bi-Weekly/) | Auto-populates a bi-weekly CX report Google Slides deck with live data — text placeholder substitution and half-donut arc chart image insertion for defect/model breakdowns. | [README](Bi-Weekly/README.md) |
| [SheetMirror](SheetMirror/) | Copies `26년 전체문의` to a read-only dashboard spreadsheet in 1,000-row chunks. | [README](SheetMirror/README.md) |
| [TCTChatLog_GCX](TCTChatLog_GCX/) | Lazada/Shopee escalation alerts — sends Google Chat cards when a row status changes to `Esc T2`, plus a daily close-report card. | [README](TCTChatLog_GCX/README.md) |
| [TicketDailyReport](TicketDailyReport/) | Fetches Zendesk ticket views, updates graph sheets, and sends daily chart images to Google Chat via the `hcti.io` image API. | [README](TicketDailyReport/README.md) |
| [TriggerAlert](TriggerAlert/) | Syncs a Monday.com board into a Google Sheet via the Monday API, with a live-log sidebar UI. | [README](TriggerAlert/README.md) |

### Tampermonkey userscripts

| Project | Description | README |
|---------|-------------|--------|
| [Tampermonkey_GCX](Tampermonkey_GCX/) | MCF order autofill (EU + JP), Amazon.de invoice download automation. Install `.user.js` files via Tampermonkey Dashboard → Import. | [README](Tampermonkey_GCX/README.md) |

---

## Quick start

### Python scrapers

```bash
pip install playwright openpyxl pynput selenium
playwright install chromium
```

### Google Apps Script (clasp)

```bash
npm install -g @google/clasp
clasp login

# Push any project
cd ~/Desktop/GCX/<ProjectFolder>
clasp push --force
```

Each GAS project has its own `.clasp.json` (gitignored) pointing to the correct GAS script ID. See each project's README for the script ID and linked spreadsheet.

### Script Properties (all GAS projects that call external APIs)

Set in **Extensions → Apps Script → Project Settings → Script Properties**:

| Key | Used by |
|-----|---------|
| `APIFY_TOKEN` | All per-product Apify triggers, APIFY_Axesso |
| `LWA_CLIENT_ID` / `LWA_CLIENT_SECRET` / `LWA_REFRESH_TOKEN` | MCF_Tracking, CX_Dashboard |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | MCF_Tracking, CX_Dashboard |
| `MONDAY_API_KEY` | TriggerAlert, Glx26_Monday |

---

## Branching & commit conventions

| Branch | Use |
|--------|-----|
| `main` | Stable, production-ready |
| `feat/<desc>` | New features |
| `fix/<desc>` | Bug fixes |

Commit message format: `<type>(<project>): <description>`

Examples:
```
feat(sc-scraper): add EU single-country re-run support
fix(master-trigger): guard against missing destRidIdx
feat(mcf-tracking): add MCFFee_JP formula
```
