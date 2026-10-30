"""Measure (b2): GraphQL batch. Fetch root manifests for many repos in one query. Also gives zero-manifest share + corpus for (c)."""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ghx
from deps import MANIFESTS
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
sample = json.load(open(f"{D}/sample.json"))

def build(names):
    parts = []
    for i, fn in enumerate(names):
        o, n = fn.split("/", 1)
        fields = ['nameWithOwner', 'primaryLanguage{name}',
                  'root: object(expression:"HEAD:"){... on Tree{entries{name type}}}']
        for j, m in enumerate(MANIFESTS):
            fields.append(f'm{j}: object(expression:"HEAD:{m}"){{... on Blob{{byteSize isTruncated text}}}}')
        parts.append(f'r{i}: repository(owner:{json.dumps(o)}, name:{json.dumps(n)}){{{" ".join(fields)}}}')
    return "query{ rateLimit{cost remaining nodeCount} " + " ".join(parts) + " }"

def run(names):
    q = build(names)
    t = time.time()
    r = ghx.graphql(q)
    try: j = r.json()
    except Exception: j = {"errors": [{"message": f"non-JSON body, HTTP {r.status_code}: {r.text[:120]!r}"}]}
    return {"status": r.status_code, "secs": round(time.time() - t, 1), "bytes": len(r.content),
            "cost": (j.get("data") or {}).get("rateLimit", {}).get("cost"), "nodeCount": (j.get("data") or {}).get("rateLimit", {}).get("nodeCount"),
            "remaining": (j.get("data") or {}).get("rateLimit", {}).get("remaining"), "errors": [e.get("message") for e in j.get("errors", [])][:3], "json": j}

def unpack(names, j):
    out = {}
    for i, fn in enumerate(names):
        d = (j.get("data") or {}).get(f"r{i}")
        if not d: out[fn] = None; continue
        files = {}
        for k, m in enumerate(MANIFESTS):
            b = d.get(f"m{k}")
            if b: files[m] = {"text": b.get("text"), "truncated": b.get("isTruncated"), "bytes": b.get("byteSize")}
        out[fn] = {"entries": [e["name"] for e in (d.get("root") or {}).get("entries", [])], "files": files, "lang": (d.get("primaryLanguage") or {}).get("name")}
    return out

if __name__ == "__main__":
    names = [s["full_name"] for s in sample]
    stats = []
    # cost probes on the first 50 sample repos (batch size 25 and 50), then whole 200 in batches of 50
    for label, chunk in (("25-batch", names[:25]), ("50-batch", names[:50]), ("35-batch", names[:35])):
        r = run(chunk); stats.append({"label": label, "repos": len(chunk), **{k: v for k, v in r.items() if k != "json"}})
        print(stats[-1])
    corpus = {}
    for i in range(0, len(names), 25):
        chunk = names[i:i + 25]
        r = run(chunk); stats.append({"label": f"corpus[{i}:{i+25}]", "repos": len(chunk), **{k: v for k, v in r.items() if k != "json"}})
        print(stats[-1])
        corpus.update(unpack(chunk, r["json"]))
    json.dump(corpus, open(f"{D}/gql_corpus.json", "w"))
    json.dump(stats, open(f"{D}/gql_stats.json", "w"), indent=1)
    print("missing repos (null)", [k for k, v in corpus.items() if v is None])
    print("calls", ghx.CALLS)
