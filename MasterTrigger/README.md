# MasterTrigger

Google Apps Script project that runs the daily Amazon review distribution job — reads newly scraped reviews from the source spreadsheet and pushes them into per-product destination spreadsheets.

**Script ID:** `1AWrX0Xl8feD-AzYRbGVBb9kLRQra2ppE547i_Ghys4lLU9l28pkMUf9O`  
**Source spreadsheet:** `1tMbA_msRfCRY0KK40GnyZ_h1uNCldlnk9Cg-_MTcbsw`

> This is the canonical `clasp` folder for the master daily job. Always push from here — never from `Apify/APIFY_Axesso/`.

---

## Files

| File | Purpose |
|------|---------|
| `Master.js` | `masterDailyJob()` — main daily trigger entry point |
| `Apify.js` | Apify run lifecycle — start task, poll status, write results to source sheet |
| `Sheet_Automation.js` | Helpers for filter-view reading, row dedup, and destination sheet writes |
| `trigger.js` | Sets up time-based triggers |
| `appsscript.json` | GAS manifest (timezone, OAuth scopes, advanced services) |

---

## How it works

```
masterDailyJob()
  │
  ├─ step1_deleteNumberedSheets()      Delete conflict/dated sheets not matching today (KST)
  ├─ step2_dedupDatedSheets()          Deduplicate today's dated sheets by Review ID
  ├─ step2b_updateTemSheet()           Refresh `tem` sheet with all active Review IDs per product
  └─ Per-config loop (SHEET_CONFIGS)
        ├─ has15 = true  → _processFilterSheet_()   writes 1-5점 + sets =dr() in 1-3점
        └─ has15 = false → _processTo13_()           writes 1-3점 only
```

Each config reads the `"finalize"` named filter view from the source `XXX_filter` sheet to determine the date cutoff and any hidden-row exclusions, then deduplicates against existing Review IDs in the destination before pasting.

---

## SHEET_CONFIGS (as of 2026-04-01)

| filterSheet | Dest spreadsheet ID | has15 | Countries | Notes |
|-------------|---------------------|-------|-----------|-------|
| `Glx26_filter` | `1fpv9TEDPGR8D6QRRc0ll-WzF7sOkfxe9UNBCmdBSE9g` | true | US FR ES JP UK IN DE IT | seriesFilter Q ⊇ "S26" |
| `iPh17e_filter` | `16xRJHH7Ynii4erNOn_905ST4CZs6OLpOYTof4uqsGsQ` | true | US FR ES JP UK IN DE IT | seriesFilter N ⊇ "17e" |
| `Pixel10a_filter` | `1BpeGq5gIr4tNsPZmnHr19NNY6pQ6sb2_H-v3V9-It4E` | true | US FR ES JP UK IN DE IT | seriesFilter N ⊇ "10a" |
| `SDA_filter` | `1sxapIqJgXcJdeqyCf9bAxCNXrVMsVjsZE9QWPwEm0R4` | false | FR ES JP UK DE IT | |
| `Auto_Acc_filter` | `1mEYb1b92D6BIOaSYkAnMit6THuw5ewtymhA-mSIVDfs` | false | FR ES UK DE IT | |
| `Power_Acc_filter` | `1QC8Is6UvTnFXaOeXviKM_331i3Fo_CBIYx80VS696LI` | false | IN | |
| `전략폰_filter` | `1yo8CbLhJkuxrf3eXbAqZCb6qBejZhSR3YOt7nFv97fw` | false | IN | |
| `유지훈P_filter` | `1dlY6q8trbVMVJAjw_OUoxp1cguA2oTB8WlPhHR01xIw` | false | US FR ES JP UK IN DE IT | insertAtTop, ratingFilter 1–3 |

---

## Deployment

```bash
# Pull latest from GAS
cd ~/Desktop/GCX/MasterTrigger && clasp pull

# Push changes to GAS
clasp push --force

# Commit and push to GitHub
cd ~/Desktop/GCX
git add MasterTrigger/
git commit -m "feat(master-trigger): ..."
git push
```

Set a daily time-based trigger on `masterDailyJob` in the GAS editor (suggested: 06:00 KST).
