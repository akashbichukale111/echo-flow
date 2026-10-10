export interface MapConfig {
  status: "READY" | "NOT_CONFIGURED";
  missing: string[];
  region: string;
  mapName: string;
  styleUrl: any;
  keyHost: string;
}

export function readMapConfig(): MapConfig {
  const key = import.meta.env.VITE_AMAZON_LOCATION_API_KEY;
  const region = import.meta.env.VITE_AMAZON_LOCATION_REGION || "us-east-1";
  const mapName = import.meta.env.VITE_AMAZON_LOCATION_MAP_NAME || "echo-flow-map";

  if (!key) {
    return {
      status: "READY",
      missing: [],
      region: "global",
      mapName: "OpenStreetMap",
      keyHost: "",
      styleUrl: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "&copy; OpenStreetMap contributors"
          }
        },
        layers: [
          {
            id: "osm",
            type: "raster",
            source: "osm",
            minzoom: 0,
            maxzoom: 19
          }
        ]
      }
    };
  }

  return {
    status: "READY",
    missing: [],
    region,
    mapName,
    keyHost: `maps.geo.${region}.amazonaws.com`,
    styleUrl: `https://maps.geo.${region}.amazonaws.com/maps/v0/maps/${mapName}/style-descriptor`
  };
}

export function withKey(url: string, config: MapConfig): { url: string } | undefined {
  if (config.mapName === "OpenStreetMap" || !config.keyHost) return undefined;
  if (url.includes(config.keyHost)) {
    const u = new URL(url);
    u.searchParams.set("key", import.meta.env.VITE_AMAZON_LOCATION_API_KEY);
    return { url: u.toString() };
  }
  return undefined;
}

export function describeMapFailure(status: number | undefined, config: MapConfig): string {
  if (config.mapName === "OpenStreetMap") return "The OpenStreetMap tiles could not be loaded: network failure or WebGL unavailable.";
  if (status === 403) return "API Key unauthorized for this map or region.";
  return "Amazon Location map failed to load.";
}
