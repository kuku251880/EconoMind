"""Discover and validate the three supported National Bureau of Statistics releases."""
import json
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from pathlib import Path
from html.parser import HTMLParser
from http.cookiejar import CookieJar
from urllib.parse import urljoin
from urllib.request import HTTPCookieProcessor, HTTPRedirectHandler, Request, build_opener

INDEX = "https://www.stats.gov.cn/sj/zxfb/"
RELEASE_URL = re.compile(r"https://www\.stats\.gov\.cn/sj/zxfb/\d{6}/t(\d{8})_\d+\.html")
GDP = {"gdp": "GDP", "primary": "第一产业", "secondary": "第二产业",
       "tertiary": "第三产业", "info_services": "信息传输、软件和信息技术服务业"}
TITLES = {
    "gdp": re.compile(r"(\d{4})年([一二三四])季度(?:和(?:全年|上半年))?国内生产总值初步核算结果$"),
    "retail": re.compile(r"(\d{4})年(?:1[—－–-])?(?:(3|6|9|12)月份?|上半年|前三季度|全年)社会消费品零售总额"),
    "cpi": re.compile(r"(\d{4})年(\d{1,2})月份?居民消费价格"),
}


class Page(HTMLParser):
    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.links, self.tables, self.words = [], [], []
        self.href = self.cell = self.row = self.table = None
        self.span = (1, 1)
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "a":
            self.href, self.label = attrs.get("href"), []
        elif tag == "table":
            self.table = []
        elif tag == "tr" and self.table is not None:
            self.row = []
        elif tag in ("td", "th") and self.row is not None:
            self.cell = []
            self.span = (int(attrs.get("colspan", 1)), int(attrs.get("rowspan", 1)))

    def handle_data(self, data):
        self.words.append(data)
        if self.href is not None:
            self.label.append(data)
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if tag == "a" and self.href is not None:
            self.links.append((self.href, compact("".join(self.label))))
            self.href = None
        elif tag in ("td", "th") and self.cell is not None:
            self.row.append((compact("".join(self.cell)), *self.span))
            self.cell = None
        elif tag == "tr" and self.row is not None:
            self.table.append(self.row)
            self.row = None
        elif tag == "table" and self.table is not None:
            self.tables.append(self.table)
            self.table = None


def compact(value):
    return re.sub(r"\s+", "", value)


class NBSRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, new_url):
        if new_url != request.full_url:
            return None
        return super().redirect_request(request, fp, code, msg, headers, new_url)


class BrowserRequired(ValueError):
    pass


def fetch(url):
    request = Request(url, headers={"User-Agent": "EconoMind/1.0 (public statistics reader)"})
    opener = build_opener(NBSRedirect(), HTTPCookieProcessor(CookieJar()))
    with opener.open(request, timeout=12) as response:
        if response.geturl() != url:
            raise ValueError("Unexpected redirect from the NBS website")
        content = response.read(3_000_001)
        if len(content) > 3_000_000:
            raise ValueError("NBS response exceeded the size limit")
        html = content.decode("utf-8-sig")
        if "Please enable JavaScript and refresh the page." in html:
            raise BrowserRequired("NBS requires a JavaScript-capable browser")
        return html


def period_for(topic, title):
    match = TITLES[topic].match(title)
    if not match:
        return None
    year, part = match.groups()
    if topic == "gdp":
        return f"{year}-Q{'一二三四'.index(part) + 1}"
    if topic == "retail":
        return f"{year}-Q{int(part) // 3 if part else (2 if "上半年" in title else 3 if "前三季度" in title else 4)}"
    return f"{year}-{int(part):02d}" if 1 <= int(part) <= 12 else None


def number(value, *, positive=False):
    value = value.replace("−", "-").replace("，", "").replace(",", "")
    if not re.fullmatch(r"[+-]?\d+(?:\.\d+)?", value):
        raise ValueError("Missing or invalid NBS value")
    if positive and Decimal(value) <= 0:
        raise ValueError("Expected a positive amount")
    return value


def extract(topic, period, url, html):
    page = Page(html)
    content = compact("".join(page.words))
    date_match = re.search(r"(20\d{2})[/-](\d{2})[/-](\d{2})\d{2}:\d{2}", content)
    date = "-".join(date_match.groups()) if date_match else release_date(url)
    for table in page.tables:
        rows = [[cell[0] for cell in row] for row in table if row]
        headings = "".join("".join(row) for row in rows[:4])
        by_name = {row[0].removeprefix("其中："): row[1:] for row in rows if len(row) > 1}
        if topic == "cpi" and {"居民消费价格", "不包括食品和能源"} <= by_name.keys():
            if "环比涨跌幅" not in headings or "同比涨跌幅" not in headings:
                raise ValueError("CPI table headings changed")
            cpi, core = by_name["居民消费价格"], by_name["不包括食品和能源"]
            headers = next(row for row in rows if any("环比涨跌幅" in cell for cell in row))
            # The leading empty header labels the indicator-name column.
            rates = [cell for cell in headers if "涨跌幅" in cell]
            mom = next(i for i, cell in enumerate(rates) if cell.startswith("环比"))
            yoy = next(i for i, cell in enumerate(rates) if cell.startswith("同比"))
            figures = {"cpi_yoy": number(cpi[yoy]), "cpi_mom": number(cpi[mom]),
                       "core_yoy": number(core[yoy]), "core_mom": number(core[mom])}
            basis = re.search(r"以(20\d{2})年为基期", content)
            if basis:
                figures["survey_base"] = basis[1]
            break
        if topic == "gdp" and set(GDP.values()) <= by_name.keys():
            if "绝对额" not in headings or "亿元" not in headings or "绝对额按现价计算" not in content:
                raise ValueError("GDP table units or price basis changed")
            figures = {code: number(by_name[label][0], positive=True) for code, label in GDP.items()}
            figures["edition"] = "preliminary"
            break
        if topic == "retail" and "社会消费品零售总额" in by_name:
            online = by_name.get("网上商品零售额") or by_name.get("实物商品网上零售额")
            if not online or "绝对量" not in headings or "亿元" not in headings:
                raise ValueError("Retail table headings changed")
            total = number(by_name["社会消费品零售总额"][2], positive=True)
            amount = number(online[2], positive=True)
            if Decimal(amount) > Decimal(total):
                raise ValueError("Online goods exceed total retail")
            published = re.search(r"占社会消费品零售总额的比重为([\d.]+)%", content)
            figures = {"online_ytd": float(amount), "retail_ytd": float(total),
                       "online_share_ytd": published[1] if published else str(round(100 * Decimal(amount) / Decimal(total), 2)),
                       "share_kind": "published" if published else "calculated"}
            break
    else:
        raise ValueError("Expected NBS data table not found")
    return {"period": period, "date": date, "url": url, **figures, "raw_table": table, "parser": 1}


def release_date(url):
    digits = RELEASE_URL.fullmatch(url)[1]
    return f"{digits[:4]}-{digits[4:6]}-{digits[6:]}"


def discover(topic, cutoff, load_pages):
    candidates = {}
    for offset in range(0, 64, 4):
        urls = [INDEX + (f"index_{n}.html" if n else "index.html") for n in range(offset, offset + 4)]
        for url, html in zip(urls, load_pages(urls), strict=True):
            dates = []
            for link, title in Page(html).links:
                target = urljoin(url, link)
                if not RELEASE_URL.fullmatch(target):
                    continue
                date = release_date(target)
                dates.append(date)
                period = period_for(topic, title)
                if period and date >= cutoff:
                    candidates[target] = period
            if not dates:
                raise ValueError("NBS publication index had no official release links")
            if min(dates) < cutoff:
                return candidates
    raise ValueError("Publication list did not reach the last stored release")


def refresh(topic, existing):
    with ThreadPoolExecutor(max_workers=3) as pool:
        try:
            return refresh_from(topic, existing, lambda urls: list(pool.map(fetch, urls)))
        except BrowserRequired:
            pass

    script = Path(__file__).resolve().parents[1] / "frontend" / "nbs-browser.mjs"
    with subprocess.Popen(
        ["node", str(script)], text=True, encoding="utf-8",
        stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    ) as worker:
        def load_pages(urls):
            worker.stdin.write(json.dumps(urls) + "\n")
            worker.stdin.flush()
            reply = worker.stdout.readline()
            if not reply:
                raise ValueError("Unable to start the Edge publication reader")
            result = json.loads(reply)
            if "error" in result:
                raise ValueError(result["error"])
            return result["html"]

        try:
            return refresh_from(topic, existing, load_pages)
        finally:
            worker.stdin.close()


def refresh_from(topic, existing, load_pages):
    # Review the recent release window and backfill all periods since the seed.
    cutoff = max("2026-01-01", existing[-1]["date"][:4] + "-01-01")
    candidates = discover(topic, cutoff, load_pages)
    for row in existing[-2:]:
        if RELEASE_URL.fullmatch(row["url"]):
            candidates.setdefault(row["url"], row["period"])
    by_period = {row["period"]: row for row in existing}
    urls = list(candidates)
    for offset in range(0, len(urls), 4):
        batch = urls[offset:offset + 4]
        for url, html in zip(batch, load_pages(batch), strict=True):
            period = candidates[url]
            parsed = extract(topic, period, url, html)
            prior = by_period.get(period)
            if prior and (prior["date"], prior["url"]) > (parsed["date"], parsed["url"]):
                continue
            if prior and prior["url"] == url and all(prior.get(k) == v for k, v in parsed.items()
                                                      if k not in ({"raw_table", "parser"} if "raw_table" in prior else {"raw_table", "parser", "edition", "share_kind", "survey_base"})):
                # Seed snapshots were already verified. Capture richer metadata for online releases.
                continue
            by_period[period] = parsed
    rows = sorted(by_period.values(), key=lambda row: row["period"])
    ordinals = []
    for row in rows:
        year, part = row["period"].split("-")
        ordinals.append(int(year) * (12 if topic == "cpi" else 4) + int(part.lstrip("Q")))
    if any(right != left + 1 for left, right in zip(ordinals, ordinals[1:])):
        raise ValueError("Missing publication within the covered period range")
    return rows
