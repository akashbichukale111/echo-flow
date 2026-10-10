import httpx
try:
    r = httpx.get("http://127.0.0.1:8005/api/real/status")
    print("8005:", r.status_code, r.text)
except Exception as e:
    print("8005 Error:", e)

try:
    r = httpx.get("http://127.0.0.1:8000/api/real/status")
    print("8000:", r.status_code, r.text)
except Exception as e:
    print("8000 Error:", e)
