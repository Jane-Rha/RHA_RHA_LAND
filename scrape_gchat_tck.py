#!/usr/bin/env python3
"""
Scrapes Google Chat "GCX T2 ESC. Ticket 보고" for all TCK report messages
from Jan 1, 2026 onward. Uses batch-extract-while-scrolling because Google
Chat uses a virtualized list (old DOM nodes are removed as you scroll up).

Usage:
  python3 scrape_gchat_tck.py              # scroll back to Jan 2026
  python3 scrape_gchat_tck.py --no-scroll  # today's messages only
  python3 scrape_gchat_tck.py --target=2026-03  # stop at March 2026
"""

import asyncio
import json
import re
import csv
import sys
import urllib.request
import random
from datetime import datetime
import websockets

CDP_URL = "http://localhost:9222"
OUTPUT  = f"/Users/kevinkim/Desktop/GCX/tck_reports_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"

# Month names → month number
MONTH_MAP = {
    "jan":1,"feb":2,"mar":3,"apr":4,"may":5,"jun":6,
    "jul":7,"aug":8,"sep":9,"oct":10,"nov":11,"dec":12,
    "1월":1,"2월":2,"3월":3,"4월":4,"5월":5,"6월":6,
    "7월":7,"8월":8,"9월":9,"10월":10,"11월":11,"12월":12,
}

# ── CDP ─────────────────────────────────────────────────────────────────────

async def make_ws():
    with urllib.request.urlopen(f"{CDP_URL}/json/list") as r:
        tabs = json.loads(r.read())
    tab = next((t for t in tabs if t.get("type") == "page" and "chat.google.com" in t.get("url", "")), None)
    if not tab:
        raise RuntimeError("No Google Chat tab found.")
    print(f"Tab: {tab['title']}")
    return tab["webSocketDebuggerUrl"]

async def js(ws, expr):
    mid = random.randint(100_000, 999_999)
    await ws.send(json.dumps({"id": mid, "method": "Runtime.evaluate",
                              "params": {"expression": expr, "returnByValue": True}}))
    for _ in range(80):
        try:
            raw = await asyncio.wait_for(ws.recv(), 6)
            msg = json.loads(raw)
            if msg.get("id") == mid:
                v = msg.get("result", {}).get("result", {})
                return None if v.get("subtype") == "error" else v.get("value")
        except asyncio.TimeoutError:
            return None
    return None

# ── Text helpers ─────────────────────────────────────────────────────────────

def clean_text(text):
    lines = text.split("\n")
    out = []
    for line in lines:
        s = line.strip()
        if not s or s == ",":
            continue
        if re.match(r"^\d+:\d+\s*(AM|PM)$", s, re.IGNORECASE):
            continue
        if s in ("Add reaction", "Quoted", "End Quote", "Edited",
                 "Play (k)", "download", "Download", "Mute (m)", "Full screen (f)",
                 "1", "2", "3"):
            continue
        if re.search(r"\d+ repl", s, re.IGNORECASE):
            break
        if re.search(r"Last Reply", s, re.IGNORECASE):
            break
        if s.startswith("press L to link"):
            break
        out.append(line)
    return "\n".join(out).strip()

def clean_sender(raw):
    s = raw.strip()
    s = re.sub(r"^Message\s+", "", s)
    if re.match(r"^(Image|Video|Reactions?|File)[,\s]", s, re.IGNORECASE):
        return ""
    return s

def sender_from_text(text):
    for line in text.split("\n"):
        line = line.strip()
        if not line or line == ",":
            continue
        if re.match(r"^\d+:\d+", line) or re.match(r"^(Today|Yesterday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)", line):
            break
        if line == "You":
            return "김지우 Kevin 글로벌CX전략팀"
        if line in ("Edited", "Quoted", "1 unread", "2 unread", "App"):
            continue
        if len(line) > 3 and " " in line and not line.startswith("http"):
            return line
    return ""

def _is_name_line(s):
    s = s.strip()
    if not s or s == "@":
        return True
    if re.match(r'^[가-힣a-zA-Z\s\.]+$', s) and len(s) < 35 and ',' not in s and '→' not in s:
        return True
    return False

def strip_reply_header(text, confirmer_sender):
    lines = text.split("\n")
    skip_exact = {confirmer_sender.strip(), "@", ""}
    out, done = [], False
    for line in lines:
        s = line.strip()
        if not done:
            if s in skip_exact or _is_name_line(s):
                continue
            done = True
        out.append(line)
    result = "\n".join(out).strip()
    result = re.sub(r"^\s*프로님[,.]?\s*", "", result)
    return result

# ── Section parser ────────────────────────────────────────────────────────────

SEC_PATTERNS = [
    ("ticket_info",     r"\[Ticket Info\.?\]\s*(.+?)(?=\[Desired Outcome\]|\[Action (?:Needed|Required)\]|\[TCK|$)"),
    ("desired_outcome", r"\[Desired Outcome\]\s*(.+?)(?=\[Action (?:Needed|Required)\]|\[TCK|$)"),
    ("action_required", r"\[Action (?:Needed|Required)\]\s*(.+?)(?=\[TCK|$)"),
    ("tck_transfer",    r"\[TCK 전달 예정\]\s*(.+?)$"),
]

def parse_sections(text):
    out = {}
    for key, pat in SEC_PATTERNS:
        m = re.search(pat, text, re.DOTALL | re.IGNORECASE)
        out[key] = clean_text(m.group(1)) if m else ""
    link = re.search(r"https://spigenhelp\.zendesk\.com/agent/tickets/\d+", out.get("ticket_info", ""))
    out["ticket_link"] = link.group(0) if link else ""
    return out

# ── Date detection ────────────────────────────────────────────────────────────

# Parse "May 27, 4:40 PM"  or  "Jan 6, 10:30 AM"  → (month_num, day)
_DATE_RE = re.compile(
    r'\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})',
    re.IGNORECASE
)

def oldest_month_in_view(date_texts):
    """Return the earliest (month, day) tuple visible, or None."""
    best = None
    for t in date_texts:
        m = _DATE_RE.search(t)
        if m:
            mon = MONTH_MAP.get(m.group(1).lower())
            day = int(m.group(2))
            if mon and (best is None or (mon, day) < best):
                best = (mon, day)
    return best

GET_DATES_JS = r"""
(function() {
    // Get text nodes that look like "Month day, time" timestamps
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const dates = [];
    const seen = new Set();
    while (walker.nextNode()) {
        const t = walker.currentNode.textContent.trim();
        if (/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d/i.test(t) && !seen.has(t)) {
            dates.push(t.slice(0, 30));
            seen.add(t);
        }
    }
    return JSON.stringify(dates);
})()
"""

SCROLL_TO_TOP_JS = r"""
(function() {
    const s = document.querySelector('[jsname="iyUusd"]')
           || document.querySelector('.Bl2pUd')
           || document.querySelector('[data-is-virtualized-list-scroller="true"]');
    if (!s) { window.scrollTo(0,0); return 'window'; }
    const prevH = s.scrollHeight;
    s.scrollTop = 0;
    // Dispatch both scroll and wheel events — needed to trigger Google Chat's
    // virtualized-list load-more-history listener
    s.dispatchEvent(new Event('scroll', {bubbles: true}));
    s.dispatchEvent(new WheelEvent('wheel', {deltaY: -5000, bubbles: true}));
    return 'prevH=' + prevH + ' scrollTop=' + s.scrollTop;
})()
"""

# ── Message extraction ────────────────────────────────────────────────────────

EXTRACT_MSGS_JS = r"""
(function() {
    const results = [];
    const msgs = document.querySelectorAll('.nF6pT');
    const main = document.querySelector('[role="main"]');
    const allBtns = Array.from(document.querySelectorAll('.CYx15d'));

    for (const m of msgs) {
        if (main && !main.contains(m)) continue;
        const text = (m.innerText || '').trim();
        if (!text.includes('[Ticket Info')) continue;
        if (text.includes('End Quote')) continue;

        const topic = m.closest('[data-topic-id]') || m.parentElement;
        const topicId = topic ? (topic.getAttribute('data-topic-id') || '') : '';
        const btn = topic ? topic.querySelector('.CYx15d') : null;
        const btnIdx = btn ? allBtns.indexOf(btn) : -1;

        let sender = '';
        const se = m.querySelector('[aria-label]');
        if (se) sender = (se.getAttribute('aria-label') || '').trim().slice(0, 100);

        results.push({ topicId, sender, text, btnIdx, hasReply: btnIdx >= 0 });
    }
    return JSON.stringify(results);
})()
"""

EXTRACT_THREAD_PANEL_JS = r"""
(function() {
    const main = document.querySelector('[role="main"]');
    const panelMsgs = Array.from(document.querySelectorAll('.nF6pT'))
        .filter(el => !main || !main.contains(el));
    const replies = [];
    for (const m of panelMsgs) {
        const text = (m.innerText || '').trim();
        if (!text || text.includes('[Ticket Info') || text.includes('End Quote')) continue;
        let sender = '';
        const se = m.querySelector('[aria-label]');
        if (se) sender = (se.getAttribute('aria-label') || se.innerText || '').trim().slice(0, 100);
        if (text.length > 5) replies.push({ sender, text });
    }
    return JSON.stringify(replies);
})()
"""

def get_thread_replies_js(btn_idx):
    return f"""
(function() {{
    const allBtns = document.querySelectorAll('.CYx15d');
    const btn = allBtns[{btn_idx}];
    if (!btn) return JSON.stringify({{err: 'btn {btn_idx} not found of ' + allBtns.length}});
    btn.scrollIntoView({{block:'center'}});
    btn.click();
    return JSON.stringify({{clicked: btn.innerText.trim().slice(0,30)}});
}})()
"""

CLOSE_THREAD_JS = r"""
(function() {
    const btns = Array.from(document.querySelectorAll('[aria-label]'))
        .filter(e => /close|닫기/i.test(e.getAttribute('aria-label') || ''));
    if (btns.length) { btns[0].click(); return 'closed'; }
    return 'no close btn';
})()
"""

# ── Process one batch of visible TCK messages ─────────────────────────────────

async def process_visible_batch(ws, collected, seen_topics):
    """Extract TCK messages visible now, click their threads, add to collected dict."""
    raw = await js(ws, EXTRACT_MSGS_JS)
    if not raw:
        return 0
    msgs = json.loads(raw)
    new_count = 0

    for msg in msgs:
        tid = msg["topicId"]
        if tid in seen_topics:
            continue
        seen_topics.add(tid)
        new_count += 1

        parsed = parse_sections(msg["text"])
        link = parsed["ticket_link"]
        sender = sender_from_text(msg["text"]) or clean_sender(msg["sender"])
        reply_sender, reply_text = "", ""

        if msg["hasReply"] and msg["btnIdx"] >= 0:
            cr = await js(ws, get_thread_replies_js(msg["btnIdx"]))
            cr_data = json.loads(cr) if cr else {}
            if "err" not in cr_data:
                await asyncio.sleep(2.0)
                raw_r = await js(ws, EXTRACT_THREAD_PANEL_JS)
                if raw_r:
                    replies = json.loads(raw_r)
                    for rep in replies:
                        t, s = rep["text"].strip(), rep["sender"]
                        if t and "You" not in t[:30]:
                            reply_sender = sender_from_text(t) or clean_sender(s)
                            reply_text   = clean_text(t)
                            break
                    if not reply_text and replies:
                        reply_sender = sender_from_text(replies[-1]["text"]) or clean_sender(replies[-1]["sender"])
                        reply_text   = clean_text(replies[-1]["text"])
                # Close thread panel
                await js(ws, CLOSE_THREAD_JS)
                await asyncio.sleep(0.4)

        collected[tid] = {
            "Sender":          sender,
            "Ticket Link":     link,
            "Ticket Info":     parsed["ticket_info"],
            "Desired Outcome": parsed["desired_outcome"],
            "Action Required": parsed["action_required"],
            "TCK 전달예정":    parsed["tck_transfer"],
            "Confirmer":       reply_sender,
            "Confirmer Reply": strip_reply_header(reply_text, reply_sender) if reply_text else "",
        }
        print(f"    + #{link.split('/')[-1] if link else tid[:8]} by {sender.split()[0] if sender else '?'} | confirmer: {reply_sender.split()[0] if reply_sender else '—'}")

    return new_count

# ── Main ─────────────────────────────────────────────────────────────────────

async def main():
    # Parse --target=YYYY-MM
    target_month = 1  # January
    for arg in sys.argv[1:]:
        m = re.match(r"--target=(\d{4})-(\d{2})", arg)
        if m:
            target_month = int(m.group(2))

    ws_url = await make_ws()

    async with websockets.connect(ws_url, max_size=200_000_000) as ws:
        url = await js(ws, "window.location.href")
        if not url or "accounts.google.com" in (url or ""):
            print("Not logged in."); sys.exit(1)
        print(f"URL: {url}")
        print(f"Target: scroll back to month {target_month} of 2026\n")

        do_scroll = "--no-scroll" not in sys.argv
        collected  = {}   # topicId → row
        seen_topics = set()

        if do_scroll:
            print("=== Phase 1: scrolling back + batch-extracting ===")
            no_new_rounds = 0
            prev_oldest   = None
            prev_h        = 0
            round_num     = 0

            while True:
                round_num += 1

                # Extract current visible batch
                new = await process_visible_batch(ws, collected, seen_topics)
                print(f"  Round {round_num}: {new} new TCK msgs (total so far: {len(collected)})")

                # Check oldest visible date
                raw_dates = await js(ws, GET_DATES_JS)
                dates_list = json.loads(raw_dates) if raw_dates else []
                oldest = oldest_month_in_view(dates_list)
                oldest_str = dates_list[0] if dates_list else "?"
                print(f"  Oldest visible: {oldest_str}  (month={oldest})")

                # Stop if reached target month
                if oldest and oldest[0] <= target_month:
                    print(f"\nReached target month {target_month}. Stopping scroll.")
                    break

                # Check scrollHeight to detect if new content loaded
                cur_h = await js(ws, """
                    (() => { const s=document.querySelector('[jsname="iyUusd"]')||document.querySelector('.Bl2pUd');
                      return s ? s.scrollHeight : 0; })()
                """)
                if oldest == prev_oldest and cur_h == prev_h:
                    no_new_rounds += 1
                    if no_new_rounds >= 4:
                        print("\nNo earlier messages loading — reached beginning of history.")
                        break
                else:
                    no_new_rounds = 0
                prev_oldest = oldest
                prev_h = cur_h if cur_h else prev_h

                # Scroll to top — WheelEvent triggers Google Chat's history loader
                r = await js(ws, SCROLL_TO_TOP_JS)
                print(f"  Scrolled → {r}")
                await asyncio.sleep(5.0)  # wait for virtualized list to load older msgs

        else:
            print("=== --no-scroll mode: extracting current view only ===")
            await process_visible_batch(ws, collected, seen_topics)

        print(f"\n=== Phase 2: writing CSV ({len(collected)} records) ===")

        fieldnames = ["Sender", "Ticket Link", "Ticket Info", "Desired Outcome",
                      "Action Required", "TCK 전달예정", "Confirmer", "Confirmer Reply"]
        with open(OUTPUT, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            for row in collected.values():
                writer.writerow(row)

        print(f"Saved to: {OUTPUT}")

if __name__ == "__main__":
    asyncio.run(main())
