import httpx

url = "https://api.weatherapi.com/v1/current.json"
params = {"key": "0b688ee0df004d4093225455260810", "q": "18.152,74.576"}
r = httpx.get(url, params=params)
print(r.status_code, r.text)
