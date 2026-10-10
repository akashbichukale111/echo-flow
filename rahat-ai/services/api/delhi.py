"""Delhi DEMO city: a schematic grid between Connaught Place and India Gate.

Everything here is DEMO DATA. Node positions are a schematic grid laid on an
approximate geographic frame; they are NOT surveyed roads, and relief points are
NOT real facilities. Real providers replace these classes through providers.py.
"""
import math

from providers import DemoSolarProvider, DemoTrafficProvider, ShadeBase

IG_LAT, IG_LON = 28.6129, 77.2295      # India Gate (public landmark coordinates)
COLS, ROWS, DX, DY = 9, 6, 220, 220     # 1760 m x 1100 m schematic frame
M_LAT = 111320
M_LON = 111320 * math.cos(math.radians(IG_LAT))
LON0 = IG_LON - (COLS - 1) * DX / M_LON
STAMP = "2026-05-15T14:00:00+05:30"

CP_NODE = (ROWS - 1) * COLS          # top-left of the grid
IG_NODE = COLS - 1                   # bottom-right of the grid

LANDMARKS = {CP_NODE: "Connaught Place (demo node)", IG_NODE: "India Gate (demo node)"}

# Searchable places with real approximate coordinates. A place outside the demo
# frame is reported as outside coverage rather than silently moved.
PLACES = [
    ("India Gate", 28.6129, 77.2295), ("Connaught Place", 28.6315, 77.2167),
    ("Janpath", 28.6250, 77.2190), ("Rajpath / Kartavya Path", 28.6150, 77.2240),
    ("Mandi House", 28.6258, 77.2340), ("Pragati Maidan", 28.6180, 77.2460),
    ("AIIMS", 28.5672, 77.2100), ("New Delhi Railway Station", 28.6428, 77.2197),
]

def create_map():
    nodes = []
    for row in range(ROWS):
        for col in range(COLS):
            i = row * COLS + col
            x, y = col * DX, row * DY
            nodes.append({
                "id": i, "name": LANDMARKS.get(i, f"Demo junction {i:02d}"),
                "x": x, "y": y, "lat": IG_LAT + y / M_LAT, "lon": LON0 + x / M_LON,
            })
    edges = []
    for n in nodes:
        r, c = divmod(n["id"], COLS)
        if c < COLS - 1:
            edges.append([n["id"], n["id"] + 1])
        if r < ROWS - 1:
            edges.append([n["id"], n["id"] + COLS])
        if r > 0 and c < COLS - 1 and (r + c) % 2 == 0:   # schematic diagonal arterials
            edges.append([n["id"], n["id"] - COLS + 1])
    # Dense built-up blocks near Connaught Place (top-left), lawns near India Gate.
    buildings = []
    for r in range(ROWS - 1):
        for c in range(COLS - 1):
            density = (r / (ROWS - 1)) * (1 - c / (COLS - 1))
            if density < 0.18:
                continue
            buildings.append({
                "id": f"b-{r}-{c}", "x": c * DX + 38, "y": r * DY + 36,
                "w": 120, "d": 118, "h": 16 + round(60 * density) + (r * 5 + c * 3) % 14,
            })
    trees = []
    for x in range(0, (COLS - 1) * DX + 1, 40):   # Central-Vista-like lawns, south & east
        trees.append({"x": x, "y": 0, "r": 26})
        trees.append({"x": x, "y": DY, "r": 20 if x > 700 else 12})
    for y in range(0, 4 * DY + 1, 40):
        trees.append({"x": (COLS - 1) * DX, "y": y, "r": 24})
    for x in range(660, 1500, 44):
        trees.append({"x": x, "y": 2 * DY, "r": 17})
    for y in range(DY * 3, DY * 5 + 1, 55):      # a shaded avenue near the north-west
        trees.append({"x": 2 * DX, "y": y, "r": 18})
    return {
        "nodes": nodes, "edges": edges, "buildings": buildings, "trees": trees,
        "width": (COLS - 1) * DX, "height": (ROWS - 1) * DY,
        "anchor": (IG_LAT, IG_LON), "city": "Delhi",
        "source": "DEMO DATA",
        "coverage": "Schematic 1.76 km x 1.1 km grid between Connaught Place and India Gate. "
                    "Not surveyed roads.",
        "timestamp": STAMP,
    }

DELHI_MAP = create_map()

class DelhiMapProvider:
    def get(self):
        return DELHI_MAP

class DelhiWeatherProvider:
    def get(self, at):
        h = at.hour + at.minute / 60
        return {
            "temperature_c": round(30 + 9 * max(0, math.sin(math.pi * (h - 6) / 14)), 2),
            "humidity_pct": 35, "source": "DEMO DATA", "timestamp": at.isoformat(),
            "limitations": "Synthetic weather, not a measurement or forecast",
        }

class DelhiShadeProvider(ShadeBase):
    def __init__(self):
        super().__init__(DELHI_MAP)

# (id, node, name, type, water, shade, cooling, rest, tags)
_POIS = [
    ("d1", 36, "Demo water kiosk A", "WATER", True, False, False, False, ["WATER", "FOOD"]),
    ("d2", 37, "Demo canopy walkway", "SHADE", False, True, False, True, ["SHADE", "REST"]),
    ("d3", 29, "Demo metro concourse", "TRANSIT", True, True, True, True,
     ["TRANSIT", "COOLING", "WATER", "PUBLIC FACILITY", "REST"]),
    ("d4", 21, "Demo public toilet block", "PUBLIC FACILITY", True, False, False, False,
     ["PUBLIC FACILITY", "WATER"]),
    ("d5", 31, "Demo shaded bus shelter", "REST", False, True, False, True, ["REST", "SHADE", "TRANSIT"]),
    ("d6", 22, "Demo clinic (not a real hospital)", "HOSPITAL", True, False, True, True,
     ["HOSPITAL", "EMERGENCY", "COOLING", "ESSENTIAL SERVICES"]),
    ("d7", 14, "Demo lawn park", "PARK", True, True, False, True, ["SHADE", "REST", "WATER", "PARK"]),
    ("d8", 6, "Demo cooling centre", "COOLING", True, True, True, True,
     ["COOLING", "WATER", "REST", "EMERGENCY"]),
    ("d9", 15, "Demo fuel & food stop", "OTHER RELIEF", False, False, False, False,
     ["FUEL", "FOOD", "ESSENTIAL SERVICES"]),
    ("d10", 5, "Demo drinking-water point", "WATER", True, True, False, False, ["WATER", "SHADE"]),
    ("d11", 2, "Demo shaded benches", "REST", False, True, False, True, ["REST", "SHADE"]),
    ("d12", 8, "Demo destination water", "WATER", True, True, False, True, ["WATER", "SHADE", "REST"]),
    ("d13", 43, "Demo arcade (cooling)", "COOLING", False, True, True, False, ["COOLING", "SHADE"]),
    ("d14", 41, "Demo help point", "PUBLIC FACILITY", False, False, False, False,
     ["PUBLIC FACILITY", "EMERGENCY"]),
]

class DelhiReliefProvider:
    def get(self):
        return [
            {
                "id": i, "node": n, "name": name, "type": t,
                "water": w, "shade": s, "cooling": c, "rest": r, "tags": tags,
                "lat": DELHI_MAP["nodes"][n]["lat"], "lon": DELHI_MAP["nodes"][n]["lon"],
                "status": "OPEN", "source": "DEMO DATA",
                "verification": "UNVERIFIED DEMO FIXTURE",
                "availability": "Assumed open (demo)",
                "confidence": "Synthetic fixture, not field verified",
                "last_updated": STAMP,
            }
            for i, n, name, t, w, s, c, r, tags in _POIS
        ]

def delhi_providers():
    from providers import Providers
    return Providers(
        DelhiWeatherProvider(), DemoSolarProvider(), DelhiMapProvider(),
        DelhiMapProvider(), DelhiShadeProvider(), DelhiReliefProvider(),
        DemoTrafficProvider(), __import__("providers").DemoSatelliteProvider(),
    )
