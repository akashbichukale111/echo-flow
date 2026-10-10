# Data sources and provenance

All four datasets live in `data/raw/` and are parsed **only by the backend**
(`backend/app/data_sources/`). They are real public/government datasets, not necessarily
live municipal telemetry. Timestamps are naive local times in the files and are interpreted as IST.

| Provider | Source label | Cadence used for freshness |
|---|---|---|
| Delhi groundwater | NWDP / Delhi Surface Water & Ground Water Departments | 6 h |
| Maharashtra SCADA | NWDP Maharashtra Surface Water SCADA | 1 h |
| Maharashtra discharge | NWDP Maharashtra Surface Water (reservoir/canal discharge telemetry) | 1 h |
| MIDC schemes | MIDC Water Supply Schemes (Government of Maharashtra) | none (baseline) |

Freshness: `CURRENT` only when age ≤ 2 × cadence, otherwise `STALE`; baseline is `UNKNOWN`.
The word LIVE is never produced.

Normalised observation fields: `timestamp, source, source_type ("PUBLIC DATA"), data_label,
station_id, station_name, latitude, longitude, state, district, parameter, raw_parameter,
category, value, unit, value_si, unit_si, confidence, note, freshness`.

Parsing safety: size cap (25 MB), required-column checks, tolerant numerics (`NA`, blanks,
text → missing), invalid rows skipped and counted in `quality`, path confinement to `data/raw`,
no export path (so no CSV formula-injection surface).

Unit conversions are explicit: 1 cusec = 0.0283168 m³/s = 2,446,576 L/day; ft → m ×0.3048.

Known data caveats surfaced in the UI: groundwater sign/datum not stated; SCADA levels have
no datum and are not storage; SCADA latest canal gates sum to a non-zero value while
"Downstream Discharge (Canal)" reads 0; the discharge file reports zero for every gate;
MIDC contains duplicate scheme names, text capacity values and industrial+domestic splits that
do not match utilisation; MIDC has no coordinates (`data/reference/` supplies approximate
town centroids, clearly labelled).
