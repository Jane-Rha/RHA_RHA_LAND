"""
Apify Actor: Axesso Review Wrapper
Calls one or more Axesso Amazon-review-scraper tasks (or the actor directly),
filters out penalty / non-FOUND rows, and pushes clean reviews to this
actor's own dataset — ready for the Master.gs dailyJob pipeline.
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


async def _process_run(run: dict | None, label: str, filter_mode: str, out_dataset) -> int:
    status = (run or {}).get('status', 'unknown')
    if status != 'SUCCEEDED':
        Actor.log.warning('[%s] run ended with status=%s — skipping', label, status)
        return 0

    dataset_id = run['defaultDatasetId']
    Actor.log.info('[%s] fetching from dataset %s', label, dataset_id)

    raw = await _fetch_all(dataset_id)
    valid = [item for item in raw if _is_valid(item, filter_mode)]
    Actor.log.info('[%s] %d raw → %d valid (filter=%s)', label, len(raw), len(valid), filter_mode)

    if valid:
        await out_dataset.push_data(valid)
    return len(valid)


async def _run_task(task_id: str, filter_mode: str, out_dataset) -> int:
    Actor.log.info('Starting Axesso task: %s', task_id)
    try:
        run = await Actor.call_task(task_id=task_id)
    except Exception as exc:
        Actor.log.error('Task %s failed: %s', task_id, exc)
        return 0
    return await _process_run(run, task_id, filter_mode, out_dataset)


async def _run_direct(axesso_input: dict, filter_mode: str, out_dataset) -> int:
    Actor.log.info('Starting Axesso actor with custom input')
    try:
        run = await Actor.call(actor_id=AXESSO_ACTOR_ID, run_input=axesso_input)
    except Exception as exc:
        Actor.log.error('Direct Axesso call failed: %s', exc)
        return 0
    return await _process_run(run, 'direct', filter_mode, out_dataset)


async def main():
    async with Actor:
        inp = await Actor.get_input() or {}

        # Collect all task IDs: taskIds (list) takes priority; taskId (string) is a shorthand
        task_ids: list[str] = [t for t in inp.get('taskIds', []) if t]
        single = inp.get('taskId', '').strip()
        if single and single not in task_ids:
            task_ids.insert(0, single)

        axesso_input: dict | None = inp.get('axessoInput') or None
        filter_mode: str = inp.get('filterMode', 'strict')

        if not task_ids and not axesso_input:
            Actor.log.error('No input. Provide taskId, taskIds, or axessoInput.')
            await Actor.fail(exit_code=1)
            return

        out_dataset = await Actor.open_dataset()

        if task_ids:
            await Actor.set_status_message(f'Starting {len(task_ids)} Axesso task(s)…')
            counts = await asyncio.gather(*[
                _run_task(tid, filter_mode, out_dataset) for tid in task_ids
            ])
            total = sum(counts)
        else:
            await Actor.set_status_message('Starting Axesso actor with custom input…')
            total = await _run_direct(axesso_input, filter_mode, out_dataset)

        msg = f'Done — {total} valid review(s) in dataset'
        await Actor.set_status_message(msg)
        Actor.log.info(msg)


if __name__ == '__main__':
    asyncio.run(main())
