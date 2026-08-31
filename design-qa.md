# Design QA — v0.6.0-alpha interaction details

## Evidence

- Current-problem source: `docs/qa/v0.6.0-alpha/source-current-interactions.png` (543 × 545).
- Mobile QQ hierarchy references: `reference-mobile-compact.png` (1280 × 818) and `reference-mobile-detail.png` (1280 × 1559).
- Rendered implementation: `implementation-full.png` (2214 × 1318 at the active Windows scale factor; Electron window 1120 × 720).
- Focused implementation crop: `implementation-interactions.png` (844 × 568).
- Combined comparison input: `comparison-interactions.png` (1480 × 620).
- State: populated local archive, first long saying selected, detail paper scrolled to the likes and comments sections.

## Visual judgment

The supplied mobile QQ screenshots are hierarchy references, not a request to copy QQ's visual identity. The implementation keeps the project's warm ivory paper, charcoal type, restrained blue, existing icons, spacing, and detail-card anatomy.

### Findings and fixes

1. **P1 — Missing visible liker information:** the source showed only an aggregate count and an empty-state sentence. The rendered result shows currently visible liker names below the official-looking total and retains a quiet incomplete-list disclosure when the two counts differ.
2. **P2 — Long nickname wrapping into a narrow column:** the source allowed long names to wrap across several lines. The rendered result limits the nickname to one line with an ellipsis and tooltip while the comment body follows inline and wraps naturally.
3. **P2 — Data-integrity ambiguity:** the UI now distinguishes total likes from locally expanded names instead of implying the list is exhaustive.

## Required-surface checks

- Typography: unchanged outside the requested one-line nickname treatment.
- Spacing: likes and comments retain the existing section rhythm and separators.
- Colors: existing archive blue is used for people names; no new visual language was introduced.
- Assets and icons: existing icon library and real archived media remain in use.
- Copy: incomplete interaction details are stated without claiming QQ returned a complete roster.
- Interaction: the detail paper remains internally scrollable only when content exceeds its measured viewport; Electron regression confirms a 12px bottom safety gap and outer-page chaining when there is no internal range.

No P0, P1, or P2 visual issues remain for this change.

final result: passed
