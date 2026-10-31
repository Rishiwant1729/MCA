#!/usr/bin/env python3
"""Local backend for the cache-controller portal (Python standard library only).

* Runs ONLY approved simulations: scenario and latency come from fixed tables below; the browser
  never supplies a command, a path or a file name.
* Each run compiles the real RTL + testbench with Icarus Verilog, runs it with vvp, and keeps the
  original VCD (results/portal_runs/<run_id>/wave.vcd) so it can be opened in GTKWave.
* The waveform viewer only displays data read from that VCD.
Listens on 127.0.0.1 only.
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vcd_index import SIGNALS, STATE_NAMES, MSTATE_NAMES, UNKNOWN, VcdIndex  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
# GUI-launched shells may lack Homebrew on PATH; the approved tools are looked up from these places only
os.environ["PATH"] = os.pathsep.join(["/opt/homebrew/bin", "/usr/local/bin", os.environ.get("PATH", "")])
STATIC = Path(__file__).resolve().parent / "static"
RUNS = ROOT / "results" / "portal_runs"
HOST, PORT = "127.0.0.1", 8765
COMPILE_TIMEOUT, SIM_TIMEOUT = 120, 300

# ---- approved scenarios (test number as understood by sim/tb_cache_controller.v: 0 = whole suite)
SCENARIOS = {
    "full_suite":  dict(test=0,  nrand=300,  title="Full suite (T1-T9 waveform)", desc="All 11 tests; waveform covers T1-T9."),
    "cold_miss":   dict(test=1,  nrand=300,  title="T1 Cold miss", desc="Invalid line -> miss, block read, refill, correct data."),
    "repeated":    dict(test=2,  nrand=300,  title="T2 Repeated access", desc="Miss then hits on the same address."),
    "same_block":  dict(test=3,  nrand=300,  title="T3 Same-block accesses", desc="Four words of one block: 1 miss + 3 hits."),
    "conflict":    dict(test=4,  nrand=300,  title="T4 Direct-mapped conflict", desc="Addresses 0 and 1024 evict each other."),
    "lines":       dict(test=5,  nrand=300,  title="T5 Different cache lines", desc="All 64 lines filled, then all hit."),
    "sequential":  dict(test=6,  nrand=300,  title="T6 Sequential access", desc="256 sequential words: 1 miss per block."),
    "reset":       dict(test=7,  nrand=300,  title="T7 Reset", desc="Valid bits clear; reset during a miss."),
    "latency":     dict(test=8,  nrand=300,  title="T8 Memory latency", desc="Miss waits LAT+7 cycles; hit takes 2."),
    "handshake":   dict(test=9,  nrand=300,  title="T9 Request handshake", desc="Back-to-back requests held while busy."),
    "random":      dict(test=10, nrand=300,  title="T10 Randomized (300 requests)", desc="Seeded random reads, all checked."),
    "random_large": dict(test=10, nrand=5000, title="T10 Randomized (5000 requests, large VCD)", desc="Same test with 5000 requests; large waveform."),
    "boundary":    dict(test=11, nrand=300,  title="T11 Boundary and errors", desc="First/last address, misaligned, out of range."),
}
LATENCIES = [1, 2, 4, 8, 16]
RTL_FILES = ["rtl/address_decoder.v", "rtl/cache_data_ram.v", "rtl/cache_tag_ram.v", "rtl/cache_valid_ram.v",
             "rtl/main_memory_interface.v", "rtl/cache_controller.v"]
SIM_FILES = ["sim/main_memory_model.v", "sim/reference_memory.v", "sim/tb_cache_controller.v"]

RUN_ID_RE = re.compile(r"^run_\d{8}_\d{6}_\d+$")
run_lock = threading.Lock()
registry, index_cache, counter = {}, {}, [0]
index_lock = threading.Lock()


def now_iso():
    return datetime.now().astimezone().isoformat(timespec="seconds")


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def design_hash():
    h = hashlib.sha256()
    for rel in RTL_FILES + SIM_FILES:
        h.update((ROOT / rel).read_bytes())
    return h.hexdigest()[:12]


def parse_log(text):
    tests, cur = [], None
    for line in text.splitlines():
        m = re.match(r"^\[T(\d+)\] (\S+)", line)
        if m:
            cur = dict(n=int(m.group(1)), name=m.group(2), expected="", actual="", result="", failures=[])
            tests.append(cur)
        elif cur is not None:
            s = line.strip()
            if s.startswith("expected:"):
                cur["expected"] = s[9:].strip()
            elif s.startswith("actual"):
                cur["actual"] = s.split(":", 1)[1].strip()
            elif s.startswith("result"):
                cur["result"] = s.split(":", 1)[1].strip()
            elif s.startswith("FAIL["):
                cur["failures"].append(s)
    m = re.search(r"^SUMMARY: .*$", text, re.M)
    return tests, (m.group(0) if m else None)


def run_simulation(scenario, lat):
    sc = SCENARIOS[scenario]                       # validated by caller
    with run_lock:
        counter[0] += 1
        run_id = f"run_{datetime.now():%Y%m%d_%H%M%S}_{counter[0]}"
        d = RUNS / run_id
        d.mkdir(parents=True)
        rel = d.relative_to(ROOT)
        exe, vcd, logp = rel / "sim.vvp", rel / "wave.vcd", d / "sim.log"
        compile_cmd = ["iverilog", "-g2012", "-I", "sim", f"-Ptb_cache_controller.LAT={lat}",
                       f"-Ptb_cache_controller.NRAND={sc['nrand']}", "-o", str(exe), *RTL_FILES, *SIM_FILES]
        sim_cmd = ["vvp", "-n", str(exe), f"+test={sc['test']}", f"+vcd={vcd}"]
        meta = dict(run_id=run_id, scenario=scenario, title=sc["title"], latency=lat, nrand=sc["nrand"],
                    created=now_iso(), compile_cmd=" ".join(compile_cmd), sim_cmd=" ".join(sim_cmd),
                    design_hash=design_hash(), status="error", compile_ok=False, sim_exit=None,
                    compile_output="", tests=[], summary=None, vcd=None)
        try:
            c = subprocess.run(compile_cmd, cwd=ROOT, capture_output=True, text=True, timeout=COMPILE_TIMEOUT)
            meta["compile_output"] = (c.stdout + c.stderr)[-20000:]
            meta["compile_ok"] = c.returncode == 0
            if not meta["compile_ok"]:
                meta["status"] = "compile_error"
            else:
                t0 = time.time()
                try:
                    r = subprocess.run(sim_cmd, cwd=ROOT, capture_output=True, text=True, timeout=SIM_TIMEOUT)
                    out, code = r.stdout + r.stderr, r.returncode
                except subprocess.TimeoutExpired as e:
                    out, code = (e.stdout or "") + "\nSIMULATION TIMEOUT", -1
                    if isinstance(out, bytes):
                        out = out.decode(errors="replace")
                meta["sim_seconds"] = round(time.time() - t0, 2)
                logp.write_text(out[:400000])
                meta["sim_exit"] = code
                meta["tests"], meta["summary"] = parse_log(out)
                meta["status"] = "pass" if code == 0 and meta["summary"] and "PASS" in meta["summary"] else "fail"
                if (ROOT / vcd).exists():
                    meta["vcd"] = dict(file="wave.vcd", bytes=(ROOT / vcd).stat().st_size, sha256=sha256(ROOT / vcd))
        except Exception as exc:                      # pragma: no cover
            meta["compile_output"] += f"\nbackend error: {exc}"
        (d / "meta.json").write_text(json.dumps(meta, indent=1))
        registry[run_id] = meta
        return meta


def load_registry():
    if RUNS.exists():
        for m in sorted(RUNS.glob("run_*/meta.json")):
            try:
                meta = json.loads(m.read_text())
                if RUN_ID_RE.match(meta.get("run_id", "")):
                    registry[meta["run_id"]] = meta
            except Exception:
                pass


def get_index(run_id):
    with index_lock:
        if run_id in index_cache:
            return index_cache[run_id]
    vcd = RUNS / run_id / "wave.vcd"
    if not vcd.exists():
        return None
    idx = VcdIndex(str(vcd))
    with index_lock:
        index_cache[run_id] = idx
        while len(index_cache) > 3:
            index_cache.pop(next(iter(index_cache)))
    return idx


def fmt_value(sig_fmt, width, v):
    if v == UNKNOWN:
        return "x"
    if width == 1:
        return int(v)
    return format(v, "x")


class Handler(BaseHTTPRequestHandler):
    server_version = "CachePortal/1.0"

    def log_message(self, fmt, *args):
        pass

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _err(self, code, msg):
        self._json(dict(error=msg), code)

    # ------------------------------------------------------------ POST
    def do_POST(self):
        if urlparse(self.path).path != "/api/run":
            return self._err(404, "not found")
        try:
            n = int(self.headers.get("Content-Length", "0"))
            if n > 1024:
                return self._err(413, "request too large")
            req = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return self._err(400, "invalid JSON")
        scenario, lat = req.get("scenario"), req.get("latency")
        if not isinstance(scenario, str) or scenario not in SCENARIOS:
            return self._err(400, "unknown scenario")
        if not isinstance(lat, int) or isinstance(lat, bool) or lat not in LATENCIES:
            return self._err(400, f"latency must be one of {LATENCIES}")
        self._json(run_simulation(scenario, lat))

    # ------------------------------------------------------------ GET
    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        path = u.path
        if path == "/api/scenarios":
            return self._json(dict(scenarios=[dict(id=k, title=v["title"], desc=v["desc"]) for k, v in SCENARIOS.items()],
                                   latencies=LATENCIES))
        if path == "/api/runs":
            runs = sorted(registry.values(), key=lambda m: m["created"], reverse=True)
            return self._json([{k: m[k] for k in ("run_id", "scenario", "title", "latency", "created", "status")} for m in runs])
        m = re.match(r"^/api/run/([^/]+)/(meta|signals|wave|value|lines|vcd|log)$", path)
        if m:
            return self._run_api(m.group(1), m.group(2), q)
        return self._static(path)

    def _run_api(self, run_id, what, q):
        if not RUN_ID_RE.match(run_id) or run_id not in registry:
            return self._err(404, "unknown run")
        meta = registry[run_id]
        if what == "meta":
            return self._json(meta)
        if what == "log":
            p = RUNS / run_id / "sim.log"
            body = (p.read_text() if p.exists() else "").encode()
            self.send_response(200); self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
            return
        if what == "vcd":
            p = RUNS / run_id / "wave.vcd"
            if not p.exists():
                return self._err(404, "no VCD for this run")
            size = p.stat().st_size
            self.send_response(200)
            self.send_header("Content-Type", "text/x-vcd")
            self.send_header("Content-Length", str(size))
            self.send_header("Content-Disposition", f'attachment; filename="{run_id}_{meta["scenario"]}_lat{meta["latency"]}.vcd"')
            self.end_headers()
            with open(p, "rb") as f:
                while True:
                    chunk = f.read(1 << 20)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
            return
        try:
            idx = get_index(run_id)
        except Exception as exc:
            return self._err(500, f"VCD parse failed: {exc}")
        if idx is None:
            return self._err(404, "no VCD for this run")
        try:
            if what == "signals":
                return self._json(dict(
                    timescale=idx.timescale, tick_ns=idx.tick_ns, end_time=idx.end_time, missing=idx.missing,
                    states=STATE_NAMES, mstates=MSTATE_NAMES,
                    signals=[dict(path=p, label=l, group=g, fmt=f, width=idx.sig[p]["width"])
                             for (p, l, g, f) in SIGNALS if p in idx.sig]))
            if what == "wave":
                paths = [p for p in q.get("signals", [""])[0].split(",") if p in idx.sig]
                t0, t1 = int(float(q["t0"][0])), int(float(q["t1"][0]))
                px = max(50, min(int(q.get("px", ["1000"])[0]), 4000))
                if t1 <= t0:
                    return self._err(400, "empty window")
                out = {}
                for p in paths:
                    w = idx.window(p, t0, t1, px)
                    wd = idx.sig[p]["width"]
                    out[p] = dict(init=fmt_value(None, wd, w["init"]), dense=w["dense"], count=w["count"],
                                  points=[[t, fmt_value(None, wd, v)] for t, v in w["points"]])
                return self._json(dict(t0=t0, t1=t1, signals=out))
            if what == "value":
                t = int(float(q["t"][0]))
                paths = [p for p in q.get("signals", [""])[0].split(",") if p in idx.sig]
                return self._json({p: fmt_value(None, idx.sig[p]["width"], idx.value_at(p, t)) for p in paths})
            if what == "lines":
                t = int(float(q["t"][0]))
                valid, tag, data, recent, recent_t = idx.cache_at(t)
                cur = idx.value_at("tb_cache_controller.dut.q_index", t)
                return self._json(dict(
                    t=t, recent=recent, recent_t=recent_t, current_index=None if cur == UNKNOWN else cur,
                    lines=[dict(i=i, valid=valid[i], tag=format(tag[i], "x") if valid[i] else "",
                                data=format(data[i], "032x") if valid[i] else "") for i in range(64)]))
        except KeyError as exc:
            return self._err(400, f"missing parameter {exc}")
        except ValueError:
            return self._err(400, "bad parameter")
        return self._err(404, "not found")

    def _static(self, path):
        if path in ("", "/"):
            path = "/index.html"
        target = (STATIC / path.lstrip("/")).resolve()
        if STATIC.resolve() not in target.parents or not target.is_file():
            return self._err(404, "not found")
        ctype = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
                 ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml"}.get(target.suffix, "application/octet-stream")
        body = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def main():
    RUNS.mkdir(parents=True, exist_ok=True)
    load_registry()
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Cache portal: http://{HOST}:{PORT}/   (Ctrl-C to stop)", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
