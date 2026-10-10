"""Environment-driven configuration. Secrets are read here only and never logged."""
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    provider_mode: str
    demo_fallback: bool
    aws_region: str
    location_api_key: str
    weather_key: str
    weather_base: str
    overpass_url: str
    stac_url: str
    bedrock_model: str
    open_meteo_url: str

    @property
    def has_location(self) -> bool:
        return bool(self.location_api_key)

    @property
    def has_weather(self) -> bool:
        return bool(self.weather_key)

    @property
    def real_enabled(self) -> bool:
        return self.provider_mode == "real"


def load_settings() -> Settings:
    env = os.environ.get
    return Settings(
        provider_mode=env("PROVIDER_MODE", "demo").lower(),
        demo_fallback=env("ENABLE_DEMO_FALLBACK", "true").lower() != "false",
        aws_region=env("AWS_REGION", "ap-south-1"),
        location_api_key=env("AWS_LOCATION_API_KEY", ""),
        weather_key=env("WEATHERAPI_KEY", ""),
        weather_base=env("WEATHERAPI_BASE_URL", "https://api.weatherapi.com/v1"),
        overpass_url=env("OVERPASS_URL", "https://overpass-api.de/api/interpreter"),
        stac_url=env("PLANETARY_COMPUTER_STAC_URL",
                     "https://planetarycomputer.microsoft.com/api/stac/v1"),
        bedrock_model=env("BEDROCK_MODEL_ID", ""),
        open_meteo_url=env("OPEN_METEO_URL", "https://api.open-meteo.com/v1/forecast"),
    )
