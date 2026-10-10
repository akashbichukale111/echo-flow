# Amazon Location integration

Resources (already created, us-east-1): map `echo-flow-map`, route calculator `echo-flow-routes`.
Do not create duplicates; reference these names.

## What is wired
| Part | Where | Key |
|---|---|---|
| Map rendering | Browser, MapLibre GL JS → `https://maps.geo.us-east-1.amazonaws.com/maps/v0/maps/echo-flow-map/style-descriptor?key=…` | **Browser key** `VITE_AMAZON_LOCATION_API_KEY` |
| Route calculation | Backend `POST /api/route` → `https://routes.geo.us-east-1.amazonaws.com/routes/v0/calculators/echo-flow-routes/calculate/route?key=…` | **Server key** `AMAZON_LOCATION_API_KEY` |

The legacy v1 style-descriptor and CalculateRoute request shapes were checked against the AWS documentation. They have **not** been
exercised against the live service from the build sandbox (no network, no key). The UI says `MAP LOADED` only after MapLibre's own
`load` event, and a route is shown only when the backend returns status `LIVE`.

## Keys and permissions (do this in the AWS console)
Use **two separate keys**. A browser key is visible to anyone who opens dev tools, so keep it narrow.

1. **Browser map key** — action `geo:GetMap*`, resource `arn:aws:geo:us-east-1:<account-id>:map/echo-flow-map`.
   Add an **HTTP referrer restriction** for your origins, e.g. `http://127.0.0.1:5174/*` and `http://localhost:5174/*`.
2. **Server routing key** — action `geo:CalculateRoute`, resource `arn:aws:geo:us-east-1:<account-id>:route-calculator/echo-flow-routes`.
   Do not put it in any `VITE_*` variable. If it has a referrer restriction, set `AMAZON_LOCATION_REFERER` to a matching value
   (a server request otherwise has no Referer and is refused with HTTP 403).

A key created only for route calculation **cannot render the map**; the UI then reports an authorization failure naming the
missing permission instead of showing a blank panel. These are legacy map/route-calculator resources: a key for the newer
`geo-maps`/`geo-routes` (v2) APIs will not authorise them.

## `.env` (root, git-ignored)
```
AMAZON_LOCATION_API_KEY=<server routing key>
AMAZON_LOCATION_REGION=us-east-1
AMAZON_LOCATION_ROUTE_CALCULATOR=echo-flow-routes
VITE_AMAZON_LOCATION_API_KEY=<browser map key>
VITE_AMAZON_LOCATION_REGION=us-east-1
VITE_AMAZON_LOCATION_MAP_NAME=echo-flow-map
```
Restart both servers after editing. Existing `.env` values are untouched by the dev script.

## Honesty rules in the UI
* Basemap is real Amazon Location data. Everything ECHO-FLOW draws on it is **synthetic**: scenario coordinates are local metres,
  placed as offsets from a visible demo anchor (never treated as latitude/longitude). No real flood polygons, closures,
  hospitals or conditions are drawn.
* Route kinds are distinct: *calculated* (Amazon Location, `DERIVED`, ignores flooding), *simulation-derived* (synthetic network),
  *synthetic illustrative* (dashed), and *not calculated* (failure message, no line).
* Live public data appears on the map only as a labelled query point; sources without geometry (e.g. SACHET alerts) are not plotted.
