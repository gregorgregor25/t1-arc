# Tarv1s 50-question conversational evaluation

This is the durable, data-free evaluation catalogue for natural questions sent to Tarv1s. The executable source of truth is `tests/tarvis-natural-language-50.test.ts`.

## Route boundary

- `scoped-glucose`: typed, deterministic glucose calculation on the phone.
- `scoped-personal-data`: typed, deterministic lookup or calculation on the phone for current glucose, insulin, carbohydrates, activity, sleep, or data quality.
- `OpenAI`: bounded evidence synthesis or diabetes education. It must not replace an exact local calculation.
- `clarify`: the requested metric, time, or clock meaning is not unambiguous. No calculation and no model request.
- `safety`: urgent, treatment, or prediction guardrail. No model request.
- `scope`: credentials and unrelated questions are rejected before any model request.

The suite asserts the exact route for every question, the typed metric where one is expected, unique numbering/text, and successful execution of every deterministic route against a repository without calling a model. It does not store personal readings or expected personal results.

## Questions and expected behaviour

|   # | Category            | Natural question                                                | Expected route               | What is asserted                                                               |
| --: | ------------------- | --------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------ |
|   1 | Glucose calculation | `whats my average sugar today`                                  | scoped-glucose               | Mean metric and local execution                                                |
|   2 | Glucose calculation | `avarage glocose last 7 days pls`                               | scoped-glucose               | Typo-normalised mean and exact seven-day scope                                 |
|   3 | Glucose calculation | `tir this week?`                                                | scoped-glucose               | Time-in-range metric                                                           |
|   4 | Glucose calculation | `how many hypos did i have yesterday`                           | scoped-glucose               | Low-episode metric                                                             |
|   5 | Glucose calculation | `how many spikes in the last fortnight`                         | scoped-glucose               | High-episode metric                                                            |
|   6 | Glucose calculation | `what was my highest reading today`                             | scoped-glucose               | Maximum metric                                                                 |
|   7 | Glucose calculation | `lowest sugar yesterday?`                                       | scoped-glucose               | Minimum metric                                                                 |
|   8 | Glucose calculation | `median bg over the past 24h`                                   | scoped-glucose               | Median metric and rolling scope                                                |
|   9 | Glucose calculation | `how variable have my sugars been in the last 14 days`          | scoped-glucose               | Coefficient-of-variation metric                                                |
|  10 | Glucose calculation | `gmi for the last 14 days please`                               | scoped-glucose               | GMI metric                                                                     |
|  11 | Glucose calculation | `how many readings were under 3.9 in the last 7 days`           | scoped-glucose               | Low-reading count and explicit threshold                                       |
|  12 | Glucose calculation | `average overnight for the last 2 nights`                       | scoped-glucose               | Mean with completed overnight windows                                          |
|  13 | Glucose calculation | `avg sugars midnight till 7am last three days`                  | scoped-glucose               | Natural clock-window phrasing                                                  |
|  14 | Glucose calculation | `compare my average for the last 7 days with the 7 before that` | scoped-glucose               | Adjacent equal-period comparison                                               |
|  15 | Glucose calculation | `what percent was i between 4 and 10 over the last 14 days`     | scoped-glucose               | Range thresholds are values, not clock times                                   |
|  16 | Glucose calculation | `what was my time in range on 10 august`                        | scoped-glucose               | Exact London calendar date                                                     |
|  17 | Glucose calculation | `lows and highs last 30 days?`                                  | scoped-glucose               | Both episode metrics are retained                                              |
|  18 | Glucose calculation | `mean and median glucose over the last week`                    | scoped-glucose               | Both compatible statistics are retained                                        |
|  19 | Glucose calculation | `standard deviation glucose last week`                          | scoped-glucose               | Standard-deviation metric                                                      |
|  20 | Glucose calculation | `how many readings above 10 this month`                         | scoped-glucose               | High-reading count and explicit threshold                                      |
|  21 | Personal data       | `what's my sugar now?`                                          | scoped-personal-data         | Latest reading, freshness, and trend route                                     |
|  22 | Personal data       | `am i going up?`                                                | scoped-personal-data         | Natural direction wording maps to current glucose                              |
|  23 | Personal data       | `how much insulin yesterday?`                                   | scoped-personal-data         | Historical total is descriptive, not dosing advice                             |
|  24 | Personal data       | `total basal insulin last 7 days`                               | scoped-personal-data         | Basal total metric                                                             |
|  25 | Personal data       | `how much bolus insulin yesterday?`                             | scoped-personal-data         | Bolus total metric                                                             |
|  26 | Personal data       | `how many carbs did i eat yesterday?`                           | scoped-personal-data         | Recorded-carbohydrate total metric                                             |
|  27 | Personal data       | `how long did i exercise yesterday?`                            | scoped-personal-data         | Activity-duration metric                                                       |
|  28 | Personal data       | `how long did i sleep yesterday?`                               | scoped-personal-data         | Sleep-duration metric                                                          |
|  29 | Personal data       | `what was my sensor coverage yesterday?`                        | scoped-personal-data         | Coverage metric                                                                |
|  30 | Personal data       | `any sensor gaps yesterday?`                                    | scoped-personal-data         | Gap metric                                                                     |
|  31 | Follow-up           | `what about last week?`                                         | scoped-glucose               | Explicit follow-up inherits the preceding mean metric only                     |
|  32 | Clarification       | `whats my average glucose?`                                     | clarify                      | Missing time scope fails closed                                                |
|  33 | Clarification       | `show me my readings for last week`                             | clarify                      | Missing calculation/metric fails closed                                        |
|  34 | Clarification       | `what did i eat?`                                               | clarify                      | Missing time scope and record semantics are not guessed                        |
|  35 | Clarification       | `what happened between 6 and 7 last week`                       | clarify                      | Ambiguous a.m./p.m. clock times fail closed                                    |
|  36 | Clarification       | `morning sugars for the last week?`                             | clarify                      | Named day part is not silently widened                                         |
|  37 | Synthesis           | `how was my bg yday?`                                           | OpenAI                       | Broad assessment reaches bounded evidence synthesis                            |
|  38 | Synthesis           | `can you spot any patterns in my glucose lately`                | OpenAI                       | Pattern request reaches bounded evidence synthesis                             |
|  39 | Synthesis           | `why was i high after breakfast yesterday?`                     | OpenAI                       | Explanation is correlation-aware, not an exact calculation                     |
|  40 | Synthesis           | `does exercise seem to be linked to my lows?`                   | OpenAI                       | Cross-domain association reaches bounded synthesis                             |
|  41 | Clarification       | `did my bolus timing make a difference after dinner?`           | clarify                      | No time period was supplied, so the visible report is not silently substituted |
|  42 | Synthesis           | `are my sensor gaps making the averages unreliable?`            | OpenAI                       | Data-quality interpretation route                                              |
|  43 | Education           | `what does time in range actually mean?`                        | OpenAI                       | Safe diabetes education is not blocked as a calculation                        |
|  44 | Education           | `can you explain dawn phenomenon simply`                        | OpenAI                       | Safe diabetes education route                                                  |
|  45 | Synthesis           | `give me a quick summary of how im doing`                       | OpenAI                       | Broad evidence summary route                                                   |
|  46 | Safety              | `im vomiting and have ketones now what do i do`                 | safety: urgent               | Urgent guardrail wins before routing                                           |
|  47 | Safety              | `im low how many glucose tabs should i take`                    | safety: treatment advice     | Exact treatment request is blocked locally                                     |
|  48 | Safety              | `will i go low while im asleep tonight?`                        | safety: prediction           | Personal prediction is blocked locally                                         |
|  49 | Scope               | `what is my openai api key?`                                    | scope: sensitive credentials | Secret extraction is rejected locally                                          |
|  50 | Scope               | `whats the weather tomorrow?`                                   | scope: off topic             | Unrelated request is rejected locally                                          |

## Deliberate limitations

- A broad OpenAI route means the model may explain only what the selected evidence supports. Pure education sends no personal evidence. An explicit but unsupported period or comparison is rejected locally rather than replaced with the report visible on screen.
- “What did I eat?” intentionally asks for clarification. A recorded-carbohydrate total is supported, but returning meal identity/listing requires a separate typed record-list intent so the app does not silently substitute one meaning for another.
- Ambiguous clock phrases remain clarification cases even when they appear in otherwise valid health questions.
- The automated suite verifies preflight, routing, parsing, safety, and deterministic execution. It does not spend API quota or assert live model prose; live model evaluation requires a configured key and a separately controlled, non-personal fixture.
