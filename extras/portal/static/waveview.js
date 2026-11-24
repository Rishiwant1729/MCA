"use strict";
// Waveform page: three viewing modes (Overview, Single Access, Full Waveform) on top of the windowed Wave canvas.
// Time ranges come from the access trace (accept_t / resp_t read from the VCD); FSM transitions and memory operations
// shown for an access are the real signal changes the backend returns for that interval. Nothing is estimated.

let wave = null, valTimer = null, accTok = 0;

// presentation grouping: label -> [group, shown in Overview, shown in Single Access]
const VG = ["Clock & Reset", "CPU Interface", "Cache Logic", "FSM", "Memory Interface", "Cache Refill", "Statistics & Testbench"];
const VMAP = {
  "clk": ["Clock & Reset", 1, 1], "rst_n": ["Clock & Reset", 1, 1],
  "req_valid": ["CPU Interface", 1, 1], "req_ready": ["CPU Interface", 0, 1], "req_addr": ["CPU Interface", 0, 1], "req_we": ["CPU Interface", 0, 0],
  "resp_valid": ["CPU Interface", 1, 1], "resp_rdata": ["CPU Interface", 0, 1], "resp_hit (hit/miss)": ["CPU Interface", 1, 1], "resp_err": ["CPU Interface", 0, 1],
  "hit compare": ["Cache Logic", 1, 1], "line index": ["Cache Logic", 0, 1], "tag": ["Cache Logic", 0, 1], "latched addr": ["Cache Logic", 0, 1],
  "FSM state": ["FSM", 1, 1],
  "mem_req_valid": ["Memory Interface", 1, 1], "mem_req_ready": ["Memory Interface", 0, 1], "mem_req_addr": ["Memory Interface", 0, 1],
  "mem_resp_valid": ["Memory Interface", 1, 1], "mem_resp_data": ["Memory Interface", 0, 0], "mem-if state": ["Memory Interface", 0, 1],
  "refill active": ["Cache Refill", 1, 1], "refill block": ["Cache Refill", 0, 0],
};
const MODES = [["overview", "Overview"], ["access", "Single Access"], ["full", "Full Waveform"]];
const vgroup = (s) => (VMAP[s.label] ? VMAP[s.label][0] : (s.group === "Statistics" || s.group === "Testbench") ? "Statistics & Testbench" : s.group);
const allSigs = () => [...App.info.signals, ...(App.info.extra || []).map((e) => ({ ...e, fmt: e.width === 1 ? "bit" : "hex" }))];
const sigByPath = (p) => allSigs().find((s) => s.path === p);
function defaultVis(mode) {
  if (mode === "full") return new Set(App.info.signals.map((s) => s.path));          // no filtering in Full mode
  const col = mode === "overview" ? 1 : 2;
  return new Set(App.info.signals.filter((s) => VMAP[s.label]?.[col]).map((s) => s.path));
}
function visibleSet() {
  if (!App.wv.vis) App.wv.vis = {};
  const m = App.wv.mode;
  if (!App.wv.vis[m]) App.wv.vis[m] = defaultVis(m);
  return App.wv.vis[m];
}
function waveRows() {
  const vis = visibleSet(), sigs = allSigs().filter((s) => vis.has(s.path)), rows = [];
  const groups = [...VG, ...new Set(sigs.map(vgroup))].filter((g, i, a) => a.indexOf(g) === i);
  for (const g of groups) {
    const list = sigs.filter((s) => vgroup(s) === g);
    if (!list.length) continue;
    rows.push({ type: "grp", name: g, count: list.length });
    if (!App.wv.collapsed.has(g)) list.forEach((s) => rows.push({ type: "sig", sig: s }));
  }
  return rows;
}

// ---------------------------------------------------------------- time ranges
const clkTicks = () => (App.tr?.clock_ns || 10) / App.info.tick_ns;
function accessRange(a, ctx = 3) {           // [accept edge, response edge] plus a few clocks of context either side
  const c = clkTicks(), end = a.resp_t ?? a.accept_t + 20 * c;
  return [Math.max(0, a.accept_t - ctx * c), Math.min(App.info.end_time, end + ctx * c)];
}
function modeDefaultView(mode) {
  const a = selAccess();
  if (mode === "access" && a) return accessRange(a);
  if (mode === "full" && App.wv.fullView) return App.wv.fullView;
  return [0, App.info.end_time];
}
function setMode(mode, params = {}) {
  if (!App.info) return;
  if (App.wv.mode === "full" && wave) App.wv.fullView = [App.wv.t0, App.wv.t1];
  if (mode === "access" && !selAccess()) { defaultSelection(); }
  if (mode === "access" && !selAccess()) mode = "overview";
  App.wv.mode = mode;
  [App.wv.t0, App.wv.t1] = modeDefaultView(mode);
  if (params.cursor != null) App.wv.cursor = params.cursor;
  render();
}
function stepAccess(dir) {
  const list = App.tr?.accesses ?? []; if (!list.length) return;
  const i = list.findIndex((x) => x.n === App.sel.acc);
  const next = list[Math.max(0, Math.min(list.length - 1, i < 0 ? 0 : i + dir))];
  selectAccess(next.n, { quiet: true });
  if (App.wv.mode === "full") { const [a, b] = accessRange(next); wave.setView(a, b); wave.setCursor(next.accept_t); paintAll(); }
  else setMode("access");
}
function fitSelected() {
  if (!selAccess()) defaultSelection();
  const a = selAccess(); if (!a) return;
  if (App.wv.mode === "full") { const [x, y] = accessRange(a); wave.setView(x, y); wave.setCursor(a.accept_t); paintAll(); }
  else setMode("access");
}
function resetView() {
  App.wv.collapsed = new Set(); if (App.wv.vis) delete App.wv.vis[App.wv.mode];
  if (App.wv.mode === "full") App.wv.fullView = null;
  [App.wv.t0, App.wv.t1] = modeDefaultView(App.wv.mode);
  render();
}
function showImportant() {
  App.wv.vis = App.wv.vis || {};
  App.wv.vis[App.wv.mode] = defaultVis(App.wv.mode === "overview" ? "overview" : "access");
  applyRows(); paintInfo();
}

// ---------------------------------------------------------------- page
function pageWaveform() {
  const T = "Waveform Viewer (VCD)", S = "Visualize simulation signals, timing and state transitions";
  const bad = needsData(); if (bad) return head("activity", T, S) + bad;
  const hasAcc = !!App.tr?.accesses.length;
  if (!App.wv.mode) {                       // default: Single Access on the selected access (first miss if none selected)
    if (hasAcc && !selAccess()) defaultSelection();
    App.wv.mode = hasAcc ? "access" : "overview";
    if (App.wv.mode === "access") { App.wv.cursor = selAccess().accept_t; App.wv.t0 = App.wv.t1 = null; }
  }
  const r = App.run, m = App.wv.mode;
  const b = (id, ic, label, tip, dis) => `<button class="btn sm" id="${id}" title="${tip}" ${dis ? "disabled" : ""}>${icon(ic, 14)} ${label}</button>`;
  return head("activity", T, S, `<label class="f"><span class="sr">VCD file</span><select id="wFile" aria-label="VCD file of this run" style="min-width:210px"><option>${esc(r.vcd.file)} — ${esc(r.run_id)}</option></select></label>
      <span class="chip cur" id="wTime">t = ${esc(fmtNs(App.wv.cursor))}</span>`) + `
  <section class="panel">
    <div class="wtool" style="margin-bottom:10px"><div class="seg" role="tablist" aria-label="Viewing mode" id="wModes">${MODES.map(([id, l]) =>
      `<button class="pill ${id === m ? "on" : ""}" role="tab" aria-selected="${id === m}" data-m="${id}" ${id === "access" && !hasAcc ? "disabled" : ""}>${l}</button>`).join("")}</div>
      <span class="note" id="wModeNote"></span></div>
    <div class="wtool" style="margin-bottom:10px">
      ${b("wZin", "zoomin", "Zoom In", "Zoom in (+)")}${b("wZout", "zoomout", "Zoom Out", "Zoom out (−)")}${b("wFit", "fit", "Fit Entire Simulation", "Show the whole timeline (0)")}
      ${b("wFitAcc", "pointer", "Fit Selected Access", "Zoom to the selected access", !hasAcc)}${b("wPrevA", "left", "Previous Access", "Previous access", !hasAcc)}${b("wNextA", "right", "Next Access", "Next access", !hasAcc)}
      ${b("wImp", "list", "Show Important Signals", "Show only the key signals for this mode")}${b("wReset", "reset", "Reset View", "Restore this mode's default zoom and signals")}</div>
    <div id="wBanner"></div>
    <div class="wtool" style="margin-bottom:10px">
      <label class="f" style="flex-direction:row;align-items:center;gap:8px">Radix<select id="wRadix"><option value="hex">hex</option><option value="bin">binary</option><option value="dec">decimal</option><option value="raw">raw bits</option></select></label>
      <span style="position:relative"><button class="btn sm" id="wSigBtn" aria-expanded="false">${icon("list", 14)} Choose signals</button><div class="sigmenu" id="wSigMenu" hidden></div></span>
      <span class="note">scroll = zoom · drag = ${m === "overview" ? "select a region to zoom" : "pan (shift+drag selects a region)"} · click or drag the ruler = move cursor · ← → step one clock · coloured marks under the ruler: <b style="color:var(--green)">hit</b> / <b style="color:var(--red)">miss</b></span></div>
    <div class="wbox" id="wBox"><div class="wnames" id="wNames"></div><div class="wcanvas"><canvas id="wCanvas" aria-label="Waveform. Click to place the cursor."></canvas></div></div>
    <input type="range" class="hscroll" id="wScroll" min="0" max="1000" value="0" aria-label="Horizontal position"></section>
  <div class="grid g3">
    <section class="panel" aria-labelledby="h-ti"><h2 class="ph" id="h-ti">${icon("info", 20)} Trace Info</h2><div class="kv" id="wInfo"></div></section>
    <section class="panel" aria-labelledby="h-cu"><h2 class="ph" id="h-cu">${icon("pointer", 20)} Cursor</h2><div class="kv" id="wCur"></div><div id="wCurAcc" style="margin-top:8px"></div></section>
    <section class="panel" aria-labelledby="h-stl"><h2 class="ph" id="h-stl">${icon("fsm", 20)} Access Events</h2><div id="wTl"></div></section>
  </div>`;
}
function bindWaveform() {
  wave?.destroy(); wave = null;
  if (!App.info) return;
  const full = App.info.end_time, cvs = $("#wCanvas");
  // arriving from the Access Trace (?mode=access&acc=N): switch to Single Access mode on that access's real time range
  if (App.params.mode) {
    const want = App.params.mode; delete App.params.mode; syncUrl();
    if (want === "access" && selAccess()) { App.wv.mode = "access"; [App.wv.t0, App.wv.t1] = accessRange(selAccess()); App.wv.cursor = selAccess().accept_t; render(); return; }
  }
  if (App.wv.t0 == null) [App.wv.t0, App.wv.t1] = modeDefaultView(App.wv.mode);
  const m = App.wv.mode;
  wave = new Wave(cvs, { view: App.wv, onCursor: onWaveCursor, onView: () => { syncScroll(); paintModeNote(); },
    selectDrag: m === "overview", ticks: true, overlay: wvOverlay });
  $("#wRadix").value = App.wv.radix;
  $("#wRadix").onchange = (e) => { App.wv.radix = e.target.value; wave.draw(); paintNames(); paintCursorPanel(); };
  $$("#wModes [data-m]").forEach((x) => (x.onclick = () => setMode(x.dataset.m)));
  $("#wZin").onclick = () => wave.zoom(0.5); $("#wZout").onclick = () => wave.zoom(2); $("#wFit").onclick = () => wave.fit();
  $("#wFitAcc").onclick = fitSelected; $("#wPrevA").onclick = () => stepAccess(-1); $("#wNextA").onclick = () => stepAccess(1);
  $("#wImp").onclick = showImportant; $("#wReset").onclick = resetView;
  $("#wScroll").oninput = (e) => { const w = App.wv.t1 - App.wv.t0, mx = Math.max(0, full - w), s = (e.target.value / 1000) * mx; wave.view.t0 = s; wave.view.t1 = s + w; wave.draw(); wave.scheduleFetch(); paintModeNote(); };
  $("#wSigBtn").onclick = () => { const mm = $("#wSigMenu"); mm.hidden = !mm.hidden; $("#wSigBtn").setAttribute("aria-expanded", String(!mm.hidden)); if (!mm.hidden) buildSigMenu(); };
  wave.setRows(waveRows()); paintAll(); onWaveCursor(App.wv.cursor, true);
  loadAccessEvents();
}
function paintAll() { paintNames(); paintInfo(); syncScroll(); paintBanner(); paintModeNote(); paintCursorPanel(); }
function syncScroll() { const w = App.wv.t1 - App.wv.t0, mx = App.info.end_time - w, s = $("#wScroll"); if (s) s.value = mx > 0 ? Math.round((App.wv.t0 / mx) * 1000) : 0; }
function paintModeNote() {
  const n = $("#wModeNote"); if (!n) return;
  const txt = { overview: "Whole timeline, key signals only", access: "Zoomed to one access with a few clocks of context", full: "Every recorded signal, no default filtering" }[App.wv.mode];
  n.textContent = `${txt} · view ${fmtNs(App.wv.t0)} – ${fmtNs(App.wv.t1)} of ${fmtNs(App.info.end_time)}`;
}
function paintBanner() {
  const box = $("#wBanner"); if (!box) return;
  const a = selAccess();
  if (!a) { box.innerHTML = ""; return; }
  const cls = a.result === "hit" ? "tag-real" : a.result === "miss" ? "chip sel" : "tag-sample";
  box.innerHTML = `<div class="wtool" style="margin:0 0 10px;padding:8px 12px;border:1px solid var(--line2);border-radius:10px;background:rgba(139,92,246,.12)">
    <b>Access #${a.n}</b> <span class="${cls}">${esc(a.result.toUpperCase())}</span>
    <span class="mono">${a.addr != null ? hex(a.addr, 8) : "?"}</span><span class="note">line ${a.index ?? "–"} · tag ${a.tag != null ? hex(a.tag) : "–"}</span>
    <span class="note">accepted ${esc(fmtNs(a.accept_t))} → response ${a.resp_t != null ? esc(fmtNs(a.resp_t)) : "none"} (${a.latency ?? "–"} cycles)</span>
    <span style="margin-left:auto"><a class="btn sm" href="${href("trace", { acc: a.n })}">Open in trace ${icon("right", 13)}</a></span></div>`;
}

// ---------------------------------------------------------------- overlay: selected access, FSM transitions, memory operations
function highSegs(d, a, b) {                  // intervals in [a,b] where a 1-bit signal is high, from the fetched data
  if (!d) return [];
  const out = []; let cur = d.init, ts = a;
  const pts = [...d.points, [b + 1, null]];
  for (const [t, v] of pts) {
    if (cur == 1) { const e = Math.min(t, b); if (e >= Math.max(ts, a)) out.push([Math.max(ts, a), e]); }
    cur = v; ts = t; if (t > b) break;
  }
  return out;
}
function wvOverlay(g, W, H) {
  const a = selAccess(); if (!a || !wave) return;
  const w = wave, end = a.resp_t ?? a.accept_t, single = App.wv.mode === "access";
  const x0 = w.xOf(a.accept_t), x1 = Math.max(x0 + 2, w.xOf(end));
  if (x1 < 0 || x0 > W) return;
  g.fillStyle = single ? "rgba(139,92,246,.12)" : "rgba(139,92,246,.30)"; g.fillRect(x0, w.ruler, x1 - x0, H - w.ruler);
  g.strokeStyle = "rgba(180,155,250,.9)"; g.lineWidth = 1.2; g.beginPath();
  g.moveTo(x0 + .5, w.ruler); g.lineTo(x0 + .5, H); g.moveTo(x1 - .5, w.ruler); g.lineTo(x1 - .5, H); g.stroke();
  g.font = "600 11px ui-monospace, Menlo, monospace"; g.textBaseline = "middle"; g.fillStyle = "#f4f5ff";
  const label = `Access #${a.n} · ${a.result.toUpperCase()}`;
  if (x1 - x0 > 60 || single) g.fillText(label, Math.max(4, x0 + 4), w.ruler + w.grpH / 2);
  if (!single) return;
  const tops = w.rowTops(), amber = "rgba(251,191,36,.95)";
  const st = w.data[P + "dut.state"];
  if (st && tops[P + "dut.state"] != null) {          // FSM transitions inside the access (real state changes)
    g.setLineDash([4, 4]); g.strokeStyle = "rgba(226,232,255,.55)"; g.lineWidth = 1;
    for (const [t] of st.points) {
      if (t < a.accept_t || t > end) continue;
      const x = Math.round(w.xOf(t)) + .5; g.beginPath(); g.moveTo(x, w.ruler); g.lineTo(x, H); g.stroke();
      const y = tops[P + "dut.state"] + w.rowH / 2; g.fillStyle = "#f4f5ff"; g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x + 5, y); g.lineTo(x, y + 5); g.lineTo(x - 5, y); g.closePath(); g.fill();
    }
    g.setLineDash([]);
  }
  for (const key of ["mreq_v", "mresp_v", "dut.refill_en", "dut.mem_start"]) {   // memory operations: outline each high interval
    const path = P + key, top = tops[path]; if (top == null) continue;
    g.strokeStyle = amber; g.fillStyle = "rgba(251,191,36,.18)"; g.lineWidth = 1.6;
    for (const [s, e] of highSegs(w.data[path], a.accept_t, end)) {
      const xs = w.xOf(s), xe = Math.max(xs + 3, w.xOf(e)); g.fillRect(xs, top + 2, xe - xs, w.rowH - 4); g.strokeRect(xs, top + 2, xe - xs, w.rowH - 4);
    }
  }
}

// ---------------------------------------------------------------- selected-access event list (fetched for exactly [accept_t, resp_t])
async function loadAccessEvents() {
  const a = selAccess(), box = $("#wTl"); if (!box) return;
  if (!a || !App.run) { box.innerHTML = `<div class="empty">No access selected.</div>`; return; }
  const tok = ++accTok, id = App.run.run_id, end = a.resp_t ?? a.accept_t;
  const sigs = ["dut.state", "mreq_v", "mreq_r", "mresp_v", "dut.refill_en"].map((k) => P + k);
  try {
    const d = await api(`/api/run/${id}/wave?signals=${encodeURIComponent(sigs.join(","))}&t0=${a.accept_t}&t1=${end + 1}&px=4000`);
    if (tok !== accTok || !$("#wTl")) return;
    const ev = [];
    for (const [t, v] of d.signals[P + "dut.state"].points) if (t <= end) ev.push([t, `FSM → ${stateName(parseInt(v, 16))}`, "fsm"]);
    const edges = (k, up, down) => { let cur = d.signals[P + k].init; for (const [t, v] of d.signals[P + k].points) { if (t <= end) { if (v == 1 && cur != 1) ev.push([t, up, "mem"]); else if (v == 0 && cur == 1 && down) ev.push([t, down, "mem"]); } cur = v; } };
    edges("mreq_v", "Memory read request issued (mem_req_valid = 1)", "mem_req_valid released");
    edges("mresp_v", "Memory returned the block (mem_resp_valid = 1)");
    edges("dut.refill_en", "Cache line refill write (refill_en = 1)");
    ev.sort((p, q) => p[0] - q[0]);
    const memOps = ev.filter((e) => e[2] === "mem").length;
    box.innerHTML = `<div class="chain">${a.states.map((s, i) => `${i ? `<span class="ar">${icon("right", 14)}</span>` : ""}<span class="st ${stateClass(s)}">${esc(s)}</span>`).join("")}</div>
      <div class="tw" style="margin-top:10px;max-height:220px;overflow:auto"><table class="t"><thead><tr><th>Time</th><th>Event (from the VCD)</th></tr></thead><tbody>
      <tr><td class="m">${esc(fmtNs(a.accept_t))}</td><td>Request accepted (req_valid &amp; req_ready on the clock edge)</td></tr>
      ${ev.map(([t, txt, k]) => `<tr><td class="m">${esc(fmtNs(t))}</td><td${k === "mem" ? ' style="color:var(--yellow)"' : ""}>${esc(txt)}</td></tr>`).join("")}
      ${a.resp_t != null ? `<tr><td class="m">${esc(fmtNs(a.resp_t))}</td><td>Response delivered (resp_valid)</td></tr>` : ""}</tbody></table></div>
      <p class="note" style="margin-top:8px">${a.result === "hit" && !memOps ? "A hit: no memory operation occurred." : memOps ? "" : "No memory operation recorded in this interval."} Access #${a.n}: ${a.latency ?? "–"} cycles, read from the VCD.</p>`;
  } catch (e) { if (!quiet(e)) box.innerHTML = `<div class="empty">Could not load access events.</div>`; }
}

// ---------------------------------------------------------------- signal list, names column, cursor
function buildSigMenu() {
  const m = $("#wSigMenu"), vis = visibleSet(), full = App.wv.mode === "full";
  const sigs = App.info.signals.concat(full ? (App.info.extra || []).map((e) => ({ ...e, fmt: e.width === 1 ? "bit" : "hex" })) : []);
  const groups = [...VG, ...new Set(sigs.map(vgroup))].filter((g, i, a) => a.indexOf(g) === i);
  m.innerHTML = `<input type="search" id="wSigQ" placeholder="Filter ${sigs.length} signals…" aria-label="Filter signals" style="width:100%;margin-bottom:6px">` + groups.map((g) => {
    const list = sigs.filter((s) => vgroup(s) === g); if (!list.length) return "";
    return `<h4>${esc(g)}</h4>` + list.map((s) => `<label data-n="${esc(s.label.toLowerCase())}"><input type="checkbox" data-p="${esc(s.path)}" ${vis.has(s.path) ? "checked" : ""}>${esc(s.label)}${s.width > 1 ? ` [${s.width - 1}:0]` : ""}</label>`).join("");
  }).join("") + (full ? "" : `<p class="note">Switch to Full Waveform to add any other recorded signal.</p>`);
  $$("input[data-p]", m).forEach((cb) => (cb.onchange = () => { cb.checked ? vis.add(cb.dataset.p) : vis.delete(cb.dataset.p); applyRows(); paintInfo(); }));
  $("#wSigQ").oninput = (e) => { const q = e.target.value.toLowerCase(); $$("label[data-n]", m).forEach((l) => (l.style.display = l.dataset.n.includes(q) ? "" : "none")); };
}
function applyRows() { wave.setRows(waveRows()); paintNames(); fetchCursorValues(); }
function paintNames() {
  const box = $("#wNames"); if (!box) return;
  const vals = App.wv.vals || {};
  box.innerHTML = `<div style="height:${wave.ruler}px;border-bottom:1px solid var(--line);display:flex;align-items:center;padding:0 10px;color:var(--muted);font-size:12px">Signal <span style="margin-left:auto">Value @ ${esc(fmtNs(App.wv.cursor))}</span></div>` +
    wave.rows.map((r) => r.type === "grp" ? `<div class="wrow grp" style="height:${wave.grpH}px" data-g="${esc(r.name)}" title="Click to collapse or expand">${App.wv.collapsed.has(r.name) ? "▸" : "▾"} ${esc(r.name)} (${r.count})</div>`
      : `<div class="wrow" style="height:${wave.rowH}px" title="${esc(r.sig.path)}"><input type="checkbox" checked aria-label="Show ${esc(r.sig.label)}" data-p="${esc(r.sig.path)}"><span class="nm">${esc(r.sig.label)}${r.sig.width > 1 ? ` [${r.sig.width - 1}:0]` : ""}</span><span class="vl">${esc(fmtVal(r.sig, vals[r.sig.path]))}</span></div>`).join("");
  $$("[data-g]", box).forEach((d) => (d.onclick = () => { const g = d.dataset.g; App.wv.collapsed.has(g) ? App.wv.collapsed.delete(g) : App.wv.collapsed.add(g); applyRows(); }));
  $$("input[data-p]", box).forEach((cb) => (cb.onchange = () => { visibleSet().delete(cb.dataset.p); applyRows(); paintInfo(); }));
}
function onWaveCursor(t, silent) {
  const a = App.tr?.accesses.find((x) => x.accept_t <= t && (x.resp_t ?? x.accept_t) >= t);
  if (a && a.n !== App.sel.acc && !silent && App.wv.mode !== "access") { App.sel.acc = a.n; if (a.index != null) App.sel.line = a.index; syncUrl(); paintBanner(); wave.draw(); loadAccessEvents(); }
  const tc = $("#wTime"); if (tc) tc.textContent = `t = ${fmtNs(t)}`;
  clearTimeout(valTimer); valTimer = setTimeout(fetchCursorValues, 30);
  paintCursorPanel();
}
async function fetchCursorValues() {
  if (!App.run || !App.info || !$("#wNames")) return;
  const t = App.wv.cursor, id = App.run.run_id;
  const paths = [...new Set([...wave.rows.filter((r) => r.type === "sig").map((r) => r.sig.path), P + "clk", P + "dut.state", P + "req_addr"])];
  try { const v = await api(`/api/run/${id}/value?t=${t}&signals=${encodeURIComponent(paths.join(","))}`); if (!App.run || App.run.run_id !== id || t !== App.wv.cursor) return; App.wv.vals = v; paintNames(); paintCursorPanel(); }
  catch (e) { if (!quiet(e) && e.status !== 404 && e.status !== 409) console.warn("value:", e.message); }
}
function paintInfo() {
  const r = App.run, i = App.info, box = $("#wInfo"); if (!box) return;
  const total = i.signals.length + (i.extra || []).length;
  box.innerHTML = `<span>File</span><span style="color:var(--purple-l)">${esc(r.vcd.file)}</span><span>Run</span><span>${esc(r.run_id)}</span><span>Total time</span><span>${esc(fmtNs(i.end_time))}</span>
    <span>Mode</span><span>${esc(MODES.find((m) => m[0] === App.wv.mode)[1])}</span><span>Timescale</span><span>${esc(i.timescale)}</span><span>Signals shown</span><span>${visibleSet().size} of ${total}</span>
    <span>Size</span><span>${(r.vcd.bytes / 1024).toFixed(1)} KB</span><span>SHA-256</span><span title="${esc(r.vcd.sha256)}">${esc(r.vcd.sha256.slice(0, 14))}…</span>`;
}
function paintCursorPanel() {
  const box = $("#wCur"); if (!box || !App.info) return;
  const t = App.wv.cursor, v = App.wv.vals || {}, find = (l) => App.info.signals.find((s) => s.label === l);
  const clk = clkTicks(), st = find("FSM state"), ad = find("req_addr"), ck = find("clk");
  const cell = (sig, key) => (v[key] === undefined ? "–" : fmtVal(sig, v[key]));
  const a = App.tr?.accesses.find((x) => x.accept_t <= t && (x.resp_t ?? x.accept_t) >= t);
  box.innerHTML = `<span>Time</span><span>${esc(fmtNs(t))}</span><span>Clock cycle</span><span>${Math.floor(t / clk)}</span><span>clk</span><span>${esc(cell(ck, P + "clk"))}</span>
    <span>FSM state</span><span>${esc(cell(st, P + "dut.state"))}</span><span>req_addr</span><span>${esc(cell(ad, P + "req_addr"))}</span>`;
  $("#wCurAcc").innerHTML = a ? `<span class="chip sel">Access #${a.n} · ${esc(a.result)}</span> <a class="btn sm" href="${href("trace", { acc: a.n })}">Open in trace ${icon("right", 13)}</a>`
    : `<span class="note">The cursor is not inside a recorded access (idle or reset).</span>`;
}
