from enum import StrEnum

from fastapi import FastAPI
from pydantic import BaseModel


class IndicatorCode(StrEnum):
    GDP = "gdp"
    CPI = "cpi"


class Indicator(BaseModel):
    code: IndicatorCode
    name: str


INDICATOR_NAMES = {
    IndicatorCode.GDP: "国内生产总值",
    IndicatorCode.CPI: "居民消费价格指数",
}

app = FastAPI(title="EconoMind API")


@app.get("/api/v1/indicators/{code}", response_model=Indicator)
def get_indicator(code: IndicatorCode) -> Indicator:
    return Indicator(code=code, name=INDICATOR_NAMES[code])
