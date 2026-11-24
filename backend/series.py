import csv
import os
import re
from decimal import Decimal
from enum import StrEnum
from functools import lru_cache
from io import StringIO

from sqlalchemy import (
    Column, DateTime, ForeignKey, Integer, MetaData, Numeric, String, Table, create_engine, or_, select, text,
)
from sqlalchemy.dialects.postgresql import insert

metadata = MetaData()
users = Table(
    "users", metadata,
    Column("id", Integer, primary_key=True),
    Column("email", String(254), nullable=False, unique=True),
    Column("password_hash", String(255)),
)
sessions = Table(
    "sessions", metadata,
    Column("token_hash", String(64), primary_key=True),
    Column("user_id", ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    Column("expires_at", DateTime(timezone=True), nullable=False, index=True),
)
datasets = Table(
    "datasets", metadata,
    Column("id", Integer, primary_key=True),
    Column("source", String(200), nullable=False),
    Column("uploaded_by", ForeignKey("users.id")),
)
indicators = Table(
    "indicators", metadata,
    Column("code", String(16), primary_key=True),
    Column("name", String(100), nullable=False),
    Column("unit", String(32), nullable=False),
    Column("frequency", String(16), nullable=False),
)
observations = Table(
    "observations", metadata,
    Column("dataset_id", ForeignKey("datasets.id"), primary_key=True),
    Column("code", ForeignKey("indicators.code"), primary_key=True),
    Column("quarter", Integer, primary_key=True),
    Column("value", Numeric(18, 6), nullable=False),
)
class IndicatorCode(StrEnum):
    GDP = "gdp"
    CPI = "cpi"
    PRIMARY = "primary"
    SECONDARY = "secondary"
    TERTIARY = "tertiary"
    CPI_INDEX = "cpi_index"
    CPI_YOY = "cpi_yoy"
    CPI_MOM = "cpi_mom"
    CORE_INDEX = "core_index"
    CORE_YOY = "core_yoy"
    CORE_MOM = "core_mom"
    INFO_SERVICES = "info_services"
    ONLINE_YTD = "online_ytd"
    RETAIL_YTD = "retail_ytd"
    ONLINE_SHARE_YTD = "online_share_ytd"
    ONLINE_QTR = "online_qtr"
    RETAIL_QTR = "retail_qtr"
    ONLINE_SHARE_QTR = "online_share_qtr"


YTD_CODES = {"online_ytd", "retail_ytd", "online_share_ytd"}
SHARE_CODES = {"online_share_ytd", "online_share_qtr"}

MONTHLY_CODES = {"cpi_index", "cpi_yoy", "cpi_mom", "core_index", "core_yoy", "core_mom"}
# Keep month ordinals disjoint from all supported quarter ordinals.
MONTH_OFFSET = 100_000

INDICATORS = {
    "cpi_index": ("月度 CPI 指数（上年同月＝100）", "指数点"),
    "cpi_yoy": ("月度 CPI 官方同比", "%"),
    "cpi_mom": ("月度 CPI 官方环比", "%"),
    "core_index": ("月度核心 CPI 指数（上年同月＝100）", "指数点"),
    "core_yoy": ("月度核心 CPI 官方同比", "%"),
    "core_mom": ("月度核心 CPI 官方环比", "%"),
    "online_ytd": ("实物商品网上零售额（累计）", "亿元"),
    "retail_ytd": ("社会消费品零售总额（累计）", "亿元"),
    "online_share_ytd": ("实物网零占社零比重（累计）", "%"),
    "online_qtr": ("实物商品网上零售额（当季）", "亿元"),
    "retail_qtr": ("社会消费品零售总额（当季）", "亿元"),
    "online_share_qtr": ("实物网零占社零比重（当季）", "%"),
    "primary": ("第一产业增加值", "亿元"),
    "secondary": ("第二产业增加值", "亿元"),
    "tertiary": ("第三产业增加值", "亿元"),
    "info_services": ("信息传输、软件和信息技术服务业增加值", "亿元"),
    "gdp": ("国内生产总值", "亿元"),
    "cpi": ("居民消费价格指数", "指数点"),
}
QUARTER_PATTERN = r"^[0-9]{4}-Q[1-4]$"
MAX_CSV_BYTES = 2 * 1024 * 1024
NUMBER_PATTERN = r"[+-]?[0-9]{1,12}(?:\.[0-9]{1,6})?"


@lru_cache(maxsize=1)
def engine_for(url):
    if not url.startswith("postgresql+psycopg://"):
        raise ValueError("ECONOMIND_DATABASE_URL must use postgresql+psycopg://")
    return create_engine(url, pool_pre_ping=True, connect_args={"connect_timeout": 5})


def database_url():
    return os.getenv("ECONOMIND_DATABASE_URL")


def init_database(engine):
    with engine.begin() as connection:
        connection.execute(text("SELECT pg_advisory_xact_lock(44017301)"))
        metadata.create_all(connection)
        connection.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)"))
        for code, (name, unit) in INDICATORS.items():
            statement = insert(indicators).values(
                code=code, name=name, unit=unit, frequency="monthly" if code in MONTHLY_CODES else "quarterly",
            )
            connection.execute(statement.on_conflict_do_nothing(index_elements=["code"]))


def quarter_number(period):
    if not re.fullmatch(QUARTER_PATTERN, period) or period[:4] == "0000":
        raise ValueError("expected a quarter like 2025-Q1 with year 0001 to 9999")
    return int(period[:4]) * 4 + int(period[-1]) - 1


def quarter_label(quarter):
    year, offset = divmod(quarter, 4)
    return f"{year:04d}-Q{offset + 1}"


def period_number(period, code):
    if code not in MONTHLY_CODES:
        return quarter_number(period)
    if not re.fullmatch(r"[0-9]{4}-(?:0[1-9]|1[0-2])", period) or period[:4] == "0000":
        raise ValueError("expected a month like 2025-01 with year 0001 to 9999")
    return MONTH_OFFSET + int(period[:4]) * 12 + int(period[-2:]) - 1


def period_label(number):
    if number < MONTH_OFFSET:
        return quarter_label(number)
    year, month = divmod(number - MONTH_OFFSET, 12)
    return f"{year:04d}-{month + 1:02d}"


def read_csv(stream):
    reader = csv.reader(stream, strict=True)
    rows = {}
    try:
        if next(reader, []) != ["code", "period", "value"]:
            raise ValueError("line 1: expected header code,period,value")
        for fields in reader:
            try:
                if len(fields) != 3:
                    raise ValueError("expected three columns")
                code, period, value = (field.strip() for field in fields)
                if code not in INDICATORS:
                    raise ValueError("unknown indicator code")
                quarter = period_number(period, code)
                if not re.fullmatch(NUMBER_PATTERN, value):
                    raise ValueError("expected up to 12 integer and 6 decimal digits")
                key = (code, quarter)
                if key in rows:
                    raise ValueError("duplicate indicator and quarter")
                rows[key] = Decimal(value)
            except ValueError as error:
                raise ValueError(f"line {reader.line_num}: {error}") from error
    except csv.Error as error:
        raise ValueError(f"line {reader.line_num}: invalid CSV: {error}") from error
    if not rows:
        raise ValueError("CSV has no observations")
    if len({code in MONTHLY_CODES for code, _ in rows}) > 1:
        raise ValueError("monthly and quarterly observations require separate datasets")
    return rows


def decode_csv(content):
    if len(content) > MAX_CSV_BYTES:
        raise ValueError("CSV exceeds the 2 MiB limit")
    try:
        return StringIO(content.decode("utf-8-sig"), newline="")
    except UnicodeDecodeError as error:
        raise ValueError("CSV must be UTF-8") from error


def dataset_access(viewer_id):
    shared = datasets.c.uploaded_by.is_(None)
    return shared if viewer_id is None else or_(shared, datasets.c.uploaded_by == viewer_id)


def import_csv(engine, stream, source, *, uploaded_by=None):
    source = source.strip()
    if not 1 <= len(source) <= 200:
        raise ValueError("source must be 1 to 200 characters")
    rows = read_csv(stream)
    with engine.begin() as connection:
        dataset_id = connection.execute(
            datasets.insert().values(source=source, uploaded_by=uploaded_by).returning(datasets.c.id)
        ).scalar_one()
        connection.execute(observations.insert(), [
            {"dataset_id": dataset_id, "code": code, "quarter": quarter, "value": value}
            for (code, quarter), value in rows.items()
        ])
    return dataset_id


def growth_percent(current, base):
    if base is None or base == 0:
        return None
    return ((current / base - 1) * 100).quantize(Decimal("0.01"))


def growth_unavailable_reason(base):
    if base is None:
        return "missing_base"
    return "zero_base" if base == 0 else None


def query_series(engine, dataset_id, code, start, end, *, viewer_id=None):
    with engine.connect() as connection:
        info = connection.execute(
            select(datasets.c.source, indicators.c.unit, indicators.c.frequency)
            .select_from(datasets.join(indicators, indicators.c.code == code))
            .where(datasets.c.id == dataset_id, dataset_access(viewer_id))
        ).mappings().one_or_none()
        if info is None:
            return None
        rows = connection.execute(
            select(observations.c.quarter, observations.c.value)
            .where(
                observations.c.dataset_id == dataset_id,
                observations.c.code == code,
                observations.c.quarter.between(start - 4, end),
            )
            .order_by(observations.c.quarter)
        ).all()
        values = {quarter: value for quarter, value in rows}
    yoy_applicable = code not in SHARE_CODES and code not in MONTHLY_CODES
    qoq_applicable = yoy_applicable and code not in YTD_CODES
    return {
        **info,
        "dataset_id": dataset_id,
        "code": code,
        "points": [
            {
                "period": period_label(quarter),
                "value": value,
                "yoy_percent": growth_percent(value, values.get(quarter - 4)) if yoy_applicable else None,
                "qoq_percent": growth_percent(value, values.get(quarter - 1)) if qoq_applicable else None,
                "yoy_unavailable_reason": growth_unavailable_reason(values.get(quarter - 4)) if yoy_applicable else "not_applicable",
                "qoq_unavailable_reason": growth_unavailable_reason(values.get(quarter - 1)) if qoq_applicable else "not_applicable",
            }
            for quarter, value in values.items()
            if quarter >= start
        ],
    }
