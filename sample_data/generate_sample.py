"""Generate a reproducible year of retail data for demos."""
import csv
import math
import random
from datetime import date, timedelta
from pathlib import Path

random.seed(42)
stores = [("S001", "Downtown Flagship", "North"), ("S002", "Mall Express", "South"), ("S003", "Riverside Market", "West")]
products = [
    ("P001", "Classic Sneakers", "Footwear", 34, 620, 79),
    ("P002", "Everyday Hoodie", "Apparel", 22, 480, 59),
    ("P003", "Urban Backpack", "Accessories", 18, 350, 49),
    ("P004", "Performance Tee", "Apparel", 9, 800, 29),
]
output = Path(__file__).with_name("sample_sales.csv")
fields = ["date", "store_id", "store_name", "region", "product_id", "product_name", "category", "sales", "price", "promotion", "discount_pct", "unit_cost", "current_stock"]
with output.open("w", newline="", encoding="utf-8") as file:
    writer = csv.DictWriter(file, fieldnames=fields)
    writer.writeheader()
    for day in range(365):
        current = date(2025, 1, 1) + timedelta(days=day)
        for store_idx, store in enumerate(stores):
            for product_idx, product in enumerate(products):
                promo = day % (31 + product_idx * 3) in range(4)
                weekend = 1.25 if current.weekday() >= 5 else 1
                annual = 1 + 0.22 * math.sin(2 * math.pi * day / 365)
                units = max(1, round((12 + product_idx * 4 + store_idx * 2) * weekend * annual * (1.45 if promo else 1) + random.gauss(0, 3)))
                writer.writerow({
                    "date": current.isoformat(), "store_id": store[0], "store_name": store[1], "region": store[2],
                    "product_id": product[0], "product_name": product[1], "category": product[2], "sales": units,
                    "price": round(product[5] * (0.85 if promo else 1), 2), "promotion": int(promo),
                    "discount_pct": 15 if promo else 0, "unit_cost": product[3], "current_stock": product[4],
                })
print(f"Created {output}")

