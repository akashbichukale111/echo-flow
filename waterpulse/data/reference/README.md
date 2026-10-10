# Reference placement data (NOT observations)

`midc_scheme_approx_locations.csv` gives each MIDC scheme an approximate map
position at the centroid of the town named in the scheme. The MIDC dataset
itself contains **no coordinates**. These positions exist only so schemes can be
shown on the map; they are labelled `APPROXIMATE TOWN CENTROID` everywhere and
carry LOW confidence. They are not plant locations, and no water value is
derived from them. Schemes without a clearly identifiable town are left
unplaced on purpose. Edit or extend this file with surveyed coordinates if you
have them.
