from config import load_settings
from location import LocationService

s = load_settings()
loc = LocationService(s)

origin = (18.155, 74.580) # approx YOU ARE HERE
dest = (18.156, 74.581) # approx DESTINATION

try:
    routes, ev = loc.routes(origin, dest, "Scooter")
    print(ev)
except Exception as e:
    print("Error:", e)
