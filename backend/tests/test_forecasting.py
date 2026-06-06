import pandas as pd

from app.forecasting import forecast_series


def history(days=120):
    dates = pd.date_range("2025-01-01", periods=days)
    return pd.DataFrame({"date": dates, "units": [20 + (i % 7) * 2 for i in range(days)], "promotion": [i % 20 == 0 for i in range(days)]})


def test_forecast_has_requested_horizon_and_bounds():
    result = forecast_series(history(), 14)
    assert len(result.forecast) == 14
    assert (result.forecast["predicted_units"] >= 0).all()
    assert (result.forecast["upper_bound"] >= result.forecast["lower_bound"]).all()


def test_scenario_increases_forecast():
    baseline = forecast_series(history(), 7).forecast["predicted_units"].sum()
    scenario = forecast_series(history(), 7, promotion_lift_pct=20, demand_spike_pct=10).forecast["predicted_units"].sum()
    assert scenario > baseline

