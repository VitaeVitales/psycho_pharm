from datetime import datetime
from typing import Optional


def parse_iso_time(value: str | None) -> Optional[datetime]:
    """Унифицированный парсер ISO8601 дат, поддерживает Z."""
    if not value:
        return None

    if isinstance(value, str) and value.endswith("Z"):
        value = value[:-1] + "+00:00"

    return datetime.fromisoformat(value)



