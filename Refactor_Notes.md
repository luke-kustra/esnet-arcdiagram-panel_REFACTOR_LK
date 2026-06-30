# Refactor Notes — esnet-arcdiagram-panel

This document records the modernization refactor of the Arc Diagram Grafana panel plugin.
A **refactor** here means: the rendered output (the arc diagram and all its controls) stays
the same; only the internal/functional code and the build tooling change. The driving goal
was to make the plugin build and run on the **latest Grafana (13.x)**, which it previously
could not.

---

## Why this refactor

The plugin was scaffolded with an early `@grafana/create-plugin` (Grafana 9.x era) and was
pinned to **React 17** and the **Grafana 9.x SDK**. On current Grafana (tested against a local
**13.0.2** install) it was partly broken — most notably node clustering, because
`src/utils.ts` read `field.values.buffer`, and the `Vector.buffer` internal was **removed in
Grafana 10+**. The dependency set also used floating `latest` versions (non-reproducible
builds) and carried junk/unused packages.

### Goals (confirmed with the user)
- **Depth:** full modernization — not just the minimum to compile.
- **Target:** latest Grafana only (Grafana 13 / React 18 / `@grafana/* ^13`). Grafana 9/10
  support is intentionally dropped.
- **Bugs:** fix obvious latent bugs (output may differ in the documented edge cases below).
- **Verification:** add parser/util unit tests + manual visual diff at `localhost:3000`.

---

## Target stack

| Item | Before | After |
|------|--------|-------|
| `@grafana/data` / `ui` / `runtime` | 9.x / floating `latest` | `^13.0.0` (pinned) |
| `grafanaDependency` (plugin.json) | `>=9.4.0` | `>=12.0.0` |
| React / react-dom | 17.0.2 | 18.3.x |
| TypeScript | ^4.4 | ^5.x |
| `.config/` build tooling | old committed snapshot | re-scaffolded (`@grafana/create-plugin` 7.x) |
| Node | `.nvmrc` 16 / engines `>=14` | `.nvmrc` 22 / engines `>=22` |

> Note: local dev machine is on **Node v26.3.1**, which is newer than Grafana tooling
> officially supports (20/22). Watch for build-tool incompatibilities.

---

## Change log (by phase)

### Phase 0 — Baseline & safety net  ✅
- Confirmed starting state: `@grafana/data`/`ui` 9.4.7, `@grafana/runtime` 9.3.8, React 17.0.2.
- Both `yarn.lock` and `package-lock.json` present (to be reduced to one).
- Latest published SDK confirmed as **13.1.0** (matches local Grafana 13.0.2); React peer dep
  for Grafana 13 is `^18.0.0`.
- Created this document.

### Phase 1 — Tooling & dependency modernization  ✅
- **Migrated the `.config/` tooling** to the current scaffold via
  `npx @grafana/create-plugin@latest migrate` (create-plugin 7.8.0). This replaced the
  Grafana-9-era webpack/jest/eslint/tsconfig snapshot with the modern equivalents (flat
  ESLint config, webpack 5.10x, SWC, Playwright-based e2e scaffolding, new Docker base) and
  added the `.config/.cprc.json` version marker so future `update` runs work.
- **Rewrote `package.json`** to the modern dependency set:
  - `@grafana/data` / `ui` / `runtime` / `schema` / `i18n` → `^13.0.2` (was 9.x / floating
    `latest`). Pins the SDK to one major; matches the local Grafana 13.0.2.
  - React / react-dom → `^18.3.0` (was 17.0.2).
  - TypeScript → `5.9.2` (was ^4.4). ESLint 9 flat config, Prettier 3, Jest 29.7, etc.
  - **Removed junk/unused deps:** `nvm`, `reload`, `watch`, `jsdoc`, `grafana-plugin-support`,
    plus unused `@types/jquery` and `@types/lodash` (no jquery/lodash usage in `src/`).
  - Modernized scripts: `lint` → `eslint --cache .`, `e2e` → `playwright test`,
    `server` → `docker compose up --build`, `sign` → `sign-plugin`.
- **Standardized on npm:** deleted `yarn.lock` (kept a regenerated `package-lock.json`),
  removed the `packageManager: yarn@…` field.
- Created root **`eslint.config.mjs`** (flat config extending `.config/eslint.config.mjs`) and
  removed the legacy `.eslintrc`.
- `.nvmrc` → `22`; `engines.node` → `>=22` (was 16 / `>=14`).
- `src/plugin.json` → `grafanaDependency: ">=12.0.0"` (was `>=9.4.0`).
- **TS strict mode is now ON** (inherited from `@grafana/tsconfig` v2): `strict`,
  `noImplicitAny`, `strictNullChecks`. This surfaced 10 implicit-`any` type errors in
  `dataParser.ts` / `pathDataParser.ts` / `utils.ts` — fixed in Phase 3.
- **Verified:** `npm install` (Node 26 — works despite an EBADENGINE warning for >24),
  `npm run build` compiles cleanly (webpack 5.108.3, `module.js` emitted), `eslint .` is clean.

> Note: the production build uses `swc-loader` (no type-checking), so it builds even with the
> Phase-3 type errors outstanding; `npm run typecheck` is the gate for those.

### Phase 2 — Grafana data-access modernization  ✅
- **`src/utils.ts` `clusterNodes` (the primary break):** changed `?.values.buffer` →
  `?.values` on both the source and destination cluster fields. In Grafana 9 `Field.values`
  was an `ArrayVector` whose `.buffer` held the backing array; from Grafana 10 `Field.values`
  *is* a plain array and `.buffer` is `undefined`. This is why node clustering threw on the
  user's Grafana 13. The replacement yields the same array, so behavior is preserved (now it
  actually runs).
- **Audited all other `field.values` access** (`dataParser.ts`, `pathDataParser.ts`,
  `Arc.tsx`): they index/spread/`join` the values directly (`?.values[i]`, `[...values]`,
  `.values.join()`), which works identically on a plain array — no further changes needed.
- **Confirmed still-valid APIs** (not deprecated on Grafana 13, per ESLint `no-deprecated`):
  `field.display(...).text/.suffix/.color`, `field.state.displayName`, and the
  `useFieldConfig({ disableStandardOptions, standardOptions })` block in `module.ts`. Left the
  field-config untouched to keep the standard-options output identical.
- **Removed the dead `renderCounter` prop** (removed from `PanelProps` in newer Grafana). It
  was passed from `SimplePanel` to `Arc` but never read inside `Arc`. (The matching
  destructure in `SimplePanel` is cleaned up with the prop-typing work in Phase 3.)
- **Verified:** typecheck shows the same 10 pre-existing strict-mode errors (no regressions);
  `npm run build` still compiles cleanly.

### Phase 3 — Internal modernization  ✅
**Shared type model (`src/types.ts`)**
- Rewrote `SimpleOptions` to exactly the 30 option paths the builder sets (removed 9 stale
  fields that were never set — `text`, `labelsOnHover`, `showSeriesCount`, `groupLinkColor`,
  `linkColor`, `toolTipMetric`, `toolTipGroupBy`, `dups`, `zoomFactor` — and added the missing
  `colorConfigField`). Fixed `arcWeightSource` from `number` → `string` (it holds a field name).
- Added shared interfaces `Node`, `Link`, `FieldDisplayName`, `ParsedData`. `Link` keeps an
  `[key: string]: any` index signature for the dynamically option-named fields (e.g. the
  color-config field and per-field display arrays), so those accesses type-check without casts
  while the fixed fields stay strongly typed.

**Typed the data layer (`dataParser.ts`, `pathDataParser.ts`, `utils.ts`)**
- Typed the parser signatures: `(data, options: SimpleOptions, theme: GrafanaTheme2):
  ParsedData`, and typed the `uniqueNodes`/`links`/`visited`/`groups`/`displayNames`
  collections. This resolved all 10 strict-mode `noImplicitAny`/indexing errors with real
  types (no `any` shortcuts). Algorithms are byte-for-byte unchanged.

**Styles (`src/styles.ts`)**
- Converted all kebab-case CSS keys (`"z-index"`, `"border-radius"`, `"font-size"`,
  `"background-color"`, …) to camelCase and imported the real `CSSProperties` type (dropping
  the global-`React` reliance). **Verified output-safe:** an empirical `renderToStaticMarkup`
  test showed React emits identical CSS for the kebab and camel forms — the only change is the
  removal of React's dev-time "Unsupported style property" warnings. To be re-confirmed
  visually in Phase 5.

**`Arc.tsx` (the D3 component)**
- Replaced the **module-level mutable `toolTip` singleton** (shared across every panel
  instance on a page — a real multi-instance bug) with component `useState`. Tooltip content
  is now built as a fresh object and committed via `setToolTip`; output identical for a single
  panel, correct for multiple.
- Replaced the **global `localStorage("this")` first-render flag** with a per-instance
  `useRef` (`wasInViewRef`), and moved the detection **into the effect** (ref mutation during
  render is unsafe and was flagged by `eslint-plugin-react-hooks` v7). The effect re-runs on
  the view→edit transition because the panel's width/height change, so the first-render
  `setTimeout` layout path still fires. **The load-bearing `setTimeout(…,100)` edit-mode
  re-render and its `offsetFirstRender=40` adjustment are preserved unchanged** — needs
  edit-mode visual verification (Phase 5).
- Fixed the `eqeqeq` violations correctly: `d.srcElement.id == l?.source` compared a DOM id
  **string** to a numeric source, so a naive `===` would always be false and break
  highlighting. Changed to `Number(d.srcElement.id) === l?.source`, preserving behavior, and
  removed the `eslint-disable eqeqeq`.
- Typed the component props via an `ArcProps` interface. D3 selection callbacks (`(d|l|n:
  any)`) are left `any` — this is the genuine D3 interop boundary and forcing D3's datum/event
  generics here would add risk without value.

**Other**
- `SimplePanel.tsx`: typed props as `PanelProps<SimpleOptions>` (removed the `: any` cast and
  the dead `renderCounter` destructure), typed `parsedData` as `ParsedData`, removed the dead
  empty `isCluster > 5` block and the commented-out `calcDiagramHeight` guard.
- Removed the now-unused **`calcDiagramHeight`** helper from `utils.ts`.
- `SearchField.tsx`: typed props via a `SearchFieldProps` interface.
- Cleaned vestigial commented-out braces in `dataParser.ts`.
- **Verified:** typecheck, `eslint .`, and `npm run build` all clean.

> Residual `any` (~90, mostly `module.ts` field-builder `getOptions` callbacks and `Arc.tsx`
> D3 callbacks) is deliberate interop typing, not the data model. The data model itself is now
> fully typed.

> Deliberately **preserved a latent bug** for Phase 4: `Arc.tsx` `updateTooltip` passes
> `(props as any).zoom` (an undefined prop) to the tooltip text style instead of
> `tooltipFontSize`. Kept identical here; fixed in Phase 4.

### Phase 4 — Bug fixes  ✅
See the **Bugs fixed** section below for the behavior-change details. Summary:
- `CustomRangeSlider` now restores its saved value instead of always showing `[1, 15]`.
- The two range editors (`arcRange`, `nodeRange`) now have distinct editor ids.
- `isTimeSeries` now inspects all fields (was only the first); also guards `data.request`.
- `Arc.tsx` tooltips now use the configured tooltip font size (was an undefined prop).
- `SimplePanel` shows "No data" instead of throwing on an empty query result.
- **Verified:** typecheck, lint, and build all clean.

### Phase 5 — Tests & verification  ✅
- Added **unit tests** (25 tests, 4 suites, all green):
  - `src/utils.test.ts` — pure helpers (`linSpace`, `mapToLinRange`, `mapToLogRange`,
    `getEvenlySpacedColors`, `idToName`, `getNodeTargets`, `addNodeSum`, `calcStrokeWidth`,
    `calcNodeRadius`) plus an `isTimeSeries` **regression test** locking in the Phase-4 fix.
  - `src/dataParser.test.ts` — characterizes node/link construction, stroke width, node color,
    and weight-sum accumulation for the simple (source/target) mode.
  - `src/pathDataParser.test.ts` — characterizes node splitting, per-hop link creation, and
    overlap detection for hop/AS-path mode.
  - `src/module.test.ts` — replaced the stub with real checks that the plugin registers as a
    `PanelPlugin`, wires the panel, and runs its options builder.
- Extended the Jest `transformIgnorePatterns` (in the root `jest.config.js`) to transform the
  ESM `d3` packages, so importing the panel under Jest no longer fails.
- **CI** (`.github/workflows/ci.yml`): rewritten to npm + Node 22 and now runs
  `typecheck` → `lint` → `test:ci` → `build` (previously it only ran `build`). Dropped the dead
  Go-backend steps (no `Magefile.go`). **Release** workflow updated to npm + Node 22.
- **Static-asset copy fix (regression caught during verification).** The new scaffold's
  webpack only copies the logo + screenshot referenced in `plugin.json`, whereas the panel
  loads several SVG icons at runtime by absolute path (the zoom buttons:
  `img/area_zoom_out.svg`, etc.). The first rebuild dropped them from `dist/img`, which would
  have 404'd the zoom icons. Fixed by adding a root `webpack.config.ts` that extends the
  scaffolded config (via `webpack-merge`) with a `CopyWebpackPlugin` pattern copying
  `src/img → dist/img`, and pointing the `build`/`dev` scripts at it. Verified all original
  `dist/img` assets are present again.
- **Live check:** rebuilt `dist/`, restarted local Grafana 13.0.2, and confirmed the log shows
  `Plugin registered pluginId=esnet-arcdiagram-panel` with no load errors.

> **Still recommended (human visual diff):** render the panel in the running Grafana with
> representative node/link data in **both** normal and hop modes and compare against the prior
> behavior — paying attention to (a) the **edit-mode first render** (the preserved
> `setTimeout` layout path, now driven by a per-instance ref instead of `localStorage`) and
> (b) tooltip styling (camelCase styles + tooltip font-size bug fix). The automated checks
> can't fully cover on-screen layout.

---

## Bugs fixed (behavior changes)

Each of these changes the rendered/behavioral output in a specific edge case (the user opted
in to fixing obvious bugs). Everywhere else, output is unchanged.

1. **`CustomRangeSlider` ignored its saved value** (`src/components/CustomRangeSlider.tsx`).
   - *Before:* the slider was hard-coded to `value={[1, 15]}`, so the "Range for weighted
     links/nodes" editors always reset to 1–15 visually, no matter what was saved.
   - *After:* it parses the stored `"min,max"` string and displays the actual saved range,
     falling back to `[1, 15]` only when unset.
   - *Affects:* the editor UI for `arcRange` / `nodeRange` when a non-default range was saved.

2. **Duplicate custom-editor id** (`src/module.ts`).
   - *Before:* both the `arcRange` and `nodeRange` custom editors were registered with
     `id: "setRange"`.
   - *After:* `"setArcRange"` and `"setNodeRange"`.
   - *Affects:* internal editor identity; avoids potential collisions in the options editor.

3. **`isTimeSeries` only checked the first field** (`src/utils.ts`).
   - *Before:* an `else { return false }` inside the field loop returned on the first field, so
     a `time`-typed field in any later position was missed and the data was treated as
     non-time-series.
   - *After:* the loop scans every field and returns true if any is `time`. Also hardened
     `data.request.targets` → `data.request?.targets` to avoid a crash when `request` is absent.
   - *Affects:* datasets whose time field is not the first field — now correctly rejected with
     "Time series not supported".

4. **Tooltip inner lines used an undefined font size** (`src/components/Arc.tsx`).
   - *Before:* `updateTooltip` styled the node-target and link-field `<p>` lines with
     `props.zoom`, a prop that is never passed (so `font-size: undefinedpx`, which browsers
     ignore).
   - *After:* uses `props.graphOptions.tooltipFontSize`, matching the tooltip container.
   - *Affects:* the font size of the inner tooltip lines now honors the configured "Tooltip
     font size".

5. **No-data crash guard** (`src/SimplePanel.tsx`).
   - *Before:* an empty query result made `data.series[0].fields` throw.
   - *After:* renders a "No data" message.
   - *Affects:* the empty-result case (graceful message instead of an error).

---

## Bug scan findings (now fixed)

A scan of the code surfaced the issues below; **all have since been fixed**. Each fix is marked
in code with a `// [refactor]` comment, and regression tests were added where practical. As with
the Phase-4 fixes, these change behavior only in the specific broken edge cases.

### Functional — fixed

- **HIGH — Hop mode ignored the configured delimiter** (`src/pathDataParser.ts`). The per-path
  hop splitting hard-coded `String(path).split(' ')` while the nodes were built with the
  `delimiter` option → no links for any non-space delimiter. **Fixed:** split on `delimiter`.
  Regression test: `pathDataParser.test.ts` "honors a non-space delimiter".
- **MEDIUM — Division-by-zero → `NaN` in scaling** (`src/utils.ts` `mapToLinRange` /
  `mapToLogRange`). When `min === max` (single link/node or uniform weights) the mapped
  width/radius became `NaN`/`Infinity` and the element vanished. **Fixed:** return the range
  minimum when the result is non-finite (`Number.isFinite` guard). Regression tests added.
- **MEDIUM — `log` scale with zero/negative sums** (`src/utils.ts` `mapToLogRange`). `log10(0)`
  is `-Infinity`. **Fixed** by the same `Number.isFinite` fallback. Regression test added.
- **MEDIUM — Unguarded `.find(...).name/.id` lookups** (`src/dataParser.ts`,
  `src/pathDataParser.ts`, `src/utils.ts` `idToName` / `clusterNodes`). **Fixed:** optional
  chaining with sensible fallbacks (default field, existing source/target, or `""`). Regression
  test: `idToName` returns `""` for an unmatched id.

### Functional (lower severity) — fixed

- **`field.state` assumed present** (`src/dataParser.ts` `.state.range`; `src/utils.ts`
  `.state.displayName`). **Fixed** with optional chaining.
- **`parseData` required ≥2 fields** (`src/dataParser.ts`). **Fixed:** `SimplePanel` now guards
  non-hop mode with a "Requires at least a source and target field" message before indexing
  `fields[1]`.
- **Path-field name collision** (`src/pathDataParser.ts`). A path field literally named `path`
  overwrote the numeric `link.path`. **Fixed:** renamed the internal property to `pathIndex`
  (in `types.ts`, the parser, and `Arc.tsx`).
- **`addNodeSum` falsy-zero overwrite** (`src/utils.ts`). **Reworked** to accumulate with
  `?? 0`. (Note: the old code actually produced identical results since `0 + x === x`; this is a
  clarity/robustness cleanup, not a behavior change.)
- **Swallowed parse errors** (`src/SimplePanel.tsx`). **Fixed:** a parse exception now renders an
  "Error parsing data" message instead of a silent blank panel.

### Stylistic / code quality — fixed

- `replaceEllipsis` param `Boolean` → `boolean` (`src/utils.ts`).
- Removed unused params: `displayValue` / `linkId` in `updateTooltip` (+ trimmed the call site);
  `item` / `suffix` in `CustomRangeSlider`.
- `let` → `const` for never-reassigned bindings (`graphOptions` in `SimplePanel`; `srcById` /
  `dstById` in `dataParser`; `uniqueNodes` / `links` in `pathDataParser`).
- `31.99` → named constant `PANEL_TITLE_HEIGHT` (`src/components/Arc.tsx`). (The other magic
  numbers — `3.77`, the ellipsis `mapRatio` — lived in the now-removed `calcDiagramHeight` or are
  already local consts.)
- Residual `any` at the D3 selection / option-builder boundaries is left intentionally (the
  D3/Grafana interop boundary).

---

## Known issues left / deferred

- **Edit-mode first-render path preserved as-is.** The `setTimeout(…, 100)` re-render with the
  `offsetFirstRender = 40` vertical adjustment in `Arc.tsx` is fragile but load-bearing for
  correct layout when entering the panel editor. It was intentionally **kept** (only its global
  `localStorage` trigger was replaced with a per-instance ref) to guarantee identical output. A
  future improvement would be to drive the layout from a `ResizeObserver`/measured dimensions
  instead, removing the timed re-render — but that needs careful visual testing and is out of
  scope for an output-preserving refactor.
- **Residual `any` at interop boundaries.** ~90 `any` remain, almost entirely D3 selection/
  event callbacks in `Arc.tsx` and the field-builder `getOptions` callbacks in `module.ts`.
  The data model itself is fully typed; these were left loose deliberately (typing D3's
  datum/event generics here adds risk without real benefit).
- **`@stylistic/eslint-plugin-ts` deprecation notice.** The scaffolded ESLint config pulls in
  `@stylistic/eslint-plugin-ts`, which prints a deprecation message. This comes from
  `@grafana/create-plugin`'s config and will resolve on a future `npx @grafana/create-plugin
  update`.
- **Node 26 local dev.** Builds/tests pass, but Grafana tooling officially targets Node 20/22
  (`engines` is set to `>=22`). Using an LTS Node (20/22) is recommended for reproducibility.

---

## How to build, run, and verify (post-refactor)

**Install & build**
```
npm install          # Node 20/22 recommended (works on 26 with an engine warning)
npm run build        # production build -> dist/
npm run dev          # webpack watch for development
```

**Run locally (native Grafana, no Docker)**
The plugin is symlinked into the local Grafana plugins dir
(`/opt/homebrew/var/lib/grafana/plugins/esnet-arcdiagram-panel -> ./dist`) and allowed as an
unsigned plugin in `grafana.ini`. After a build:
```
brew services restart grafana      # reload the plugin
# open http://localhost:3000  (admin / admin)
```
Add an **Arc Diagram** panel to a dashboard, backed by a data source that returns
node/link-style data (source/target/weight fields, or path strings for hop mode).

**Quality gates**
```
npm run typecheck    # tsc --noEmit (strict)
npm run lint         # eslint flat config
npm run test:ci      # jest unit tests
```

All four gates are green as of this refactor, and the plugin registers cleanly on the local
Grafana 13.0.2.
