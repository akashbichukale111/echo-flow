# WATERPULSE AI — 3–5 minute judge demo

**Story to land:** Predict → Explain → Simulate → Decide → Verify.
**Honesty line to say out loud:** *The four supplied datasets are real public/government
datasets, but they are not necessarily live municipal telemetry. Everything the datasets
cannot provide is labelled SIMULATED OPERATIONAL DATA.*

Start: `./scripts/dev.sh` → http://127.0.0.1:5173 (PILOT workspace is selected by default
when `APP_MODE=pilot`; use the top-bar switch to compare with the DEMO workspace).

| # | Minute | Do | Say / point at |
|---|--------|----|----------------|
| 1 | 0:00 | Open **Control Room** | Product name, tagline, SEE→VERIFY loop, honesty banner |
| 2 | 0:20 | Select **Indapur MIDC supply zone** (top bar) | Zone is anchored to a real MIDC scheme (demand = its published utilisation, 🔵 REAL GOVERNMENT BASELINE) |
| 3 | 0:40 | **Water Buffer** and **Shortage Clock** cards | "2D 07H, action window 1D 07H — a MODEL ESTIMATE under stated assumptions, not a physical countdown" |
| 4 | 1:00 | Balance card | Storage + Supply − Gross withdrawal = Net drawdown; every input carries its tier badge (🟠 simulated vs 🔵 baseline) |
| 5 | 1:20 | **Evidence** page → *Real public data near this zone* | Nearby SCADA station (Ujjani), observed timestamp, **STALE DATA** flag — we show age rather than pretend it is live |
| 6 | 1:50 | Switch zone to **North-West Delhi locality** | Real Delhi groundwater (DSIIDC) with freshness; "context only — never converted to storage" |
| 7 | 2:10 | Control Room → **Why is this happening?** | Calculated drivers first; nearby public telemetry as *context, not proof* |
| 8 | 2:30 | **What-If** | No action vs tanker vs loss intervention vs redistribution, side by side, assumptions + confidence; "conditional model outputs" |
| 9 | 3:00 | **Tanker Intelligence** | Route labelled ROUTED ESTIMATE (Amazon Location, if key set) or STRAIGHT-LINE (NOT A ROAD ROUTE); no live traffic/GPS claim |
|10 | 3:20 | **Action Center** → create draft → **Approve** with rationale | Human approval is enforced server-side; no simulation can execute itself |
|11 | 3:45 | Record execution → **Verification** | Before/after buffer, storage, supply, demand, loss; "SIMULATED VERIFICATION" vs "OPERATOR-ENTERED VERIFICATION"; never causal proof |
|12 | 4:20 | **Evidence** → Inspect a record; Settings → Export | Per-record source, type, label, confidence, timestamp; full audit trail |

Questions to expect: *Is this live data?* (No — files are archived public telemetry; ages are shown.)
*Where does storage come from?* (Operator/simulated assumption; no storage is derived from water level.)
*Does AI decide?* (No: Bedrock only explains; the deterministic engine is authoritative; a human approves.)
