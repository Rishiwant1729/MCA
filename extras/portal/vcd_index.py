"""Indexed access to a real VCD file produced by Icarus Verilog.

Only the signals listed in SIGNALS are kept in memory (the VCD file itself is never modified),
so large dumps stay cheap. Values are exactly what the simulator wrote; nothing is generated.
"""
import bisect
import re

# (hierarchical path, label, group, format).  Formats: bit, hex, dec, state, mstate
SIGNALS = [
    ("tb_cache_controller.clk",        "clk",              "Clock & reset",     "bit"),
    ("tb_cache_controller.rst_n",      "rst_n",            "Clock & reset",     "bit"),
    ("tb_cache_controller.req_valid",  "req_valid",        "CPU request",       "bit"),
    ("tb_cache_controller.req_ready",  "req_ready",        "CPU request",       "bit"),
    ("tb_cache_controller.req_addr",   "req_addr",         "CPU request",       "hex"),
    ("tb_cache_controller.drv_we",     "req_we",           "CPU request",       "bit"),
    ("tb_cache_controller.resp_valid", "resp_valid",       "CPU response",      "bit"),
    ("tb_cache_controller.resp_rdata", "resp_rdata",       "CPU response",      "hex"),
    ("tb_cache_controller.resp_hit",   "resp_hit (hit/miss)", "CPU response",   "bit"),
    ("tb_cache_controller.resp_err",   "resp_err",         "CPU response",      "bit"),
    ("tb_cache_controller.dut.state",  "FSM state",        "Cache controller",  "state"),
    ("tb_cache_controller.dut.hit",    "hit compare",      "Cache controller",  "bit"),
    ("tb_cache_controller.dut.refill_en", "refill active", "Cache controller",  "bit"),
    ("tb_cache_controller.dut.addr_q", "latched addr",     "Cache controller",  "hex"),
    ("tb_cache_controller.dut.q_index","line index",       "Cache controller",  "hex"),
    ("tb_cache_controller.dut.q_tag",  "tag",              "Cache controller",  "hex"),
    ("tb_cache_controller.mreq_v",     "mem_req_valid",    "Memory interface",  "bit"),
    ("tb_cache_controller.mreq_r",     "mem_req_ready",    "Memory interface",  "bit"),
    ("tb_cache_controller.mreq_a",     "mem_req_addr",     "Memory interface",  "hex"),
    ("tb_cache_controller.mresp_v",    "mem_resp_valid",   "Memory interface",  "bit"),
    ("tb_cache_controller.mresp_d",    "mem_resp_data",    "Memory interface",  "hex"),
    ("tb_cache_controller.dut.u_mem.mstate", "mem-if state", "Memory interface", "mstate"),
    ("tb_cache_controller.s_req",      "stat_requests",    "Statistics",        "dec"),
    ("tb_cache_controller.s_hit",      "stat_hits",        "Statistics",        "dec"),
    ("tb_cache_controller.s_miss",     "stat_misses",      "Statistics",        "dec"),
    ("tb_cache_controller.s_mrd",      "stat_mem_reads",   "Statistics",        "dec"),
    ("tb_cache_controller.s_cmp",      "stat_completed",   "Statistics",        "dec"),
    ("tb_cache_controller.s_wait",     "stat_mem_wait",    "Statistics",        "dec"),
    ("tb_cache_controller.test_no",    "test number",      "Testbench",         "dec"),
    # needed to rebuild cache contents; also visible
    ("tb_cache_controller.dut.refill_block", "refill block", "Cache controller", "hex"),
]
STATE_NAMES = ["IDLE", "LOOKUP", "MISS_REQ", "WAIT_MEM", "REFILL", "COMPLETE"]
MSTATE_NAMES = ["M_IDLE", "M_REQ", "M_WAIT"]
UNKNOWN = -1   # value contains x/z


def _val(bits):
    return UNKNOWN if re.search(r"[xzXZ]", bits) else int(bits, 2)


class VcdIndex:
    def __init__(self, path):
        self.path = path
        self.timescale = "1ns"
        self.tick_ns = 1.0           # nanoseconds per VCD time unit
        self.sig = {}                # path -> dict(width,label,group,fmt,times,vals)
        self.end_time = 0
        self.missing = []
        self.catalog = {}            # every recorded non-parameter variable: path -> dict(width, ident, kind)
        self._parse()
        self._cache_events()

    # ------------------------------------------------------------------ parsing
    def _parse(self):
        want = {p: i for i, (p, *_rest) in enumerate(SIGNALS)}
        id_to_paths, scope, widths = {}, [], {}
        header_done = False
        data = {}                    # id -> (times, vals)
        with open(self.path, "r", errors="replace") as f:
            tokens_ts = None
            for line in f:
                if not header_done:
                    s = line.strip()
                    if s.startswith("$timescale"):
                        txt = s
                        while "$end" not in txt:
                            txt += " " + f.readline().strip()
                        m = re.search(r"(\d+)\s*(fs|ps|ns|us|ms)", txt)
                        self.timescale = m.group(1) + m.group(2)
                        self.tick_ns = int(m.group(1)) * {"fs": 1e-6, "ps": 1e-3, "ns": 1.0, "us": 1e3, "ms": 1e6}[m.group(2)]
                    elif s.startswith("$scope"):
                        scope.append(s.split()[2])
                    elif s.startswith("$upscope"):
                        scope.pop()
                    elif s.startswith("$var"):
                        p = s.split()
                        path = ".".join(scope + [p[4]])
                        if p[1] not in ("parameter", "real", "string", "event") and int(p[2]) <= 512 and path not in self.catalog:
                            self.catalog[path] = dict(width=int(p[2]), ident=p[3], kind=p[1])
                        if path in want:
                            id_to_paths.setdefault(p[3], []).append(path)
                            widths[path] = int(p[2])
                            data.setdefault(p[3], ([], []))
                    elif s.startswith("$enddefinitions"):
                        header_done = True
                        t = 0
                        cur_t = None
                    continue
                if not line:
                    continue
                c = line[0]
                if c == "#":
                    cur_t = int(line[1:])
                    if cur_t > self.end_time:
                        self.end_time = cur_t
                elif c == "b":
                    sp = line.index(" ")
                    ident = line[sp + 1:].strip()
                    d = data.get(ident)
                    if d is not None:
                        d[0].append(cur_t if cur_t is not None else 0)
                        d[1].append(_val(line[1:sp]))
                elif c in "01xzXZ":
                    ident = line[1:].strip()
                    d = data.get(ident)
                    if d is not None:
                        d[0].append(cur_t if cur_t is not None else 0)
                        d[1].append(_val(c))
        for ident, paths in id_to_paths.items():
            for path in paths:
                _p, label, group, fmt = SIGNALS[want[path]]
                self.sig[path] = dict(path=path, width=widths[path], label=label, group=group, fmt=fmt,
                                      times=data[ident][0], vals=data[ident][1])
        self.missing = [p for p in want if p not in self.sig]

    def ensure(self, paths):
        """Load additional recorded signals (anything in the catalog) with one pass over the VCD. The file is read-only."""
        todo = [p for p in paths if p in self.catalog and p not in self.sig]
        if not todo:
            return
        by_id = {}
        for p in todo:
            by_id.setdefault(self.catalog[p]["ident"], []).append(p)
        data = {i: ([], []) for i in by_id}
        in_defs, cur_t = True, 0
        with open(self.path, "r", errors="replace") as f:
            for line in f:
                if in_defs:
                    if line.lstrip().startswith("$enddefinitions"):
                        in_defs = False
                    continue
                c = line[:1]
                if c == "#":
                    cur_t = int(line[1:])
                elif c == "b":
                    sp = line.index(" ")
                    d = data.get(line[sp + 1:].strip())
                    if d is not None:
                        d[0].append(cur_t); d[1].append(_val(line[1:sp]))
                elif c in "01xzXZ":
                    d = data.get(line[1:].strip())
                    if d is not None:
                        d[0].append(cur_t); d[1].append(_val(c))
        for ident, ps in by_id.items():
            for p in ps:
                cat = self.catalog[p]
                self.sig[p] = dict(path=p, width=cat["width"], label=p.replace("tb_cache_controller.", "", 1), group="All recorded signals",
                                   fmt="bit" if cat["width"] == 1 else "hex", times=data[ident][0], vals=data[ident][1])

    # ------------------------------------------------------------------ queries
    def value_at(self, path, t):
        s = self.sig.get(path)
        if not s or not s["times"]:
            return UNKNOWN
        i = bisect.bisect_right(s["times"], t) - 1
        return s["vals"][i] if i >= 0 else UNKNOWN

    def window(self, path, t0, t1, px):
        """Changes in [t0, t1]. Dense windows keep only first/last change per pixel bucket."""
        s = self.sig[path]
        times, vals = s["times"], s["vals"]
        i0 = bisect.bisect_right(times, t0) - 1
        init = vals[i0] if i0 >= 0 else UNKNOWN
        a = bisect.bisect_right(times, t0)
        b = bisect.bisect_right(times, t1)
        n = b - a
        pts, dense = [], False
        if n <= 2 * px:
            pts = [[times[k], vals[k]] for k in range(a, b)]
        else:
            dense = True
            # one bucket per pixel; keep the first and last change in each bucket (found by bisection, O(px log n))
            bucket = max(1.0, (t1 - t0) / px)
            k = a
            while k < b:
                bk = int((times[k] - t0) // bucket)
                nxt = bisect.bisect_left(times, t0 + (bk + 1) * bucket, k, b)
                if nxt <= k:
                    nxt = k + 1
                pts.append([times[k], vals[k]])
                if nxt - 1 > k:
                    pts.append([times[nxt - 1], vals[nxt - 1]])
                k = nxt
        return dict(init=init, points=pts, dense=dense, count=n)

    # ------------------------------------------------------------------ cache reconstruction
    def _cache_events(self):
        """Rebuild cache contents from dumped signals only:
        a refill write lands on the first clock edge after refill_en rises;
        reset clears all valid bits on a clock edge where rst_n is low."""
        self.events = []
        need = ["tb_cache_controller.clk", "tb_cache_controller.rst_n", "tb_cache_controller.dut.refill_en",
                "tb_cache_controller.dut.q_index", "tb_cache_controller.dut.q_tag",
                "tb_cache_controller.dut.refill_block"]
        if any(n not in self.sig for n in need):
            return
        clk = self.sig[need[0]]
        rises = [t for t, v in zip(clk["times"], clk["vals"]) if v == 1]
        ev = []
        was_low = False
        for t in rises:
            low = self.value_at(need[1], t) == 0     # value before this edge's effects: rst_n changes on negedge
            if low and not was_low:
                ev.append((t, "clear", None))
            was_low = low
        re_ = self.sig[need[2]]
        prev = 0
        for t, v in zip(re_["times"], re_["vals"]):
            if v == 1 and prev != 1:
                k = bisect.bisect_right(rises, t)
                if k < len(rises):
                    ev.append((rises[k], "write", (self.value_at(need[3], t), self.value_at(need[4], t),
                                                   self.value_at(need[5], t))))
            prev = v
        ev.sort(key=lambda e: e[0])
        self.events = ev

    def cache_at(self, t, num_lines=64):
        valid = [False] * num_lines
        tag = [0] * num_lines
        data = [0] * num_lines
        recent, recent_t = None, None
        for et, kind, payload in self.events:
            if et > t:
                break
            if kind == "clear":
                valid = [False] * num_lines
                recent = None
            else:
                idx, tg, blk = payload
                if 0 <= idx < num_lines and tg != UNKNOWN and blk != UNKNOWN:
                    valid[idx], tag[idx], data[idx] = True, tg, blk
                    recent, recent_t = idx, et
        return valid, tag, data, recent, recent_t

    def pulses_after_last_reset(self, path):
        """Number of rising edges of a 1-bit signal after the final reset release (for cross-checks)."""
        s = self.sig[path]
        rst = self.sig["tb_cache_controller.rst_n"]
        last_release = 0
        for t, v in zip(rst["times"], rst["vals"]):
            if v == 1:
                last_release = t
        n, prev = 0, 0
        for t, v in zip(s["times"], s["vals"]):
            if t >= last_release and v == 1 and prev != 1:
                n += 1
            prev = v
        return n


# ---------------------------------------------------------------------------- access trace from the VCD
def build_accesses(idx, state_names, index_w=6, offset_w=4):
    """Reconstruct every CPU access from signals in the VCD (nothing is simulated or invented here).

    An access is *accepted* on a rising clock edge where req_valid and req_ready were both 1 just before the edge
    (and rst_n was 1). Its response is the next rising edge where resp_valid was 1 just before the edge; hit/miss comes
    from resp_hit, errors from resp_err. The FSM path is read from dut.state at the edges in between.
    """
    T = "tb_cache_controller."
    need = [T + n for n in ("clk", "rst_n", "req_valid", "req_ready", "req_addr", "resp_valid", "resp_hit", "resp_err",
                            "resp_rdata", "dut.state", "mreq_v", "mreq_r", "drv_we")]
    if any(n not in idx.sig for n in need):
        return None
    clk = idx.sig[T + "clk"]
    rises, prev = [], 0
    for t, v in zip(clk["times"], clk["vals"]):
        if v == 1 and prev != 1:
            rises.append(t)
        prev = v
    pre = lambda name, t: idx.value_at(T + name, t - 1)          # value just before the edge at time t
    events = [e for e in idx.events if e[1] == "write"]
    ev_times = [e[0] for e in events]

    accepts, resets = [], 0
    was_reset = False
    mem_tx = 0
    for k, t in enumerate(rises):
        rst = pre("rst_n", t)
        if rst == 0:
            if not was_reset:
                resets += 1
            was_reset = True
            continue
        was_reset = False
        if pre("mreq_v", t) == 1 and pre("mreq_r", t) == 1:
            mem_tx += 1
        if pre("req_valid", t) == 1 and pre("req_ready", t) == 1:
            accepts.append(k)

    out = []
    for n, k in enumerate(accepts, 1):
        t = rises[k]
        addr = pre("req_addr", t)
        we = pre("drv_we", t)
        nxt = accepts[n] if n < len(accepts) else len(rises)
        r = None
        aborted = False
        for j in range(k + 1, min(len(rises), k + 4000)):
            tj = rises[j]
            if pre("rst_n", tj) == 0:
                aborted = True
                break
            if pre("resp_valid", tj) == 1:
                r = j
                break
            if j >= nxt:                      # a new request was accepted before this one answered: lost response
                break
        row = dict(n=n, cycle=k, accept_t=t, addr=None if addr == UNKNOWN else addr)
        if addr != UNKNOWN:
            row["tag"] = addr >> (index_w + offset_w)
            row["index"] = (addr >> offset_w) & ((1 << index_w) - 1)
            row["offset"] = addr & ((1 << offset_w) - 1)
        row["write"] = we == 1
        if r is None:
            row.update(result="aborted" if aborted else "incomplete", resp_t=None, resp_cycle=None, latency=None,
                       transition="(reset before response)" if aborted else "(no response in trace)", states=[])
        else:
            tr = rises[r]
            err = pre("resp_err", tr) == 1
            hit = pre("resp_hit", tr) == 1
            states, last = [], None
            for j in range(k + 1, r + 1):
                s = pre("dut.state", rises[j])
                if s != last and s != UNKNOWN:
                    states.append(state_names[s] if 0 <= s < len(state_names) else f"S{s}")
                    last = s
            rd = pre("resp_rdata", tr)
            res = "error" if err else ("hit" if hit else "miss")
            row.update(result=res, resp_t=tr, resp_cycle=r, latency=r - k,
                       rdata=None if rd == UNKNOWN else rd, states=states,
                       transition=(" → ".join(states[:2]) if len(states) >= 2 else " → ".join(states)))
            if res == "miss":
                lo = bisect.bisect_left(ev_times, t)
                hi = bisect.bisect_right(ev_times, tr)
                row["refill_t"] = ev_times[lo] if lo < hi else None
        out.append(row)

    ok = [a for a in out if a["result"] in ("hit", "miss")]
    hits = [a for a in ok if a["result"] == "hit"]
    miss = [a for a in ok if a["result"] == "miss"]
    summary = dict(
        total=len(out), hits=len(hits), misses=len(miss), errors=sum(a["result"] == "error" for a in out),
        aborted=sum(a["result"] in ("aborted", "incomplete") for a in out), resets=resets,
        mem_transactions=mem_tx, cycles=len(rises), clock_edges=len(rises),
        hit_rate=(len(hits) / len(ok)) if ok else None, miss_rate=(len(miss) / len(ok)) if ok else None,
        avg_latency=(sum(a["latency"] for a in ok) / len(ok)) if ok else None,
        hit_time=(sum(a["latency"] for a in hits) / len(hits)) if hits else None,
        miss_latency=(sum(a["latency"] for a in miss) / len(miss)) if miss else None)
    if summary["hit_time"] is not None and summary["miss_latency"] is not None:
        summary["miss_penalty"] = summary["miss_latency"] - summary["hit_time"]
        summary["amat_model"] = summary["hit_time"] + summary["miss_rate"] * summary["miss_penalty"]
    return dict(accesses=out, summary=summary)
