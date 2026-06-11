"""
Apify Actor: Amazon Reviews Scraper (powered by Axesso)
Accepts the SAME input format as the Axesso actor directly
(an `input` array of {asin, domainCode, filterByStar, ...} objects),
passes it straight to Axesso, filters penalty/invalid rows, and pushes
clean reviews to this actor's own dataset.
"""
import asyncio
from apify import Actor

AXESSO_ACTOR_ID = 'ZebkvH3nVOrafqr5T'
_PENALTY_PREFIX = 'NO_REVIEWS_PENALTY'
_PAGE_LIMIT = 50_000


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

        # Accept either:
        #   {"input": [...]}  — wrapped object (actor UI default)
        #   [...]             — bare array (direct output from input-generator scripts)
        if isinstance(inp, list):
            input_entries: list[dict] = inp
            filter_mode: str = 'strict'
            max_budget_usd: float | None = None
        else:
            input_entries: list[dict] = inp.get('input', [])
            filter_mode: str = inp.get('filterMode', 'strict')
            max_budget_usd: float | None = inp.get('maxBudgetUsd')

        if not input_entries:
            Actor.log.error(
                'No input entries found. Provide an "input" array of '
                '{asin, domainCode, filterByStar, ...} objects — '
                'same format as the Axesso actor.'
            )
            await Actor.fail(exit_code=1)
            return

        Actor.log.info('Received %d Axesso request entries', len(input_entries))
        await Actor.set_status_message(
            f'Starting Axesso run ({len(input_entries)} request entries)…'
        )

        axesso_input: dict = {'input': input_entries}
        if max_budget_usd is not None:
            axesso_input['maxTotalChargeUsd'] = float(max_budget_usd)

        try:
            run = await Actor.call(actor_id=AXESSO_ACTOR_ID, run_input=axesso_input)
        except Exception as exc:
            Actor.log.error('Axesso actor call failed: %s', exc)
            await Actor.fail(exit_code=1)
            return

        status = (run or {}).get('status', 'unknown')
        if status != 'SUCCEEDED':
            Actor.log.error('Axesso run ended with status=%s', status)
            await Actor.fail(exit_code=1)
            return

        await Actor.set_status_message('Fetching and filtering results…')

        raw = await _fetch_all(run['defaultDatasetId'])
        valid = [item for item in raw if _is_valid(item, filter_mode)]

        Actor.log.info(
            '%d raw rows → %d valid reviews (filter=%s, dropped %d rows)',
            len(raw), len(valid), filter_mode, len(raw) - len(valid),
        )

        out_dataset = await Actor.open_dataset()
        if valid:
            await out_dataset.push_data(valid)

        msg = f'Done — {len(valid)} review(s) from {len(input_entries)} request(s)'
        await Actor.set_status_message(msg)
        Actor.log.info(msg)


if __name__ == '__main__':
    asyncio.run(main())
