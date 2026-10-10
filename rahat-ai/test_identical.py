import httpx
url = "http://localhost:8010/api/real/analyze"
body = {
    "origin": {"lat": 18.152, "lon": 74.576},
    "destination": {"lat": 18.152, "lon": 74.576},
    "travelMode": "rider"
}
try:
    r = httpx.post(url, json=body, timeout=60.0)
    data = r.json()
    print("OK?", data.get("ok"))
    print("Routes:", [rt.get("sourceType") for rt in data.get("routes", [])])
except Exception as e:
    print("Error:", e)
