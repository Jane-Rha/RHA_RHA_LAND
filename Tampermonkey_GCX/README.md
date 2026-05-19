# Tampermonkey_GCX

Tampermonkey userscripts for the Spigen GCX Amazon operations workflow. Install via [Tampermonkey](https://www.tampermonkey.net/) → Dashboard → Utilities → Import.

---

## Scripts

### Amazon MCF Autofill (`v0.8.1`)
**Matches:** `sellercentral.amazon.*` and `sellercentral-europe.amazon.*` — MCF create-order pages

Injects a floating panel on the MCF order creation page (EU marketplaces: UK, DE, FR, IT, ES). Autofills recipient name, address, and line items from a GCX order ID, reducing manual data entry when placing Multi-Channel Fulfillment orders.

---

### Amazon JP MCF Autofill (`v1.4.4`)
**Matches:** `sellercentral-japan.amazon.com` — MCF create-order pages

JP-specific variant of the MCF Autofill script. Pulls order data from a Google Apps Script endpoint, maps Japanese prefecture names to their romanized equivalents, and autofills the JP MCF order form.

---

### Amazon Invoice Automation (`v1.5`)
**Matches:** `sellercentral.amazon.de` — individual order pages

Adds a "Run Now" button on Amazon.de Seller Central order pages. On click, attempts to download the deemed resale/supply invoice first, falling back to the Amazon-generated invoice. Copies the result to clipboard via `GM_setClipboard`.

---

### GCX Reply (`v1.1.0`)
**Matches:** `spigenhelp.zendesk.com/agent/tickets/*`

Floating panel on Zendesk tickets that replicates and extends ChannelReply's order data. Requires the local SP-API proxy (`sp-api-proxy.py`) running on `localhost:5050`.

**Order section** (via Amazon SP-API):
- Amazon Order ID, Order Status, Purchase Date, Amount, Delivery Level, Ship Date
- Shipping Address (collapsible), Fulfillment Channel, Ship Service Level, Buyer Name

**Product Info section** (via Google Sheets ASIN lookup):
- SKU, 모델명, 브랜드, 제조사명, 기종명, 색상명, 대분류, 생산업체, 원산지정보

**How it works:**
1. Auto-detects Amazon order IDs (`NNN-NNNNNNN-NNNNNNN`) from the ticket and fetches order data from the SP-API proxy.
2. Auto-detects the product ASIN from Zendesk ticket custom fields (where ChannelReply stores it) or from page text, then looks up the matching row in the Spigen product Google Sheet.
3. Both order ID and ASIN can also be entered manually.

**Prerequisites:**
- `sp-api-proxy.py` running locally (`python3 ~/Desktop/GCX/sp-api-proxy.py`)
- Credentials configured at `~/.sp-api-config.json`
- Logged into Google in Chrome (for Google Sheet access)

---

## Installation

1. Install the [Tampermonkey extension](https://www.tampermonkey.net/) in Chrome.
2. Open Tampermonkey Dashboard → Utilities → Import from file.
3. Select the `.user.js` file for the script you want to install.
4. Click "Install" when prompted.
