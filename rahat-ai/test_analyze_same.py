import sys
import os
import json
from dotenv import load_dotenv

load_dotenv()
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "services", "api")))

from real.service import RealEngine
re = RealEngine()

# Same coordinates
origin = (18.162, 74.586)
dest = (18.162, 74.586)

try:
    print(f"Calling analyze origin={origin} dest={dest}...")
    res = re.analyze(origin, dest, travel="rider")
    print("SUCCESS", res["ok"])
    if not res["ok"]:
        print("ERROR:", res.get("error"))
    else:
        for r in res["routes"]:
            print(f"Route {r['id']}: type={r['sourceType']} length={len(r['coords'])}")
except Exception as e:
    import traceback
    traceback.print_exc()
