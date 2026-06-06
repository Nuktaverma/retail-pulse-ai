from __future__ import annotations

import logging
from pathlib import Path

from alembic import command
from alembic.config import Config

from .config import settings


logger = logging.getLogger(__name__)


def run_migrations() -> None:
    base_dir = Path(__file__).resolve().parents[1]
    config = Config(str(base_dir / "alembic.ini"))
    config.set_main_option("script_location", str(base_dir / "alembic"))
    config.set_main_option("sqlalchemy.url", settings.database_url)
    logger.info("Running database migrations", extra={"event": "migration"})
    command.upgrade(config, "head")
