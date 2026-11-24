"use strict";
// Core: application state, backend API, run management, and the waveform canvas component.
// Every number, waveform and table shown in the portal is read from the backend, which reads it from the VCD that
// Icarus Verilog wrote for the selected run (or from the RTL source for configuration). Nothing is invented here.

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const P = "tb_cache_controller.";
const PAGES = [["simulation", "Simulation", "play"], ["cache", "Cache Viewer", "layers"], ["waveform", "Waveform", "activity"],
  ["trace", "Access Trace", "list"]];

const App = {
  page: "simulation", params: {}, cfg: null, scen: null, runs: [], run: null, info: null, tr: null,
  sel: { acc: null, line: null }, offline: false, loadSeq: 0, lines: new Map(), events: [], busy: false,
  wv: { cursor: 0, t0: null, t1: null, radix: "hex", mode: null, vis: null, collapsed: new Set(), fullView: null },
  form: { scenario: "full_suite", latency: 4 },
  listeners: [],
};
const onChange = (fn) => App.listeners.push(fn);
const notify = (what) => App.listeners.forEach((f) => f(what));

// ---------------------------------------------------------------- formatting
const hex = (n, w = 0) => "0x" + Number(n).toString(16).toUpperCase().padStart(w, "0");
const bin = (n, w) => Number(n).toString(2).padStart(w, "0");
const pct = (x, d = 1) => (x == null ? "–" : (100 * x).toFixed(d) + "%");
const num = (x, d = 2) => (x == null ? "–" : Number(x).toFixed(d).replace(/\.?0+$/, ""));
function ns(t) { return t * (App.info ? App.info.tick_ns : 0.001); }
function fmtNs(t) { const v = ns(t); return Math.abs(v) >= 1000 ? (v / 1000).toFixed(3) + " µs" : (Math.round(v * 10) / 10) + " ns"; }
function stateClass(name) { return name === "MISS_REQ" ? "n-red" : name === "WAIT_MEM" || name === "REFILL" ? "n-purple" : "n-green"; }
const stateName = (code) => (App.cfg?.states.find((s) => s.code === code)?.name) ?? `S${code}`;

// ---------------------------------------------------------------- backend API + offline handling
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
let retryTimer = null, retryDelay = 3000;
function setOffline(off) {
  if (App.offline === off) return;
  App.offline = off;
  notify("offline");
  if (off) {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(function probe() {
      fetch("/api/config", { cache: "no-store" }).then((r) => { if (!r.ok) throw 0; setOffline(false); location.reload(); })
        .catch(() => { retryDelay = Math.min(retryDelay * 1.6, 20000); retryTimer = setTimeout(probe, retryDelay); });
    }, retryDelay);
  } else retryDelay = 3000;
}
async function api(path, opts) {
  if (App.offline && !(opts && opts.probe)) throw new HttpError(0, "backend offline");
  let r;
  try { r = await fetch(path, opts); } catch (e) { if (e.name === "AbortError") throw e; setOffline(true); throw new HttpError(0, "backend offline"); }
  const j = await r.json().catch(() => ({ error: "bad response" }));
  if (!r.ok) throw new HttpError(r.status, j.error || r.statusText);
  return j;
}
const quiet = (e) => !!e && (e.name === "AbortError" || e.status === 0);

// ---------------------------------------------------------------- navigation
function paramsFromState(extra = {}) {
  const p = new URLSearchParams();
  if (App.run) p.set("run", App.run.run_id);
  if (App.sel.acc != null) p.set("acc", App.sel.acc);
  if (App.sel.line != null) p.set("line", App.sel.line);
  for (const [k, v] of Object.entries(extra)) { if (v == null) p.delete(k); else p.set(k, v); }
  return p.toString();
}
const href = (page, extra) => `#/${page}?${paramsFromState(extra)}`;
const go = (page, extra) => { location.hash = href(page, extra); };
function syncUrl() { history.replaceState(null, "", href(App.page)); }

// ---------------------------------------------------------------- selection (shared across pages)
function accessByN(n) { return App.tr?.accesses.find((a) => a.n === n) ?? null; }
function selAccess() { return App.sel.acc == null ? null : accessByN(App.sel.acc); }
function selectAccess(n, { quiet: q } = {}) {
  const a = accessByN(n);
  if (!a) return;
  App.sel.acc = a.n;
  if (a.index != null) App.sel.line = a.index;
  App.wv.cursor = a.accept_t;
  if (!q) notify("sel");
  syncUrl();
}
function defaultSelection() {
  const list = App.tr?.accesses ?? [];
  const pick = list.find((a) => a.n === App.sel.acc) || list.find((a) => a.result === "miss") || list[0];
  if (pick) { App.sel.acc = pick.n; if (App.sel.line == null && pick.index != null) App.sel.line = pick.index; App.wv.cursor = pick.accept_t; }
  else { App.sel.acc = null; }
}
function snapshotTime() {            // the time at which Cache Viewer / dashboard snapshots are taken
  const a = selAccess();
  if (a && a.resp_t != null) return a.resp_t;
  return App.tr ? App.tr.end_t : 0;
}
async function getLines(t) {
  const key = `${App.run.run_id}:${t}`;
  if (App.lines.has(key)) return App.lines.get(key);
  const d = await api(`/api/run/${App.run.run_id}/lines?t=${t}`);
  App.lines.set(key, d);
  if (App.lines.size > 40) App.lines.delete(App.lines.keys().next().value);
  return d;
}

// ---------------------------------------------------------------- runs
const ACTIVE = new Set(["queued", "running"]);
const SC_OK = (m) => !!App.scen && App.scen.scenarios.some((s) => s.id === m.scenario) && App.scen.latencies.includes(m.latency);
async function refreshRuns() { App.runs = await api("/api/runs"); notify("runs"); return App.runs; }
function clearRun(msg) {
  App.run = null; App.info = null; App.tr = null; App.events = []; App.sel = { acc: null, line: null }; App.lines.clear(); App.runError = msg || null;
  try { localStorage.removeItem("cachePortal.run"); } catch (e) { /* storage unavailable */ }
  notify("run");
}
async function loadRun(id) {
  const seq = ++App.loadSeq;
  let meta;
  try { meta = await api(`/api/run/${id}/meta`); }
  catch (e) {
    if (e.status === 404) { await refreshRuns().catch(() => {}); clearRun("That run no longer exists on disk. Choose another run or start a new simulation."); }
    return;
  }
  if (seq !== App.loadSeq) return;
  const changed = !App.run || App.run.run_id !== id;
  App.run = meta; App.runError = null;
  if (SC_OK(meta)) App.form = { scenario: meta.scenario, latency: meta.latency };
  if (changed) { App.info = null; App.tr = null; App.events = []; App.lines.clear(); App.wv.t0 = App.wv.t1 = null; App.wv.vis = null; App.wv.mode = null; App.wv.fullView = null; }
  try { localStorage.setItem("cachePortal.run", id); } catch (e) { /* ignore */ }
  notify("run");
  while (ACTIVE.has(App.run.status)) {            // simulation still running: poll its phase
    await new Promise((r) => setTimeout(r, 450));
    if (seq !== App.loadSeq) return;
    try { App.run = await api(`/api/run/${id}/meta`); } catch (e) { return; }
    notify("phase");
  }
  await refreshRuns().catch(() => {});
  if (App.run.vcd && App.run.status !== "compile_error") {
    try {
      const [info, tr] = await Promise.all([api(`/api/run/${id}/signals`), api(`/api/run/${id}/accesses`).catch((e) => { if (e.status === 404) return null; throw e; })]);
      if (seq !== App.loadSeq) return;
      App.info = info; App.tr = tr;
      App.events = tr ? [...new Set(tr.accesses.flatMap((a) => [a.accept_t, a.resp_t].filter((x) => x != null)))].sort((a, b) => a - b) : [];
      const want = App.params.acc != null ? Number(App.params.acc) : null;
      if (want != null && accessByN(want)) App.sel.acc = want;
      if (App.params.line != null) App.sel.line = Number(App.params.line);
      defaultSelection();
    } catch (e) { if (!quiet(e)) App.runError = "Could not read the waveform: " + e.message; }
  }
  notify("run");
}
async function startRun(scenario, latency) {
  App.busy = true; notify("busy");
  try {
    const meta = await api("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenario, latency }) });
    App.sel = { acc: null, line: null };
    App.params = {};
    await refreshRuns();
    history.replaceState(null, "", `#/${App.page}?run=${meta.run_id}`);
    await loadRun(meta.run_id);
  } catch (e) { App.runError = e.status === 0 ? "The backend is not running. Start it with: make portal" : "Could not start the run: " + e.message; notify("run"); }
  App.busy = false; notify("busy");
}
async function deleteRun(id) {
  await api("/api/run/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ run_id: id }) });
  await refreshRuns();
  if (App.run && App.run.run_id === id) {
    const next = App.runs.find((r) => !ACTIVE.has(r.status));
    if (next) { await loadRun(next.run_id); } else clearRun(null);
  }
}

// ---------------------------------------------------------------- signal formatting
function fmtVal(sig, v, radix = App.wv.radix) {
  if (v === undefined || v === null) return "";
  if (v === "x") return "x";
  if (sig.fmt === "state") return stateName(parseInt(v, 16));
  if (sig.fmt === "mstate") return App.info.mstates[parseInt(v, 16)] ?? "?" + v;
  if (sig.width === 1) return String(v);
  const n = BigInt("0x" + v);
  if (radix === "raw") return n.toString(2).padStart(sig.width, "0").replace(/(.{4})(?=.)/g, "$1_");
  if (radix === "bin") return "0b" + n.toString(2);
  if (radix === "dec" || sig.fmt === "dec") return n.toString(10);
  return "0x" + v.toUpperCase();
}

// ---------------------------------------------------------------- waveform canvas component
const COL = { clk: "#27d3ee", rst: "#b49bfa", req: "#5da8ff", hit: "#34d399", err: "#e2626d", mem: "#38bdf8", def: "#27d3ee" };
function sigColor(sig) {
  const l = sig.label;
  if (l === "clk") return COL.clk;
  if (l === "rst_n") return COL.rst;
  if (l.startsWith("resp_hit") || l === "hit compare") return COL.hit;
  if (l === "resp_err") return COL.err;
  if (l.startsWith("req_")) return COL.req;
  if (sig.group === "Memory interface") return COL.mem;
  return COL.def;
}
class Wave {
  constructor(canvas, o = {}) {
    Object.assign(this, { canvas, view: App.wv, rowH: 28, grpH: 24, ruler: 30, interactive: true, rows: [], data: {}, win: null, ctl: null, timer: null, onCursor: null, onView: null, onSelect: null, selectDrag: false, overlay: null, ticks: false, band: null, dead: false }, o);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement);
    if (this.interactive) this.bindEvents();
  }
  destroy() { this.dead = true; this.ro.disconnect(); this.ctl?.abort(); clearTimeout(this.timer); window.removeEventListener("mousemove", this._mm); window.removeEventListener("mouseup", this._mu); }
  get W() { return this.canvas.clientWidth; }
  get t0() { return this.view.t0; } get t1() { return this.view.t1; }
  setRows(rows) { this.rows = rows; this.resize(); }
  height() { return this.ruler + this.rows.reduce((a, r) => a + (r.type === "grp" ? this.grpH : this.rowH), 0); }
  xOf(t) { return ((t - this.t0) / (this.t1 - this.t0)) * this.W; }
  tOf(x) { return this.t0 + (x / this.W) * (this.t1 - this.t0); }
  resize() {
    if (this.dead || !App.info) return;
    const c = this.canvas, dpr = window.devicePixelRatio || 1, h = this.height();
    c.style.height = h + "px"; c.width = Math.max(1, Math.round(c.clientWidth * dpr)); c.height = Math.round(h * dpr);
    c.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw(); this.scheduleFetch(0);
  }
  scheduleFetch(d = 80) { clearTimeout(this.timer); this.timer = setTimeout(() => this.fetch(), d); }
  async fetch() {
    if (this.dead || !App.run || !App.info || App.offline) return;
    const w = this.t1 - this.t0, m = w * 0.5, a = Math.max(0, Math.floor(this.t0 - m)), b = Math.min(App.info.end_time, Math.ceil(this.t1 + m)) || this.t1;
    const paths = this.rows.filter((r) => r.type === "sig").map((r) => r.sig.path);
    if (!paths.length || b <= a) { this.draw(); return; }
    this.ctl?.abort(); const ctl = (this.ctl = new AbortController());
    const px = Math.min(4000, Math.round(this.W * (b - a) / w) + 50), id = App.run.run_id;
    try {
      const d = await api(`/api/run/${id}/wave?signals=${encodeURIComponent(paths.join(","))}&t0=${a}&t1=${b}&px=${px}`, { signal: ctl.signal });
      if (this.dead || !App.run || App.run.run_id !== id) return;
      this.data = d.signals; this.win = [a, b]; this.draw();
    } catch (e) { if (!quiet(e) && e.status !== 404 && e.status !== 409) console.warn("wave:", e.message); }
  }
  setView(a, b) {
    const full = Math.max(1, App.info.end_time), minW = Math.max(4, 2 / App.info.tick_ns);
    const w = Math.max(minW, Math.min(full, b - a));
    a = Math.max(0, Math.min(full - w, a));
    this.view.t0 = a; this.view.t1 = a + w;
    this.draw(); this.scheduleFetch(); this.onView?.();
  }
  zoom(f, about) { const w = this.t1 - this.t0, c = about ?? (this.t0 + w / 2), nw = w * f, fr = (c - this.t0) / w; this.setView(c - nw * fr, c + nw * (1 - fr)); }
  pan(fr) { const w = this.t1 - this.t0; this.setView(this.t0 + w * fr, this.t1 + w * fr); }
  fit() { this.setView(0, App.info.end_time); }
  centerOn(t) { const w = this.t1 - this.t0; this.setView(t - w / 2, t + w / 2); }
  setCursor(t, silent) {
    this.view.cursor = Math.max(0, Math.min(App.info.end_time, Math.round(t)));
    this.draw(); if (!silent) this.onCursor?.(this.view.cursor);
  }
  clock() {
    const c = this.data[P + "clk"];
    if (c) { const r = c.points.filter((p) => p[1] === 1).map((p) => p[0]); if (r.length > 1) return r[1] - r[0]; }
    return 10 / App.info.tick_ns;
  }
  bindEvents() {
    const c = this.canvas; c.tabIndex = 0; let drag = null;
    c.addEventListener("mousedown", (e) => {
      const r = c.getBoundingClientRect();
      drag = { x0: e.clientX, a: this.t0, b: this.t1, moved: false, ruler: e.clientY - r.top < this.ruler, sel: false };
      drag.sel = !drag.ruler && (this.selectDrag || e.shiftKey);
      if (drag.ruler) this.setCursor(this.tOf(e.clientX - r.left));
      c.focus();
    });
    this._mm = (e) => {
      if (!drag) return; const r = c.getBoundingClientRect();
      if (drag.ruler) { this.setCursor(this.tOf(e.clientX - r.left)); return; }
      if (drag.sel) { if (Math.abs(e.clientX - drag.x0) > 3) drag.moved = true; if (drag.moved) { this.band = [this.tOf(drag.x0 - r.left), this.tOf(e.clientX - r.left)]; this.draw(); c.style.cursor = "col-resize"; } return; }
      const dx = e.clientX - drag.x0; if (Math.abs(dx) > 3) drag.moved = true;
      if (drag.moved) { const dt = -dx * (drag.b - drag.a) / r.width; this.setView(drag.a + dt, drag.b + dt); c.style.cursor = "grabbing"; }
    };
    this._mu = (e) => {
      if (!drag) return; const r = c.getBoundingClientRect();
      if (drag.sel && drag.moved && this.band) {
        const [p, q] = this.band, a = Math.min(p, q), b = Math.max(p, q); this.band = null;
        if (this.onSelect) this.onSelect(a, b); else this.setView(a, b);
      } else if (!drag.moved && !drag.ruler) this.setCursor(this.tOf(e.clientX - r.left));
      this.band = null; drag = null; c.style.cursor = "crosshair"; this.draw();
    };
    window.addEventListener("mousemove", this._mm); window.addEventListener("mouseup", this._mu);
    c.addEventListener("wheel", (e) => {
      e.preventDefault(); const r = c.getBoundingClientRect();
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) this.pan((e.deltaX || e.deltaY) / r.width);
      else this.zoom(e.deltaY < 0 ? 0.8 : 1.25, this.tOf(e.clientX - r.left));
    }, { passive: false });
    c.addEventListener("keydown", (e) => {
      const step = this.clock() * (e.shiftKey ? 10 : 1);
      if (e.key === "ArrowLeft") { this.setCursor(this.view.cursor - step); e.preventDefault(); }
      else if (e.key === "ArrowRight") { this.setCursor(this.view.cursor + step); e.preventDefault(); }
      else if (e.key === "+" || e.key === "=") this.zoom(0.5, this.view.cursor);
      else if (e.key === "-") this.zoom(2, this.view.cursor);
      else if (e.key === "0") this.fit();
    });
  }
  draw() {
    if (this.dead || !App.info || this.t0 == null) return;
    const c = this.canvas, g = c.getContext("2d"), W = this.W, H = parseFloat(c.style.height) || this.height();
    g.clearRect(0, 0, W, H);
    // lanes
    let y = this.ruler, i = 0;
    for (const r of this.rows) {
      const h = r.type === "grp" ? this.grpH : this.rowH;
      g.fillStyle = r.type === "grp" ? "#1b2147" : i++ % 2 ? "rgba(21,26,59,.55)" : "rgba(10,13,34,.55)"; g.fillRect(0, y, W, h); y += h;
    }
    // ruler
    const span = ns(this.t1 - this.t0), target = span / (W / 100), mag = Math.pow(10, Math.floor(Math.log10(target)));
    let step = 10 * mag; for (const m of [1, 2, 5, 10]) if (m * mag >= target) { step = m * mag; break; }
    g.font = "11px ui-monospace, Menlo, monospace"; g.textBaseline = "middle"; g.lineWidth = 1;
    for (let v = Math.ceil(ns(this.t0) / step) * step; v <= ns(this.t1); v += step) {
      const x = Math.round(this.xOf(v / App.info.tick_ns)) + 0.5;
      g.strokeStyle = "rgba(54,62,132,.55)"; g.beginPath(); g.moveTo(x, this.ruler - 7); g.lineTo(x, H); g.stroke();
      g.fillStyle = "#98a0cc"; g.fillText(step >= 1000 ? (v / 1000) + " µs" : v + " ns", x + 4, this.ruler / 2 - 2);
    }
    g.strokeStyle = "rgba(54,62,132,.9)"; g.beginPath(); g.moveTo(0, this.ruler - .5); g.lineTo(W, this.ruler - .5); g.stroke();
    y = this.ruler;
    for (const r of this.rows) { if (r.type === "grp") { y += this.grpH; continue; } this.drawSig(g, r.sig, y, W); y += this.rowH; }
    if (this.ticks) this.drawTicks(g, W);
    this.overlay?.(g, W, H);
    if (this.band) {
      const bx0 = this.xOf(Math.min(...this.band)), bx1 = this.xOf(Math.max(...this.band));
      g.fillStyle = "rgba(39,211,238,.16)"; g.fillRect(bx0, this.ruler, bx1 - bx0, H - this.ruler);
      g.strokeStyle = "#27d3ee"; g.lineWidth = 1; g.strokeRect(bx0 + .5, this.ruler + .5, bx1 - bx0, H - this.ruler - 1);
    }
    // cursor
    const cx = Math.round(this.xOf(this.view.cursor)) + 0.5;
    if (cx >= 0 && cx <= W) {
      g.strokeStyle = "rgba(232,234,255,.18)"; g.lineWidth = 6; g.beginPath(); g.moveTo(cx, this.ruler - 4); g.lineTo(cx, H); g.stroke();
      g.strokeStyle = "#f4f5ff"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(cx, this.ruler - 4); g.lineTo(cx, H); g.stroke();
      g.fillStyle = "#f4f5ff"; g.beginPath(); g.moveTo(cx - 6, 3); g.lineTo(cx + 6, 3); g.lineTo(cx, 12); g.closePath(); g.fill();
    }
    if (!this.win || this.t0 < this.win[0] || this.t1 > this.win[1]) { g.fillStyle = "#98a0cc"; g.textAlign = "right"; g.fillText("loading…", W - 8, this.ruler / 2); g.textAlign = "start"; }
  }
  drawTicks(g, W) {                     // one coloured mark per real access (hit / miss / error), from the access trace
    const list = App.tr?.accesses; if (!list) return;
    const y = this.ruler - 6; let lastPx = -1, lastK = "";
    for (const a of list) {
      const end = a.resp_t ?? a.accept_t; if (end < this.t0 || a.accept_t > this.t1) continue;
      const x0 = Math.floor(this.xOf(a.accept_t)), x1 = Math.max(x0 + 1, Math.ceil(this.xOf(end)));
      const k = a.result === "hit" ? "#34d399" : a.result === "miss" ? "#e2626d" : "#e9c35c";
      if (x1 - x0 <= 1 && x0 === lastPx && k === lastK) continue;
      g.fillStyle = k; g.fillRect(x0, y, x1 - x0, 5); lastPx = x0; lastK = k;
    }
  }
  rowTops() {                           // y of each signal row, for overlays
    const o = {}; let y = this.ruler;
    for (const r of this.rows) { if (r.type === "grp") { y += this.grpH; continue; } o[r.sig.path] = y; y += this.rowH; }
    return o;
  }
  drawSig(g, sig, y, W) {
    const d = this.data[sig.path]; if (!d) return;
    const top = y + 6, bot = y + this.rowH - 6, mid = (top + bot) / 2, color = sigColor(sig);
    const segs = []; let cur = d.init, ts = this.win ? this.win[0] : this.t0;
    for (const [t, v] of d.points) { segs.push([ts, t, cur]); cur = v; ts = t; }
    segs.push([ts, App.info.end_time + 1, cur]);
    if (sig.width === 1 && sig.fmt !== "state") {
      g.strokeStyle = color; g.lineWidth = 2; g.beginPath(); let first = true;
      for (const [a, b, v] of segs) {
        if (b < this.t0 || a > this.t1) continue;
        const x0 = Math.max(-2, this.xOf(a)), x1 = Math.min(W + 2, this.xOf(b));
        if (v === "x") { g.stroke(); g.fillStyle = "rgba(226,98,109,.25)"; g.fillRect(x0, top, x1 - x0, bot - top); g.beginPath(); first = true; continue; }
        const yy = v == 1 ? top : bot;
        if (first) { g.moveTo(x0, yy); first = false; } else g.lineTo(x0, yy);
        g.lineTo(x1, yy);
      }
      g.stroke();
      if (d.dense) { g.fillStyle = color + "33"; g.fillRect(0, top, W, bot - top); }
      return;
    }
    g.lineWidth = 1.4;
    for (const [a, b, v] of segs) {
      if (b < this.t0 || a > this.t1) continue;
      const x0 = this.xOf(a), x1 = this.xOf(b), w = x1 - x0, xa = Math.max(0, x0), xb = Math.min(W, x1);
      if (w < 1.5 && !d.dense) continue;
      const bad = v === "x"; let stroke = color, fill = "rgba(39,211,238,.07)";
      if (sig.fmt === "state") {
        const cls = stateClass(stateName(parseInt(v, 16)));
        stroke = cls === "n-red" ? "#e2626d" : cls === "n-purple" ? "#b49bfa" : "#34d399";
        fill = cls === "n-red" ? "rgba(226,98,109,.16)" : cls === "n-purple" ? "rgba(139,92,246,.2)" : "rgba(52,211,153,.12)";
      }
      if (bad) { stroke = "#e2626d"; fill = "rgba(226,98,109,.25)"; }
      g.fillStyle = fill; g.strokeStyle = stroke;
      const r = Math.min(9, (bot - top) / 2, w / 2);
      g.beginPath(); g.moveTo(x0 + r, top); g.lineTo(x1 - r, top); g.quadraticCurveTo(x1, top, x1, mid); g.quadraticCurveTo(x1, bot, x1 - r, bot);
      g.lineTo(x0 + r, bot); g.quadraticCurveTo(x0, bot, x0, mid); g.quadraticCurveTo(x0, top, x0 + r, top); g.closePath(); g.fill(); g.stroke();
      if (xb - xa > 16) {
        const txt = fmtVal(sig, v), tw = g.measureText(txt).width; let label = txt;
        if (tw > xb - xa - 10) { const n = Math.max(0, Math.floor((xb - xa - 10) / 6.6) - 1); label = n > 2 ? txt.slice(0, n) + "…" : ""; }
        g.fillStyle = "#e8eaff"; g.textAlign = "center"; g.fillText(label, (xa + xb) / 2, mid + .5); g.textAlign = "start";
      }
    }
  }
}
function nextEvent(t, dir) {
  const ev = App.events; if (!ev.length) return null;
  if (dir > 0) return ev.find((e) => e > t) ?? null;
  for (let i = ev.length - 1; i >= 0; i--) if (ev[i] < t) return ev[i];
  return null;
}
