"""GitHub helper for the spike. Counts every call and records rate-limit headers."""
import json, subprocess, time, requests

_TOKEN = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, check=True).stdout.strip()
S = requests.Session()
S.headers.update({"Authorization": f"Bearer {_TOKEN}", "Accept": "application/vnd.github+json",
                  "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "hwsw-picker-spike"})
CALLS = {"search": 0, "core": 0, "graphql": 0}
LAST_LIMIT = {}

def _note(r, kind):
    CALLS[kind] += 1
    LAST_LIMIT[kind] = {"remaining": r.headers.get("x-ratelimit-remaining"), "resource": r.headers.get("x-ratelimit-resource")}

def rest(path, params=None, kind="core", retries=3):
    url = path if path.startswith("http") else "https://api.github.com" + path
    for i in range(retries):
        r = S.get(url, params=params, timeout=60)
        _note(r, kind)
        if r.status_code in (403, 429) and r.headers.get("x-ratelimit-remaining") == "0":
            wait = int(r.headers.get("x-ratelimit-reset", "0")) - int(time.time()) + 2
            time.sleep(max(wait, 5)); continue
        if r.status_code == 403 and "secondary" in r.text.lower():
            time.sleep(30); continue
        return r
    return r

def search(q, **kw):
    time.sleep(2.2)  # stay below 30/min
    p = {"q": q, "per_page": 1}; p.update(kw)
    return rest("/search/repositories", p, kind="search")

def graphql(query, variables=None):
    r = S.post("https://api.github.com/graphql", json={"query": query, "variables": variables or {}}, timeout=120)
    _note(r, "graphql")
    return r
