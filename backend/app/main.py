from contextlib import asynccontextmanager
import functools
import inspect
import logging

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from .ai_assistant import answer_business_question
from .config import settings
from .database import get_db
from .logging_config import configure_logging
from .migrations import run_migrations
from .models import Product, Sale, Forecast, Store, DatasetMetadata
from .schemas import AssistantChatRequest, ForecastRequest, StockUpdate
from .services import analytics_summary, generate_forecasts, import_sales_csv, latest_forecast


configure_logging()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    # run_migrations()
    yield


app = FastAPI(title=settings.app_name, version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)


def error_response(message: str, status_code: int = 400, **extra):
    return JSONResponse(status_code=status_code, content={"success": False, "error": message, **extra})


def api_guard(endpoint_name: str):
    def decorator(fn):
        @functools.wraps(fn)
        async def async_wrapper(*args, **kwargs):
            try:
                if inspect.iscoroutinefunction(fn):
                    return await fn(*args, **kwargs)
                return fn(*args, **kwargs)
            except HTTPException as exc:
                logger.warning(
                    "Handled API error",
                    extra={"event": endpoint_name, "endpoint": endpoint_name, "stage": "http_exception"},
                )
                return error_response(str(exc.detail), exc.status_code)
            except Exception as exc:
                db = kwargs.get("db")
                if db is not None:
                    try:
                        db.rollback()
                    except Exception:
                        pass
                logger.exception(
                    "Unhandled API error",
                    extra={"event": endpoint_name, "endpoint": endpoint_name, "stage": getattr(exc, "stage", "exception")},
                )
                status_code = 400 if endpoint_name == "upload" else 500
                extra = {}
                validation_report = getattr(exc, "validation_report", None)
                if validation_report is not None:
                    extra["validation_report"] = validation_report
                if getattr(exc, "stage", None):
                    extra["stage"] = exc.stage
                return error_response(str(exc), status_code, **extra)

        return async_wrapper

    return decorator


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    if request.url.path.startswith("/api/"):
        logger.warning("Request validation failed", extra={"event": "validation", "endpoint": request.url.path})
        return error_response("Request validation failed.", 422, details=exc.errors())
    return JSONResponse(status_code=422, content={"detail": exc.errors()})


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    if request.url.path.startswith("/api/"):
        return error_response(str(exc.detail), exc.status_code)
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.get("/api/health")
def health():
    try:
        return {"status": "ok", "service": settings.app_name}
    except Exception as e:
        logger.exception("Endpoint failed")
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})
@app.post("/api/upload-sales")
@api_guard("upload")
async def upload_sales(file: UploadFile = File(...), validate_only: bool = Form(False), db: Session = Depends(get_db)):
    try:
        if not file.filename or not file.filename.lower().endswith(".csv"):
            raise HTTPException(400, "Upload must be a CSV file.")

        logger.info("File received", extra={"event": "upload", "uploaded_filename": file.filename})
        content = await file.read()
        logger.info("File read", extra={"event": "upload", "uploaded_filename": file.filename, "rows": len(content)})
        result = import_sales_csv(content, db, validate_only=validate_only)
        return {"success": True, **result}
    except Exception as e:
        logger.exception("Endpoint failed")
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})


@app.post("/api/reset")
@api_guard("reset")
def reset_database(db: Session = Depends(get_db)):
    try:
        for table in [Forecast, Sale, Product, Store, DatasetMetadata]:
            db.execute(table.__table__.delete())
        db.commit()
        return {"success": True}
    except Exception as e:
        logger.exception("Endpoint failed")
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})


@app.post("/api/forecasts")
@api_guard("forecasts")
def create_forecasts(request: ForecastRequest, db: Session = Depends(get_db)):
    try:
        return generate_forecasts(db, request)
    except Exception as e:
        logger.exception("Endpoint failed")
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})


@app.get("/api/forecasts/latest")
@api_guard("forecasts_latest")
def get_latest_forecast(db: Session = Depends(get_db)):
    try:
        return latest_forecast(db)
    except Exception as e:
        logger.exception("Endpoint failed")
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})


@app.get("/api/analytics")
@api_guard("analytics")
def get_analytics(db: Session = Depends(get_db)):
    try:
        return analytics_summary(db)
    except Exception as e:
        logger.exception("Endpoint failed")
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})


@app.get("/api/profile")
@api_guard("profile")
def get_profile(db: Session = Depends(get_db)):
    try:
        analytics = analytics_summary(db)
        return {"success": True, "profile": analytics.get("profile")}
    except Exception as e:
        logger.exception("Endpoint failed")
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})


@app.get("/api/insights")
@api_guard("insights")
def get_insights(db: Session = Depends(get_db)):
    try:
        analytics = analytics_summary(db)
        if not analytics.get("has_data"):
            return {"success": True, "insights": []}
        kpis = analytics["kpis"]
        insights = []
        if analytics.get("stores"):
            store = sorted(analytics["stores"], key=lambda row: row["revenue"], reverse=True)[0]
            share = (float(store["revenue"]) / float(kpis["revenue"]) * 100) if kpis["revenue"] else 0
            insights.append({
                "observation": f"Store {store['store_code']} generates {share:.1f}% of revenue.",
                "impact": "Business performance depends heavily on the top location.",
                "recommendation": "Compare its product mix and promotion cadence against lower-performing stores.",
            })
        if analytics.get("products"):
            product = sorted(analytics["products"], key=lambda row: row["revenue"], reverse=True)[0]
            insights.append({
                "observation": f"Product {product['product_code']} is the top revenue SKU.",
                "impact": "Availability of this SKU has a direct effect on executive KPIs.",
                "recommendation": "Protect safety stock and monitor forecast demand before each replenishment cycle.",
            })
        if analytics.get("alerts"):
            risks = [item for item in analytics["alerts"] if item["status"] == "stockout-risk"]
            if risks:
                insights.append({
                    "observation": f"{len(risks)} products are at stockout risk.",
                    "impact": "The business may lose revenue during the forecast window.",
                    "recommendation": f"Prioritize replenishment for {risks[0]['product_code']}.",
                })
        return {"success": True, "insights": insights}
    except Exception as e:
        logger.exception("Endpoint failed")
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})


@app.post("/api/assistant/chat")
@api_guard("ai_assistant")
def assistant_chat(request: AssistantChatRequest, db: Session = Depends(get_db)):
    try:
        return answer_business_question(db, request.question)
    except Exception as e:
        logger.exception("Endpoint failed")
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})


@app.patch("/api/products/stock")
@api_guard("products_stock")
def update_stock(payload: StockUpdate, db: Session = Depends(get_db)):
    try:
        product = db.scalar(select(Product).where(Product.product_code == payload.product_code))
        if not product:
            raise HTTPException(404, "Product not found.")
        product.current_stock = payload.current_stock
        db.commit()
        return {"product_code": product.product_code, "current_stock": product.current_stock}
    except Exception as e:
        logger.exception("Endpoint failed")
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})
