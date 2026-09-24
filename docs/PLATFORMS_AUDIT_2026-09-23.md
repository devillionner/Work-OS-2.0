# Platforms audit — 2026-09-23

Source-only GitHub audit. This file does not claim staging, browser, physical iPhone/Safari, cross-device, or live messenger acceptance.

## Completed

- `05b4e71` binds chat mutations to the mutated chat's Telegram account context, with the selected account used only as the fallback for an unassigned join-queue chat.
- `556fc5e` keeps quick-publish semantics bound to the chat opened in the publish dialog rather than incidental workspace context.
- `89682b3` surfaces a failed manual-publication confirmation inside the publish dialog instead of leaving the operator without visible modal feedback.
- `652270e` removes render-time state mutations from Platforms filter/platform reconciliation.
- `e75dc91` keeps publish confirmation actions reachable while scrolling, including mobile safe-area padding.
- `fc17cd2` prevents Telegram account loading/selection from invalidating WhatsApp, Viber, or Facebook list requests.

## Remaining acceptance

Continue the Platforms operator-flow audit. Physical Safari, cross-device sync, live messenger behavior, and external discovery/leave execution remain separate acceptance gates.

## Documentation blocker

Updating the existing large `docs/ROADMAP.md` and `docs/PRODUCT_REQUIREMENTS.md` through the GitHub connector was rejected by the tool safety layer during this run. No non-GitHub workaround was used. Canonical status should be reconciled into those two files when the GitHub write path accepts them.
