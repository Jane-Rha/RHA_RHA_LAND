# TCTChatLog_GCX

Google Apps Script project for the Spigen GCX TCT (Third-party Channel Team) chat log sheet. Sends escalation alerts to Google Chat when a row status changes to `Esc T2`, sends daily close reports, and manages dropdown validation on log sheets.

**Script ID:** `15E1ZJabPc7bQ4aKptxmPfCzOXryCDibhtYdZpKb6x1R-U6G_e8eHeqBm`

---

## Files

| File | Purpose |
|------|---------|
| `chat_alrt_main.js` | `onEdit` trigger — detects `Esc T2` status in col A and posts a Google Chat card to the platform-specific webhook |
| `send_daily_stat.js` | Daily summary — counts `Esc T2` rows per sheet and sends a close-report card to Google Chat |
| `auto_suggestion_Q_col.js` | Sets dropdown validation on col Q (`voucher` options) for Lazada/Shopee log sheets |
| `trigger.js` | Sets up time-based triggers for daily summary |
| `appsscript.json` | GAS manifest |

---

## Escalation alert flow (`chat_alrt_main.js`)

1. `onEdit` fires on any edit in rows 5+ of `Lazada log` or `Shopee log`
2. If **col A** changes to `Esc T2` and hasn't been sent before (deduped by `SENT_IDS` in Script Properties):
   - Collects all other `Esc T2` rows on the same sheet
   - Posts a Google Chat card with buttons linking to each row
3. Routes to the correct webhook based on sheet name + platform value in col D:
   - `Lazada log` + `Lazada` → `WEBHOOK_LAZADA`
   - `Shopee log` + `Shopee` → `WEBHOOK_SHOPEE`

---

## Daily summary (`send_daily_stat.js`)

Triggered by time-based trigger — posts a `TCT Chat Log_GCX 마감보고` card to Google Chat with counts of `Esc T2` rows across all log sheets and sheet-link buttons.

---

## Deployment

```bash
cd ~/Desktop/GCX/TCTChatLog_GCX
clasp push --force
```

Set a daily time-based trigger on the summary function in the GAS editor.
