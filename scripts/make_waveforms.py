#!/usr/bin/env python3
"""Run selected tests with Icarus Verilog and draw timing diagrams from the VCD files they write.

Self-contained: a small VCD reader (only the signals listed below) plus matplotlib. Every plotted value is read from a VCD
produced by the real testbench; nothing is drawn by hand. Equivalent to opening the VCD in GTKWave and taking a screenshot.

Usage:  .venv/bin/python scripts/make_waveforms.py          # PNGs -> docs/images/, PDFs -> report/figures/
        .venv/bin/python scripts/make_waveforms.py cold_miss conflict      # only some figures
"""
import bisect
import re
import subprocess
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parent.parent
PNG_DIR, PDF_DIR = ROOT / "docs" / "images", ROOT / "report" / "figures"
WAVES = ROOT / "simulation" / "waveforms"
T = "tb_cache_controller."
X = None                                        # unknown value in a VCD (x or z)


def rtl_states():
    text = (ROOT / "rtl" / "cache_controller.v").read_text()
    found = sorted((int(c), n) for n, c in re.findall(r"\bS_(\w+)\s*=\s*3'd(\d+)", text))
    return [n for _, n in found]


STATES = rtl_states()
BLUE, FILL, RED, GRID = "#1f5fa8", "#dbe9f8", "#c62828", "#dddddd"

# (label, signal path inside the VCD, kind)
S = dict(clk=("clk", "clk", "bit"), rst=("rst_n", "rst_n", "bit"), rv=("req_valid", "req_valid", "bit"),
         rr=("req_ready", "req_ready", "bit"), ra=("req_addr", "req_addr", "hex"), st=("FSM state", "dut.state", "state"),
         mv=("mem_req_valid", "mreq_v", "bit"), mrv=("mem_resp_valid", "mresp_v", "bit"), pv=("resp_valid", "resp_valid", "bit"),
         ph=("resp_hit", "resp_hit", "bit"), pe=("resp_err", "resp_err", "bit"), pd=("resp_rdata", "resp_rdata", "hex"))
ROWS_STD = [S[k] for k in ("clk", "rv", "rr", "ra", "st", "mv", "mrv", "pv", "ph", "pd")]
ROWS_ERR = [S[k] for k in ("clk", "rv", "ra", "st", "mv", "pv", "pe", "ph", "pd")]
ROWS_LAT = [S[k] for k in ("rv", "st", "mv", "mrv", "pv", "ph")]
ROWS_RST = [S[k] for k in ("clk", "rst", "rv", "st", "mv", "mrv", "pv")]


# ------------------------------------------------------------------ VCD reader
class Vcd:
    """Value changes of the wanted signals, keyed by name relative to the testbench scope."""

    def __init__(self, path):
        want = {T + p for _, p, _ in {v for v in S.values()}}
        ids, scope, self.ch, t, in_defs = {}, [], {}, 0, True
        self.tick_ns = 1e-3
        with open(path, errors="replace") as f:
            for line in f:
                s = line.strip()
                if in_defs:
                    if s.startswith("$timescale"):
                        txt = s
                        while "$end" not in txt:
                            txt += " " + f.readline().strip()
                        m = re.search(r"(\d+)\s*(fs|ps|ns|us)", txt)
                        self.tick_ns = int(m.group(1)) * {"fs": 1e-6, "ps": 1e-3, "ns": 1.0, "us": 1e3}[m.group(2)]
                    elif s.startswith("$scope"):
                        scope.append(s.split()[2])
                    elif s.startswith("$upscope"):
                        scope.pop()
                    elif s.startswith("$var"):
                        p = s.split()
                        name = ".".join(scope + [p[4]])
                        if name in want:
                            ids.setdefault(p[3], []).append(name[len(T):])
                    elif s.startswith("$enddefinitions"):
                        in_defs = False
                    continue
                if s.startswith("#"):
                    t = int(s[1:])
                    self.end = t
                elif s.startswith("b"):
                    val, ident = s[1:].split()
                    for n in ids.get(ident, []):
                        self.ch.setdefault(n, []).append((t, X if re.search("[xz]", val) else int(val, 2)))
                elif s and s[0] in "01xz":
                    for n in ids.get(s[1:], []):
                        self.ch.setdefault(n, []).append((t, X if s[0] in "xz" else int(s[0])))
        self._times = {n: [c[0] for c in v] for n, v in self.ch.items()}

    def at(self, name, t):
        i = bisect.bisect_right(self._times[name], t) - 1
        return self.ch[name][i][1] if i >= 0 else X

    def rises(self, name):
        out, prev = [], 0
        for t, v in self.ch[name]:
            if v == 1 and prev != 1:
                out.append(t)
            prev = v
        return out

    def falls_after(self, name, t0):
        return next((t for t, v in self.ch[name] if t > t0 and v == 0), self.end)


# ------------------------------------------------------------------ drawing
def label(kind, v):
    if v is X:
        return "x"
    if kind == "state":
        return STATES[v] if v < len(STATES) else f"?{v}"
    return f"{v:#x}"


def draw_rows(axes, vcd, rows, t0, t1):
    tick, origin = vcd.tick_ns, t0
    for ax, (name, path, kind) in zip(axes, rows):
        times = [c[0] for c in vcd.ch[path]]
        segs, cur, last = [], vcd.at(path, t0), t0
        for t, v in vcd.ch[path]:
            if t <= t0:
                continue
            if t >= t1:
                break
            segs.append((last, t, cur)); last, cur = t, v
        segs.append((last, t1, cur))
        xs = lambda t: (t - origin) * tick
        if kind == "bit":
            px, py = [], []
            for a, b, v in segs:
                px += [xs(a), xs(b)]; py += [1 if v == 1 else 0] * 2
                if v is X:
                    ax.axvspan(xs(a), xs(b), color=RED, alpha=0.25, lw=0)
            ax.plot(px, py, color=BLUE, lw=1.0)
            ax.set_ylim(-0.3, 1.3)
        else:
            ax.set_ylim(0, 1)
            for a, b, v in segs:
                x0, x1 = xs(a), xs(b)
                ax.fill([x0, x1, x1, x0], [0.15, 0.15, 0.85, 0.85], color=RED if v is X else FILL, alpha=0.5 if v is X else 1, lw=0)
                ax.plot([x0, x1], [0.85, 0.85], color=BLUE, lw=0.6); ax.plot([x0, x1], [0.15, 0.15], color=BLUE, lw=0.6)
                ax.plot([x0, x0], [0.15, 0.85], color=BLUE, lw=0.6)
                if x1 - x0 > 6:
                    txt = label(kind, v); maxc = int((x1 - x0) / 3.6)
                    if len(txt) > maxc:
                        txt = txt[:max(0, maxc - 1)] + "…" if maxc > 3 else ""
                    ax.text((x0 + x1) / 2, 0.5, txt, ha="center", va="center", fontsize=5.5)
        ax.set_yticks([]); ax.set_ylabel(name, rotation=0, ha="right", va="center", fontsize=6.5)
        ax.tick_params(labelsize=6); ax.grid(axis="x", color=GRID, lw=0.4)
        for sp in ("top", "right", "left"):
            ax.spines[sp].set_visible(False)


def save(fig, stem):
    PNG_DIR.mkdir(parents=True, exist_ok=True); PDF_DIR.mkdir(parents=True, exist_ok=True)
    fig.savefig(PNG_DIR / f"wave_{stem}.png", dpi=170); fig.savefig(PDF_DIR / f"wave_{stem}.pdf")
    plt.close(fig); print(f"wrote docs/images/wave_{stem}.png and report/figures/wave_{stem}.pdf")


def figure(stem, vcd, rows, t0, t1, title):
    fig, axes = plt.subplots(len(rows), 1, figsize=(7.1, 0.27 * len(rows) + 0.75), sharex=True)
    draw_rows(axes, vcd, rows, t0, t1)
    axes[-1].set_xlim(0, (t1 - t0) * vcd.tick_ns)
    axes[-1].set_xlabel("time since window start (ns); clock period = 10 ns", fontsize=7)
    for ax in axes[:-1]:
        ax.tick_params(labelbottom=False)
    fig.suptitle(title, fontsize=8, y=0.995)
    fig.tight_layout(pad=0.3, h_pad=0.0, rect=(0, 0, 1, 0.97))
    save(fig, stem)


def window(vcd, first, count, pre_ns=25, post_ns=25):
    """Time window from just before the request behind response #first through response #first+count-1."""
    resp, req = vcd.rises("resp_valid"), vcd.rises("req_valid")
    count = max(1, min(count, len(resp) - first))          # a short test may have fewer responses than asked for
    pre, post = pre_ns / vcd.tick_ns, post_ns / vcd.tick_ns
    start = max([t for t in req if t <= resp[first]] or [resp[first]])
    if first > 0:
        start = max(start, resp[first - 1])
    end = vcd.falls_after("resp_valid", resp[first + count - 1])
    return max(0, start - pre), min(vcd.end, end + post)


def mixed(vcd, start, count):
    """First response index >= start whose next `count` responses contain both a hit and a miss."""
    resp = vcd.rises("resp_valid")
    for k in range(start, len(resp) - count):
        hits = [vcd.at("resp_hit", t + 1) for t in resp[k:k + count]]
        if 1 in hits and 0 in hits:
            return k
    return start


def run_wave(test, lat):
    r = subprocess.run([str(ROOT / "scripts" / "run_wave.sh"), test, str(lat)], cwd=ROOT, capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"run_wave.sh {test} {lat} failed:\n{r.stdout}{r.stderr}")
    return Vcd(WAVES / f"{test}_lat{lat}.vcd")


# stem -> (test name, latency, rows, (first response, count), title)
JOBS = {
    "cold_miss": ("cold_miss", 4, ROWS_STD, (0, 1), "Cold miss at 0x44 (L = 4): LOOKUP, MISS_REQ, WAIT_MEM, REFILL, COMPLETE"),
    "repeated": ("repeated_access", 4, ROWS_STD, (0, 3), "Repeated access to 0x80 (L = 4): one miss, then two 2-cycle hits"),
    "conflict": ("direct_mapped_conflict", 4, ROWS_STD, (0, 4), "Direct-mapped conflict, addresses 0x0 and 0x400 alternate: every access misses"),
    "conflict_100_1124": ("conflict_100_1124_104", 4, ROWS_STD, (0, 5), "Conflict example 100 -> 1124 -> 100 (three misses), then 104 (hit: same block as 100)"),
    "sequential": ("sequential_access", 4, ROWS_STD, (0, 6), "Sequential words (first six): one miss per 4-word block, then hits"),
    "handshake": ("request_handshake", 4, ROWS_STD, (1, 5), "Back-to-back requests held while busy: req_ready is high only in IDLE"),
    "boundary": ("boundary_and_errors", 4, ROWS_ERR, (4, 7), "Error cases: misaligned, out-of-range and write requests answer in one cycle"),
}


def main():
    only = set(sys.argv[1:])
    for stem, (test, lat, rows, (first, count), title) in JOBS.items():
        if only and stem not in only:
            continue
        vcd = run_wave(test, lat)
        if stem == "handshake":
            first = mixed(vcd, first, count)
        t0, t1 = window(vcd, first, count, *( (15, 15) if stem == "boundary" else (25, 25)))
        figure(stem, vcd, rows, t0, t1, title)
    if not only or "latency" in only:                      # the same cold miss with memory latency 1 and 16
        fig, axs = plt.subplots(2 * len(ROWS_LAT), 1, figsize=(7.1, 0.27 * 2 * len(ROWS_LAT) + 1.0), sharex=True)
        span = 0
        for k, lat in enumerate((1, 16)):
            vcd = run_wave("cold_miss", lat)
            t0, t1 = window(vcd, 0, 1)
            span = max(span, (t1 - t0) * vcd.tick_ns)
            draw_rows(axs[k * len(ROWS_LAT):(k + 1) * len(ROWS_LAT)], vcd, ROWS_LAT, t0, t1)
            axs[k * len(ROWS_LAT)].set_title(f"L = {lat}", fontsize=7, loc="left", pad=2)
        axs[-1].set_xlim(0, span); axs[-1].set_xlabel("time since window start (ns)", fontsize=7)
        for ax in axs[:-1]:
            ax.tick_params(labelbottom=False)
        fig.suptitle("Same cold miss with memory latency 1 and 16: only WAIT_MEM stretches", fontsize=8, y=0.995)
        fig.tight_layout(pad=0.3, h_pad=0.0, rect=(0, 0, 1, 0.97))
        save(fig, "latency")
    if not only or "reset" in only:                        # reset in the middle of a miss
        vcd = run_wave("reset", 4)
        tf = [t for t, v in vcd.ch["rst_n"] if v == 0 and t > 0][-1]
        figure("reset", vcd, ROWS_RST, max(0, tf - 130 / vcd.tick_ns), min(vcd.end, tf + 230 / vcd.tick_ns),
               "Reset during a miss: FSM returns to idle, no stray response, the aborted refill never sets a valid bit")


if __name__ == "__main__":
    main()
