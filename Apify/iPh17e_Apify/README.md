# iPh17e_Apify (iPhone 17e)

Container-bound Google Apps Script for the iPhone 17e review spreadsheet. Triggers an Apify review scraping run, polls for completion, and writes results into the sheet.

**Script ID:** `1oIR6d9_cjLXpRLMvpVfU0WSIPOZba3S1m7DGc1eAx8VmPMzxqjm7eU-6`  
**Linked spreadsheet:** `16xRJHH7Ynii4erNOn_905ST4CZs6OLpOYTof4uqsGsQ` (iPhone 17e review sheet)

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
cd ~/Desktop/GCX/Apify/iPh17e_Apify
clasp push --force
```
