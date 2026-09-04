# Food logging and barcode scanning

T1 Arc separates reference foods, packaged products and personal foods so a
search result is clear about where it came from.

## Log a meal

1. Open Today and choose the meal you want to add.
2. Search for a food, scan a barcode, choose a recent item or open My Foods.
3. Check the serving size and carbohydrate value.
4. Add more items if needed.
5. Review the draft and save the meal.

The draft stays separate from the daily record until it is saved.

## Copy food from another day

Choose **Copy from another day**, select the date and meal, then choose all
items or only the items you need. You can append to the current draft or replace
it. Review the quantities before saving.

This is intended for repeated breakfasts, lunches and other meals that change
only slightly from day to day.

## Other entry routes

- **Quick carbs** records a carbohydrate total when the rest of the nutrition
  values are not known.
- **My Foods** stores foods you create and edit on the phone.
- **Meals and recipes** keep reusable combinations of items.
- **Recent and favourites** reduce repeated searching.

## Regional reference search

Normal reference-food search is bundled in the app and works offline for the
three principal catalogues.

| Profile | Bundled catalogue | Normal API key or quota |
| --- | --- | --- |
| Great Britain | CoFID 2021 | None |
| United States | 5,742 curated USDA Foundation and FNDDS foods | None |
| Japan | 2,538 MEXT reference foods | None |
| Other profiles | Personal and saved foods | None |

Changing the region changes the relevant search catalogue and formatting. It
does not rewrite the canonical values already stored in a record.

## Packaged products and barcodes

Open Food Facts is used for packaged-food text search and barcode lookup. The
request goes directly from the phone to Open Food Facts. T1 Arc does not send
those requests through a maintainer server or maintainer API key.

Open Food Facts applies service limits by client and IP address. Separate phones
normally make separate requests, but people sharing one Wi-Fi or carrier NAT may
also share an IP allowance. T1 Arc caches normalized results and keeps bundled
reference search offline to avoid unnecessary calls.

For a United States profile, an Open Food Facts barcode miss can use USDA's
public low-rate demo access for an exact GTIN lookup. That fallback is not used
for normal US text search. A heavily shared network can still throttle the
fallback, so it should not be treated as a guaranteed barcode service.

## Check a result before saving

Food databases can contain missing, old or user-submitted values. Check the
package label when accuracy matters. The item screen shows the source and the
nutrient basis where the source provides it.

## Privacy and licences

Bundled CoFID, USDA and MEXT searches stay on the phone. Open Food Facts receives
the food query or barcode, selected country and language context, and normal
network metadata such as the IP address. Product images may also load from Open
Food Facts.

The in-app source panel and [third-party notices](../THIRD_PARTY_NOTICES.md)
record dataset provenance and reuse terms. Do not add a national or commercial
food database without confirming that its licence permits redistribution.
