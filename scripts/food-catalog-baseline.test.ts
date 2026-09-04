import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import appPackage from '../package.json';

import { searchCofidFoods } from '@/data/food/cofidCatalog';
import {
  FoodSearchProvider,
  createFoodSearchEngine,
} from '@/data/food/foodSearch';
import {
  normaliseFoodSearchText,
} from '@/data/food/foodSearchRanking';
import {
  createOpenFoodFactsRateGate,
  searchOpenFoodFactsProducts,
} from '@/data/food/openFoodFacts';
import type { FoodCandidate } from '@/data/food/types';

type QueryKind = 'generic' | 'ambiguous' | 'misspelling' | 'brand';

interface QaQuery {
  category: string;
  query: string;
  expectedAny: string[];
  kind: QueryKind;
}

function qa(
  category: string,
  query: string,
  expectedAny: string | string[],
  kind: QueryKind = 'generic',
): QaQuery {
  return {
    category,
    query,
    expectedAny: Array.isArray(expectedAny) ? expectedAny : [expectedAny],
    kind,
  };
}

const LOCAL_QUERIES: QaQuery[] = [
  qa('Staples', 'white bread', 'bread'),
  qa('Staples', 'wholemeal bread', ['wholemeal bread', 'wholemeal']),
  qa('Staples', 'basmati rice', ['basmati rice', 'rice']),
  qa('Staples', 'brown rice', 'rice'),
  qa('Staples', 'spaghetti', ['spaghetti', 'pasta']),
  qa('Staples', 'porridge oats', ['porridge', 'oat']),
  qa('Staples', 'baked potato', 'potato'),
  qa('Staples', 'mashed potato', 'potato'),
  qa('Staples', 'couscous', 'couscous'),
  qa('Staples', 'baked beans', 'bean'),
  qa('Staples', 'lentil soup', ['lentil soup', 'lentil']),
  qa('Staples', 'tortilla wrap', ['tortilla', 'wrap']),

  qa('Produce', 'banana', 'banana'),
  qa('Produce', 'bannana', 'banana', 'misspelling'),
  qa('Produce', 'apple raw', 'apple'),
  qa('Produce', 'broccoli boiled', 'broccoli'),
  qa('Produce', 'brocolli', 'broccoli', 'misspelling'),
  qa('Produce', 'avocado', 'avocado'),
  qa('Produce', 'avacado', 'avocado', 'misspelling'),
  qa('Produce', 'strawberries', 'strawberr'),
  qa('Produce', 'blueberries', 'blueberr'),
  qa('Produce', 'orange', 'orange', 'ambiguous'),
  qa('Produce', 'carrots boiled', 'carrot'),
  qa('Produce', 'peas frozen', 'pea'),

  qa('Meat and fish', 'chicken breast grilled', 'chicken'),
  qa('Meat and fish', 'chiken breast', 'chicken', 'misspelling'),
  qa('Meat and fish', 'salmon baked', 'salmon'),
  qa('Meat and fish', 'salomn', 'salmon', 'misspelling'),
  qa('Meat and fish', 'tuna canned', 'tuna'),
  qa('Meat and fish', 'cod fillet', 'cod'),
  qa('Meat and fish', 'beef mince', 'beef'),
  qa('Meat and fish', 'pork chop', 'pork'),
  qa('Meat and fish', 'lamb leg', 'lamb'),
  qa('Meat and fish', 'turkey breast', 'turkey'),
  qa('Meat and fish', 'prawns', 'prawn'),
  qa('Meat and fish', 'fish fingers', 'fish finger'),

  qa('Dairy and eggs', 'semi skimmed milk', 'milk'),
  qa('Dairy and eggs', 'whole milk', 'milk'),
  qa('Dairy and eggs', 'cheddar cheese', ['cheddar', 'cheese']),
  qa('Dairy and eggs', 'Greek yoghurt', ['yoghurt', 'yogurt']),
  qa('Dairy and eggs', 'yoghut strawberry', ['yoghurt', 'yogurt'], 'misspelling'),
  qa('Dairy and eggs', 'cottage cheese', 'cottage cheese'),
  qa('Dairy and eggs', 'butter salted', 'butter'),
  qa('Dairy and eggs', 'double cream', 'cream'),
  qa('Dairy and eggs', 'mozzarella', 'mozzarella'),
  qa('Dairy and eggs', 'eggs boiled', 'egg'),
  qa('Dairy and eggs', 'skimmed milk', 'milk'),
  qa('Dairy and eggs', 'ice cream vanilla', 'ice cream'),

  qa('Vegan and pulses', 'tofu', 'tofu'),
  qa('Vegan and pulses', 'tempeh', 'tempeh'),
  qa('Vegan and pulses', 'soya milk', ['soya', 'soy']),
  qa('Vegan and pulses', 'oat milk', ['oat', 'milk']),
  qa('Vegan and pulses', 'almond milk', ['almond', 'milk']),
  qa('Vegan and pulses', 'vegan sausage', ['vegan', 'vegetarian sausage']),
  qa('Vegan and pulses', 'plant based burger', ['plant', 'vegetarian burger']),
  qa('Vegan and pulses', 'hummus', ['hummus', 'houmous']),
  qa('Vegan and pulses', 'humus', ['hummus', 'houmous'], 'misspelling'),
  qa('Vegan and pulses', 'falafel', 'falafel'),
  qa('Vegan and pulses', 'chickpeas', 'chickpea'),
  qa('Vegan and pulses', 'lentils cooked', 'lentil'),

  qa('Snacks and confectionery', 'potato crisps', ['crisp', 'potato']),
  qa('Snacks and confectionery', 'choclate biscuit', ['chocolate', 'biscuit'], 'misspelling'),
  qa('Snacks and confectionery', 'digestive biscuit', 'digestive'),
  qa('Snacks and confectionery', 'milk chocolate', 'chocolate'),
  qa('Snacks and confectionery', 'cereal bar', ['cereal bar', 'bar']),
  qa('Snacks and confectionery', 'peanuts roasted', 'peanut'),
  qa('Snacks and confectionery', 'popcorn salted', 'popcorn'),
  qa('Snacks and confectionery', 'flapjack', 'flapjack'),
  qa('Snacks and confectionery', 'jelly sweets', ['sweet', 'jelly']),
  qa('Snacks and confectionery', 'rice cakes', 'rice cake'),
  qa('Snacks and confectionery', 'sausage roll', 'sausage roll'),
  qa('Snacks and confectionery', 'cheese twist', ['cheese twist', 'twist']),

  qa('Drinks', 'orange juice', ['orange juice', 'juice']),
  qa('Drinks', 'apple juice', ['apple juice', 'juice']),
  qa('Drinks', 'cola', ['cola', 'coca']),
  qa('Drinks', 'coke', ['cola', 'coca'], 'ambiguous'),
  qa('Drinks', 'coffee latte', ['latte', 'coffee']),
  qa('Drinks', 'cappucino', ['cappuccino', 'coffee'], 'misspelling'),
  qa('Drinks', 'tea with milk', 'tea'),
  qa('Drinks', 'hot chocolate', 'chocolate'),
  qa('Drinks', 'lager beer', ['lager', 'beer']),
  qa('Drinks', 'red wine', 'wine'),
  qa('Drinks', 'energy drink', ['energy drink', 'soft drink']),
  qa('Drinks', 'fruit smoothie', 'smoothie'),

  qa('Breakfast cereals', 'corn flakes', ['corn flake', 'cornflake']),
  qa('Breakfast cereals', 'wheat biscuits', ['wheat biscuit', 'biscuit']),
  qa('Breakfast cereals', 'bran flakes', 'bran'),
  qa('Breakfast cereals', 'granola', 'granola'),
  qa('Breakfast cereals', 'muesli', 'muesli'),
  qa('Breakfast cereals', 'rice cereal', ['rice cereal', 'rice']),
  qa('Breakfast cereals', 'chocolate cereal', ['chocolate', 'cereal']),
  qa('Breakfast cereals', 'porridge made with milk', 'porridge'),
  qa('Breakfast cereals', 'instant oats', ['oat', 'porridge']),
  qa('Breakfast cereals', 'shredded wheat', ['shredded wheat', 'wheat']),
  qa('Breakfast cereals', 'cereal with milk', 'cereal'),
  qa('Breakfast cereals', 'weetabix', ['wheat biscuit', 'weetabix'], 'brand'),

  qa('Ready meals', 'chicken tikka masala', ['tikka', 'chicken curry']),
  qa('Ready meals', 'beef lasagne', ['lasagne', 'lasagna']),
  qa('Ready meals', 'lasange', ['lasagne', 'lasagna'], 'misspelling'),
  qa('Ready meals', 'macaroni cheese', ['macaroni', 'pasta cheese']),
  qa('Ready meals', 'shepherds pie', ['shepherd', 'lamb pie']),
  qa('Ready meals', 'cottage pie', 'cottage pie'),
  qa('Ready meals', 'pizza margherita', ['pizza', 'margherita']),
  qa('Ready meals', 'fish pie', 'fish pie'),
  qa('Ready meals', 'vegetable curry', ['vegetable curry', 'curry']),
  qa('Ready meals', 'chicken kiev', ['chicken kiev', 'chicken kyiv']),
  qa('Ready meals', 'ready meal chilli', ['chilli', 'chili']),
  qa('Ready meals', 'noodle pot', ['noodle', 'pot noodle']),

  qa('Takeaways', 'fish and chips', ['fish and chips', 'fish chips']),
  qa('Takeaways', 'cheeseburger', ['cheeseburger', 'burger']),
  qa('Takeaways', 'chicken burger', 'chicken burger'),
  qa('Takeaways', 'pepperoni pizza', ['pepperoni', 'pizza']),
  qa('Takeaways', 'donner kebab', ['doner', 'donner', 'kebab']),
  qa('Takeaways', 'chicken kebab', 'kebab'),
  qa('Takeaways', 'Chinese fried rice', 'fried rice'),
  qa('Takeaways', 'chow mein', ['chow mein', 'noodle']),
  qa('Takeaways', 'chicken curry takeaway', ['chicken curry', 'curry']),
  qa('Takeaways', 'spring roll', 'spring roll'),
  qa('Takeaways', 'onion bhaji', ['bhaji', 'onion']),
  qa('Takeaways', 'garlic bread', 'garlic bread'),
];

const LIVE_QUERIES: QaQuery[] = [
  qa('Brand/live', 'Heinz baked beans', ['heinz', 'baked beans'], 'brand'),
  qa('Brand/live', 'Warburtons Toastie bread', ['warburtons', 'toastie'], 'brand'),
  qa('Brand/live', "Kellogg's corn flakes", ['kellogg', 'corn flakes'], 'brand'),
  qa('Brand/live', 'Weetabix', ['weetabix', 'wheat biscuit'], 'brand'),
  qa('Brand/live', 'Cadbury Dairy Milk', ['cadbury', 'dairy milk'], 'brand'),
  qa('Brand/live', 'KitKat four finger', ['kitkat', 'kit kat'], 'brand'),
  qa('Brand/live', 'Nutella', 'nutella', 'brand'),
  qa('Brand/live', 'Alpro soya milk', ['alpro', 'soya'], 'brand'),
  qa('Brand/live', 'Oatly oat drink', ['oatly', 'oat'], 'brand'),
  qa('Brand/live', 'Quorn mince', ['quorn', 'mince'], 'brand'),
  qa('Brand/live', 'Linda McCartney sausages', ['linda mccartney', 'sausage'], 'brand'),
  qa('Brand/live', 'Huel chocolate', ['huel', 'chocolate'], 'brand'),
  qa('Brand/live', 'Coca Cola Zero', ['coca cola', 'coke zero'], 'brand'),
  qa('Brand/live', 'Lucozade orange', ['lucozade', 'orange'], 'brand'),
  qa('Brand/live', 'Innocent smoothie', ['innocent', 'smoothie'], 'brand'),
  qa('Brand/live', 'Walkers ready salted crisps', ['walkers', 'ready salted'], 'brand'),
  qa('Brand/live', "McVitie's digestive biscuits", ['mcvitie', 'digestive'], 'brand'),
  qa('Brand/live', 'Tesco chicken tikka masala', ['tesco', 'tikka'], 'brand'),
  qa('Brand/live', "Sainsbury's porridge oats", ['sainsbury', 'porridge'], 'brand'),
  qa('Brand/live', 'Aldi protein yoghurt', ['aldi', 'protein yoghurt', 'protein yogurt'], 'brand'),
  qa('Brand/live', 'Lidl Greek yoghurt', ['lidl', 'greek yoghurt', 'greek yogurt'], 'brand'),
  qa('Brand/live', 'Grenade Carb Killa', ['grenade', 'carb killa'], 'brand'),
  qa('Brand/live', 'Nakd cocoa orange', ['nakd', 'cocoa orange'], 'brand'),
  qa('Brand/live', 'Pot Noodle chicken mushroom', ['pot noodle', 'chicken mushroom'], 'brand'),
  qa('Brand/live', "Ben Jerry's cookie dough", ['ben jerry', 'cookie dough'], 'brand'),
];

interface CaseResult {
  category: string;
  query: string;
  kind: QueryKind;
  expectedAny: string[];
  latencyMs: number;
  networkLatencyMs?: number;
  resultCount: number;
  providerCandidateCount?: number;
  providerState?: string;
  providerMessage?: string;
  topName?: string;
  topBrand?: string;
  topProvider?: string;
  topRelevant: boolean;
  relevantWithinFive: boolean;
  usefulTop: boolean;
  carbohydrateComplete: boolean;
  carbohydratePlausible: boolean;
  explicitServing: boolean;
  imageAvailable: boolean;
  exactDuplicateCount: number;
  sameNameVariantCount: number;
  collapsedBarcodeCount: number;
}

function percentile(values: number[], probability: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(probability * sorted.length))]!;
}

function fixed(value: number, digits = 1) {
  return Math.round(value * 10 ** digits) / 10 ** digits;
}

function percentage(count: number, total: number) {
  return total ? fixed((count / total) * 100) : 0;
}

function relevant(food: FoodCandidate | undefined, expectedAny: string[]) {
  if (!food) return false;
  const haystack = normaliseFoodSearchText(`${food.brand ?? ''} ${food.name}`);
  return expectedAny.some((phrase) => {
    const tokens = normaliseFoodSearchText(phrase).split(' ').filter(Boolean);
    return tokens.every((token) => haystack.includes(token));
  });
}

function visibleMeasurement(value: number | undefined) {
  return value === undefined ? null : Math.round(value * 10) / 10;
}

function nutritionFingerprint(food: FoodCandidate) {
  const nutrition = food.nutritionPerBasis;
  return JSON.stringify([
    normaliseFoodSearchText(food.brand ?? ''),
    normaliseFoodSearchText(food.name),
    visibleMeasurement(food.basisAmount),
    food.basisUnit,
    visibleMeasurement(food.defaultServingAmount ?? food.basisAmount),
    food.defaultServingUnit ?? food.basisUnit,
    visibleMeasurement(nutrition.carbohydrateGrams),
    visibleMeasurement(nutrition.energyKcal),
    visibleMeasurement(nutrition.proteinGrams),
    visibleMeasurement(nutrition.fatGrams),
    visibleMeasurement(nutrition.fibreGrams),
    visibleMeasurement(nutrition.sugarsGrams),
    visibleMeasurement(nutrition.saturatedFatGrams),
  ]);
}

function analyse(
  testCase: QaQuery,
  latencyMs: number,
  results: Awaited<ReturnType<ReturnType<typeof createFoodSearchEngine>['search']>>,
  networkLatencyMs?: number,
): CaseResult {
  const visible = results.results;
  const top = visible[0]?.food;
  const topFive = visible.slice(0, 5).map((result) => result.food);
  const carbs = top?.nutritionPerBasis.carbohydrateGrams;
  const carbohydrateComplete = carbs !== undefined;
  const carbohydratePlausible =
    carbs !== undefined && Number.isFinite(carbs) && carbs >= 0 && carbs <= 100;
  const fingerprints = new Set<string>();
  let exactDuplicateCount = 0;
  const nameCounts = new Map<string, number>();
  for (const result of visible) {
    const fingerprint = nutritionFingerprint(result.food);
    if (fingerprints.has(fingerprint)) exactDuplicateCount += 1;
    fingerprints.add(fingerprint);
    const name = normaliseFoodSearchText(
      `${result.food.brand ?? ''} ${result.food.name}`,
    );
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }
  const provider = results.providers.find((item) => item.id === 'open-food-facts');
  const topRelevant = relevant(top, testCase.expectedAny);
  return {
    category: testCase.category,
    query: testCase.query,
    kind: testCase.kind,
    expectedAny: testCase.expectedAny,
    latencyMs: fixed(latencyMs, 2),
    networkLatencyMs:
      networkLatencyMs === undefined ? undefined : fixed(networkLatencyMs, 2),
    resultCount: visible.length,
    providerCandidateCount: provider?.candidateCount,
    providerState: provider?.state,
    providerMessage: provider?.message,
    topName: top?.name,
    topBrand: top?.brand,
    topProvider: top?.provider,
    topRelevant,
    relevantWithinFive: topFive.some((food) => relevant(food, testCase.expectedAny)),
    usefulTop: topRelevant && carbohydratePlausible,
    carbohydrateComplete,
    carbohydratePlausible,
    explicitServing: Boolean(top?.servingLabel),
    imageAvailable: Boolean(top?.imageUrl),
    exactDuplicateCount,
    sameNameVariantCount: [...nameCounts.values()].filter((count) => count > 1)
      .reduce((total, count) => total + count - 1, 0),
    collapsedBarcodeCount:
      visible[0]?.provenance.filter((source) => Boolean(source.barcode)).length ?? 0,
  };
}

function summarize(results: CaseResult[]) {
  const latencies = results.map((result) => result.latencyMs);
  const networkLatencies = results.flatMap((result) =>
    result.networkLatencyMs === undefined ? [] : [result.networkLatencyMs],
  );
  return {
    queries: results.length,
    usefulTopRatePercent: percentage(
      results.filter((result) => result.usefulTop).length,
      results.length,
    ),
    relevantFirstRatePercent: percentage(
      results.filter((result) => result.topRelevant).length,
      results.length,
    ),
    relevantWithinFiveRatePercent: percentage(
      results.filter((result) => result.relevantWithinFive).length,
      results.length,
    ),
    noResultRatePercent: percentage(
      results.filter((result) => result.resultCount === 0).length,
      results.length,
    ),
    carbohydrateCompleteTopPercent: percentage(
      results.filter((result) => result.carbohydrateComplete).length,
      results.length,
    ),
    carbohydratePlausibleTopPercent: percentage(
      results.filter((result) => result.carbohydratePlausible).length,
      results.length,
    ),
    explicitServingTopPercent: percentage(
      results.filter((result) => result.explicitServing).length,
      results.length,
    ),
    imageTopPercent: percentage(
      results.filter((result) => result.imageAvailable).length,
      results.length,
    ),
    visibleExactDuplicates: results.reduce(
      (total, result) => total + result.exactDuplicateCount,
      0,
    ),
    visibleSameNameVariants: results.reduce(
      (total, result) => total + result.sameNameVariantCount,
      0,
    ),
    latencyMs: {
      median: fixed(percentile(latencies, 0.5), 2),
      p95: fixed(percentile(latencies, 0.95), 2),
      maximum: fixed(Math.max(...latencies), 2),
    },
    networkLatencyMs: networkLatencies.length
      ? {
          median: fixed(percentile(networkLatencies, 0.5), 2),
          p95: fixed(percentile(networkLatencies, 0.95), 2),
          maximum: fixed(Math.max(...networkLatencies), 2),
        }
      : undefined,
  };
}

function categoryRows(results: CaseResult[]) {
  const categories = [...new Set(results.map((result) => result.category))];
  return categories.map((category) => {
    const subset = results.filter((result) => result.category === category);
    return {
      category,
      queries: subset.length,
      usefulTop: percentage(subset.filter((result) => result.usefulTop).length, subset.length),
      relevantTop: percentage(subset.filter((result) => result.topRelevant).length, subset.length),
      noResult: percentage(subset.filter((result) => result.resultCount === 0).length, subset.length),
    };
  });
}

function markdownTable(headers: string[], rows: (string | number)[][]) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map((value) => String(value).replace(/\|/g, '\\|')).join(' | ')} |`),
  ].join('\n');
}

function failureRows(results: CaseResult[]) {
  return results
    .filter(
      (result) =>
        !result.usefulTop ||
        result.providerState === 'error' ||
        result.exactDuplicateCount > 0,
    )
    .map((result) => [
      result.category,
      result.query,
      result.resultCount,
      result.topName ?? '—',
      result.topBrand ?? '—',
      result.providerMessage ??
        (result.resultCount === 0
          ? 'No result'
          : !result.topRelevant
            ? 'Top result failed deterministic relevance rule'
            : !result.carbohydrateComplete
              ? 'Top result has no carbohydrate'
              : !result.carbohydratePlausible
                ? 'Top carbohydrate outside 0–100 per basis'
                : 'Duplicate result'),
    ]);
}

function buildReport(payload: {
  generatedAt: string;
  local: CaseResult[];
  live: CaseResult[];
  userAgentObserved: boolean;
}) {
  const localSummary = summarize(payload.local);
  const liveSummary = summarize(payload.live);
  const localCategories = categoryRows(payload.local);
  const liveFailures = failureRows(payload.live);
  const localFailures = failureRows(payload.local);
  return `# T1 Arc food-catalogue QA baseline

Generated: ${payload.generatedAt}

Workspace: \`C:/dmr\`

Dataset under test: bundled McCance and Widdowson CoFID 2021 plus live Open Food Facts UK-filtered submitted search.

## Scope and methodology

- ${payload.local.length} deterministic UK-oriented local text queries across staples, produce, meat/fish, dairy, vegan foods, snacks, drinks, breakfast cereals, ready meals and takeaways.
- Query set includes generic, ambiguous and deliberately misspelled inputs. Local runs use the production CoFID adapter, provider-neutral search engine, deduplication and ranking with \`mode: typeahead\`.
- ${payload.live.length} deliberate live submitted queries use the same engine with CoFID plus the production Open Food Facts adapter, UK country filter, field allow-list, app User-Agent and endpoint-aware queue. The exact identity is \`T1Arc/${appPackage.version} (https://github.com/gregorgregor25/t1-arc/issues)\`; custom User-Agent observed by the instrumented fetch: **${payload.userAgentObserved ? 'yes' : 'no'}**.
- Relevance is reproducible rather than subjective: a result is relevant when normalized name+brand contains every token from at least one query-specific expected phrase. “Useful top” additionally requires a finite carbohydrate value from 0–100 g per 100 g/ml basis.
- Exact duplicates use normalized brand, name, basis, default serving and all normalized nutrients. Same-name variants intentionally count rows with the same normalized name/brand but different serving or nutrition.
- Explicit serving means the source supplied a serving label; a generic 100 g/ml fallback does not count. Image availability requires a source image URL.
- Every percentage uses the full query set as its denominator. A no-result query therefore counts as unavailable for top-result carbohydrate, serving and image measures.
- End-to-end latency includes ranking and, for consecutive live submissions, required public-API queue time. Physical network latency is measured separately around \`fetch\`.

## Headline results

${markdownTable(
  ['Measure', 'CoFID/local', 'Live submitted'],
  [
    ['Queries', localSummary.queries, liveSummary.queries],
    ['Useful top result', `${localSummary.usefulTopRatePercent}%`, `${liveSummary.usefulTopRatePercent}%`],
    ['Relevant result first', `${localSummary.relevantFirstRatePercent}%`, `${liveSummary.relevantFirstRatePercent}%`],
    ['Relevant within top five', `${localSummary.relevantWithinFiveRatePercent}%`, `${liveSummary.relevantWithinFiveRatePercent}%`],
    ['No result', `${localSummary.noResultRatePercent}%`, `${liveSummary.noResultRatePercent}%`],
    ['Top carbohydrate complete', `${localSummary.carbohydrateCompleteTopPercent}%`, `${liveSummary.carbohydrateCompleteTopPercent}%`],
    ['Top carbohydrate plausible', `${localSummary.carbohydratePlausibleTopPercent}%`, `${liveSummary.carbohydratePlausibleTopPercent}%`],
    ['Top explicit serving', `${localSummary.explicitServingTopPercent}%`, `${liveSummary.explicitServingTopPercent}%`],
    ['Top image available', `${localSummary.imageTopPercent}%`, `${liveSummary.imageTopPercent}%`],
    ['Visible exact duplicates', localSummary.visibleExactDuplicates, liveSummary.visibleExactDuplicates],
    ['Visible same-name variants', localSummary.visibleSameNameVariants, liveSummary.visibleSameNameVariants],
    ['Median end-to-end latency', `${localSummary.latencyMs.median} ms`, `${liveSummary.latencyMs.median} ms`],
    ['p95 end-to-end latency', `${localSummary.latencyMs.p95} ms`, `${liveSummary.latencyMs.p95} ms`],
    ['Median physical network latency', 'n/a', `${liveSummary.networkLatencyMs?.median ?? 0} ms`],
    ['p95 physical network latency', 'n/a', `${liveSummary.networkLatencyMs?.p95 ?? 0} ms`],
  ],
)}

## Local results by category

${markdownTable(
  ['Category', 'Queries', 'Useful top', 'Relevant first', 'No result'],
  localCategories.map((row) => [
    row.category,
    row.queries,
    `${row.usefulTop}%`,
    `${row.relevantTop}%`,
    `${row.noResult}%`,
  ]),
)}

## Local failures and weak results

${localFailures.length ? markdownTable(
  ['Category', 'Query', 'Results', 'Top name', 'Top brand', 'Reason'],
  localFailures,
) : 'None under the deterministic rule.'}

## Live failures and weak results

${liveFailures.length ? markdownTable(
  ['Category', 'Query', 'Results', 'Top name', 'Top brand', 'Reason'],
  liveFailures,
) : 'None under the deterministic rule.'}

## Important limitations

- This is a point-in-time search baseline, not the proposed 500–1,000-product paid-provider barcode bake-off.
- No paid catalogue was tested. Open Food Facts is community-maintained and live results can change after this report.
- No EAN was included: this run did not have a sufficiently authoritative manufacturer/retailer packaging source for a defensible barcode ground truth. Barcode adapter correctness remains covered by deterministic unit tests.
- The expected-phrase relevance rule is transparent but cannot judge culinary equivalence, regional naming or whether a different relevant item would be preferred by a person.
- Open Food Facts parsing excludes products without reported carbohydrate, so its carbohydrate-completeness result is conditional on products that survive that safety filter; no-result rate captures some of that loss.
- Open Food Facts' [introduction](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/) currently illustrates an email-only User-Agent, while its [product endpoint reference](https://openfoodfacts.github.io/documentation/docs/Product-Opener/v3/products/get-api-v3-product-code/) explicitly accepts a URL or contact information. T1 Arc uses its public issue tracker because this repository has no configured public support email; supplying a private workstation email or inventing one would be inappropriate.
- Serving-label and image rates describe the top returned result only. CoFID is a per-100 g/ml reference dataset and is not expected to provide packaged serving labels or images.
- Live latency reflects this machine, network and the mandated search queue on ${payload.generatedAt}; it is not an SLA.

## Reproduction

From \`C:/dmr\`:

\`npx vitest run --config scripts/food-catalog-baseline.vitest.config.ts\`

The run rewrites this Markdown report and \`.qa/food-catalog-baseline.json\` with per-query raw measurements.
`;
}

describe('repeatable food catalogue baseline', () => {
  it('measures local and live submitted search', async () => {
    const networkLatencies = new Map<string, number>();
    let activeQuery = '';
    let userAgentObserved = false;
    const instrumentedFetch: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      userAgentObserved ||= headers.get('User-Agent')?.startsWith('T1Arc/') === true;
      const started = performance.now();
      try {
        return await fetch(input, init);
      } finally {
        networkLatencies.set(
          activeQuery,
          (networkLatencies.get(activeQuery) ?? 0) + (performance.now() - started),
        );
      }
    };

    const offRateGate = createOpenFoodFactsRateGate();
    const providers: FoodSearchProvider[] = [
      {
        id: 'cofid',
        label: 'CoFID 2021',
        kind: 'offline',
        supportsTypeahead: true,
        search(query, { limit }) {
          return searchCofidFoods(query, limit);
        },
      },
      {
        id: 'open-food-facts',
        label: 'Open Food Facts',
        kind: 'remote',
        minQueryLength: 3,
        supportsTypeahead: false,
        search(query, { signal }) {
          activeQuery = query;
          return searchOpenFoodFactsProducts(query, instrumentedFetch, {
            signal,
            rateGate: offRateGate,
          });
        },
      },
    ];
    const engine = createFoodSearchEngine({
      loadStoredCandidates: async () => [],
      providers,
      remoteCacheTtlMs: 0,
    });

    const local: CaseResult[] = [];
    for (const testCase of LOCAL_QUERIES) {
      const started = performance.now();
      const response = await engine.search(testCase.query, {
        mode: 'typeahead',
        limit: 40,
      });
      local.push(analyse(testCase, performance.now() - started, response));
    }

    const live: CaseResult[] = [];
    for (const testCase of LIVE_QUERIES) {
      const started = performance.now();
      const response = await engine.search(testCase.query, {
        mode: 'submitted',
        limit: 40,
      });
      live.push(
        analyse(
          testCase,
          performance.now() - started,
          response,
          networkLatencies.get(normaliseFoodSearchText(testCase.query)),
        ),
      );
    }

    const generatedAt = new Date().toISOString();
    const payload = {
      schemaVersion: 1,
      generatedAt,
      methodology: {
        localQueries: LOCAL_QUERIES.length,
        liveQueries: LIVE_QUERIES.length,
        resultLimit: 40,
        liveMode: 'submitted',
        barcodeCases: 0,
        percentageDenominator: 'all-queries',
      },
      userAgentObserved,
      summary: {
        local: summarize(local),
        live: summarize(live),
      },
      local,
      live,
    };
    await mkdir('.qa', { recursive: true });
    await writeFile(
      '.qa/food-catalog-baseline.json',
      `${JSON.stringify(payload, null, 2)}\n`,
      'utf8',
    );
    await writeFile(
      '.qa/food-catalog-baseline.md',
      buildReport({ generatedAt, local, live, userAgentObserved }),
      'utf8',
    );

    expect(local).toHaveLength(120);
    expect(live).toHaveLength(25);
  });
});
