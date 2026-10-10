# Transparent deterministic model

Coordinates are synthetic local metres, anchored near Hinjewadi. They are not
surveyed road coordinates. All edge lengths use local Euclidean distance.

## Solar

Fractional-year declination and equation-of-time approximation use UTC timestamp,
latitude, and longitude. Elevation is geometric, without atmospheric refraction.
The direct solar weight is max(0, sin(elevation)).

## Shade

Each segment is sampled at 24 midpoint locations. A sample is shaded when it is
inside a synthetic tree canopy circle or a ray toward the sun intersects a
synthetic building within height/tan(elevation).

Tree canopy is a fixed ground-cover approximation. The rendered spherical trees
are illustrative, not a physically equivalent canopy-transmission model.
Road orientation affects where the samples lie relative to geometry.
The model is not validated against measurements.

## Environmental exposure

A = max(temperature_c - 24, 0) × 0.10
    + max(humidity_pct - 40, 0) × 0.006

S = 2 × max(0, sin(solar_elevation))

Segment exposure = duration_minutes × [A + S × (1 - shade_ratio)]

The contribution ledger separates ambient moving load, unshaded solar moving
load, shade reduction, and traffic-delay load. It reconciles exactly to total
exposure. Coefficients are illustrative, not calibrated.

Units are arbitrary environmental exposure units—not percentages or a medical
score. The model omits wind, radiant heat exchange, clothing, physiology,
acclimatization, metabolic load, and observed surface temperatures.

## Accumulation and rest

Historical exposure is nondecreasing. Shade reduces the rate at which future
exposure accumulates. A sheltered rest interval uses 0.4 × A per minute and does
not erase prior exposure. This coefficient is demonstrative, not medical.

Rest is added only if a route contains an open rest POI. Otherwise rest_unavailable
is returned. Rest interval preference produces a warning rather than a guaranteed
stop schedule. Detour allowance constrains travel time, excluding intentional rest.

## Routing

A nonnegative cost label-setting search retains nondominated (cost, travel-time)
labels at each junction. The fastest solution establishes a travel-time budget
for the other objectives. Complexity is capped with a visible failure.

Fastest edge cost = minutes + distance_metres / 10000

Thermal-safe adds thermal_weight × exposure and, when requested, an unshaded
travel-time penalty.

Balanced additionally subtracts a bounded relief benefit from the base edge cost.
The maximum benefit is 80% of base edge cost, so negative cycles cannot arise.

All three solutions can legitimately be identical. No alternatives are fabricated.

## Relief

Distance and extra travel time use graph paths, not straight-line proximity.
Closed stations and unmet requested amenities are filtered before ranking.
Ranking uses approach time, approach exposure, extra travel time, and small
explicit amenity benefits. It does not imply verified availability.

## Time limitation

Every route calculation uses a departure-time environmental snapshot for its
segments. Time-slider changes recompute the snapshot. A user-confirmed live-trip
reassessment advances the timestamp using elapsed simulated minutes. This is not
a fully time-dependent route optimizer.

## AI

The deterministic validator checks finite, nonnegative metrics and reconciles the
exposure ledger before explanation. Bedrock cannot write route metrics. Its output
is isolated as explanation text and receives a basic output guard, not a claim
of complete factual or semantic verification.
