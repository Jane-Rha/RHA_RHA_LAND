# CX_Dashboard

Google Apps Script project that pulls live Amazon SP-API data into a Google Spreadsheet — marketplaces, orders, sales metrics, customer feedback, and FBA inventory. Also exposes SP-API data as custom sheet formulas (`=SPORDERS()`, `=SPMARKETPLACES()`, etc.).

**Script ID:** `1FIyZcgVPPlVE_A5zrFB01khTt-5QeYT6xAtgcLGuh-PHXByt_1ZTz84S`  
**Linked spreadsheet:** `1C3QOyhjGk-zMKr0H8-lwEMNmzk128ijuiLfSUmsEUm4`

---

## Files

| File | Purpose |
|------|---------|
| `sp-api.js` | SP-API auth (LWA + AWS SigV4), `spapiFetchWithRetry`, cache helpers |
| `formulas.js` | Custom sheet formulas: `=SPMARKETPLACES()`, `=SPORDERS()`, `=SPSALES()`, etc. |
| `menu.js` | `onOpen()` menu + Refresh functions (Marketplaces, Orders, Sales Metrics, Feedback, Inventory) |
| `appsscript.json` | GAS manifest |

---

## Menu actions

| Menu item | What it does |
|-----------|-------------|
| **Setup Sheets** | Creates Config sheet + placeholder tabs for all data sheets |
| **Refresh Marketplaces** | Fetches all marketplace participations from EU + FE endpoints |
| **Refresh Orders** | Paginated order list for the configured marketplace and date range |
| **Refresh Sales Metrics** | Order metrics aggregated by configurable granularity (Day/Week/Month/…) |
| **Refresh Feedback** | Customer feedback entries for the date range |
| **Refresh Inventory** | FBA inventory summaries per SKU/ASIN |

---

## Config sheet settings

After running **Setup Sheets**, edit the `Config` tab:

| Setting | Default | Notes |
|---------|---------|-------|
| `MARKETPLACE_ID` | `A1F83G8C2ARO7P` (UK) | Run `=SPMARKETPLACES()` to find your IDs |
| `START_DATE` | `2025-01-01` | Filter start (YYYY-MM-DD) |
| `END_DATE` | today | Filter end |
| `SALES_GRANULARITY` | `Day` | Day / Week / Month / Year / Total |
| `FULFILLMENT_NETWORK` | `All` | All / AFN / MFN |
| `MAX_PAGES` | `10` | Pagination cap for Refresh Orders |

---

## Script Properties (SP-API credentials)

Set in **Extensions → Apps Script → Project Settings → Script Properties**:

| Key | Description |
|-----|-------------|
| `LWA_CLIENT_ID` | EU LWA client ID |
| `LWA_CLIENT_SECRET` | EU LWA client secret |
| `LWA_REFRESH_TOKEN` | EU LWA refresh token |
| `LWA_CLIENT_ID_JP` | FE LWA client ID |
| `LWA_CLIENT_SECRET_JP` | FE LWA client secret |
| `LWA_REFRESH_TOKEN_JP` | FE LWA refresh token |
| `AWS_ACCESS_KEY_ID` | AWS access key (SigV4) |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key |

---

## Deployment

```bash
cd ~/Desktop/GCX/CX_Dashboard
clasp push --force
```
