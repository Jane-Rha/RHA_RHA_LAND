# Amazon Reviews Scraper — Multi-ASIN & Multi-Marketplace

Scrape Amazon product reviews across **multiple ASINs and marketplaces in a single run**, with built-in star-filter targeting and clean structured output. Powered by the Axesso Amazon Reviews API.

---

## What it does

1. You provide a list of ASINs, marketplaces (US, DE, FR, ES, IT, UK, JP, IN), and which star ratings to fetch.
2. The actor automatically expands those into individual scrape requests (ASIN × marketplace × star filter) and runs them in one Axesso call.
3. Placeholder / error rows are filtered out automatically.
4. Clean, structured reviews land in your dataset — ready to export as JSON, CSV, or Excel.

---

## Input

| Field | Type | Default | Description |
|---|---|---|---|
| `asins` | string[] | **required** | Amazon ASINs (e.g. `B0GDHXBK25`) |
| `countries` | string[] | All 8 | Marketplaces: US, DE, FR, ES, IT, UK, JP, IN |
| `starFilters` | string[] | All 5 | Star buckets: one_star … five_star |
| `maxPages` | integer | 1 | Pages per combination (10 reviews/page) |
| `sortBy` | string | recent | `recent` or `helpful` |
| `maxBudgetUsd` | number | none | Hard cap on Axesso API spend per run |
| `filterMode` | string | strict | `strict` = verified rows only; `lenient` = remove placeholders only |

### Example: Critical reviews for two products across 3 markets

```json
{
  "asins": ["B0GDHXBK25", "B0FVB2PF8R"],
  "countries": ["US", "DE", "UK"],
  "starFilters": ["one_star", "two_star", "three_star"],
  "maxPages": 1,
  "sortBy": "recent"
}
```

This runs **2 ASINs × 3 markets × 3 star filters = 18 scrape requests** in one actor run.

---

## Output

Each dataset row is a review with fields including:

| Field | Description |
|---|---|
| `country` | Marketplace country code |
| `date` | Review date |
| `variantAsin` | Variant ASIN scraped |
| `productAsin` | Parent ASIN |
| `username` | Reviewer username |
| `ratingScore` | Star rating (1–5) |
| `reviewTitle` | Review headline |
| `reviewDescription` | Full review text |
| `reviewId` | Unique review ID |
| `reviewImages` | Array of image URLs (if any) |
| `reviewUrl` | Direct link to review |
| `totalCategoryRatings` | Total ratings on product page |
| `averageCustomerReviews` | Aggregate star rating |

---

## Pricing note

This actor calls the **Axesso Amazon Reviews Scraper** as a sub-actor. Axesso charges are billed separately to your Apify account based on results returned. Use `maxBudgetUsd` to cap spend per run.

---

## Use cases

- **Product quality monitoring** — daily 1–3 star review alerts across all markets
- **Competitive research** — compare review sentiment across regions
- **Review aggregation** — collect all reviews for multiple SKUs in one run
- **VOC (Voice of Customer)** — feed reviews into NLP / sentiment pipelines
