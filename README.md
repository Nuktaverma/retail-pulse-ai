# RetailPulse AI - Smart Retail Sales Forecasting Platform

RetailPulse turns historical sales into store/SKU demand forecasts, interactive Plotly dashboards, and inventory actions. It is a full-stack reference implementation designed to run locally in minutes and deploy with PostgreSQL in Docker.

## What is included

- FastAPI API with OpenAPI docs, CSV validation, SQLAlchemy models, analytics, forecasts, and stock updates.
- Ridge time-series model using trend, weekly/yearly seasonality, US holidays, and promotion signals.
- PostgreSQL production configuration with a zero-setup SQLite local default.
- React/Vite operations dashboard with trends, comparisons, what-if scenarios, and inventory alerts.
- Docker Compose, explicit SQL schema, automated backend tests, and reproducible sample data.

## Quick start

### Option A: Docker

```bash
docker compose up --build
```

Open the dashboard at `http://localhost:3000` and API docs at `http://localhost:8000/docs`.

### Option B: Local development

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

In a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. Upload `sample_data/sample_sales.csv`, or generate the full 4,380-row demo dataset first:

```powershell
python sample_data/generate_sample.py
```

## Workflow

1. Upload a CSV from the dashboard. Rows are upserted by date/store/product.
2. Review historical KPIs, sales trends, and store/product comparisons.
3. Set a horizon and optional promotion lift or demand spike in Forecast Studio.
4. Generate forecasts across every store/SKU combination.
5. Use the inventory decision queue to identify stockout risk, overstock, and recommended order quantities.

## CSV contract

Required columns:

| Column | Description |
|---|---|
| `date` | ISO date such as `2025-01-01` |
| `store_id` | Stable store code |
| `product_id` | Stable SKU/product code |
| `sales` | Units sold |
| `price` | Selling price |
| `promotion` | `0` or `1` |

Optional enrichment columns: `store_name`, `region`, `product_name`, `category`, `discount_pct`, `unit_cost`, `current_stock`.

## API endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/health` | Health check |
| `POST` | `/api/upload-sales` | Upload and upsert CSV sales |
| `POST` | `/api/forecasts` | Generate baseline or what-if forecasts |
| `GET` | `/api/forecasts/latest` | Fetch latest run |
| `GET` | `/api/analytics` | KPIs, trends, comparisons, promotion impact, alerts |
| `PATCH` | `/api/products/stock` | Update current SKU stock |

Forecast request example:

```json
{
  "horizon_days": 30,
  "store_code": null,
  "product_code": null,
  "promotion_lift_pct": 15,
  "demand_spike_pct": 5
}
```

## Model and business logic

The model creates a continuous daily series per store/SKU, fills no-sale days with zero, and fits regularized regression against trend, trend squared, weekly Fourier terms, annual Fourier terms, US holiday flags, and historical promotion flags. Prediction intervals use residual variation.

Inventory status compares the latest forecast demand with current stock:

- `stockout-risk`: stock is below forecast demand.
- `overstock`: stock is more than twice forecast demand.
- `healthy`: stock is within the operating range.
- Recommended order: `max(0, forecast demand * 1.15 - current stock)`.

For production, tune safety stock by lead time and service level, add authentication/RBAC, schedule forecast runs, and monitor forecast error by SKU.

## Testing

```powershell
cd backend
pytest -q
```

## Cloud deployment

- **Backend**: deploy `backend/Dockerfile` to Azure Container Apps, AWS ECS, Google Cloud Run, or Render. Set `DATABASE_URL` and `CORS_ORIGINS`.
- **Frontend**: deploy `frontend` to Azure Static Web Apps, Vercel, Netlify, or its Nginx Docker image. Set `VITE_API_URL` at build time.
- **Database**: use managed PostgreSQL and require TLS. Run `database/schema.sql` manually if schema ownership is managed outside the application.
- **Power BI**: connect Power BI to PostgreSQL tables or the `/api/analytics` JSON endpoint. The included Plotly UI covers the same operational views without a separate license.

## Project structure

```text
backend/app/          FastAPI, models, forecasting, and services
backend/tests/        Unit and API tests
database/schema.sql   Portable PostgreSQL schema
frontend/src/         React dashboard
sample_data/          Demo CSV and reproducible generator
docker-compose.yml    Full local production-like stack
```

## Business value

RetailPulse gives planners a shared view of future demand, makes promotion assumptions testable, and translates forecasts into concrete replenishment actions. This reduces lost sales from stockouts, limits excess inventory, and focuses operator attention on the SKUs that need intervention.
