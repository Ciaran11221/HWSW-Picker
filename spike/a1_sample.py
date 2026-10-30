"""Measure (a): count league repos, draw a uniform random sample of 200 by date-slicing.
Run: python -I spike/a1_sample.py   (from C:\HWSW-Picker; needs spike on sys.path => run via -I with PYTHONPATH-less import hack below)
"""
import sys, os, json, random, datetime as dt
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ghx

BAR = "stars:>=50"
START, END = dt.date(2025, 10, 30), dt.date(2026, 10, 30)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

def count(a, b):
    r = ghx.search(f"created:{a}..{b} {BAR}")
    r.raise_for_status()
    return r.json()["total_count"]

# overall number (the headline query)
r = ghx.search(f"created:>={START} {BAR}"); r.raise_for_status()
TOTAL = r.json()["total_count"]
print("HEADLINE total_count", TOTAL)

# adaptive slices each <=1000 items
slices = []
def split(a, b):
    n = count(a, b)
    if n <= 1000 or a == b:
        slices.append((a, b, n)); return
    mid = a + (b - a) // 2
    split(a, mid); split(mid + dt.timedelta(days=1), b)
d = START
while d <= END:
    e = min(d + dt.timedelta(days=6), END)
    split(d, e); d = e + dt.timedelta(days=1)
SUM = sum(n for _, _, n in slices)
print("slices", len(slices), "sum", SUM, "max slice", max(n for *_, n in slices))
json.dump({"total_count": TOTAL, "slices": [(str(a), str(b), n) for a, b, n in slices]}, open(f"{OUT}/slices.json", "w"))

# uniform sample over slice-sum population
random.seed(20261030)
idx = sorted(random.sample(range(SUM), 200))
cum, start = [], 0
for a, b, n in slices:
    cum.append((start, a, b, n)); start += n
need = {}
for i in idx:
    for s, a, b, n in cum:
        if s <= i < s + n:
            need.setdefault((a, b), []).append(i - s); break
sample = []
for (a, b), offs in need.items():
    pages = {}
    for o in offs:
        pages.setdefault(o // 100 + 1, []).append(o % 100)
    for pg, ins in pages.items():
        r = ghx.search(f"created:{a}..{b} {BAR}", sort="stars", order="desc", per_page=100, page=pg)
        r.raise_for_status()
        items = r.json()["items"]
        for k in ins:
            if k < len(items):
                it = items[k]
                sample.append({"full_name": it["full_name"], "language": it["language"], "stars": it["stargazers_count"],
                               "size_kb": it["size"], "created_at": it["created_at"], "fork": it["fork"],
                               "archived": it["archived"], "topics": it.get("topics", []), "description": it["description"]})
print("sample", len(sample), "search calls", ghx.CALLS)
json.dump(sample, open(f"{OUT}/sample.json", "w"), indent=1)
