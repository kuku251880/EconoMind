import asyncio

import pytest
from httpx import ASGITransport, AsyncClient

from backend.main import app

def get(path):
    async def request():
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            return await client.get(path)

    return asyncio.run(request())


@pytest.mark.parametrize(
    ("code", "name"),
    [("gdp", "国内生产总值"), ("cpi", "居民消费价格指数")],
)
def test_returns_indicator_as_json(code, name):
    response = get(f"/api/v1/indicators/{code}")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    assert response.json() == {"code": code, "name": name}


def test_rejects_unsupported_indicator_code():
    response = get("/api/v1/indicators/unknown")

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["path", "code"]
