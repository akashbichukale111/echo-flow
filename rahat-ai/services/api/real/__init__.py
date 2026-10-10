"""RAHAT real-data layer: normalized models, real providers, deterministic engines.

Every provider returns normalized models tagged with sourceType; when a real provider fails the
demo provider answers and the result is tagged DEMO DATA (never silently labelled real).
"""

import logging as _logging

# httpx/httpcore log full request URLs at INFO, and WeatherAPI / Amazon Location carry the API key
# in the query string. Keep those loggers quiet so credentials can never reach logs.
for _name in ("httpx", "httpcore"):
    _logging.getLogger(_name).setLevel(_logging.WARNING)
