# 🌍 ECHO-FLOW PLATFORM

**An Integrated AI-Driven Environmental Emergency & Disaster Management System**

Welcome to the **ECHO-FLOW PLATFORM**, a unified, multi-module system designed to assist decision-makers, emergency responders, and citizens during environmental crises (such as floods, heatwaves, and structural blockages). 

This project was built to provide **real-time intelligence**, **AI-assisted decision-making**, and **instant citizen assistance** by leveraging powerful AWS services, real-world live APIs, and Generative AI.

---

## 🏗️ The Three Core Modules

The platform is divided into three specialized sub-systems that work together behind a unified proxy:

### 1. 🌐 ECHO-FLOW (Command Center)
**The strategic dashboard for disaster management authorities.**
*   **Purpose:** Provides a macroscopic view of the disaster. Beyond just AI agents, it integrates government/public evidence, deterministic simulations, map/route services, consequence analysis, and strict safety verifications.
*   **Core Technology Engine:** Powered by a Python/NetworkX system graph, deterministic simulation, feasibility checks, consequence/cascade analysis, Red Team evaluations, robustness analysis, Value of Information (VOI), Safety Gates, and final human approval logic.
*   **AI Agent Team (Powered by Amazon Bedrock for Adversarial Reasoning):**
    *   **Counterfactual Agent:** Evaluates and compares the outcomes if specific interventions are made.
    *   **Resilient Route Agent:** Checks emergency evacuation routes and verifies critical-service access.
    *   **Hydro-Relief Agent:** Assesses potential water impact, flooding consequences, and relief/buffer options.
    *   **Coordinator Agent:** Aggregates outputs from all sub-agents to formulate a cohesive, actionable response plan.

### 2. 📱 RAHAT AI (Citizen Survival & SOS)
**The on-the-ground, mobile-first application for citizens navigating crisis zones.**
*   **Citizen Thermal Mobility:** Analyzes real-time environmental exposure. Rather than just finding the shortest path, it calculates the **"FASTEST"**, **"BALANCED"**, and **"RAHAT WAY"** (safe/shaded) routes using live satellite thermal classes and vegetation (NDVI) mapping.
*   **Live Geographic Mapping & Tracking:** Features a highly responsive UI with live GPS tracking, recentering, and debounced Amazon Location Places search. (Never simulated when in Live Mode).
*   **One-Tap Extreme Emergency SOS (AWS Pinpoint):** Designed for extreme duress. Bypassing manual entry modals, a single tap instantly dispatches a **Transactional SMS and Automated Voice Call** containing the citizen's exact live GPS coordinates to their emergency contact, saving crucial seconds.
*   **Strict Determinism (Zero Hallucination):** Routes and relief data are purely deterministic. AI (Amazon Bedrock) is strictly used as an output-guarded explainer to help citizens understand their environment—it never invents navigation paths.

### 3. 💧 WATERPULSE (Hydrological Monitoring)
**The environmental telemetry and forecasting module.**
*   **Purpose:** Monitors water bodies, dam water levels, and river flows.
*   **Features:** Integrates hydro-meteorological data to give early warnings about potential floods, complementing the Echo-Flow Command Center's scenarios.

---

## 📡 Real-World Data & API Integrations

To make the platform highly accurate and applicable to real-world scenarios, we integrate several live data sources and APIs:

1.  **Amazon Location Service API:** Used for rendering live geographic maps (Base maps) and calculating real-time routes (finding paths around flooded areas).
2.  **WeatherAPI & Open-Meteo:** Fetches live weather data, temperature, and heat-index to calculate "Heat Exposure" during citizen navigation in RAHAT AI.
3.  **Overpass API (OpenStreetMap):** Dynamically queries local infrastructure (hospitals, schools, high-ground areas) to automatically generate "Relief Points" on the map.
4.  **NASA Earthdata & Planetary Computer STAC:** Fetches live satellite imagery context. 
    *   *Sentinel-2* (for Vegetation/NDVI indexing to find natural shade).
    *   *Landsat-8* (for observed surface temperature data).

### 🏛️ Indian Government Datasets Used (WATERPULSE)
The Waterpulse module heavily relies on authentic telemetry data from the Government of India, primarily sourced from the **National Water Data Portal (NWDP)** and **Open Government Data (OGD) Platform India**:

*   **Ground Water Level (Telemetry – Hourly), Delhi Surface Water and Ground Water Departments**
    *   *Source:* National Water Informatics Centre (NWIC), Ministry of Jal Shakti.
    *   *File Used:* `gwl_tel_6_hourly_delhi_sw_gw_dl_2026_2030(2).csv` (8,174 rows, 21 columns; 14 stations).
    *   *Usage:* Groundwater station readings, observation time, station location, and evidence freshness.
*   **Water Level and Discharge, SCADA (Hourly), Maharashtra SW**
    *   *Source:* Maharashtra Surface Water Department SCADA dataset (via NWDP).
    *   *File Used:* `maharashtra_scada_relevant_subset(1).csv` (167 rows, 10 columns).
    *   *Usage:* Surface-water discharge readings, gate-flow comparison, and identifying inconsistent readings.
*   **Reservoir Discharge — Bhima–Sina Link Canal, Maharashtra (Telemetry – Hourly)**
    *   *Source:* Maharashtra Surface Water Department (via NWDP).
    *   *File Used:* `reservior_discharge_tel_hr_maharashtra_sw_mh_bhima-sina_link_canal_2026_2030(2).csv` (1,976 rows, 69 columns).
    *   *Usage:* Canal/reservoir gate-discharge history. *(Note: Actual canal flow or leakage cannot be fully proven if gate readings are zero/blank).*
*   **MIDC Water Supply Schemes (Baseline Data: 13-10-2025 to 31-12-2026)**
    *   *Source:* Maharashtra Industrial Development Corporation (MIDC) via OGD Platform India.
    *   *File Used:* `MIDCWaterSupplySchemes(2).csv` (83 rows, 6 columns).
    *   *Usage:* Validates water-supply schemes, capacity/utilisation, and published baseline information. *(Note: This is static baseline data, not a live telemetry feed).*

### 📊 Data & Simulation Status (ECHO-FLOW Command Center)
**Important Note for Demonstration:** The Echo-Flow Command Center currently runs in a **Synthetic Demonstration Mode** (`FLOOD · SYNTHETIC · REV 0`). Data shown on the screen (such as affected population, simulated water depth in Zone A/B, and demo entities) are *simulated inputs* for testing the AI decision-making engine, NOT live flood measurements.

**Data Source Integration Status:**
*   **Amazon Location Service:** *Status: LIVE.* Successfully integrated for map visualization and real-time route calculation.
*   **OpenStreetMap (OSM):** *Status: LIVE.* Used for baseline roads, waterways, and base maps visible in screenshots.
*   **IMD (India Meteorological Department):** *Status: Source Identified.* Planned for rainfall, forecasts, and district warnings (live integration pending).
*   **CWC / C-FLOOD:** *Status: Source Identified.* Planned for river levels, flood forecasts, and inundation evidence (live integration pending).
*   **NDMA SACHET:** *Status: Planned.* Public CAP feed for official disaster alerts (parsing/UI integration pending).
*   **NASA GPM IMERG:** *Status: Source Identified.* Satellite-based rainfall estimates (download/simulation integration pending).
*   **Copernicus Sentinel-1 SAR:** *Status: Researched.* Reference for flood extent via satellite radar (processing pending).

### 📊 Additional Simulated/Derived Data (WATERPULSE)
*   **Weather Observations:** Current weather observations are fetched via third-party services like WeatherAPI (not a government dataset).
*   **Rainfall Category:** Derived directly from real-time weather inputs.
*   **Water Buffer & Shortage Clock:** Model estimates (operational inputs are simulated for disaster scenarios).
*   **Tanker Fleet / GPS / Municipal Demand / Leakage:** Presented as simulated/recommended allocations since live municipal fleet telemetry is not connected.

---

## ☁️ AWS Cloud Architecture (12+ Services)

To demonstrate enterprise-grade scalability, resilience, and security during national emergencies, the ECHO-FLOW platform incorporates a deep AWS Cloud Architecture. For transparency, we have divided this into services that are **currently live in the prototype** versus those **architected for production scaling**.

### 🟢 Currently Implemented & Live in Local Prototype
1.  🧠 **Amazon Bedrock (Claude 3.5):** Integrated for complex adversarial reasoning and Generative AI multi-agent orchestration (Counterfactual, Relief, Coordinator).
2.  🗺️ **Amazon Location Service:** Core GIS engine used extensively across `echo-flow` and `rahat-ai`. Provides live map vector tiles, reverse geocoding (Places API), and exact route calculations for safe evacuations.
3.  📲 **Amazon Pinpoint (SMS & Voice v2):** The backbone of the **RAHAT AI One-Tap SOS**. Programmatically triggers transactional SMS and Automated Voice Calls to verified emergency contacts within seconds of the SOS trigger.
4.  🔐 **AWS IAM (Identity and Access Management):** Enforces strict least-privilege security. Utilizes granular, scoped policies for securely invoking Bedrock models, fetching Location maps, and triggering Pinpoint messages.

### 🏗️ Architected for Production Scaling (Cloud Blueprint)
*The following services are part of our designed production deployment blueprint to handle millions of requests during an actual disaster. They are not active in the local prototype to maintain a fast, offline-capable development environment.*

5.  🔄 **AWS Step Functions:** Orchestrates the multi-agent AI pipeline in the cloud to manage the sequence of AI agents and ensure reliable decision chains.
6.  ⚡ **AWS Lambda:** Serverless compute for lightweight, event-driven background tasks (e.g., parsing incoming NDMA CAP feeds, scheduling automated SOS fallbacks).
7.  🌐 **Amazon API Gateway:** Secures backend REST APIs and implements rate limiting / throttling to ensure the system doesn't crash during traffic spikes.
8.  🚀 **Amazon CloudFront:** A global CDN to cache and deliver the React/Vite frontends (PWA) and map tiles with ultra-low latency on poor mobile networks.
9.  🗄️ **Amazon DynamoDB:** A highly scalable NoSQL database for logging high-speed, unstructured disaster data (e.g., citizen trip records, SOS triggers). *(Currently using local SQLite)*.
10. 🪣 **Amazon S3:** Object storage for hosting static website assets and archiving historical disaster evidence (images/PDFs) and satellite data sets. *(Currently using local file storage)*.
11. 📡 **AWS IoT Core:** The designated ingestion layer for WATERPULSE telemetry. Securely handles high-frequency MQTT streams from remote river gauges and dam SCADA systems.
12. 📈 **Amazon CloudWatch:** Centralized telemetry and monitoring for logging API requests and setting up critical alarms (e.g., if Pinpoint SOS delivery failure rates spike).

---

## 🚀 How to Run the Project (Locally)

The platform consists of **three independent backends (FastAPI/Uvicorn)** and **three frontends (React/Vite)**, all served securely behind a single Node.js local proxy.

### Prerequisites
*   **Node.js** (v18+)
*   **Python** (v3.10+)
*   **AWS CLI** (Configured with an IAM user that has access to Bedrock, Location, and Pinpoint)

### Step 1: Environment Configuration
Each module requires its own `.env` file to hold API keys securely.
1.  **Echo-Flow Backend** (`echo-flow/.env`): Configure `AMAZON_LOCATION_API_KEY`, `VITE_AMAZON_LOCATION_API_KEY`, and `AWS_REGION`.
2.  **RAHAT AI Backend** (`rahat-ai/.env`): Configure `AWS_LOCATION_API_KEY`, `WEATHERAPI_KEY`, `PROVIDER_MODE=real`, and `RAHAT_SOS_CONTACT_NUMBER`.
3.  **WaterPulse Backend** (`waterpulse/backend/.env`): Configure necessary telemetry APIs.

### Step 2: Install Dependencies
Run `npm install` and `pip install -r requirements.txt` (or via `.venv`) in the respective directories for all three modules.

### Step 3: Start the Servers
You can use the provided batch scripts (if on Windows) to launch the entire stack simultaneously:
```bash
./start-all.bat
# OR use the PowerShell equivalent
./start-silent.ps1
```
*(This automatically starts the Node Proxy on `8080`, and the respective Vite & Uvicorn servers on their assigned ports).*

### Step 4: Access the Platform
Once all servers report "Online", open your browser and navigate to the Unified Proxy:

👉 **http://localhost:8080/**

From the central hub, you can navigate seamlessly to:
*   `/echo-flow/` - Command Center
*   `/rahat/` - Citizen Emergency App
*   `/waterpulse/` - Telemetry Dashboard

---
*Built with ❤️ for rapid disaster response and public safety.*
