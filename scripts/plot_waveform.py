#!/usr/bin/env python3
"""Render a timing diagram PNG from a simulation VCD (no GTKWave needed).
Usage: plot_waveform.py <in.vcd> <out.png> [start_ns end_ns]
Without a window it shows the first miss followed by hits. Everything plotted is read from the VCD."""
import re
import sys
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

STATES = {0: "IDLE", 1: "LOOKUP", 2: "MISS_REQ", 3: "WAIT_MEM", 4: "REFILL", 5: "COMPLETE"}
# (label, scope path, name, kind)
SIGNALS = [("clk", "tb_integration", "clk", "bit"),
           ("req_valid", "tb_integration", "req_valid", "bit"),
           ("req_ready", "tb_integration", "req_ready", "bit"),
           ("req_addr", "tb_integration", "req_addr", "hex"),
           ("FSM state", "tb_integration.dut", "state", "state"),
           ("mem_req_valid", "tb_integration", "mreq_v", "bit"),
           ("mem_resp_valid", "tb_integration", "mresp_v", "bit"),
           ("resp_valid", "tb_integration", "resp_valid", "bit"),
           ("resp_hit", "tb_integration", "resp_hit", "bit")]


def parse(path):
    ids, scope, changes, t, tscale = {}, [], {}, 0, 1e-3
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line.startswith("$timescale"):
                m = re.search(r"(\d+)\s*(ps|ns|us)", line + next(f))
                tscale = int(m.group(1)) * {"ps": 1e-3, "ns": 1.0, "us": 1e3}[m.group(2)]
            elif line.startswith("$scope"):
                scope.append(line.split()[2])
            elif line.startswith("$upscope"):
                scope.pop()
            elif line.startswith("$var"):
                p = line.split()
                ids.setdefault((".".join(scope), p[4]), p[3])
            elif line.startswith("#"):
                t = int(line[1:])
            elif line and line[0] in "01xz" and not line.startswith("$"):
                changes.setdefault(line[1:], []).append((t * tscale, line[0]))
            elif line.startswith("b"):
                v, i = line[1:].split()
                changes.setdefault(i, []).append((t * tscale, v))
    return ids, changes


def series(ids, changes, scope, name):
    return changes[ids[(scope, name)]]


def main():
    vcd, out = sys.argv[1], sys.argv[2]
    ids, ch = parse(vcd)
    rv = series(ids, ch, "tb_integration", "req_valid")
    t0 = next(t for t, v in rv if v == "1")
    lo, hi = (float(sys.argv[3]), float(sys.argv[4])) if len(sys.argv) > 4 else (t0 - 15, t0 + 190)

    fig, axes = plt.subplots(len(SIGNALS), 1, figsize=(11, 6.2), sharex=True)
    for ax, (label, scope, name, kind) in zip(axes, SIGNALS):
        pts = series(ids, ch, scope, name)
        xs, ys = [], []
        for (t, v) in pts:
            val = int(v, 2) if kind != "bit" and set(v) <= {"0", "1"} else (int(v) if v in "01" else 0)
            xs.append(t); ys.append(val)
        xs.append(hi + 50); ys.append(ys[-1])
        if kind in ("bit",):
            ax.step(xs, ys, where="post", color="#0072B2", lw=1.5)
            ax.set_ylim(-0.3, 1.3); ax.set_yticks([0, 1])
        else:
            ax.set_ylim(0, 1); ax.set_yticks([])
            for i, (x, v) in enumerate(zip(xs[:-1], ys[:-1])):
                x2 = xs[i + 1]
                if x2 < lo or x > hi:
                    continue
                ax.axvspan(max(x, lo), min(x2, hi), ymin=0.15, ymax=0.85, color="#E69F00" if kind == "state" else "#56B4E9", alpha=0.45)
                txt = STATES.get(v, str(v)) if kind == "state" else f"{v:#x}"
                ax.text((max(x, lo) + min(x2, hi)) / 2, 0.5, txt, ha="center", va="center", fontsize=7)
        ax.set_ylabel(label, rotation=0, ha="right", va="center", fontsize=8)
        ax.spines[["top", "right"]].set_visible(False)
        ax.tick_params(labelsize=7)
    axes[-1].set_xlim(lo, hi)
    axes[-1].set_xlabel("time (ns)   [clock period = 10 ns]")
    fig.suptitle("Cache controller timing: first access (cold miss), then hits  --  from simulation VCD", fontsize=10)
    fig.tight_layout(); fig.savefig(out, dpi=150)


if __name__ == "__main__":
    main()
