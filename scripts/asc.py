#!/usr/bin/env python3
"""
App Store Connect API client for Faff — check build status + distribute to
TestFlight. Reads creds from native/.asc.env (gitignored): ASC_KEY_ID,
ASC_ISSUER_ID, ASC_KEY_PATH.

Usage:
  scripts/asc.py builds                 # recent builds + processing state
  scripts/asc.py status                 # latest build, one line
  scripts/asc.py autoship [GROUP_ID]    # add latest PROCESSED build to a beta group
  scripts/asc.py groups                 # list beta groups (+ ids)
"""
import json, os, sys, time, urllib.request, urllib.error
import jwt  # PyJWT

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = "https://api.appstoreconnect.apple.com"
BUNDLE_ID = "run.faff.app"


def load_env():
    env = {}
    path = os.path.join(ROOT, "native", ".asc.env")
    if not os.path.exists(path):
        sys.exit(f"missing {path}")
    for line in open(path):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


def token(env):
    key = open(os.path.expanduser(env["ASC_KEY_PATH"])).read()
    now = int(time.time())
    return jwt.encode(
        {"iss": env["ASC_ISSUER_ID"], "iat": now, "exp": now + 600, "aud": "appstoreconnect-v1"},
        key, algorithm="ES256", headers={"kid": env["ASC_KEY_ID"], "typ": "JWT"},
    )


def call(env, method, path, body=None):
    url = path if path.startswith("http") else API + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + token(env))
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read() or "{}")
    except urllib.error.HTTPError as e:
        sys.exit(f"ASC {method} {path} -> {e.code}: {e.read().decode()[:500]}")


def app_id(env):
    r = call(env, "GET", f"/v1/apps?filter[bundleId]={BUNDLE_ID}")
    if not r.get("data"):
        sys.exit(f"no app for bundle {BUNDLE_ID}")
    return r["data"][0]["id"]


def recent_builds(env, limit=8):
    aid = app_id(env)
    r = call(env, "GET", f"/v1/builds?filter[app]={aid}&limit={limit}&sort=-version")
    return r.get("data", [])


def main():
    env = load_env()
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"

    if cmd in ("builds", "status"):
        builds = recent_builds(env)
        if not builds:
            print("No builds found yet (still processing the upload, or none uploaded).")
            return
        rows = [(b["attributes"].get("version"),
                 b["attributes"].get("processingState"),
                 b["attributes"].get("uploadedDate", "")) for b in builds]
        if cmd == "status":
            v, st, up = rows[0]
            print(f"build {v}: {st} (uploaded {up})")
        else:
            print(f"{'BUILD':<8}{'STATE':<14}UPLOADED")
            for v, st, up in rows:
                print(f"{v:<8}{st:<14}{up}")

    elif cmd == "groups":
        r = call(env, "GET", "/v1/betaGroups?limit=20")
        for g in r.get("data", []):
            a = g["attributes"]
            print(f'{g["id"]}  {a.get("name")}  internal={a.get("isInternalGroup")}')

    elif cmd == "comply":
        # Declare no non-exempt encryption on the latest build so it clears
        # export compliance. No-op (409) when the binary already self-declared
        # via INFOPLIST_KEY_ITSAppUsesNonExemptEncryption=NO — which is fine.
        builds = recent_builds(env)
        if not builds:
            print("no builds"); return
        b = builds[0]
        try:
            call(env, "PATCH", f"/v1/builds/{b['id']}",
                 {"data": {"type": "builds", "id": b["id"],
                           "attributes": {"usesNonExemptEncryption": False}}})
            print(f"✓ build {b['attributes'].get('version')} export-compliance set (no encryption).")
        except SystemExit as e:
            if "409" in str(e) or "already set" in str(e):
                print(f"✓ build {b['attributes'].get('version')} already export-compliant (declared in Info.plist).")
            else:
                raise

    elif cmd == "autoship":
        group = sys.argv[2] if len(sys.argv) > 2 else "1faa228e-0164-492c-b8c4-0d8b94f039bd"
        builds = recent_builds(env)
        processed = next((b for b in builds if b["attributes"].get("processingState") == "VALID"), None)
        if not processed:
            print("No VALID (processed) build yet — try again in a few minutes.")
            return
        bid, ver = processed["id"], processed["attributes"].get("version")
        call(env, "POST", f"/v1/betaGroups/{group}/relationships/builds",
             {"data": [{"type": "builds", "id": bid}]})
        print(f"✓ build {ver} added to beta group {group} — available to those testers.")

    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
