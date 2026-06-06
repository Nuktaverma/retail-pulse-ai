from __future__ import annotations

import logging
import os
from datetime import UTC, datetime
from typing import Any

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import Forecast, Product, Sale, Store
from .services import analytics_summary, latest_forecast, stock_alerts


LOGGER = logging.getLogger(__name__)


def _money(value: float) -> str:
    return f"${value:,.2f}"


def _pct(value: float) -> str:
    return f"{value:.1f}%"


def _intent(question: str) -> str:
    q = question.lower()
    if any(term in q for term in ["promotion", "promo", "discount"]):
        return "promotion_effectiveness"
    if any(term in q for term in ["stockout", "inventory", "receive more", "reorder", "stock"]):
        return "inventory_risk"
    if any(term in q for term in ["forecast", "next month", "demand"]):
        return "forecast_demand"
    if "store" in q:
        return "top_store"
    if "category" in q or "growing" in q:
        return "category_growth"
    if any(term in q for term in ["revenue decrease", "decrease", "decline", "september", "trend"]):
        return "revenue_trend"
    if any(term in q for term in ["top 5", "top five", "best", "product", "sku"]):
        return "top_products"
    return "executive_summary"


def _top_product(db: Session) -> dict[str, Any] | None:
    row = db.execute(
        select(
            Product.product_code,
            Product.name,
            Product.category,
            func.sum(Sale.units).label("units"),
            func.sum(Sale.units * Sale.price).label("revenue"),
        )
        .join(Sale, Sale.product_id == Product.id)
        .group_by(Product.id)
        .order_by(func.sum(Sale.units * Sale.price).desc())
        .limit(1)
    ).mappings().first()
    return dict(row) if row else None


def _top_products(db: Session, limit: int = 5) -> list[dict[str, Any]]:
    rows = db.execute(
        select(
            Product.product_code,
            Product.name,
            Product.category,
            func.sum(Sale.units).label("units"),
            func.sum(Sale.units * Sale.price).label("revenue"),
        )
        .join(Sale, Sale.product_id == Product.id)
        .group_by(Product.id)
        .order_by(func.sum(Sale.units * Sale.price).desc())
        .limit(limit)
    ).mappings().all()
    return [dict(row) for row in rows]


def _top_store(db: Session) -> dict[str, Any] | None:
    row = db.execute(
        select(
            Store.store_code,
            Store.name,
            Store.region,
            func.sum(Sale.units).label("units"),
            func.sum(Sale.units * Sale.price).label("revenue"),
        )
        .join(Sale, Sale.store_id == Store.id)
        .group_by(Store.id)
        .order_by(func.sum(Sale.units * Sale.price).desc())
        .limit(1)
    ).mappings().first()
    return dict(row) if row else None


def _promotion_metrics(db: Session) -> dict[str, Any]:
    promoted = db.execute(
        select(func.avg(Sale.units).label("avg_units"), func.sum(Sale.units * Sale.price).label("revenue"))
        .where(Sale.promotion.is_(True))
    ).mappings().first()
    baseline = db.execute(
        select(func.avg(Sale.units).label("avg_units"), func.sum(Sale.units * Sale.price).label("revenue"))
        .where(Sale.promotion.is_(False))
    ).mappings().first()
    promo_avg = float(promoted["avg_units"] or 0)
    base_avg = float(baseline["avg_units"] or 0)
    lift = ((promo_avg - base_avg) / base_avg * 100) if base_avg else 0
    return {
        "promoted_avg_units": round(promo_avg, 2),
        "baseline_avg_units": round(base_avg, 2),
        "lift_pct": round(lift, 2),
        "promotion_revenue": round(float(promoted["revenue"] or 0), 2),
        "baseline_revenue": round(float(baseline["revenue"] or 0), 2),
    }


def _category_growth(db: Session) -> dict[str, Any]:
    analytics = analytics_summary(db)
    trend = analytics.get("trend", [])
    if not trend:
        return {"category": None, "growth_pct": 0, "note": "No dated sales history is available."}

    rows = db.execute(
        select(Product.category, Sale.date, func.sum(Sale.units * Sale.price).label("revenue"))
        .join(Sale, Sale.product_id == Product.id)
        .group_by(Product.category, Sale.date)
    ).mappings().all()
    by_category: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        by_category.setdefault(row["category"], []).append(dict(row))

    best = {"category": None, "growth_pct": 0.0, "start_revenue": 0.0, "end_revenue": 0.0}
    for category, values in by_category.items():
        values = sorted(values, key=lambda item: item["date"])
        midpoint = max(1, len(values) // 2)
        first = sum(float(item["revenue"] or 0) for item in values[:midpoint])
        second = sum(float(item["revenue"] or 0) for item in values[midpoint:])
        growth = ((second - first) / first * 100) if first else 0
        if best["category"] is None or growth > best["growth_pct"]:
            best = {"category": category, "growth_pct": round(growth, 2), "start_revenue": round(first, 2), "end_revenue": round(second, 2)}
    return best


def _trend_diagnosis(db: Session) -> dict[str, Any]:
    analytics = analytics_summary(db)
    trend = analytics.get("trend", [])
    if len(trend) < 2:
        return {"change_pct": 0, "note": "Not enough dates to diagnose a revenue change."}
    previous = float(trend[-2]["revenue"])
    latest = float(trend[-1]["revenue"])
    change = ((latest - previous) / previous * 100) if previous else 0
    return {
        "previous_date": trend[-2]["date"],
        "latest_date": trend[-1]["date"],
        "previous_revenue": round(previous, 2),
        "latest_revenue": round(latest, 2),
        "change_pct": round(change, 2),
    }


def _forecast_metrics(db: Session) -> dict[str, Any]:
    forecasts = latest_forecast(db)
    total = sum(float(row["predicted_units"]) for row in forecasts)
    return {"forecast_rows": len(forecasts), "predicted_units": round(total, 2), "latest_run_id": forecasts[0]["run_id"] if forecasts else None}


def _optional_llm_summary(question: str, metrics: dict[str, Any], draft: str) -> str | None:
    openai_key = os.getenv("OPENAI_API_KEY")
    google_key = os.getenv("GOOGLE_API_KEY")
    prompt = (
        "You are a retail business analyst. Rewrite this answer as a concise executive response. "
        "Use only the supplied metrics and preserve Observation, Impact, Recommendation.\n"
        f"Question: {question}\nMetrics: {metrics}\nDraft: {draft}"
    )
    try:
        if openai_key:
            response = httpx.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {openai_key}"},
                json={
                    "model": "gpt-4o-mini",
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.2,
                },
                timeout=8,
            )
            response.raise_for_status()
            return response.json()["choices"][0]["message"]["content"]
        if google_key:
            response = httpx.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={google_key}",
                json={"contents": [{"parts": [{"text": prompt}]}]},
                timeout=8,
            )
            response.raise_for_status()
            return response.json()["candidates"][0]["content"]["parts"][0]["text"]
    except Exception:
        LOGGER.exception("Optional LLM summary failed", extra={"event": "ai_assistant"})
    return None


def answer_business_question(db: Session, question: str) -> dict[str, Any]:
    intent = _intent(question)
    analytics = analytics_summary(db)
    LOGGER.info("Assistant query", extra={"event": "ai_assistant", "intent": intent, "question": question})

    if not analytics.get("has_data"):
        return {
            "answer": "I do not have an uploaded dataset to analyze yet. Upload sales data first, then I can answer with grounded retail metrics.",
            "supporting_metrics": {},
            "generated_at": datetime.now(UTC).isoformat(),
            "confidence": 0.3,
        }

    total_revenue = float(analytics["kpis"]["revenue"] or 0)
    metrics: dict[str, Any] = {"intent": intent, "total_revenue": total_revenue}

    if intent == "top_store":
        store = _top_store(db)
        metrics["top_store"] = store
        share = (float(store["revenue"]) / total_revenue * 100) if store and total_revenue else 0
        answer = (
            f"**Observation:** Store {store['store_code']} generates {_money(float(store['revenue']))}, or {_pct(share)} of total revenue.\n\n"
            f"**Impact:** Performance is concentrated in this location, so inventory and staffing decisions there have outsized business impact.\n\n"
            f"**Recommendation:** Use {store['store_code']}'s product mix and promotion cadence as the benchmark for lower-performing stores."
        )
    elif intent == "promotion_effectiveness":
        promo = _promotion_metrics(db)
        metrics["promotion"] = promo
        direction = "increased" if promo["lift_pct"] >= 0 else "reduced"
        answer = (
            f"**Observation:** Promotions {direction} average units by {_pct(abs(promo['lift_pct']))} "
            f"({promo['baseline_avg_units']} baseline vs {promo['promoted_avg_units']} promoted units).\n\n"
            f"**Impact:** Promotion revenue is {_money(promo['promotion_revenue'])}, compared with {_money(promo['baseline_revenue'])} outside promotions.\n\n"
            f"**Recommendation:** Expand promotions only where lift is positive; otherwise redirect discount budget to stronger SKUs or stores."
        )
    elif intent == "inventory_risk":
        alerts = stock_alerts(db)
        risks = [item for item in alerts if item["status"] == "stockout-risk"]
        metrics["inventory_risks"] = risks[:5]
        if risks:
            first = risks[0]
            answer = (
                f"**Observation:** {len(risks)} products are at stockout risk. The highest-priority item is {first['product_code']} "
                f"with {first['current_stock']} on hand against {first['forecast_demand']} forecast units.\n\n"
                f"**Impact:** Lost sales are likely if replenishment is not placed before the forecast window.\n\n"
                f"**Recommendation:** Order {first['recommended_order']} units for {first['product_code']} first, then review the remaining risk list."
            )
        else:
            answer = (
                "**Observation:** No stockout-risk products are currently flagged from the latest forecast.\n\n"
                "**Impact:** Inventory appears aligned with forecast demand, assuming current stock values are accurate.\n\n"
                "**Recommendation:** Keep monitoring after each forecast run and refresh stock levels before ordering decisions."
            )
    elif intent == "forecast_demand":
        forecast = _forecast_metrics(db)
        metrics["forecast"] = forecast
        answer = (
            f"**Observation:** The latest forecast projects {forecast['predicted_units']:,.0f} units across {forecast['forecast_rows']} forecast rows.\n\n"
            "**Impact:** This is the demand pool that should drive replenishment, labor planning, and promotion timing.\n\n"
            "**Recommendation:** Compare forecast demand against current stock and prioritize items with the largest forecast-to-stock gap."
        )
    elif intent == "category_growth":
        category = _category_growth(db)
        metrics["category_growth"] = category
        answer = (
            f"**Observation:** {category.get('category') or 'No category'} is the fastest-growing category with {_pct(float(category.get('growth_pct') or 0))} growth between the first and second halves of the dataset.\n\n"
            "**Impact:** Category momentum can shift inventory dollars toward higher-return assortments.\n\n"
            "**Recommendation:** Increase review frequency for this category and test whether its product mix should expand in top stores."
        )
    elif intent == "revenue_trend":
        trend = _trend_diagnosis(db)
        metrics["revenue_trend"] = trend
        answer = (
            f"**Observation:** Revenue changed by {_pct(float(trend.get('change_pct') or 0))} from {trend.get('previous_date')} to {trend.get('latest_date')}.\n\n"
            "**Impact:** Recent revenue movement may reflect unit demand, price changes, or promotion mix in the uploaded data.\n\n"
            "**Recommendation:** Compare the latest day by store and product to isolate which segment caused the movement before changing inventory plans."
        )
    else:
        products = _top_products(db, 5)
        metrics["top_products"] = products
        top = products[0]
        share = (float(top["revenue"]) / total_revenue * 100) if total_revenue else 0
        answer = (
            f"**Observation:** The best-selling product is {top['product_code']} with {_money(float(top['revenue']))} revenue and {float(top['units']):,.0f} units sold.\n\n"
            f"**Impact:** It contributes {_pct(share)} of total revenue and is a key demand driver.\n\n"
            f"**Recommendation:** Protect availability for {top['product_code']} and use the top 5 product list to prioritize replenishment and merchandising."
        )

    llm_answer = _optional_llm_summary(question, metrics, answer)
    return {
        "answer": llm_answer or answer,
        "supporting_metrics": metrics,
        "generated_at": datetime.now(UTC).isoformat(),
        "confidence": 0.94 if metrics else 0.7,
    }
