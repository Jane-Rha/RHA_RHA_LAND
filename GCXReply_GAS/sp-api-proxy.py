#!/Users/kevinkim/Desktop/GCX/.venv/bin/python3
"""
SP-API local proxy — Zendesk Order Lookup
Listens on http://localhost:5050
Config:  ~/.sp-api-config.json  (see .sp-api-config.example.json)
Install: pip3 install fastapi uvicorn requests
Run:     python3 ~/Desktop/GCX/sp-api-proxy.py
"""

import datetime
import hashlib
import hmac
import json
import re
import time
import urllib.parse
from pathlib import Path

try:
    from fastapi import FastAPI, HTTPException
    from fastapi.middleware.cors import CORSMiddleware
    import uvicorn
    import requests
except ImportError:
    raise SystemExit("Missing packages — run: pip3 install fastapi uvicorn requests")

# ── Config ────────────────────────────────────────────────────────────────────
CONFIG_PATH = Path.home() / ".sp-api-config.json"

def _load_config():
    if not CONFIG_PATH.exists():
        raise FileNotFoundError(
            f"Config not found: {CONFIG_PATH}\n"
            "Copy .sp-api-config.example.json → ~/.sp-api-config.json and fill in credentials."
        )
    return json.loads(CONFIG_PATH.read_text())

CFG = _load_config()

# ── LWA token (Login with Amazon) ────────────────────────────────────────────
# Two credential sets: "main" (EU + NA) and "jp" (FE / Japan)
_lwa_cache: dict = {
    "main": {"token": None, "exp": 0.0},
    "jp":   {"token": None, "exp": 0.0},
}

def lwa_token(cred: str = "main") -> str:
    cache = _lwa_cache[cred]
    if time.time() < cache["exp"] - 60:
        return cache["token"]
    suffix = "_jp" if cred == "jp" else ""
    r = requests.post("https://api.amazon.com/auth/o2/token", data={
        "grant_type":    "refresh_token",
        "refresh_token": CFG[f"refresh_token{suffix}"],
        "client_id":     CFG[f"lwa_client_id{suffix}"],
        "client_secret": CFG[f"lwa_client_secret{suffix}"],
    }, timeout=15)
    r.raise_for_status()
    d = r.json()
    cache["token"] = d["access_token"]
    cache["exp"]   = time.time() + d.get("expires_in", 3600)
    return cache["token"]

# ── AWS SigV4 ─────────────────────────────────────────────────────────────────
def _sign(key, msg: str) -> bytes:
    k = key if isinstance(key, bytes) else key.encode()
    return hmac.new(k, msg.encode(), hashlib.sha256).digest()

def _signing_key(secret: str, date_stamp: str, region: str) -> bytes:
    return _sign(_sign(_sign(_sign(f"AWS4{secret}", date_stamp), region), "execute-api"), "aws4_request")

def sp_get(endpoint: str, region: str, path: str, params: dict = None, cred: str = "main") -> requests.Response:
    token = lwa_token(cred)
    host  = endpoint.removeprefix("https://")
    t     = datetime.datetime.utcnow()
    amz_date   = t.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = t.strftime("%Y%m%d")

    qs = ""
    if params:
        qs = "&".join(
            f"{urllib.parse.quote(str(k), safe='')}={urllib.parse.quote(str(v), safe='')}"
            for k, v in sorted(params.items())
        )

    # All headers that participate in signing (must be sorted alphabetically)
    hdrs_to_sign = {
        "host":               host,
        "x-amz-access-token": token,
        "x-amz-date":         amz_date,
    }
    sorted_keys   = sorted(hdrs_to_sign)
    canon_hdrs    = "".join(f"{k}:{hdrs_to_sign[k]}\n" for k in sorted_keys)
    signed_hdrs   = ";".join(sorted_keys)
    payload_hash  = hashlib.sha256(b"").hexdigest()

    canon_req = "\n".join(["GET", path, qs, canon_hdrs, signed_hdrs, payload_hash])
    scope     = f"{date_stamp}/{region}/execute-api/aws4_request"
    sts       = "\n".join([
        "AWS4-HMAC-SHA256",
        amz_date,
        scope,
        hashlib.sha256(canon_req.encode()).hexdigest(),
    ])

    sig  = hmac.new(_signing_key(CFG["aws_secret_access_key"], date_stamp, region),
                    sts.encode(), hashlib.sha256).hexdigest()
    auth = (f"AWS4-HMAC-SHA256 Credential={CFG['aws_access_key_id']}/{scope}, "
            f"SignedHeaders={signed_hdrs}, Signature={sig}")

    url = f"{endpoint}{path}" + (f"?{qs}" if qs else "")
    return requests.get(url, headers={**hdrs_to_sign, "Authorization": auth}, timeout=15)

# ── Region list: (endpoint, aws_region, lwa_cred) ────────────────────────────
# EU credentials cover EU + NA; separate JP app covers FE.
REGIONS = [
    ("https://sellingpartnerapi-eu.amazon.com", "eu-west-1",  "main"),  # DE/FR/IT/ES/UK/NL/BE/...
    ("https://sellingpartnerapi-fe.amazon.com", "us-west-2",  "jp"),    # JP / AU / SG
    ("https://sellingpartnerapi-na.amazon.com", "us-east-1",  "main"),  # US / CA / MX (fallback)
]

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="SP-API Proxy", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

@app.get("/order/{order_id}")
def get_order(order_id: str):
    if not re.fullmatch(r"\d{3}-\d{7}-\d{7}", order_id):
        raise HTTPException(400, "Invalid order ID format (expected NNN-NNNNNNN-NNNNNNN)")

    last_status = None
    for endpoint, region, cred in REGIONS:
        try:
            r = sp_get(endpoint, region, f"/orders/v0/orders/{order_id}", cred=cred)
        except Exception as e:
            last_status = str(e)
            continue

        if r.status_code == 200:
            order = r.json().get("payload", {})

            items_r = sp_get(endpoint, region, f"/orders/v0/orders/{order_id}/items", cred=cred)
            items   = items_r.json().get("payload", {}).get("OrderItems", []) if items_r.ok else []

            addr_r = sp_get(endpoint, region, f"/orders/v0/orders/{order_id}/address", cred=cred)
            addr   = addr_r.json().get("payload", {}).get("ShippingAddress", {}) if addr_r.ok else {}

            buyer_r = sp_get(endpoint, region, f"/orders/v0/orders/{order_id}/buyerInfo", cred=cred)
            buyer   = buyer_r.json().get("payload", {}) if buyer_r.ok else {}  # BuyerName is at payload root

            return {"order": order, "items": items, "address": addr, "buyer": buyer, "region": region}

        if r.status_code not in (400, 403, 404):
            last_status = r.status_code  # unexpected error — keep trying but log it

    raise HTTPException(404, f"Order not found in any region. Last status: {last_status}")

@app.get("/debug/{order_id}")
def debug_order(order_id: str):
    """Returns raw SP-API responses for all sub-calls — use for troubleshooting."""
    for endpoint, region, cred in REGIONS:
        r = sp_get(endpoint, region, f"/orders/v0/orders/{order_id}", cred=cred)
        if r.status_code != 200:
            continue
        items_r = sp_get(endpoint, region, f"/orders/v0/orders/{order_id}/items", cred=cred)
        addr_r  = sp_get(endpoint, region, f"/orders/v0/orders/{order_id}/address", cred=cred)
        buyer_r = sp_get(endpoint, region, f"/orders/v0/orders/{order_id}/buyerInfo", cred=cred)
        return {
            "region": region,
            "order_status":     r.status_code,
            "items_status":     items_r.status_code,
            "items_raw":        items_r.text,
            "address_status":   addr_r.status_code,
            "buyer_status":     buyer_r.status_code,
            "buyer_raw":        buyer_r.text,
        }
    raise HTTPException(404, "Order not found")

if __name__ == "__main__":
    print(f"SP-API proxy starting → http://localhost:5050")
    print(f"Config: {CONFIG_PATH}")
    uvicorn.run(app, host="127.0.0.1", port=5050, log_level="warning")
