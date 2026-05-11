# TicketDailyReport

Google Apps Script project that generates the Spigen GCX daily Zendesk ticket report — fetches open ticket views from the Zendesk API, updates graph sheets, and posts chart images to Google Chat.

**Script ID:** `1GNowLPF82wfWIrHc1Q9xIDr_L0Kz5iv_YxuNRb7Pzioe9OpsS_O_J5L6`  
**Linked spreadsheet:** `10VYnysCGztKWMXfvXIWBVcE2_zENnRxvXUr9nicHkpo`

---

## Files

| File | Purpose |
|------|---------|
| `main.js` | `runZendeskDailyJob()` — orchestrates all steps |
| `ZendeskAPI.js` | Zendesk API helpers — fetch tickets by view, dedup by ticket ID |
| `All_GraphGen.js` | Appends daily counts to `All_Graph` sheet and renders charts |
| `K_시트Gen.js` | Fills the `K_시트` table with current ticket data |
| `sendChat.js` | Sends chart images to Google Chat via `hcti.io` image API + webhook |
| `testingFunc.js` | Manual test helpers |
| `trigger.js` | Sets up time-based triggers |
| `appsscript.json` | GAS manifest |

---

## Daily job flow (`runZendeskDailyJob`)

```
1. fetchZendeskViewToSheet()      → fills 'Zendesk_Daily' sheet via Zendesk API
2. fetchZendeskViewToKsheet()     → fills 'K_시트' B5:Gn table
3. (sleep 600ms)
4. appendZendeskDailyStatus()     → counts & appends to 'All_Graph', clears 'Zendesk_Daily'
5. all_GraphChartToGoogleChat()   → sends chart image to Google Chat
6. collapseOldRowsIfNeeded()      → collapses rows older than 4 weeks
7. fetchZendeskViewToKsheet()     → refreshes 'K_시트' for P_시트
8. kSheetToChat()                 → sends 'K_시트' snapshot image to Google Chat
```

---

## Configuration

Zendesk credentials are hardcoded in `ZendeskAPI.js` (top of file):

| Constant | Value |
|----------|-------|
| `ZENDESK_SUBDOMAIN` | `spigenhelp` |
| `ZENDESK_EMAIL` | `kjw@spigen.com` |
| `ZENDESK_TOKEN` | API token (set in file) |

Google Chat webhook is set at the top of `main.js`.

---

## Deployment

```bash
cd ~/Desktop/GCX/TicketDailyReport
clasp push --force
```

Set a daily time-based trigger on `runZendeskDailyJob` in the GAS editor.
