from __future__ import annotations

from dataclasses import dataclass

import holidays
import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge


@dataclass
class ForecastOutput:
    forecast: pd.DataFrame
    metrics: dict[str, float]


def _features(dates: pd.Series, promotions: pd.Series | None = None, origin=None) -> pd.DataFrame:
    dt = pd.to_datetime(dates)
    origin = pd.Timestamp(origin) if origin is not None else dt.min()
    trend = (dt - origin).dt.days.astype(float)
    day = dt.dt.dayofweek
    annual = dt.dt.dayofyear
    us_holidays = holidays.US(years=sorted(dt.dt.year.unique().tolist()))
    promo = promotions.astype(float).to_numpy() if promotions is not None else np.zeros(len(dt))
    return pd.DataFrame(
        {
            "trend": trend,
            "trend2": trend**2,
            "dow_sin": np.sin(2 * np.pi * day / 7),
            "dow_cos": np.cos(2 * np.pi * day / 7),
            "year_sin": np.sin(2 * np.pi * annual / 365.25),
            "year_cos": np.cos(2 * np.pi * annual / 365.25),
            "promotion": promo,
            "holiday": [float(value.date() in us_holidays) for value in dt],
        }
    )


def forecast_series(
    history: pd.DataFrame,
    horizon_days: int,
    promotion_lift_pct: float = 0,
    demand_spike_pct: float = 0,
    price_change_pct: float = 0,
) -> ForecastOutput:
    if history.empty:
        raise ValueError("No sales history available for this selection.")
    frame = history.copy()
    frame["date"] = pd.to_datetime(frame["date"])
    frame = frame.groupby("date", as_index=False).agg(units=("units", "sum"), promotion=("promotion", "max"))
    frame = frame.sort_values("date")
    full_dates = pd.date_range(frame["date"].min(), frame["date"].max(), freq="D")
    frame = frame.set_index("date").reindex(full_dates, fill_value=0).rename_axis("date").reset_index()

    origin = frame["date"].min()
    x_train = _features(frame["date"], frame["promotion"], origin)
    y_train = frame["units"].astype(float)
    model = Ridge(alpha=10.0)
    model.fit(x_train, y_train)
    fitted = np.maximum(0, model.predict(x_train))

    future_dates = pd.date_range(frame["date"].max() + pd.Timedelta(days=1), periods=horizon_days, freq="D")
    future_promo = pd.Series(np.full(horizon_days, promotion_lift_pct != 0))
    x_future = _features(pd.Series(future_dates), future_promo, origin)
    prediction = np.maximum(0, model.predict(x_future))
    prediction *= 1 + promotion_lift_pct / 100
    prediction *= 1 + demand_spike_pct / 100
    prediction *= max(0.0, 1.0 - (price_change_pct / 100) * 1.5)  # Elasticity of -1.5

    residual_std = float(np.std(y_train - fitted))
    margin = max(1.0, 1.96 * residual_std)
    result = pd.DataFrame(
        {
            "date": future_dates.date,
            "predicted_units": prediction.round(2),
            "lower_bound": np.maximum(0, prediction - margin).round(2),
            "upper_bound": (prediction + margin).round(2),
        }
    )
    mae = float(np.mean(np.abs(y_train - fitted)))
    nonzero = y_train != 0
    mape = float(np.mean(np.abs((y_train[nonzero] - fitted[nonzero]) / y_train[nonzero])) * 100) if nonzero.any() else 0
    return ForecastOutput(result, {"mae": round(mae, 2), "mape": round(mape, 2)})
