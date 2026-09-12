"""Deterministic food-reference arithmetic; photo guesses never supply nutrients."""

from __future__ import annotations

from collections import defaultdict
from datetime import date
from typing import Any, Protocol
from zoneinfo import ZoneInfo

from pydantic import AwareDatetime, Field, model_validator

from .domain_contracts import Contract, Quality

NUTRIENTS = ("calories", "protein_g", "carbs_g", "fat_g", "fiber_g", "sodium_mg")


class Estimate(Contract):
    estimated_min: float = Field(ge=0)
    estimated_value: float = Field(ge=0)
    estimated_max: float = Field(ge=0)

    @model_validator(mode="after")
    def ordered(self) -> Estimate:
        if not self.estimated_min <= self.estimated_value <= self.estimated_max:
            raise ValueError("estimate must satisfy min <= value <= max")
        return self


class Nutrients(Contract):
    calories: float | None = Field(default=None, ge=0)
    protein_g: float | None = Field(default=None, ge=0)
    carbs_g: float | None = Field(default=None, ge=0)
    fat_g: float | None = Field(default=None, ge=0)
    fiber_g: float | None = Field(default=None, ge=0)
    sodium_mg: float | None = Field(default=None, ge=0)


class FoodReference(Contract):
    food_id: str
    name: str
    preparation_method: str
    nutrients_per_100g: Nutrients
    nutrient_ranges: dict[str, Estimate] = Field(default_factory=dict)
    serving_weight_g: float | None = Field(default=None, gt=0)
    aliases: tuple[str, ...] = ()
    source: str = Field(min_length=1)
    reference_version: str = Field(min_length=1)
    quality: Quality = Quality.UNKNOWN

    @model_validator(mode="after")
    def known_nutrients(self) -> FoodReference:
        if set(self.nutrient_ranges) - set(NUTRIENTS):
            raise ValueError("unknown nutrient range unit")
        return self


class FoodItem(Contract):
    item_id: str = Field(min_length=1)
    raw_name: str
    normalized_food_id: str | None = None
    normalized_food_name: str | None = None
    portion_value: float | None = Field(default=None, ge=0)
    portion_unit: str | None = None
    estimated_weight_g: float | None = Field(default=None, ge=0)
    preparation_method: str = "unknown"
    nutrients: Nutrients = Field(default_factory=Nutrients)
    micronutrients: dict[str, float | None] = Field(default_factory=dict)
    source: str = "MANUAL"
    confidence: Quality = Quality.UNKNOWN
    estimation_range: Estimate | None = None  # grams, never nutrient guesses

    @model_validator(mode="after")
    def valid_micronutrients(self) -> FoodItem:
        if any(v is not None and (not 0 <= v < float("inf")) for v in self.micronutrients.values()):
            raise ValueError("invalid micronutrient")
        return self


class Meal(Contract):
    meal_id: str
    meal: str
    meal_time: AwareDatetime
    food_items: tuple[FoodItem, ...]
    confirmed: bool = False

    @model_validator(mode="after")
    def unique_items(self) -> Meal:
        ids = [item.item_id for item in self.food_items]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate item identity in meal")
        return self


class PerceivedFood(Contract):
    candidate_food: str
    confidence: Quality = Quality.UNKNOWN
    portion_estimate: Estimate | None = None
    bounding_metadata: dict[str, Any] = Field(default_factory=dict)
    uncertainty: tuple[str, ...] = ()


class FoodPerception(Protocol):
    def perceive(self, photo: bytes) -> tuple[PerceivedFood, ...]: ...


class FixturePerception:
    """Explicit synthetic adapter: no model or image accuracy claim."""

    status = "PREPARED_NOT_PRODUCTION_VALIDATED"

    def __init__(self, fixtures: dict[bytes, tuple[PerceivedFood, ...]]) -> None:
        self.fixtures = fixtures

    def perceive(self, photo: bytes) -> tuple[PerceivedFood, ...]:
        return self.fixtures.get(photo, ())


class NutritionCalculator:
    def __init__(self, references: tuple[FoodReference, ...] = ()) -> None:
        self.references = references

    def reference(self, item: FoodItem) -> FoodReference | None:
        candidates = [
            ref
            for ref in self.references
            if ref.preparation_method == item.preparation_method
            and (
                ref.food_id == item.normalized_food_id
                if item.normalized_food_id
                else item.raw_name.casefold()
                in {ref.name.casefold(), *(alias.casefold() for alias in ref.aliases)}
            )
        ]
        return candidates[0] if len(candidates) == 1 else None

    def item(self, item: FoodItem) -> dict[str, Any]:
        ref = self.reference(item)
        missing: list[str] = []
        ranges: dict[str, Any] = {}
        values: dict[str, float | None] = dict.fromkeys(NUTRIENTS)
        if item.source == "MANUAL_CONFIRMED":
            values.update(item.nutrients.model_dump())
            missing = [name for name, value in values.items() if value is None]
            return {
                "values": values,
                "ranges": ranges,
                "missing": missing,
                "reference": "MANUAL_CONFIRMED",
                "quality": item.confidence.value,
            }
        if ref is None:
            return {
                "values": values,
                "ranges": {},
                "missing": ["food_reference"],
                "reference": None,
                "quality": "UNKNOWN",
            }
        weight = item.estimated_weight_g
        if weight is None and item.portion_value is not None:
            units = {"g": 1.0, "kg": 1000.0, "mg": 0.001, "serving": ref.serving_weight_g}
            factor = units.get(item.portion_unit or "")
            if factor is not None:
                weight = item.portion_value * factor
        estimate = item.estimation_range
        if estimate is None and weight is not None:
            estimate = Estimate(estimated_min=weight, estimated_value=weight, estimated_max=weight)
        if estimate is None:
            missing.append("portion")
        else:
            for nutrient in NUTRIENTS:
                value = getattr(ref.nutrients_per_100g, nutrient)
                if value is None:
                    missing.append(nutrient)
                    continue
                ref_range = ref.nutrient_ranges.get(nutrient)
                lower = ref_range.estimated_min if ref_range else value
                upper = ref_range.estimated_max if ref_range else value
                center = ref_range.estimated_value if ref_range else value
                values[nutrient] = round(center * estimate.estimated_value / 100, 1)
                ranges[nutrient] = {
                    "estimated_min": round(lower * estimate.estimated_min / 100, 1),
                    "estimated_value": values[nutrient],
                    "estimated_max": round(upper * estimate.estimated_max / 100, 1),
                }
        quality = ref.quality.value
        if item.confidence in (Quality.LOW, Quality.UNKNOWN):
            quality = item.confidence.value
        if any(value["estimated_min"] != value["estimated_max"] for value in ranges.values()):
            quality = "LOW"
        return {
            "values": values,
            "ranges": ranges,
            "missing": missing,
            "reference": f"{ref.food_id}:{ref.reference_version}",
            "quality": quality,
        }

    def daily(self, meals: tuple[Meal, ...], day: date, timezone: str) -> dict[str, Any]:
        selected = [
            m
            for m in meals
            if m.confirmed and m.meal_time.astimezone(ZoneInfo(timezone)).date() == day
        ]
        ids = [meal.meal_id for meal in selected]
        if len(ids) != len(set(ids)):
            raise ValueError("meal replay must be reconciled before calculation")
        items = [self.item(item) for meal in selected for item in meal.food_items]
        totals: dict[str, float | None] = {}
        known: dict[str, float | None] = {}
        ranges: dict[str, Any] = {}
        for key in NUTRIENTS:
            observed = [item["values"][key] for item in items if item["values"][key] is not None]
            known[key] = round(sum(observed), 1) if observed else None
            totals[key] = known[key] if items and len(observed) == len(items) else None
            if totals[key] is not None:
                ranges[key] = {
                    name: round(
                        sum(
                            item["ranges"].get(key, {}).get(name, item["values"][key])
                            for item in items
                        ),
                        1,
                    )
                    for name in ("estimated_min", "estimated_value", "estimated_max")
                }
        energy = sum(
            (totals.get(k) or 0) * f for k, f in (("protein_g", 4), ("carbs_g", 4), ("fat_g", 9))
        )
        ratios = None
        if all(totals[k] is not None for k in ("protein_g", "carbs_g", "fat_g")) and energy:
            ratios = {
                k: round(float(totals[k] or 0) * f / energy, 4)
                for k, f in (("protein_g", 4), ("carbs_g", 4), ("fat_g", 9))
            }
        distribution: dict[str, int] = defaultdict(int)
        for meal in selected:
            distribution[meal.meal] += 1
        return {
            "totals": totals,
            "known_subtotals": known,
            "ranges": ranges,
            "macro_ratio": ratios,
            "meal_distribution": dict(sorted(distribution.items())),
            "meal_count": len(selected) if selected else None,
            "data_completeness": sum(v is not None for v in totals.values()) / len(NUTRIENTS),
            "missing_inputs": sorted({x for item in items for x in item["missing"]}),
            "references": sorted({item["reference"] for item in items if item["reference"]}),
            "source_quality": "LOW"
            if any(i["quality"] == "LOW" for i in items)
            else "UNKNOWN"
            if not items or any(i["quality"] == "UNKNOWN" for i in items)
            else "MEDIUM",
        }
