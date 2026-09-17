# T1 Arc roadmap

Updated: 16 September 2026.

## Launch first

The immediate priority is the first open-source GitHub release of the Android
app. Fix defects in existing features and complete release checks. New feature
ideas belong here and must not keep moving the launch date.

**Phases 2–4 are unscheduled. Revisit them only after the app has launched and
there is evidence of an ongoing user base.** Use actual users' feedback and
recurring problems to decide what deserves work, then agree a small scope before
implementation. Recording an idea here does not authorise its implementation or
make it a launch requirement. No user-count target or delivery dates have been
agreed. Commercialisation is outside the current plan.

The phase order is indicative and may change with demonstrated demand. Current
release evidence and unresolved defects remain in
[docs/RELEASE_STATUS.md](docs/RELEASE_STATUS.md).

## Phase 1: Launch and learn

- Release the core app and address real-world reliability issues.
- Collect feedback on onboarding, integrations and everyday use.
- Establish whether people continue using the app and which problems recur.
- Prioritise improvements that reduce effort for users.
- Keep new capabilities outside launch scope unless explicitly reconsidered.

## Phase 2: Easier food logging

### Nutrition-label recognition: available, with review

The app reads English nutrition labels on-device without a paid OCR service.
Every suggested amount and nutrient needs checking against the pack. Accuracy
improvements remain maintenance work; manual entry is always available. See
[Food logging](docs/FOOD_LOGGING.md#read-a-nutrition-label).

### Import nutrition information from CSV or PDF

**Status: proposed, deferred until after launch and evidence of a user base.**

Allow someone to import nutrition information from a restaurant, cafe or other
place they eat regularly into their personal food library. The motivating example
was a missing Greggs search result. Restaurant data would need source, accuracy and redistribution checks before
any shared catalogue could be offered.

Suggested first scope, subject to demand and a separate implementation decision:

- Begin with CSV and PDFs containing selectable text and nutrition tables.
- Map item names, restaurant/brand, portion sizes, carbohydrate, energy, protein,
  fat and fibre where present. Leave missing values unknown.
- Show an editable preview before importing. Confirm units, regional label
  conventions and whether amounts describe an item, a serving or 100g/ml.
- Flag ambiguous rows and potential duplicates; let the user select, correct or
  skip entries instead of silently importing uncertain values.
- Save confirmed entries to the personal library, searchable alongside existing
  foods, with source and source date where available.
- Prefer on-device processing with no paid API or charge to the user.
- Consider scanned/image-only PDFs later: these require OCR and stronger review.

Personal imports and additions to the shared bundled catalogue are separate.
Publishing data for everyone would require source, accuracy, reuse and update
review; a personal import does not automatically publish anything. This roadmap
does not schedule either the importer or a restaurant catalogue expansion before
launch.

## Phase 3: Practical T1 guidance

Build an accessible, plain-language, non-judgemental library covering:

- Alcohol and delayed lows.
- Lifting, exercise, insulin sensitivity and muscle growth.
- Tattoos and piercings.
- Sick days and fasting.
- Travel, time zones and airport security.
- Insulin costs, financial assistance and emergency supplies.
- Prescribed corticosteroids, anabolic steroids and SARMs, clearly distinguished;
  explain evidence, uncertainties and risks without cycles or dosing instructions.

Use authoritative sources, clinical review, regional information and visible
review dates. Start with UK information and clearly label regional alternatives.
Separate general education from situations needing urgent help. Make essential
guidance available offline, allow bookmarking or hiding topics, and provide a way
to report outdated information or request a topic.

The earlier suggested topic order was emergency supply, sick days and travel;
then alcohol and exercise; then the remaining topics. Reassess this order using
post-launch demand and the availability of qualified review.

## Phase 4: Personalised meal reminders

- Learn usual meal windows from logged meals over time.
- Offer optional pre-bolus reminders with timing chosen by the user.
- Support confirming, snoozing, skipping and disabling reminders.
- Handle irregular routines and let users reset learned patterns.
- Account for existing logs to reduce duplicate reminders.
- Explain why each reminder appeared.
- Complete dedicated safety and usability review before release. A predicted
  meal time alone must not become an instruction to take insulin.

## Roadmap principles

- Launch, establish a user base, then select additions based on demonstrated need.
- Reduce the user's effort and cognitive load.
- Prefer low ongoing costs and on-device processing where practical.
- Make uncertainty visible and keep users in control.
- Keep roadmap proposals separate from release promises and implementation tasks.
- Preserve ideas here without allowing them to continually expand launch scope.
