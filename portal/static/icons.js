"use strict";
// Inline SVG icon set (24x24, 1.8 stroke, round caps) so every icon matches in weight and style.
const ICONS = {
  play: '<polygon points="7 4 20 12 7 20 7 4"/>',
  layers: '<polygon points="12 2.5 2.5 7.5 12 12.5 21.5 7.5 12 2.5"/><polyline points="2.5 12.5 12 17.5 21.5 12.5"/><polyline points="2.5 17 12 22 21.5 17"/>',
  activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  list: '<line x1="9" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="9" y1="18" x2="21" y2="18"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  book: '<path d="M2 4.5h6a4 4 0 0 1 4 4V21a3 3 0 0 0-3-3H2z"/><path d="M22 4.5h-6a4 4 0 0 0-4 4V21a3 3 0 0 1 3-3h7z"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="1.5"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  memory: '<rect x="2" y="7" width="20" height="9" rx="1.5"/><path d="M6 10.5v2.5M10 10.5v2.5M14 10.5v2.5M18 10.5v2.5M5 16v3M9 16v3M13 16v3M17 16v3"/>',
  server: '<rect x="3" y="3.5" width="18" height="7" rx="1.5"/><rect x="3" y="13.5" width="18" height="7" rx="1.5"/><circle cx="7" cy="7" r=".8"/><circle cx="7" cy="17" r=".8"/><path d="M11 7h6M11 17h6"/>',
  binary: '<rect x="2" y="5.5" width="20" height="13" rx="2"/><text x="12" y="14.6" font-size="7.2" font-family="ui-monospace,Menlo,monospace" text-anchor="middle" fill="currentColor" stroke="none" font-weight="700">0101</text>',
  blocks: '<rect x="3" y="14" width="8" height="6" rx="1"/><rect x="13" y="14" width="8" height="6" rx="1"/><rect x="8" y="5" width="8" height="6" rx="1"/>',
  zoomin: '<circle cx="10.5" cy="10.5" r="6.5"/><line x1="21" y1="21" x2="15.2" y2="15.2"/><line x1="10.5" y1="7.5" x2="10.5" y2="13.5"/><line x1="7.5" y1="10.5" x2="13.5" y2="10.5"/>',
  zoomout: '<circle cx="10.5" cy="10.5" r="6.5"/><line x1="21" y1="21" x2="15.2" y2="15.2"/><line x1="7.5" y1="10.5" x2="13.5" y2="10.5"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  skipback: '<line x1="5" y1="5" x2="5" y2="19"/><polygon points="19 5 9 12 19 19 19 5"/>',
  skipfwd: '<line x1="19" y1="5" x2="19" y2="19"/><polygon points="5 5 15 12 5 19 5 5"/>',
  left: '<polyline points="15 5 8 12 15 19"/>',
  right: '<polyline points="9 5 16 12 9 19"/>',
  down: '<polyline points="6 9 12 15 18 9"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><line x1="21" y1="21" x2="15.2" y2="15.2"/>',
  download: '<path d="M12 3v12"/><polyline points="7 10.5 12 15.5 17 10.5"/><path d="M4 19h16"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V5.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/>',
  check: '<circle cx="12" cy="12" r="9.5"/><polyline points="7.5 12.5 10.5 15.5 16.5 9"/>',
  xcircle: '<circle cx="12" cy="12" r="9.5"/><line x1="8.5" y1="8.5" x2="15.5" y2="15.5"/><line x1="15.5" y1="8.5" x2="8.5" y2="15.5"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><polyline points="12 9.5 12 13.5 14.8 15.2"/><line x1="9.5" y1="2.8" x2="14.5" y2="2.8"/><line x1="12" y1="2.8" x2="12" y2="6"/>',
  bars: '<line x1="5" y1="20" x2="5" y2="12"/><line x1="10" y1="20" x2="10" y2="5"/><line x1="15" y1="20" x2="15" y2="9"/><line x1="20" y1="20" x2="20" y2="14"/>',
  home: '<path d="M3.5 11 12 3.5 20.5 11"/><path d="M5.5 9.5V20.5h13V9.5"/><path d="M10 20.5v-6h4v6"/>',
  fsm: '<circle cx="12" cy="5" r="2.6"/><circle cx="5" cy="19" r="2.6"/><circle cx="19" cy="19" r="2.6"/><path d="M12 7.6v4.4M12 12 6.3 16.8M12 12l5.7 4.8"/>',
  code: '<polyline points="8 6 2.5 12 8 18"/><polyline points="16 6 21.5 12 16 18"/><line x1="14" y1="4.5" x2="10" y2="19.5"/>',
  tag: '<path d="M3 12.5V4.5a1.5 1.5 0 0 1 1.5-1.5h8L21 11.5l-8.5 8.5z"/><circle cx="8" cy="8" r="1.3"/>',
  info: '<circle cx="12" cy="12" r="9.5"/><line x1="12" y1="11" x2="12" y2="16.5"/><circle cx="12" cy="7.6" r=".6"/>',
  pointer: '<path d="M5 3.5 19 11l-6.5 1.8L10 19.5z"/>',
  reset: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><polyline points="3 4 3.5 8.5 8 8"/>',
  file: '<path d="M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z"/><polyline points="14 2.5 14 8 19.5 8"/>',
  menu: '<line x1="4" y1="6.5" x2="20" y2="6.5"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17.5" x2="20" y2="17.5"/>',
  warn: '<path d="M10.3 3.9 1.9 18.4a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9.5" x2="12" y2="14"/><circle cx="12" cy="17.3" r=".6"/>',
  trash: '<polyline points="3.5 6.5 20.5 6.5"/><path d="M8.5 6.5V4a1.5 1.5 0 0 1 1.5-1.5h4A1.5 1.5 0 0 1 15.5 4v2.5"/><path d="M5.5 6.5 6.5 20a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5l1-13.5"/>',
  clock: '<circle cx="12" cy="12" r="9.5"/><polyline points="12 6.5 12 12 15.8 14"/>',
  cpu: '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 1.5v3.5M15 1.5v3.5M9 19v3.5M15 19v3.5M1.5 9h3.5M1.5 15h3.5M19 9h3.5M19 15h3.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  cpubox: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 3v3M12 3v3M16 3v3M8 18v3M12 18v3M16 18v3M3 8h3M3 12h3M3 16h3M18 8h3M18 12h3M18 16h3"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
  link: '<path d="M10 13.5a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M14 10.5a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/>',
  help: '<circle cx="12" cy="12" r="9.5"/><path d="M9.3 9.2a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.3-2.7 4"/><circle cx="12" cy="17.4" r=".6"/>',
};

function icon(name, size = 18, cls = "") {
  const body = ICONS[name] || "";
  return `<svg class="ico ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

// Abstract spider mark (decorative, generic arachnid): body, head and eight legs.
function spiderMark(size = 40) {
  return `<svg class="spider" width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <ellipse cx="24" cy="29" rx="6.2" ry="8.2" fill="rgba(167,139,250,.18)"/><circle cx="24" cy="17.5" r="3.6" fill="rgba(167,139,250,.18)"/>
    <path d="M20.6 16C14 12 9 9 5 9M20 19.5C13 18 9 20 5 25M20.4 27C14 27 9 31 7 39M21.2 34C17 36 15 41 14.5 44"/>
    <path d="M27.4 16C34 12 39 9 43 9M28 19.5C35 18 39 20 43 25M27.6 27C34 27 39 31 41 39M26.8 34C31 36 33 41 33.5 44"/>
    <circle cx="22.8" cy="16.6" r=".7" fill="currentColor" stroke="none"/><circle cx="25.2" cy="16.6" r=".7" fill="currentColor" stroke="none"/></svg>`;
}
