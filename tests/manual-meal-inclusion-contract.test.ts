import assert from "node:assert/strict";
import { LocalEngineRuntime, preservedManualMealExclusion } from "../supabase/functions/mobile-health-beta/local-engine-runtime.ts";

Deno.test("editing a complete explicitly excluded meal preserves its exclusion", () => {
  assert.equal(preservedManualMealExclusion({
    userConfirmed: true,
    includedInTotals: false,
    calories: 500,
    protein: 20,
    carbs: 50,
    fat: 10,
  }), false);
});

Deno.test("incomplete and newly completed meals still follow current confirmation", () => {
  assert.equal(preservedManualMealExclusion({
    userConfirmed: true,
    includedInTotals: false,
    calories: null,
    protein: 20,
    carbs: 50,
    fat: 10,
  }), undefined);
  assert.equal(preservedManualMealExclusion({}), undefined);
});

Deno.test("meal mutation keeps an excluded complete record excluded", async () => {
  const canonical = "20000000-0000-4000-8000-000000000002";
  const mealId = "30000000-0000-4000-8000-000000000003";
  const savedBodies: Record<string, unknown>[] = [];
  const old = {
    canonical_user_id: canonical,
    meal_id: mealId,
    revision: 1,
    local_date: "2026-09-20",
    deleted: false,
    body: {
      mealRecordId: mealId,
      date: "2026-09-20",
      time: "12:00",
      mealType: "午餐",
      foodName: "排除餐點",
      userConfirmed: true,
      includedInTotals: false,
      calories: 500,
      protein: 20,
      carbs: 50,
      fat: 10,
    },
  };
  const sql: any = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");
    if (query.includes("from private.engine_mutation_receipts")) return Promise.resolve([]);
    if (query.includes("from public.engine_meals")) return Promise.resolve([old]);
    if (query.includes("insert into public.engine_meals")) savedBodies.push(values[5] as Record<string, unknown>);
    return Promise.resolve([]);
  };
  sql.json = (value: unknown) => value;
  sql.begin = async (callback: (tx: any) => Promise<unknown>) => await callback(sql);
  const runtime = new LocalEngineRuntime({}, async () => ({}), async () => ({ subject: "", email: "" }), {
    kind: "hosted",
    sql,
    release: "A",
  });
  const result = await runtime.mutate({ kind: "native", canonical }, {
    clientRequestId: "40000000-0000-4000-8000-000000000004",
    mealRecordId: mealId,
    revision: 1,
    date: "2026-09-20",
    time: "12:30",
    mealType: "午餐",
    foodName: "排除餐點（已編輯）",
    userConfirmed: true,
    calories: 500,
    protein: 20,
    carbs: 50,
    fat: 10,
  });
  assert.equal(result.record.includedInTotals, false);
  assert.equal(savedBodies[0]?.includedInTotals, false);
});
