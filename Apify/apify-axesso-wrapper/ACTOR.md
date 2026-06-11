# Amazon Reviews Scraper

Scrape Amazon product reviews across multiple ASINs and marketplaces in a single run. Supports star-rating filters, sort order, and page depth control. Output is clean and structured, ready to export as JSON, CSV, or Excel.

---

## What it does

Provide a list of scrape requests — each specifying an ASIN, marketplace, and star-rating filter — and the actor fetches the matching reviews, removes invalid placeholder rows, and returns verified review data in your dataset.

A single run can cover multiple products, multiple countries, and multiple star-rating buckets at once.

---

## Input

The input is an array of request objects under the key `input`. Each object maps to one scrape job.

| Field | Type | Required | Description |
|---|---|---|---|
| `input` | array | yes | List of scrape request objects (see below) |
| `filterMode` | string | no | `strict` (default) or `lenient` — controls how invalid rows are removed |
| `maxBudgetUsd` | number | no | Hard cap on spend per run |

### Scrape request object fields

| Field | Type | Description |
|---|---|---|
| `asin` | string | Amazon product ASIN |
| `domainCode` | string | Marketplace: `com`, `de`, `fr`, `es`, `it`, `co.uk`, `co.jp`, `in` |
| `filterByStar` | string | `one_star`, `two_star`, `three_star`, `four_star`, `five_star` |
| `maxPages` | integer | Pages to fetch per request (10 reviews per page) |
| `sortBy` | string | `recent` or `helpful` |
| `reviewerType` | string | `all_reviews` (recommended) |
| `formatType` | string | `current_format` (recommended) |
| `mediaType` | string | `all_contents` (recommended) |

### Example input

```json
{
  "input": [
    {
      "asin": "B0GDHXBK25",
      "domainCode": "com",
      "filterByStar": "one_star",
      "maxPages": 1,
      "sortBy": "recent",
      "reviewerType": "all_reviews",
      "formatType": "current_format",
      "mediaType": "all_contents"
    },
    {
      "asin": "B0GDHXBK25",
      "domainCode": "de",
      "filterByStar": "two_star",
      "maxPages": 1,
      "sortBy": "recent",
      "reviewerType": "all_reviews",
      "formatType": "current_format",
      "mediaType": "all_contents"
    }
  ],
  "filterMode": "strict"
}
```

---

## Output

Each row in the dataset is a single verified review.

| Field | Description |
|---|---|
| `country` | Marketplace country |
| `date` | Review date |
| `variantAsin` | ASIN of the specific variant reviewed |
| `productAsin` | Parent product ASIN |
| `username` | Reviewer display name |
| `ratingScore` | Star rating (1-5) |
| `reviewTitle` | Review headline |
| `reviewDescription` | Full review body text |
| `reviewId` | Unique review identifier |
| `reviewImages` | Array of image URLs attached to the review |
| `reviewUrl` | Direct link to the review on Amazon |
| `totalCategoryRatings` | Total number of ratings on the product page |
| `averageCustomerReviews` | Aggregate star rating shown on the product page |

---

## Filter modes

**Strict (default)** — returns only rows where the scraper confirmed a real review was found (`statusCode = 200`, `statusMessage = FOUND`). Recommended for most use cases.

**Lenient** — only removes placeholder rows generated when a filter combination returns zero results. Use this if you want to keep rows that may have partial data.

---

## Use cases

- Monitor 1-3 star reviews across all markets for product quality tracking
- Collect recent reviews for sentiment analysis or NLP pipelines
- Track review volume and rating trends over time
- Aggregate reviews for multiple SKUs in one run
