"""Measure (b1, b3): SBOM and REST-contents on the same 50 code repos. Requires sample.json and gql_corpus.json."""
import sys, os, json, random, base64, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ghx
from deps import MANIFESTS, parse
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
sample = json.load(open(f"{D}/sample.json"))
random.seed(20261031)
# "code repo" = GitHub reports a primary language. Selection is independent of manifests (no bias towards SBOM).
code = [s["full_name"] for s in sample if s["language"]]
sel = random.sample(code, 50)
json.dump(sel, open(f"{D}/sample50.json", "w"))

def snap(): return int(ghx.rest("/rate_limit", kind="core").json()["resources"]["core"]["remaining"])

# ---- SBOM ----
before = snap(); calls0 = ghx.CALLS["core"]
sbom = {}
for fn in sel:
    r = ghx.rest(f"/repos/{fn}/dependency-graph/sbom")
    ent = {"status": r.status_code, "redirects": len(r.history)}
    if r.status_code == 200:
        s = r.json()["sbom"]
        pk = s.get("packages", [])
        rel = s.get("relationships", [])
        ent["packages"] = [{"name": p.get("name"), "version": p.get("versionInfo"), "purl": next((x["referenceLocator"] for x in p.get("externalRefs", []) if x.get("referenceType") == "purl"), None)} for p in pk]
        ent["rel_sources"] = {}
        for x in rel: ent["rel_sources"][x["spdxElementId"] + "|" + x["relationshipType"]] = ent["rel_sources"].get(x["spdxElementId"] + "|" + x["relationshipType"], 0) + 1
        ent["describes"] = [x["relatedSpdxElement"] for x in rel if x["relationshipType"] == "DESCRIBES"]
        ent["root_ids"] = [p["SPDXID"] for p in pk[:1]]
    else:
        ent["body"] = r.text[:200]
    sbom[fn] = ent
sbom_calls = ghx.CALLS["core"] - calls0
after = snap()
json.dump(sbom, open(f"{D}/sbom.json", "w"))
print("SBOM calls", sbom_calls, "core remaining before/after (incl. the 2 rate_limit probes, which are free)", before, after)

# ---- REST contents baseline ----
before = snap(); calls0 = ghx.CALLS["core"]
rest_res = {}
for fn in sel:
    n = 0
    r = ghx.rest(f"/repos/{fn}/contents/"); n += 1
    ent = {"list_status": r.status_code, "files": {}}
    if r.status_code == 200 and isinstance(r.json(), list):
        names = {x["name"]: x for x in r.json()}
        ent["entries"] = list(names)
        for m in MANIFESTS:
            if m in names and names[m]["type"] == "file":
                rr = ghx.rest(f"/repos/{fn}/contents/{m}"); n += 1
                if rr.status_code == 200 and rr.json().get("encoding") == "base64":
                    ent["files"][m] = base64.b64decode(rr.json()["content"]).decode("utf-8", "replace")
    ent["calls"] = n
    rest_res[fn] = ent
rest_calls = ghx.CALLS["core"] - calls0
after = snap()
json.dump(rest_res, open(f"{D}/rest_contents.json", "w"))
print("REST calls", rest_calls, "core remaining before/after", before, after)
