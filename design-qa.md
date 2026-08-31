# Design QA — Archive timeline outer scrolling

## Evidence

- Source visual truth: `docs/qa/v0.5.0-alpha/timeline-scroll-before.png`
- Implementation capture: `docs/qa/v0.5.0-alpha/timeline-outer-scroll.png`
- Side-by-side comparison: `docs/qa/v0.5.0-alpha/timeline-comparison.jpg`
- Viewport: Electron `BrowserWindow` 1120 × 900; captured at the active Windows device scale factor.
- State: Archive page, left timeline cards with the first entry selected.

## Review

The requested source of truth is the existing warm-paper archive layout with one correction: the left timeline must not create a second scrolling region. Typography, card spacing, colors, icons, copy hierarchy, and the right detail-paper behavior are intentionally unchanged.

### Iteration history

1. **P1 — Competing scroll regions:** the left timeline exposed its own blue scrollbar and arrow controls, making wheel navigation ambiguous.
2. **Fix:** the timeline now uses visible overflow and derives virtualization, viewport offsets, and near-end loading from the outer `.utility-view` canvas.
3. **Post-fix evidence:** no timeline scrollbar or arrow controls are visible; the timeline has no internal scroll range; archive paging and virtualization remain active. The existing short-detail-card test also confirms that wheel input chains to the outer archive page when the detail card has no internal range.

## Required-surface checks

- Typography: unchanged.
- Spacing and card rhythm: unchanged.
- Colors and tokens: unchanged.
- Assets and icons: unchanged.
- Copy: only fixture data differs between captures.
- Interaction: one outer archive scroll for the timeline; detail paper keeps internal scrolling only when its own content overflows.

## Final result

**Passed.** No remaining P0, P1, or P2 visual mismatches for the requested rollback.
