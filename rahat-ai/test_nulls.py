import httpx

url = "http://localhost:8010/api/real/analyze"
body = {
    "origin": {"lat": 18.152, "lon": 74.576},
    "destination": {"lat": 18.152, "lon": 74.576},
    "travelMode": "rider",
    "sun": {"altitudeDeg": None, "azimuthDeg": None}
}
try:
    r = httpx.post(url, json=body, timeout=5.0)
    print("STATUS:", r.status_code)
    print("BODY:", r.text)
except Exception as e:
    print("Error:", e)
