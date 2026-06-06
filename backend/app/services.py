from __future__ import annotations

import io
import logging
import math
import uuid
from datetime import date

import pandas as pd
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .forecasting import forecast_series
from .models import Forecast, Product, Sale, Store, DatasetMetadata
from .schemas import ForecastRequest


REQUIRED_COLUMNS = {"date", "store_id", "product_id", "sales", "price"}
OPTIONAL_NUMERIC_COLUMNS = ["discount_pct", "unit_cost", "current_stock"]
LOGGER = logging.getLogger(__name__)

COLUMN_ALIASES = {
    "date": {"date", "sale_date", "sales_date", "transaction_date", "order_date", "sold_at", "day"},
    "store_id": {"store_id", "store", "store_code", "storeid", "outlet", "outlet_id", "location", "location_id", "branch", "branch_id"},
    "product_id": {"product_id", "product", "product_code", "productid", "sku", "item_id", "item", "item_code", "variant_id"},
    "sales": {"sales", "units", "quantity", "qty", "quantity_sold", "units_sold", "sold_units"},
    "price": {"price", "unit_price", "selling_price", "sale_price", "retail_price", "amount"},
    "promotion": {"promotion", "promo", "is_promo", "promoted", "promotion_flag", "on_promotion"},
    "category": {"category", "product_category", "dept", "department", "class"},
    "region": {"region", "market", "territory", "area"},
    "store_name": {"store_name", "store_label", "outlet_name", "location_name", "branch_name"},
    "product_name": {"product_name", "item_name", "sku_name", "description", "product_description"},
    "discount_pct": {"discount_pct", "discount", "discount_percent", "discount_percentage"},
    "unit_cost": {"unit_cost", "cost", "cost_price", "wholesale_cost"},
    "current_stock": {"current_stock", "inventory", "stock", "stock_on_hand", "on_hand", "available_stock"},
    "supplier": {"supplier", "vendor", "supplier_name"},
    "brand": {"brand", "manufacturer", "label"},
}

class UploadError(Exception):
    def __init__(self, message, stage, validation_report: dict | None = None):
        super().__init__(message)
        self.stage = stage
        self.validation_report = validation_report


def _truthy_promotion(value) -> bool:
    if value is None or pd.isna(value):
        return False
    if isinstance(value, str):
        return value.strip().lower() in {"true", "1", "yes", "y", "t", "promo", "promoted"}
    return bool(value)


def _normalize_name(value: str) -> str:
    return "".join(ch for ch in value.strip().lower() if ch.isalnum())


def _normalize_columns(frame: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, str]]:
    reverse_aliases = {
        _normalize_name(alias): canonical
        for canonical, aliases in COLUMN_ALIASES.items()
        for alias in aliases | {canonical}
    }
    mapping: dict[str, str] = {}
    rename: dict[str, str] = {}
    used: set[str] = set()
    for column in frame.columns:
        canonical = reverse_aliases.get(_normalize_name(str(column)))
        if canonical and canonical not in used:
            rename[column] = canonical
            mapping[str(column)] = canonical
            used.add(canonical)
    normalized = frame.rename(columns=rename).copy()
    for optional, default in {"promotion": False, "category": "General", "region": "Unknown"}.items():
        if optional not in normalized.columns:
            normalized[optional] = default
    return normalized, mapping


def _validation_report(frame: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    original_columns = frame.columns.tolist()
    frame, column_mapping = _normalize_columns(frame)
    report = {
        "required_columns": sorted(REQUIRED_COLUMNS),
        "received_columns": original_columns,
        "normalized_columns": frame.columns.tolist(),
        "column_mapping": column_mapping,
        "missing_columns": sorted(REQUIRED_COLUMNS - set(frame.columns)),
        "missing_optional_columns": sorted({"promotion", "category", "region", "store_name", "product_name", "discount_pct", "current_stock", "supplier", "brand"} - set(frame.columns)),
        "row_count": int(len(frame)),
        "column_count": int(len(original_columns)),
        "null_values": {},
        "duplicate_rows": int(frame.duplicated().sum()),
        "invalid_dates": [],
        "invalid_numeric_values": [],
        "warnings": [],
        "passed": True,
    }
    if report["missing_columns"]:
        report["passed"] = False
        return frame, report

    working = frame.copy()
    duplicate_records = int(working.duplicated().sum())
    if duplicate_records:
        report["warnings"].append(f"{duplicate_records} duplicate rows were removed before insertion.")
        working = working.drop_duplicates()

    for col in REQUIRED_COLUMNS:
        if working[col].dtype == object:
            working[col] = working[col].astype(str).str.strip()
            working.loc[working[col].isin(["", "nan", "None", "NaN"]), col] = None

    required_nulls = working[list(REQUIRED_COLUMNS)].isnull().sum()
    report["null_values"] = {column: int(count) for column, count in working.isnull().sum().items() if int(count) > 0}
    if required_nulls.sum() > 0:
        report["passed"] = False

    for col in ["sales", "price", *[c for c in OPTIONAL_NUMERIC_COLUMNS if c in working.columns]]:
        if working[col].dtype == object:
            working[col] = working[col].astype(str).str.replace(",", "", regex=False).str.replace("$", "", regex=False).str.strip()

    dates = pd.to_datetime(working["date"], errors="coerce", dayfirst=False)
    bad_dates = dates.isnull()
    if bad_dates.any():
        report["passed"] = False
        report["invalid_dates"] = [
            {"row": int(index) + 2, "value": None if pd.isna(working.at[index, "date"]) else str(working.at[index, "date"])}
            for index in working.index[bad_dates][:25]
        ]
    working["date"] = dates

    for col in ["sales", "price"]:
        parsed = pd.to_numeric(working[col], errors="coerce")
        invalid = parsed.isnull() | (parsed < 0)
        if invalid.any():
            report["passed"] = False
            report["invalid_numeric_values"].extend(
                [
                    {
                        "row": int(index) + 2,
                        "column": col,
                        "value": None if pd.isna(working.at[index, col]) else str(working.at[index, col]),
                    }
                    for index in working.index[invalid][:25]
                ]
            )
        working[col] = parsed

    for col in OPTIONAL_NUMERIC_COLUMNS:
        if col in working.columns:
            parsed = pd.to_numeric(working[col], errors="coerce")
            invalid = parsed.notnull() & (parsed < 0)
            if invalid.any():
                report["passed"] = False
                report["invalid_numeric_values"].extend(
                    [
                        {"row": int(index) + 2, "column": col, "value": str(working.at[index, col])}
                        for index in working.index[invalid][:25]
                    ]
                )
            working[col] = parsed.fillna(0)

    return working, report


def clean_nans(obj):
    if isinstance(obj, dict): return {k: clean_nans(v) for k, v in obj.items()}
    if isinstance(obj, list): return [clean_nans(v) for v in obj]
    if isinstance(obj, float) and math.isnan(obj): return None
    return obj

def import_sales_csv(content: bytes, db: Session, validate_only: bool = False) -> dict:
    LOGGER.info("Parsing CSV upload", extra={"event": "upload", "stage": "csv_parsing"})
    try:
        frame = pd.read_csv(io.BytesIO(content))
        LOGGER.info("CSV parsed", extra={"event": "upload", "stage": "csv_parsed", "rows": len(frame)})
    except Exception as e:
        raise UploadError(f"Failed to parse CSV: {e}", "csv_parsing")

    try:
        frame, validation_report = _validation_report(frame)
        if not validation_report["passed"]:
            raise UploadError("Dataset validation failed.", "validation", validation_report)

        frame["date"] = frame["date"].dt.date
        frame = frame.where(pd.notnull(frame), None)
        duplicate_records = validation_report["duplicate_rows"]
        invalid_records = len(validation_report["invalid_dates"]) + len(validation_report["invalid_numeric_values"])
        if validate_only:
            return clean_nans({
                "rows_processed": 0,
                "stores": int(frame["store_id"].nunique()),
                "products": int(frame["product_id"].nunique()),
                "validation_report": validation_report,
            })
    except UploadError:
        raise
    except Exception as e:
        raise UploadError(f"Data cleanup failed: {e}", "data_cleanup")

    LOGGER.info("Validation passed", extra={"event": "upload", "stage": "validation", "rows": len(frame)})
    
    try:
        imported = 0
        for row in frame.to_dict("records"):
            store = db.scalar(select(Store).where(Store.store_code == str(row["store_id"])))
            if not store:
                store = Store(store_code=str(row["store_id"]), name=str(row.get("store_name") or row["store_id"]), region=str(row.get("region") or "Unknown"))
                db.add(store)
                db.flush()
                
            product = db.scalar(select(Product).where(Product.product_code == str(row["product_id"])))
            if not product:
                product = Product(
                    product_code=str(row["product_id"]),
                    name=str(row.get("product_name") or row["product_id"]),
                    category=str(row.get("category") or "General"),
                    unit_cost=float(row.get("unit_cost") or 0),
                    current_stock=float(row.get("current_stock") or 0),
                )
                db.add(product)
                db.flush()
            
            existing = db.scalar(select(Sale).where(Sale.date == row["date"], Sale.store_id == store.id, Sale.product_id == product.id))
            
            promo_bool = _truthy_promotion(row["promotion"])

            values = {
                "units": float(row["sales"]),
                "price": float(row["price"]),
                "promotion": promo_bool,
                "discount_pct": float(row.get("discount_pct") or 0),
            }
            if existing:
                for key, value in values.items():
                    setattr(existing, key, value)
            else:
                db.add(Sale(date=row["date"], store_id=store.id, product_id=product.id, **values))
            imported += 1
        db.commit()
    except Exception as e:
        db.rollback()
        raise UploadError(f"Database insert failed: {e}", "database_insert")

    LOGGER.info("Sales inserted", extra={"event": "upload", "stage": "database_insert", "rows": imported})
    
    try:
        row_count = imported
        column_count = int(validation_report["column_count"])
        store_count_val = db.scalar(select(func.count(Store.id)))
        product_count_val = db.scalar(select(func.count(Product.id)))
        
        if row_count > 0:
            start_date = frame["date"].min()
            end_date = frame["date"].max()
            missing_values = int(frame.isnull().sum().sum())
            
            missing_penalty = (missing_values / row_count) * 20
            duplicate_penalty = (duplicate_records / row_count) * 30
            invalid_penalty = (invalid_records / row_count) * 50
            data_quality_score = max(0.0, 100.0 - missing_penalty - duplicate_penalty - invalid_penalty)
            
            days_diff = (end_date - start_date).days
            forecast_readiness = min(100.0, max(0.0, (days_diff / 60.0) * 100))
            
            category_count = 0
            if "category" in validation_report["column_mapping"].values():
                category_count = int(frame["category"].dropna().nunique())
                
            promotion_coverage_pct = 0.0
            if "promotion" in validation_report["column_mapping"].values():
                promo_series = frame["promotion"].apply(_truthy_promotion)
                promotion_coverage_pct = float((promo_series.sum() / row_count) * 100)
        else:
            start_date = date.today()
            end_date = date.today()
            column_count = int(validation_report["column_count"])
            missing_values = 0
            duplicate_records = 0
            invalid_records = 0
            data_quality_score = 100.0
            forecast_readiness = 0.0
            category_count = 0
            promotion_coverage_pct = 0.0

        db.execute(DatasetMetadata.__table__.delete())
        metadata = DatasetMetadata(
            row_count=row_count,
            column_count=column_count,
            product_count=product_count_val,
            store_count=store_count_val,
            start_date=start_date,
            end_date=end_date,
            missing_values=missing_values,
            duplicate_records=duplicate_records,
            invalid_records=invalid_records,
            data_quality_score=data_quality_score,
            forecast_readiness=forecast_readiness,
            category_count=category_count,
            promotion_coverage_pct=promotion_coverage_pct
        )
        db.add(metadata)
        db.commit()
    except Exception as e:
        db.rollback()
        raise UploadError(f"Dataset profile generation failed: {e}", "profile_generation")

    LOGGER.info("Dataset profile generated", extra={"event": "analytics", "stage": "profile_generation", "rows": imported})
    return {
        "rows_processed": imported,
        "stores": store_count_val,
        "products": product_count_val,
        "validation_report": validation_report,
    }


def sales_frame(db: Session, store_code: str | None = None, product_code: str | None = None) -> pd.DataFrame:
    query = select(Sale.date, Sale.units, Sale.price, Sale.promotion, Store.store_code, Product.product_code, Product.category).join(Store).join(Product)
    if store_code:
        query = query.where(Store.store_code == store_code)
    if product_code:
        query = query.where(Product.product_code == product_code)
    return pd.DataFrame(db.execute(query).mappings().all())


def generate_forecasts(db: Session, request: ForecastRequest) -> dict:
    LOGGER.info("Generating forecasts", extra={"event": "forecasting", "stage": "start"})
    stores = [request.store_code] if request.store_code else list(db.scalars(select(Store.store_code)))
    products = [request.product_code] if request.product_code else list(db.scalars(select(Product.product_code)))
    run_id = uuid.uuid4().hex[:12]
    scenario = "what-if" if request.promotion_lift_pct or request.demand_spike_pct else "baseline"
    metrics = []
    created = 0
    skipped_short_history = 0
    for store_code in stores:
        store = db.scalar(select(Store).where(Store.store_code == store_code))
        for product_code in products:
            product = db.scalar(select(Product).where(Product.product_code == product_code))
            history = sales_frame(db, store_code, product_code)
            if history.empty:
                continue
            history_dates = pd.to_datetime(history["date"], errors="coerce").dropna()
            if history_dates.empty or (history_dates.max() - history_dates.min()).days < 29:
                skipped_short_history += 1
                continue
            output = forecast_series(history, request.horizon_days, request.promotion_lift_pct, request.demand_spike_pct, request.price_change_pct)
            metrics.append(output.metrics)
            for row in output.forecast.to_dict("records"):
                db.add(Forecast(run_id=run_id, store_id=store.id, product_id=product.id, scenario=scenario, **row))
                created += 1
    db.commit()
    if not created:
        if skipped_short_history:
            raise ValueError("Forecast requires at least 30 days of sales history.")
        raise ValueError("No matching sales history found.")
    LOGGER.info("Forecasts generated", extra={"event": "forecasting", "stage": "complete", "rows": created})
    return {"run_id": run_id, "scenario": scenario, "forecasts_created": created, "metrics": metrics[0] if len(metrics) == 1 else None}


def analytics_summary(db: Session) -> dict:
    LOGGER.info("Generating analytics summary", extra={"event": "analytics", "stage": "summary"})
    sales = sales_frame(db)
    metadata = db.scalar(select(DatasetMetadata).order_by(DatasetMetadata.created_at.desc()).limit(1))
    profile = {
        "row_count": metadata.row_count,
        "column_count": metadata.column_count,
        "product_count": metadata.product_count,
        "store_count": metadata.store_count,
        "start_date": metadata.start_date.isoformat(),
        "end_date": metadata.end_date.isoformat(),
        "missing_values": metadata.missing_values,
        "duplicate_records": metadata.duplicate_records,
        "invalid_records": metadata.invalid_records,
        "data_quality_score": round(metadata.data_quality_score, 1),
        "forecast_readiness": round(metadata.forecast_readiness, 1),
        "category_count": metadata.category_count,
        "promotion_coverage_pct": round(metadata.promotion_coverage_pct, 1)
    } if metadata else None

    if sales.empty:
        return {
            "has_data": False,
            "profile": profile,
            "kpis": {"revenue": 0, "units": 0, "stores": 0, "products": 0, "daily_revenue": 0},
            "trend": [], "stores": [], "products": [], "promotion_impact": [], "alerts": []
        }
    sales["date"] = pd.to_datetime(sales["date"])
    sales["revenue"] = sales["units"] * sales["price"]
    
    trend = sales.groupby("date", as_index=False).agg(units=("units", "sum"), revenue=("revenue", "sum"))
    stores = sales.groupby("store_code", as_index=False).agg(units=("units", "sum"), revenue=("revenue", "sum"))
    products = sales.groupby("product_code", as_index=False).agg(units=("units", "sum"), revenue=("revenue", "sum"))
    
    promo = sales.groupby(["store_code", "product_code", "promotion"], as_index=False).agg(
        avg_units=("units", "mean"), 
        revenue=("revenue", "mean"),
        total_revenue=("revenue", "sum"),
        total_units=("units", "sum")
    )
    
    # Also pass category sharing if needed:
    categories = (
        sales.groupby("category", as_index=False).agg(units=("units", "sum"), revenue=("revenue", "sum"))
        if profile and profile.get("category_count", 0) > 0
        else pd.DataFrame(columns=["category", "units", "revenue"])
    )
    
    products = products.sort_values(by="revenue", ascending=False)
    total_rev = products["revenue"].sum()
    products["cum_pct"] = products["revenue"].cumsum() / total_rev if total_rev > 0 else 0
    products["abc_class"] = products["cum_pct"].apply(lambda p: "A" if p <= 0.8 else ("B" if p <= 0.95 else "C"))
    
    alerts = stock_alerts(db)
    days_in_data = (sales["date"].max() - sales["date"].min()).days or 1
    
    return {
        "has_data": True,
        "profile": profile,
        "kpis": {
            "revenue": round(float(total_rev), 2), 
            "units": round(float(sales["units"].sum()), 2), 
            "stores": int(sales["store_code"].nunique()), 
            "products": int(sales["product_code"].nunique()),
            "daily_revenue": round(float(total_rev / days_in_data), 2)
        },
        "trend": [{**row, "date": row["date"].date().isoformat()} for row in trend.to_dict("records")],
        "stores": stores.round(2).to_dict("records"),
        "products": products.round(2).to_dict("records"),
        "categories": categories.round(2).to_dict("records"),
        "promotion_impact": promo.round(2).to_dict("records"),
        "alerts": alerts,
    }


def stock_alerts(db: Session) -> list[dict]:
    latest_run = db.scalar(select(Forecast.run_id).order_by(Forecast.created_at.desc()).limit(1))
    if not latest_run:
        return []
    rows = db.execute(
        select(Product.product_code, Product.name, Product.current_stock, func.sum(Forecast.predicted_units).label("demand"))
        .join(Forecast, Forecast.product_id == Product.id)
        .where(Forecast.run_id == latest_run)
        .group_by(Product.id)
    ).mappings()
    alerts = []
    for row in rows:
        demand = float(row["demand"] or 0)
        stock = float(row["current_stock"])
        recommended = max(0, demand * 1.15 - stock)
        status = "stockout-risk" if stock < demand else "overstock" if stock > demand * 2 else "healthy"
        alerts.append({"product_code": row["product_code"], "product_name": row["name"], "current_stock": stock, "forecast_demand": round(demand, 2), "recommended_order": round(recommended, 2), "status": status})
    return alerts


def latest_forecast(db: Session) -> list[dict]:
    LOGGER.info("Loading latest forecasts", extra={"event": "forecasting", "stage": "latest"})
    latest_run = db.scalar(select(Forecast.run_id).order_by(Forecast.created_at.desc()).limit(1))
    if not latest_run:
        return []
    rows = db.execute(select(Forecast, Store.store_code, Product.product_code).join(Store, Forecast.store_id == Store.id).join(Product, Forecast.product_id == Product.id).where(Forecast.run_id == latest_run).order_by(Forecast.date)).all()
    return [{"run_id": item.run_id, "date": item.date.isoformat(), "store_code": store, "product_code": product, "predicted_units": item.predicted_units, "lower_bound": item.lower_bound, "upper_bound": item.upper_bound, "scenario": item.scenario} for item, store, product in rows]
