import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()

@dataclass(frozen=True)
class Settings:
    # demo  = offline seeded workspace (DEMO DATA)
    # pilot = zones anchored to the supplied public datasets; auth required
    mode: str = os.getenv("APP_MODE", "demo")
    database: str = os.getenv("DATABASE_PATH", "waterpulse.sqlite3")
    origins: tuple[str, ...] = tuple(
        item.strip()
        for item in os.getenv(
            "ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080,http://127.0.0.1:8080"
        ).split(",")
        if item.strip()
    )
    rate_limit_per_minute: int = int(os.getenv("RATE_LIMIT_PER_MINUTE", "180"))
    api_token: str = os.getenv("API_TOKEN", "")
    table: str = os.getenv("DYNAMODB_TABLE", "")
    region: str = os.getenv("AWS_REGION", "ap-south-1")
    model: str = os.getenv("BEDROCK_MODEL_ID", "")
    weather_provider: str = os.getenv("WEATHER_PROVIDER", "demo")
    weather_key: str = os.getenv("WEATHER_API_KEY", "")
    imd_key: str = os.getenv("IMD_API_KEY", "")
    cgwb_key: str = os.getenv("CGWB_API_KEY", "")
    # Amazon Location Routes (backend only; never sent to the browser).
    location_key: str = os.getenv("AMAZON_LOCATION_KEY", "")
    location_region: str = os.getenv(
        "AMAZON_LOCATION_REGION", os.getenv("AWS_REGION", "ap-south-1"))

settings = Settings()
