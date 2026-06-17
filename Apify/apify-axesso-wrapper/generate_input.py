import json
import re
from itertools import product
from pathlib import Path

ASIN_FILE = Path("ASIN_Glx26.txt")   # one ASIN per line, no commas
OUTPUT_FILE = Path("input.json")      # paste this file's contents directly into the actor

DOMAIN_CODES = ("de", "in", "com", "co.uk", "it", "fr", "es", "co.jp")
STARS = ("one_star", "two_star", "four_star", "five_star")

ASIN_RE = re.compile(r"^[A-Z0-9]{10}$")


def read_asins(file_path):
    asins = []
    with file_path.open("r", encoding="utf-8") as f:
        for line in f:
            asin = line.strip().upper()
            if asin and not asin.startswith("#") and ASIN_RE.match(asin):
                asins.append(asin)
    if not asins:
        raise ValueError(f"No valid ASINs found in {file_path}")
    return asins


def build_requests(asins):
    base = {
        "sortBy": "recent",
        "maxPages": 1,
        "reviewerType": "all_reviews",
        "formatType": "current_format",
        "mediaType": "all_contents",
    }
    return [
        {**base, "asin": asin, "domainCode": domain, "filterByStar": star}
        for asin, domain, star in product(asins, DOMAIN_CODES, STARS)
    ]


def main():
    asins = read_asins(ASIN_FILE)
    requests = build_requests(asins)

    # Wrapped in {"input": [...]} so it can be pasted directly into the actor's JSON input tab
    payload = {"input": requests}

    with OUTPUT_FILE.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=4)

    print(f"Saved {len(requests)} request(s) ({len(asins)} ASIN(s) x {len(DOMAIN_CODES)} domains x {len(STARS)} star filters) to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
