import os
from pathlib import Path

os.environ["DATABASE_URL"] = "sqlite:///./test_retailpulse.db"

from fastapi.testclient import TestClient

from app.main import app


def test_health():
    with TestClient(app) as client:
        response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_upload_forecast_and_analytics_workflow():
    sample = Path(__file__).parents[2] / "sample_data" / "sample_sales.csv"
    with TestClient(app) as client:
        with sample.open("rb") as file:
            upload = client.post("/api/upload-sales", files={"file": ("sample_sales.csv", file, "text/csv")})
        assert upload.status_code == 200
        assert upload.json()["rows_processed"] > 0

        analytics = client.get("/api/analytics")
        assert analytics.status_code == 200
        assert analytics.json()["kpis"]["units"] > 0

        generated = client.post("/api/forecasts", json={"horizon_days": 7, "promotion_lift_pct": 10})
        assert generated.status_code == 200
        assert generated.json()["forecasts_created"] > 0

        latest = client.get("/api/forecasts/latest")
        assert len(latest.json()) == generated.json()["forecasts_created"]
        assert client.get("/api/analytics").json()["alerts"]
