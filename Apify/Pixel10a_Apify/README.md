# Pixel10a_Apify (Google Pixel 10a)

Container-bound Google Apps Script for the Pixel 10a review spreadsheet. Triggers an Apify review scraping run, polls for completion, and writes results into the sheet.

**Script ID:** `1Ah4m3-STEzY7tfURUhgRIDub-m7sI8NKE54mF2YUtWXKQE1ehHkAh1MI`  
**Linked spreadsheet:** `1BpeGq5gIr4tNsPZmnHr19NNY6pQ6sb2_H-v3V9-It4E` (Pixel 10a review sheet)

---

## Files

| File | Purpose |
|------|---------|
| `Code.js` | Apify run lifecycle — start task, poll status, write results |
| `UI.js` | `onOpen()` menu + sidebar |
| `Products.js` | Product aggregate data (rating / review count per ASIN) |
| `Gemini.js` | Gemini API helpers for AI review summaries |
| `config.js` | `CONFIG` object — Apify task ID, sheet name, poll delay, webhook |
| `appsscript.json` | GAS manifest |

---

## Config (`config.js`)

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
cd ~/Desktop/GCX/Apify/Pixel10a_Apify
clasp push --force
```
