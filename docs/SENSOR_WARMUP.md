# Recorded sensor models and expected warm-up

Record sensor change lets the user select a model, enter the actual start time
(including a past date), and see the duration and expected reading time before
saving. Searchable choices include Other / not sure, whose optional duration can
remain unknown. The most recently recorded choice for the same glucose source
is reused; unsaved choices do not become defaults. Existing notes remain unknown
until edited rather than receiving an assumed model or duration.

The selected model and expected minutes are stored with the note. Its end is the
end of the expected window, not a measurement of when the sensor became ready.
SQLite schema 33 and backup format 18 preserve these fields. Backups through
version 17 migrate with unknown model/duration. Edits update the window and the
existing manual-context invalidation path refreshes derived evidence.

Today shows model and expected end while waiting within the recorded window.
Afterwards it shows that expected warm-up ended and readings are still awaited.
An actual timely reading from the same source ends the waiting status as before.
Readings, alert behaviour, coverage calculations and glucose metrics are unchanged.

Tarv1s gap and coverage answers and planned episode evidence match saved warm-up
windows to missing time from the same glucose source. They explain the overlap
as consistent with expected warm-up, cite the saved change, and leave missing time
outside it unexplained. No missing readings are invented. The recorded start can
precede the requested period when its expected window overlaps that period.

## Manufacturer references

Checked 15 September 2026. These are model-specific expectations, not live states.

| Model | Minutes | Manufacturer reference |
| --- | ---: | --- |
| FreeStyle Libre 2 | 60 | [Abbott application guidance](https://www.freestyle.abbott/sa-en/discover-freestyle-libre/getting-started-with-freestyle-libre/applying-the-sensor.html) |
| FreeStyle Libre 2 Plus | 60 | [Abbott getting started](https://www.freestyle.abbott/content/dam/adc/freestyle/countries/us-en/documents/get-started-guide-FSL2-Plus.pdf) |
| FreeStyle Libre 3 / 3 Plus | 60 | [Abbott system guide](https://www.freestyle.abbott/us-en/products/freestyle-libre-3.html) |
| Dexcom G6 | 120 | [Dexcom comparison](https://www.dexcom.com/en-GB/blog/dexcom-g6-vs-dexcom-g7?ipc=US) |
| Dexcom G7 | 30 | [Dexcom comparison](https://www.dexcom.com/en-us/compare-g7-cgm-g7-15-day) |
| Dexcom G7 15 Day | 60 | [Dexcom warm-up explanation](https://provider.dexcom.com/why-does-dexcom-g7-15-day-require-60-minute-warm) |
| Dexcom ONE+ | 30 | [Dexcom ONE+ guidance](https://www.dexcom.com/en-GB/blog/introducing-dexcom-one-plus?ipc=US) |

Record when the sensor's warm-up actually began, rather than when the note was
entered. Follow the instructions for the selected model in the official app.
T1 Arc's recorded window cannot determine the sensor's actual readiness.
