"""Retry the one 25-repo GraphQL batch that returned HTTP 502, in chunks of 13/12."""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import b2_graphql as b
D = b.D
corpus = json.load(open(f"{D}/gql_corpus.json")); stats = json.load(open(f"{D}/gql_stats.json"))
miss = [k for k, v in corpus.items() if v is None]
for i in range(0, len(miss), 13):
    chunk = miss[i:i + 13]
    r = b.run(chunk); stats.append({"label": f"retry[{i}:{i+13}]", "repos": len(chunk), **{k: v for k, v in r.items() if k != "json"}})
    print(stats[-1])
    if r["status"] == 200: corpus.update(b.unpack(chunk, r["json"]))
json.dump(corpus, open(f"{D}/gql_corpus.json", "w")); json.dump(stats, open(f"{D}/gql_stats.json", "w"), indent=1)
print("still missing", [k for k, v in corpus.items() if v is None])
