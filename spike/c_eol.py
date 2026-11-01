"""Measure (c): top-100 dependency tags from the 200-sample GraphQL corpus -> endoflife.date product mapping."""
import sys, os, json, re, urllib.parse, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from deps import parse
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
corpus = json.load(open(f"{D}/gql_corpus.json"))
sample = {s["full_name"]: s for s in json.load(open(f"{D}/sample.json"))}
eol = json.load(open(f"{D}/eol_full.json"))["result"]

# tags per repo
repo_tags, parse_fail, empty_manifest = {}, 0, 0
for fn, c in corpus.items():
    tags = set()
    if c:
        for f, b in c["files"].items():
            if not b["text"]: continue
            r = parse(f, b["text"])
            if r is None: parse_fail += 1; continue
            if not r: empty_manifest += 1
            for eco, n, v in r: tags.add((eco, n))
    repo_tags[fn] = tags
cnt = collections.Counter(t for ts in repo_tags.values() for t in ts)
top = cnt.most_common(100)
print("repos with >=1 dep tag", sum(1 for t in repo_tags.values() if t), "distinct tags", len(cnt), "parse_fail", parse_fail)
print("count at rank 1/10/50/100:", [top[i][1] for i in (0, 9, 49, 99) if i < len(top)])

# EOL index
byname = {}
purl = {}
for p in eol:
    for k in [p["name"]] + p.get("aliases", []) + [p["label"].lower()]:
        byname.setdefault(k.lower(), set()).add(p["name"])
    for i in p.get("identifiers", []):
        if i["type"] == "purl":
            purl.setdefault(urllib.parse.unquote(i["id"]).lower(), set()).add(p["name"])
def purl_keys(eco, n):
    if eco == "npm": return [f"pkg:npm/{n}"]
    if eco == "pypi": return [f"pkg:pypi/{n}"]
    if eco == "maven": g, _, a = n.partition(":"); return [f"pkg:maven/{g}/{a}"]
    if eco == "docker": return [f"pkg:docker/library/{n}", f"pkg:docker/{n}"]
    if eco == "go": return [f"pkg:golang/{n}", f"pkg:github/{n.replace('github.com/','')}"]
    if eco == "cargo": return [f"pkg:cargo/{n}"]
    if eco == "composer": return [f"pkg:composer/{n}"]
    if eco == "gem": return [f"pkg:gem/{n}"]
    return []
rows = []
for (eco, n), c in top:
    by_purl = set().union(*[purl.get(k, set()) for k in purl_keys(eco, n)]) if purl_keys(eco, n) else set()
    by_name = byname.get(n, set()) | byname.get(n.split("/")[-1].split(":")[-1], set()) if eco in ("docker",) else byname.get(n, set())
    rows.append({"tag": f"{eco}:{n}", "repos": c, "purl": sorted(by_purl), "name": sorted(by_name)})
m_purl = [r for r in rows if r["purl"]]
m_name = [r for r in rows if r["name"] and not r["purl"]]
m_any = [r for r in rows if r["purl"] or r["name"]]
print("matched via purl", len(m_purl), "name/alias only", len(m_name), "union", len(m_any), "of", len(rows))
json.dump(rows, open(f"{D}/c_rows.json", "w"), indent=1)
print("MATCHED:", "; ".join(f"{r['tag']}({r['repos']})->{(r['purl'] or r['name'])[0]}{'[purl]' if r['purl'] else '[name]'}" for r in m_any))
print("UNMATCHED:", "; ".join(f"{r['tag']}({r['repos']})" for r in rows if not (r["purl"] or r["name"])))
# language tags
langs = collections.Counter(s["language"] for s in sample.values() if s["language"])
lang_alias = {"c++": "cpp", "c#": "csharp", "javascript": "nodejs", "typescript": "typescript"}
print("LANG:", [(l, c, sorted(byname.get(l.lower(), byname.get(lang_alias.get(l.lower(), "~"), set())))) for l, c in langs.most_common(10)])
