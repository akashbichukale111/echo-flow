import sys
import os
import json
from dotenv import load_dotenv

load_dotenv()
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "services", "api")))

from real.service import RealEngine

re = RealEngine()

# Roughly the coordinates from the screenshot for "YOU ARE HERE" and "DESTINATION" in Baramati
# User is at ~18.152, 74.576. Destination is ~18.158, 74.584.
origin = (18.152, 74.576)
dest = (18.158, 74.584)

try:
    print(f"Calling analyze origin={origin} dest={dest}...")
    res = re.analyze(origin, dest, travel="rider")
    print("SUCCESS", res["ok"])
    if not res["ok"]:
        print("ERROR:", res.get("error"))
    else:
        for r in res["routes"]:
            print(f"Route {r['id']}: type={r['sourceType']}")
except Exception as e:
    import traceback
    traceback.print_exc()
