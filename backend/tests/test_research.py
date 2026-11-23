import asyncio
import json
from io import StringIO

import httpx
import pytest
from fastapi import HTTPException
from openai import OpenAI

from backend import research
from backend.series import import_csv
from backend.tests.test_mvp import ACCOUNT_PATH, DATA_PATH, HEADERS, PASSWORD, client, database


def fixture_model(requests, *, citation_id="S1", insufficient=False):
    def serve(request):
        assert request.url.path == "/responses"
        body = json.loads(request.content)
        requests.append(body)
        assert body["reasoning"] == {"effort": "none"}
        tool_result = [
            item for item in body["input"] if item.get("type") == "function_call_output"
        ]
        if not tool_result:
            assert body["tool_choice"]["name"] == "get_quarterly_indicators"
            output = [{
                "id": "fc_fixture", "type": "function_call", "call_id": "call_fixture",
                "name": "get_quarterly_indicators", "arguments": "{}", "status": "completed",
            }]
        else:
            assert tool_result[0]["call_id"] == "call_fixture"
            assert isinstance(json.loads(tool_result[0]["output"]), list)
            assert body["text"]["format"]["type"] == "json_schema"
            message = json.loads(body["input"][0]["content"])
            sections = [] if insufficient else [{
                "heading": "季度表现" if message["mode"] == "question" else "研究报告初稿",
                "body": "样例 GDP 最新一季度同比为 21%。", "source_ids": [citation_id],
            }]
            output = [{
                "id": "msg_fixture", "type": "message", "role": "assistant", "status": "completed",
                "content": [{
                    "type": "output_text", "annotations": [],
                    "text": json.dumps({
                        "status": "insufficient" if insufficient else "answered", "sections": sections,
                    }),
                }],
            }]
        return httpx.Response(200, json={"id": "resp_fixture", "status": "completed", "output": output})

    return OpenAI(
        api_key="local-fixture", base_url="https://api.deepseek.com",
        http_client=httpx.Client(transport=httpx.MockTransport(serve)),
        max_retries=0,
    )


def test_invalid_model_citations_are_rejected(monkeypatch):
    monkeypatch.setattr(research, "provider_client", lambda: fixture_model([], citation_id="S99"))
    source = research.Citation(
        id="S1", dataset_id=1, source="Private label", code="gdp", unit="亿元",
        first_period="2025-Q1", last_period="2025-Q1",
    )
    with pytest.raises(HTTPException) as error:
        research.answer_with_provider("question", "GDP？", [{"source_id": "S1"}], [source])
    assert error.value.status_code == 502
    assert "无法核对来源" in error.value.detail


def test_provider_insufficiency_has_no_sources(monkeypatch):
    monkeypatch.setattr(research, "provider_client", lambda: fixture_model([], insufficient=True))
    result = research.answer_with_provider("question", "失业率？", [{"source_id": "S1"}], [])
    assert result.status == "insufficient"
    assert result.sections == result.sources == []


def test_research_uses_account_scope_and_exact_database_evidence(database, monkeypatch):
    calls = []
    real_client = research.provider_client
    monkeypatch.setattr(research, "provider_client", lambda: fixture_model(calls))

    async def exercise():
        async with client() as owner, client() as outsider:
            credentials = {"email": "researcher@example.com", "password": PASSWORD}
            registered = await owner.post(f"{ACCOUNT_PATH}/register", headers=HEADERS, json=credentials)
            assert registered.status_code == 201
            account_id = registered.json()["id"]
            login = await owner.post(f"{ACCOUNT_PATH}/login", headers=HEADERS, json=credentials)
            assert login.status_code == 200
            outsider_credentials = {**credentials, "email": "outsider@example.com"}
            assert (await outsider.post(f"{ACCOUNT_PATH}/register", headers=HEADERS, json=outsider_credentials)).status_code == 201
            assert (await outsider.post(f"{ACCOUNT_PATH}/login", headers=HEADERS, json=outsider_credentials)).status_code == 200

            record = import_csv(
                database, StringIO(
                    "code,period,value\ngdp,2024-Q1,100\ngdp,2024-Q4,110\ngdp,2025-Q1,121\ncpi,2025-Q1,102\n"
                ), "Sensitive source label", uploaded_by=account_id,
            )
            path = f"{DATA_PATH}/{record}/research"
            body = {
                "mode": "question", "question": "GDP 最新同比？", "codes": ["gdp", "cpi"],
                "start": "2025-Q1", "end": "2025-Q1",
            }
            assert (await outsider.post(path, headers=HEADERS, json=body)).status_code == 404
            assert (await owner.post(path, json=body)).status_code == 403
            invalid = await owner.post(path, headers=HEADERS, json={**body, "start": "1990-Q1"})
            assert invalid.status_code == 422
            missing = await owner.post(path, headers=HEADERS, json={**body, "start": "2025-Q2", "end": "2025-Q2"})
            assert missing.json()["status"] == "insufficient"
            assert calls == []
            response = await owner.post(path, headers=HEADERS, json=body)
            assert response.status_code == 200
            output = response.json()
            assert output["sections"][0]["source_ids"] == ["S1"]
            assert output["sources"][0]["source"] == "Sensitive source label"
            assert len(calls) == 2
            serialized = json.dumps(calls)
            assert "Sensitive source label" not in serialized and credentials["email"] not in serialized
            observations = json.loads(calls[1]["input"][-1]["output"])
            assert [item["code"] for item in observations] == ["gdp", "cpi"]
            assert observations[0]["points"] == [{
                "period": "2025-Q1", "value": "121.000000", "yoy_percent": "21.00", "qoq_percent": "10.00",
                "yoy_unavailable_reason": None, "qoq_unavailable_reason": None,
            }]
            report = await owner.post(path, headers=HEADERS, json={**body, "mode": "report", "question": ""})
            assert report.status_code == 200
            assert report.json()["sections"][0]["heading"] == "研究报告初稿"
            monkeypatch.setattr(research, "provider_client", real_client)
            monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
            unconfigured = await owner.post(path, headers=HEADERS, json=body)
            assert unconfigured.status_code == 503

    asyncio.run(exercise())
