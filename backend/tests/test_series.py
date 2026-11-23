from decimal import Decimal
from io import StringIO

import pytest

from backend.series import growth_percent, quarter_number, read_csv


def test_csv_preserves_decimal_precision():
    rows = read_csv(StringIO("code,period,value\ngdp,2025-Q1,123.123456\n"))
    assert rows == {("gdp", quarter_number("2025-Q1")): Decimal("123.123456")}


@pytest.mark.parametrize("rows", [
    "gdp,2025-Q5,100\n",
    "gdp,2025-Q1,NaN\n",
    "gdp,2025-Q1,100\ngdp,2025-Q1,120\n",
])
def test_csv_rejects_invalid_rows_with_line_number(rows):
    with pytest.raises(ValueError, match=r"line [23]:"):
        read_csv(StringIO("code,period,value\n" + rows))


def test_growth_uses_valid_base_only():
    assert growth_percent(Decimal("121"), Decimal("110")) == Decimal("10.00")
    assert growth_percent(Decimal("121"), None) is None
    assert growth_percent(Decimal("121"), Decimal("0")) is None
