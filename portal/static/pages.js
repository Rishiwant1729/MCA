"use strict";
// Pages, shell and router. Depends on icons.js and core.js.

// ================================================================ shared pieces
const kb = (b) => (b >= 1024 ? (b / 1024) + " KB" : b + " B");
function decode(addr) {                      // static address arithmetic with the RTL's actual geometry
  const c = App.cfg, a = BigInt(addr), ob = BigInt(c.offset_bits), ib = BigInt(c.index_bits);
  return { addr: a, offset: Number(a & ((1n << ob) - 1n)), index: Number((a >> ob) & ((1n << ib) - 1n)), tag: Number(a >> (ob + ib)) };
}
function parseHexAddr(text) {
  const t = text.trim().replace(/^0x/i, "").replace(/_/g, "");
  if (!/^[0-9a-fA-F]{1,8}$/.test(t)) return null;
  return BigInt("0x" + t);
}
function emptyRun(msg) {
  return `<div class="panel"><div class="empty">${icon("info", 22)}<p style="margin:8px 0 12px">${esc(msg || "Run a simulation to view results.")}</p>
    <a class="btn primary" href="${href("simulation")}">${icon("play", 16)} Go to Simulation</a></div></div>`;
}
function needsData() {
  if (!App.run) return emptyRun(App.runError || "No run selected. Start a simulation to see results here.");
  if (ACTIVE.has(App.run.status)) return `<div class="panel"><div class="empty"><span class="spin">${icon("reset", 22)}</span><p>The simulation is still running (${esc(App.run.phase)}). This page fills in when it finishes.</p></div></div>`;
  if (App.run.status === "compile_error" || !App.run.vcd) return `<div class="panel"><div class="banner">${icon("warn", 20)}<div><b>This run has no waveform.</b> Status: ${esc(App.run.status)}.
    <a href="${href("simulation")}">Open the Simulation page</a> to read the compiler output.</div></div></div>`;
  if (!App.info) return `<div class="panel"><div class="empty">${App.runError ? esc(App.runError) : "Loading data from the VCD…"}</div></div>`;
  return null;
}
const statCard = (cls, ic, label, val, unit = "") => `<div class="stat ${cls}"><div class="k">${icon(ic, 16)}${esc(label)}</div><div class="v">${val}${unit ? ` <small>${esc(unit)}</small>` : ""}</div></div>`;
const resultTag = (r) => r === "hit" ? `<span class="tag hit">${icon("check", 12)} Hit</span>` : r === "miss" ? `<span class="tag miss">${icon("xcircle", 12)} Miss</span>`
  : `<span class="tag err">${esc(r === "error" ? "Error" : r)}</span>`;
const explain = () => "";

function summaryNums() {
  const s = App.tr?.summary; if (!s) return null;
  const amat = s.amat_model ?? s.avg_latency;
  return { s, amat, amatKind: s.amat_model != null ? "hit time + miss rate × miss penalty (all three measured in this run)" : "average accept→response latency measured in this run" };
}

// ---------------------------------------------------------------- cloud FSM diagram
const CLOUD = "M28 56 C12 56 4 45 9 35 C2 26 11 13 25 15 C27 5 43 0 53 9 C61 1 82 3 87 16 C102 12 117 23 110 36 C118 46 107 58 91 56 Z";
function fsmSvg(path = []) {
  const st = App.cfg.states.map((s) => s.name), n = st.length, W = 400, H = 290, cx = W / 2, cy = H / 2, rx = 140, ry = 100;
  const pos = st.map((_, i) => { const a = ((-90 + (i * 360) / n) * Math.PI) / 180; return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]; });
  const onSet = new Set(path);
  const hw = 54, hh = 29;
  const edge = (i, j, on, dash, label) => {
    const [x1, y1] = pos[i], [x2, y2] = pos[j], dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
    const s = 1 / Math.sqrt((ux / hw) ** 2 + (uy / hh) ** 2);
    const a = [x1 + ux * (s + 3), y1 + uy * (s + 3)], b = [x2 - ux * (s + 8), y2 - uy * (s + 8)];
    return `<line class="arr${on ? " on" : ""}${dash ? " dash" : ""}" x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" marker-end="url(#${on ? "ahOn" : "ah"})"/>` +
      (label ? `<text x="${((a[0] + b[0]) / 2).toFixed(1)}" y="${((a[1] + b[1]) / 2 - 5).toFixed(1)}" fill="#98a0cc" font-size="10" text-anchor="middle">${label}</text>` : "");
  };
  const seqPairs = new Set(path.slice(1).map((s, k) => path[k] + ">" + s));
  let arrows = "";
  for (let i = 0; i < n; i++) arrows += edge(i, (i + 1) % n, seqPairs.has(st[i] + ">" + st[(i + 1) % n]) || (path.length && st[i] === "COMPLETE" && path[path.length - 1] === "COMPLETE"), false);
  const iL = st.indexOf("LOOKUP"), iC = st.indexOf("COMPLETE");
  if (iL >= 0 && iC >= 0) arrows += edge(iL, iC, seqPairs.has("LOOKUP>COMPLETE"), true, "hit");
  const nodes = st.map((name, i) => {
    const on = onSet.has(name), cls = stateClass(name), k = path.indexOf(name);
    return `<g class="node ${cls} ${path.length ? (on ? "on" : "off") : ""}"><g transform="translate(${(pos[i][0] - 52).toFixed(1)},${(pos[i][1] - 28).toFixed(1)}) scale(.867,.875)"><path class="cloud" d="${CLOUD}"/></g>
      <text x="${pos[i][0].toFixed(1)}" y="${(pos[i][1] + 1).toFixed(1)}">${esc(name)}</text>
      ${k >= 0 ? `<circle class="ordc" cx="${(pos[i][0] + 44).toFixed(1)}" cy="${(pos[i][1] - 24).toFixed(1)}" r="8"/><text class="ord" x="${(pos[i][0] + 44).toFixed(1)}" y="${(pos[i][1] - 23).toFixed(1)}">${k + 1}</text>` : ""}</g>`;
  }).join("");
  return `<svg class="fsm" viewBox="0 0 ${W} ${H}" role="img" aria-label="Controller FSM drawn with cloud-shaped states. ${path.length ? "Highlighted path: " + path.join(", ") : "No access selected."}">
    <defs><marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#6c74a6"/></marker>
    <marker id="ahOn" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#27d3ee"/></marker></defs>${arrows}${nodes}</svg>`;
}
function whyText(a) {
  if (!a) return "Select an access to see what the controller did.";
  const c = App.cfg;
  if (a.result === "hit") return `LOOKUP found line #${a.index} valid with a matching tag (${hex(a.tag)}), so the controller went straight to COMPLETE and answered in ${a.latency} cycles.`;
  if (a.result === "miss") return `LOOKUP saw line #${a.index} invalid or holding a different tag than ${hex(a.tag)}. The controller issued a memory read (MISS_REQ), waited in WAIT_MEM, wrote the ${c.block_bytes}-byte block into line #${a.index} (REFILL) and answered in ${a.latency} cycles.`;
  if (a.result === "error") return "The request was misaligned, out of range or a write, so the controller answered with resp_err without touching the cache.";
  return "This access did not complete in the trace (for example a reset hit before the response).";
}

// ---------------------------------------------------------------- shell
function renderShell() {
  $("#spiderSlot").innerHTML = spiderMark(46);
  $("#menuBtn").innerHTML = icon("menu", 20);
  const c = App.cfg;
  $("#badges").innerHTML = c ? [
    ["chip", "Cache", `${kb(c.cache_bytes)} (${c.lines} lines)`], ["memory", "Main Memory", kb(c.mem_bytes)], ["server", "Counters", `${c.counters} × 32-bit`],
    ["binary", "Address", `${c.addr_width}-bit`], ["blocks", "Block", `${c.block_bytes} B`],
  ].map(([ic, k, v]) => `<div class="badge">${icon(ic, 22)}<div>${k}<b>${esc(v)}</b></div></div>`).join("") : "";
  $("#side").innerHTML = PAGES.map(([id, label, ic]) => `<a href="${href(id)}" data-p="${id}" ${App.page === id ? 'aria-current="page"' : ""}>${icon(ic, 19)}<span>${label}</span></a>`).join("") +
    `<div class="sp"></div><div class="foot">All values come from the Verilog simulation of this repository. No sample data is shown as a result.</div>`;
}
function renderCtx() {
  const parts = [];
  if (App.offline) parts.push(`<div class="banner" role="alert">${icon("warn", 22)}<div><b>The simulation backend is not running.</b>
    Open Terminal in the project folder and run <code>make portal</code> (or double-click <code>Start Portal.command</code>). This page reconnects by itself.</div></div>`);
  else {
    const r = App.run, runs = App.runs;
    const opts = runs.length ? runs.map((x) => `<option value="${esc(x.run_id)}" ${r && x.run_id === r.run_id ? "selected" : ""}>${esc(new Date(x.created).toLocaleTimeString())} · ${esc(x.title)} · latency ${x.latency} · ${esc(x.status)}</option>`).join("") : `<option value="">(no runs yet)</option>`;
    const st = r ? (ACTIVE.has(r.status) ? `<span class="chip warn"><span class="spin">${icon("reset", 13)}</span> ${esc(r.phase)}…</span>` : r.status === "pass" ? `<span class="chip ok">${icon("check", 13)} passed</span>` : `<span class="chip bad">${icon("xcircle", 13)} ${esc(r.status.replace("_", " "))}</span>`) : "";
    parts.push(`<div class="ctx"><span class="lbl">Current run</span><select id="runSel" aria-label="Choose a saved run">${opts}</select>${st}
      ${r ? `<span class="chip">${esc(r.title)} · latency ${r.latency}</span>` : ""}<span class="grow"></span>
      ${r && r.vcd ? `<a class="btn sm" href="/api/run/${esc(r.run_id)}/vcd" download>${icon("download", 14)} VCD</a>` : ""}
      ${r && !ACTIVE.has(r.status) ? `<button class="btn sm danger" id="delRun" title="Delete this saved run">${icon("trash", 14)} Delete run</button>` : ""}</div>`);
    if (App.runError) parts.push(`<div class="banner warn" role="alert">${icon("warn", 20)}<div>${esc(App.runError)}</div></div>`);
  }
  $("#ctx").innerHTML = parts.join("");
  const sel = $("#runSel");
  if (sel) sel.onchange = () => { if (sel.value) { App.sel = { acc: null, line: null }; App.params = {}; location.hash = `#/${App.page}?run=${sel.value}`; } };
  const del = $("#delRun");
  if (del) del.onclick = async () => {
    if (!confirm(`Delete ${App.run.run_id} (${App.run.title}) and its VCD file? This cannot be undone.`)) return;
    try { await deleteRun(App.run.run_id); location.hash = `#/${App.page}` + (App.run ? `?run=${App.run.run_id}` : ""); } catch (e) { App.runError = "Delete failed: " + e.message; renderCtx(); }
  };
}

// ================================================================ page: Simulation
function pageSimulation() {
  const sc = App.scen, f = App.form, r = App.run, n = summaryNums();
  const active = r && ACTIVE.has(r.status);
  const scOpts = sc ? sc.scenarios.map((s) => `<option value="${s.id}" ${s.id === f.scenario ? "selected" : ""}>${esc(s.title)}</option>`).join("") : "";
  const latOpts = sc ? sc.latencies.map((l) => `<option ${l === f.latency ? "selected" : ""}>${l}</option>`).join("") : "";
  const desc = sc?.scenarios.find((s) => s.id === f.scenario)?.desc ?? "";
  const a = selAccess();

  let results;
  if (!r) results = `<div class="empty">Run a simulation to view results.</div>`;
  else if (active) results = `<div class="empty"><span class="spin">${icon("reset", 22)}</span><p>Results appear when the simulation finishes.</p></div>`;
  else if (!n) results = `<div class="empty">${r.status === "compile_error" ? "The design did not compile, so there is no trace." : "No trace could be read from this run."}</div>`;
  else {
    const s = n.s;
    results = `<div class="stats">
      ${statCard("c", "layers", "Accesses", s.total)}${statCard("g", "check", "Hits", s.hits)}${statCard("r", "xcircle", "Misses", s.misses)}
      ${statCard("", "bars", "Hit Rate", pct(s.hit_rate, 2))}${statCard("y", "timer", "AMAT", num(n.amat), "cycles")}</div>
      <div class="sub"><span>Miss rate <b>${pct(s.miss_rate, 2)}</b></span><span>Cycles simulated <b>${s.cycles}</b></span><span>Memory transactions <b>${s.mem_transactions}</b></span>
      ${s.hit_time != null ? `<span>Hit time <b>${num(s.hit_time)}</b> cycles</span>` : ""}${s.miss_penalty != null ? `<span>Miss penalty <b>${num(s.miss_penalty)}</b> cycles</span>` : ""}
      ${s.errors ? `<span>Error responses <b>${s.errors}</b></span>` : ""}${s.resets > 1 ? `<span>Resets <b>${s.resets}</b></span>` : ""}</div>
      <p class="note" style="margin:8px 0 0">Measured from this run's VCD trace. AMAT = ${esc(n.amatKind)}. Hit rate counts hits ÷ (hits + misses); error responses are excluded.
      ${s.hits === 0 && s.misses > 0 ? " This scenario has no hits, so a separate hit time is not available." : ""} ${explain("performance", "How AMAT works")}</p>`;
  }
  const chip = r ? (active ? `<span class="chip warn">${esc(r.phase)}…</span>` : r.status === "pass" ? `<span class="chip ok">${icon("check", 14)} Simulation Completed</span>` : `<span class="chip bad">${icon("xcircle", 14)} ${esc(r.status.replace("_", " "))}</span>`) : "";

  return `
  <div class="grid gsim">
    <section class="panel" aria-labelledby="h-ctl"><h2 class="ph" id="h-ctl">${icon("play", 22)} Simulation Control</h2>
      <div class="grid g2" style="gap:10px">
        <label class="f">Test Scenario<select id="fScen" ${App.busy || active ? "disabled" : ""}>${scOpts}</select></label>
        <label class="f">Memory Latency (cycles)<select id="fLat" ${App.busy || active ? "disabled" : ""}>${latOpts}</select></label>
      </div>
      <p class="note" id="scDesc" style="margin:8px 0">${esc(desc)}</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn primary" id="runBtn" style="flex:1" ${App.busy || active || !sc ? "disabled" : ""}>${icon("play", 16)} ${App.busy || active ? "Running…" : "Run Simulation"}</button>
        <button class="btn" id="resetBtn" style="flex:1" ${App.busy || active ? "disabled" : ""} title="Reset the controls and clear the current selection (saved runs are kept)">${icon("reset", 16)} Reset</button>
      </div>
      <div id="runStatus" style="margin-top:12px">${runStatusHtml()}</div>
    </section>
    <section class="panel" aria-labelledby="h-res"><h2 class="ph" id="h-res">${icon("bars", 22)} Simulation Results <span class="right">${chip}</span></h2>${results}</section>
  </div>
  <div class="grid gsim3">
    <section class="panel" aria-labelledby="h-dec"><h2 class="ph" id="h-dec">${icon("binary", 22)} Address Decoder <span class="right">${explain("mapping", "Explain")}</span></h2>
      <div class="addr-row"><label class="f" style="flex:1">Address (hex)<input type="text" id="decIn" value="${esc(a?.addr != null ? hex(a.addr, 8) : "0x00000044")}" spellcheck="false" autocomplete="off" aria-describedby="decMsg"></label>
        <button class="btn icon" id="decCopy" aria-label="Copy address" style="align-self:flex-end">${icon("copy", 16)}</button></div>
      <div id="decOut"></div></section>
    <section class="panel" aria-labelledby="h-fsm"><h2 class="ph" id="h-fsm">${icon("fsm", 22)} FSM (Cache Controller) <span class="right">${explain("fsm", "Explain")}</span></h2>
      ${r && n ? `<div class="fsmwrap"><div>${fsmSvg(a?.states ?? [])}</div><div class="fsm-side">
        <div><div class="k">${a ? `Recorded path for access #${a.n} (history)` : "No access selected"}</div>${a && a.states.length ? `<span class="chip cur">last state: ${esc(a.states[a.states.length - 1])}</span>` : ""}</div>
        ${a ? `<div><div class="k">Transition</div>${esc(a.transition)}</div>` : ""}<div class="note">${esc(whyText(a))}</div></div></div>` : `<div class="empty">Run a simulation to see the recorded FSM path.</div>`}</section>
    <section class="panel" aria-labelledby="h-cv"><h2 class="ph" id="h-cv">${icon("layers", 22)} Cache Snapshot <span class="right"><a class="btn sm" href="${href("cache")}">Open ${icon("right", 13)}</a></span></h2>
      <div id="snap">${r && n ? `<div class="empty">Loading…</div>` : `<div class="empty">Run a simulation to see cache lines.</div>`}</div></section>
  </div>
  <div class="grid g2">
    <section class="panel" aria-labelledby="h-mw"><h2 class="ph" id="h-mw">${icon("activity", 22)} Waveform Viewer (VCD) <span class="right"><a class="btn sm" href="${href("waveform")}">Open ${icon("right", 13)}</a></span></h2>
      ${r && n ? `<div class="mini"><div class="mnames" id="miniNames"></div><div class="mc"><canvas id="miniWave" role="img" aria-label="Waveform around the selected access, read from the VCD"></canvas></div></div>
        <p class="note" style="margin:6px 0 0">${a ? `Window around access #${a.n} · ${esc(fmtNs(a.accept_t))} to ${esc(fmtNs(a.resp_t ?? a.accept_t))}` : ""} · read from ${esc(r.vcd.file)}</p>` : `<div class="empty">Run a simulation to see the waveform.</div>`}</section>
    <section class="panel" aria-labelledby="h-at"><h2 class="ph" id="h-at">${icon("list", 22)} Access Trace <span class="right"><a class="btn sm" href="${href("trace")}">Open ${icon("right", 13)}</a></span></h2>
      <div id="miniTrace">${r && n ? miniTraceHtml() : `<div class="empty">Run a simulation to see accesses.</div>`}</div></section>
  </div>`;
}
function runStatusHtml() {
  const r = App.run;
  if (!r) return App.runError ? `<div class="banner warn">${icon("warn", 18)}<div>${esc(App.runError)}</div></div>` : `<p class="note">No run yet. Pick a scenario and press <b>Run Simulation</b>.</p>`;
  if (ACTIVE.has(r.status)) return `<div class="chip warn"><span class="spin">${icon("reset", 13)}</span> ${r.phase === "compiling" ? "Compiling the RTL and testbench with Icarus Verilog…" : r.phase === "simulating" ? "Running the simulation (vvp)…" : "Queued…"}</div><div class="progress" role="progressbar" aria-label="Simulation in progress"><i></i></div>`;
  const tests = r.tests.length ? `${r.tests.filter((t) => t.result === "PASS").length}/${r.tests.length} tests passed` : "";
  let h = `<div class="chips" style="display:flex;gap:6px;flex-wrap:wrap">
    <span class="chip ${r.status === "pass" ? "ok" : "bad"}">${r.status === "pass" ? icon("check", 13) : icon("xcircle", 13)} ${esc(r.status === "pass" ? "PASS" : r.status.replace("_", " ").toUpperCase())}</span>
    ${tests ? `<span class="chip">${esc(tests)}</span>` : ""}${r.sim_exit != null ? `<span class="chip">exit status ${r.sim_exit}</span>` : ""}${r.sim_seconds != null ? `<span class="chip">${r.sim_seconds} s</span>` : ""}
    <span class="chip mono" title="Unique run id">${esc(r.run_id)}</span></div>`;
  if (r.status === "compile_error" || r.status === "error") h += `<pre class="log" role="alert">${esc(r.compile_output || "(no compiler output)")}</pre>`;
  if (r.status === "fail") h += `<div class="banner" style="margin-top:8px">${icon("xcircle", 18)}<div>One or more checks failed. Expand the test details below.</div></div>`;
  h += `<details class="d" ${r.status === "fail" ? "open" : ""}><summary>Test results, logs and commands</summary>
    ${r.tests.map((t) => `<div style="border-top:1px solid var(--line);padding:6px 0;font-size:12.5px"><b>Test ${t.n}: ${esc(t.name)}</b> <span class="chip ${t.result === "PASS" ? "ok" : "bad"}">${esc(t.result || "?")}</span>
      <div class="note">expected: ${esc(t.expected)}</div><div>actual: ${esc(t.actual)}</div>${t.failures.map((x) => `<div class="err-text">${esc(x)}</div>`).join("")}</div>`).join("")}
    ${r.compile_ok && r.compile_output.trim() ? `<div class="note">Compiler messages</div><pre class="log">${esc(r.compile_output)}</pre>` : ""}
    <div class="note">Commands run (fixed, approved list)</div><pre class="log">${esc(r.compile_cmd)}\n${esc(r.sim_cmd)}</pre>
    ${r.compile_ok ? `<a href="/api/run/${esc(r.run_id)}/log" target="_blank" rel="noopener">Open raw simulation log</a>` : ""}</details>`;
  return h;
}
function miniTraceHtml() {
  const list = App.tr?.accesses ?? []; if (!list.length) return `<div class="empty">This run recorded no accesses.</div>`;
  const i = Math.max(0, list.findIndex((a) => a.n === App.sel.acc)), from = Math.max(0, Math.min(i - 2, list.length - 6));
  return `<div class="tw"><table class="t" aria-label="Access trace excerpt"><thead><tr><th>#</th><th>Cycle</th><th>Address</th><th>Result</th><th>FSM transition</th></tr></thead><tbody>
    ${list.slice(from, from + 6).map((a) => `<tr data-k="${a.n}" class="${a.n === App.sel.acc ? "sel" : ""}" tabindex="0"><td>${a.n}</td><td>${a.cycle}</td><td class="m">${a.addr != null ? hex(a.addr, 8) : "–"}</td><td>${resultTag(a.result)}</td><td>${esc(a.transition)}</td></tr>`).join("")}</tbody></table></div>`;
}
function bindSimulation() {
  const sc = $("#fScen"), lat = $("#fLat");
  if (sc) sc.onchange = () => { App.form.scenario = sc.value; $("#scDesc").textContent = App.scen.scenarios.find((s) => s.id === sc.value)?.desc ?? ""; };
  if (lat) lat.onchange = () => { App.form.latency = Number(lat.value); };
  const run = $("#runBtn"); if (run) run.onclick = () => startRun(App.form.scenario, App.form.latency);
  const rs = $("#resetBtn");
  if (rs) rs.onclick = () => { App.form = { scenario: "full_suite", latency: 4 }; App.runError = null; App.sel = { acc: null, line: null }; App.wv.cursor = 0; defaultSelection(); notify("ui"); renderCtx(); render(); };
  // address decoder
  const inp = $("#decIn"), out = $("#decOut");
  const draw = () => {
    const v = parseHexAddr(inp.value), c = App.cfg;
    if (v == null) { out.innerHTML = `<p class="err-text" id="decMsg" role="alert">Enter 1–8 hex digits, for example 0x00001234.</p>`; return; }
    const d = decode(v), b = bin(v, c.addr_width), tb = c.tag_bits, ib = c.index_bits;
    const g = (s) => s.replace(/(.{4})(?=.)/g, "$1 ");
    const hit = App.tr?.accesses.find((x) => x.tag === d.tag && x.index === d.index);
    out.innerHTML = `<div class="note" id="decMsg" style="margin-top:8px">${c.addr_width}-bit address</div>
      <div class="bits" aria-label="Address bits"><div class="tg">${g(b.slice(0, tb))}</div><div class="ix">${b.slice(tb, tb + ib)}</div><div class="of">${b.slice(tb + ib)}</div></div>
      <div class="fields"><div class="tg"><small>Tag (${tb} bits)</small><b>${hex(d.tag, 6)}</b></div><div class="ix"><small>Index (${ib} bits)</small><b>${hex(d.index)} (${d.index})</b></div><div class="of"><small>Offset (${c.offset_bits} bits)</small><b>${hex(d.offset)}</b></div></div>
      <p class="note" style="margin:8px 0 0">Static decomposition of the typed address — not a cache access.
      ${hit ? ` This block was accessed in this run: <a href="${href("trace", { acc: hit.n })}">access #${hit.n} (${hit.result})</a>.` : App.tr ? " This block was not accessed in this run." : ""}</p>`;
  };
  inp.oninput = draw; draw();
  $("#decCopy").onclick = () => { navigator.clipboard?.writeText(inp.value); const b = $("#decCopy"); b.innerHTML = icon("check", 16); setTimeout(() => (b.innerHTML = icon("copy", 16)), 1200); };
  bindTraceRows($("#miniTrace"));
  fillSnapshot();
  mountMiniWave();
}
async function fillSnapshot() {
  const box = $("#snap"); if (!box || !App.tr) return;
  try {
    const d = await getLines(snapshotTime()); if (!$("#snap")) return;
    const sel = App.sel.line ?? d.recent ?? 0, from = Math.max(0, Math.min(sel - 2, d.lines.length - 5)), rows = d.lines.slice(from, from + 5);
    box.innerHTML = `<div class="tw"><table class="t" aria-label="Cache lines around the selected line"><thead><tr><th>Index</th><th>Valid</th><th>Tag</th><th>Data (hex)</th></tr></thead><tbody>
      ${rows.map((l) => `<tr data-line="${l.i}" class="${l.i === sel ? "sel" : ""}" tabindex="0" data-k="${l.i}"><td>${l.i}</td><td><span class="vbit v${l.valid ? 1 : 0}">${l.valid ? 1 : 0}</span></td><td class="m">${l.valid ? hex(parseInt(l.tag, 16), 6) : "–"}</td>
      <td class="m">${l.valid ? esc(bytesOf(l.data).slice(0, 8).join(" ")) + " …" : "–"}</td></tr>`).join("")}</tbody></table></div>
      <p class="note" style="margin:6px 0 0">State after the selected access (rebuilt from the dumped refill signals). Click a line to open it in the Cache Viewer.</p>`;
    $$("tr[data-line]", box).forEach((tr) => { const open = () => { App.sel.line = Number(tr.dataset.line); go("cache"); }; tr.onclick = open; tr.onkeydown = (e) => { if (e.key === "Enter") open(); }; });
  } catch (e) { if (!quiet(e) && $("#snap")) $("#snap").innerHTML = `<div class="empty">Could not load cache lines: ${esc(e.message)}</div>`; }
}
const bytesOf = (h32) => h32.match(/../g).reverse().map((b) => b.toUpperCase());      // byte 0 first
let miniWave = null;
function mountMiniWave() {
  miniWave?.destroy(); miniWave = null;
  const cv = $("#miniWave"); if (!cv || !App.info || !App.tr) return;
  const a = selAccess(), clk = (App.tr.clock_ns || 10) / App.info.tick_ns;
  const t0 = Math.max(0, (a ? a.accept_t : 0) - 3 * clk), t1 = Math.min(App.info.end_time, (a ? (a.resp_t ?? a.accept_t) : 40 * clk) + 4 * clk);
  const want = ["clk", "req_valid", "req_addr", "resp_hit (hit/miss)", "FSM state", "mem_req_valid", "mem_resp_valid"];
  const rows = want.map((l) => App.info.signals.find((s) => s.label === l)).filter(Boolean).map((sig) => ({ type: "sig", sig }));
  miniWave = new Wave(cv, { interactive: false, rowH: 26, ruler: 24, view: { t0, t1, cursor: a ? a.accept_t : 0 } });
  $("#miniNames").innerHTML = `<div style="height:24px;border-bottom:1px solid var(--line)"></div>` + rows.map((r) => `<div style="height:26px" title="${esc(r.sig.path)}">${esc(r.sig.label.replace(" (hit/miss)", ""))}</div>`).join("");
  miniWave.setRows(rows);
}

// shared: clickable rows (data-k = access number) with keyboard support
function bindTraceRows(root, onSel) {
  if (!root) return;
  $$("tr[data-k]", root).forEach((tr) => {
    const pick = () => { selectAccess(Number(tr.dataset.k)); onSel?.(); };
    tr.onclick = pick; tr.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } };
  });
}

// ================================================================ page: Cache Viewer
const CV = { mode: "after", q: "", filter: "all", data: null };
function pageCache() {
  const bad = needsData(); if (bad) return head("layers", "Cache Viewer", "Inspect cache lines, tags, valid bits and data blocks") + bad;
  const c = App.cfg, a = selAccess();
  return head("layers", "Cache Viewer", "Inspect cache lines, tags, valid bits and data blocks", `
      <label class="f" style="flex-direction:row;align-items:center;gap:8px">Snapshot<select id="cvMode" aria-label="Snapshot time">
        <option value="after" ${CV.mode === "after" ? "selected" : ""} ${a ? "" : "disabled"}>After selected access${a ? " #" + a.n : ""}</option><option value="end" ${CV.mode === "end" ? "selected" : ""}>End of run</option></select></label>
      <label class="f" style="flex-direction:row;align-items:center;gap:8px">Show<select id="cvFilter"><option value="all">All lines</option><option value="valid" ${CV.filter === "valid" ? "selected" : ""}>Valid only</option><option value="invalid" ${CV.filter === "invalid" ? "selected" : ""}>Invalid only</option></select></label>
      <label class="f"><span class="sr">Search index or tag</span><input type="search" id="cvQ" placeholder="Search index / tag…" value="${esc(CV.q)}" style="min-width:190px"></label>`) + `
  <div class="grid gcv" id="cvGrid">
    <div style="display:flex;flex-direction:column;gap:14px">
      <section class="panel" aria-labelledby="h-ov"><h2 class="ph" id="h-ov">${icon("chip", 20)} Cache Overview</h2>
        <div class="rowkv"><span>Total Lines</span><b>${c.lines}</b></div><div class="rowkv"><span>Block Size</span><b>${c.block_bytes} Bytes</b></div>
        <div class="rowkv"><span>Total Size</span><b>${kb(c.cache_bytes)}</b></div><div class="rowkv"><span>Mapping</span><b>${esc(c.mapping)}</b></div>
        <div class="rowkv"><span>Index / Tag bits</span><b>${c.index_bits} / ${c.tag_bits}</b></div>${explain("cacheline", "Cache line format")}</section>
      <section class="panel" aria-labelledby="h-lg"><h2 class="ph" id="h-lg">${icon("info", 20)} Legend</h2><div class="legend">
        <div><span class="vbit v1">1</span> Valid line (contains data)</div><div><span class="vbit v0">0</span> Invalid line (empty)</div>
        <div><span class="selbox"></span> Selected line</div><div><span class="selbox" style="border-color:var(--cyan)"></span> Last refilled line</div></div></section>
    </div>
    <section class="panel" aria-labelledby="h-tb"><h2 class="ph" id="h-tb">${icon("layers", 20)} Cache lines <small id="cvInfo"></small></h2>
      <div class="tw" style="max-height:440px"><table class="t" aria-label="Cache lines"><thead><tr><th>Index</th><th>Valid</th><th>Tag (hex)</th><th>Data (${c.block_bytes} bytes – hex)</th></tr></thead><tbody id="cvBody"><tr><td colspan="4">Loading…</td></tr></tbody></table></div></section>
  </div>
  <div class="grid gsim"><section class="panel" aria-labelledby="h-ld"><h2 class="ph" id="h-ld">${icon("tag", 20)} Line Details <small id="ldIdx"></small></h2><div id="ldBox"></div></section>
    <section class="panel" aria-labelledby="h-dv"><h2 class="ph" id="h-dv">${icon("layers", 20)} Data (Hex View)</h2><div id="dvBox"></div></section></div>`;
}
function head(ic, title, sub, right = "") {
  return `<div class="panel"><div class="pagehead">${icon(ic, 34)}<div><h2>${esc(title)}</h2><p>${esc(sub)}</p></div><span style="margin-left:auto;display:flex;gap:10px;align-items:center;flex-wrap:wrap">${right}</span></div></div>`;
}
async function bindCache() {
  if (!App.info) return;
  const a = selAccess();
  $("#cvMode").onchange = (e) => { CV.mode = e.target.value; loadCache(); };
  $("#cvFilter").onchange = (e) => { CV.filter = e.target.value; paintCache(); };
  $("#cvQ").oninput = (e) => { CV.q = e.target.value; paintCache(); };
  if (CV.mode === "after" && !a) CV.mode = "end";
  await loadCache();
}
async function loadCache() {
  const t = CV.mode === "after" && selAccess() ? snapshotTime() : App.tr?.end_t ?? 0;
  try { CV.data = await getLines(t); CV.t = t; paintCache(); } catch (e) { if (!quiet(e) && $("#cvBody")) $("#cvBody").innerHTML = `<tr><td colspan="4">Could not load cache lines: ${esc(e.message)}</td></tr>`; }
}
function paintCache() {
  const d = CV.data, body = $("#cvBody"); if (!d || !body) return;
  const q = CV.q.trim().toLowerCase().replace(/^0x/, "");
  let lines = d.lines.filter((l) => (CV.filter === "all" || (CV.filter === "valid") === l.valid) &&
    (!q || String(l.i) === q || l.i.toString(16) === q || (l.valid && (l.tag.toLowerCase() === q || parseInt(l.tag, 16).toString(16).padStart(6, "0") === q))));
  $("#cvInfo").textContent = `@ ${fmtNs(CV.t)} · ${d.lines.filter((l) => l.valid).length}/${App.cfg.lines} valid · ${lines.length} shown`;
  body.innerHTML = lines.length ? lines.map((l) => `<tr data-line="${l.i}" tabindex="0" class="${l.i === App.sel.line ? "sel" : l.i === d.recent ? "chg" : ""}" aria-selected="${l.i === App.sel.line}">
    <td>${l.i}</td><td><span class="vbit v${l.valid ? 1 : 0}">${l.valid ? 1 : 0}</span></td><td class="m">${l.valid ? hex(parseInt(l.tag, 16), 6) : "–"}</td>
    <td class="m">${l.valid ? esc(bytesOf(l.data).join(" ")) : Array(App.cfg.block_bytes).fill("–").join(" ")}</td></tr>`).join("") : `<tr><td colspan="4">No lines match.</td></tr>`;
  $$("tr[data-line]", body).forEach((tr) => { const pick = () => { App.sel.line = Number(tr.dataset.line); syncUrl(); paintCache(); }; tr.onclick = pick; tr.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } }; });
  const sel = body.querySelector("tr.sel"); if (sel && !CV.scrolled) { sel.scrollIntoView({ block: "center" }); CV.scrolled = true; }
  paintLine();
}
function paintLine() {
  const d = CV.data, i = App.sel.line, c = App.cfg; if (!d || i == null) { $("#ldBox").innerHTML = `<div class="empty">Select a line.</div>`; return; }
  const l = d.lines[i], a = selAccess(), changed = d.recent === i && a && a.result === "miss" && a.index === i;
  $("#ldIdx").textContent = `(Index ${i})`;
  $("#ldBox").innerHTML = `<div class="kv"><span>Index</span><span>${hex(i)} (${i})</span><span>Valid</span><span><span class="vbit v${l.valid ? 1 : 0}">${l.valid ? 1 : 0}</span></span>
    <span>Tag</span><span>${l.valid ? hex(parseInt(l.tag, 16), 6) : "–"}</span><span>Block size</span><span>${c.block_bytes} Bytes</span>
    <span>Source</span><span>${esc(App.run.run_id)} @ ${esc(fmtNs(CV.t))}</span></div>
    ${l.valid ? "" : `<p class="note">Invalid line: its tag and data have no meaning yet. The RTL treats an invalid line as a miss whatever its stored tag is.</p>`}
    ${changed ? `<p class="note" style="color:#9fe9f6">${icon("link", 13)} This line was refilled by access #${a.n} (${hex(a.addr, 8)}).</p>` : d.recent === i ? `<p class="note">Last refilled at ${esc(fmtNs(d.recent_t))}.</p>` : ""}
    ${a ? `<a class="btn sm" href="${href("trace", { acc: a.n })}">${icon("list", 14)} Access #${a.n} in trace</a>` : ""}`;
  $("#dvBox").innerHTML = l.valid ? `<div class="bytes">${bytesOf(l.data).map((b, k) => `<div class="byte"><b>${b}</b><small>+${k}</small></div>`).join("")}</div>
    <p class="note" style="margin-top:10px">Bytes ${hex(0)}–${hex(c.block_bytes - 1)} of the block (little-endian: byte +0 is the lowest address). Words = groups of 4 bytes.</p>` : `<div class="empty">No data — this line is invalid.</div>`;
}

// ================================================================ page: Access Trace
const TR = { filter: "all", q: "", page: 0, per: 50 };
function traceFiltered() {
  const q = TR.q.trim().toLowerCase().replace(/^0x/, "");
  return (App.tr?.accesses ?? []).filter((a) => (TR.filter === "all" || (TR.filter === "hits" && a.result === "hit") || (TR.filter === "misses" && a.result === "miss") || (TR.filter === "errors" && a.result !== "hit" && a.result !== "miss")) &&
    (!q || (a.addr != null && a.addr.toString(16).includes(q)) || String(a.index) === q || String(a.n) === q));
}
function pageTrace() {
  const bad = needsData(); if (bad) return head("list", "Access Trace", "Sequence of memory accesses and cache controller responses") + bad;
  if (!App.tr) return head("list", "Access Trace", "Sequence of memory accesses and cache controller responses") + `<div class="panel"><div class="empty">This VCD does not contain the signals needed to rebuild a trace.</div></div>`;
  const s = App.tr.summary, id = esc(App.run.run_id), n = summaryNums();
  return head("list", "Access Trace", "Sequence of memory accesses and cache controller responses", `
      <div class="seg" role="group" aria-label="Filter accesses">
        <button class="pill ${TR.filter === "all" ? "on" : ""}" data-f="all">All (${s.total})</button><button class="pill hit ${TR.filter === "hits" ? "on" : ""}" data-f="hits">Hits (${s.hits})</button>
        <button class="pill miss ${TR.filter === "misses" ? "on" : ""}" data-f="misses">Misses (${s.misses})</button>${s.errors + s.aborted ? `<button class="pill ${TR.filter === "errors" ? "on" : ""}" data-f="errors">Other (${s.errors + s.aborted})</button>` : ""}</div>
      <label class="f"><span class="sr">Search address or index</span><input type="search" id="trQ" placeholder="Search address / index / #" value="${esc(TR.q)}" style="min-width:200px"></label>
      <span class="dlmenu"><button class="btn" id="exBtn" aria-expanded="false">${icon("download", 16)} Export</button><span class="pop" id="exPop" hidden>
        <a href="/api/run/${id}/export?fmt=csv" download>CSV (this run)</a><a href="/api/run/${id}/export?fmt=json" download>JSON (this run)</a></span></span>`) + `
  <div class="grid gtr" id="trGrid">
    <section class="panel" aria-label="Access table"><div class="tw" style="max-height:440px"><table class="t" aria-label="Memory accesses"><thead><tr><th>#</th><th>Cycle</th><th>Address (hex)</th><th>Tag</th><th>Index</th><th>Offset</th><th>Result</th><th>FSM Transition</th></tr></thead><tbody id="trBody"></tbody></table></div>
      <div class="pager" id="trPager"></div></section>
    <section class="panel" aria-labelledby="h-ts"><h2 class="ph" id="h-ts">${icon("bars", 20)} Trace Summary</h2><div class="stats" style="grid-template-columns:1fr 1fr">
      ${statCard("c", "layers", "Total Accesses", s.total)}${statCard("g", "check", "Hits", s.hits)}${statCard("r", "xcircle", "Misses", s.misses)}${statCard("", "bars", "Hit Rate", pct(s.hit_rate, 2))}</div>
      <div class="rowkv" style="margin-top:10px"><span>${icon("timer", 15)} AMAT</span><b>${num(n.amat)} cycles</b></div>
      <div class="rowkv"><span>Memory transactions</span><b>${s.mem_transactions}</b></div>
      <p class="note" style="margin:4px 0 0">Measured from the trace. AMAT = ${esc(n.amatKind)}. ${explain("performance", "How AMAT works")}</p></section>
  </div>
  <div class="grid gtr2">
    <section class="panel" aria-labelledby="h-ad"><h2 class="ph" id="h-ad">${icon("tag", 20)} Access Details <small id="adN"></small></h2><div id="adBox"></div></section>
    <section class="panel" aria-labelledby="h-sq"><h2 class="ph" id="h-sq">${icon("list", 20)} Access Sequence (Hit / Miss)</h2><div id="sqBox"></div>
      <div class="legend" style="flex-direction:row;flex-wrap:wrap;margin-top:10px"><div><span class="tag hit">H</span> Cache hit (served from cache, ${num(s.hit_time ?? 2)} cycles)</div>
      <div><span class="tag miss">M</span> Cache miss (fetch from memory, ${num(s.miss_latency)} cycles here)</div><div><span class="tag err">E</span> Error / not completed</div></div></section>
  </div>`;
}
function bindTrace() {
  if (!App.tr) return;
  $$("[data-f]").forEach((b) => (b.onclick = () => { TR.filter = b.dataset.f; TR.page = 0; render(); }));
  $("#trQ").oninput = (e) => { TR.q = e.target.value; TR.page = 0; paintTrace(true); };
  const ex = $("#exBtn"); ex.onclick = () => { const p = $("#exPop"); p.hidden = !p.hidden; ex.setAttribute("aria-expanded", String(!p.hidden)); };
  const list = traceFiltered(), i = list.findIndex((a) => a.n === App.sel.acc); if (i >= 0) TR.page = Math.floor(i / TR.per);
  paintTrace(); paintAccess();
}
function paintTrace(keepFocus) {
  const body = $("#trBody"); if (!body) return;
  const list = traceFiltered(), pages = Math.max(1, Math.ceil(list.length / TR.per)); TR.page = Math.min(TR.page, pages - 1);
  const rows = list.slice(TR.page * TR.per, (TR.page + 1) * TR.per);
  body.innerHTML = rows.length ? rows.map((a) => `<tr data-k="${a.n}" tabindex="0" class="${a.n === App.sel.acc ? "sel" : ""}" aria-selected="${a.n === App.sel.acc}"><td>${a.n}</td><td>${a.cycle}</td><td class="m">${a.addr != null ? hex(a.addr, 8) : "–"}</td>
    <td class="m">${a.tag != null ? hex(a.tag, 6) : "–"}</td><td class="m">${a.index != null ? hex(a.index, 2) : "–"}</td><td class="m">${a.offset != null ? hex(a.offset) : "–"}</td><td>${resultTag(a.result)}</td><td>${esc(a.transition)}</td></tr>`).join("") : `<tr><td colspan="8">No accesses match.</td></tr>`;
  $("#trPager").innerHTML = `<span>${list.length} accesses · page ${TR.page + 1} of ${pages}</span><button class="btn sm" id="pgP" ${TR.page === 0 ? "disabled" : ""} aria-label="Previous page">${icon("left", 14)}</button><button class="btn sm" id="pgN" ${TR.page >= pages - 1 ? "disabled" : ""} aria-label="Next page">${icon("right", 14)}</button>`;
  $("#pgP").onclick = () => { TR.page--; paintTrace(); }; $("#pgN").onclick = () => { TR.page++; paintTrace(); };
  bindTraceRows(body, () => { paintTrace(); paintAccess(); });
  const sel = body.querySelector("tr.sel"); if (sel && !keepFocus) sel.scrollIntoView({ block: "nearest" });
}
function paintAccess() {
  const a = selAccess(), box = $("#adBox"); if (!box) return;
  $("#adN").textContent = a ? `( #${a.n} )` : "";
  box.innerHTML = a ? `<div class="kv"><span>Cycle</span><span>${a.cycle}</span><span>Time</span><span>${esc(fmtNs(a.accept_t))}</span><span>Address (hex)</span><span>${a.addr != null ? hex(a.addr, 8) : "–"}</span>
    <span>Tag</span><span>${a.tag != null ? hex(a.tag, 6) : "–"}</span><span>Index</span><span>${a.index != null ? hex(a.index, 2) + " (" + a.index + ")" : "–"}</span><span>Offset</span><span>${a.offset != null ? hex(a.offset) : "–"}</span>
    <span>Result</span><span>${resultTag(a.result)}</span><span>FSM Transition</span><span style="font-family:var(--sans)">${esc(a.transition)}</span><span>FSM path</span><span style="font-family:var(--sans)">${esc(a.states.join(" → ") || "–")}</span>
    <span>Latency</span><span>${a.latency ?? "–"} cycles</span>${a.rdata != null ? `<span>Data returned</span><span>${hex(a.rdata, 8)}</span>` : ""}</div>
    <p class="note" style="margin:8px 0">${esc(whyText(a))}</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">${a.index != null ? `<a class="btn sm" href="${href("cache", { line: a.index })}">${icon("layers", 14)} View cache line</a>` : ""}
      <a class="btn sm" href="${href("waveform", { acc: a.n, mode: "access" })}" id="toWave">${icon("activity", 14)} View waveform</a></div>` : `<div class="empty">Select an access.</div>`;
  const tw = $("#toWave"); if (tw) tw.onclick = () => { App.wv.cursor = a.accept_t; };
  const list = App.tr.accesses, i = Math.max(0, list.findIndex((x) => x.n === App.sel.acc)), from = Math.max(0, Math.min(i - 5, list.length - 12)), win = list.slice(from, from + 12);
  $("#sqBox").innerHTML = `<div class="seq" role="group" aria-label="Access sequence">${from > 0 ? `<span class="note" style="align-self:center">…</span>` : ""}${win.map((x) => {
    const k = x.result === "hit" ? "H" : x.result === "miss" ? "M" : x.result === "error" ? "E" : "X";
    return `<button class="${k}${x.n === App.sel.acc ? " sel" : ""}" data-k="${x.n}" aria-label="Access ${x.n}: ${x.result}"><i>${k === "X" ? "?" : k}</i>#${x.n}</button>`; }).join("")}${from + 12 < list.length ? `<span class="note" style="align-self:center">…</span>` : ""}</div>`;
  $$("#sqBox button").forEach((b) => (b.onclick = () => { selectAccess(Number(b.dataset.k)); paintTrace(); paintAccess(); }));
}

function barAddr() {
  const c = App.cfg;
  return `<div class="bar3" role="img" aria-label="Address split into tag, index and offset"><div class="tg" style="flex:${c.tag_bits}">Tag (${c.tag_bits} bits)</div><div class="ix" style="flex:${c.index_bits + 3}">Index (${c.index_bits} bits)</div><div class="of" style="flex:${c.offset_bits + 3}">Offset (${c.offset_bits} bits)</div></div>
    <ul style="margin:10px 0 0;padding:0;list-style:none;font-size:13px"><li><span class="dot" style="background:var(--yellow)"></span><b style="color:var(--yellow)">Offset (${c.offset_bits} bits):</b> selects 1 of ${c.block_bytes} bytes in a block (2<sup>${c.offset_bits}</sup> = ${c.block_bytes})</li>
    <li><span class="dot" style="background:var(--cyan)"></span><b style="color:var(--cyan)">Index (${c.index_bits} bits):</b> selects 1 of ${c.lines} cache lines (2<sup>${c.index_bits}</sup> = ${c.lines})</li>
    <li><span class="dot" style="background:var(--purple-l)"></span><b style="color:var(--purple-l)">Tag (${c.tag_bits} bits):</b> identifies which memory block is stored in that line</li></ul>`;
}
function barLine() {
  const c = App.cfg;
  return `<div class="bar3" role="img" aria-label="Cache line format"><div class="vv" style="flex:1.1">Valid<br>(1 bit)</div><div class="tgl" style="flex:2">Tag<br>(${c.tag_bits} bits)</div><div class="dat" style="flex:3">Data (Block)<br>(${c.block_bytes} bytes = ${c.block_bits} bits)</div></div>
    <ul style="margin:10px 0 0;padding:0;list-style:none;font-size:13px"><li><span class="dot" style="background:var(--cyan)"></span><b>Valid:</b> 1 → line contains valid data, 0 → empty</li>
    <li><span class="dot" style="background:var(--purple-l)"></span><b>Tag:</b> upper ${c.tag_bits} bits of the memory address</li><li><span class="dot" style="background:var(--purple-l)"></span><b>Data:</b> ${c.block_bytes}-byte block fetched from main memory</li></ul>`;
}
function archDiagram() {
  const c = App.cfg;
  return `<div class="arch"><div class="box">${icon("cpu", 34)}<div>CPU<br><small class="note">(testbench)</small></div></div>
    <div class="ar">Addr, req<br>${icon("right", 16)}<br>${icon("left", 16)}<br>Hit, Data</div>
    <div class="box pri">${icon("gear", 30)}<div><b>Cache Controller</b><br><small>(${esc(c.mapping)})</small></div></div><div class="ar">${icon("right", 14)}${icon("left", 14)}</div>
    <div style="display:flex;flex-direction:column;gap:10px"><div class="box cy">${icon("memory", 26)} Cache (${kb(c.cache_bytes)})</div><div class="box">${icon("server", 26)} Main Memory</div></div></div>`;
}
function amatBlock() {
  const n = summaryNums();
  if (n && n.s.hit_time != null && n.s.miss_penalty != null) {
    const s = n.s;
    return `<span class="tag-real">measured in run ${esc(App.run.run_id)}</span>
      <div class="formula">AMAT = Hit Time + Miss Rate × Miss Penalty</div>
      <div class="kv"><span>Hit time (T<sub>h</sub>)</span><span>${num(s.hit_time)} cycles</span><span>Miss penalty (extra cycles)</span><span>${num(s.miss_penalty)} cycles</span><span>Hit rate</span><span>${pct(s.hit_rate, 2)}</span><span>Miss rate</span><span>${pct(s.miss_rate, 2)}</span>
      <span>AMAT (formula)</span><span>${num(s.amat_model)} cycles</span><span>Average latency (direct)</span><span>${num(s.avg_latency)} cycles</span></div>`;
  }
  return `<span class="tag-sample">sample numbers — not from a run</span><div class="formula">AMAT = Hit Time + Miss Rate × Miss Penalty</div>
    <div class="kv"><span>Hit time</span><span>2 cycles</span><span>Miss penalty</span><span>9 cycles</span><span>Miss rate</span><span>25%</span><span>AMAT</span><span>2 + 0.25 × 9 = 4.25 cycles</span></div>
    <p class="note">Run a simulation with both hits and misses to see measured numbers here.</p>`;
}
function fsmTable() {
  const info = { IDLE: ["Waits for a request. req_ready = 1. On accept the address is latched.", "accept → LOOKUP (or COMPLETE for a bad request)"],
    LOOKUP: ["Compares the stored tag with the request tag and checks the valid bit.", "hit → COMPLETE; miss → MISS_REQ"], MISS_REQ: ["Pulses a block-read start to the memory interface.", "always → WAIT_MEM"],
    WAIT_MEM: ["Waits for the 16-byte block from main memory.", "mem done → REFILL"], REFILL: ["Writes data, tag and sets the valid bit of the line.", "always → COMPLETE"],
    COMPLETE: ["Sends resp_valid with the selected word.", "always → IDLE"] };
  return `<div class="tw"><table class="t"><thead><tr><th>Encoding</th><th>State</th><th>What it does</th><th>Transition</th></tr></thead><tbody>${App.cfg.states.map((s) => `<tr><td class="m">3'b${bin(s.code, 3)}</td><td><span class="st ${stateClass(s.name)}" style="padding:2px 10px;border:1.5px solid;border-radius:99px;font-family:var(--mono);font-size:12px">${esc(s.name)}</span></td><td style="white-space:normal">${esc((info[s.name] || ["–"])[0])}</td><td style="white-space:normal">${esc((info[s.name] || ["", "–"])[1])}</td></tr>`).join("")}</tbody></table></div>
    <p class="note">State names and encodings are read from <span class="mono">rtl/cache_controller.v</span>.</p>`;
}
// ================================================================ router
const PAGE_FN = { simulation: [pageSimulation, bindSimulation], cache: [pageCache, bindCache], waveform: [pageWaveform, bindWaveform], trace: [pageTrace, bindTrace] };
function parseHash() {
  const h = location.hash.slice(1) || "/simulation", [path, qs] = h.split("?");
  const page = path.replace(/^\//, "");
  App.page = PAGE_FN[page] ? page : "simulation";
  App.params = Object.fromEntries(new URLSearchParams(qs || ""));
}
function render() {
  wave?.destroy(); wave = null; miniWave?.destroy(); miniWave = null;
  const [view, bind] = PAGE_FN[App.page];
  if (!App.cfg) { $("#page").innerHTML = `<div class="panel"><div class="empty">${icon("warn", 22)}<p>Waiting for the simulation backend. Start it with <code>make portal</code>; this page will load when it is running.</p></div></div>`; return; }
  $("#page").innerHTML = view();
  try { bind(); } catch (e) { console.error(e); }
  $$("#side a").forEach((a) => { a.href = href(a.getAttribute("data-p")); a.getAttribute("data-p") === App.page ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"); });
  document.title = `${PAGES.find((p) => p[0] === App.page)[1]} · Direct-Mapped Cache Controller`;
  $("#side").classList.remove("open"); $("#menuBtn").setAttribute("aria-expanded", "false");
}
async function route() {
  parseHash();
  CV.scrolled = false;
  let id = App.params.run;
  if (!id && !App.run) { try { id = localStorage.getItem("cachePortal.run"); } catch (e) { /* ignore */ } }
  if (!id && !App.run) id = App.runs.find((r) => r.status !== "compile_error")?.run_id;
  if (id && (!App.run || App.run.run_id !== id)) { renderCtx(); render(); await loadRun(id); return; }
  if (App.params.acc != null && App.tr && accessByN(Number(App.params.acc))) { App.sel.acc = Number(App.params.acc); const a = selAccess(); if (a?.index != null && App.params.line == null) App.sel.line = a.index; App.wv.cursor = a.accept_t; }
  if (App.params.line != null) App.sel.line = Number(App.params.line);
  renderCtx(); render();
}
onChange((what) => {
  if (what === "offline") { renderCtx(); return; }
  if (what === "phase") { renderCtx(); const s = $("#runStatus"); if (s) s.innerHTML = runStatusHtml(); return; }
  if (what === "run" || what === "busy" || what === "sel" || what === "runs") {
    if (what === "sel" && App.page === "waveform") { return; }
    renderCtx();
    const typing = document.activeElement && ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName) && document.activeElement.closest("#page");
    if (what === "runs" && typing) return;
    if (!typing || what === "run" || what === "busy") render();
  }
});

async function boot() {
  $("#menuBtn").onclick = () => { const s = $("#side"); const open = !s.classList.contains("open"); s.classList.toggle("open", open); $("#menuBtn").setAttribute("aria-expanded", String(open)); };
  document.addEventListener("click", (e) => { const m = $("#exPop"); if (m && !m.hidden && !e.target.closest(".dlmenu")) m.hidden = true; const sm = $("#wSigMenu"); if (sm && !sm.hidden && !e.target.closest("#wSigMenu") && e.target.id !== "wSigBtn" && !e.target.closest("#wSigBtn")) sm.hidden = true; });
  try { [App.cfg, App.scen] = await Promise.all([api("/api/config"), api("/api/scenarios")]); await refreshRuns(); }
  catch (e) { if (!quiet(e)) console.warn("boot:", e.message); }
  renderShell();
  window.addEventListener("hashchange", route);
  await route();
}
boot();
