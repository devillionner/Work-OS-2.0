# P4 performance matrix — 2026-09-15

This document records the reproducible P4 performance evidence for Work OS 2.0. It is a staging/local acceptance record, not a production SLA.

## Acceptance targets

- Local synthetic baseline: 10k chats, 10k chat profiles, 10k library items, 10k leads and 100k activity events.
- Representative API/query p95 below 500 ms on the recorded stand.
- Recorded UI workspace actions below 1 s.
- Query count, rows read, payload size and `EXPLAIN QUERY PLAN` captured for the main bounded read paths.
- No request path may turn a list of rows into an N+1 SQL loop.

## Recorded stand

- Runtime commit deployed to staging: `4b0d923` (PR #103), Work OS `0.2.1`.
- Staging Worker version: `ee997a7a-4e59-4ee9-9919-9d377dd2e56f`.
- Local host: CachyOS Linux 7.2.2, Intel Core Ultra 9 285H, 16 logical CPUs, 30 GiB RAM.
- Local Node: `v26.8.1`; Miniflare D1 uses the repository migrations.
- Local benchmark command: `node --experimental-strip-types scripts/p4-performance.mjs`.
- Local table below uses 12 measured runs after a warm-up. Staging API uses 15 same-origin authenticated `cache: no-store` reads per endpoint. UI navigation uses 5 recorded cycles per workspace in headless Chromium 152 at 1363×900.

## Local synthetic matrix

The benchmark seeds all rows in one isolated local Miniflare D1. No remote D1 is read or written.

| Path | Statements | p50 | p95 | p95 rows read | Response/result payload | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Subject analytics, 10k leads / 100k events | 1 | 163.7 ms | 257.0 ms | 300,000 | 555 B | Pass |
| Chat queue first-page query, 10k chats/profiles | 1 | 40.1 ms | 49.8 ms | 30,000 | 17,286 B | Pass |
| Full chat read bundle, 10k chats/profiles | 7 fixed | 98.5 ms | 133.4 ms | 60,003 | 17,433 B | Pass |
| Leads list + count, 10k leads | 2 fixed | 23.7 ms | 36.1 ms | 10,050 | 13,107 B | Pass |
| Library first page, 10k items | 1 | 26.1 ms | 31.7 ms | 401 | 73,607 B | Pass |
| Internal legacy-aware bulk chat scan, 10k chats | 1 | 185.7 ms | 227.1 ms | 10,002 | 1,675,577 B internal | Pass / bounded |
| Actual two-item bulk preview over 10k chats | 2 fixed | — | 249.0 ms wall | 10,003 | 299 B external | Pass |

The subject query deliberately joins each relevant event to its lead and optional lesson, so Miniflare reports roughly three indexed row reads per event. The measured p95 remains below the 500 ms acceptance target. The bulk alias scan is intentionally bounded at 10,000 existing chats; its large internal result is not sent to the browser. Canonical indexed chat keys remain the known route to supporting a larger database without that scan.

## Query-plan evidence

`EXPLAIN QUERY PLAN` on the same seeded database confirms the main owner-scoped indexes are used:

- Subject analytics: `activity_events_user_date_active_idx`, then primary-key lookups into `leads` and `lessons`; a temporary B-tree is used only for the final grouped aggregate.
- Chat queue: `chats_user_platform_status_idx`, primary-key `chat_profiles` lookup, and covering `chat_publications_user_chat_day_idx`; a temporary B-tree handles the final queue ordering.
- Leads list/count: `leads_owner_archive_updated_idx`, including a covering-index count path.
- Library: `library_items_user_kind_idx`; only the final secondary title ordering needs a temporary B-tree.
- Bulk preview scan: `chats_user_platform_status_idx`; `json_each` is the bounded platform-list virtual table and SQLite creates a bloom filter.

The measured paths have fixed statement counts independent of returned entity count. In particular, the chat queue is a seven-statement batch, Leads list is two statements, subject/library are single queries and bulk preview is two statements. There is no per-chat, per-lead or per-event SQL loop in these paths.

## Authenticated staging API sample

These are read-only same-origin requests against the current staging dataset, not the synthetic 10k database.

| Endpoint | Payload | p50 | p95 | Target |
| --- | ---: | ---: | ---: | --- |
| `/api/analytics?range=month` | 36,105 B | 192.0 ms | 307.3 ms | Pass |
| `/api/chats?platform=telegram&status=to_join` | 31,061 B | 226.8 ms | 309.2 ms | Pass |
| `/api/leads` | 13,800 B | 149.1 ms | 257.1 ms | Pass |
| `/api/reports?date=2026-09-01` | 57,161 B | 306.4 ms | 381.6 ms | Pass |

All sampled endpoint p95 values remain below 500 ms. Root/staging smoke and authentication guards were checked separately after the same runtime deploy.

## Recorded UI action latency

The measurement starts when the sidebar workspace action is activated and stops when the destination workspace is present with no visible `.workspace-loading`. It includes network/render work that the operator waits for. Five cycles are a small acceptance sample, so these values are evidence for this recorded stand rather than a general browser SLA.

| Workspace | p50 | recorded p95/max | Target |
| --- | ---: | ---: | --- |
| Today | 25.6 ms | 33.1 ms | Pass |
| Platforms | 335.0 ms | 768.7 ms | Pass |
| Leads | 16.1 ms | 23.0 ms | Pass |
| Analytics | 188.5 ms | 251.4 ms | Pass |
| Reports | 326.4 ms | 378.0 ms | Pass |
| Library | 204.3 ms | 260.6 ms | Pass |
| Settings | 13.0 ms | 13.8 ms | Pass |

Platforms is the slowest recorded workspace but remains below the 1 s P4 UI target.

## Conclusion and remaining limits

The recorded P4 performance target is met on the current local/staging stand: the synthetic large-data paths remain bounded and indexed, sampled staging APIs are below 500 ms p95, and sampled workspace actions are below 1 s. No production performance claim is made.

This evidence does not replace physical iPhone/Safari acceptance. The 10k legacy-aware bulk chat scan also remains an explicit scale ceiling until canonical indexed chat keys replace the compatibility scan; requests above that bound already fail closed rather than performing an unbounded scan.
