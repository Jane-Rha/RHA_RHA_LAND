#!/usr/bin/env python3
"""
Scrapes Google Chat "GCX T2 ESC. Ticket 보고" for TCK report messages
containing [Ticket Info.] / [Ticket Info], opens each thread to get the
confirmer's reply, and saves to CSV.

Usage:
  python3 scrape_gchat_tck.py           # scroll history + scrape
  python3 scrape_gchat_tck.py --no-scroll  # scrape only today's messages
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

CDP_URL   = "http://localhost:9222"
OUTPUT    = f"/Users/kevinkim/Desktop/GCX/tck_reports_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"

# ── CDP wrappers ──────────────────────────────────────────────────────────────

async def make_ws():
    with urllib.request.urlopen(f"{CDP_URL}/json/list") as r:
        tabs = json.loads(r.read())
    tab = next((t for t in tabs if t.get("type") == "page" and "chat.google.com" in t.get("url", "")), None)
    if not tab:
        raise RuntimeError("No Google Chat tab found. Open Chrome to chat.google.com first.")
    print(f"Tab: {tab['title']}")
    return tab["webSocketDebuggerUrl"]

async def js(ws, expr):
    """Evaluate expression and return value, draining any pending events first."""
    mid = random.randint(100_000, 999_999)
    await ws.send(json.dumps({"id": mid, "method": "Runtime.evaluate",
                              "params": {"expression": expr, "returnByValue": True}}))
    for _ in range(80):
        try:
            raw = await asyncio.wait_for(ws.recv(), 5)
            msg = json.loads(raw)
            if msg.get("id") == mid:
                v = msg.get("result", {}).get("result", {})
                if v.get("subtype") == "error":
                    return None
                return v.get("value")
        except asyncio.TimeoutError:
            return None
    return None

# ── Text cleaning ─────────────────────────────────────────────────────────────

# Artifacts injected by Google Chat's aria/virtualized rendering
def clean_text(text):
    """Strip DOM artifacts from Google Chat innerText."""
    lines = text.split("\n")
    cleaned = []
    for line in lines:
        stripped = line.strip()
        # Skip blank / lone commas
        if not stripped or stripped == ",":
            continue
        # Skip timestamps
        if re.match(r"^\d+:\d+\s*(AM|PM)$", stripped, re.IGNORECASE):
            continue
        # Skip known UI labels
        if stripped in ("Add reaction", "Quoted", "End Quote", "Edited",
                        "Play (k)", "download", "Download", "Mute (m)",
                        "Full screen (f)", "1", "2", "3"):
            continue
        # Stop at thread/reaction chrome — may start with comma e.g. ", 2 replies..."
        if re.search(r"\d+ repl", stripped, re.IGNORECASE):
            break
        if re.search(r"Last Reply", stripped, re.IGNORECASE):
            break
        if stripped.startswith("press L to link"):
            break
        # Lone comma followed by a timestamp on the next line → start of trailing chrome
        # (we handle this by ignoring standalone commas and detecting next breaks)
        if stripped == "," :
            continue
        cleaned.append(line)
    return "\n".join(cleaned).strip()

def clean_sender(raw):
    """Strip leading 'Message ', aria noise, reaction text, etc."""
    s = raw.strip()
    s = re.sub(r"^Message\s+", "", s)
    # aria-label junk like "Image, image.png." or "Reactions: 1 ✔️"
    if re.match(r"^(Image|Video|Reactions?|File)[,\s]", s, re.IGNORECASE):
        return ""
    return s

def sender_from_text(text):
    """Extract sender name from the first line of message innerText."""
    for line in text.split("\n"):
        line = line.strip()
        if not line or line == ",":
            continue
        # Stop at timestamp
        if re.match(r"^\d+:\d+", line) or re.match(r"^(Today|Yesterday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)", line):
            break
        # Skip UI chrome
        if line in ("You", "Edited", "Quoted", "1 unread", "2 unread", "App"):
            if line == "You":
                return "김지우 Kevin 글로벌CX전략팀"
            continue
        # If it looks like a name (has space, Korean or Latin chars, no URL)
        if len(line) > 3 and " " in line and not line.startswith("http"):
            return line
    return ""

def _is_name_line(s):
    """True if the line looks like a person/team name rather than sentence content."""
    s = s.strip()
    if not s or s == "@":
        return True
    # A name line: only Korean/English/spaces, no sentence punctuation, short
    if re.match(r'^[가-힣a-zA-Z\s\.]+$', s) and len(s) < 35 and ',' not in s and '→' not in s:
        return True
    return False

def strip_reply_header(text, confirmer_sender):
    """Remove the auto-included sender name + @mention header from a thread reply."""
    lines = text.split("\n")
    skip_exact = {confirmer_sender.strip(), "@", ""}
    output_lines = []
    header_done = False
    for line in lines:
        stripped = line.strip()
        if not header_done:
            if stripped in skip_exact:
                continue
            if _is_name_line(stripped):
                continue
            header_done = True
        output_lines.append(line)
    result = "\n".join(output_lines).strip()
    # Strip leading "프로님," greeting
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

def is_tck_message(text):
    return bool(re.search(r"\[Ticket Info\.?\]", text, re.IGNORECASE))

def is_quoted_message(text):
    """True if this message is a quoted-reply bubble, not an original TCK report."""
    return "End Quote" in text or text.lstrip().startswith("Sent by")

# ── DOM JS snippets ───────────────────────────────────────────────────────────

EXTRACT_MSGS_JS = r"""
(function() {
    const results = [];
    const msgs = document.querySelectorAll('.nF6pT');
    const main = document.querySelector('[role="main"]');

    for (const m of msgs) {
        // Only messages inside the main list
        if (main && !main.contains(m)) continue;

        const text = (m.innerText || '').trim();
        if (!text.includes('[Ticket Info')) continue;
        if (text.includes('End Quote')) continue;  // quoted reply bubbles

        const topic = m.closest('[data-topic-id]') || m.parentElement;
        const topicId = topic ? (topic.getAttribute('data-topic-id') || '') : '';

        // Reply button index in the document (for later clicking)
        const allBtns = Array.from(document.querySelectorAll('.CYx15d'));
        const btn = topic ? topic.querySelector('.CYx15d') : null;
        const btnIdx = btn ? allBtns.indexOf(btn) : -1;

        // Sender from aria-label
        let sender = '';
        const se = m.querySelector('[aria-label]');
        if (se) sender = (se.getAttribute('aria-label') || '').trim().slice(0, 100);

        results.push({ topicId, sender, text, btnIdx, hasReply: btnIdx >= 0 });
    }
    return JSON.stringify(results);
})()
"""

def get_thread_replies_js(btn_idx):
    return f"""
(function() {{
    // Click the reply button by index
    const allBtns = document.querySelectorAll('.CYx15d');
    const btn = allBtns[{btn_idx}];
    if (!btn) return JSON.stringify({{err: 'btn {btn_idx} not found, total: ' + allBtns.length}});
    btn.scrollIntoView({{block:'center'}});
    btn.click();
    return JSON.stringify({{clicked: btn.innerText.trim().slice(0,30)}});
}})()
"""

EXTRACT_THREAD_PANEL_JS = r"""
(function() {
    // Thread panel = .nF6pT elements outside [role="main"]
    const main = document.querySelector('[role="main"]');
    const allMsgs = Array.from(document.querySelectorAll('.nF6pT'));
    const panelMsgs = allMsgs.filter(el => !main || !main.contains(el));

    const replies = [];
    for (const m of panelMsgs) {
        const text = (m.innerText || '').trim();
        if (!text || text.includes('[Ticket Info') || text.includes('End Quote')) continue;

        // Sender
        let sender = '';
        const se = m.querySelector('[aria-label]');
        if (se) sender = (se.getAttribute('aria-label') || se.innerText || '').trim().slice(0, 100);

        if (text.length > 5) replies.push({ sender, text });
    }
    return JSON.stringify(replies);
})()
"""

SCROLL_UP_JS = r"""
(function() {
    const scroller = document.querySelector('[data-is-virtualized-list-scroller="true"]')
        || document.querySelector('.UjVoec');
    if (scroller) {
        scroller.scrollTop = 0;
        return scroller.scrollHeight;
    }
    window.scrollTo(0, 0);
    return document.body.scrollHeight;
})()
"""

# ── Main ──────────────────────────────────────────────────────────────────────

async def main():
    ws_url = await make_ws()

    async with websockets.connect(ws_url, max_size=200_000_000) as ws:
        url = await js(ws, "window.location.href")
        if not url or "accounts.google.com" in (url or ""):
            print("Not logged in — please log in to Google Chat first.")
            sys.exit(1)
        print(f"Logged in at: {url}\n")

        # ── Scroll to load history ────────────────────────────────────────
        do_scroll = "--no-scroll" not in sys.argv
        print(f"Scroll mode: {'ON (loading full history)' if do_scroll else 'OFF (today only)'}")
        print("Tip: pass --no-scroll to skip history loading\n")

        if do_scroll:
            print("Scrolling up to load full message history (may take 1-3 min)...")
            prev_height = None
            for i in range(400):
                h = await js(ws, SCROLL_UP_JS)
                await asyncio.sleep(1.2)
                if h == prev_height:
                    print(f"  Fully loaded after {i+1} iterations (height={h}).")
                    break
                prev_height = h
                if i % 20 == 0 and i > 0:
                    print(f"  [{i}] scrollHeight={h}")
            await asyncio.sleep(1)

        # ── Extract TCK messages ──────────────────────────────────────────
        print("Extracting [Ticket Info.] messages...")
        raw = await js(ws, EXTRACT_MSGS_JS)
        if not raw:
            print("ERROR: Could not extract messages. Is Google Chat loaded?")
            return
        tck_msgs = json.loads(raw)
        print(f"Found {len(tck_msgs)} TCK messages\n")

        rows = []
        seen_links = set()  # dedup by ticket link

        for i, msg in enumerate(tck_msgs):
            parsed = parse_sections(msg["text"])
            link = parsed["ticket_link"]

            # Skip duplicates (same ticket appearing in quoted bubbles)
            if link and link in seen_links:
                print(f"  [{i+1}/{len(tck_msgs)}] SKIP duplicate {link}")
                continue
            if link:
                seen_links.add(link)

            sender = sender_from_text(msg["text"]) or clean_sender(msg["sender"])
            reply_sender = ""
            reply_text   = ""

            # ── Open thread ───────────────────────────────────────────────
            if msg["hasReply"] and msg["btnIdx"] >= 0:
                click_js = get_thread_replies_js(msg["btnIdx"])
                cr = await js(ws, click_js)
                cr_data = json.loads(cr) if cr else {}
                if "err" in cr_data:
                    print(f"  [{i+1}] {cr_data['err']}")
                else:
                    print(f"  [{i+1}/{len(tck_msgs)}] Thread opened ({cr_data.get('clicked','')})")
                    await asyncio.sleep(2.5)

                    raw_replies = await js(ws, EXTRACT_THREAD_PANEL_JS)
                    if raw_replies:
                        replies = json.loads(raw_replies)
                        # Use the first non-sender reply (the confirmer's reply)
                        for rep in replies:
                            t = rep["text"].strip()
                            s = rep["sender"]
                            if t and "You" not in s:
                                reply_sender = sender_from_text(t) or clean_sender(s)
                                reply_text   = clean_text(t)
                                break
                        if not reply_text and replies:
                            reply_sender = sender_from_text(replies[-1]["text"]) or clean_sender(replies[-1]["sender"])
                            reply_text   = clean_text(replies[-1]["text"])

                # Close thread panel
                await js(ws, """
                    (function() {
                        const closeBtn = document.querySelector('[aria-label="Close"]') || document.querySelector('[jsaction*="close"]');
                        if (closeBtn) { closeBtn.click(); return 'closed'; }
                        return 'no close btn';
                    })()
                """)
                await asyncio.sleep(0.5)
            else:
                print(f"  [{i+1}/{len(tck_msgs)}] No thread replies")

            rows.append({
                "Sender":          sender,
                "Ticket Link":     link,
                "Ticket Info":     parsed["ticket_info"],
                "Desired Outcome": parsed["desired_outcome"],
                "Action Required": parsed["action_required"],
                "TCK 전달예정":    parsed["tck_transfer"],
                "Confirmer":       reply_sender,
                "Confirmer Reply": strip_reply_header(reply_text, reply_sender) if reply_text else "",
            })

        # ── Write CSV ─────────────────────────────────────────────────────
        fieldnames = ["Sender", "Ticket Link", "Ticket Info", "Desired Outcome",
                      "Action Required", "TCK 전달예정", "Confirmer", "Confirmer Reply"]
        with open(OUTPUT, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)

        print(f"\nDone! Saved {len(rows)} records to:\n{OUTPUT}")

if __name__ == "__main__":
    asyncio.run(main())
