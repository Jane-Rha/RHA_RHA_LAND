# 유지훈P_Apify

Container-bound Google Apps Script for the 유지훈P review spreadsheet. Triggers an Apify review scraping run, polls for completion, writes results into the sheet, and sends escalation alerts to Google Chat.

**Script ID:** `1UZ5NzqtjTa5nHW17w0vOOgbrFG6Zn2TpxVqkfFc4WdZHfR7upLVz_lmO`  
**Linked spreadsheet:** `1dlY6q8trbVMVJAjw_OUoxp1cguA2oTB8WlPhHR01xIw` (유지훈P review sheet)

---

## Files

| File | Purpose |
|------|---------|
| `Code.js` | Apify run lifecycle — start task, poll status, write results |
| `UI.js` | `onOpen()` menu + sidebar |
| `Product.js` | Product aggregate data (rating / review count per ASIN) |
| `Trigger.js` | Time-based trigger setup |
| `Config.js` | `CONFIG` object — Apify task ID, sheet name, poll delay, webhook |
| `Alert.js` | Google Chat alert helpers |
| `appsscript.json` | GAS manifest |

---

## Config (`Config.js`)

| Key | Value |
|-----|-------|
| `actorTaskIdOrSlug` | `vUlCaUpNvjgC23g5T` |
| `POLL_DELAY` | 2 hours (production) / 2 minutes (test mode) |
| `CHAT_WEBHOOK_URL` | TCK GCX Spigen Google Chat space |

> Note: this project uses a different Apify task ID from the other per-product projects.

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
cd ~/Desktop/GCX/Apify/유지훈P_Apify
clasp push --force
```
