#!/usr/bin/env python3
"""Bootstrap + admin driver for the ssh_host_cert e2e (ANS-10).

Drives the backend over its public REST surface (OIDC is off) plus one tRPC
mutation for the fleet token. Reuses nothing from the role — it only sets up CAs,
a fleet token, principals, host maps and user certs, and later applies per-host
blocks so the verify stage can prove revocation narrowing.

Subcommands:
  bootstrap --host <fqdn:algo> ...   create CAs/token/principal/maps/user certs
  block     --host <fqdn> --user <alice|mallory>
"""
import argparse
import json
import os
import subprocess
import sys
import urllib.request

ART = os.path.dirname(os.path.abspath(__file__)) + "/_artifacts"


def http(base, path, method="GET", body=None, ctype="application/json"):
    data = None
    if body is not None:
        data = json.dumps(body).encode()
    req = urllib.request.Request(base + path, data=data, method=method,
                                 headers={"Content-Type": ctype})
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read().decode()
    return json.loads(raw) if raw else {}


def rest(base, path, method="GET", body=None):
    return http(base, "/api/v1" + path, method, body)


def mint_token(base, host_ca_id, user_ca_id):
    """tRPC ssh.token.mint (no transformer -> raw input; try batched then plain)."""
    inp = {"name": "e2e-fleet", "hostCaId": host_ca_id, "userCaId": user_ca_id,
           "opSet": ["sign-host", "get-principals", "register-host-pubkey"]}
    # batched form
    try:
        out = http(base, "/trpc/ssh.token.mint?batch=1", "POST", {"0": inp})
        if isinstance(out, list):
            return out[0]["result"]["data"]["token"]
    except Exception as e:  # noqa: BLE001
        sys.stderr.write("batched mint failed: %s\n" % e)
    # plain form
    out = http(base, "/trpc/ssh.token.mint", "POST", inp)
    return out["result"]["data"]["token"]


def keygen(path, algo):
    if os.path.exists(path):
        os.remove(path)
    if os.path.exists(path + ".pub"):
        os.remove(path + ".pub")
    args = ["ssh-keygen", "-q", "-N", "", "-f", path]
    if algo == "ecdsa":
        args += ["-t", "ecdsa", "-b", "256"]
    else:
        args += ["-t", "ed25519"]
    subprocess.check_call(args)
    with open(path + ".pub") as fh:
        return fh.read().strip()


def bootstrap(base, hosts):
    os.makedirs(ART, exist_ok=True)
    user_ca = rest(base, "/ssh/cas", "POST", {"caType": "user", "label": "e2e-user"})
    host_ca = rest(base, "/ssh/cas", "POST", {"caType": "host", "label": "e2e-host"})
    token = mint_token(base, host_ca["id"], user_ca["id"])
    principal = rest(base, "/ssh/principals", "POST",
                     {"name": "developers", "description": "e2e"})

    state = {"userCaId": user_ca["id"], "hostCaId": host_ca["id"],
             "token": token, "principalId": principal["id"], "hosts": {}}

    # Pre-register each host with a throwaway key of the RIGHT algorithm, so the
    # stored hostKeyAlgorithm (and thus the rendered drop-in) is correct; the
    # role's sign-host later swaps in the container's real host key (same algo).
    for fqdn, algo in hosts:
        pub = keygen(ART + "/_throwaway_" + fqdn, algo)
        h = rest(base, "/ssh/hosts", "POST",
                 {"fqdn": fqdn, "addresses": [], "opensshHostPubkey": pub})
        rest(base, "/ssh/principals/map", "POST",
             {"hostId": h["id"], "principalId": principal["id"], "localAccount": "deploy"})
        state["hosts"][fqdn] = {"hostId": h["id"]}

    # Two user identities + certs: alice (principal developers -> allowed),
    # mallory (principal intruder -> RBAC-denied).
    for name, principals in (("alice", ["developers"]), ("mallory", ["intruder"])):
        pub = keygen(ART + "/" + name + "_id", "ed25519")
        ident = rest(base, "/ssh/identities", "POST", {"subject": name + "@e2e"})
        issued = rest(base, "/ssh/users/issue", "POST", {
            "identityId": ident["id"], "caId": user_ca["id"],
            "sshPublicKey": pub, "principals": principals})
        cert = issued["cert"]["certOpenssh"] if "cert" in issued else issued["certOpenssh"]
        with open(ART + "/" + name + "_id-cert.pub", "w") as fh:
            fh.write(cert.rstrip("\n") + "\n")
        state[name] = {"identityId": ident["id"]}

    # known_hosts @cert-authority line so the client trusts host certs (no TOFU).
    # This endpoint returns text/plain, so read it raw (not JSON).
    with urllib.request.urlopen(base + "/ssh/cert-authority?pattern=*", timeout=30) as r:
        ca_text = r.read().decode()
    with open(ART + "/known_hosts", "w") as fh:
        fh.write(ca_text if ca_text.endswith("\n") else ca_text + "\n")

    with open(ART + "/state.json", "w") as fh:
        json.dump(state, fh, indent=2)
    print(json.dumps({"token": token, "userCaId": user_ca["id"],
                      "hostCaId": host_ca["id"]}))


def block(base, fqdn, user):
    with open(ART + "/state.json") as fh:
        state = json.load(fh)
    host_id = state["hosts"][fqdn]["hostId"]
    ident_id = state[user]["identityId"]
    rest(base, "/ssh/blocks", "POST", {"hostId": host_id, "identityId": ident_id})
    print("blocked %s on %s" % (user, fqdn))


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("bootstrap")
    b.add_argument("--base", required=True)
    b.add_argument("--host", action="append", required=True,
                   help="fqdn:algo (algo = ed25519|ecdsa)")
    k = sub.add_parser("block")
    k.add_argument("--base", required=True)
    k.add_argument("--host", required=True)
    k.add_argument("--user", required=True)
    a = ap.parse_args()
    if a.cmd == "bootstrap":
        hosts = []
        for h in a.host:
            fqdn, algo = h.rsplit(":", 1)
            hosts.append((fqdn, algo))
        bootstrap(a.base, hosts)
    elif a.cmd == "block":
        block(a.base, a.host, a.user)


if __name__ == "__main__":
    main()
