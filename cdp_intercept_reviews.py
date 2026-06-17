#!/usr/bin/env python3
"""
CDP network interceptor — auto-click "Show Review Details" on every review
and dump ALL XHR/fetch responses to a JSON file for inspection.

Goal: find the Seller Central internal API call that returns the order ID.

Usage:
    1. Open Chrome: /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
           --remote-debugging-port=9222 --remote-allow-origins='*' \
           --user-data-dir=~/.chrome-scraper-profile
    2. Log in to Seller Central, navigate to brand-customer-reviews page
    3. python3 ~/Desktop/GCX/cdp_intercept_reviews.py
    4. Inspect ~/Desktop/GCX/review_xhr_responses.json
"""

import asyncio
import json
import re
import time
from pathlib import Path

try:
    import websockets
except ImportError:
    raise SystemExit("Run: pip install websockets")

import urllib.request

CDP_URL     = "http://localhost:9222"
ORDER_RE    = re.compile(r'\b\d{3}-\d{7}-\d{7}\b')
OUT_PATH    = Path.home() / "Desktop/GCX/review_xhr_responses.json"

JS_CLICK_ALL_DETAILS = r"""
(function() {
    function allEls(root) {
        var els = [];
        var w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        var n;
        while ((n = w.nextNode())) {
            els.push(n);
            if (n.shadowRoot) els = els.concat(allEls(n.shadowRoot));
        }
        return els;
    }
    var btns = allEls(document.body).filter(function(e) {
        var txt = (e.textContent || '').trim();
        var lbl = (e.getAttribute('aria-label') || '').toLowerCase();
        return (txt === 'Show Review Details' || lbl.includes('show review') || lbl.includes('review details'))
            && (e.tagName === 'BUTTON' || e.tagName === 'A' || e.getAttribute('role') === 'button');
    });
    btns.forEach(function(b) { b.click(); });
    return btns.length + ' buttons clicked';
})()
"""

captured = []

async def cdp_eval(ws, expr, mid):
    mid[0] += 1
    rid = mid[0]
    await ws.send(json.dumps({"id": rid, "method": "Runtime.evaluate",
                              "params": {"expression": expr, "returnByValue": True}}))
    deadline = time.time() + 15
    while time.time() < deadline:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=5)
        except asyncio.TimeoutError:
            break
        msg = json.loads(raw)
        if msg.get("id") == rid:
            return msg.get("result", {}).get("result", {}).get("value")
    return None

async def main():
    data  = json.loads(urllib.request.urlopen(f"{CDP_URL}/json/list").read())
    pages = [t for t in data if t.get("type") == "page"]
    if not pages:
        raise SystemExit("No Chrome tab found.")
    ws_url = pages[0]["webSocketDebuggerUrl"]
    print(f"Connecting to: {ws_url}")

    async with websockets.connect(ws_url, max_size=50*1024*1024) as ws:
        mid = [1000]
        pending_bodies = {}   # requestId -> url

        async def send(method, params=None):
            mid[0] += 1
            await ws.send(json.dumps({"id": mid[0], "method": method, "params": params or {}}))

        await send("Network.enable")
        await send("Runtime.enable")

        print("\nMake sure you're on the brand reviews page and logged in.")
        print("Clicking all 'Show Review Details' buttons...")
        clicked = await cdp_eval(ws, JS_CLICK_ALL_DETAILS, mid)
        print(f"  {clicked}")

        print("Listening for XHR/fetch responses for 30 seconds...")
        print("(scroll / change page to trigger more if needed)\n")

        try:
            deadline = time.time() + 30
            while time.time() < deadline:
                remaining = deadline - time.time()
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=min(remaining, 2))
                except asyncio.TimeoutError:
                    continue

                msg = json.loads(raw)
                event = msg.get("method", "")

                if event == "Network.responseReceived":
                    p    = msg["params"]
                    resp = p.get("response", {})
                    url  = resp.get("url", "")
                    mime = resp.get("mimeType", "")
                    rtype = p.get("type", "")
                    if rtype in ("XHR", "Fetch") or "json" in mime:
                        pending_bodies[p["requestId"]] = url

                elif event == "Network.loadingFinished":
                    req_id = msg["params"]["requestId"]
                    if req_id in pending_bodies:
                        url = pending_bodies.pop(req_id)
                        mid[0] += 1
                        fetch_id = mid[0]
                        await ws.send(json.dumps({
                            "id": fetch_id,
                            "method": "Network.getResponseBody",
                            "params": {"requestId": req_id}
                        }))

                elif "id" in msg and "result" in msg:
                    body = msg.get("result", {}).get("body", "")
                    if not body:
                        continue
                    # Try to find the URL this came from
                    order_ids = ORDER_RE.findall(body)
                    entry = {
                        "hasOrderId": bool(order_ids),
                        "orderIds": list(set(order_ids)),
                        "bodyLength": len(body),
                        "bodyPreview": body[:1000],
                    }
                    captured.append(entry)
                    if order_ids:
                        print(f"  *** ORDER IDs: {set(order_ids)}")
                        print(f"      Preview: {body[:400]}\n")
                    else:
                        # Print any review-related JSON
                        bl = body.lower()
                        if any(k in bl for k in ["reviewid", "review_id", "orderid",
                                                  "order_id", "verifiedpurchase",
                                                  "verified_purchase", "asin"]):
                            print(f"  [Review/Order JSON — no order ID visible]")
                            print(f"  Keys: {list(json.loads(body).keys())[:10] if body.startswith('{') else 'not an object'}")
                            print(f"  Preview: {body[:400]}\n")

        except KeyboardInterrupt:
            print("\n[Stopped by user]")

        # Save all captured responses
        OUT_PATH.write_text(json.dumps(captured, indent=2, ensure_ascii=False))
        with_order = [c for c in captured if c["hasOrderId"]]
        print(f"\n{'='*60}")
        print(f"Total XHR responses captured: {len(captured)}")
        print(f"Responses containing order IDs: {len(with_order)}")
        print(f"Saved to: {OUT_PATH}")

        if not with_order:
            print("\n→ No order IDs found in XHR responses.")
            print("  Try: scroll the page, click 'Show Review Details' manually,")
            print("  or check review_xhr_responses.json for the raw JSON structure.")

if __name__ == "__main__":
    asyncio.run(main())
