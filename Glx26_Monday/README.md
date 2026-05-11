# Glx26_Monday (Galaxy S26 — Apify + Monday.com)

Container-bound Google Apps Script for the Galaxy S26 review spreadsheet. Triggers an Apify review scraping run, polls for completion, writes results into the sheet, and syncs flagged reviews to a Monday.com board.

**Script ID:** `1sPKcHgYy8kEqrp6Ra_FSw3vpnIVlJgB5dNeFLVTzZrZoptmEeA8lnrMm`  
**Linked spreadsheet:** `1fpv9TEDPGR8D6QRRc0ll-WzF7sOkfxe9UNBCmdBSE9g` (Galaxy S26 review sheet)  
**Monday.com board:** `18399593191` (Galaxy S26 Case+CP)

---

## Files

| File | Purpose |
|------|---------|
| `Code.js` | Apify run lifecycle — start task, poll status, write results |
| `Main.js` | Entry points and menu wiring |
| `UI.js` | `onOpen()` sidebar and Apify menu items |
| `Products.js` | Product-level aggregate data fetch (rating, review count per ASIN) |
| `Gemini.js` | Gemini API helpers for AI review summaries |
| `config.js` | `CONFIG` object — Apify task ID, sheet name, poll delay, webhook |
| `uploader_sidebar.html` | Sidebar HTML for manual upload UI |
| `국내.js` | Domestic (Korean) review handling helpers |
| `appsscript.json` | GAS manifest |

---

## Config (`config.js`)

| Key | Value |
|-----|-------|
| `actorTaskIdOrSlug` | Apify task ID for Galaxy S26 scraping |
| `UPLOAD_SHEET_ID` | `1fpv9TEDPGR8D6QRRc0ll-WzF7sOkfxe9UNBCmdBSE9g` |
| `UPLOAD_SHEET_NAME` | `1-3점` |
| `BOARD_ID` | `18399593191` |
| `POLL_DELAY` | 2 hours (production) / 2 minutes (test mode) |

---

## Usage

Open the linked spreadsheet → **Apify → Product → Run Product (auto polling)**.

The script starts an Apify task run, saves the run ID, and schedules a recurring poll trigger. When the run succeeds it writes results to the sheet and posts a notification to Google Chat.

To sync reviews to Monday.com: use the **Monday.com → 업데이트하기** menu item.

---

## Script Properties required

| Key | Description |
|-----|-------------|
| `APIFY_TOKEN` | Apify API token |

---

## Deployment

```bash
cd ~/Desktop/GCX/Glx26_Monday
clasp push --force
```
