from .domain import Edge, Node, State, now, uid

# SIMULATED assumption: effective catchment draining into Zone A. 1 mm/h over this area = 1 m3/min,
# so the default 80 m3/min corresponds to an 80 mm/h cloudburst. Not surveyed geography.
CATCHMENT_AREA_M2 = 60_000


def graph(mode: str) -> dict:
    if mode == "heat":
        nodes = [
            Node(id="Heat", kind="hazard", x=0, y=0),
            Node(id="Power", kind="power", x=250, y=0),
            Node(id="Transformer", kind="power", x=500, y=0),
            Node(id="Pump", kind="pump", x=750, y=0),
            Node(id="Water", kind="water", x=1000, y=0),
            Node(id="H1", kind="hospital", x=1250, y=-150),
            Node(id="Cooling", kind="shelter", x=1250, y=150),
        ]
        pairs = [
            ("Heat", "Power"), ("Power", "Transformer"),
            ("Transformer", "Pump"), ("Pump", "Water"),
            ("Water", "H1"), ("Water", "Cooling"),
        ]
        edges = [Edge(source=a, target=b, kind="dependency") for a, b in pairs]
    else:
        nodes = [
            Node(id="O", kind="command", x=-250, y=-120),
            Node(id="A", kind="zone", x=0, y=0, population=2800),
            Node(id="B", kind="zone", x=800, y=600, population=1600),
            Node(id="P1", kind="pump", x=200, y=100),
            Node(id="C12", kind="drain", x=600, y=350),
            Node(id="R7", kind="road", x=900, y=500),
            Node(id="R8", kind="road", x=-100, y=-500),
            Node(id="H1", kind="hospital", x=1200, y=0),
            Node(id="S1", kind="shelter", x=300, y=-650),
            Node(id="B5", kind="buffer", x=620, y=0),
            Node(id="B6", kind="buffer", x=1400, y=-400),
        ]
        edges = [
            Edge(source=a, target=b, kind="dependency")
            for a, b in [
                ("P1", "A"), ("A", "C12"), ("C12", "B"),
                ("A", "B5"), ("A", "B6"), ("B5", "R7"),
                ("B", "R7"), ("A", "R8"),
            ]
        ]
        edges += [
            Edge(source=a, target=b, kind="route", minutes=t)
            for a, b, t in [
                ("O", "R7", 4), ("R7", "H1", 4),
                ("O", "R8", 12), ("R8", "H1", 12),
                ("A", "R8", 2), ("B", "R7", 2), ("R8", "S1", 4),
            ]
        ]
    return {
        "coordinate_system": "synthetic local Cartesian metres; not a real map",
        "nodes": [n.model_dump() for n in nodes],
        "edges": [e.model_dump() for e in edges],
    }


def create(mode: str, owner: str) -> dict:
    return {
        "id": uid(),
        "owner": owner,
        "version": 0,
        "state_revision": 0,
        "knowledge_revision": 0,
        "metadata": {
            "name": "FLOOD_HERO_SCENARIO" if mode == "flood" else "HEAT_WATER_HERO_SCENARIO",
            "source_type": "synthetic",
            "timestamp": now(),
            "model_version": "lumped-demonstrator-0.1",
            "confidence": "UNCALIBRATED",
            "units": {"volume": "m3", "flow": "m3/min", "power": "kW", "depth": "m", "time": "min"},
        },
        "state": State(mode=mode).model_dump(),
        "graph": graph(mode),
        "unknown": {
            "name": "C12 blockage" if mode == "flood" else "Transformer derating",
            "low": 0.10 if mode == "flood" else 0.05,
            "high": 0.55 if mode == "flood" else 0.35,
            "verified": False,
        },
        "decision_window_seconds": 900,
        "created_at": now(),
        "runs": [],
        "run": None,
        "approval": None,
        "observations": [],
        "learning": [],
        "audit": [],
        "live_inputs": {},
    }


CANDIDATES = (
    {"id": "B2", "x": 300, "y": 0, "capacity_m3": 9000, "legal": False,
     "connected": True, "exposure": "school use", "recovery_h": 12},
    {"id": "B4", "x": 700, "y": 100, "capacity_m3": 1500, "legal": True,
     "connected": True, "exposure": "low", "recovery_h": 6},
    {"id": "B5", "x": 620, "y": 0, "capacity_m3": 8500, "legal": True,
     "connected": True, "exposure": "low", "recovery_h": 8},
    {"id": "B6", "x": 1400, "y": -400, "capacity_m3": 8500, "legal": True,
     "connected": True, "exposure": "low", "recovery_h": 8},
)
