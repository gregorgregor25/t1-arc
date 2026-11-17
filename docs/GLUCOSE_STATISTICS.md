# Glucose statistics

This page explains how T1 Arc calculates time in ranges and related figures.
The same rules are used in History, Insights, the GMI card and Tarv1s
on-device answers. They describe recorded sensor readings. They are not
treatment advice.

## Ranges

Every figure names the range it uses.

| Name | mmol/L | mg/dL | Where it comes from |
| --- | --- | --- | --- |
| Standard range | 3.9–10.0 | 70–180 | International consensus on time in range |
| Tight range | 3.9–7.8 | 70–140 | Consensus tight range |
| Your range | your choice | your choice | **Display and alerts > Glucose ranges**, the **In range** band (Target starts / Target ends) |

"Time in range" without a name always means the standard range. Your range
only appears where it is labelled **Your range**. Changing it does not change
the standard or tight figures. If your saved band is invalid (for example the
start is not below the end), T1 Arc leaves it out rather than guessing.

## Consensus bands

Observed time is split into five bands:

| Band | mmol/L | mg/dL |
| --- | --- | --- |
| Very low | below 3.0 | below 54 |
| Low | 3.0–3.8 | 54–69 |
| In range | 3.9–10.0 | 70–180 |
| High | 10.1–13.9 | 181–250 |
| Very high | above 13.9 | above 250 |

The five bands add up to 100% of observed time.

### Boundaries in both units

Readings are stored in mmol/L. Some sources convert exactly from mg/dL (for
example 70 mg/dL becomes 3.885 mmol/L) and others round to one decimal place.
So that a reading of 70 mg/dL is in range for every user, each consensus
boundary accepts both its published mmol/L value and its published mg/dL value.
For example the standard range includes everything from 70 mg/dL (3.885 mmol/L)
up to 10.0 mmol/L (180.2 mg/dL). A reading of 10.05 mmol/L is high. Boundary
values are shown with their published numbers, so 7.8 mmol/L appears as
140 mg/dL, not 141.

Your own range uses exactly the values you saved.

## Duration weighting

Figures are shares of observed sensor time, not counts of readings.

- Readings recorded at the same moment are averaged into one value.
- Each value counts from its time until the next reading, for at most
  12 minutes.
- A gap longer than 12 minutes is missing time. It is left out, not filled in.
- Days are local calendar days in your time zone, so a clock-change day is
  23 or 25 hours long.

## Coverage

Coverage is observed sensor time divided by the length of the period.

- History and Tarv1s still show figures below 70% coverage, with a note that
  they describe the recorded time only.
- The Insights comparison is withheld unless both periods have at least 70%
  coverage and at least 100 readings.
- The Glycemia Risk Index is shown only at 70% coverage or more.

## Glycemia Risk Index

Under **More statistics** in History, the Glycemia Risk Index (GRI, Klonoff
2023) combines time low and time high into one figure from 0 to 100, counting
lows more heavily:

```
GRI = 3.0 × (very low + 0.8 × low) + 1.6 × (very high + 0.5 × high)
```

Each term is a percentage of observed time. The result is capped at 100.
Higher numbers mean more time outside range. It is a summary of records, not a
target.

## Where each figure appears

- **History**: the **Time in ranges** card shows the five bands, the standard,
  tight and your range, coverage and, under **More statistics**, the GRI.
  **Compare with previous period** opens Insights with the same period length
  and end date (a single day opens a 7-day comparison).
- **Insights**: 3, 7, 14, 30 and 90-day comparisons. Findings name the
  standard range and list the tight range and the consensus bands for both
  periods.
- **GMI card**: the same period's standard and tight range figures.
- **Tarv1s** on-device answers:
  - "time in range" uses the standard range and says so;
  - "time in tight range" or "TITR" uses 3.9–7.8 mmol/L;
  - "time in my range" uses your **In range** band;
  - "time below 3", "time above 250 mg/dL", "time very low" or "time above
    range" lead with that share.

  A bare number above 30 is read as mg/dL. Tarv1s compares readings with the
  exact level in your question, so a reading stored as exactly 70 mg/dL counts
  as below "3.9" in a Tarv1s answer but in range on the History card.
