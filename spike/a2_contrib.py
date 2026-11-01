"""Measure (a, second half): contributors >=2 on the 200 random sample. 1 REST call per repo."""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ghx
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
sample = json.load(open(f"{D}/sample.json"))
res = {}
for s in sample:
    fn = s["full_name"]
    r = ghx.rest(f"/repos/{fn}/contributors", {"per_page": 2})
    if r.status_code == 200: n = len(r.json())
    elif r.status_code == 204: n = 0
    else: n = None
    res[fn] = {"status": r.status_code, "n_ge2": (n >= 2) if n is not None else None, "n": n}
json.dump(res, open(f"{D}/contrib.json", "w"), indent=1)
ok = [v for v in res.values() if v["n_ge2"] is not None]
print("sample", len(res), "answered", len(ok), "ge2", sum(v["n_ge2"] for v in ok), "unanswered", len(res) - len(ok))
print("status codes", {c: sum(1 for v in res.values() if v["status"] == c) for c in {v["status"] for v in res.values()}})
print("calls", ghx.CALLS)
