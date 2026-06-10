#!/usr/bin/env python3
"""
CDP network interceptor — Seller Central brand reviews
Navigates to the brand reviews page and logs all XHR/fetch responses,
hunting for Order IDs (NNN-NNNNNNN-NNNNNNN pattern) in the raw JSON.

Run: python3 ~/Desktop/GCX/cdp_intercept_reviews.py
Then log in to Seller Central when the browser opens the page.
Press Ctrl+C when done browsing to see the captured results.
"""

import asyncio
import json
import re
import sys
from collections import defaultdict

try:
    import websockets
except ImportError:
    raise SystemExit("Run: pip3 install websockets")

CDP_URL = "http://localhost:9222"
ORDER_RE = re.compile(r'\b\d{3}-\d{7}-\d{7}\b')
REVIEW_RE = re.compile(r'\b[A-Z0-9]{10,20}\b')  # broad pattern for review IDs

captured = []  # list of {url, body_snippet, order_ids}

async def get_ws_url():
    import urllib.request
    data = json.loads(urllib.request.urlopen(f"{CDP_URL}/json/list").read())
    pages = [t for t in data if t.get("type") == "page"]
    if not pages:
        raise SystemExit("No active Chrome page found. Open Chrome first.")
    return pages[0]["webSocketDebuggerUrl"], pages[0]["id"]

async def main():
    ws_url, tab_id = await get_ws_url()
    print(f"Connecting to tab: {ws_url}")

    async with websockets.connect(ws_url, max_size=50*1024*1024) as ws:
        msg_id = 0

        async def send(method, params=None):
            nonlocal msg_id
            msg_id += 1
            await ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
            return msg_id

        # Enable network monitoring
        await send("Network.enable")
        await send("Page.enable")

        # Navigate to Seller Central brand reviews (DE)
        print("\nNavigating to Seller Central brand reviews (DE)...")
        print("→ Log in if prompted, then browse reviews — scroll, click Show Review Details, etc.")
        print("→ Press Ctrl+C when done to see captured results.\n")
        await send("Page.navigate", {"url": "https://sellercentral.amazon.de/brand-customer-reviews/"})

        response_bodies = {}  # requestId -> url

        try:
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=120)
                msg = json.loads(raw)

                event = msg.get("method", "")

                # Track all XHR/fetch responses
                if event == "Network.responseReceived":
                    params = msg["params"]
                    resp = params.get("response", {})
                    url = resp.get("url", "")
                    mime = resp.get("mimeType", "")
                    resource_type = params.get("type", "")

                    # Only care about XHR/fetch/json responses
                    if resource_type in ("XHR", "Fetch") or "json" in mime:
                        req_id = params["requestId"]
                        response_bodies[req_id] = url

                # Get response body when loading finishes
                elif event == "Network.loadingFinished":
                    req_id = msg["params"]["requestId"]
                    if req_id in response_bodies:
                        url = response_bodies.pop(req_id)
                        msg_id += 1
                        await ws.send(json.dumps({
                            "id": msg_id,
                            "method": "Network.getResponseBody",
                            "params": {"requestId": req_id}
                        }))

                # Process response body
                elif "id" in msg and "result" in msg:
                    result = msg.get("result", {})
                    body = result.get("body", "")
                    if not body:
                        continue

                    order_ids = ORDER_RE.findall(body)
                    if order_ids:
                        # Find which URL this came from (best effort)
                        snippet = body[:500]
                        captured.append({
                            "order_ids": list(set(order_ids)),
                            "snippet": snippet,
                        })
                        print(f"  *** ORDER IDs FOUND: {set(order_ids)}")
                        print(f"      Snippet: {snippet[:200]}\n")

                    # Also log any JSON response that looks review-related
                    elif any(kw in body.lower() for kw in ["reviewid", "review_id", "customerreview", "verifiedpurchase"]):
                        print(f"  [Review-related JSON detected — no order ID]")
                        print(f"  Snippet: {body[:300]}\n")

        except asyncio.TimeoutError:
            print("\n[Timeout — no activity for 120s]")
        except KeyboardInterrupt:
            print("\n[Stopped by user]")

        # Summary
        print("\n" + "="*60)
        print(f"SUMMARY: {len(captured)} response(s) contained Order IDs")
        for i, c in enumerate(captured, 1):
            print(f"\n[{i}] Order IDs: {c['order_ids']}")
            print(f"    Snippet: {c['snippet'][:400]}")

if __name__ == "__main__":
    asyncio.run(main())
