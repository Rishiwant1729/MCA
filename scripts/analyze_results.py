#!/usr/bin/env python3
"""Generate workload traces, run them through the RTL (testbench/tb_perf.v), compute
performance metrics from the simulator's counters, and write CSVs and plots.

Every number comes from simulation output; nothing here is hardcoded.

Usage:  .venv/bin/python scripts/analyze_results.py [--latencies 1 4 8 16]
Outputs: testbench/test_vectors/*.hex, docs/performance.csv, docs/perf_results.md,
         docs/images/{hit_miss_rate,amat_vs_latency}.png, simulation/logs/perf_*.log
"""
import argparse
import csv
import random
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VEC = ROOT / "testbench" / "test_vectors"
PERF = ROOT / "docs"
IMG = PERF / "images"
LOGS = ROOT / "simulation" / "logs"
MEM_BYTES = 65536
BLOCK = 16
CACHE = 1024


# ----------------------------------------------------------------- workloads
def workloads(seed=2025):
    """Reproducible address traces (byte addresses, word aligned)."""
    rng = random.Random(seed)
    w = {}
    # 16 hot words (4 blocks) revisited over and over
    w["repeated"] = [0x2000 + 4 * (i % 16) for i in range(2000)]
    # one pass over 16 KB, word by word
    w["sequential"] = [4 * i for i in range(4096)]
    # uniform over the whole 64 KB memory
    w["random"] = [4 * rng.randrange(MEM_BYTES // 4) for _ in range(4000)]
    # ping-pong between two addresses that map to the same line (0 and 1024)
    w["conflict"] = [(0x0 if i % 2 == 0 else CACHE) + 4 * ((i // 2) % 4) for i in range(2000)]
    # 80% of accesses in a 512-byte hot region, 20% anywhere (typical locality)
    hot = []
    for _ in range(4000):
        if rng.random() < 0.8:
            hot.append(0x4000 + 4 * rng.randrange(128))
        else:
            hot.append(4 * rng.randrange(MEM_BYTES // 4))
    w["random_hot"] = hot
    return w


def write_traces(wl):
    VEC.mkdir(parents=True, exist_ok=True)
    for name, addrs in wl.items():
        assert all(a % 4 == 0 and 0 <= a < MEM_BYTES for a in addrs), name
        (VEC / f"{name}.hex").write_text("".join(f"{a:08x}\n" for a in addrs))


# ----------------------------------------------------------------- simulation
def run(cmd):
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)


PERF_RE = re.compile(r"^PERF (.*)$", re.M)


def simulate(wl, latencies):
    LOGS.mkdir(parents=True, exist_ok=True)
    rows = []
    rtl = sorted(str(p.relative_to(ROOT)) for p in (ROOT / "rtl").glob("*.v"))
    for lat in latencies:
        exe = f"simulation/logs/tb_perf_lat{lat}.vvp"
        c = run(["iverilog", "-g2012", "-I", "testbench", f"-Ptb_perf.LAT={lat}", "-o", exe, *rtl,
                 "testbench/main_memory_model.v", "testbench/reference_memory.v", "testbench/tb_perf.v"])
        if c.returncode:
            sys.exit(f"compile failed:\n{c.stderr}")
        for name, addrs in wl.items():
            r = run(["vvp", "-n", exe, f"+trace=testbench/test_vectors/{name}.hex",
                     f"+n={len(addrs)}", f"+name={name}"])
            (LOGS / f"perf_{name}_lat{lat}.log").write_text(r.stdout + r.stderr)
            m = PERF_RE.search(r.stdout)
            if r.returncode or not m or "PERF_OK" not in r.stdout:
                sys.exit(f"simulation failed for {name} lat={lat}:\n{r.stdout[-800:]}{r.stderr[-400:]}")
            row = {k: v for k, v in (kv.split("=") for kv in m.group(1).split())}
            rows.append({k: (v if k == "workload" else int(v)) for k, v in row.items()})
    return rows


# ----------------------------------------------------------------- metrics
def design_constants(raw):
    """Hit time and miss latency are properties of the design at a given memory
    latency, so measure them over all workloads (a workload with zero hits, such
    as 'conflict', has no hit of its own to measure)."""
    out = {}
    for lat in sorted({r["lat"] for r in raw}):
        rs = [r for r in raw if r["lat"] == lat]
        hits = sum(r["hits"] for r in rs)
        misses = sum(r["misses"] for r in rs)
        hit_time = sum(r["hit_lat_sum"] for r in rs) / hits
        miss_latency = sum(r["miss_lat_sum"] for r in rs) / misses
        out[lat] = (hit_time, miss_latency - hit_time)
    return out


def derive(r, consts):
    n, hits, misses = r["n"], r["hits"], r["misses"]
    hit_time, penalty = consts[r["lat"]]
    d = dict(r)
    d["hit_rate"] = hits / n
    d["miss_rate"] = misses / n
    d["hit_time"] = hit_time
    d["miss_penalty"] = penalty
    # AMAT = hit time + miss rate * miss penalty (penalty = extra cycles beyond a hit)
    d["amat_formula"] = hit_time + d["miss_rate"] * penalty
    # direct measurement: average accept->response latency over all requests
    d["avg_latency_measured"] = (r["hit_lat_sum"] + r["miss_lat_sum"]) / n
    d["cycles_per_request"] = r["cycles"] / n
    d["mem_wait_per_miss"] = r["mem_wait"] / misses if misses else float("nan")
    return d


def sanity(rows, latencies):
    """Independent checks that the numbers mean what the report says they mean."""
    problems = []
    for d in rows:
        if abs(d["amat_formula"] - d["avg_latency_measured"]) > 1e-9:
            problems.append(f"AMAT formula != measured avg latency: {d['workload']} lat={d['lat']}")
        if d["hit_time"] != 2:
            problems.append(f"unexpected hit time {d['hit_time']}: {d['workload']} lat={d['lat']}")
        if d["miss_penalty"] != d["lat"] + 5:
            problems.append(f"unexpected miss penalty {d['miss_penalty']}: {d['workload']} lat={d['lat']}")
    by = {(d["workload"], d["lat"]): d for d in rows}
    lat0 = latencies[0]
    # properties that follow from the workload definitions, independent of the RTL
    seq = by[("sequential", lat0)]
    if seq["misses"] != seq["n"] // (BLOCK // 4):
        problems.append("sequential: expected 1 miss per 4-word block")
    if by[("conflict", lat0)]["hits"] != 0:
        problems.append("conflict: expected zero hits")
    if by[("repeated", lat0)]["misses"] != 4:
        problems.append("repeated: expected exactly 4 cold misses")
    return problems


# ----------------------------------------------------------------- output
def write_csv(rows, latencies):
    PERF.mkdir(parents=True, exist_ok=True)
    cols = ["workload", "lat", "n", "hits", "misses", "hit_rate", "miss_rate", "hit_time",
            "miss_penalty", "amat_formula", "avg_latency_measured", "cycles_per_request",
            "mem_reads", "mem_wait", "mem_wait_per_miss", "cycles"]
    with open(PERF / "performance.csv", "w", newline="") as f:
        wr = csv.writer(f)
        wr.writerow(cols)
        for d in rows:
            wr.writerow([f"{d[c]:.4f}" if isinstance(d[c], float) else d[c] for c in cols])


def write_markdown(rows, latencies):
    """docs/perf_results.md: every table below is generated from the simulation counters."""
    ref = 4 if 4 in latencies else latencies[0]
    out = ["# Performance results", "",
           "Generated by `scripts/analyze_results.py` (`make perf`) from simulation counters; nothing here is typed in.",
           "Configuration: 1 KB direct-mapped cache, 16-byte blocks, 64 lines, 64 KB memory model. Each trace runs from an empty cache with",
           "back-to-back requests.", "",
           "**Timing convention.** Request latency = clock edges from the accept edge to the edge where `resp_valid` is sampled. Hit time is the",
           "latency of a hit; miss penalty is the *extra* cycles of a miss (miss latency - hit time), so AMAT = hit time + miss rate x miss penalty",
           "does not count the lookup twice. The average latency is also measured directly and equals the formula in every run.", "",
           f"## Results at memory latency {ref}", "",
           "| Workload | Requests | Hits | Misses | Hit rate | Miss rate | Hit time | Miss penalty | AMAT (cycles) |", "|---|---|---|---|---|---|---|---|---|"]
    for d in rows:
        if d["lat"] == ref:
            out.append(f"| {d['workload']} | {d['n']} | {d['hits']} | {d['misses']} | {100*d['hit_rate']:.1f}% | {100*d['miss_rate']:.1f}% | "
                       f"{d['hit_time']:.0f} | {d['miss_penalty']:.0f} | {d['amat_formula']:.2f} |")
    out += ["", "## AMAT (cycles) versus memory latency", "", "| Workload | " + " | ".join(f"L={l}" for l in latencies) + " |",
            "|---|" + "---|" * len(latencies)]
    for w in dict.fromkeys(d["workload"] for d in rows):
        vals = {d["lat"]: d["amat_formula"] for d in rows if d["workload"] == w}
        out.append(f"| {w} | " + " | ".join(f"{vals[l]:.2f}" for l in latencies) + " |")
    out += ["", "![hit and miss rate](images/hit_miss_rate.png)", "", "![AMAT versus latency](images/amat_vs_latency.png)", "",
            "Raw per-run numbers (cycles, memory-wait cycles, latency sums) are in `docs/performance.csv`.", ""]
    (PERF / "perf_results.md").write_text("\n".join(out))


def plots(rows, latencies):
    IMG.mkdir(parents=True, exist_ok=True)
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    names = list(dict.fromkeys(d["workload"] for d in rows))
    colors = ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#56B4E9"]
    ref_lat = 4 if 4 in latencies else latencies[0]
    sel = {d["workload"]: d for d in rows if d["lat"] == ref_lat}

    fig, ax = plt.subplots(figsize=(7.5, 4))
    xs = range(len(names))
    ax.bar([x - 0.2 for x in xs], [100 * sel[n]["hit_rate"] for n in names], 0.4, label="hit rate", color="#0072B2")
    ax.bar([x + 0.2 for x in xs], [100 * sel[n]["miss_rate"] for n in names], 0.4, label="miss rate", color="#D55E00")
    for x, n in zip(xs, names):
        ax.text(x - 0.2, 100 * sel[n]["hit_rate"] + 1, f"{100 * sel[n]['hit_rate']:.1f}", ha="center", fontsize=8)
        ax.text(x + 0.2, 100 * sel[n]["miss_rate"] + 1, f"{100 * sel[n]['miss_rate']:.1f}", ha="center", fontsize=8)
    ax.set_xticks(list(xs)); ax.set_xticklabels(names)
    ax.set_ylabel("% of requests"); ax.set_ylim(0, 112)
    ax.set_title("Hit and miss rate by workload (1 KB direct-mapped, 16 B blocks)")
    ax.legend(frameon=False); ax.spines[["top", "right"]].set_visible(False)
    fig.tight_layout(); fig.savefig(IMG / "hit_miss_rate.png", dpi=150); plt.close(fig)

    fig, ax = plt.subplots(figsize=(7.5, 4))
    for c, n in zip(colors, names):
        pts = sorted((d["lat"], d["avg_latency_measured"]) for d in rows if d["workload"] == n)
        ax.plot([p[0] for p in pts], [p[1] for p in pts], marker="o", color=c, label=n)
    ax.set_xlabel("main-memory latency (cycles)")
    ax.set_ylabel("average memory access time (cycles)")
    ax.set_title("AMAT vs memory latency (measured)")
    ax.legend(frameon=False); ax.spines[["top", "right"]].set_visible(False)
    fig.tight_layout(); fig.savefig(IMG / "amat_vs_latency.png", dpi=150); plt.close(fig)


def print_table(rows, latencies):
    ref = 4 if 4 in latencies else latencies[0]
    print(f"\nResults at memory latency {ref} (all values from simulation):")
    print(f"{'workload':<11}{'n':>6}{'hits':>6}{'miss':>6}{'hit%':>7}{'miss%':>7}{'hitT':>6}{'penalty':>8}{'AMAT':>8}{'cyc/req':>9}")
    for d in rows:
        if d["lat"] == ref:
            print(f"{d['workload']:<11}{d['n']:>6}{d['hits']:>6}{d['misses']:>6}{100*d['hit_rate']:>7.1f}"
                  f"{100*d['miss_rate']:>7.1f}{d['hit_time']:>6.1f}{d['miss_penalty']:>8.1f}"
                  f"{d['amat_formula']:>8.2f}{d['cycles_per_request']:>9.2f}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--latencies", type=int, nargs="+", default=[1, 4, 8, 16])
    args = ap.parse_args()
    wl = workloads()
    write_traces(wl)
    raw = simulate(wl, args.latencies)
    consts = design_constants(raw)
    rows = [derive(r, consts) for r in raw]
    problems = sanity(rows, args.latencies)
    write_csv(rows, args.latencies)
    write_markdown(rows, args.latencies)
    plots(rows, args.latencies)
    print_table(rows, args.latencies)
    print(f"\nWrote {PERF/'performance.csv'}, {PERF/'perf_results.md'} and plots in {IMG}")
    if problems:
        print("SANITY CHECK PROBLEMS:\n  " + "\n  ".join(problems))
        sys.exit(1)
    print("Sanity checks passed (AMAT formula == measured average latency; workload-specific miss counts).")


if __name__ == "__main__":
    main()
