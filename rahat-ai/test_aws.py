import os
from dotenv import load_dotenv
import httpx

load_dotenv()
api_key = os.getenv("AWS_LOCATION_API_KEY")
region = os.getenv("AWS_REGION")

url = f"https://routes.geo.{region}.amazonaws.com/v2/routes"

origin = [74.586, 18.162]
dest = [74.586, 18.162]  # Same coordinates

body = {
    "Origin": origin,
    "Destination": dest,
    "TravelMode": "Scooter",
    "LegGeometryFormat": "Simple",
    "MaxAlternatives": 2,
    "DepartNow": True
}
params = {"key": api_key}
print(f"Testing same point {origin} to {dest}")
r = httpx.post(url, json=body, params=params)
print(r.status_code, r.text)
