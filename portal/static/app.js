"use strict";
// Waveform viewer for the cache-controller portal. All signal data comes from the backend,
// which reads it from the VCD that Icarus Verilog wrote for the selected run.

const $ = (id) => document.getElementById(id);
const ROW = 26, HDR = 22, RULER = 30;
const DEFAULT_ON = new Set(["clk", "rst_n", "req_valid", "req_ready", "req_addr", "resp_valid", "resp_rdata",
  "resp_hit (hit/miss)", "FSM state", "refill active", "line index", "mem_req_valid", "mem_resp_valid",
  "mem_req_addr", "test number"]);
const FSM_STATES = ["IDLE", "LOOKUP", "MISS_REQ", "WAIT_MEM", "REFILL", "COMPLETE"];

const S = {
  run: null, info: null, sel: new Set(), collapsed: new Set(), radix: "hex",
  t0: 0, t1: 1, cursor: 0, data: {}, dataWin: null, values: {}, seq: 0, fetchTimer: null, cursorTimer: null,
  rows: [], prevCache: null,
};

// ---------------------------------------------------------------- helpers
async function api(path, opts) {
  const r = await fetch(path, opts);
  const j = await r.json().catch(() => ({ error: "bad response" }));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
const nsOf = (t) => t * S.info.tick_ns;
function fmtTime(t) { const ns = nsOf(t); return (Math.abs(ns) >= 1000 ? (ns / 1000).toFixed(3) + " µs" : ns.toFixed(ns % 1 ? 1 : 0) + " ns"); }
function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  for (const k of kids) e.append(k);
  return e;
}
function fmtVal(sig, v) {
  if (v === undefined || v === null) return "";
  if (v === "x") return "x";
  if (sig.fmt === "state") return FSM_STATES[parseInt(v, 16)] ?? "?" + v;
  if (sig.fmt === "mstate") return (S.info.mstates[parseInt(v, 16)]) ?? "?" + v;
  if (sig.width === 1) return String(v);
  const n = BigInt("0x" + v);
  if (S.radix === "dec" || sig.fmt === "dec") return n.toString(10);
  if (S.radix === "bin") return "b" + n.toString(2).padStart(sig.width, "0");
  return "0x" + v;
}

// ---------------------------------------------------------------- run control
async function init() {
  const sc = await api("/api/scenarios");
  S.scenarios = sc.scenarios;
  for (const s of sc.scenarios) $("scenario").append(el("option", { value: s.id, textContent: s.title }));
  for (const l of sc.latencies) $("latency").append(el("option", { value: l, textContent: l, selected: l === 4 }));
  $("scenario").onchange = describe; describe();
  $("runBtn").onclick = runSim;
  $("runs").onchange = () => loadRun($("runs").value);
  await refreshRuns();
  $("radix").onchange = () => { S.radix = $("radix").value; renderNames(); draw(); };
  $("zin").onclick = () => zoom(0.5); $("zout").onclick = () => zoom(2); $("zfit").onclick = fit;
  $("pleft").onclick = () => pan(-0.5); $("pright").onclick = () => pan(0.5);
  $("gocur").onclick = () => { const w = S.t1 - S.t0; setView(S.cursor - w / 2, S.cursor + w / 2); };
  $("scroll").oninput = () => { const w = S.t1 - S.t0, max = S.info.end_time - w; const s = ($("scroll").value / 1000) * Math.max(0, max); setView(s, s + w, true); };
  $("copyCmd").onclick = () => {
    const cmd = `open -a gtkwave ${vcdRelPath()}`;
    navigator.clipboard?.writeText(cmd); $("copyCmd").textContent = "Copied!"; setTimeout(() => $("copyCmd").textContent = "Copy GTKWave command", 1500);
  };
  buildFsmSvg();
  setupCanvas();
  const runs = await api("/api/runs");
  // Deep link: #run=<id>&t0=<ticks>&t1=<ticks>&cursor=<ticks>&all=1&scroll=<element id>
  const h = new URLSearchParams(location.hash.slice(1));
  S.hash = h;
  const first = runs.find((r) => r.run_id === h.get("run")) || runs.find((r) => r.status !== "compile_error") || runs[0];
  if (first) loadRun(first.run_id);
}
function describe() { const s = S.scenarios.find((x) => x.id === $("scenario").value); $("scenarioDesc").textContent = s ? s.desc : ""; }
async function refreshRuns(select) {
  const runs = await api("/api/runs");
  const box = $("runs"); box.replaceChildren();
  for (const r of runs) {
    const t = new Date(r.created).toLocaleTimeString();
    box.append(el("option", { value: r.run_id, textContent: `${t} · ${r.title} · LAT ${r.latency} · ${r.status.toUpperCase()}`, selected: r.run_id === select }));
  }
}
function setStatus(msg, err) { const s = $("status"); s.textContent = msg; s.className = "status" + (err ? " err" : ""); }
async function runSim() {
  const btn = $("runBtn"); btn.disabled = true; setStatus("Compiling and running Icarus Verilog…");
  try {
    const meta = await api("/api/run", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: $("scenario").value, latency: parseInt($("latency").value, 10) }) });
    await refreshRuns(meta.run_id);
    setStatus(`Finished: ${meta.status.toUpperCase()} (${meta.sim_seconds ?? "–"} s)`, meta.status !== "pass");
    await loadRun(meta.run_id);
  } catch (e) { setStatus("Error: " + e.message, true); }
  btn.disabled = false;
}
function vcdRelPath() { return `results/portal_runs/${S.run.run_id}/wave.vcd`; }

async function loadRun(id) {
  if (!id) return;
  const mySeq = ++S.seq;
  S.run = await api(`/api/run/${id}/meta`);
  renderResults(S.run);
  renderBanner(S.run);
  for (const e of ["wavebox", "toolbar", "lower", "scroll"]) $(e).hidden = true;
  if (!S.run.vcd) { S.info = null; return; }
  $("loading").hidden = false;
  try {
    const info = await api(`/api/run/${id}/signals`);
    if (mySeq !== S.seq) return;
    S.info = info; S.data = {}; S.dataWin = null; S.values = {};
    renderBanner(S.run);
    S.sel = new Set(info.signals.filter((s) => DEFAULT_ON.has(s.label)).map((s) => s.path));
    S.collapsed = new Set();
    S.t0 = 0; S.t1 = Math.max(1, info.end_time); S.cursor = 0;
    $("dlVcd").href = `/api/run/${id}/vcd`;
    for (const e of ["wavebox", "toolbar", "lower"]) $(e).hidden = false;
    $("scroll").hidden = false;
    buildSigPicker(); renderNames(); resizeCanvas();
    const h = S.hash;
    if (h && h.get("all")) { S.sel = new Set(info.signals.map((x) => x.path)); buildSigPicker(); renderNames(); resizeCanvas(); }
    if (h && h.get("t0") && h.get("t1")) setView(+h.get("t0"), +h.get("t1"));
    if (h && h.get("cursor")) setCursor(+h.get("cursor"));
    scheduleFetch(0); scheduleCursor(0);
    if (h && h.get("scroll")) setTimeout(() => $(h.get("scroll")).scrollIntoView(), 600);
  } catch (e) { setStatus("Waveform load failed: " + e.message, true); }
  $("loading").hidden = true;
}
function renderBanner(m) {
  const b = $("banner"); b.className = "banner"; b.replaceChildren();
  const v = m.vcd;
  b.append(el("span", { className: `badge ${m.status}`, textContent: m.status.toUpperCase().replace("_", " ") }), " ",
    el("b", { textContent: ` ${m.title}` }), ` · LAT=${m.latency} · run `, el("code", { textContent: m.run_id }),
    ` · ${new Date(m.created).toLocaleString()} · design ${m.design_hash}`,
    v ? el("div", { className: "muted" }, `Waveform source: ${vcdRelPath()} · ${(v.bytes / 1024).toFixed(1)} KB · sha256 ${v.sha256.slice(0, 16)}… · timescale ${S.info ? S.info.timescale : ""}`)
      : el("div", { className: "muted", textContent: "No VCD was produced for this run." }));
}
function renderResults(m) {
  $("resultCard").hidden = false;
  const r = $("results"); r.replaceChildren();
  r.append(el("div", {}, el("span", { className: `badge ${m.status}`, textContent: m.status.toUpperCase().replace("_", " ") }), ` ${m.summary || ""}`));
  if (!m.compile_ok) r.append(el("pre", { className: "out", textContent: m.compile_output || "(no compiler output)" }));
  else if (m.compile_output.trim()) r.append(el("details", {}, el("summary", { textContent: "Compiler messages" }), el("pre", { className: "out", textContent: m.compile_output })));
  for (const t of m.tests) {
    const row = el("div", { className: "testrow" }, el("b", { textContent: `T${t.n} ${t.name} ` }),
      el("span", { className: `badge ${t.result === "PASS" ? "pass" : "fail"}`, textContent: t.result || "?" }),
      el("div", { className: "exp", textContent: "expected: " + t.expected }), el("div", { textContent: "actual: " + t.actual }));
    for (const f of t.failures.slice(0, 5)) row.append(el("div", { style: "color:var(--bad)", textContent: f }));
    r.append(row);
  }
  r.append(el("details", {}, el("summary", { textContent: "Commands run" }), el("pre", { className: "out", textContent: m.compile_cmd + "\n" + m.sim_cmd })));
  if (m.compile_ok) {
    const lg = el("a", { href: `/api/run/${m.run_id}/log`, target: "_blank", textContent: "Raw simulation log" });
    r.append(el("div", { className: "muted" }, lg));
  }
}

// ---------------------------------------------------------------- signals / rows
function buildSigPicker() {
  const box = $("sigList"); box.replaceChildren();
  const groups = [...new Set(S.info.signals.map((s) => s.group))];
  for (const g of groups) {
    box.append(el("h3", { textContent: g }));
    for (const s of S.info.signals.filter((x) => x.group === g)) {
      const cb = el("input", { type: "checkbox", checked: S.sel.has(s.path) });
      cb.onchange = () => { cb.checked ? S.sel.add(s.path) : S.sel.delete(s.path); onSelectionChange(); };
      box.append(el("label", {}, cb, `${s.label}${s.width > 1 ? ` [${s.width}]` : ""}`));
    }
  }
}
function onSelectionChange() { renderNames(); resizeCanvas(); scheduleFetch(0); scheduleCursor(0); }
function buildRows() {
  const rows = [];
  const groups = [...new Set(S.info.signals.map((s) => s.group))];
  for (const g of groups) {
    const sigs = S.info.signals.filter((s) => s.group === g && S.sel.has(s.path));
    if (!sigs.length) continue;
    rows.push({ type: "group", name: g, count: sigs.length });
    if (!S.collapsed.has(g)) for (const s of sigs) rows.push({ type: "sig", sig: s });
  }
  S.rows = rows;
}
function renderNames() {
  buildRows();
  const n = $("names"); n.replaceChildren();
  n.append(el("div", { style: `height:${RULER}px;border-bottom:1px solid var(--line)` }));
  for (const r of S.rows) {
    if (r.type === "group") {
      const d = el("div", { className: "nrow ghdr", style: `height:${HDR}px`, title: "Click to expand/collapse" },
        el("span", { className: "lab", textContent: `${S.collapsed.has(r.name) ? "▸" : "▾"} ${r.name} (${r.count})` }));
      d.onclick = () => { S.collapsed.has(r.name) ? S.collapsed.delete(r.name) : S.collapsed.add(r.name); renderNames(); resizeCanvas(); };
      n.append(d);
    } else {
      const v = el("span", { className: "val", textContent: fmtVal(r.sig, S.values[r.sig.path]), title: S.values[r.sig.path] ? "0x" + S.values[r.sig.path] : "" });
      n.append(el("div", { className: "nrow", style: `height:${ROW}px`, title: r.sig.path },
        el("span", { className: "lab" }, r.sig.label, el("span", { className: "w", textContent: r.sig.width > 1 ? `[${r.sig.width - 1}:0]` : "" })), v));
    }
  }
  S.nameVals = [...n.querySelectorAll(".val")];
}
function updateNameValues() {
  let k = 0;
  for (const r of S.rows) if (r.type === "sig") {
    const v = S.nameVals[k++]; const raw = S.values[r.sig.path];
    v.textContent = fmtVal(r.sig, raw); v.title = raw && raw !== "x" && r.sig.width > 1 ? "0x" + raw : "";
  }
}

// ---------------------------------------------------------------- data fetching
function scheduleFetch(delay = 80) { clearTimeout(S.fetchTimer); S.fetchTimer = setTimeout(fetchWave, delay); }
async function fetchWave() {
  if (!S.run || !S.info) return;
  const seq = ++S.seq, w = S.t1 - S.t0, m = w * 0.5;
  const a = Math.max(0, Math.floor(S.t0 - m)), b = Math.min(S.info.end_time, Math.ceil(S.t1 + m)) || S.t1;
  const paths = S.info.signals.filter((s) => S.sel.has(s.path)).map((s) => s.path);
  if (!paths.length) { draw(); return; }
  const px = Math.round($("wave").clientWidth * (b - a) / w) + 50;
  try {
    const d = await api(`/api/run/${S.run.run_id}/wave?signals=${encodeURIComponent(paths.join(","))}&t0=${a}&t1=${b}&px=${Math.min(px, 4000)}`);
    if (seq !== S.seq) return;
    S.data = d.signals; S.dataWin = [a, b]; draw();
  } catch (e) { setStatus("Wave fetch failed: " + e.message, true); }
}
function scheduleCursor(delay = 40) { clearTimeout(S.cursorTimer); S.cursorTimer = setTimeout(fetchCursor, delay); }
async function fetchCursor() {
  if (!S.run || !S.info) return;
  const t = Math.round(S.cursor);
  const want = new Set(S.info.signals.filter((s) => S.sel.has(s.path)).map((s) => s.path));
  for (const p of ["tb_cache_controller.dut.state", "tb_cache_controller.dut.addr_q", "tb_cache_controller.resp_hit",
    "tb_cache_controller.dut.q_index", "tb_cache_controller.dut.q_tag", "tb_cache_controller.s_req", "tb_cache_controller.s_hit",
    "tb_cache_controller.s_miss", "tb_cache_controller.s_mrd", "tb_cache_controller.s_wait", "tb_cache_controller.resp_valid",
    "tb_cache_controller.dut.hit", "tb_cache_controller.dut.u_mem.mstate"]) want.add(p);
  try {
    const [v, l] = await Promise.all([
      api(`/api/run/${S.run.run_id}/value?t=${t}&signals=${encodeURIComponent([...want].join(","))}`),
      api(`/api/run/${S.run.run_id}/lines?t=${t}`)]);
    if (Math.round(S.cursor) !== t) return;
    S.values = v; updateNameValues(); renderFsm(); renderCache(l);
  } catch (e) { setStatus("Cursor update failed: " + e.message, true); }
}

// ---------------------------------------------------------------- canvas
function setupCanvas() {
  const c = $("wave");
  c.tabIndex = 0;
  new ResizeObserver(() => { resizeCanvas(); }).observe($("canvasWrap"));
  let drag = null;
  c.addEventListener("mousedown", (e) => {
    const r = c.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    drag = { x0: e.clientX, v0: S.t0, v1: S.t1, moved: false, ruler: y < RULER };
    if (drag.ruler) setCursor(xToT(x));
    c.focus();
  });
  window.addEventListener("mousemove", (e) => {
    if (!drag) return;
    const r = c.getBoundingClientRect();
    if (drag.ruler) { setCursor(xToT(e.clientX - r.left)); return; }
    const dx = e.clientX - drag.x0;
    if (Math.abs(dx) > 3) drag.moved = true;
    if (drag.moved) { const dt = -dx * (drag.v1 - drag.v0) / r.width; setView(drag.v0 + dt, drag.v1 + dt); c.style.cursor = "grabbing"; }
  });
  window.addEventListener("mouseup", (e) => {
    if (!drag) return;
    const r = c.getBoundingClientRect();
    if (!drag.moved && !drag.ruler) setCursor(xToT(e.clientX - r.left));
    drag = null; c.style.cursor = "crosshair";
  });
  c.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = c.getBoundingClientRect();
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) { pan((e.deltaX || e.deltaY) / r.width); return; }
    zoom(e.deltaY < 0 ? 0.8 : 1.25, xToT(e.clientX - r.left));
  }, { passive: false });
  c.addEventListener("keydown", (e) => {
    const step = clockPeriod() * (e.shiftKey ? 10 : 1);
    if (e.key === "ArrowLeft") { setCursor(S.cursor - step); e.preventDefault(); }
    else if (e.key === "ArrowRight") { setCursor(S.cursor + step); e.preventDefault(); }
    else if (e.key === "+" || e.key === "=") zoom(0.5, S.cursor);
    else if (e.key === "-") zoom(2, S.cursor);
    else if (e.key === "0") fit();
  });
}
function clockPeriod() {
  const c = S.data["tb_cache_controller.clk"];
  if (c) { const rises = c.points.filter((p) => p[1] === 1 || p[1] === "1").map((p) => p[0]); if (rises.length > 1) return rises[1] - rises[0]; }
  return 10 / S.info.tick_ns;
}
function xToT(x) { return S.t0 + (x / $("wave").clientWidth) * (S.t1 - S.t0); }
function tToX(t) { return ((t - S.t0) / (S.t1 - S.t0)) * $("wave").clientWidth; }
function setCursor(t) {
  if (!S.info) return;
  S.cursor = Math.max(0, Math.min(S.info.end_time, t));
  $("cursorReadout").textContent = `cursor ${fmtTime(S.cursor)}`;
  scheduleCursor(); draw();
}
function setView(a, b, fromScroll) {
  if (!S.info) return;
  const full = Math.max(1, S.info.end_time), minW = Math.max(4, 2 / S.info.tick_ns);
  let w = Math.max(minW, Math.min(full, b - a));
  a = Math.max(0, Math.min(full - w, a)); b = a + w;
  S.t0 = a; S.t1 = b;
  if (!fromScroll) $("scroll").value = full - w > 0 ? Math.round((a / (full - w)) * 1000) : 0;
  draw(); scheduleFetch();
}
function zoom(f, about) {
  const w = S.t1 - S.t0, c = about ?? (S.t0 + w / 2);
  const nw = w * f, frac = (c - S.t0) / w;
  setView(c - nw * frac, c + nw * (1 - frac));
}
function pan(frac) { const w = S.t1 - S.t0; setView(S.t0 + w * frac, S.t1 + w * frac); }
function fit() { setView(0, S.info.end_time); }

function resizeCanvas() {
  if (!S.info) return;
  const c = $("wave"), dpr = window.devicePixelRatio || 1;
  const h = RULER + S.rows.reduce((a, r) => a + (r.type === "group" ? HDR : ROW), 0);
  c.style.height = h + "px";
  c.width = Math.max(1, Math.round(c.clientWidth * dpr)); c.height = Math.round(h * dpr);
  c.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
  draw(); scheduleFetch();
}
function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function niceStep(spanNs, px) {
  const target = spanNs / (px / 90), mag = Math.pow(10, Math.floor(Math.log10(target)));
  for (const m of [1, 2, 5, 10]) if (m * mag >= target) return m * mag;
  return 10 * mag;
}
function draw() {
  if (!S.info) return;
  const c = $("wave"), g = c.getContext("2d"), W = c.clientWidth, H = parseFloat(c.style.height) || 100;
  const col = { wave: css("--wave"), bus: css("--bus"), busl: css("--busline"), bad: css("--bad"), cur: css("--cursor"),
    grid: css("--grid"), text: css("--text"), muted: css("--muted"), hdr: css("--hdr") };
  g.clearRect(0, 0, W, H);
  // ruler + grid
  const spanNs = nsOf(S.t1 - S.t0), step = niceStep(spanNs, W);
  g.font = "11px ui-monospace, Menlo, monospace"; g.textBaseline = "middle";
  g.fillStyle = col.muted; g.strokeStyle = col.grid; g.lineWidth = 1;
  for (let ns = Math.ceil(nsOf(S.t0) / step) * step; ns <= nsOf(S.t1); ns += step) {
    const x = Math.round(tToX(ns / S.info.tick_ns)) + 0.5;
    g.beginPath(); g.moveTo(x, RULER - 6); g.lineTo(x, H); g.stroke();
    g.fillText(step >= 1000 ? (ns / 1000) + "µs" : ns + "ns", x + 3, RULER / 2 - 2);
  }
  g.strokeStyle = col.grid; g.beginPath(); g.moveTo(0, RULER - .5); g.lineTo(W, RULER - .5); g.stroke();
  // rows
  let y = RULER;
  for (const r of S.rows) {
    if (r.type === "group") { g.fillStyle = col.hdr; g.fillRect(0, y, W, HDR); y += HDR; continue; }
    drawSignal(g, r.sig, y, W, col); y += ROW;
    g.strokeStyle = col.grid; g.beginPath(); g.moveTo(0, y - .5); g.lineTo(W, y - .5); g.stroke();
  }
  // cursor
  const cx = Math.round(tToX(S.cursor)) + 0.5;
  if (cx >= 0 && cx <= W) {
    g.strokeStyle = col.cur; g.lineWidth = 1.5; g.beginPath(); g.moveTo(cx, 0); g.lineTo(cx, H); g.stroke();
    g.fillStyle = col.cur; g.fillRect(cx - 4, 0, 8, 6);
  }
  if (!S.dataWin || S.t0 < S.dataWin[0] || S.t1 > S.dataWin[1]) { g.fillStyle = col.muted; g.fillText("loading…", W - 70, RULER / 2); }
}
function drawSignal(g, sig, y, W, col) {
  const d = S.data[sig.path];
  if (!d) return;
  const top = y + 5, bot = y + ROW - 6, mid = (top + bot) / 2;
  // build segments [tStart, tEnd, value]
  const pts = d.points, segs = [];
  let cur = d.init, ts = S.dataWin ? S.dataWin[0] : S.t0;
  for (const [t, v] of pts) { segs.push([ts, t, cur]); cur = v; ts = t; }
  segs.push([ts, S.info.end_time + 1, cur]);
  g.lineWidth = 1.5;
  if (sig.width === 1 && sig.fmt !== "state") {
    g.strokeStyle = col.wave; g.beginPath();
    let first = true, py = null;
    for (const [a, b, v] of segs) {
      if (b < S.t0 || a > S.t1) continue;
      const x0 = Math.max(-2, tToX(a)), x1 = Math.min(W + 2, tToX(b));
      if (v === "x") { g.stroke(); g.fillStyle = col.bad + "55"; g.fillRect(x0, top, x1 - x0, bot - top); g.beginPath(); first = true; continue; }
      const yy = v == 1 ? top : bot;
      if (first) { g.moveTo(x0, yy); first = false; } else g.lineTo(x0, yy);
      g.lineTo(x1, yy);
    }
    g.stroke();
    if (d.dense) { g.fillStyle = col.wave + "33"; g.fillRect(0, top, W, bot - top); }
  } else {
    for (const [a, b, v] of segs) {
      if (b < S.t0 || a > S.t1) continue;
      const x0 = tToX(a), x1 = tToX(b), w = x1 - x0, xa = Math.max(0, x0), xb = Math.min(W, x1);
      if (w < 1.5 && !d.dense) continue;
      const bad = v === "x";
      g.fillStyle = bad ? col.bad + "55" : col.bus; g.strokeStyle = bad ? col.bad : col.busl;
      const sl = Math.min(4, Math.max(0, w / 3));
      g.beginPath(); g.moveTo(x0 + sl, top); g.lineTo(x1 - sl, top); g.lineTo(x1, mid); g.lineTo(x1 - sl, bot); g.lineTo(x0 + sl, bot); g.lineTo(x0, mid); g.closePath();
      g.fill(); g.stroke();
      const txt = fmtVal(sig, v), tw = g.measureText(txt).width;
      if (xb - xa > 14) {
        g.fillStyle = col.text; g.textAlign = "center";
        let label = txt;
        if (tw > xb - xa - 8) { const n = Math.max(0, Math.floor((xb - xa - 8) / 6.6) - 1); label = n > 2 ? txt.slice(0, n) + "…" : ""; }
        g.fillText(label, (xa + xb) / 2, mid); g.textAlign = "start";
      }
    }
  }
}

// ---------------------------------------------------------------- FSM + cache views
const FSM_POS = { IDLE: [10, 82], LOOKUP: [150, 82], MISS_REQ: [150, 14], WAIT_MEM: [290, 14], REFILL: [430, 14], COMPLETE: [430, 150] };
function buildFsmSvg() {
  const svg = $("fsm"); svg.setAttribute("viewBox", "0 0 560 215"); svg.replaceChildren();
  svg.insertAdjacentHTML("beforeend", `<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#8a94a6"/></marker></defs>`);
  const arrows = [
    ["M106 100 L150 100", "accept", 128, 94],
    ["M198 82 L198 50", "miss", 212, 70],
    ["M246 32 L290 32", "start", 268, 26],
    ["M386 32 L430 32", "done", 408, 26],
    ["M478 50 L478 150", "always", 506, 104],
    ["M246 108 L430 162", "hit", 330, 128],
    ["M430 186 C 300 215, 80 215, 58 118", "always (response sent)", 250, 207],
  ];
  for (const [d, t, x, y] of arrows)
    svg.insertAdjacentHTML("beforeend", `<path class="arrow" d="${d}"/><text class="lbl" x="${x}" y="${y}">${t}</text>`);
  svg.insertAdjacentHTML("beforeend", `<text class="lbl" x="10" y="62" style="text-anchor:start">bad request → COMPLETE</text>`);
  for (const n of FSM_STATES) {
    const [x, y] = FSM_POS[n];
    svg.insertAdjacentHTML("beforeend", `<g class="st" id="st_${n}"><rect x="${x}" y="${y}" width="96" height="36" rx="8"/><text x="${x + 48}" y="${y + 22}">${n}</text></g>`);
  }
}
function renderFsm() {
  const v = S.values, P = "tb_cache_controller.dut.";
  const st = v[P + "state"]; const idx = st === undefined || st === "x" ? -1 : parseInt(st, 16);
  FSM_STATES.forEach((n, i) => $("st_" + n).classList.toggle("active", i === idx));
  $("fsmTime").textContent = `@ ${fmtTime(S.cursor)} · state ${idx >= 0 ? FSM_STATES[idx] : "unknown"}`;
  const k = $("fsmInfo"); k.replaceChildren();
  const add = (a, b) => k.append(el("b", { textContent: a }), el("span", { textContent: b }));
  const aq = v[P + "addr_q"];
  if (aq !== undefined && aq !== "x") {
    const a = BigInt("0x" + aq);
    add("latched address", "0x" + aq);
    add("tag | index | offset", `0x${(a >> 10n).toString(16)} | ${(a >> 4n) & 63n} | ${a & 15n}`);
  }
  const g = (n) => v["tb_cache_controller." + n];
  add("hit/miss (resp_hit)", g("resp_hit") === undefined ? "–" : (g("resp_hit") == 1 ? "hit" : "miss / idle") + (g("resp_valid") == 1 ? " (response valid)" : ""));
  const dec = (x) => (x === undefined || x === "x" ? "–" : parseInt(x, 16));
  add("requests / hits / misses", `${dec(g("s_req"))} / ${dec(g("s_hit"))} / ${dec(g("s_miss"))}`);
  add("memory reads / wait cycles", `${dec(g("s_mrd"))} / ${dec(g("s_wait"))}`);
}
function renderCache(l) {
  $("cacheTime").textContent = `@ ${fmtTime(S.cursor)} · ${l.lines.filter((x) => x.valid).length}/64 valid`;
  const t = el("table"); t.append(el("thead", {}, el("tr", {}, ...["line", "V", "tag", "data (word3 … word0)"].map((h) => el("th", { textContent: h })))));
  const tb = el("tbody");
  for (const x of l.lines) {
    const cls = [x.valid ? "" : "inv", x.i === l.recent ? "recent" : "", x.i === l.current_index ? "cur" : ""].join(" ").trim();
    tb.append(el("tr", { className: cls }, el("td", { textContent: x.i }), el("td", { textContent: x.valid ? "1" : "0" }),
      el("td", { textContent: x.valid ? "0x" + x.tag : "–" }),
      el("td", { textContent: x.valid ? x.data.match(/.{8}/g).join(" ") : "–" })));
  }
  t.append(tb);
  const box = $("cacheTable"), scrollTop = box.scrollTop;
  box.replaceChildren(t); box.scrollTop = scrollTop;
  const rec = box.querySelector("tr.recent"); if (rec && l.recent !== S.lastRecent) { rec.scrollIntoView({ block: "nearest" }); }
  S.lastRecent = l.recent;
}

init().catch((e) => setStatus("Portal failed to start: " + e.message, true));
