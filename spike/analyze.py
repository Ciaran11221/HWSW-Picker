"""Summarise a, b, language spread, zero-manifest share. Reads spike/data/*.json."""
import sys, os, json, re, collections, statistics
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from deps import parse, MANIFESTS
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
L = lambda n: json.load(open(f"{D}/{n}.json"))
sample, contrib, corpus, sel = L("sample"), L("contrib"), L("gql_corpus"), L("sample50")
sbom, rest = L("sbom"), L("rest_contents")
S = {}
# ---- a
tot = L("slices")["total_count"]
ge2 = sum(1 for v in contrib.values() if v["n_ge2"]); n = len(contrib)
S["a"] = {"total_count": tot, "sample": n, "ge2": ge2, "fraction": ge2 / n, "estimate": tot * ge2 / n}
# Wilson 95% CI
import math
p = ge2 / n; z = 1.96
lo = (p + z*z/(2*n) - z*math.sqrt(p*(1-p)/n + z*z/(4*n*n))) / (1 + z*z/n)
hi = (p + z*z/(2*n) + z*math.sqrt(p*(1-p)/n + z*z/(4*n*n))) / (1 + z*z/n)
S["a"]["ci95_frac"] = [lo, hi]; S["a"]["ci95_est"] = [tot*lo, tot*hi]
# ---- languages / zero manifest (200)
lang = collections.Counter(s["language"] or "(none)" for s in sample)
S["lang_top10"] = [(k, v, v / n) for k, v in lang.most_common(10)]
S["no_language"] = lang.get("(none)", 0)
def has_manifest(c): return bool(c and c["files"])
def has_csproj(c): return bool(c and any(e.endswith((".csproj", ".sln", ".fsproj")) for e in c["entries"]))
zero12 = [fn for fn, c in corpus.items() if not has_manifest(c)]
zero_all = [fn for fn in zero12 if not has_csproj(corpus[fn])]
S["zero_manifest"] = {"n": len(corpus), "zero_12": len(zero12), "zero_12_or_csproj": len(zero_all),
                      "csproj_only": len(zero12) - len(zero_all)}
# of zero-manifest repos: what do they look like (language counts)
S["zero_lang"] = collections.Counter((sample_l or "(none)") for sample_l in [next(s["language"] for s in sample if s["full_name"] == fn) for fn in zero12]).most_common(6)
byfn = {s["full_name"]: s for s in sample}
S["manifest_counts"] = collections.Counter(m for c in corpus.values() if c for m in c["files"]).most_common()
# repos with manifests but parse -> 0 deps
def deps_of(files):
    out = []
    for f, t in files.items():
        r = parse(f, t) if t else None
        if r: out += r
    return out
gq_deps = {fn: deps_of({f: b["text"] for f, b in c["files"].items()}) if c else [] for fn, c in corpus.items()}
S["deps_ge1_200"] = sum(1 for d in gq_deps.values() if d)
S["truncated_blobs"] = sum(1 for c in corpus.values() if c for b in c["files"].values() if b["truncated"])
# ---- b on the 50
b = {}
b["n"] = len(sel)
b["sel_lang_none"] = sum(1 for fn in sel if not byfn[fn]["language"])
# GraphQL
g_manifest = [fn for fn in sel if has_manifest(corpus[fn])]
g_hit = [fn for fn in sel if gq_deps[fn]]
b["gql"] = {"manifest_repos": len(g_manifest), "dep_hit": len(g_hit)}
# REST
r_manifest = [fn for fn in sel if rest[fn]["files"]]
r_dep = {fn: deps_of(rest[fn]["files"]) for fn in sel}
r_hit = [fn for fn in sel if r_dep[fn]]
b["rest"] = {"calls": sum(rest[fn]["calls"] for fn in sel), "manifest_repos": len(r_manifest), "dep_hit": len(r_hit),
             "calls_per_repo": sum(rest[fn]["calls"] for fn in sel) / len(sel),
             "calls_per_repo_with_manifest": sum(rest[fn]["calls"] for fn in r_manifest) / max(1, len(r_manifest)),
             "list_fail": sum(1 for fn in sel if rest[fn]["list_status"] != 200),
             "same_manifest_set_as_gql": sum(1 for fn in sel if set(rest[fn]["files"]) == set(corpus[fn]["files"]))}
b["rest"]["naive_probe_calls_per_repo"] = len(MANIFESTS)
# SBOM
ok = {fn: v for fn, v in sbom.items() if v["status"] == 200}
b["sbom"] = {"calls": len(sbom), "http200": len(ok), "http404": sum(1 for v in sbom.values() if v["status"] == 404),
             "other": [v["status"] for v in sbom.values() if v["status"] not in (200, 404)]}
def sb_pk(v): return [p for p in v["packages"] if p["name"] and not p["name"].startswith("com.github.")]
rootid = {fn: v["root_ids"][0] for fn, v in ok.items()}
sb_nonroot = {}
for fn, v in ok.items():
    # root package = the one DESCRIBES points at
    root = v["describes"][0] if v["describes"] else None
    sb_nonroot[fn] = [p for p in v["packages"] if True][:]  # filtered below via purl
sb_hit = [fn for fn, v in ok.items() if len(v["packages"]) > 1]
b["sbom"]["dep_hit"] = len(sb_hit)
b["sbom"]["200_with_only_root"] = sum(1 for v in ok.values() if len(v["packages"]) <= 1)
b["sbom"]["404_but_manifest_present"] = sum(1 for fn, v in sbom.items() if v["status"] == 404 and fn in r_manifest)
b["sbom"]["404_and_no_manifest"] = sum(1 for fn, v in sbom.items() if v["status"] == 404 and fn not in r_manifest)
b["sbom"]["200_and_manifest"] = sum(1 for fn in ok if fn in r_manifest)
b["sbom"]["manifest_repos_sbom_hit"] = sum(1 for fn in r_manifest if fn in sb_hit)
# version quality + ecosystems + transitive
eco = collections.Counter(); exact = rng = nov = 0; tot_pk = 0
direct_ratio = []
for fn, v in ok.items():
    root = v["describes"][0] if v["describes"] else None
    key_direct = f"{root}|DEPENDS_ON"
    nd = v["rel_sources"].get(key_direct, 0)
    pk = [p for p in v["packages"] if p["purl"]]
    for p in pk:
        e = p["purl"].split(":")[1].split("/")[0]; eco[e] += 1; tot_pk += 1
        ver = p["version"]
        if not ver: nov += 1
        elif re.fullmatch(r"v?\d+(\.\d+)*([-+.][0-9A-Za-z.\-+]+)?", ver): exact += 1
        else: rng += 1
    direct_ratio.append((fn, len(v["packages"]) - 1, nd))
b["sbom"]["eco"] = eco.most_common(); b["sbom"]["versions"] = {"exact": exact, "range_or_other": rng, "none": nov, "total": tot_pk}
b["sbom"]["pkgs_vs_direct"] = direct_ratio
b["sbom"]["rel_types"] = collections.Counter(k.split("|")[1] for v in ok.values() for k in v["rel_sources"] for _ in range(1))
# sbom cross-check of noise: repos with package.json: parsed direct npm deps vs sbom npm pkgs
cmp = []
for fn in ok:
    d = [x for x in r_dep.get(fn, []) if x[0] == "npm"]
    npm_s = [p for p in ok[fn]["packages"] if p["purl"] and p["purl"].startswith("pkg:npm/")]
    if d and npm_s: cmp.append((fn, len(set(x[1] for x in d)), len(npm_s)))
b["sbom"]["npm_direct_vs_sbom"] = cmp
S["b"] = b
# 50 sample languages
S["b50_lang"] = collections.Counter(byfn[fn]["language"] for fn in sel).most_common(8)
# full-200 manifest-based stats for context
json.dump(S, open(f"{D}/summary.json", "w"), indent=1, default=str)
print(json.dumps(S, indent=1, default=str))
