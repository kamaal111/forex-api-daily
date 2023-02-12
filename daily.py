import asyncio
import os
import requests
import xmltodict
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, TypedDict
from bs4 import BeautifulSoup
from google.cloud import firestore


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


def main(*args, **kwargs):
    print(f"{args=}\n{kwargs}")
    project_id = os.getenv("GCP_PROJECT_ID")
    if not project_id:
        raise Exception("Failed to read GCP_PROJECT_ID environment variable")

    forex_urls = get_forex_urls()
    exchange_rates = fetch_exchange_rates(urls=forex_urls)

    db = firestore.AsyncClient(project=project_id)
    asyncio.run(store_exchange_rates(db=db, exchange_rates=exchange_rates))

    return "SUCCESS"  # to indicate success to cloud function


async def store_exchange_rates(
    db: firestore.AsyncClient, exchange_rates: Dict[datetime, "RecordExchangeRate"]
):
    exchange_rates_collection = db.collection("exchange_rates")

    items_to_store: List[RecordExchangeRate] = []
    for exchange_rate in exchange_rates.values():
        if exchange_rate.rates_are_empty:
            continue

        exchange_rate_document = await exchange_rates_collection.document(
            exchange_rate.document_key
        ).get()
        if exchange_rate_document.exists:
            continue

        items_to_store.append(exchange_rate)
        for calculated_rate in exchange_rate.calculate_rates():
            if not calculated_rate.rates_are_empty:
                items_to_store.append(calculated_rate)

    if len(items_to_store) == 0:
        print("no new data found to save")
        return

    print(f"saving {len(items_to_store)} items to firestore in batch")
    batch_operations = db.batch()
    for item_to_store in items_to_store:
        new_document = exchange_rates_collection.document(item_to_store.document_key)
        batch_operations.set(new_document, item_to_store.to_dict())
        batch_operations.update(new_document, {"rates": item_to_store.rates})

    await batch_operations.commit()
    print(f"saved all items in firestore")


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

    @property
    def document_key(self):
        return f"{self.base}-{self.date_string}"

    @property
    def date_string(self):
        return self.date.strftime(self.date_time_decoding_key())

    def to_dict(self):
        return {
            "date": self.date_string,
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
        date = datetime.strptime(
            data["date"], RecordExchangeRate.date_time_decoding_key()
        )

        return RecordExchangeRate(date=date, base=data["base"], rates=data["rates"])

    @staticmethod
    def date_time_decoding_key():
        return "%Y-%m-%d"


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
