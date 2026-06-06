from pydantic import BaseModel, Field


class ForecastRequest(BaseModel):
    horizon_days: int = Field(default=30, ge=1, le=365)
    store_code: str | None = None
    product_code: str | None = None
    promotion_lift_pct: float = Field(default=0, ge=-100, le=500)
    demand_spike_pct: float = Field(default=0, ge=-100, le=500)
    price_change_pct: float = Field(default=0, ge=-100, le=500)


class StockUpdate(BaseModel):
    product_code: str
    current_stock: float = Field(ge=0)


class AssistantChatRequest(BaseModel):
    question: str = Field(min_length=2, max_length=1000)
