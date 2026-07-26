#!/usr/bin/env python3
"""Build the compact, offline CoFID food catalogue used by the app.

The input is the official CoFID 2021 XLSX workbook from GOV.UK. This script
uses only Python's standard library so the generated catalogue is reproducible
without installing spreadsheet packages.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree

MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS = {"m": MAIN_NS}
CELL_COLUMN = re.compile(r"[A-Z]+")


def shared_text(element: ElementTree.Element) -> str:
    return "".join(
        node.text or "" for node in element.iter(f"{{{MAIN_NS}}}t")
    )


def column(reference: str) -> str:
    match = CELL_COLUMN.match(reference)
    if not match:
        raise ValueError(f"Invalid spreadsheet cell reference: {reference}")
    return match.group(0)


def cell_rows(
    archive: zipfile.ZipFile, sheet_path: str, shared: list[str]
) -> list[dict[str, str]]:
    sheet = ElementTree.fromstring(archive.read(sheet_path))
    rows: list[dict[str, str]] = []
    for row in sheet.findall(".//m:sheetData/m:row", NS):
        values: dict[str, str] = {}
        for cell in row.findall("m:c", NS):
            value_node = cell.find("m:v", NS)
            value = "" if value_node is None else value_node.text or ""
            if cell.attrib.get("t") == "s" and value:
                value = shared[int(value)]
            values[column(cell.attrib["r"])] = value.strip()
        rows.append(values)
    return rows


def nutrient(raw: str) -> tuple[float | None, str]:
    value = raw.strip()
    if not value or value.upper() == "N":
        return None, "missing"
    if value.lower() == "tr":
        return 0.0, "trace"
    try:
        return round(float(value), 4), "reported"
    except ValueError:
        return None, "missing"


def build_catalog(source: Path) -> dict[str, object]:
    with zipfile.ZipFile(source) as archive:
        shared_root = ElementTree.fromstring(
            archive.read("xl/sharedStrings.xml")
        )
        shared = [shared_text(item) for item in shared_root]
        rows = cell_rows(
            archive, "xl/worksheets/sheet4.xml", shared
        )

    foods: list[dict[str, object]] = []
    for row in rows[3:]:
        code = row.get("A", "")
        name = row.get("B", "")
        if not code or not name:
            continue

        carbs, carbs_quality = nutrient(row.get("L", ""))
        energy, energy_quality = nutrient(row.get("M", ""))
        protein, protein_quality = nutrient(row.get("J", ""))
        fat, fat_quality = nutrient(row.get("K", ""))
        sugars, sugars_quality = nutrient(row.get("Q", ""))
        aoac_fibre, aoac_quality = nutrient(row.get("Z", ""))
        nsp_fibre, nsp_quality = nutrient(row.get("Y", ""))
        saturated_fat, saturated_quality = nutrient(row.get("AB", ""))

        fibre = aoac_fibre if aoac_fibre is not None else nsp_fibre
        fibre_quality = (
            aoac_quality if aoac_fibre is not None else nsp_quality
        )
        fibre_method = "AOAC" if aoac_fibre is not None else "NSP"
        group = row.get("D", "")

        foods.append(
            {
                "id": f"cofid:{code}",
                "code": code,
                "name": name,
                "group": group,
                "basisUnit": "ml" if group.startswith("Q") else "g",
                "carbs": carbs,
                "energyKcal": energy,
                "protein": protein,
                "fat": fat,
                "fibre": fibre,
                "sugars": sugars,
                "saturatedFat": saturated_fat,
                "quality": {
                    "carbs": carbs_quality,
                    "energyKcal": energy_quality,
                    "protein": protein_quality,
                    "fat": fat_quality,
                    "fibre": fibre_quality,
                    "sugars": sugars_quality,
                    "saturatedFat": saturated_quality,
                },
                "fibreMethod": fibre_method,
            }
        )

    foods.sort(key=lambda food: (str(food["name"]).casefold(), food["code"]))
    return {
        "schemaVersion": 1,
        "dataset": "McCance and Widdowson's CoFID 2021",
        "sourceUrl": (
            "https://www.gov.uk/government/publications/"
            "composition-of-foods-integrated-dataset-cofid"
        ),
        "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "licence": "Open Government Licence v3.0",
        "nutrientBasis": 100,
        "foods": foods,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    arguments = parser.parse_args()

    catalog = build_catalog(arguments.source)
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
