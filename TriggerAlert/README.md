# TriggerAlert

Google Apps Script project that syncs a Monday.com board into a Google Spreadsheet. Opens a live-log sidebar in the sheet UI showing sync progress, and writes board items and their column values as rows.

**Script ID:** `1WwwnwKuPbpdTGG6Uozx1Mr0AZU9mD_hc3UzHq82e_t-GjRe2eQ_4K-Fp`

---

## Files

| File | Purpose |
|------|---------|
| `Code.js` | `syncMondayBoardToSheet()`, sidebar UI HTML, progress logger |
| `appsscript.json` | GAS manifest |

---

## Configuration (top of `Code.js`)

| Constant | Default | Notes |
|----------|---------|-------|
| `BOARD_ID` | `7606389164` | Monday.com board ID — change per sheet |
| `MONDAY_API_KEY_HARDCODED` | `''` | Set here or in Script Property `MONDAY_API_KEY` |
| `PAGE_LIMIT` | `500` | Max items fetched per run |
| `RESPECT_SHEET_FORMATS` | `true` | Preserve existing cell formatting on write |

---

## Usage

Open the linked spreadsheet → **Monday.com → 업데이트하기**.

A modeless dialog opens showing a live sync log. The script fetches all items from the configured board (paginated, up to `PAGE_LIMIT`) and writes them to the active sheet.

To sync a different board, update `BOARD_ID` in `Code.js` and redeploy.

---

## Script Property (alternative to hardcoded key)

Set `MONDAY_API_KEY` in **Extensions → Apps Script → Project Settings → Script Properties** instead of hardcoding it in `Code.js`.

---

## Deployment

```bash
cd ~/Desktop/GCX/TriggerAlert
clasp push --force
```
