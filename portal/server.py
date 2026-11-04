#!/usr/bin/env python3
"""Local backend for the cache-controller portal (Python standard library only).

* Runs ONLY approved simulations: scenario and latency come from fixed tables below; the browser never supplies a
  command, a path or a file name.
* Each run compiles the real RTL + testbench with Icarus Verilog, runs it with vvp, and keeps the original VCD
  (results/portal_runs/<run_id>/wave.vcd) so it can be opened in GTKWave.
* Everything the viewer shows (waveforms, access trace, summary, cache lines, FSM) is derived from that VCD or from the
  RTL source text. Listens on 127.0.0.1 only.
"""
import csv
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vcd_index import SIGNALS, STATE_NAMES, MSTATE_NAMES, UNKNOWN, VcdIndex, build_accesses  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
# GUI-launched shells may lack Homebrew on PATH; approved tools are looked up from these places only
os.environ["PATH"] = os.pathsep.join(["/opt/homebrew/bin", "/usr/local/bin", os.environ.get("PATH", "")])
STATIC = Path(__file__).resolve().parent / "static"
RUNS = ROOT / "results" / "portal_runs"
HOST, PORT = "127.0.0.1", 8765
COMPILE_TIMEOUT, SIM_TIMEOUT = 120, 300

# ---- approved scenarios (test number as understood by sim/tb_cache_controller.v: 0 = whole suite)
SCENARIOS = {
    "full_suite":  dict(test=0,  nrand=300,  title="Full suite (tests 1-9 waveform)", desc="All 11 tests run; the waveform covers tests 1-9."),
    "cold_miss":   dict(test=1,  nrand=300,  title="Cold Miss", desc="First access to an empty cache: miss, block read, refill, correct data."),
    "repeated":    dict(test=2,  nrand=300,  title="Repeated Access", desc="Same address three times: one miss, then hits."),
    "same_block":  dict(test=3,  nrand=300,  title="Same-Block Accesses", desc="Four words of one 16-byte block: one miss, three hits."),
    "conflict":    dict(test=4,  nrand=300,  title="Direct-Mapped Conflict Miss", desc="Addresses 0x0 and 0x400 share a line and evict each other."),
    "lines":       dict(test=5,  nrand=300,  title="Different Cache Lines", desc="All 64 lines filled once, then read again: every second read hits."),
    "sequential":  dict(test=6,  nrand=300,  title="Sequential Access", desc="256 sequential words: one miss per 4-word block."),
    "reset":       dict(test=7,  nrand=300,  title="Reset", desc="Valid bits clear on reset; reset in the middle of a miss."),
    "latency":     dict(test=8,  nrand=300,  title="Memory Latency", desc="A miss waits for memory; a hit does not."),
    "handshake":   dict(test=9,  nrand=300,  title="Request Handshake", desc="Back-to-back requests held while the controller is busy."),
    "random":      dict(test=10, nrand=300,  title="Randomized (300 requests)", desc="Seeded random reads checked against reference models."),
    "random_large": dict(test=10, nrand=5000, title="Randomized (5000 requests, large VCD)", desc="Same test with 5000 requests; produces a ~20 MB waveform."),
    "boundary":    dict(test=11, nrand=300,  title="Boundary and Error Cases", desc="First/last address, misaligned, out-of-range and write requests."),
}
LATENCIES = [1, 2, 4, 8, 16]
RTL_FILES = ["rtl/address_decoder.v", "rtl/cache_data_ram.v", "rtl/cache_tag_ram.v", "rtl/cache_valid_ram.v",
             "rtl/main_memory_interface.v", "rtl/cache_controller.v"]
SIM_FILES = ["sim/main_memory_model.v", "sim/reference_memory.v", "sim/tb_cache_controller.v"]

RUN_ID_RE = re.compile(r"^run_\d{8}_\d{6}_\d+$")
run_lock = threading.Lock()
registry, index_cache, access_cache, counter = {}, {}, {}, [0]
index_lock = threading.Lock()
ACTIVE = ("queued", "running")


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


# ------------------------------------------------------------------ configuration read from the RTL source
def rtl_config():
    """Cache geometry and FSM encodings parsed from rtl/cache_controller.v (defaults of the top-level parameters)."""
    text = (ROOT / "rtl" / "cache_controller.v").read_text()

    def param(name):
        m = re.search(rf"parameter\s+{name}\s*=\s*(\d+)", text)
        return int(m.group(1)) if m else None
    a, c, b, mem = (param(n) for n in ("ADDR_WIDTH", "CACHE_BYTES", "BLOCK_BYTES", "MEM_BYTES"))
    lines = c // b
    off_w, idx_w = b.bit_length() - 1, lines.bit_length() - 1
    states = [dict(name=n, code=int(v)) for n, v in re.findall(r"\bS_(\w+)\s*=\s*3'd(\d+)", text)]
    states.sort(key=lambda s: s["code"])
    return dict(addr_width=a, cache_bytes=c, block_bytes=b, mem_bytes=mem, lines=lines, offset_bits=off_w, index_bits=idx_w,
                tag_bits=a - idx_w - off_w, block_bits=b * 8, words_per_block=b // 4, states=states,
                counters=len(re.findall(r"output reg\s+\[31:0\]\s+stat_", text)), mapping="Direct-mapped",
                source="rtl/cache_controller.v")


def state_names():
    cfg = rtl_config()
    names = [""] * (max(s["code"] for s in cfg["states"]) + 1)
    for s in cfg["states"]:
        names[s["code"]] = s["name"]
    return names


def synth_summary():
    """Real Yosys numbers from results/synthesis/ice40_stat.txt (written by scripts/run_synthesis.sh)."""
    f = ROOT / "results" / "synthesis" / "ice40_stat.txt"
    if not f.exists():
        return dict(available=False, hint="run: make synth")
    text = f.read_text()

    def n(pat):
        return sum(int(m.group(1)) for m in re.finditer(pat, text, re.M))
    return dict(available=True, source="results/synthesis/ice40_stat.txt",
                luts=n(r"^\s+(\d+)\s+SB_LUT4"), carry=n(r"^\s+(\d+)\s+SB_CARRY"),
                ffs=n(r"^\s+(\d+)\s+SB_DFF\w*"), brams=n(r"^\s+(\d+)\s+SB_RAM40_4K"))


# ------------------------------------------------------------------ runs
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


def save_meta(meta):
    d = RUNS / meta["run_id"]
    if d.is_dir():
        (d / "meta.json").write_text(json.dumps(meta, indent=1))


def new_run(scenario, lat):
    """Create the run record and folder (status 'queued'). Caller validated scenario and lat."""
    sc = SCENARIOS[scenario]
    with index_lock:
        counter[0] += 1
        run_id = f"run_{datetime.now():%Y%m%d_%H%M%S}_{counter[0]}"
    d = RUNS / run_id
    d.mkdir(parents=True)
    rel = d.relative_to(ROOT)
    exe, vcd = rel / "sim.vvp", rel / "wave.vcd"
    compile_cmd = ["iverilog", "-g2012", "-I", "sim", f"-Ptb_cache_controller.LAT={lat}",
                   f"-Ptb_cache_controller.NRAND={sc['nrand']}", "-o", str(exe), *RTL_FILES, *SIM_FILES]
    sim_cmd = ["vvp", "-n", str(exe), f"+test={sc['test']}", f"+vcd={vcd}"]
    meta = dict(run_id=run_id, scenario=scenario, title=sc["title"], latency=lat, nrand=sc["nrand"], test=sc["test"],
                created=now_iso(), compile_cmd=" ".join(compile_cmd), sim_cmd=" ".join(sim_cmd),
                design_hash=design_hash(), status="queued", phase="queued", compile_ok=False, sim_exit=None,
                compile_output="", tests=[], summary=None, vcd=None, _argv=[compile_cmd, sim_cmd])
    registry[run_id] = meta
    save_meta(meta)
    return meta


def execute_run(meta):
    """Compile and simulate. Serialized by a lock; updates meta['phase'] so the UI can show progress."""
    compile_cmd, sim_cmd = meta["_argv"]
    d = RUNS / meta["run_id"]
    with run_lock:
        try:
            meta.update(status="running", phase="compiling")
            c = subprocess.run(compile_cmd, cwd=ROOT, capture_output=True, text=True, timeout=COMPILE_TIMEOUT)
            meta["compile_output"] = (c.stdout + c.stderr)[-20000:]
            meta["compile_ok"] = c.returncode == 0
            if not meta["compile_ok"]:
                meta["status"] = "compile_error"
            else:
                meta["phase"] = "simulating"
                t0 = time.time()
                try:
                    r = subprocess.run(sim_cmd, cwd=ROOT, capture_output=True, text=True, timeout=SIM_TIMEOUT)
                    out, code = r.stdout + r.stderr, r.returncode
                except subprocess.TimeoutExpired as e:
                    out, code = (e.stdout or "") + "\nSIMULATION TIMEOUT", -1
                    if isinstance(out, bytes):
                        out = out.decode(errors="replace")
                meta["sim_seconds"] = round(time.time() - t0, 2)
                (d / "sim.log").write_text(out[:400000])
                meta["sim_exit"] = code
                meta["tests"], meta["summary"] = parse_log(out)
                meta["status"] = "pass" if code == 0 and meta["summary"] and "PASS" in meta["summary"] else "fail"
                vcd = d / "wave.vcd"
                if vcd.exists():
                    meta["vcd"] = dict(file="wave.vcd", bytes=vcd.stat().st_size, sha256=sha256(vcd))
        except Exception as exc:                      # pragma: no cover
            meta["status"] = "error"
            meta["compile_output"] += f"\nbackend error: {exc}"
        meta["phase"] = "done"
        meta["finished"] = now_iso()
        save_meta(meta)


def run_simulation(scenario, lat):
    """Synchronous run (used by scripts); the HTTP API starts the same work in a thread."""
    meta = new_run(scenario, lat)
    execute_run(meta)
    return public_meta(meta)


def public_meta(meta):
    return {k: v for k, v in meta.items() if not k.startswith("_")}


def load_registry():
    if RUNS.exists():
        for m in sorted(RUNS.glob("run_*/meta.json")):
            try:
                meta = json.loads(m.read_text())
                if not RUN_ID_RE.match(meta.get("run_id", "")):
                    continue
                if meta.get("status") in ACTIVE:
                    meta.update(status="error", phase="done", compile_output=meta.get("compile_output", "") + "\nrun interrupted (server restarted)")
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


def get_accesses(run_id):
    with index_lock:
        if run_id in access_cache:
            return access_cache[run_id]
    idx = get_index(run_id)
    if idx is None:
        return None
    cfg = rtl_config()
    res = build_accesses(idx, state_names(), cfg["index_bits"], cfg["offset_bits"])
    if res is not None:
        res["clock_ns"] = _clock_period_ns(idx)
        res["end_t"] = idx.end_time
    with index_lock:
        access_cache[run_id] = res
        while len(access_cache) > 3:
            access_cache.pop(next(iter(access_cache)))
    return res


def _clock_period_ns(idx):
    clk = idx.sig.get("tb_cache_controller.clk")
    if not clk:
        return None
    rises = [t for t, v in zip(clk["times"], clk["vals"]) if v == 1][:3]
    return (rises[1] - rises[0]) * idx.tick_ns if len(rises) > 1 else None


def delete_run(run_id):
    d = (RUNS / run_id).resolve()
    if RUNS.resolve() not in d.parents:
        raise ValueError("bad path")
    shutil.rmtree(d, ignore_errors=True)
    registry.pop(run_id, None)
    with index_lock:
        index_cache.pop(run_id, None)
        access_cache.pop(run_id, None)


def fmt_value(width, v):
    if v == UNKNOWN:
        return "x"
    if width == 1:
        return int(v)
    return format(v, "x")


def accesses_csv(res):
    buf = io.StringIO()
    cols = ["n", "cycle", "time_ns", "address", "tag", "index", "offset", "result", "latency_cycles", "fsm_transition", "fsm_path", "rdata"]
    w = csv.writer(buf)
    w.writerow(cols)
    tick = res["tick_ns"]
    for a in res["accesses"]:
        w.writerow([a["n"], a["cycle"], round(a["accept_t"] * tick, 3), "" if a["addr"] is None else f"0x{a['addr']:08x}",
                    "" if "tag" not in a else f"0x{a['tag']:06x}", a.get("index", ""), a.get("offset", ""), a["result"],
                    a["latency"] if a["latency"] is not None else "", a["transition"], " > ".join(a["states"]),
                    "" if a.get("rdata") is None else f"0x{a['rdata']:08x}"])
    return buf.getvalue()


# ------------------------------------------------------------------ HTTP
class Handler(BaseHTTPRequestHandler):
    server_version = "CachePortal/2.0"

    def log_message(self, fmt, *args):
        pass

    def _send(self, body, ctype, code=200, extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(json.dumps(obj).encode(), "application/json", code)

    def _err(self, code, msg):
        self._json(dict(error=msg), code)

    def _body(self, limit=1024):
        n = int(self.headers.get("Content-Length", "0"))
        if n > limit:
            raise OverflowError
        return json.loads(self.rfile.read(n) or b"{}")

    # ------------------------------------------------------------ POST
    def do_POST(self):
        path = urlparse(self.path).path
        try:
            req = self._body()
        except OverflowError:
            return self._err(413, "request too large")
        except Exception:
            return self._err(400, "invalid JSON")
        if path == "/api/run":
            scenario, lat = req.get("scenario"), req.get("latency")
            if not isinstance(scenario, str) or scenario not in SCENARIOS:
                return self._err(400, "unknown scenario")
            if not isinstance(lat, int) or isinstance(lat, bool) or lat not in LATENCIES:
                return self._err(400, f"latency must be one of {LATENCIES}")
            meta = new_run(scenario, lat)
            threading.Thread(target=execute_run, args=(meta,), daemon=True).start()
            return self._json(public_meta(meta))
        if path == "/api/run/delete":
            rid = req.get("run_id")
            if not isinstance(rid, str) or not RUN_ID_RE.match(rid) or rid not in registry:
                return self._err(404, "unknown run")
            if registry[rid]["status"] in ACTIVE:
                return self._err(409, "run is still in progress")
            delete_run(rid)
            return self._json(dict(deleted=rid))
        return self._err(404, "not found")

    # ------------------------------------------------------------ GET
    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        path = u.path
        if path == "/api/config":
            return self._json(rtl_config())
        if path == "/api/synth":
            return self._json(synth_summary())
        if path == "/api/scenarios":
            return self._json(dict(scenarios=[dict(id=k, title=v["title"], desc=v["desc"]) for k, v in SCENARIOS.items()],
                                   latencies=LATENCIES))
        if path == "/api/runs":
            for rid in [r for r in registry if not (RUNS / r).is_dir()]:
                registry.pop(rid, None)
                index_cache.pop(rid, None)
                access_cache.pop(rid, None)
            runs = sorted(registry.values(), key=lambda m: m["created"], reverse=True)
            return self._json([{k: m.get(k) for k in ("run_id", "scenario", "title", "latency", "created", "status", "phase")} for m in runs])
        m = re.match(r"^/api/run/([^/]+)/(meta|signals|wave|value|lines|vcd|log|accesses|export)$", path)
        if m:
            return self._run_api(m.group(1), m.group(2), q)
        return self._static(path)

    def _run_api(self, run_id, what, q):
        if not RUN_ID_RE.match(run_id) or run_id not in registry:
            return self._err(404, "unknown run")
        if not (RUNS / run_id).is_dir():
            registry.pop(run_id, None)
            index_cache.pop(run_id, None)
            access_cache.pop(run_id, None)
            return self._err(404, "run files were deleted; run the simulation again")
        meta = registry[run_id]
        if what == "meta":
            return self._json(public_meta(meta))
        if what == "log":
            p = RUNS / run_id / "sim.log"
            return self._send((p.read_text() if p.exists() else "").encode(), "text/plain; charset=utf-8")
        if what == "vcd":
            p = RUNS / run_id / "wave.vcd"
            if not p.exists():
                return self._err(404, "no VCD for this run")
            self.send_response(200)
            self.send_header("Content-Type", "text/x-vcd")
            self.send_header("Content-Length", str(p.stat().st_size))
            self.send_header("Content-Disposition", f'attachment; filename="{run_id}_{meta["scenario"]}_lat{meta["latency"]}.vcd"')
            self.end_headers()
            with open(p, "rb") as f:
                while True:
                    chunk = f.read(1 << 20)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
            return
        if meta["status"] in ACTIVE:
            return self._err(409, "run is still in progress")
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
                    mstates=MSTATE_NAMES, states=state_names(),
                    signals=[dict(path=p, label=l, group=g, fmt=f, width=idx.sig[p]["width"])
                             for (p, l, g, f) in SIGNALS if p in idx.sig]))
            if what in ("accesses", "export"):
                res = get_accesses(run_id)
                if res is None:
                    return self._err(404, "trace signals missing from this VCD")
                res = dict(res, tick_ns=idx.tick_ns, run_id=run_id)
                if what == "accesses":
                    return self._json(res)
                fmt = q.get("fmt", ["csv"])[0]
                if fmt == "json":
                    return self._send(json.dumps(res, indent=1).encode(), "application/json",
                                      extra={"Content-Disposition": f'attachment; filename="{run_id}_trace.json"'})
                if fmt == "csv":
                    return self._send(accesses_csv(res).encode(), "text/csv",
                                      extra={"Content-Disposition": f'attachment; filename="{run_id}_trace.csv"'})
                return self._err(400, "fmt must be csv or json")
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
                    out[p] = dict(init=fmt_value(wd, w["init"]), dense=w["dense"], count=w["count"],
                                  points=[[t, fmt_value(wd, v)] for t, v in w["points"]])
                return self._json(dict(t0=t0, t1=t1, signals=out))
            if what == "value":
                t = int(float(q["t"][0]))
                paths = [p for p in q.get("signals", [""])[0].split(",") if p in idx.sig]
                return self._json({p: fmt_value(idx.sig[p]["width"], idx.value_at(p, t)) for p in paths})
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
                 ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml"}.get(target.suffix)
        if ctype is None:
            return self._err(404, "not found")
        self._send(target.read_bytes(), ctype)


def main():
    import socket
    import webbrowser
    url = f"http://{HOST}:{PORT}/"
    no_open = "--no-open" in sys.argv
    RUNS.mkdir(parents=True, exist_ok=True)
    load_registry()
    try:
        srv = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError:
        try:
            socket.create_connection((HOST, PORT), timeout=1).close()
            print(f"The portal is already running at {url}", flush=True)
            if not no_open:
                webbrowser.open(url)
            return
        except OSError:
            sys.exit(f"Port {PORT} is in use by another program. Stop it (lsof -i :{PORT}) and try again.")
    print(f"Cache portal running at {url}\nLeave this window open while you use it. Press Ctrl-C to stop.", flush=True)
    if not no_open:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
