#!/usr/bin/env python3
"""Run approved portal scenarios with Icarus Verilog and render timing diagrams (PDF) for the IEEE report.

Every plotted value is read from the VCD of a real simulation run (same code path as the portal).
Usage: python3 scripts/make_report_figures.py      (writes report/figures/wave_*.pdf)
"""
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "portal"))
import server  # noqa: E402
from vcd_index import UNKNOWN, VcdIndex  # noqa: E402

OUT = ROOT / "report" / "figures"
T = "tb_cache_controller."
STATES = ["IDLE", "LOOKUP", "MISS_REQ", "WAIT_MEM", "REFILL", "COMPLETE"]
MSTATES = ["M_IDLE", "M_REQ", "M_WAIT"]
BLUE, FILL, RED, GRID = "#1f5fa8", "#dbe9f8", "#c62828", "#dddddd"

ROWS_STD = [("clk", "clk", "bit"), ("req_valid", "req_valid", "bit"), ("req_ready", "req_ready", "bit"),
            ("req_addr", "req_addr", "hex"), ("FSM state", "dut.state", "state"),
            ("mem_req_valid", "mreq_v", "bit"), ("mem_resp_valid", "mresp_v", "bit"),
            ("resp_valid", "resp_valid", "bit"), ("resp_hit", "resp_hit", "bit"), ("resp_rdata", "resp_rdata", "hex")]
ROWS_ERR = [("clk", "clk", "bit"), ("req_valid", "req_valid", "bit"), ("req_addr", "req_addr", "hex"),
            ("FSM state", "dut.state", "state"), ("mem_req_valid", "mreq_v", "bit"),
            ("resp_valid", "resp_valid", "bit"), ("resp_err", "resp_err", "bit"), ("resp_hit", "resp_hit", "bit"),
            ("resp_rdata", "resp_rdata", "hex")]
ROWS_LAT = [("req_valid", "req_valid", "bit"), ("FSM state", "dut.state", "state"),
            ("mem_req_valid", "mreq_v", "bit"), ("mem_resp_valid", "mresp_v", "bit"),
            ("resp_valid", "resp_valid", "bit"), ("resp_hit", "resp_hit", "bit")]
ROWS_RST = [("clk", "clk", "bit"), ("rst_n", "rst_n", "bit"), ("req_valid", "req_valid", "bit"),
            ("FSM state", "dut.state", "state"), ("mem-if state", "dut.u_mem.mstate", "mstate"),
            ("mem_req_valid", "mreq_v", "bit"), ("mem_resp_valid", "mresp_v", "bit"), ("resp_valid", "resp_valid", "bit")]


def run(scenario, lat):
    meta = server.run_simulation(scenario, lat)
    assert meta["status"] == "pass", (scenario, lat, meta["status"])
    return VcdIndex(str(ROOT / "results" / "portal_runs" / meta["run_id"] / "wave.vcd")), meta


def rises(idx, name):
    s = idx.sig[T + name]
    out, prev = [], 0
    for t, v in zip(s["times"], s["vals"]):
        if v == 1 and prev != 1:
            out.append(t)
        prev = v
    return out


def falls_after(idx, name, t0):
    s = idx.sig[T + name]
    for t, v in zip(s["times"], s["vals"]):
        if t > t0 and v == 0:
            return t
    return idx.end_time


def fmt(kind, v, width=1):
    if v == UNKNOWN:
        return "x"
    if kind == "state":
        return STATES[v] if v < len(STATES) else f"?{v}"
    if kind == "mstate":
        return MSTATES[v] if v < len(MSTATES) else f"?{v}"
    return f"{v:#x}"


def draw_rows(axes, idx, rows, t0, t1, tick_ns, origin):
    for ax, (label, path, kind) in zip(axes, rows):
        s = idx.sig[T + path]
        times, vals = s["times"], s["vals"]
        # segments clipped to window
        segs, cur = [], UNKNOWN
        last_t = t0
        for t, v in zip(times, vals):
            if t <= t0:
                cur = v
                continue
            if t >= t1:
                break
            segs.append((last_t, t, cur)); last_t, cur = t, v
        segs.append((last_t, t1, cur))
        X = lambda t: (t - origin) * tick_ns
        if kind == "bit":
            xs, ys = [], []
            for a, b, v in segs:
                y = 1 if v == 1 else 0
                xs += [X(a), X(b)]; ys += [y, y]
                if v == UNKNOWN:
                    ax.axvspan(X(a), X(b), color=RED, alpha=0.25, lw=0)
            ax.plot(xs, ys, color=BLUE, lw=1.0, drawstyle="default")
            ax.set_ylim(-0.3, 1.3); ax.set_yticks([])
        else:
            ax.set_ylim(0, 1); ax.set_yticks([])
            for a, b, v in segs:
                x0, x1 = X(a), X(b)
                bad = v == UNKNOWN
                ax.fill([x0, x1, x1, x0], [0.15, 0.15, 0.85, 0.85], color=RED if bad else FILL, alpha=0.5 if bad else 1, lw=0)
                ax.plot([x0, x1], [0.85, 0.85], color=BLUE, lw=0.6); ax.plot([x0, x1], [0.15, 0.15], color=BLUE, lw=0.6)
                ax.plot([x0, x0], [0.15, 0.85], color=BLUE, lw=0.6)
                span = x1 - x0
                if span > 6:
                    txt = fmt(kind, v)
                    # approximate fit: ~2 ns per character at figure scale
                    maxc = int(span / 3.6)
                    if len(txt) > maxc:
                        txt = txt[:max(0, maxc - 1)] + "…" if maxc > 3 else ""
                    ax.text((x0 + x1) / 2, 0.5, txt, ha="center", va="center", fontsize=5.5)
        ax.set_ylabel(label, rotation=0, ha="right", va="center", fontsize=6.5)
        ax.tick_params(labelsize=6)
        for sp in ("top", "right", "left"):
            ax.spines[sp].set_visible(False)
        ax.grid(axis="x", color=GRID, lw=0.4)


def figure(name, idx, rows, t0, t1, title, notes=None):
    tick_ns = idx.tick_ns
    origin = t0
    n = len(rows)
    fig, axes = plt.subplots(n, 1, figsize=(7.1, 0.27 * n + 0.75), sharex=True)
    draw_rows(axes, idx, rows, t0, t1, tick_ns, origin)
    axes[-1].set_xlim(0, (t1 - t0) * tick_ns)
    axes[-1].set_xlabel("time since window start (ns); clock period = 10 ns", fontsize=7)
    for ax in axes[:-1]:
        ax.tick_params(labelbottom=False)
    fig.suptitle(title, fontsize=8, y=0.995)
    fig.tight_layout(pad=0.3, h_pad=0.0, rect=(0, 0, 1, 0.97))
    fig.savefig(OUT / f"wave_{name}.pdf")
    plt.close(fig)
    print("wrote", f"wave_{name}.pdf", f"[{t0 * tick_ns:.0f}..{t1 * tick_ns:.0f} ns]")


def window_for_responses(idx, first, count, pre_ns=25, post_ns=25):
    """Window from just before the request leading to response #first, through response #first+count-1."""
    resp = rises(idx, "resp_valid")
    req = rises(idx, "req_valid")
    pre, post = pre_ns / idx.tick_ns, post_ns / idx.tick_ns
    r0 = resp[first]
    starts = [t for t in req if t <= r0]
    start = starts[-1] if starts else r0
    if first > 0:
        start = max(start, resp[first - 1])
    end = falls_after(idx, "resp_valid", resp[first + count - 1])
    return max(0, start - pre), min(idx.end_time, end + post)


def mixed_window(idx, start, count):
    """First response index >= start whose next `count` responses contain both a hit and a miss."""
    resp = rises(idx, "resp_valid")
    for first in range(start, len(resp) - count):
        hits = [idx.value_at(T + "resp_hit", t + 1) for t in resp[first:first + count]]
        if 1 in hits and 0 in hits:
            return first
    return start


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    jobs = [
        ("cold_miss", "cold_miss", 4, ROWS_STD, (0, 1), "Cold miss at address 0x44 (LAT = 4): LOOKUP, MISS_REQ, WAIT_MEM, REFILL, COMPLETE"),
        ("repeated", "repeated", 4, ROWS_STD, (0, 3), "Repeated access to 0x80 (LAT = 4): one miss, then two 2-cycle hits"),
        ("same_block", "same_block", 4, ROWS_STD, (0, 4), "Four words of one block (0x108, 0x100, 0x104, 0x10C): one refill, three hits"),
        ("conflict", "conflict", 4, ROWS_STD, (0, 4), "Direct-mapped conflict, addresses 0x0 and 0x400 alternate: every access misses"),
        ("sequential", "sequential", 4, ROWS_STD, (0, 6), "Sequential words (first six): one miss per 4-word block, then hits"),
        ("handshake", "handshake", 4, ROWS_STD, (1, 5), "Back-to-back requests held while busy: req_valid stays high, req_ready is high only in IDLE"),
        ("random", "random", 4, ROWS_STD, (60, 8), "Random reads (seeded): mixed hits and misses to scattered lines"),
    ]
    for name, scen, lat, rows, (first, count), title in jobs:
        idx, _ = run(scen, lat)
        if name in ("handshake", "random"):
            first = mixed_window(idx, first, count)
        t0, t1 = window_for_responses(idx, first, count)
        figure(name, idx, rows, t0, t1, title)

    # boundary / error responses
    idx, _ = run("boundary", 4)
    t0, t1 = window_for_responses(idx, 4, 7, pre_ns=15, post_ns=15)
    figure("boundary", idx, ROWS_ERR, t0, t1, "Boundary and error cases: errors (misaligned, out of range, write) answer in one cycle without memory access")

    # latency comparison: same input, LAT = 1 and LAT = 16
    fig, axs = plt.subplots(2 * len(ROWS_LAT), 1, figsize=(7.1, 0.27 * 2 * len(ROWS_LAT) + 1.0), sharex=True)
    span_ns = 0
    for k, lat in enumerate((1, 16)):
        idx, _ = run("cold_miss", lat)
        t0, t1 = window_for_responses(idx, 0, 1)
        span_ns = max(span_ns, (t1 - t0) * idx.tick_ns)
        draw_rows(axs[k * len(ROWS_LAT):(k + 1) * len(ROWS_LAT)], idx, ROWS_LAT, t0, t1, idx.tick_ns, t0)
        axs[k * len(ROWS_LAT)].set_title(f"LAT = {lat}", fontsize=7, loc="left", pad=2)
    axs[-1].set_xlim(0, span_ns)
    axs[-1].set_xlabel("time since window start (ns)", fontsize=7)
    for ax in axs[:-1]:
        ax.tick_params(labelbottom=False)
    fig.suptitle("Same cold miss with memory latency 1 and 16: only WAIT_MEM stretches", fontsize=8, y=0.995)
    fig.tight_layout(pad=0.3, h_pad=0.0, rect=(0, 0, 1, 0.97))
    fig.savefig(OUT / "wave_latency.pdf"); plt.close(fig); print("wrote wave_latency.pdf")

    # reset in the middle of a miss: window around the last reset
    idx, _ = run("reset", 4)
    rst = idx.sig[T + "rst_n"]
    falls = [t for t, v in zip(rst["times"], rst["vals"]) if v == 0 and t > 0]
    t_f = falls[-1]
    figure("reset", idx, ROWS_RST, max(0, t_f - 130 / idx.tick_ns), min(idx.end_time, t_f + 230 / idx.tick_ns),
           "Reset during a miss: FSM and memory interface return to idle; the aborted refill never sets a valid bit")


if __name__ == "__main__":
    main()
