"""Lazy, cached provider registry. Startup never blocks on CSV parsing and a
failing provider degrades only its own endpoints."""
from __future__ import annotations

import threading

from .base import DataUnavailable
from .delhi import DelhiGroundwaterProvider
from .discharge import MaharashtraDischargeProvider
from .midc import MIDCWaterSupplyProvider
from .scada import MaharashtraScadaProvider

_lock = threading.Lock()
_instances: dict[str, object] = {}
_FACTORIES = {
    "groundwater": DelhiGroundwaterProvider,
    "scada": MaharashtraScadaProvider,
    "discharge": MaharashtraDischargeProvider,
    "water_supply": MIDCWaterSupplyProvider,
}


def get(name: str):
    with _lock:
        if name not in _instances:
            _instances[name] = _FACTORIES[name]()
        return _instances[name]


def reset() -> None:
    with _lock:
        _instances.clear()


def override(name: str, provider) -> None:
    """Test hook: install a provider built from a custom file."""
    with _lock:
        _instances[name] = provider


def safe(call, source: str):
    """Run a provider call; convert failures into the structured payload."""
    try:
        return call()
    except DataUnavailable as error:
        return error.payload()
    except (OSError, ValueError, KeyError) as error:  # unexpected parse/file failure
        return DataUnavailable(source, f"Provider failed: {type(error).__name__}").payload()
