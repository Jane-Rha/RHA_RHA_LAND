# Tampermonkey Scripts — Spigen GCX

Tampermonkey userscripts for the Spigen GCX Amazon operations workflow.

---

## Scripts

### GCX Reply (`v2.4.3`)
**Matches:** `spigenhelp.zendesk.com/agent/tickets/*`

Floating panel on Zendesk tickets. Fetches Amazon order data and Spigen product info, then fills all relevant ticket fields in one click.

**Order lookup:**
- Auto-detects order ID from Zendesk custom fields, ticket description, and page text
- Shows clickable chips when multiple order IDs are found; auto-fetches if only one is found
- Displays: Order ID (linked to Seller Central), Order Status, Purchase Date, Amount, Delivery Level, Ship Date, Fulfillment Channel, Ship Service Level, Buyer Name
- Shipping Address (collapsible)
- Items list with SKU, quantity, and title
- Return ASIN (linked to Amazon product page)
- 구매이력 (2yr): purchase and refund counts for the buyer, linked to Seller Central order search

**Product info:**
- Auto-detects ASIN from Zendesk custom fields or page text
- Looks up: SKU, 모델명, 브랜드, 제조사명, 기종명, 색상명, 대분류, 생산업체, 원산지정보
- Data source priority: ASIN Master (Sheet1) → market sheet (Sheet2) → Amazon product page (fallback scrape)
- 판매 마켓 badges showing which marketplaces carry the product
- ASIN Sources panel (collapsed by default): shows Sheet1, Sheet2, and Amazon data side by side

**Auto-Fill Form button** (appears after order data loads):
- Fills all Zendesk custom fields in one click via the Zendesk API:
  Order ID, ASIN, 문의SKU, Customer Name, Purchase Date, Order Status, Order Total, Delivery Level, Country, Point of Purchase, Brand(상세), Device, Product Name, Fulfillment, 사진첨부여부, 총 주문수, 총 환불수
- Device and Product Name fields are matched to dropdown options using token similarity

**→ MCF button** (appears after order data loads):
- Opens the Amazon MCF create-order page (global or JP) in a new tab
- Pre-fills recipient name, address, ASIN, and order ID via URL hash, picked up by the MCF Autofill script

**Panel UX:**
- Draggable (grab header) and resizable (drag bottom-right corner)
- Minimize / close buttons; "Order Lookup" toggle button to reopen
- Compact layout mode auto-activates when panel width < 260px
- Auto-resets when navigating between tickets (SPA-aware)
- Load log at the bottom shows live fetch steps for debugging

**Fallbacks:**
- If SP-API lacks buyer PII permission, fetches buyer email and 2-year order count from the agent's existing Seller Central session
- If SP-API GetOrderItems is blocked (403), queries Seller Central orders-api for items using the agent's SC session

---

### Amazon MCF Autofill (`v1.0.2`)
**Matches:** `sellercentral.amazon.*` and `sellercentral-europe.amazon.*` — MCF create-order pages

Injects a floating panel on the MCF order creation page (EU marketplaces: UK, DE, FR, IT, ES). Autofills recipient name, address, and line items from order data passed by GCX Reply's MCF button, reducing manual data entry when placing Multi-Channel Fulfillment orders.

---

### Amazon JP MCF Autofill (`v1.5.2`)
**Matches:** `sellercentral-japan.amazon.com` — MCF create-order pages

JP-specific variant of the MCF Autofill script. Picks up order data from GCX Reply's MCF button, maps Japanese prefecture names to their romanized equivalents, and autofills the JP MCF order form.

---

### Amazon Invoice Automation (`v1.5`)
**Matches:** `sellercentral.amazon.de` — individual order pages

Adds a "Run Now" button on Amazon.de Seller Central order pages. On click, attempts to download the deemed resale/supply invoice first, falling back to the Amazon-generated invoice. Copies the result to clipboard via `GM_setClipboard`.

---

## Installation

1. Install the [Tampermonkey extension](https://www.tampermonkey.net/) in Chrome.
2. Get the `.user.js` file for the script you want to install.
3. Drag the file into the Tampermonkey Dashboard, or open it and click "Install" when prompted.

Once installed, Tampermonkey checks the `@updateURL` in the script header and auto-updates when a new version is pushed.
