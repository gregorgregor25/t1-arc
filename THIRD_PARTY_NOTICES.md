# Third-party notices

T1 Arc's first-party LibreLinkUp connector was informed by the public
GlucoDataHandler implementation:

- Project: GlucoDataHandler
- Copyright: © 2023 Michael Pach
- Source: https://github.com/pachi81/GlucoDataHandler
- Licence: MIT

MIT License

Copyright (c) 2023 Michael Pach

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

LibreLinkUp, FreeStyle Libre, Glooko, Omnipod, Android, and other product names
belong to their respective owners. T1 Arc is not affiliated with or endorsed by
those companies.

Food data used by T1 Arc:

- McCance and Widdowson's Composition of Foods Integrated Dataset 2021
  (CoFID), published by Public Health England. T1 Arc distributes a processed,
  compact subset and retains the official source metadata. Contains public
  sector information licensed under the
  [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
  Official dataset: [Composition of foods integrated dataset](https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid).
- Open Food Facts product data, made available under the Open Database Licence
  ([ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)). Individual
  database contents are available under the
  [Database Contents Licence 1.0](https://opendatacommons.org/licenses/dbcl/1-0/).
  Product images are licensed separately under CC BY-SA and can contain
  third-party graphical rights; T1 Arc does not bundle those images. T1 Arc
  identifies Open Food Facts on returned records. Anyone publishing an adapted
  database must also follow Open Food Facts' attribution and share-alike terms.
  Official reuse guidance: [Open Food Facts licensing](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/tutorials/license-be-on-the-legal-side/).
- USDA FoodData Central data, made available by the United States Department
  of Agriculture as US public-domain data under
  [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).
  T1 Arc distributes a processed subset of Foundation Foods and FNDDS and
  identifies FoodData Central as its source. Official licensing, requested
  citation, API-key and rate-limit terms: [FoodData Central API guide](https://fdc.nal.usda.gov/api-guide/).
- 日本食品標準成分表（八訂）増補2023年 (Standard Tables of Food Composition
  in Japan 2023), published by Japan's Ministry of Education, Culture, Sports,
  Science and Technology. T1 Arc created and distributes a processed, compact
  subset from that source. The subset is not an official MEXT output. MEXT
  permits application reuse and asks reusers to identify the source as
  「日本食品標準成分表（八訂）増補2023年から出典」 (source: Standard Tables of
  Food Composition in Japan 2023). Official reuse and attribution terms:
  [MEXT food-composition data use](https://www.mext.go.jp/a_menu/syokuhinseibun/index.htm)
  and [MEXT website content policy](https://www.mext.go.jp/b_menu/1351168.htm).

Additional offline country packs contain only public food-composition data;
they are separate from the user's health records and the MIT application code:

- Canadian Nutrient File, Health Canada, 2026. Contains information licensed
  under the [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada).
  [Official dataset](https://open.canada.ca/data/en/dataset/1b6139bd-ed7e-4043-bc28-ff00e10f3109).
  The processed pack retains English/French names, selected nutrients and source
  gram portions. Total carbohydrate by difference includes dietary fibre.
- Anses. 2025. Table de composition nutritionnelle des aliments Ciqual.
  [Official dataset and licence](https://doi.org/10.57745/RDMHWY), Etalab Open
  Licence 2.0. T1 Arc's selected-nutrient SQLite conversion is not an official
  Anses product. Source attribution, version and original available-carbohydrate
  meaning are retained. Trace and below-quantification cells are not guessed zero.
- Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0 –
  Deutsche Nährstoffdatenbank. Karlsruhe. DOI: 10.25826/Data20251217-134202-0.
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/),
  [official licence/download](https://blsdb.de/download).
  Changes: selected nutrients, normalized whitespace, English/German search
  fields, source-name-derived bread aliases for B-coded foods, SQLite conversion.
  BLS CHO is available carbohydrate, including polyols.
- Optional USDA branded foods snapshot, April 2026, US Department of Agriculture,
  Agricultural Research Service, FoodData Central. CC0 1.0 (as above).
  [Official bulk downloads](https://fdc.nal.usda.gov/download-datasets/).
  T1 Arc retains supported nutrients for United States market entries and resolves
  equivalent GTIN revisions by publication date and then FDC identifier. Repeated
  contradictory amounts for the same nutrient stay unknown; identical duplicates
  collapse. Documented g/GRM and ml/MLT source units are normalized while retaining
  the per-100-source-unit basis; no density is inferred. It is a dated snapshot,
  not a live claim about current product formulation.

The pack manifest records original source SHA-256 hashes, transformed database
SHA-256 and bounded verification chunks, licence/attribution, nutrient definitions,
version, record counts and size. Search text is normalized; real numeric zero is
retained and missing/trace supported nutrients remain unknown. The source files
are cached only in local build QA.
These publishers do not endorse T1 Arc. No images or logos are bundled.

Additional runtime packages include:

- fflate, copyright © Arjun Barrett, MIT License.
- React Native DateTimePicker, copyright © 2019 React Native Community, MIT
  License.
- Expo modules, copyright © 2015-present 650 Industries, Inc., MIT License.

The runtime packages' full licence texts are distributed in their respective
package sources. The food-data terms are linked above; they are not npm package
licences and are not represented as bundled package licence files.

The lockfile records licence metadata for the complete installed JavaScript
dependency graph. `npm run verify:public-source` requires that metadata to be
present and rejects licence identifiers selected for manual restricted-licence
review. This automated check is an inventory control, not legal advice and not
a substitute for reviewing the notices required by a release's exact bundled
artifacts.
