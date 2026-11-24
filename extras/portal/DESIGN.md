---
name: Silicon Architecture Workstation
colors:
  surface: '#f9faf3'
  surface-dim: '#dadad4'
  surface-bright: '#f9faf3'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f4ed'
  surface-container: '#eeeee8'
  surface-container-high: '#e8e9e2'
  surface-container-highest: '#e2e3dc'
  on-surface: '#1a1c18'
  on-surface-variant: '#404945'
  inverse-surface: '#2f312d'
  inverse-on-surface: '#f1f1eb'
  outline: '#707975'
  outline-variant: '#c0c9c3'
  surface-tint: '#356758'
  primary: '#326556'
  on-primary: '#ffffff'
  primary-container: '#4b7e6e'
  on-primary-container: '#f5fff9'
  inverse-primary: '#9cd1be'
  secondary: '#456827'
  on-secondary: '#ffffff'
  secondary-container: '#c3ec9c'
  on-secondary-container: '#496c2b'
  tertiary: '#8b4c05'
  on-tertiary: '#ffffff'
  tertiary-container: '#a96420'
  on-tertiary-container: '#fffbff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#b8eeda'
  primary-fixed-dim: '#9cd1be'
  on-primary-fixed: '#002018'
  on-primary-fixed-variant: '#1b4f41'
  secondary-fixed: '#c5ef9f'
  secondary-fixed-dim: '#aad385'
  on-secondary-fixed: '#0d2000'
  on-secondary-fixed-variant: '#2e4f11'
  tertiary-fixed: '#ffdcc2'
  tertiary-fixed-dim: '#ffb77b'
  on-tertiary-fixed: '#2e1500'
  on-tertiary-fixed-variant: '#6d3a00'
  background: '#f9faf3'
  on-background: '#1a1c18'
  surface-variant: '#e2e3dc'
typography:
  headline-xl:
    fontFamily: Space Grotesk
    fontSize: 2.25rem
    fontWeight: '600'
    lineHeight: 2.75rem
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Space Grotesk
    fontSize: 1.75rem
    fontWeight: '600'
    lineHeight: 2.25rem
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Space Grotesk
    fontSize: 1.25rem
    fontWeight: '600'
    lineHeight: 1.75rem
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Space Grotesk
    fontSize: 1rem
    fontWeight: '600'
    lineHeight: 1.5rem
    letterSpacing: 0em
  body-lg:
    fontFamily: Geist
    fontSize: 1rem
    fontWeight: '400'
    lineHeight: 1.5rem
  body-md:
    fontFamily: Geist
    fontSize: 0.875rem
    fontWeight: '400'
    lineHeight: 1.25rem
  body-sm:
    fontFamily: Geist
    fontSize: 0.75rem
    fontWeight: '400'
    lineHeight: 1rem
  mono-data-lg:
    fontFamily: JetBrains Mono
    fontSize: 0.875rem
    fontWeight: '500'
    lineHeight: 1.25rem
    letterSpacing: -0.02em
  mono-data-md:
    fontFamily: JetBrains Mono
    fontSize: 0.75rem
    fontWeight: '400'
    lineHeight: 1rem
    letterSpacing: 0em
  mono-data-sm:
    fontFamily: JetBrains Mono
    fontSize: 0.6875rem
    fontWeight: '400'
    lineHeight: 0.875rem
    letterSpacing: 0.02em
  label-caps:
    fontFamily: JetBrains Mono
    fontSize: 0.625rem
    fontWeight: '700'
    lineHeight: 0.75rem
    letterSpacing: 0.08em
spacing:
  gutter: 0.75rem
  gutter-mobile: 0.5rem
  margin: 1rem
  margin-mobile: 0.5rem
  space-xs: 0.125rem
  space-sm: 0.25rem
  space-md: 0.5rem
  space-lg: 0.75rem
  space-xl: 1rem
---

## Brand & Style
The design system establishes a high-density, analytical visual environment tailored for electronic design automation (EDA), VLSI synthesis, and microprocessor architectural modeling. It balances the rigorous precision of hardware schematic drafting with modern ergonomic software ergonomics. 

Rather than adopting standard sterile lab interfaces, this design system combines technical brutalism and blueprint schematic styling over a warm, anti-glare tinted substrate. It invokes the calculated mastery of micro-architecture: razor-sharp division, monospaced registers, waveform pulses, and absolute dimensional rhythm. The aesthetic rejects decorative softness in favor of functional density, information clarity, and zero-latency visual parsing for engineers inspecting millions of gates and bus cycles.

## Colors
The palette leverages a calibrated five-hue system engineered specifically for telemetry, verification states, and multi-layered bus traces over an anti-fatigue light workspace.

### Core Roles & Palette Mapping
- **Primary (`#5b8e7d` — Deep Pine Teal):** Denotes stable architectural clock nets, active hardware traces, confirmed routing, and dominant interactive structural framing.
- **Secondary (`#8cb369` — Olive/Sage Green):** Indicates successful assertions, cache hits, validated timings, synchronized signals, and nominal thermal zones.
- **Tertiary (`#f4a259` — Amber Orange):** Highlights bus contention, timing jitter, elevated capacitance, pipeline stalls, and warnings.
- **Accent / Critical (`#bc4b51` — Brick Crimson):** Identifies parity errors, cache misses, setup/hold violations, critical path regressions, and hardware interrupts.
- **Telemetry Highlight (`#f4e285` — Warm Solar Yellow):** Applied strictly to high-attention focal targets, active waveform cursors, register strobe markers, and selected node highlights.

### Substrate & Neutral Architecture
- **Base Canvas (`#f7f6f0`):** Soft technical parchment providing a glare-free baseline for extended verification sessions.
- **Substrate Elevated (`#efeee6`):** Modular card backgrounds and logic-analyzer deck bays.
- **Gridline/Rule Neutral (`#dcdad0`):** 1px structural guidelines and sub-circuit separators.
- **Text & Bus Data (`#1e2321`):** High-contrast deep carbon for code, hex values, and labels, supported by `#60625d` for register metadata and non-critical metrics.

## Typography
Typographic hierarchy is split cleanly across functional disciplines:

1. **Structural Headers (`Space Grotesk`):** Engineered, geometric letterforms without eccentricities. Used exclusively for tool suite headers, view layouts, chip block identifiers, and module names.
2. **Standard Text (`Geist`):** Delivers clean readability for descriptive documentation, linting outputs, annotations, and engineer communications.
3. **Telemetry & Register Level (`JetBrains Mono`):** The primary workhorse font. Governs clock cycle readouts, signal states, hexadecimal addresses, opcode disassemblies, pinouts, and tabular timing analyses. Strict alignment and zero visual drift across variable state updates are guaranteed by fixed character widths.

## Layout & Spacing
The layout model employs an ultra-dense, strict grid inspired by automated physical place-and-route matrix layouts. 

### Grid & Density Rules
- Workstations utilize a flexible 16-column continuous docking system optimized for high-resolution 4K/wide monitors, with collapsible tool trays and tiled schematic viewports.
- Spacing is tightly metered using a base 4px sub-grid (`space-xs` = 2px, `space-sm` = 4px, `space-md` = 8px, `space-lg` = 12px, `space-xl` = 16px). Unused whitespace is minimized to maintain high visual data density without overlapping metadata.
- Hairline structural rulings (1px solid `#dcdad0`) delimit panels, breadboard grids, and register maps instead of generous margins. Viewports collapse into tabbed single-column inspectors below 1024px.

## Elevation & Depth
Elevation rejects blur-heavy drop shadows. In place of optical elevation, the interface expresses depth through **architectural surface tiers** and **hairline CAD boundaries**.

- **Level 0 (Motherboard/Canvas):** The base canvas (`#f7f6f0`) sits etched with an optional coordinate dot-matrix (1px dots spaced every 16px in `#e2dfd4`).
- **Level 1 (Sub-system Panels & Cards):** Surface elevated (`#efeee6`) bounded by an exact 1px solid border (`#dcdad0`). Zero cast shadow.
- **Level 2 (Active Inspections / Focus Modules):** Tinted highlight surfaces framed by a crisp 1px stroke of Primary (`#5b8e7d`) or Amber (`#f4a259`) with an offset 2px hard contrast border (box-shadow: `0 0 0 1px #5b8e7d`).
- **Level 3 (Floating Probes & Overlays):** HUD telemetry probes and context inspections feature an opaque `#fcfbf7` surface with a crisp dual rule: `1px solid #1e2321` and a hard, crisp drop-shadow (`2px 2px 0px rgba(30, 35, 33, 0.15)`).

## Shapes
Every component embodies crisp technical geometry with zero rounding (`0px`). Corners on cards, tabs, inputs, buttons, and state chips are strictly square, honoring industrial test instrumentation, breadboard schematics, and silicon die packages. In dense technical dashboards, square geometries maximize the available active surface area and align flush against adjoining metrics and 1px coordinate rules.

## Components

### Buttons & Interactive Triggers
- **Primary Action (Synthesize/Commit):** Solid Deep Pine Teal (`#5b8e7d`) with crisp white `#ffffff` label text, `0px` radius, 1px solid `#497365` border. On hover, background shifts to `#497365`.
- **Secondary Action (Step/Probe):** `#efeee6` background with 1px solid `#dcdad0` border and `#1e2321` text. On hover, shifts to `#e2dfd4` with a 1px solid `#5b8e7d` active left accent bar.
- **Critical Action (Interrupt/Halt):** Brick Crimson (`#bc4b51`) outline with solid `#bc4b51` text on `#fbf0f0` background. On active press: solid `#bc4b51` with white text.

### Telemetry & State Chips (Hits, Misses, Status)
- Structured with `label-caps` typography and an inline 6px square status indicator.
- **Cache Hit / Passing:** Background `#8cb369` at 15% opacity, text `#3e5c26`, border `1px solid #8cb369`.
- **Cache Miss / Violation:** Background `#bc4b51` at 15% opacity, text `#802328`, border `1px solid #bc4b51`.
- **Clock Jitter / Warning:** Background `#f4a259` at 20% opacity, text `#8a4e17`, border `1px solid #f4a259`.
- **Active Cursor / Strobe:** Background `#f4e285`, text `#4a3f00`, border `1px solid #cfb846`.

### Hardware Data Cards & Module Panels
- Rigid structural containers constructed on `#efeee6` with a continuous `1px solid #dcdad0` boundary.
- Header bars feature an integrated 24px height strip displaying module hierarchical paths (e.g., `TOP.CORE_0.ALU.L1_CACHE`) in `mono-data-sm` with a right-aligned hex address anchor.

### Form Inputs & Micro-Adjusters
- Inputs for memory addresses, clock periods, and constraint fields use an inset `#fdfcf7` background, `0px` border radius, `1px solid #c8c5b8`, and `mono-data-md` typography.
- Focused state applies an immediate `1px solid #5b8e7d` rule and an ultra-fine `1px` inner contour.

### Waveform Visualizer & Trace Lanes
- Signal name panel locked to the left column in `mono-data-sm`.
- Traces render across alternating background lane tints (`#f7f6f0` and `#f2f1e9`).
- Signal transition pulses are mapped strictly to 2px vector lines: High/Active signals use `#5b8e7d`, high-impedance (Z) uses `#60625d` dotted, and unstable/hazard states render in `#bc4b51`.
- Visual scrubber and timing cursors render as a 1px solid vertical line in `#f4e285` backed by a 2px semi-transparent halo.