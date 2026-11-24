"""Immutable catalog snapshots and imports pinned to a specific version."""
import csv
import hashlib
import json
from datetime import datetime
from decimal import Decimal
from io import StringIO
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert

from backend.accounts import Database, SignedIn, require_browser_header
from backend.nbs import refresh
from backend.series import catalog_versions, import_csv

router = APIRouter(prefix="/api/v1/catalog", tags=["catalog"])
Topic = Literal["gdp", "retail", "cpi"]
SEEDS = {"gdp": "china-national-accounts", "retail": "china-online-retail", "cpi": "china-monthly-cpi"}
VIEWS = {
    "china-gdp": ("gdp", ("gdp",)),
    "china-industries": ("gdp", ("primary", "secondary", "tertiary", "gdp")),
    "china-info-services": ("gdp", ("info_services", "tertiary", "gdp")),
    "china-online-retail": ("retail", ("online_ytd", "retail_ytd", "online_share_ytd", "online_qtr", "retail_qtr", "online_share_qtr")),
    "china-monthly-cpi": ("cpi", ("cpi_index", "cpi_yoy", "cpi_mom", "core_index", "core_yoy", "core_mom")),
}


def save_version(connection, topic, releases):
    payload = json.dumps(releases, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    checksum = hashlib.sha256(payload.encode()).hexdigest()
    return connection.execute(insert(catalog_versions).values(topic=topic, checksum=checksum, releases=releases)
                              .on_conflict_do_nothing(index_elements=["topic", "checksum"])
                              .returning(catalog_versions.c.id)).scalar_one_or_none()


def latest(connection, topic):
    return connection.execute(select(catalog_versions).where(catalog_versions.c.topic == topic)
                              .order_by(catalog_versions.c.id.desc()).limit(1)).mappings().first()


def current(engine, topic):
    with engine.begin() as connection:
        version = latest(connection, topic)
        if version:
            return version
        path = Path(__file__).resolve().parents[1] / "frontend" / "src" / "catalog" / (SEEDS[topic] + ".json")
        save_version(connection, topic, json.loads(path.read_text(encoding="utf-8-sig")))
        return latest(connection, topic)


def observation_rows(topic, releases, codes):
    prior = {}
    for release in releases:
        period = release["period"]
        values = dict(release)
        if topic == "cpi":
            for prefix in ("cpi", "core"):
                values[prefix + "_index"] = f"{100 + Decimal(release[prefix + '_yoy']):.1f}"
        if topic == "retail":
            baseline = prior if not period.endswith("Q1") else {}
            online = Decimal(str(release["online_ytd"])) - Decimal(str(baseline.get("online_ytd", 0)))
            total = Decimal(str(release["retail_ytd"])) - Decimal(str(baseline.get("retail_ytd", 0)))
            if online < 0 or total <= 0 or online > total:
                raise ValueError("Retail cumulative differences are inconsistent")
            values.update(online_qtr=online, retail_qtr=total, online_share_qtr=f"{100 * online / total:.2f}")
            prior = release
        for code in codes:
            yield {"code": code, "period": period, "value": str(values[code])}


def view_config(view):
    if view not in VIEWS:
        raise HTTPException(404, "Unknown catalog view")
    return VIEWS[view]


@router.get("/{view}")
def list_versions(view: str, account: SignedIn, engine: Database):
    topic, _codes = view_config(view)
    current(engine, topic)
    with engine.connect() as connection:
        versions = connection.execute(select(catalog_versions.c.id, catalog_versions.c.created_at,
                                              catalog_versions.c.releases).where(catalog_versions.c.topic == topic)
                                      .order_by(catalog_versions.c.id.desc())).mappings()
        return [{"id": row["id"], "created_at": row["created_at"], "end": row["releases"][-1]["period"]}
                for row in versions]


def get_version(engine, topic, version_id):
    with engine.connect() as connection:
        version = connection.execute(select(catalog_versions).where(catalog_versions.c.id == version_id,
                                                                     catalog_versions.c.topic == topic)).mappings().first()
    if version is None:
        raise HTTPException(404, "Catalog version not found")
    return version


@router.get("/{view}/versions/{version_id}")
def get_view(view: str, version_id: int, account: SignedIn, engine: Database):
    topic, codes = view_config(view)
    version = get_version(engine, topic, version_id)
    releases = version["releases"]
    return {"rows": list(observation_rows(topic, releases, codes)),
            "releases": [release_info(r) for r in releases]}


def release_info(row):
    return {key: row[key] for key in ("period", "date", "url", "share_kind", "survey_base", "edition") if key in row}


@router.get("/{view}/versions/{version_id}/sources/{period}")
def archived_source(view: str, version_id: int, period: str, account: SignedIn, engine: Database):
    topic, _codes = view_config(view)
    version = get_version(engine, topic, version_id)
    row = next((r for r in version["releases"] if r["period"] == period), None)
    if not row:
        raise HTTPException(404, "Source period not found")
    return row


@router.post("/{view}/check", dependencies=[Depends(require_browser_header)])
def check(view: str, account: SignedIn, engine: Database):
    topic, codes = view_config(view)
    before = current(engine, topic)
    try:
        releases = refresh(topic, before["releases"])
        list(observation_rows(topic, releases, codes))
    except (OSError, ValueError, KeyError, IndexError, StopIteration) as error:
        raise HTTPException(502, f"NBS update could not be validated: {error}") from error
    with engine.begin() as connection:
        connection.execute(text("SELECT pg_advisory_xact_lock(44017302)"))
        head = latest(connection, topic)
        if head["id"] != before["id"]:
            raise HTTPException(409, "Catalog changed during check; try again")
        new_id = save_version(connection, topic, releases)
    return {"id": new_id or head["id"], "changed": new_id is not None, "end": releases[-1]["period"]}


class ImportSelection(BaseModel):
    start: str
    end: str


@router.post("/{view}/versions/{version_id}/import", status_code=201, dependencies=[Depends(require_browser_header)])
def import_version(view: str, version_id: int, selection: ImportSelection, account: SignedIn, engine: Database):
    topic, codes = view_config(view)
    version = get_version(engine, topic, version_id)
    releases = version["releases"]
    periods = {row["period"] for row in releases}
    if not {selection.start, selection.end} <= periods or selection.start > selection.end:
        raise HTTPException(422, "Invalid catalog period selection")
    stream = StringIO()
    writer = csv.writer(stream)
    writer.writerow(["code", "period", "value"])
    writer.writerows((row["code"], row["period"], row["value"]) for row in observation_rows(topic, releases, codes)
                     if selection.start <= row["period"] <= selection.end)
    stream.seek(0)
    dataset_id = import_csv(engine, stream, f"国家统计局 · {view} · 版本 #{version_id}",
                            uploaded_by=account.id, version_id=version_id)
    return {"dataset_id": dataset_id}
