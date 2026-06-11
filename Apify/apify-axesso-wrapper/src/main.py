"""
Apify Actor: Amazon Reviews Scraper (powered by Axesso)
Accepts the SAME input format as the Axesso actor directly
(an `input` array of {asin, domainCode, filterByStar, ...} objects),
passes it straight to Axesso, filters penalty/invalid rows, and pushes
clean reviews to this actor's own dataset.

ownerToken (optional input field): caller's Apify API token used for the
Axesso sub-actor call. Required when the actor runs under limited permissions
(e.g. when running a published Store actor from another account).
"""
import asyncio
import os

import httpx
from apify import Actor
from apify_client import ApifyClientAsync

AXESSO_ACTOR_ID = 'ZebkvH3nVOrafqr5T'
_PENALTY_PREFIX = 'NO_REVIEWS_PENALTY'
_PAGE_LIMIT = 50_000
_POLL_INTERVAL = 10


def _is_valid(item: dict, filter_mode: str) -> bool:
    msg = str(item.get('statusMessage', '')).strip()
    if msg.startswith(_PENALTY_PREFIX):
        return False
    if filter_mode == 'strict':
        if item.get('statusCode') != 200 or msg != 'FOUND':
            return False
    return True


async def _call_axesso_and_wait(run_input: dict, token: str) -> dict:
    """Start Axesso run via direct API call and poll until terminal state."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f'https://api.apify.com/v2/acts/{AXESSO_ACTOR_ID}/runs',
            params={'token': token},
            json=run_input,
        )
        resp.raise_for_status()
        run = resp.json()['data']
        run_id = run['id']
        Actor.log.info('Axesso run started: %s (status=%s)', run_id, run.get('status'))

    async with httpx.AsyncClient(timeout=30) as client:
        while True:
            await asyncio.sleep(_POLL_INTERVAL)
            r = await client.get(
                f'https://api.apify.com/v2/actor-runs/{run_id}',
                params={'token': token},
            )
            r.raise_for_status()
            run = r.json()['data']
            status = run.get('status', '')
            Actor.log.info('Axesso run %s: %s', run_id, status)
            if status in ('SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'):
                break

    return run


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
            owner_token: str | None = None
        else:
            input_entries: list[dict] = inp.get('input', [])
            filter_mode: str = inp.get('filterMode', 'strict')
            max_budget_usd: float | None = inp.get('maxBudgetUsd')
            owner_token: str | None = inp.get('ownerToken')

        if not input_entries:
            Actor.log.error(
                'No input entries found. Provide an "input" array of '
                '{asin, domainCode, filterByStar, ...} objects — '
                'same format as the Axesso actor.'
            )
            await Actor.fail(exit_code=1)
            return

        # Token resolution order:
        #  1. ownerToken from input (caller's own token — required for Store-actor context)
        #  2. AXESSO_OWNER_TOKEN env var (actor-owner's token, set via Apify actor settings)
        #  3. APIFY_TOKEN env var (works only when running the actor on your own account)
        token = (
            owner_token
            or os.environ.get('AXESSO_OWNER_TOKEN')
            or os.environ.get('APIFY_TOKEN', '')
        )
        if not token:
            Actor.log.error(
                'No usable API token found. '
                'Provide "ownerToken" in the input with your Apify API token.'
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
            run = await _call_axesso_and_wait(axesso_input, token)
        except httpx.HTTPStatusError as exc:
            Actor.log.error('Axesso HTTP error %s: %s', exc.response.status_code, exc.response.text)
            await Actor.fail(exit_code=1)
            return
        except Exception as exc:
            Actor.log.error('Axesso actor call failed: %s', exc)
            await Actor.fail(exit_code=1)
            return

        status = run.get('status', 'unknown')
        if status != 'SUCCEEDED':
            Actor.log.error('Axesso run ended with status=%s', status)
            await Actor.fail(exit_code=1)
            return

        await Actor.set_status_message('Fetching and filtering results…')

        client = ApifyClientAsync(token=token)
        raw: list[dict] = []
        offset = 0
        while True:
            page = await client.dataset(run['defaultDatasetId']).list_items(
                limit=_PAGE_LIMIT, offset=offset
            )
            raw.extend(page.items)
            if len(page.items) < _PAGE_LIMIT:
                break
            offset += len(page.items)

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
