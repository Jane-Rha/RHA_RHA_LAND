# SDA_Apify (Screen & Display Accessories)

Container-bound Google Apps Script for the SDA review spreadsheet. Triggers an Apify review scraping run, polls for completion, and writes results into the sheet.

**Script ID:** `1rUwC_XwGUjZvu5ileGo_jAhihoMaio4wfdtjSnqO0VIclG0OByVDyoco`  
**Linked spreadsheet:** `1sxapIqJgXcJdeqyCf9bAxCNXrVMsVjsZE9QWPwEm0R4` (SDA review sheet)

---

## Files

| File | Purpose |
|------|---------|
| `Code.js` | Apify run lifecycle — start task, poll status, write results |
| `UI.js` | `onOpen()` menu + sidebar |
| `Product.js` | Product aggregate data (rating / review count per ASIN) |
| `Trigger.js` | Time-based trigger setup |
| `Config.js` | `CONFIG` object — Apify task ID, sheet name, poll delay, webhook |
| `appsscript.json` | GAS manifest |

---

## Config (`Config.js`)

| Key | Value |
|-----|-------|
| `actorTaskIdOrSlug` | `TvUlCaUpNvjgC23g5` |
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
cd ~/Desktop/GCX/Apify/SDA_Apify
clasp push --force
```
