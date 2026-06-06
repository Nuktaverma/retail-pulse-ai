from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path


class JsonLogFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key in ("event", "endpoint", "stage", "filename", "rows", "intent", "question"):
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging() -> None:
    root = logging.getLogger()
    if getattr(root, "_retailpulse_configured", False):
        return

    log_dir = Path("logs")
    log_dir.mkdir(exist_ok=True)

    handler = RotatingFileHandler(log_dir / "retailpulse.log", maxBytes=2_000_000, backupCount=5)
    handler.setFormatter(JsonLogFormatter())

    console = logging.StreamHandler()
    console.setFormatter(JsonLogFormatter())

    root.setLevel(logging.INFO)
    root.addHandler(handler)
    root.addHandler(console)
    root._retailpulse_configured = True
