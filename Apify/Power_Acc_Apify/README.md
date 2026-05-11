# Power_Acc_Apify (Power Accessories)

Container-bound Google Apps Script for the Power Accessories review spreadsheet. Triggers an Apify review scraping run, polls for completion, and writes results into the sheet.

**Script ID:** `1xQhzIcvjP2n2zp5RFDOwckB5HOnBCvJXLlw1aRjaXF8ie2JLKX8MHVWt`  
**Linked spreadsheet:** `1QC8Is6UvTnFXaOeXviKM_331i3Fo_CBIYx80VS696LI` (Power Acc. CustomerReviews ★1~3)

---

## Files

| File | Purpose |
|------|---------|
| `Code.js` | Apify run lifecycle — start task, poll status, write results |
| `Main.js` | Entry points |
| `UI.js` | `onOpen()` menu + sidebar |
| `Product.js` | Product aggregate data (rating / review count per ASIN) |
| `GProducts.js` | Product helpers |
| `Gemini.js` | Gemini API helpers for AI review summaries |
| `config.js` | `CONFIG` object — Apify task ID, sheet name, poll delay, webhook |
| `trigger.js` | Time-based trigger setup |
| `국내.js` | Domestic (Korean) review handling helpers |
| `appsscript.json` | GAS manifest |

---

## Config (`config.js`)

| Key | Value |
|-----|-------|
| `actorTaskIdOrSlug` | `TvUlCaUpNvjgC23g5` |
| `getSpreadsheetId_()` | `1QC8Is6UvTnFXaOeXviKM_331i3Fo_CBIYx80VS696LI` (hardcoded — container-bound) |
| `POLL_DELAY` | 2 hours (production) / 2 minutes (test mode) |
| `CHAT_WEBHOOK_URL` | TCK GCX Spigen Google Chat space |

---

## Usage

Open the linked spreadsheet → **Apify → Product → Run Product (auto polling)**.

---

## Script Properties required

| Key | Description |
|-----|-------------|
| `APIFY_TOKEN` | Apify API token |

---

## Deployment

```bash
cd ~/Desktop/GCX/Apify/Power_Acc_Apify
clasp push --force
```
