# Amazon Reviews Scraper

Extract real-time Amazon product reviews across multiple products and marketplaces in a single run. Retrieve ratings, titles, full review text, reviewer details, images, verified purchase status, and more. Export results as JSON, CSV, Excel, XML, or HTML.

---

## How does the Amazon Reviews Scraper work?

The Amazon Reviews Scraper is built for precision and scale. It accepts a list of scrape requests, each targeting a specific product and marketplace, and retrieves all matching reviews directly from Amazon in real time.

Here is how it works step by step:

**Input:** Provide one or more request objects, each containing an ASIN, a marketplace domain code, and optional filters such as star rating, keyword, reviewer type, sort order, and page depth.

**Data extraction:** The scraper navigates to the review section of the specified product page and pulls all available review data including star ratings, titles, full review text, helpful vote counts, review dates, attached images and videos, and reviewer profile details.

**Real-time output:** All results are fetched live from Amazon at the time of the run. There is no cached or preprocessed data, which means results are always current and accurate.

**Download:** Once a run completes, results can be downloaded in JSON, CSV, Excel, XML, or HTML from the dataset tab.

---

## Input data

The scraper accepts a JSON object with one required field: `input`, which is an array of request objects. Each object in the array represents one independent scrape job and can be configured with its own filters and options.

### Request object fields

| Field | Required | Description |
|---|---|---|
| `asin` | yes | Amazon Standard Identification Number of the product |
| `domainCode` | yes | Amazon marketplace domain (e.g. `com`, `de`, `co.uk`) |
| `sortBy` | no | Sort order: `recent` for newest reviews, `helpful` for most helpful |
| `maxPages` | no | Number of review pages to fetch. One page returns up to 10 reviews. Maximum is 10. Default is 1. |
| `filterByStar` | no | Filter by rating: `one_star`, `two_star`, `three_star`, `four_star`, `five_star` |
| `filterByKeyword` | no | Return only reviews containing this keyword |
| `reviewerType` | no | `all_reviews` for all reviews, `verified_reviews` for verified purchases only |
| `formatType` | no | `current_format` is recommended for all standard use cases |
| `mediaType` | no | `all_contents` returns text and media. `media_reviews_only` returns image and video reviews only. |

Because `input` is an array, you can pass any number of ASINs in a single run, each with its own filter configuration. This allows you to scrape across multiple products, domains, and star filters simultaneously.

### Example input

```json
{
  "input": [
    {
      "asin": "B08C1W5N87",
      "domainCode": "com",
      "sortBy": "recent",
      "filterByStar": "one_star",
      "maxPages": 1,
      "reviewerType": "all_reviews",
      "formatType": "current_format",
      "mediaType": "all_contents"
    },
    {
      "asin": "B09G7ZMVJP",
      "domainCode": "de",
      "sortBy": "helpful",
      "maxPages": 2,
      "reviewerType": "all_reviews",
      "formatType": "current_format",
      "mediaType": "all_contents"
    },
    {
      "asin": "B086K4ZMT3",
      "domainCode": "co.uk",
      "sortBy": "recent",
      "maxPages": 1,
      "filterByKeyword": "quality",
      "reviewerType": "all_reviews",
      "formatType": "current_format",
      "mediaType": "all_contents"
    }
  ],
  "filterMode": "strict"
}
```

---

## Output data

Each item in the output dataset represents one individual review. Below is an example output record:

```json
{
  "statusCode": 200,
  "statusMessage": "FOUND",
  "asin": "B086K4ZMT3",
  "productTitle": "Example Product Title",
  "currentPage": 1,
  "sortStrategy": "recent",
  "countReviews": 142,
  "domainCode": "co.uk",
  "countRatings": 142,
  "productRating": "4.6 out of 5",
  "reviewSummary": {
    "fiveStar": { "percentage": 78 },
    "fourStar": { "percentage": 12 },
    "threeStar": { "percentage": 4 },
    "twoStar": { "percentage": 2 },
    "oneStar": { "percentage": 4 }
  },
  "reviewId": "R2XK8A1LMN4PQ",
  "text": "Solid build quality. Works exactly as described and arrived quickly.",
  "date": "Reviewed in the United Kingdom on 10 March 2025",
  "rating": "5.0 out of 5 stars",
  "title": "Exactly what I needed",
  "userName": "J. Mitchell",
  "numberOfHelpful": 3,
  "variationId": "B086K4ZMT3",
  "imageUrlList": null,
  "variationList": ["Style Name: Standard"],
  "verified": true,
  "vine": false,
  "videoUrlList": [],
  "profilePath": "/gp/profile/amzn1.account.example"
}
```

---

## Supported marketplaces

The following domain codes are supported:

| Domain code | Marketplace |
|---|---|
| `com` | Amazon United States |
| `ca` | Amazon Canada |
| `co.uk` | Amazon United Kingdom |
| `de` | Amazon Germany |
| `fr` | Amazon France |
| `it` | Amazon Italy |
| `es` | Amazon Spain |
| `co.jp` | Amazon Japan |
| `in` | Amazon India |
| `com.au` | Amazon Australia |
| `com.br` | Amazon Brazil |
| `nl` | Amazon Netherlands |
| `se` | Amazon Sweden |
| `com.mx` | Amazon Mexico |
| `ae` | Amazon United Arab Emirates |

---

## How much does it cost?

Pricing is based on the number of reviews returned. To estimate costs for your use case, run a small test with a limited input set and check the usage in your billing dashboard. Multiply that cost per review by your expected total volume.

---

## Penalty entries

When a filter combination returns zero matching reviews, or when an invalid ASIN produces a 404 response, the scraper returns placeholder rows in the output to indicate that the request was processed but no data was available. These penalty entries exist because backend requests are still made even when the result is empty, and they signal to your pipeline that the input was received and handled rather than silently skipped.

The `filterMode` input field controls how these rows are handled in the final dataset:

- `strict` (default): removes all rows that are not confirmed real reviews (statusCode 200 + statusMessage FOUND)
- `lenient`: removes only the penalty placeholder rows and keeps everything else

---

## What to consider when using this scraper

The scraper handles all the technical complexity of web data extraction on your behalf. You do not need to manage proxies, handle bot detection, or deal with dynamic page rendering.

**Proxy coverage:** A large rotating proxy pool is used across all supported regions. Requests to a given marketplace domain are always routed through proxies in the corresponding country to avoid geo-restriction errors.

**Anti-bot handling:** Captchas, temporary blocks, and 503 responses are handled automatically under the hood. If a request is challenged, it is retried with a different proxy and fingerprint until the data is retrieved successfully.

**Geo-targeting:** The scraper automatically matches the request's domain to the correct geographic proxy location, ensuring that results reflect what a real local user would see on that Amazon marketplace.

---

## Use cases

**Product quality monitoring:** Track 1, 2, and 3 star reviews across all markets to detect recurring quality issues early and prioritize product improvements.

**Competitive research:** Collect reviews for competitor products to understand what customers like and dislike compared to your own offerings.

**Sentiment analysis:** Feed review text into NLP or AI pipelines to classify feedback by topic, emotion, or defect type at scale.

**Review aggregation:** Consolidate all reviews for a product catalog into one structured dataset for reporting or dashboards.

**Price and market intelligence:** Combine review volume trends with rating changes to monitor brand health across regions over time.

**Content creation:** Use review data to inform product descriptions, FAQ sections, or buying guides based on real customer language.
