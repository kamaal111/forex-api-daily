import json
import requests
import xmltodict
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, TypedDict
from bs4 import BeautifulSoup
from pathlib import Path


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
    # "RUB",
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
    exchange_rates = fetch_exchange_rates(urls=forex_urls)
    store_exchange_rates(exchange_rates=exchange_rates)


def store_exchange_rates(exchange_rates: Dict[datetime, "RecordExchangeRate"]):
    rates_file = Path("rates.json")
    rates_file_content = get_rates_file_content(file_content=rates_file.read_text())

    items_to_store: List[RecordExchangeRate] = []
    for exchange_rate_key, exchange_rate in exchange_rates.items():
        if (rate_file_item := rates_file_content.get(exchange_rate_key)) and (
            rate_file_item := rate_file_item.get(exchange_rate.base)
        ):
            print("found")
            items_to_store.append(rate_file_item)
        else:
            if not exchange_rate.rates_are_empty:
                print("adding new")
                items_to_store.append(exchange_rate)
                for calculate_rate in exchange_rate.calculate_rates():
                    items_to_store.append(calculate_rate)

    content_to_write = list(
        map(
            lambda x: x.to_dict(),
            sorted(items_to_store, key=lambda x: x.date, reverse=True),
        )
    )
    rates_file.write_text(json.dumps(content_to_write, indent=2))


def get_rates_file_content(file_content: str):
    rates_mapped_by_date: Dict[datetime, Dict[str, RecordExchangeRate]] = {}
    for content in json.loads(file_content):
        exchange_rate = RecordExchangeRate.from_dict(data=content)
        if rates_mapped_by_date.get(exchange_rate.date) is None:
            rates_mapped_by_date[exchange_rate.date] = {}

        rates_mapped_by_date[exchange_rate.date][exchange_rate.base] = exchange_rate

    return rates_mapped_by_date


def fetch_exchange_rates(urls: List[str]):
    exchange_rates: Dict[datetime, RecordExchangeRate] = {}

    for url in urls:
        print(f"getting data from {url=}")
        response = requests.get(url).content
        data = xmltodict.parse(response)

        for item in data.get("rdf:RDF", {}).get("item", []):
            item = ForexItem.from_ecb_response(response=item)

            if exchange_rates.get(item.date) is None:
                exchange_rates[item.date] = RecordExchangeRate(
                    date=item.date, base=item.statistics.base, rates={}
                )

            if item.statistics.target in CURRENCIES:
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

    @property
    def rates_are_empty(self):
        return len(self.rates) == 0

    def to_dict(self):
        return {
            "date": self.date.strftime("%Y-%m-%dT%H:%M:%S"),
            "base": self.base,
            "rates": self.rates,
        }

    def calculate_rates(self):
        new_exchange_rates: List[RecordExchangeRate] = []
        for new_base_currency in CURRENCIES:
            rates = self.rates.keys()
            if new_base_currency != "EUR" and new_base_currency in rates:
                new_exchange_rate = RecordExchangeRate(
                    date=self.date,
                    base=new_base_currency,
                    rates={"EUR": 1 / float(self.rates[new_base_currency])},
                )
                for currency in CURRENCIES:
                    if currency in rates and currency != new_base_currency:
                        new_exchange_rate.add_rate(
                            currency=currency,
                            value=float(self.rates[currency])
                            / float(self.rates[new_base_currency]),
                        )

                new_exchange_rates.append(new_exchange_rate)

        return new_exchange_rates

    def add_rate(self, currency: str, value: float):
        self.rates[currency] = value

    def from_dict(data: Dict[str, Any]) -> "RecordExchangeRate":
        date = datetime.strptime(data["date"], "%Y-%m-%dT%H:%M:%S")

        return RecordExchangeRate(date=date, base=data["base"], rates=data["rates"])


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
            response=response["cb:statistics"]["cb:exchangeRate"]
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
