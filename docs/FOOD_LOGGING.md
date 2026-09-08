# Food logging and barcode scanning

Search, scan a barcode or reuse something you have saved. Each result names
its source, and nothing becomes a logged meal until you choose **Save meal**.

This guide describes the current source. Check the release notes for the APK
on your phone before expecting newly added features.

## Log a meal

1. Open Today and choose the meal you want to add.
2. Search for a food, scan a barcode, choose a recent item or open My Foods.
3. Check the serving size and carbohydrate value.
4. Add more items if needed. **Add another saved food** opens Recent, Favourites
   and My Foods without clearing the draft.
5. Review the draft and save the meal.

Typing starts a search of the foods on your phone; local results do not wait
for an online response. Tap **Search** to also check packaged foods online.
**More results** shows another page; **Search other countries**
widens a search when the local market does not have what you need. These are
optional actions, not extra steps for selecting a food that is already shown.

The meal page keeps search, scanning and saved foods together. The small
**Copy from a day** and **More options** actions open the less frequent tools
separately, without clearing the meal you are building.

Adding another saved food keeps the portions you have already edited. Closing
the saved-food picker does not remove them. Whole-meal and recipe replacement
actions are kept separate from this single-food picker. **See all saved foods**
opens the full searchable library, including older items not shown as quick
picks. A row's options menu gives access to editing or deleting personal foods
and recipes.

## When a barcode is missing

If a barcode cannot be found, enter the name and nutrition from the label, then
choose **Save to My Foods & add**. The barcode is attached to that personal
food. Scanning it again finds your saved version on the same phone, including
offline. If a product is found but lacks carbohydrates, T1 Arc keeps the known
details and asks you to fill the gap from the label.

Saving to My Foods is separate from saving a meal. Discarding the meal does not
delete a food you have already saved. Personal foods are not submitted to a
public database or shared with other users.

Successful product lookups are also cached locally without logging a meal.
A known barcode saved for the same country can appear immediately even when
its details are older, with a warning to check the label before saving. This
does not refresh its source date, and service errors do not turn an old value
into a newly verified one. Check the label if the product has changed.

## Portions and recipes

Check whether nutrition is given per 100 g, per 100 ml or per serving. T1 Arc
does not convert weight into volume without a known equivalent.

Expand a food's portion controls to set what one item weighs, then choose
**Remember this portion** if you want to reuse it. This does not change the
amount in your current meal or alter previous records.

Save a recipe as the full batch and enter how many servings it makes. After
saving, choose the number of servings you are eating. The full batch is not
left selected as your meal. Choosing a saved recipe also asks for servings;
the saved ingredients and previous meals stay unchanged.

## Copy food from another day

Choose **Copy from a day** on the meal page, select the date and meal, then
choose all items or only the items you need. You can append to the current draft
or replace it. Review the quantities before saving.

The picker starts with the previous day and defaults to appending. Choosing
**Replace** is a separate choice; copying food does not save the meal for you.

This is intended for repeated breakfasts, lunches and other meals that change
only slightly from day to day.

## Other entry routes

- **Just enter carbs** records a carbohydrate total when the rest of the nutrition
  values are not known.
- **My Foods** stores foods you create and edit on the phone.
- **Meals and recipes** keep reusable combinations of items.
- **Recent and favourites** reduce repeated searching.

Choose **More options** on the meal page, then **Enter barcode number**,
**Just enter carbs** or **Create a food**. Each opens its own page rather than
expanding a form among your meal items. Use **Back to food options**, then
**Back to meal**, to return without clearing your meal draft. You can leave
these tools closed when search, scanning or saved foods are all you need.

## Regional reference search

Reference-food search works offline. The app uses the selected country, so you
do not need to choose a database or create an account.

| Profile | Bundled catalogue | Normal API key or quota |
| --- | --- | --- |
| Great Britain | CoFID 2021 | None |
| United States | 5,742 curated USDA Foundation and FNDDS foods | None |
| Japan | 2,538 MEXT reference foods | None |
| Canada | 5,993 Canadian Nutrient File foods | None |
| France | 3,483 Ciqual foods with usable nutrition | None |
| Germany | 7,140 BLS foods with usable nutrition | None |
| Other profiles | Personal and saved foods | None |

Changing the region changes the relevant search catalogue and formatting. It
does not rewrite the canonical values already stored in a record.

The smaller Canadian, French and German catalogues are prepared automatically
from the app's bundled files the first time they are needed. Their names follow
the source data. This does not mean that the app interface has been translated.

### More US packaged foods, offline

With the US country selected, open **More options**, then **Offline food
catalogue**. On that separate page, **Add offline catalogue** prepares 409,329
branded USDA foods for local search and barcode scanning. It needs about 151 MB
of additional phone storage.
The compressed file is included in the APK, so there is no account, download
subscription or runtime API allowance for this catalogue.

The catalogue controls do not occupy the main meal form. Use **Back to food
options**, then **Back to meal**, to return to your existing draft.
Regular US reference search works without this extra catalogue. You can remove
it without deleting saved foods or meals. The pack is a dated source
snapshot, not a promise of every product or the latest package formulation.

## Packaged products and barcodes

Open Food Facts is used for packaged-food text search and barcode lookup. The
request goes directly from the phone to Open Food Facts. T1 Arc does not send
those requests through a maintainer server or maintainer API key.

Open Food Facts applies service limits by client and IP address. Separate phones
normally make separate requests, but people sharing one Wi-Fi or carrier NAT may
also share an IP allowance. T1 Arc caches normalized results and keeps bundled
reference search offline to avoid unnecessary calls.

Saved personal foods and valid cached results are checked first. An installed
US branded pack is checked locally before an online request.

For a United States profile, an Open Food Facts barcode miss can use USDA's
public low-rate demo access for an exact GTIN lookup. That fallback is not used
for normal US text search. A heavily shared network can still throttle the
fallback, so it should not be treated as a guaranteed barcode service.

## Check a result before saving

Food databases can contain missing, old or user-submitted values. Check the
package label when accuracy matters. The item screen shows the source and the
nutrient basis where the source provides it.

Missing nutrients are not treated as reported zeroes. A partial-total note
appears when some ingredients lack a nutrient that others report. Saved food
and catalogue details retain source carbohydrate definitions. T1 Arc does not
silently subtract fibre from a US total to make it resemble a UK label.

Recipe ingredient snapshots retain their numeric nutrition, portions and source
attribution. After reload, they can lack the original carbohydrate-definition
and source-date metadata. A backup preserves that existing boundary; it cannot
recreate missing historical metadata from a newer catalogue entry.

### Read a nutrition label

The optional label camera reads English nutrition tables on the phone.
Review its suggested basis and values, choose **Use these values**, then check
the editable food form before saving. Uncertain or missing values need manual
entry. It does not identify a meal from its appearance, estimate portions from
a photograph or log anything automatically. Manual entry remains available
when the camera cannot read the label or its script is unsupported.

For example, if a lookup has no carbohydrate value, keep the product name and
barcode, copy the label's stated basis and carbohydrate value, then review
**Save to My Foods & add**. If the camera misreads a number, correct it in the
review form or cancel and enter it manually. Neither route saves a meal by
itself.

## Privacy and licences

Bundled catalogue searches and label recognition stay on the phone. The label
photo is temporary and is not uploaded. Open Food Facts receives
the food query or barcode, selected country and language context, and normal
network metadata such as the IP address. Product images may also load from Open
Food Facts.

The bundled recognition SDK can send usage and performance diagnostics to
Google even though the label photo and recognised text remain local. See the
[privacy model](../PRIVACY.md#network-flows-chosen-by-the-user) for that separate
disclosure.

The in-app source panel and [third-party notices](../THIRD_PARTY_NOTICES.md)
record dataset provenance and reuse terms. Do not add a national or commercial
food database without confirming that its licence permits redistribution.
