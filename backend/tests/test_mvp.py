import asyncio
import os
from io import StringIO
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.schema import CreateSchema, DropSchema

from backend.main import app
from backend.series import datasets, engine_for, import_csv, init_database, period_number, quarter_number, query_series, users

PASSWORD = "example-passphrase-123"
HEADERS = {"X-EconoMind-Request": "1"}
ACCOUNT_PATH = "/api/v1/auth"
DATA_PATH = "/api/v1/datasets"
CSV = b"code,period,value\ngdp,2024-Q1,100\ngdp,2024-Q4,110\ngdp,2025-Q1,121\n"


def client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver")


def test_auth_validation_does_not_expose_password(monkeypatch):
    monkeypatch.setenv("ECONOMIND_DATABASE_URL", "postgresql+psycopg://localhost/unused")

    async def exercise():
        async with client() as session:
            response = await session.post(
                f"{ACCOUNT_PATH}/register", headers=HEADERS,
                json={"email": "bad-email", "password": PASSWORD},
            )
            assert response.status_code == 422
            assert PASSWORD not in response.text
            response = await session.post(
                f"{ACCOUNT_PATH}/login",
                json={"email": "person@example.com", "password": PASSWORD},
            )
            assert response.status_code == 403

    asyncio.run(exercise())


@pytest.fixture
def database(monkeypatch):
    raw_url = os.getenv("ECONOMIND_TEST_DATABASE_URL")
    if not raw_url:
        pytest.skip("Set ECONOMIND_TEST_DATABASE_URL to run isolated PostgreSQL tests")
    schema = f"econ_test_{uuid4().hex}"
    admin = create_engine(raw_url)
    with admin.begin() as connection:
        connection.execute(CreateSchema(schema))
    url = make_url(raw_url).update_query_dict({"options": f"-csearch_path={schema}"})
    configured_url = url.render_as_string(hide_password=False)
    monkeypatch.setenv("ECONOMIND_DATABASE_URL", configured_url)
    monkeypatch.delenv("ECONOMIND_SECURE_COOKIES", raising=False)
    engine = engine_for(configured_url)
    try:
        with engine.begin() as connection:
            connection.execute(text(
                "CREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR(254) NOT NULL UNIQUE)"
            ))
        init_database(engine)
        init_database(engine)
        yield engine
    finally:
        engine.dispose()
        engine_for.cache_clear()
        with admin.begin() as connection:
            connection.execute(DropSchema(schema, cascade=True))
        admin.dispose()


def test_account_and_private_import_workflow(database):
    shared = import_csv(database, StringIO(CSV.decode()), "Shared sample")

    async def exercise():
        async with client() as owner, client() as other:
            secret = {"email": "owner@example.com", "password": PASSWORD}
            response = await owner.get(DATA_PATH)
            assert response.status_code == 401
            response = await owner.post(
                DATA_PATH, headers=HEADERS, data={"source": "Private"}, files={"file": ("test.csv", CSV)},
            )
            assert response.status_code == 401
            response = await owner.post(f"{ACCOUNT_PATH}/register", headers=HEADERS, json=secret)
            assert response.status_code == 201
            assert response.json()["email"] == secret["email"]
            duplicate = await owner.post(f"{ACCOUNT_PATH}/register", headers=HEADERS, json=secret)
            assert duplicate.status_code == 409
            wrong = await owner.post(
                f"{ACCOUNT_PATH}/login", headers=HEADERS, json={**secret, "password": "wrong"},
            )
            assert wrong.status_code == 401
            response = await owner.post(f"{ACCOUNT_PATH}/login", headers=HEADERS, json=secret)
            assert response.status_code == 200
            cookie = response.headers["set-cookie"]
            assert "HttpOnly" in cookie and "SameSite=strict" in cookie
            token = owner.cookies.get("economind_session")
            assert token
            assert (await owner.get(f"{ACCOUNT_PATH}/me")).json()["email"] == secret["email"]
            response = await owner.post(
                DATA_PATH, headers=HEADERS, data={"source": "Private"},
                files={"file": ("test.csv", CSV + b"gdp,2025-Q1,200\n")},
            )
            assert response.status_code == 422 and "line 5" in response.json()["detail"]
            oversized = await owner.post(
                DATA_PATH, headers=HEADERS, data={"source": "Oversized"},
                files={"file": ("big.csv", b"x" * (2 * 1024 * 1024 + 1))},
            )
            assert oversized.status_code == 413
            response = await owner.post(
                DATA_PATH, headers=HEADERS, data={"source": "Private"}, files={"file": ("test.csv", CSV)},
            )
            assert response.status_code == 201
            private = response.json()["dataset_id"]
            records = (await owner.get(DATA_PATH)).json()
            assert [(row["id"], row["owned"], row["observation_count"]) for row in records] == [
                (private, True, 3), (shared, False, 3),
            ]
            assert records[0]["first_period"] == "2024-Q1"
            query = "/indicators/gdp/series?start=2025-Q1&end=2025-Q1"
            response = await owner.get(f"{DATA_PATH}/{private}{query}")
            assert response.status_code == 200
            assert response.headers["cache-control"] == "no-store"
            assert response.json()["points"][0]["yoy_percent"] == "21.00"
            assert (await other.get(f"{DATA_PATH}/{private}{query}")).status_code == 404
            other_secret = {**secret, "email": "other@example.com"}
            assert (await other.post(f"{ACCOUNT_PATH}/register", headers=HEADERS, json=other_secret)).status_code == 201
            assert (await other.post(f"{ACCOUNT_PATH}/login", headers=HEADERS, json=other_secret)).status_code == 200
            assert (await other.get(f"{DATA_PATH}/{private}{query}")).status_code == 404
            assert (await other.get(f"{DATA_PATH}/{shared}{query}")).status_code == 200
            assert [row["id"] for row in (await other.get(DATA_PATH)).json()] == [shared]
            assert (await owner.post(f"{ACCOUNT_PATH}/logout", headers=HEADERS)).status_code == 204
            response = await owner.get(f"{ACCOUNT_PATH}/me", headers={"Cookie": f"economind_session={token}"})
            assert response.status_code == 401

    asyncio.run(exercise())
    with database.connect() as connection:
        passwords = connection.execute(select(users.c.password_hash)).scalars().all()
        assert len(passwords) == 2 and all(value.startswith("$argon2id$") for value in passwords)
        assert len(connection.execute(select(datasets.c.id)).all()) == 2

def test_retail_growth_respects_measure_and_year_boundary(database):
    csv = "code,period,value\n" + "".join(
        f"{code},{period},{value}\n"
        for code in ("online_ytd", "online_qtr", "online_share_ytd", "online_share_qtr")
        for period, value in (("2024-Q1", 20), ("2024-Q4", 80), ("2025-Q1", 24))
    )
    dataset = import_csv(database, StringIO(csv), "Retail test")
    quarter = quarter_number("2025-Q1")

    def point(code):
        return query_series(database, dataset, code, quarter, quarter)["points"][0]

    assert point("online_ytd")["qoq_percent"] is None
    assert point("online_ytd")["yoy_percent"] == 20
    assert point("online_qtr")["qoq_percent"] == -70
    for code in ("online_share_ytd", "online_share_qtr"):
        assert point(code)["qoq_percent"] is None
        assert point(code)["yoy_percent"] is None

def test_monthly_price_import_preserves_periods_and_published_rates(database):
    csv = "code,period,value\ncpi_index,2025-01,100.5\ncpi_yoy,2025-01,0.5\ncpi_yoy,2025-02,-0.7\n"
    dataset = import_csv(database, StringIO(csv), "Monthly prices")
    first = period_number("2025-01", "cpi_yoy")
    last = period_number("2025-02", "cpi_yoy")
    series = query_series(database, dataset, "cpi_yoy", first, last)
    assert series["frequency"] == "monthly"
    assert [p["period"] for p in series["points"]] == ["2025-01", "2025-02"]
    assert [str(p["value"]) for p in series["points"]] == ["0.500000", "-0.700000"]
    assert all(p["yoy_percent"] is None and p["qoq_percent"] is None for p in series["points"])
    with pytest.raises(ValueError, match="separate datasets"):
        import_csv(database, StringIO(csv + "gdp,2025-Q1,100\n"), "Mixed frequencies")
