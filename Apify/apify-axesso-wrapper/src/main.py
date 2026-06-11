"""
Apify Actor: Amazon Reviews Scraper (powered by Axesso)
Accepts a list of ASINs, marketplaces, and star filters, automatically expands
them into Axesso input entries, runs the Axesso scraper, filters penalty rows,
and pushes clean reviews to this actor's dataset.
"""
import asyncio
from apify import Actor

AXESSO_ACTOR_ID = 'ZebkvH3nVOrafqr5T'
_PENALTY_PREFIX = 'NO_REVIEWS_PENALTY'
_PAGE_LIMIT = 50_000

# Map user-facing country codes → Axesso domainCode values
COUNTRY_TO_DOMAIN = {
    'US': 'com',
    'DE': 'de',
    'FR': 'fr',
    'ES': 'es',
    'IT': 'it',
    'UK': 'co.uk',
    'JP': 'co.jp',
    'IN': 'in',
}

ALL_STARS = ['one_star', 'two_star', 'three_star', 'four_star', 'five_star']


def _build_axesso_entries(asins, domain_codes, star_filters, max_pages, sort_by):
    """Expand asins × domain_codes × star_filters into Axesso input list."""
    entries = []
    for asin in asins:
        for domain in domain_codes:
            for star in star_filters:
                entries.append({
                    'asin': asin,
                    'domainCode': domain,
                    'filterByStar': star,
                    'maxPages': max_pages,
                    'sortBy': sort_by,
                    'reviewerType': 'all_reviews',
                    'formatType': 'current_format',
                    'mediaType': 'all_contents',
                })
    return entries


def _is_valid(item: dict, filter_mode: str) -> bool:
    msg = str(item.get('statusMessage', '')).strip()
    if msg.startswith(_PENALTY_PREFIX):
        return False
    if filter_mode == 'strict':
        if item.get('statusCode') != 200 or msg != 'FOUND':
            return False
    return True


async def _fetch_all(dataset_id: str) -> list[dict]:
    src = await Actor.open_dataset(dataset_id)
    all_items: list[dict] = []
    offset = 0
    while True:
        page = await src.get_data(limit=_PAGE_LIMIT, offset=offset)
        all_items.extend(page.items)
        if len(page.items) < _PAGE_LIMIT:
            break
        offset += len(page.items)
    return all_items


async def main():
    async with Actor:
        inp = await Actor.get_input() or {}

        asins: list[str] = [a.strip() for a in inp.get('asins', []) if a.strip()]
        countries: list[str] = inp.get('countries', list(COUNTRY_TO_DOMAIN.keys()))
        star_filters: list[str] = inp.get('starFilters', ALL_STARS)
        max_pages: int = int(inp.get('maxPages', 1))
        sort_by: str = inp.get('sortBy', 'recent')
        max_budget_usd: float | None = inp.get('maxBudgetUsd')
        filter_mode: str = inp.get('filterMode', 'strict')

        if not asins:
            Actor.log.error('No ASINs provided in input.')
            await Actor.fail(exit_code=1)
            return

        # Resolve country codes → Axesso domain codes (accept both "US" and "com" style)
        domain_codes = []
        for c in countries:
            c = c.strip()
            if c in COUNTRY_TO_DOMAIN:
                domain_codes.append(COUNTRY_TO_DOMAIN[c])
            else:
                domain_codes.append(c)  # already a domain code like "com", "de"

        entries = _build_axesso_entries(asins, domain_codes, star_filters, max_pages, sort_by)
        total_combos = len(entries)

        Actor.log.info(
            '%d ASIN(s) × %d domain(s) × %d star filter(s) = %d Axesso request(s)',
            len(asins), len(domain_codes), len(star_filters), total_combos,
        )
        await Actor.set_status_message(
            f'Starting Axesso run ({total_combos} request combinations)…'
        )

        axesso_input: dict = {'input': entries}
        call_kwargs: dict = {'actor_id': AXESSO_ACTOR_ID, 'run_input': axesso_input}
        if max_budget_usd is not None:
            call_kwargs['memory_mbytes'] = 512
            axesso_input['maxTotalChargeUsd'] = float(max_budget_usd)

        try:
            run = await Actor.call(**call_kwargs)
        except Exception as exc:
            Actor.log.error('Axesso actor call failed: %s', exc)
            await Actor.fail(exit_code=1)
            return

        status = (run or {}).get('status', 'unknown')
        if status != 'SUCCEEDED':
            Actor.log.error('Axesso run ended with status=%s', status)
            await Actor.fail(exit_code=1)
            return

        await Actor.set_status_message('Fetching results from Axesso dataset…')

        raw = await _fetch_all(run['defaultDatasetId'])
        valid = [item for item in raw if _is_valid(item, filter_mode)]

        Actor.log.info(
            '%d raw rows → %d valid reviews (filter=%s, dropped %d penalty/invalid rows)',
            len(raw), len(valid), filter_mode, len(raw) - len(valid),
        )

        out_dataset = await Actor.open_dataset()
        if valid:
            await out_dataset.push_data(valid)

        msg = f'Done — {len(valid)} review(s) scraped across {len(asins)} ASIN(s) / {len(domain_codes)} marketplace(s)'
        await Actor.set_status_message(msg)
        Actor.log.info(msg)


if __name__ == '__main__':
    asyncio.run(main())
