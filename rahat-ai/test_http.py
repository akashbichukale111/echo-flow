import httpx
try:
    data = {
        "origin": {"lat": 18.152, "lon": 74.576},
        "destination": {"lat": 18.158, "lon": 74.584},
        "travelMode": "rider",
        "maxDetourPct": 40,
        "sun": {"altitudeDeg": 45.1, "azimuthDeg": 120.3}
    }
    r = httpx.post("http://127.0.0.1:8005/api/real/analyze", json=data, timeout=60.0)
    print("STATUS:", r.status_code)
    print("BODY:", r.text[:500])
except Exception as e:
    print("Error:", e)
