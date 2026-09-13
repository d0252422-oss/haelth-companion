# Photo / nutrition open-data bootstrap — preparation, not validation

Review date:2026-09-14. Scope: source/provenance inventory and conservative offline
import/evaluation contracts. No dataset, image or model was downloaded; no API key,
account, paid resource or remote write was used. No actual food values are seeded.

`PHOTO_MODEL_IMPLEMENTATION = MISSING`
`FOOD_REFERENCE_VALIDATION = NOT_VERIFIED`
`PHOTO_REAL_WORLD_ACCURACY = NOT_VERIFIED`
`NEW_SCORE_VALIDITY = EXPERIMENTAL_UNVALIDATED`

## Existing implementation, not a second engine

- `health_companion_algorithms/nutrition.py`: `FoodReference` carries preparation,
  per100g nutrients, optional serving weight, source and version;
  `NutritionCalculator.reference/item/daily` performs deterministic arithmetic.
  A unique preparation-specific match is required. `MANUAL_CONFIRMED` totals have
  precedence; absent references/weights/nutrients remain missing, not fabricated0.
- `FoodPerception` is a protocol; `FixturePerception` is synthetic. Neither is a
  model, weights, image inference implementation, nor an accuracy measurement.
- `supabase/functions/mobile-health-beta/engine-portable.ts::nutritionDaily` is
  currently the explicit empty-catalog runtime: non-manual-confirmed items lack a
  food reference. Importing a Python catalog alone would not connect the Web/Edge
  path. Any later reference adapter needs targeted cross-runtime fixtures, not a
  rewrite of the already completed engines or changes to frozen health-score-v1.0.

## Primary-source manifest (metadata only)

| ID | Official release/provenance observed | License boundary | Artifact status |
|---|---|---|---|
| TFDA-8543 | Food nutrient dataset; metadata updated2026-08-27, update frequency every3months. Metadata date is NOT a verified file release. | Taiwan Open Government Data License1.0; retain provider/title/version attribution. | snapshot/version/hash NOT_VERIFIED |
| USDA-FDC-FOUNDATION | Official download table Foundation04/2026; analytical-food provenance differs from labels. | CC0 1.0; USDA requests source attribution. | archive/hash NOT_VERIFIED |
| USDA-FDC-OTHER | Branded04/2026; FNDDS10/2024 (2021–2023); SR Legacy04/2018 final. Keep data types distinct. | FDC data CC0 1.0; do not extend that assumption to arbitrary images/software. | archives/hashes NOT_VERIFIED |
| NUTRITION5K | CVPR2021 research dataset; repo archived2026-04-19;5,006 plates from selected California cafeterias, scanning-rig imagery. | Dataset CC BY4.0; code, external models and weights need their own license review. | dataset/splits/repo revision/model NOT_ACQUIRED |
| OPEN-FOOD-FACTS | Continuously edited product/label data. Current API documentationv3.6 is NOT a dataset snapshot version. | database ODbL1.0; individual contents DbCL; images CC BY-SA3.0, with possible additional rights. | dump/product revisions/hashes NOT_VERIFIED |

TFDA supplies per100g/unit-weight fields, preparation descriptions and refuse-rate
metadata; these do not justify an invented raw/cooked yield or edible-weight
factor. Source fields must remain traceable. [Official dataset](https://data.gov.tw/dataset/8543),
[OGD1 license](https://data.gov.tw/license).

FDC separates analytical Foundation data, manufacturer Branded labels, survey FNDDS
and final SR Legacy data. `food_nutrient.amount` is per100g in the nutrient's unit;
`food_portion.gram_weight` is separate. The API requires a key, but reproducible
offline preparation needs no new API account. [Official releases](https://fdc.nal.usda.gov/download-datasets/),
[data types](https://fdc.nal.usda.gov/data-documentation/),
[field definitions](https://fdc.nal.usda.gov/docs/Download_Field_Descriptions_Oct2020.pdf),
[CC0/API guide](https://fdc.nal.usda.gov/api-guide/).

Nutrition5k has ingredient masses, USDA-derived **per-gram** ingredient nutrient
metadata, multi-angle/RGB-D imagery and an official plate-grouped split. It is not
a Taiwan food catalog or proof of single-phone-photo generalization. Its full
archive is181.4GB; do not fetch it as a bootstrap default. Keep incremental scans
of the same plate in one split. No published model result transfers to this app.
[Official repository/data license](https://github.com/google-research-datasets/Nutrition5k),
[linked CC BY4.0](https://creativecommons.org/licenses/by/4.0/).

Open Food Facts labels are contributed data, not equivalent to a laboratory food
analysis. Keep its catalog separate from private health records. Public reuse of a
derived database needs attribution/share-alike review; image rights are separate.
Do not upload user photos to this public service. [Official API/version](https://openfoodfacts.github.io/openfoodfacts-server/api/),
[official license guide](https://openfoodfacts.github.io/openfoodfacts-server/api/tutorials/license-be-on-the-legal-side/),
[ODbL1.0](https://opendatacommons.org/licenses/odbl/1-0/),
[DbCL1.0](https://opendatacommons.org/licenses/dbcl/1-0/),
[image CC BY-SA3.0](https://creativecommons.org/licenses/by-sa/3.0/deed.en).

The official OFF terms page was not readable through the research tool; this
inventory does not claim exhaustive legal clearance. Recheck applicable terms
before publication. No source receives a blanket0-risk or scientific-validity PASS.

## Minimal future acquisition/import contract

The proposed order is TFDA for Taiwan ingredient candidates, a narrow named FDC
subset for documented gaps, OFF only for a separate packaged-label catalog, and
Nutrition5k only for separately scoped research evaluation. This is a proposed
selection policy, not verified coverage, cost or accuracy.

Before any future authorized acquisition, record target dataset/version, exact
primary URL, archive/expanded size and available dedicated disk space; do not
download whole shared catalogs or execute unfamiliar scripts by default. Create a
new dedicated immutable snapshot; never overwrite older evidence. Each imported
reference needs:

- source ID and data type, source record ID, release/retrieval time, raw artifact
  SHA256, row locator, license URL/version, required attribution and adapter version;
- original nutrient name/ID/unit/value, normalized unit, missing reason, preparation
  and raw/cooked state, per100g vs per-serving basis, explicit serving grams;
- original vs edible-weight basis and actual source for any conversion; retain
  source metadata in a catalog sidecar if the existing runtime model lacks fields;
- separate evidence for code, model weights and food data licenses. A README or
  model interface does not establish that model weights exist or can be redistributed.

Use source-stated values only. Convert a serving only with its stated gram weight;
keep raw/cooked foods distinct. A final prepared-food label includes its composition:
do not automatically add cooking oil again. Confirmed user labels remain identified
as user assertions, not authenticated database measurements. Unknown food, weight,
portion or nutrient stays null/INSUFFICIENT_DATA as appropriate, while known subtotal
can be separate. Do not silently use0 for missing or fabricate food values,
personal targets, cooking multipliers, error percentages or95% confidence intervals.

## Non-device preparation vs validation gates

### Food identity / Taiwan alias sidecar contract

`canonical_food_id` must be stable and preparation-specific, derived from a retained
source namespace + source record ID + explicit preparation revision (not a translated
display name). Preserve the original source IDs even when a later reviewed crosswalk
links two catalogs. A name match alone never merges raw/cooked/brand-specific foods.

The future normalization sidecar carries `original_name`, Unicode-normalized display
name, language, Taiwan alias, canonical_food_id, preparation, source locator, version
and review status. Alias candidates are `UNVERIFIED` until a source row and reviewer
establish equivalence; regional homonyms and brand/recipe variants remain separate.
No Taiwan aliases or serving sizes have been invented/seeded in this preparation.

Portions retain `mass_g` only if supplied/measured, `basis` (edible/raw/cooked/as-served),
and provenance. A source-provided range carries its literal endpoints and method;
otherwise `lower_g/upper_g=null`, `uncertainty=UNKNOWN`, never a fabricated percent or
95% interval. Image perception candidates reference this catalog interface but are
not allowed to supply authoritative nutrient values. Actual snapshot/import/parity
and photo inference remain separate unfinished gates.

1. **Preparation:** source manifest, importer field/unit contract and synthetic
   fixtures. Values must be named synthetic and test arithmetic only. No real-data
   or model PASS follows from these checks.
2. **Reference-data validation:** acquire an explicitly scoped snapshot later,
   inspect source rows, units, missing markers, preparation/portion mapping and
   licensing, then verify a traceable sample against the original source. Record
   rejections and actual coverage; dataset presence alone is not a PASS.
3. **Runtime integration:** only after catalog decisions, reuse the existing
   calculator and add the smallest target-runtime reference adapter. Differential
   tests must compare identical reference/meal fixtures, nulls, units, rounding,
   completeness and versions without changing golden expectations or tolerances.
4. **Photo implementation:** separately select and verify actual model/code/weights,
   preprocessing, inference path, resource limits and licenses. Keep feature OFF
   while missing; candidate food/portion outputs do not become nutrient authority.
5. **Photo/reference/real-world validation:** predeclare split/grouping, population,
   capture conditions, metrics and acceptance conditions before evaluation; report
   observed errors only. Nutrition5k research performance does not establish Taiwan
   accuracy, personal advice validity or production safety.

These are retained gates, not additional progress-weight items. No model, food
reference validity, iOS device, remote Beta or production gate is promoted here.
