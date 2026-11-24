#!/usr/bin/env python3
"""Verify that what the portal displays comes from real simulation runs, and that the backend is locked down.

Checks (all must pass):
  1. A run launched through the portal's approved path produces a VCD written by Icarus Verilog
     (header + sha256 match the run metadata).
  2. The portal's indexed signal values equal values obtained by an independent re-parse of the VCD
     (different algorithm) at many random times.
  3. Counters in the VCD (stat_requests/hits/misses/mem_reads, and resp_valid pulses) equal the numbers the
     simulator itself printed in its log.
  4. Cache contents reconstructed from the dumped signals match the memory image for every valid line.
  5. The VCD download is byte-identical to the file on disk.
  6. Backend rejects unapproved scenarios/latencies, malformed JSON, path traversal and unknown run ids.
Usage:  python3 extras/portal/verify_portal.py
"""
import bisect
import hashlib
import json
import random
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "extras" / "portal"))
import server  # noqa: E402
from vcd_index import SIGNALS, VcdIndex, UNKNOWN  # noqa: E402

fails = []


def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        fails.append(msg)


def naive_parse(path):
    """Independent VCD reader: stores every change of every var, keyed by hierarchical name."""
    names, scope, ids = {}, [], {}
    changes = {}
    t = 0
    in_defs = True
    for line in open(path, errors="replace"):
        s = line.strip()
        if in_defs:
            if s.startswith("$scope"):
                scope.append(s.split()[2])
            elif s.startswith("$upscope"):
                scope.pop()
            elif s.startswith("$var"):
                parts = s.split()
                ids.setdefault(parts[3], []).append(".".join(scope + [parts[4]]))
            elif s.startswith("$enddefinitions"):
                in_defs = False
            continue
        if s.startswith("#"):
            t = int(s[1:])
        elif s.startswith("b"):
            val, ident = s[1:].split()
            for n in ids.get(ident, []):
                changes.setdefault(n, []).append((t, UNKNOWN if re.search("[xz]", val) else int(val, 2)))
        elif s and s[0] in "01xz":
            for n in ids.get(s[1:], []):
                changes.setdefault(n, []).append((t, UNKNOWN if s[0] in "xz" else int(s[0])))
    return changes


def naive_value(changes, name, t):
    best = UNKNOWN
    for ct, v in changes.get(name, []):
        if ct <= t:
            best = v
        else:
            break
    return best


def independent_accesses(ref, tick_ns):
    """Second implementation of access detection using the naive re-parse (different code path)."""
    T = "tb_cache_controller."
    rises = [t for i, (t, v) in enumerate(ref[T + "clk"]) if v == 1 and (i == 0 or ref[T + "clk"][i - 1][1] != 1)]
    pv = lambda n, t: naive_value(ref, T + n, t - 1)
    out = []
    for k, t in enumerate(rises):
        if pv("rst_n", t) != 1 or not (pv("req_valid", t) == 1 and pv("req_ready", t) == 1):
            continue
        addr = pv("req_addr", t)
        res = "incomplete"
        for tj in rises[k + 1:k + 400]:
            if pv("resp_valid", tj) == 1:
                res = "error" if pv("resp_err", tj) == 1 else ("hit" if pv("resp_hit", tj) == 1 else "miss")
                break
        out.append((t, addr, res))
    return out


def init_byte(i):
    return ((i * 167) + (i >> 8) * 13 + 0x5A) & 0xFF


def verify_run(scenario, lat):
    print(f"\n== {scenario} LAT={lat}")
    meta = server.run_simulation(scenario, lat)
    check(meta["compile_ok"] and meta["status"] == "pass", f"run passed (status={meta['status']})")
    vcd = ROOT / "results" / "portal_runs" / meta["run_id"] / "wave.vcd"
    check(vcd.exists(), "VCD file exists")
    head = vcd.read_text(errors="replace")[:600]
    check("Icarus Verilog" in head, "VCD header written by Icarus Verilog")
    check(hashlib.sha256(vcd.read_bytes()).hexdigest() == meta["vcd"]["sha256"], "sha256 matches run metadata")

    idx = VcdIndex(str(vcd))
    check(not idx.missing, f"all displayed signals present in the VCD (missing: {idx.missing})")
    ref = naive_parse(vcd)
    rng = random.Random(7)
    bad = 0
    for _ in range(400):
        t = rng.randrange(0, idx.end_time + 1)
        for p, *_r in SIGNALS:
            if idx.value_at(p, t) != naive_value(ref, p, t):
                bad += 1
    check(bad == 0, f"indexed values == independent re-parse at 400 random times x {len(SIGNALS)} signals ({bad} mismatches)")
    n_changes = sum(len(idx.sig[p]["times"]) for p in idx.sig)
    check(all(len(idx.sig[p]["times"]) == len([1 for c in ref.get(p, [])]) for p in idx.sig), f"change counts identical ({n_changes} changes)")

    # simulator-printed numbers vs. the VCD
    log = (ROOT / "results" / "portal_runs" / meta["run_id"] / "sim.log").read_text()
    last = [m for m in re.finditer(r"requests=(\d+) hits=(\d+) misses=(\d+) mem_reads=(\d+)", log)][-1]
    req, hit, miss, mrd = map(int, last.groups())
    T = "tb_cache_controller."
    end = idx.end_time
    got = tuple(idx.value_at(T + n, end) for n in ("s_req", "s_hit", "s_miss", "s_mrd"))
    if scenario == "full_suite":
        # the dump stops before T10, so compare with the counters after T9 instead
        # $dumpoff makes the VCD record x for every signal at that instant; use the last known time
        end = idx.end_time - 1          # last instant before the x-dump
        check(idx.value_at(T + "s_req", idx.end_time) == UNKNOWN, "VCD shows x after $dumpoff (dump intentionally stopped before T10)")
        nine = [m for m in re.finditer(r"\[T9\].*?requests=(\d+) hits=(\d+) misses=(\d+) mem_reads=(\d+)", log, re.S)][0]
        req, hit, miss, mrd = map(int, nine.groups())
        got = tuple(idx.value_at(T + n, end) for n in ("s_req", "s_hit", "s_miss", "s_mrd"))
        check(got == (req, hit, miss, mrd), f"VCD counters {got} == simulator's T9 log {(req, hit, miss, mrd)}")
    else:
        check(got == (req, hit, miss, mrd), f"VCD counters {got} == simulator log {(req, hit, miss, mrd)}")
        pulses = idx.pulses_after_last_reset(T + "resp_valid")
        check(pulses == req, f"resp_valid pulses since last reset ({pulses}) == logged requests ({req})")

    valid, tag, data, recent, _ = idx.cache_at(end)
    wrong = 0
    for i in range(64):
        if valid[i]:
            base = (tag[i] << 10) | (i << 4)
            exp = sum(init_byte(base + b) << (8 * b) for b in range(16))
            wrong += exp != data[i]
    check(wrong == 0, f"reconstructed cache lines ({sum(valid)} valid) match the memory image ({wrong} wrong)")
    # ---- access trace (rebuilt from the VCD) vs. independent derivation and the simulator's own numbers
    tr = server.get_accesses(meta["run_id"])
    check(tr is not None, "access trace could be rebuilt from the VCD")
    if tr is not None:
        acc, summ = tr["accesses"], tr["summary"]
        if scenario in ("cold_miss", "conflict", "sequential", "same_block", "boundary", "repeated", "lines"):
            ind = independent_accesses(ref, idx.tick_ns)
            check(len(ind) == len(acc), f"independent re-derivation finds the same number of accepted requests ({len(ind)} vs {len(acc)})")
            diff = sum(1 for a, b in zip(ind, acc) if (a[0], a[1], a[2]) != (b["accept_t"], b["addr"], b["result"]))
            check(diff == 0, f"each access has the same time, address and hit/miss/error result in both derivations ({diff} differ)")
            last = [m for m in re.finditer(r"requests=(\d+) hits=(\d+) misses=(\d+) mem_reads=(\d+)", log)][-1]
            lr, lh, lm, lmr = map(int, last.groups())
            check((summ["total"], summ["hits"], summ["misses"], summ["mem_transactions"]) == (lr, lh, lm, lmr),
                  f"trace summary {(summ['total'], summ['hits'], summ['misses'], summ['mem_transactions'])} == simulator log {(lr, lh, lm, lmr)}")
        hit_ok = all(a["latency"] == 2 for a in acc if a["result"] == "hit")
        miss_ok = all(a["latency"] == lat + 7 for a in acc if a["result"] == "miss")
        err_ok = all(a["latency"] == 1 for a in acc if a["result"] == "error")
        check(hit_ok and miss_ok and err_ok, f"latencies match the design timing (hit 2, miss {lat + 7}, error 1)")
        check(all(a["states"][0] == "LOOKUP" for a in acc if a["result"] in ("hit", "miss")), "every hit/miss starts its FSM path in LOOKUP")
        check(all(a["states"][-1] == "COMPLETE" for a in acc if a["result"] in ("hit", "miss", "error")), "every completed access ends its FSM path in COMPLETE")
        check(all((a["transition"] == "LOOKUP → COMPLETE") == (a["result"] == "hit") for a in acc if a["result"] in ("hit", "miss")), "hit <=> LOOKUP → COMPLETE")
        check(summ["mem_transactions"] >= summ["misses"] - 0, "memory transactions cover every miss")
        csv_text = server.accesses_csv(dict(tr, tick_ns=idx.tick_ns))
        check(len(csv_text.strip().splitlines()) == len(acc) + 1, "CSV export has one row per access")
    return meta, idx


def http_checks(meta):
    print("\n== HTTP backend")
    srv = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}"

    def req(path, data=None, method=None):
        r = urllib.request.Request(base + path, data=data, method=method)
        try:
            with urllib.request.urlopen(r, timeout=30) as resp:
                return resp.status, resp.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()

    rid = meta["run_id"]
    code, body = req(f"/api/run/{rid}/vcd")
    disk = (ROOT / "results" / "portal_runs" / rid / "wave.vcd").read_bytes()
    check(code == 200 and body == disk, "VCD download is byte-identical to the file on disk")
    for payload, why in [(b'{"scenario":"cold_miss; rm -rf /","latency":4}', "shell-injection scenario"),
                         (b'{"scenario":"cold_miss","latency":3}', "unapproved latency"),
                         (b'{"scenario":"../../etc/passwd","latency":4}', "path-like scenario"),
                         (b'{"scenario":"cold_miss","latency":"4"}', "latency as string"),
                         (b"not json", "malformed JSON"),
                         (b"x" * 5000, "oversized body")]:
        code, _ = req("/api/run", payload, "POST")
        check(code in (400, 413), f"rejected: {why} (HTTP {code})")
    for path, why in [("/api/run/..%2F..%2Fetc/meta", "run id traversal"), ("/api/run/run_20990101_000000_9/vcd", "unknown run id"),
                      ("/..%2Frtl/cache_controller.v", "static path traversal"), ("/../rtl/cache_controller.v", "static dot-dot")]:
        code, _ = req(path)
        check(code in (400, 404), f"rejected: {why} (HTTP {code})")
    code, body = req("/api/config")
    cfg = json.loads(body)
    check(code == 200 and cfg["lines"] == 64 and cfg["tag_bits"] == 22 and [s["name"] for s in cfg["states"]][:3] == ["IDLE", "LOOKUP", "MISS_REQ"],
          "GET /api/config reports the geometry and FSM encodings parsed from the RTL")
    code, body = req(f"/api/run/{rid}/export?fmt=csv")
    check(code == 200 and body.decode().startswith("n,cycle,time_ns"), "CSV export downloads for the selected run")
    code, body = req(f"/api/run/{rid}/export?fmt=json")
    check(code == 200 and json.loads(body)["run_id"] == rid, "JSON export belongs to the selected run")
    code, _ = req(f"/api/run/{rid}/export?fmt=exe")
    check(code == 400, "unknown export format rejected")
    # async run through the HTTP API, then delete it
    code, body = req("/api/run", b'{"scenario":"cold_miss","latency":2}', "POST")
    new = json.loads(body)
    check(code == 200 and new["status"] in ("queued", "running"), "POST /api/run returns immediately with a running record")
    for _ in range(100):
        code, body = req(f"/api/run/{new['run_id']}/meta")
        if json.loads(body)["status"] not in ("queued", "running"):
            break
        time.sleep(0.2)
    check(json.loads(body)["status"] == "pass", "async run finishes and passes")
    code, _ = req("/api/run/delete", json.dumps(dict(run_id=new["run_id"])).encode(), "POST")
    check(code == 200 and not (ROOT / "results" / "portal_runs" / new["run_id"]).exists(), "delete removes the run folder")
    code, _ = req("/api/run/delete", b'{"run_id":"../../etc"}', "POST")
    check(code == 404, "delete rejects a path-like run id")
    srv.shutdown()


def main():
    server.RUNS.mkdir(parents=True, exist_ok=True)
    meta = None
    for sc, lat in [("cold_miss", 4), ("conflict", 8), ("sequential", 2), ("boundary", 4), ("reset", 2), ("random", 4), ("full_suite", 4)]:
        meta, _ = verify_run(sc, lat)
    http_checks(meta)
    print("\nRESULT:", "ALL CHECKS PASSED" if not fails else f"{len(fails)} CHECK(S) FAILED")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
