from datetime import UTC, date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class Store(Base):
    __tablename__ = "stores"
    id: Mapped[int] = mapped_column(primary_key=True)
    store_code: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    region: Mapped[str] = mapped_column(String(80), default="Unknown")
    sales: Mapped[list["Sale"]] = relationship(back_populates="store")


class Product(Base):
    __tablename__ = "products"
    id: Mapped[int] = mapped_column(primary_key=True)
    product_code: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    category: Mapped[str] = mapped_column(String(80), default="General")
    unit_cost: Mapped[float] = mapped_column(Float, default=0)
    current_stock: Mapped[float] = mapped_column(Float, default=0)
    sales: Mapped[list["Sale"]] = relationship(back_populates="product")


class Promotion(Base):
    __tablename__ = "promotions"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    discount_pct: Mapped[float] = mapped_column(Float, default=0)
    store_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    product_code: Mapped[str | None] = mapped_column(String(50), nullable=True)


class Sale(Base):
    __tablename__ = "sales"
    __table_args__ = (UniqueConstraint("date", "store_id", "product_id", name="uq_sale_day_item"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    store_id: Mapped[int] = mapped_column(ForeignKey("stores.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    units: Mapped[float] = mapped_column(Float)
    price: Mapped[float] = mapped_column(Float)
    promotion: Mapped[bool] = mapped_column(Boolean, default=False)
    discount_pct: Mapped[float] = mapped_column(Float, default=0)
    store: Mapped[Store] = relationship(back_populates="sales")
    product: Mapped[Product] = relationship(back_populates="sales")


class Forecast(Base):
    __tablename__ = "forecasts"
    __table_args__ = (UniqueConstraint("run_id", "date", "store_id", "product_id", name="uq_forecast_run_item"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[str] = mapped_column(String(40), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    date: Mapped[date] = mapped_column(Date, index=True)
    store_id: Mapped[int] = mapped_column(ForeignKey("stores.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    predicted_units: Mapped[float] = mapped_column(Float)
    lower_bound: Mapped[float] = mapped_column(Float)
    upper_bound: Mapped[float] = mapped_column(Float)
    scenario: Mapped[str] = mapped_column(String(40), default="baseline")


class DatasetMetadata(Base):
    __tablename__ = "dataset_metadata"
    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    row_count: Mapped[int] = mapped_column(Integer)
    column_count: Mapped[int] = mapped_column(Integer, default=0)
    product_count: Mapped[int] = mapped_column(Integer)
    store_count: Mapped[int] = mapped_column(Integer)
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    missing_values: Mapped[int] = mapped_column(Integer, default=0)
    duplicate_records: Mapped[int] = mapped_column(Integer, default=0)
    invalid_records: Mapped[int] = mapped_column(Integer, default=0)
    data_quality_score: Mapped[float] = mapped_column(Float, default=100.0)
    forecast_readiness: Mapped[float] = mapped_column(Float, default=100.0)
    category_count: Mapped[int] = mapped_column(Integer, default=0)
    promotion_coverage_pct: Mapped[float] = mapped_column(Float, default=0.0)
