import requests
import xmltodict
from dataclasses import dataclass
from datetime import datetime
from typing import Dict, List, TypedDict
from bs4 import BeautifulSoup


BASE_FOREX_URL = "https://www.ecb.europa.eu"
HOME_URL = f"{BASE_FOREX_URL}/home/html/rss.en.html"
CURRENCIES = [
    "USD",
    "JPY",
    "BGN",
    "CYP",
    "CZK",
    "DKK",
    "EEK",
    "GBP",
    "HUF",
    "LTL",
    "LVL",
    "MTL",
    "PLN",
    "ROL",
    "RON",
    "SEK",
    "SIT",
    "SKK",
    "CHF",
    "ISK",
    "NOK",
    "HRK",
    "RUB",
    "TRL",
    "TRY",
    "AUD",
    "BRL",
    "CAD",
    "CNY",
    "HKD",
    "IDR",
    "ILS",
    "INR",
    "KRW",
    "MXN",
    "MYR",
    "NZD",
    "PHP",
    "SGD",
    "THB",
    "ZAR",
]


def main():
    forex_urls = get_forex_urls()
    exchange_rates = fetch_exchange_rates(forex_urls)
    print(f"{exchange_rates=}")


# def


def fetch_exchange_rates(urls: List[str]):
    exchange_rates: Dict[datetime, RecordExchangeRate] = {}

    for url in urls:
        response = requests.get(url).content
        data = xmltodict.parse(response)

        for item in data.get("rdf:RDF", {}).get("item", []):
            item = ForexItem.from_ecb_response(item)

            if exchange_rates.get(item.date) is None:
                exchange_rates[item.date] = RecordExchangeRate(
                    date=item.date, base=item.statistics.base, rates={}
                )

            exchange_rates[item.date].add_rate(
                currency=item.statistics.target, value=item.statistics.value
            )

    return exchange_rates


def get_forex_urls():
    home_response = requests.get(HOME_URL).content
    soup = BeautifulSoup(home_response, "html.parser")

    forex_urls: List[str] = []
    for link in soup.find_all("a"):
        if (link := link.get("href")) and "/rss/fxref" in link and "eek" not in link:
            forex_urls.append(f"{BASE_FOREX_URL}{link}")

    return forex_urls


@dataclass
class RecordExchangeRate:
    date: datetime
    base: str
    rates: Dict[str, float]

    def add_rate(self, currency: str, value: float):
        self.rates[currency] = value


@dataclass
class ForexItemExchangeRate:
    value: float
    base: str
    target: str

    @staticmethod
    def from_ecb_response(
        response: "ForexItemDictExchangeRate",
    ) -> "ForexItemExchangeRate":
        exchange_rate_value = float(response["cb:value"]["#text"])
        exchange_rate_base = response["cb:baseCurrency"]["#text"]
        exchange_rate_target = response["cb:targetCurrency"]

        return ForexItemExchangeRate(
            value=exchange_rate_value,
            base=exchange_rate_base,
            target=exchange_rate_target,
        )


@dataclass
class ForexItem:
    statistics: ForexItemExchangeRate
    date: datetime

    @staticmethod
    def from_ecb_response(response: "ForexItemDict") -> "ForexItem":
        date = datetime.strptime(response["dc:date"].split("+")[0], "%Y-%m-%dT%H:%M:%S")
        statistics = ForexItemExchangeRate.from_ecb_response(
            response["cb:statistics"]["cb:exchangeRate"]
        )

        return ForexItem(statistics=statistics, date=date)


ForexItemDictExchangeRateValue = TypedDict(
    "ForexItemDictExchangeRateValue", {"#text": str}
)
ForexItemDictExchangeRate = TypedDict(
    "ForexItemDictExchangeRate",
    {
        "cb:value": ForexItemDictExchangeRateValue,
        "cb:baseCurrency": ForexItemDictExchangeRateValue,
        "cb:targetCurrency": str,
    },
)
ForexItemDictStatistics = TypedDict(
    "ForexItemDictStatistics", {"cb:exchangeRate": ForexItemDictExchangeRate}
)
ForexItemDict = TypedDict(
    "ForexItemDict", {"cb:statistics": ForexItemDictStatistics, "dc:date": str}
)


main()
