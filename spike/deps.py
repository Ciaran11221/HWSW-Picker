"""Manifest parsers. Input is UNTRUSTED text; only parsed as data (json / tomllib / regex). Nothing is executed or XML-expanded."""
import json, re, tomllib

MANIFESTS = ["package.json", "requirements.txt", "pyproject.toml", "pom.xml", "build.gradle", "build.gradle.kts",
             "go.mod", "Cargo.toml", "composer.json", "Gemfile", "Dockerfile", "docker-compose.yml"]

def _pep508(s):
    m = re.match(r"\s*([A-Za-z0-9][A-Za-z0-9_.\-]*)\s*(?:\[[^\]]*\])?\s*([^;#]*)", s)
    return (m.group(1).lower().replace("_", "-"), m.group(2).strip()) if m else None

def parse(fname, text):
    """returns list of (ecosystem, name_lowercase, version_spec)"""
    out = []
    try:
        if fname == "package.json":
            d = json.loads(text)
            for k in ("dependencies", "devDependencies", "peerDependencies"):
                for n, v in (d.get(k) or {}).items():
                    out.append(("npm", n.lower(), str(v)))
        elif fname == "requirements.txt":
            for line in text.splitlines():
                line = line.split(" #")[0].strip()
                if not line or line.startswith(("-", "#", "http", "git+", ".")): continue
                r = _pep508(line)
                if r: out.append(("pypi", r[0], r[1]))
        elif fname == "pyproject.toml":
            d = tomllib.loads(text)
            p = d.get("project", {})
            for s in p.get("dependencies", []) or []:
                r = _pep508(s); r and out.append(("pypi", r[0], r[1]))
            for grp in (p.get("optional-dependencies") or {}).values():
                for s in grp:
                    r = _pep508(s); r and out.append(("pypi", r[0], r[1]))
            for grp in (d.get("dependency-groups") or {}).values():
                for s in grp:
                    if isinstance(s, str):
                        r = _pep508(s); r and out.append(("pypi", r[0], r[1]))
            poetry = (d.get("tool", {}).get("poetry") or {})
            for sec in ("dependencies", "dev-dependencies"):
                for n, v in (poetry.get(sec) or {}).items():
                    if n.lower() != "python": out.append(("pypi", n.lower().replace("_", "-"), str(v)))
            for grp in (poetry.get("group") or {}).values():
                for n, v in (grp.get("dependencies") or {}).items():
                    out.append(("pypi", n.lower().replace("_", "-"), str(v)))
        elif fname == "pom.xml":
            body = re.sub(r"<!--.*?-->", "", text, flags=re.S)
            body = re.sub(r"<(pluginManagement|build|plugins)>.*?</\1>", "", body, flags=re.S) if False else body
            for blk in re.findall(r"<dependency>(.*?)</dependency>", body, flags=re.S):
                g = re.search(r"<groupId>\s*([^<\s]+)\s*</groupId>", blk); a = re.search(r"<artifactId>\s*([^<\s]+)\s*</artifactId>", blk)
                v = re.search(r"<version>\s*([^<\s]+)\s*</version>", blk)
                if g and a: out.append(("maven", f"{g.group(1)}:{a.group(1)}".lower(), v.group(1) if v else ""))
        elif fname in ("build.gradle", "build.gradle.kts"):
            for m in re.finditer(r"""\b(?:implementation|api|compileOnly|runtimeOnly|testImplementation|testRuntimeOnly|annotationProcessor|classpath|kapt|ksp|developmentOnly)\s*\(?\s*(?:platform\()?\s*["']([^:"'$]+):([^:"'$]+)(?::([^"']+))?["']""", text):
                out.append(("maven", f"{m.group(1)}:{m.group(2)}".lower(), m.group(3) or ""))
        elif fname == "go.mod":
            inblock = False
            for line in text.splitlines():
                s = line.split("//")[0].strip()
                if s.startswith("require ("): inblock = True; continue
                if inblock and s == ")": inblock = False; continue
                m = re.match(r"(?:require\s+)?(\S+)\s+(v\S+)$", s) if (inblock or s.startswith("require ")) else None
                if m: out.append(("go", m.group(1).lower(), m.group(2)))
        elif fname == "Cargo.toml":
            d = tomllib.loads(text)
            secs = [d.get(k) or {} for k in ("dependencies", "dev-dependencies", "build-dependencies")]
            secs.append((d.get("workspace") or {}).get("dependencies") or {})
            for t in d.get("target", {}).values():
                for k in ("dependencies", "dev-dependencies"): secs.append(t.get(k) or {})
            for sec in secs:
                for n, v in sec.items():
                    out.append(("cargo", n.lower(), v if isinstance(v, str) else str((v or {}).get("version", "") if isinstance(v, dict) else v)))
        elif fname == "composer.json":
            d = json.loads(text)
            for k in ("require", "require-dev"):
                for n, v in (d.get(k) or {}).items():
                    if n.startswith("ext-"): continue
                    out.append(("composer", n.lower(), str(v)))
        elif fname == "Gemfile":
            for m in re.finditer(r"""^\s*gem\s+["']([^"']+)["']\s*(?:,\s*["']([^"']+)["'])?""", text, flags=re.M):
                out.append(("gem", m.group(1).lower(), m.group(2) or ""))
        elif fname == "Dockerfile":
            stages = set()
            for line in text.splitlines():
                m = re.match(r"\s*FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?", line, flags=re.I)
                if m:
                    img = m.group(1)
                    if m.group(2): stages.add(m.group(2).lower())
                    if img.lower() in stages or img.lower() == "scratch" or "$" in img.split(":")[0]: continue
                    name, _, tag = img.partition(":")
                    name = name.split("@")[0].lower()
                    out.append(("docker", name.replace("docker.io/", "").replace("library/", ""), tag))
        elif fname == "docker-compose.yml":
            for m in re.finditer(r"^\s*image:\s*[\"']?([^\s\"'#]+)", text, flags=re.M):
                img = m.group(1)
                if "$" in img.split(":")[0]: continue
                name, _, tag = img.partition(":")
                out.append(("docker", name.lower().replace("docker.io/", "").replace("library/", ""), tag))
    except Exception:
        return None  # parse failure (distinct from empty)
    return out
