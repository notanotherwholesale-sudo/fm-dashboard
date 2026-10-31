#!/usr/bin/env python3
"""
NAW reviews wall sync — HEADLESS / cloud version (GitHub Actions).

Mirrors the logic of the scheduled-task SKILL (naw-reviews-sync):
pulls verified 4star+ customer reviews from Klaviyo (metric S5biF8 "Submitted review")
and syncs new ones onto the live reviews wall = Shopify SHOP metafield
custom.reviews_feed (type json), owner gid://shopify/Shop/81040900375.

Runs entirely on the Klaviyo + Shopify REST/GraphQL APIs — no Mac, no MCP.
Safe by design: never shrinks/blanks the wall, dedups, honours the repeat-reviewer
guard, caps at 120 newest. Defaults to DRY RUN; set WRITE=1 to actually write.

ENV (GitHub secrets):
  KLAVIYO_API_KEY     Klaviyo private API key (pk_...)  -- read events
  SHOPIFY_STORE       e64e26-3.myshopify.com
  SHOPIFY_ADMIN_TOKEN Shopify Admin API access token (shpat_...) -- read/write metafield
  WRITE               "1" to write; anything else = dry run (prints the diff only)
"""
import os, sys, json, time, re, urllib.request, urllib.parse, urllib.error
from datetime import datetime, timedelta, timezone

KLAVIYO_KEY   = os.environ.get("KLAVIYO_API_KEY", "").strip()
SHOP_DOMAIN   = os.environ.get("SHOPIFY_STORE", "e64e26-3.myshopify.com").strip()
SHOP_TOKEN    = os.environ.get("SHOPIFY_ADMIN_TOKEN", "").strip()
WRITE         = os.environ.get("WRITE", "") == "1"

SHOP_GID   = "gid://shopify/Shop/81040900375"
METRIC_ID  = "S5biF8"
SHOP_API_V = "2026-10"
KLAVIYO_REVISION = "2024-10-15"
CAP = 120

def die(msg, code=1):
    print("ABORT:", msg); sys.exit(code)

def http(url, headers, data=None, method=None):
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:800]
        die(f"HTTP {e.code} {url}\n{body}")

# ---------- Klaviyo ----------
def klaviyo_events():
    since = (datetime.now(timezone.utc) - timedelta(days=21)).strftime("%Y-%m-%dT%H:%M:%SZ")
    flt = f'and(equals(metric_id,"{METRIC_ID}"),greater-or-equal(datetime,{since}))'
    params = {
        "filter": flt,
        "sort": "-datetime",
        "fields[event]": "datetime,timestamp,event_properties",
        "page[size]": "50",
    }
    url = "https://a.klaviyo.com/api/events/?" + urllib.parse.urlencode(params)
    headers = {
        "Authorization": f"Klaviyo-API-Key {KLAVIYO_KEY}",
        "revision": KLAVIYO_REVISION,
        "accept": "application/json",
    }
    out = []
    while url:
        d = http(url, headers)
        out.extend(d.get("data", []))
        url = (d.get("links") or {}).get("next")
    return out

# ---------- Shopify ----------
def shop_gql(query, variables=None):
    url = f"https://{SHOP_DOMAIN}/admin/api/{SHOP_API_V}/graphql.json"
    headers = {"X-Shopify-Access-Token": SHOP_TOKEN, "Content-Type": "application/json"}
    payload = {"query": query, "variables": variables or {}}
    d = http(url, headers, data=json.dumps(payload).encode(), method="POST")
    if d.get("errors"):
        die("Shopify GraphQL errors: " + json.dumps(d["errors"])[:600])
    return d["data"]

def read_feed():
    q = 'query{ shop{ metafield(namespace:"custom",key:"reviews_feed"){ value } } }'
    mf = shop_gql(q)["shop"]["metafield"]
    if not mf or mf.get("value") in (None, ""):
        die("reviews_feed metafield missing/empty — not writing.")
    try:
        feed = json.loads(mf["value"])
    except Exception as e:
        die(f"feed JSON parse failed: {e}")
    if not isinstance(feed, list) or not feed:
        die("feed is not a non-empty list — not writing.")
    return feed

def write_feed(new_feed):
    m = """mutation($m:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$m){ metafields{ id updatedAt } userErrors{ field message code } } }"""
    variables = {"m":[{"ownerId":SHOP_GID,"namespace":"custom","key":"reviews_feed",
                       "type":"json","value": json.dumps(new_feed, ensure_ascii=False, separators=(",",":"))}]}
    res = shop_gql(m, variables)["metafieldsSet"]
    if res["userErrors"]:
        die("metafieldsSet userErrors: " + json.dumps(res["userErrors"]))
    return res["metafields"][0]

# ---------- transform ----------
def norm_key(n, text):
    base = re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()
    return f"{(n or '').strip().lower()}|{base[:24]}"

def candidate(ep, ts_unix):
    rating = ep.get("review_rating")
    content = ep.get("review_content")
    if not isinstance(rating, int) or rating < 4: return None
    if ep.get("review_verified") is not True: return None
    if not isinstance(content, str) or not content.strip(): return None
    if ep.get("review_status") == "Rejected": return None
    n = (ep.get("review_author") or "").strip() or "Verified Buyer"
    # product
    is_store = bool(ep.get("is_store_review"))
    sp = ep.get("structured_product") or {}
    pname = sp.get("product_name")
    if not pname:
        prod = ep.get("product")
        pname = prod.get("title") if isinstance(prod, dict) else None
    if is_store or not pname or pname == "Not Another Wholesale":
        p = ""; pi = ""
    else:
        p = pname
        img = sp.get("image_url")
        if not img:
            prod = ep.get("product") or {}
            imgs = prod.get("images") if isinstance(prod, dict) else None
            img = imgs[0].get("src") if (isinstance(imgs, list) and imgs) else None
        pi = ""
        if img and "cdn.shopify.com" in img:
            pi = img.split("?")[0].rstrip("/").split("/")[-1]
    # klaviyo photo
    ki = ""
    ri = ep.get("review_images")
    if isinstance(ri, list) and ri:
        u = ri[0].split("?")[0]
        if "/reviews/images/" in u:
            ki = u.split("/reviews/images/", 1)[1]
    return {"n":n,"ts":round(ts_unix/60),"s":rating,"t":ep.get("review_title") or "",
            "q":content,"img":"","ki":ki,"si":"","p":p,"pi":pi,"pimg":"","imgs":None,"f":0,"d":""}

def main():
    for name, val in [("KLAVIYO_API_KEY",KLAVIYO_KEY),("SHOPIFY_ADMIN_TOKEN",SHOP_TOKEN)]:
        if not val: die(f"missing env {name}")
    feed = read_feed()
    events = klaviyo_events()
    # build candidates
    cands = []
    for e in events:
        a = e.get("attributes", {})
        ep = a.get("event_properties") or {}
        ts = a.get("timestamp")
        if not isinstance(ts, (int, float)):
            # fall back to datetime
            try: ts = datetime.strptime(a["datetime"][:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc).timestamp()
            except Exception: continue
        c = candidate(ep, ts)
        if c: cands.append(c)
    # dedup vs feed
    feed_keys = set()
    feed_ts = set()
    feed_authors_first = set()
    feed_authors_full = set()
    for f in feed:
        feed_keys.add(norm_key(f.get("n"), f.get("q") or f.get("t")))
        feed_ts.add(f"{(f.get('n') or '').strip().lower()}|{f.get('ts')}")
        nm = (f.get("n") or "").strip().lower()
        if nm:
            feed_authors_full.add(nm); feed_authors_first.add(nm.split()[0])
    adds, held, skipped = [], [], 0
    seen = set()
    # newest first so strongest-per-author wins naturally when we take first
    cands.sort(key=lambda c: c["ts"], reverse=True)
    by_author_added = set()
    for c in cands:
        k = norm_key(c["n"], c["q"] or c["t"])
        tsk = f"{c['n'].strip().lower()}|{c['ts']}"
        if k in feed_keys or tsk in feed_ts or k in seen:
            continue
        seen.add(k)
        nmf = c["n"].strip().lower()
        first = nmf.split()[0] if nmf else ""
        # repeat-reviewer guard: author already on wall, or already added one this run
        if nmf in feed_authors_full or (first and first in feed_authors_first) or first in by_author_added:
            held.append(c); continue
        adds.append(c);
        if first: by_author_added.add(first)
    # summary
    print(f"candidates kept (verified 4star+): {len(cands)} | new to add: {len(adds)} | held (repeat/dup): {len(held)}")
    for c in adds:
        print(f"  + {c['n']} {c['s']}* {c['p'] or 'store review'} :: {c['q'][:50]}")
    for c in held:
        print(f"  held {c['n']} :: {c['q'][:40]}")
    if not adds:
        print("Nothing new to add."); return
    new_feed = sorted(adds, key=lambda c: c["ts"], reverse=True) + feed
    new_feed = sorted(new_feed, key=lambda c: c["ts"], reverse=True)[:CAP]
    # safety
    json.dumps(new_feed)  # valid
    survivors = {id(x) for x in new_feed}
    kept_existing = [f for f in feed if f in new_feed]
    if len(new_feed) < min(CAP, len(feed)):
        die("safety: new_feed would shrink the wall")
    if WRITE:
        res = write_feed(new_feed)
        print(f"WROTE feed: {len(new_feed)} entries, metafield {res['id']} @ {res['updatedAt']}")
    else:
        print(f"DRY RUN (WRITE!=1): would write {len(new_feed)} entries (added {len(adds)}). Set WRITE=1 to apply.")

if __name__ == "__main__":
    main()
