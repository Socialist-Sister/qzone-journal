# Design QA — Settings privacy action hierarchy

## Evidence

- Source state: `docs/qa/v0.4.0-alpha/settings-privacy-full.png` (2214 × 1318 at the active Windows scale factor).
- Rendered implementation: `docs/qa/v0.4.0-alpha/settings-privacy-without-info-row.png` (2214 × 1318; Electron window 1120 × 720).
- Equal-state comparison: `docs/qa/v0.4.0-alpha/settings-privacy-removal-comparison.png` (1420 × 437, both captures normalized to 700 × 417).
- State: Settings → Privacy & Export, account menu open in the same fixture state.

## Findings and iteration history

1. **P2 — Informational row presented as a third setting.** The “Confirm again before export” explanation sat between two operational rows, inherited the same divider and height, and therefore looked interactive despite having no action.
2. **Fix.** Removed the standalone informational row. The confirmation requirement remains a product rule and will appear inside the future public-export flow when that action is implemented.
3. **Post-fix evidence.** The card now contains two unambiguous rows: the planned anonymization setting and the diagnostic-export action. The full Electron smoke suite passed after removal.

## Required fidelity surfaces

- Fonts and typography: unchanged.
- Spacing and layout rhythm: the unused middle row is gone; remaining padding, dividers, alignment, and card proportions stay consistent.
- Colors and tokens: unchanged.
- Image and icon quality: no new or substituted asset; the obsolete shield icon instance was removed with its row.
- Copy and content: only the redundant future-behavior explanation was removed.

No remaining P0, P1, or P2 issue is visible in this settings card.

final result: passed
