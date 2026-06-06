CREATE TABLE stores (
  id SERIAL PRIMARY KEY,
  store_code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(120) NOT NULL,
  region VARCHAR(80) NOT NULL
);
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  product_code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(120) NOT NULL,
  category VARCHAR(80) NOT NULL,
  unit_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
  current_stock DOUBLE PRECISION NOT NULL DEFAULT 0
);
CREATE TABLE promotions (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  discount_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  store_code VARCHAR(50),
  product_code VARCHAR(50)
);
CREATE TABLE sales (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  store_id INTEGER NOT NULL REFERENCES stores(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  units DOUBLE PRECISION NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  promotion BOOLEAN NOT NULL DEFAULT FALSE,
  discount_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  UNIQUE(date, store_id, product_id)
);
CREATE TABLE forecasts (
  id SERIAL PRIMARY KEY,
  run_id VARCHAR(40) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  date DATE NOT NULL,
  store_id INTEGER NOT NULL REFERENCES stores(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  predicted_units DOUBLE PRECISION NOT NULL,
  lower_bound DOUBLE PRECISION NOT NULL,
  upper_bound DOUBLE PRECISION NOT NULL,
  scenario VARCHAR(40) NOT NULL DEFAULT 'baseline',
  UNIQUE(run_id, date, store_id, product_id)
);
CREATE INDEX ix_sales_date ON sales(date);
CREATE INDEX ix_forecasts_run_id ON forecasts(run_id);

