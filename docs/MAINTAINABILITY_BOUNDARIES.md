# Maintainability boundaries

T1 Arc has strong domain and persistence seams, but several composition roots
remain large. File counts from earlier refactoring passes are not a measure of
the current tree. Use the source and reachability check when planning an
extraction. Line count is a risk signal, not a quality
verdict. A large pure parser with bounded fixtures is different from a large UI
owner with interleaved lifecycle state.

## Highest-risk production files

| File | Current responsibility and existing seam | Safe extraction boundary |
| --- | --- | --- |
| `src/components/FoodLoggerCard.tsx` | Owns one food-draft/modal workflow and composes search, library, copy, quantity and save services. Durable writes live in `foodLogRepository`, not in presentation helpers. | Extract draft header, discovery, library/copy, editor and footer views one at a time. Keep one draft owner until reducer-level tests exist; run copy/Undo, My Foods and primary-write batching tests after every move. |
| `src/screens/TarvisScreen.tsx` | Owns route, conversation and answer presentation. Local tools, evidence, safety, request transport and conversation persistence already live under `src/data/tarvis`. | Extract history, direct-answer content, evidence summary and confirmation views first. Do not combine a view extraction with request-lease, model, persistence or evidence-shape changes. |
| `modules/t1arc-glucose-display/.../T1ArcGlucoseDisplayModule.kt` | Registers the Expo bridge plus Android widget, service, receiver, AOD and Wear request components. Formatting/privacy policies already have smaller files and tests. | Move one Android component class per commit while preserving manifest class names and bridge registration. Run display unit/lint, app-link, notification, widget, Auto and APK-manifest contracts after each move. |
| `src/domain/insights.ts` | Pure deterministic insight classification, episode/meal analysis and evidence assembly. | Extract episode, meal, health/context and report builders without changing public types or algorithm-version constants. Golden evidence and DST/coverage tests are the gate. |
| `src/components/HealthMetricCards.tsx` | Presents health summaries, charts, details and goal editing over already-normalized records. | Extract chart, detail modal, workout row and goal editor as presentational components; keep metric/source selection in its existing owner until selector tests cover it. |
| `src/data/backup/healthBackup.ts` | Owns the versioned table policy, streamed container codec, validation, fingerprinting, additive restore and exact migration import. This is intentionally fail-closed code. | Do not split for cosmetics. First freeze more byte-level fixtures, then extract schema policy, codec/fingerprint and import coordinators without changing exported constants, frame bytes, transactions or compensation order. |
| `src/providers/DataProvider.tsx` | Application composition root for repository lifecycle, refresh and mutation commands. Repositories and write leases are already separate. | Introduce narrow query/mutation contexts and revision selectors one family at a time. Prove repository-switch, range ownership, erase epoch and background cancellation before removing the broad context. |
| `src/components/GlookoImportCard.tsx` | UI state machine around prepared import, preview, validation and commit services. | Extract source chooser, preview metrics, confirmation and result views. Do not move archive validation or transactional import into UI code. |
| `src/data/import/glookoCsv.ts` | Bounded, regional multi-table parser with provenance and exact input contracts. | Split table adapters only behind unchanged archive/row limits and fixture outputs; reject partial parsing exactly as before. |
| `src/data/persistence/SqliteHealthRecordStore.ts` | SQL adapter implementing the health-record repository contract. | Extract table-specific row mappers/statements behind the same transaction owner and interface; keep multi-table writes atomic. |
| `src/screens/SourcesScreen.tsx` | Navigation/composition surface for independent source cards. | Extract layout groups only; connector ownership stays in each card/repository. |

## Rules for future reductions

1. One responsibility and no behaviour change per extraction commit.
2. Preserve the public type, persisted schema, runtime identifier and native
   component boundary unless the change is explicitly a versioned migration.
3. Add or identify the behavioural test before moving code. Snapshot-only tests
   are not enough for transactions, lifecycle or evidence semantics.
4. Run focused tests during the move and the complete zero-warning quality gate
   before merging.
5. Re-run native lint/unit or emulator coverage whenever Android lifecycle,
   navigation, notification, widget, Wear or background ownership changes.

This is an accountable follow-up boundary: it makes the remaining structural
debt visible without risking user data through an unreviewable mass split.

The Analyst Lab's large experimental tool client lives under
`services/tarvis-lab/client`, not the application import graph. It remains
covered by its archived service/client contract tests and cannot become the
release Tarv1s route accidentally.
