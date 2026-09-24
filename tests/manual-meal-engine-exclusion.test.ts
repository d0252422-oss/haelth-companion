import assert from "node:assert/strict";
import { LocalEngineRuntime, manualMealEngineRecords } from "../supabase/functions/mobile-health-beta/local-engine-runtime.ts";

const user = "a1b2c3d4-e5f6-4789-8abc-def012345678";
const day = "2026-09-20";

function meal(id: string, includedInTotals: boolean, calories: number) {
  return {
    body: {
      userConfirmed: true,
      includedInTotals,
      calories,
      protein: 20,
      carbs: 40,
      fat: 10,
    },
    canonical_record: {
      subject_ref: user,
      source: "web-confirmed",
      record_id: id,
      domain: "nutrition",
      revision: 1,
      recorded_at: `${day}T12:00:00+08:00`,
      updated_at: `${day}T12:01:00+08:00`,
      source_quality: "UNKNOWN",
      deleted: false,
      payload: {
        meal_id: id,
        meal: "午餐",
        meal_time: `${day}T12:00:00+08:00`,
        confirmed: true,
        food_items: [{
          item_id: id,
          raw_name: id,
          source: "MANUAL_CONFIRMED",
          nutrients: { calories, protein_g: 20, carbs_g: 40, fat_g: 10, fiber_g: null, sodium_mg: null },
        }],
      },
    },
  };
}

function fakeSql(meals: ReturnType<typeof meal>[]) {
  const sql: any = (strings: TemplateStringsArray) => {
    const query = strings.join("?");
    if (query.includes("from public.engine_meals")) {
      assert.match(query, /select body,canonical_record/);
      return Promise.resolve(meals);
    }
    return Promise.resolve([]);
  };
  sql.begin = async (...args: any[]) => await args.at(-1)(sql);
  return sql;
}

async function compute(meals: ReturnType<typeof meal>[]) {
  const sql = fakeSql(meals);
  const runtime = new LocalEngineRuntime({}, async () => ({}), async () => ({ subject: "test", email: "" }), {
    kind: "hosted",
    sql,
    release: "A",
  });
  return await runtime.compute(user, day);
}

function withoutCalculationTime(value: unknown) {
  return JSON.parse(JSON.stringify(value, (key, item) => key === "calculated_at" ? undefined : item));
}

Deno.test("explicitly excluded complete meals never enter nutrition or overall engine inputs", async () => {
  const included = meal("included", true, 500);
  const excluded = meal("excluded", false, 900);
  assert.deepEqual(manualMealEngineRecords([included, excluded]), manualMealEngineRecords([included]));

  const includedOnly = await compute([included]);
  const withExcluded = await compute([included, excluded]);
  assert.deepEqual(withoutCalculationTime(withExcluded), withoutCalculationTime(includedOnly));
  assert.equal(withExcluded.outputs.nutrition.metrics.meal_count, 1);
});
