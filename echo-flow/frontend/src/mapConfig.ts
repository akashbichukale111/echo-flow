export interface MapConfig {
  status: "READY" | "NOT_CONFIGURED";
  missing: string[];
  region: string;
  mapName: string;
  styleUrl: any;
  keyHost: string;
}

export function readMapConfig(): MapConfig {
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

export function withKey(url: string, config: MapConfig): { url: string } | undefined {
  return undefined;
}

export function describeMapFailure(status: number | undefined, config: MapConfig): string {
  return "The OpenStreetMap tiles could not be loaded: network failure or WebGL unavailable.";
}
