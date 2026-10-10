"""Tiny TTL cache + per-host throttle so public APIs (Overpass, STAC) are not hammered."""
import threading
import time


class TTLCache:
    def __init__(self, ttl=300.0, max_items=256, clock=time.monotonic):
        self.ttl, self.max, self.clock = ttl, max_items, clock
        self._d, self._lock = {}, threading.Lock()

    def get(self, key):
        with self._lock:
            hit = self._d.get(key)
            if not hit:
                return None
            if self.clock() - hit[0] > self.ttl:
                self._d.pop(key, None)
                return None
            return hit[1]

    def set(self, key, value):
        with self._lock:
            if len(self._d) >= self.max:
                self._d.pop(next(iter(self._d)))
            self._d[key] = (self.clock(), value)


class Throttle:
    """Minimum spacing between calls to one upstream."""
    def __init__(self, min_interval=1.0, clock=time.monotonic, sleep=time.sleep):
        self.min, self.clock, self.sleep = min_interval, clock, sleep
        self._last, self._lock = 0.0, threading.Lock()

    def wait(self):
        with self._lock:
            gap = self.min - (self.clock() - self._last)
            if gap > 0:
                self.sleep(gap)
            self._last = self.clock()


def round_key(*vals, nd=3):
    return tuple(round(v, nd) if isinstance(v, float) else v for v in vals)
