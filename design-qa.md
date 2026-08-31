# Design QA — Settings privacy confirmation row

## Evidence

- Source visual truth: `docs/qa/v0.6.0-alpha/settings-confirmation-before.png` (1479 × 171).
- Rendered desktop implementation: `docs/qa/v0.6.0-alpha/settings-privacy-full.png` (2214 × 1318 at the active Windows scale factor; Electron window 1120 × 720).
- Focused implementation: `docs/qa/v0.6.0-alpha/settings-confirmation-after.png` (1432 × 156).
- Combined comparison input: `docs/qa/v0.6.0-alpha/settings-confirmation-comparison.png` (1500 × 360).
- State: Settings → Privacy & Export, confirmation information row visible.

## Findings and iteration history

1. **P2 — Related content split across the full row.** In the source capture, the shield icon sat at the far left while its heading and description were pushed to the far right by inherited `space-between` alignment. This weakened grouping and made the row look like a control with a missing middle section.
2. **Fix.** The informational row now uses start alignment with a 12px gap; the icon, heading, and description read as one compact information group. No copy, icon, color, typography, row height, divider, or surrounding setting behavior changed.
3. **Post-fix evidence.** The combined comparison shows the same warm-paper row and content with the excessive horizontal void removed. The full Electron smoke suite passed in the target desktop runtime.

## Required fidelity surfaces

- Fonts and typography: unchanged; heading and description retain existing size, weight, and line height.
- Spacing and layout rhythm: corrected only the horizontal grouping; existing vertical padding and dividers remain intact.
- Colors and tokens: unchanged warm ivory, charcoal, muted gray, and restrained blue.
- Image and icon quality: existing Phosphor shield icon retained; no replacement asset was introduced.
- Copy and content: unchanged.

No remaining P0, P1, or P2 issue is visible in the corrected row.

final result: passed
