## Problem and scope

Describe the observed problem and the smallest scope of this change.
Link the related issue if there is one. A draft PR is welcome for early feedback.

## Evidence

List tests, fixtures, public contracts, emulator/device checks and limitations.
Distinguish implementation evidence from real-account, translated, clinical,
licensed-dataset and physical-hardware validation.

## Privacy and compatibility checklist

Explain any item that is not applicable, especially for a docs-only PR.

- [ ] I included no credentials, account identifiers, personal health data,
      provider exports, backups/databases or identifying screenshots.
- [ ] Canonical stored health values and source provenance are unchanged or the
      schema migration is documented and tested.
- [ ] Imports/restores/destructive operations remain atomic and retry-safe.
- [ ] I checked `config/t1arc-runtime-identifiers.json`; no persisted or
      cross-process identifier was renamed or deleted without an explicit,
      tested compatibility migration.
- [ ] Existing GB behavior and each affected region/provider have relevant tests.
- [ ] Changed UI paths have accessibility labels/states and regional formatting.
- [ ] Documentation and capability claims match the evidence actually obtained.

## Verification

For docs-only changes, list the rendered pages, links and wording checked.
For code changes, record actual results below. Mark a check not run and explain
why when it is unavailable; do not imply that a local fixture is device evidence.

```text
npm run verify:public-source:
npm run quality:
Expo parity/Doctor:
native tests/lint/builds:
emulator/device/hardware:
```

## Remaining validation

State what remains externally untested.
