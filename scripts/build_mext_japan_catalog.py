#!/usr/bin/env python3
"""Build T1 Arc's compact offline MEXT Japan food catalogue.

Input is the official Standard Tables of Food Composition in Japan (Eighth
Revised Edition), 2023 supplement workbook. The parser intentionally uses only
Python's standard library so the checked-in JSON is reproducible without
installing spreadsheet packages.
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
DOC_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
NS = {"m": MAIN_NS, "r": DOC_NS, "p": PKG_NS}
CELL_COLUMN = re.compile(r"[A-Z]+")
LEADING_GROUP = re.compile(r"^[＜<][^＞>]+[＞>]\s*")


def shared_text(element: ElementTree.Element) -> str:
    return "".join(node.text or "" for node in element.iter(f"{{{MAIN_NS}}}t"))


def column(reference: str) -> str:
    match = CELL_COLUMN.match(reference)
    if not match:
        raise ValueError(f"Invalid spreadsheet cell reference: {reference}")
    return match.group(0)


def workbook_sheet_path(archive: zipfile.ZipFile, name: str) -> str:
    workbook = ElementTree.fromstring(archive.read("xl/workbook.xml"))
    relationships = ElementTree.fromstring(
        archive.read("xl/_rels/workbook.xml.rels")
    )
    targets = {
        item.attrib["Id"]: item.attrib["Target"]
        for item in relationships.findall("p:Relationship", NS)
    }
    for sheet in workbook.findall("m:sheets/m:sheet", NS):
        if sheet.attrib.get("name") != name:
            continue
        relationship_id = sheet.attrib[f"{{{DOC_NS}}}id"]
        target = targets[relationship_id].replace("\\", "/")
        return target.lstrip("/") if target.startswith("xl/") else f"xl/{target.lstrip('/')}"
    raise ValueError(f"Workbook has no sheet named {name!r}")


def cell_rows(
    archive: zipfile.ZipFile, sheet_path: str, shared: list[str]
) -> list[dict[str, str]]:
    sheet = ElementTree.fromstring(archive.read(sheet_path))
    rows: list[dict[str, str]] = []
    for row in sheet.findall(".//m:sheetData/m:row", NS):
        values: dict[str, str] = {}
        for cell in row.findall("m:c", NS):
            cell_type = cell.attrib.get("t")
            if cell_type == "inlineStr":
                inline = cell.find("m:is", NS)
                value = "" if inline is None else shared_text(inline)
            else:
                value_node = cell.find("m:v", NS)
                value = "" if value_node is None else value_node.text or ""
                if cell_type == "s" and value:
                    value = shared[int(value)]
            values[column(cell.attrib["r"])] = value.strip()
        rows.append(values)
    return rows


def nutrient(raw: str) -> tuple[float | None, str]:
    value = raw.strip().replace("（", "(").replace("）", ")")
    value = value.strip("() ")
    if not value or value in {"-", "*", "…", "..."}:
        return None, "missing"
    if value.casefold() == "tr":
        return 0.0, "trace"
    try:
        return round(float(value), 4), "reported"
    except ValueError:
        return None, "missing"


def clean_name(raw: str) -> str:
    return re.sub(r"[\s\u3000]+", " ", LEADING_GROUP.sub("", raw)).strip()


def build_catalog(source: Path) -> dict[str, object]:
    with zipfile.ZipFile(source) as archive:
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            shared_root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
            shared = [shared_text(item) for item in shared_root]
        rows = cell_rows(archive, workbook_sheet_path(archive, "表全体"), shared)

    foods: list[dict[str, object]] = []
    for row in rows:
        group = row.get("A", "")
        code = row.get("B", "")
        raw_name = row.get("D", "")
        if not re.fullmatch(r"\d{2}", group) or not re.fullmatch(r"\d{5}", code):
            continue
        name = clean_name(raw_name)
        if not name:
            continue

        energy, energy_quality = nutrient(row.get("G", ""))
        protein, protein_quality = nutrient(row.get("J", ""))
        fat, fat_quality = nutrient(row.get("M", ""))
        carbs, carbs_quality = nutrient(row.get("P", ""))
        if carbs is None:
            carbs, carbs_quality = nutrient(row.get("Q", ""))
        fibre, fibre_quality = nutrient(row.get("S", ""))

        foods.append(
            {
                "id": f"mext-jp:{code}",
                "code": code,
                "name": name,
                "searchName": clean_name(raw_name),
                "group": group,
                "carbs": carbs,
                "energyKcal": energy,
                "protein": protein,
                "fat": fat,
                "fibre": fibre,
                "quality": {
                    "carbs": carbs_quality,
                    "energyKcal": energy_quality,
                    "protein": protein_quality,
                    "fat": fat_quality,
                    "fibre": fibre_quality,
                },
            }
        )

    foods.sort(key=lambda food: (str(food["name"]), str(food["code"])))
    return {
        "schemaVersion": 1,
        "dataset": "日本食品標準成分表（八訂）増補2023年",
        "datasetEnglish": (
            "Standard Tables of Food Composition in Japan 2023 "
            "(Eighth Revised Edition supplement)"
        ),
        "sourceUrl": "https://www.mext.go.jp/a_menu/syokuhinseibun/mext_00001.html",
        "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "licence": "MEXT reuse permitted with source attribution",
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
