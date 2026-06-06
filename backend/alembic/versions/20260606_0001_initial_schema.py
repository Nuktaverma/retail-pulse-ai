"""initial schema with idempotent column hardening

Revision ID: 20260606_0001
Revises: 
Create Date: 2026-06-06
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20260606_0001"
down_revision = None
branch_labels = None
depends_on = None


def _table_names() -> set[str]:
    return set(inspect(op.get_bind()).get_table_names())


def _columns(table_name: str) -> set[str]:
    if table_name not in _table_names():
        return set()
    return {column["name"] for column in inspect(op.get_bind()).get_columns(table_name)}


def _add_column_if_missing(table_name: str, column: sa.Column) -> None:
    if table_name in _table_names() and column.name not in _columns(table_name):
        op.add_column(table_name, column)


def upgrade() -> None:
    tables = _table_names()

    if "stores" not in tables:
        op.create_table(
            "stores",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("store_code", sa.String(length=50), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("region", sa.String(length=80), nullable=False, server_default="Unknown"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("store_code"),
        )
        op.create_index("ix_stores_store_code", "stores", ["store_code"])
    else:
        _add_column_if_missing("stores", sa.Column("name", sa.String(length=120), nullable=False, server_default="Unknown"))
        _add_column_if_missing("stores", sa.Column("region", sa.String(length=80), nullable=False, server_default="Unknown"))

    if "products" not in tables:
        op.create_table(
            "products",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("product_code", sa.String(length=50), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("category", sa.String(length=80), nullable=False, server_default="General"),
            sa.Column("unit_cost", sa.Float(), nullable=False, server_default="0"),
            sa.Column("current_stock", sa.Float(), nullable=False, server_default="0"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("product_code"),
        )
        op.create_index("ix_products_product_code", "products", ["product_code"])
    else:
        _add_column_if_missing("products", sa.Column("name", sa.String(length=120), nullable=False, server_default="Unknown"))
        _add_column_if_missing("products", sa.Column("category", sa.String(length=80), nullable=False, server_default="General"))
        _add_column_if_missing("products", sa.Column("unit_cost", sa.Float(), nullable=False, server_default="0"))
        _add_column_if_missing("products", sa.Column("current_stock", sa.Float(), nullable=False, server_default="0"))

    if "promotions" not in tables:
        op.create_table(
            "promotions",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("start_date", sa.Date(), nullable=False),
            sa.Column("end_date", sa.Date(), nullable=False),
            sa.Column("discount_pct", sa.Float(), nullable=False, server_default="0"),
            sa.Column("store_code", sa.String(length=50), nullable=True),
            sa.Column("product_code", sa.String(length=50), nullable=True),
            sa.PrimaryKeyConstraint("id"),
        )

    if "sales" not in tables:
        op.create_table(
            "sales",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("date", sa.Date(), nullable=False),
            sa.Column("store_id", sa.Integer(), nullable=False),
            sa.Column("product_id", sa.Integer(), nullable=False),
            sa.Column("units", sa.Float(), nullable=False),
            sa.Column("price", sa.Float(), nullable=False),
            sa.Column("promotion", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("discount_pct", sa.Float(), nullable=False, server_default="0"),
            sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
            sa.ForeignKeyConstraint(["store_id"], ["stores.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("date", "store_id", "product_id", name="uq_sale_day_item"),
        )
        op.create_index("ix_sales_date", "sales", ["date"])
        op.create_index("ix_sales_product_id", "sales", ["product_id"])
        op.create_index("ix_sales_store_id", "sales", ["store_id"])
    else:
        _add_column_if_missing("sales", sa.Column("promotion", sa.Boolean(), nullable=False, server_default=sa.false()))
        _add_column_if_missing("sales", sa.Column("discount_pct", sa.Float(), nullable=False, server_default="0"))

    if "forecasts" not in tables:
        op.create_table(
            "forecasts",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("run_id", sa.String(length=40), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("date", sa.Date(), nullable=False),
            sa.Column("store_id", sa.Integer(), nullable=False),
            sa.Column("product_id", sa.Integer(), nullable=False),
            sa.Column("predicted_units", sa.Float(), nullable=False),
            sa.Column("lower_bound", sa.Float(), nullable=False),
            sa.Column("upper_bound", sa.Float(), nullable=False),
            sa.Column("scenario", sa.String(length=40), nullable=False, server_default="baseline"),
            sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
            sa.ForeignKeyConstraint(["store_id"], ["stores.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("run_id", "date", "store_id", "product_id", name="uq_forecast_run_item"),
        )
        op.create_index("ix_forecasts_date", "forecasts", ["date"])
        op.create_index("ix_forecasts_product_id", "forecasts", ["product_id"])
        op.create_index("ix_forecasts_run_id", "forecasts", ["run_id"])
        op.create_index("ix_forecasts_store_id", "forecasts", ["store_id"])
    else:
        _add_column_if_missing("forecasts", sa.Column("scenario", sa.String(length=40), nullable=False, server_default="baseline"))

    if "dataset_metadata" not in tables:
        op.create_table(
            "dataset_metadata",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("row_count", sa.Integer(), nullable=False),
            sa.Column("column_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("product_count", sa.Integer(), nullable=False),
            sa.Column("store_count", sa.Integer(), nullable=False),
            sa.Column("start_date", sa.Date(), nullable=False),
            sa.Column("end_date", sa.Date(), nullable=False),
            sa.Column("missing_values", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("duplicate_records", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("invalid_records", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("data_quality_score", sa.Float(), nullable=False, server_default="100"),
            sa.Column("forecast_readiness", sa.Float(), nullable=False, server_default="100"),
            sa.Column("category_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("promotion_coverage_pct", sa.Float(), nullable=False, server_default="0"),
            sa.PrimaryKeyConstraint("id"),
        )
    else:
        _add_column_if_missing("dataset_metadata", sa.Column("column_count", sa.Integer(), nullable=False, server_default="0"))
        _add_column_if_missing("dataset_metadata", sa.Column("missing_values", sa.Integer(), nullable=False, server_default="0"))
        _add_column_if_missing("dataset_metadata", sa.Column("duplicate_records", sa.Integer(), nullable=False, server_default="0"))
        _add_column_if_missing("dataset_metadata", sa.Column("invalid_records", sa.Integer(), nullable=False, server_default="0"))
        _add_column_if_missing("dataset_metadata", sa.Column("data_quality_score", sa.Float(), nullable=False, server_default="100"))
        _add_column_if_missing("dataset_metadata", sa.Column("forecast_readiness", sa.Float(), nullable=False, server_default="100"))
        _add_column_if_missing("dataset_metadata", sa.Column("category_count", sa.Integer(), nullable=False, server_default="0"))
        _add_column_if_missing("dataset_metadata", sa.Column("promotion_coverage_pct", sa.Float(), nullable=False, server_default="0"))


def downgrade() -> None:
    pass
