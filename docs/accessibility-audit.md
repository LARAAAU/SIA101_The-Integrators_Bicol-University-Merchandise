# Accessibility audit (WCAG 2.1 AA) - BU Merch

Scope: all pages in `public/` (student pages and admin), light and dark theme.

## Already good (kept)
- `lang="en"` on every page, one `<main>` per page, viewport zoom not blocked.
- Global visible focus ring (`:focus-visible`, orange 3px).
- All inputs have a label or `aria-label`; icon-only buttons (cart, theme toggle, add-to-cart) have names.
- Icons are `aria-hidden`; `prefers-reduced-motion` is respected; dialogs use Bootstrap modals.

## Fixed in this pass
| Area | Problem | Fix |
|---|---|---|
| Contrast | muted text on light-blue surfaces 4.27-4.39:1; link on page background 4.35:1 | `--muted` #546b7f, `--link` #2468a0 (>= 4.8:1) |
| Contrast | white text on green/red badges 3.35 / 4.16:1; white on grey badge 2.61:1 | `--ok` #1f7a58, `--bad` #c0392f, `.bg-secondary` #5d7488 (>= 4.8:1) |
| Contrast | orange text on white / light orange 2.4-3.2:1 | new `--orange-text` #9a4d00 (5.5:1 or better) for text; orange kept for backgrounds with dark text |
| Contrast (dark) | white on blue 3.5:1, on red 3.0:1, on green 2.5:1 | dark `--blue` #2f78b3 (4.7:1); dark text on red/green badges |
| Keyboard | custom fields removed the outline (`outline:0`) | focus ring on `.pill`, `.fld`, `.ux-in`, `.rw` |
| Keyboard | no way to skip the navbar | "Skip to main content" link, added by `renderNav` |
| Keyboard | announcement popup did not take focus | focus moves into it, Tab is kept inside, Esc closes, focus returns to the previous element |
| Labels | admin schedule slot fields, user role select, repeated Edit/Hide buttons had no unique name | `aria-label` with the item name |
| Labels | cart +/- buttons said only "Less" / "More" | now name the product |
| Screen readers | toasts always `status` | errors/warnings are `alert` (assertive); cart link announces item count |
| Screen readers | admin tabs gave no current state; page title never changed | `aria-current="page"`; title follows the section |
| Landmarks | navbar unnamed | `<nav aria-label="Main">`; audit table has a hidden caption |

## Known limits / to test by hand
- The orange "BU Merch" wordmark is a logotype (exempt from contrast rules).
- Re-test with NVDA or VoiceOver, 200% zoom, and keyboard-only on checkout and admin order modal.
- Tables use `<th>` in `<thead>` (implicit column scope); add captions to the other admin tables if the instructor requires it.
