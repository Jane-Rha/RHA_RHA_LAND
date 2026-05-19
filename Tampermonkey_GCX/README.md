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

### GCX Reply (`v1.2.0`)
**Matches:** `spigenhelp.zendesk.com/agent/tickets/*`

Floating panel on Zendesk tickets that replicates and extends ChannelReply's order data. Backed by a Google Apps Script web app — no local server required.

**Order section** (via Amazon SP-API through GAS):
- Amazon Order ID, Order Status, Purchase Date, Amount, Delivery Level, Ship Date
- Shipping Address (collapsible), Fulfillment Channel, Ship Service Level, Buyer Name

**Product Info section** (via GAS → Google Sheet ASIN lookup):
- SKU, 모델명, 브랜드, 제조사명, 기종명, 색상명, 대분류, 생산업체, 원산지정보

**How it works:**
1. Auto-detects Amazon order IDs (`NNN-NNNNNNN-NNNNNNN`) from the ticket and fetches order data via the GAS web app.
2. Auto-detects the product ASIN from Zendesk ticket custom fields (where ChannelReply stores it) or from page text, then queries the GAS web app for the matching Spigen product row.
3. Both order ID and ASIN can also be entered manually.

**Prerequisites (first-time setup):**
1. Open the GAS project `GCXReply_GAS` in the Apps Script editor.
2. Set Script Properties: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `LWA_CLIENT_ID`, `LWA_CLIENT_SECRET`, `LWA_REFRESH_TOKEN`, `LWA_CLIENT_ID_JP`, `LWA_CLIENT_SECRET_JP`, `LWA_REFRESH_TOKEN_JP`.
3. Deploy → New deployment → Web app → **Execute as: Me**, **Who has access: Anyone** → copy the URL.
4. In the Tampermonkey script, replace `YOUR_GAS_WEB_APP_URL` with the copied URL.

---

## Installation

1. Install the [Tampermonkey extension](https://www.tampermonkey.net/) in Chrome.
2. Open Tampermonkey Dashboard → Utilities → Import from file.
3. Select the `.user.js` file for the script you want to install.
4. Click "Install" when prompted.
