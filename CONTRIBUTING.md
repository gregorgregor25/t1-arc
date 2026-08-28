# Contributing to T1 Arc

T1 Arc is being built in the open because good ideas and careful scrutiny make health software better. You do not need to be a developer to help.

You can:

- report a bug;
- suggest a feature or a clearer workflow;
- improve documentation;
- test a change on another Android device;
- submit a pull request.

## Before opening an issue

Search the existing issues first. For a bug, include the T1 Arc version, Android version, device model and the shortest steps that reproduce it.

Never attach an unedited health export, database, API key, session token or screenshot containing information you do not want made public. Use the issue form as a prompt, then remove anything private before submitting.

## Working on a change

1. Fork the repository and create a focused branch.
2. Follow [the local setup guide](docs/SETUP.md).
3. Keep the change small enough to review and explain why it is useful.
4. Add or update tests for changed behaviour.
5. Run the quality checks.

```powershell
npm run quality
```

6. Open a pull request and complete the checklist.

If you are planning a large feature, open an issue first. That gives us a chance to discuss privacy, data quality, maintenance and how the idea fits the project before you invest a lot of time.

## Health and safety boundaries

T1 Arc helps people inspect and understand their own records. Contributions must not turn it into a dosing calculator, treatment recommender or substitute for professional medical care.

When a feature compares health data, it should:

- show the time period and coverage used;
- keep source records inspectable;
- distinguish an observation from a proven cause;
- withhold conclusions when the evidence is too incomplete;
- avoid telling someone what insulin dose or treatment action to take.

## Privacy expectations

Local processing is the default. Any feature that sends data away from the phone must be optional, clearly explained before use and limited to the information it needs.

Please read [the privacy model](docs/PRIVACY.md) before changing storage, networking, backups, Health Connect, account connections or Tarv1s.

## Code style

- Keep TypeScript strict and prefer explicit types at data boundaries.
- Preserve source timestamps, units and provenance.
- Use deterministic calculations for totals and comparisons where possible.
- Add tests for time zones, incomplete coverage and failure states.
- Keep user-facing language plain, calm and specific.

## Licence

By contributing, you agree that your contribution may be distributed under the repository's [PolyForm Noncommercial License 1.0.0](LICENSE). Commercial use is not permitted without separate written permission from the licensor.
