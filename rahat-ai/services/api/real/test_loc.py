from config import load_settings
from location import LocationService
from service import RealEngine
import json

origin = (18.151, 74.577)
dest = (18.158, 74.585)

engine = RealEngine()
res = engine.analyze(origin, dest)

print(json.dumps(res, indent=2))
