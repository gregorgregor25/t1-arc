#!/usr/bin/env python3
"""Build T1 Arc's compact offline US food reference catalogue.

Inputs are the official FoodData Central Foundation Foods and FNDDS JSON zip
downloads. Only the nutrients and portion fields used by T1 Arc are retained,
so normal US food search does not need an API key or network request.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import zipfile
from pathlib import Path
from typing import Any

FOUNDATION_URL = (
    "https://fdc.nal.usda.gov/fdc-datasets/"
    "FoodData_Central_foundation_food_json_2026-04-30.zip"
)
FNDDS_URL = (
    "https://fdc.nal.usda.gov/fdc-datasets/"
    "FoodData_Central_survey_food_json_2024-10-31.zip"
)

NUTRIENT_IDS = {
    "carbs": 1005,
    "energyKcal": 1008,
    "energyKilojoules": 1062,
    "protein": 1003,
    "fat": 1004,
    "fibre": 1079,
    "sugars": 2000,
    "saturatedFat": 1258,
}


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def official_json(source: Path, root_key: str) -> tuple[list[Any], str]:
    with zipfile.ZipFile(source) as archive:
        members = [name for name in archive.namelist() if name.lower().endswith(".json")]
        if len(members) != 1:
            raise ValueError(
                f"Expected exactly one JSON file in {source}; found {len(members)}"
            )
        payload = archive.read(members[0])
    parsed = json.loads(payload)
    foods = parsed.get(root_key)
    if not isinstance(foods, list):
        raise ValueError(f"{source} has no {root_key} array")
    return foods, sha256(payload)


def number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(parsed) or parsed < 0:
        return None
    return round(parsed, 4)


def nutrient_values(food: dict[str, Any]) -> dict[int, float]:
    values: dict[int, float] = {}
    for item in food.get("foodNutrients") or []:
        if not isinstance(item, dict):
            continue
        nutrient = item.get("nutrient")
        identifier = (
            nutrient.get("id") if isinstance(nutrient, dict) else item.get("nutrientId")
        )
        try:
            nutrient_id = int(identifier)
        except (TypeError, ValueError):
            continue
        value = number(item.get("amount", item.get("value")))
        if value is not None and nutrient_id not in values:
            values[nutrient_id] = value
    return values


def category(food: dict[str, Any]) -> str | None:
    survey = food.get("wweiaFoodCategory")
    if isinstance(survey, dict):
        value = survey.get("wweiaFoodCategoryDescription")
        if isinstance(value, str) and value.strip():
            return " ".join(value.split())
    foundation = food.get("foodCategory")
    if isinstance(foundation, dict):
        value = foundation.get("description")
        if isinstance(value, str) and value.strip():
            return " ".join(value.split())
    return None


def portion(food: dict[str, Any], include: bool) -> tuple[float | None, str | None]:
    if not include:
        return None, None
    candidates: list[tuple[int, float, str]] = []
    for item in food.get("foodPortions") or []:
        if not isinstance(item, dict):
            continue
        grams = number(item.get("gramWeight"))
        label = item.get("portionDescription")
        if grams is None or grams <= 0 or not isinstance(label, str) or not label.strip():
            continue
        sequence = item.get("sequenceNumber")
        order = int(sequence) if isinstance(sequence, (int, float)) else 9999
        candidates.append((order, grams, " ".join(label.split())))
    if not candidates:
        return None, None
    _, grams, label = min(candidates, key=lambda item: (item[0], item[1], item[2]))
    return grams, label


def compact_food(food: Any, data_type: str) -> dict[str, Any] | None:
    if not isinstance(food, dict):
        return None
    fdc_id = food.get("fdcId")
    description = food.get("description")
    if not isinstance(fdc_id, int) or not isinstance(description, str):
        return None
    name = " ".join(description.split())
    if not name:
        return None

    nutrients = nutrient_values(food)
    carbs = nutrients.get(NUTRIENT_IDS["carbs"])
    if carbs is None:
        return None
    energy = nutrients.get(NUTRIENT_IDS["energyKcal"])
    if energy is None:
        energy_kj = nutrients.get(NUTRIENT_IDS["energyKilojoules"])
        energy = None if energy_kj is None else round(energy_kj / 4.184, 4)
    serving_grams, serving_label = portion(food, data_type == "fndds")

    return {
        "fdcId": fdc_id,
        "name": name,
        "category": category(food),
        "dataType": data_type,
        "carbs": carbs,
        "energyKcal": energy,
        "protein": nutrients.get(NUTRIENT_IDS["protein"]),
        "fat": nutrients.get(NUTRIENT_IDS["fat"]),
        "fibre": nutrients.get(NUTRIENT_IDS["fibre"]),
        "sugars": nutrients.get(NUTRIENT_IDS["sugars"]),
        "saturatedFat": nutrients.get(NUTRIENT_IDS["saturatedFat"]),
        "servingGrams": serving_grams,
        "servingLabel": serving_label,
    }


def build_catalog(foundation_source: Path, fndds_source: Path) -> dict[str, Any]:
    foundation, foundation_json_hash = official_json(
        foundation_source, "FoundationFoods"
    )
    fndds, fndds_json_hash = official_json(fndds_source, "SurveyFoods")
    foods = [
        compact
        for compact in (
            *[compact_food(food, "foundation") for food in foundation],
            *[compact_food(food, "fndds") for food in fndds],
        )
        if compact is not None
    ]
    foods.sort(key=lambda food: (str(food["name"]).casefold(), food["fdcId"]))
    return {
        "schemaVersion": 1,
        "dataset": "USDA FoodData Central",
        "datasetDetail": "Foundation Foods 04/2026 and FNDDS 2021-2023",
        "sourceUrl": "https://fdc.nal.usda.gov/download-datasets/",
        "licence": "CC0 1.0 Universal / US public domain",
        "nutrientBasis": 100,
        "sources": [
            {
                "dataType": "Foundation Foods",
                "release": "2026-04-30",
                "url": FOUNDATION_URL,
                "archiveSha256": sha256(foundation_source.read_bytes()),
                "jsonSha256": foundation_json_hash,
                "sourceRecordCount": len(foundation),
            },
            {
                "dataType": "FNDDS",
                "release": "2024-10-31",
                "url": FNDDS_URL,
                "archiveSha256": sha256(fndds_source.read_bytes()),
                "jsonSha256": fndds_json_hash,
                "sourceRecordCount": len(fndds),
            },
        ],
        "foods": foods,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("foundation_source", type=Path)
    parser.add_argument("fndds_source", type=Path)
    parser.add_argument("output", type=Path)
    arguments = parser.parse_args()

    catalog = build_catalog(arguments.foundation_source, arguments.fndds_source)
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(
        json.dumps(catalog, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(
        f"Wrote {len(catalog['foods'])} foods to {arguments.output} "
        f"({arguments.output.stat().st_size:,} bytes)"
    )


if __name__ == "__main__":
    main()
