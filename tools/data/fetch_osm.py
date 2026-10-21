#!/usr/bin/env python3
"""Fetch Downtown Dubai OSM data (ODbL, (c) OpenStreetMap contributors) via Overpass.

One polite query for a ~3.4 x 3.4 km box around the Burj Khalifa base, cached to
data/raw/osm_downtown.json. Re-run with --force to refresh.

    ~/.whatif-venv/bin/python tools/data/fetch_osm.py [--force]
"""
import json, math, os, sys, time, urllib.parse, urllib.request

LAT0, LON0 = 25.197139, 55.274111
HALF = 1700.0  # metres (output is clipped to 1600; a margin keeps edge polygons whole)
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'data', 'raw', 'osm_downtown.json')
ENDPOINTS = ['https://overpass-api.de/api/interpreter',
             'https://overpass.kumi.systems/api/interpreter']


def bbox():
    dlat = HALF / 110574.0
    dlon = HALF / (math.cos(math.radians(LAT0)) * 111320.0)
    return (LAT0 - dlat, LON0 - dlon, LAT0 + dlat, LON0 + dlon)


def query():
    s, w, n, e = bbox()
    b = f'{s:.6f},{w:.6f},{n:.6f},{e:.6f}'
    return f"""[out:json][timeout:240][maxsize:536870912][bbox:{b}];
(
  way["building"]; relation["building"];
  way["building:part"]; relation["building:part"];
  way["highway"]; way["railway"]; relation["railway"="subway"];
  way["natural"="water"]; relation["natural"="water"];
  way["water"]; relation["water"];
  way["waterway"];
  way["leisure"~"park|garden|pitch|playground|swimming_pool"]; relation["leisure"~"park|garden"];
  way["landuse"~"grass|recreation_ground|village_green|forest|meadow|flowerbed"];
  relation["landuse"~"grass|recreation_ground"];
  way["natural"~"scrub|grassland|wood|tree_row|sand|beach"];
  node["natural"="tree"];
  way["amenity"="parking"]; relation["amenity"="parking"];
  way["area:highway"]; way["place"="square"];
  node["amenity"="fountain"]; way["amenity"="fountain"];
  node["name"]["tourism"]; way["name"]["tourism"];
  way["name"]["shop"="mall"]; relation["name"]["shop"="mall"];
  node["name"]["shop"="mall"];
  node["name"]["building"]; 
);
out body geom qt;
"""


def main():
    if os.path.exists(OUT) and '--force' not in sys.argv:
        print('cached:', OUT, os.path.getsize(OUT), 'bytes (use --force to refetch)')
        return
    data = urllib.parse.urlencode({'data': query()}).encode()
    last = None
    for ep in ENDPOINTS:
        for attempt in range(2):
            try:
                print('POST', ep, '...', flush=True)
                req = urllib.request.Request(ep, data=data, headers={
                    'User-Agent': 'burj-quake-app data build (github.com/aiaal03/burj-quake)'})
                with urllib.request.urlopen(req, timeout=300) as r:
                    raw = r.read()
                js = json.loads(raw)
                os.makedirs(os.path.dirname(OUT), exist_ok=True)
                with open(OUT, 'wb') as f:
                    f.write(raw)
                print('saved', OUT, len(raw), 'bytes,', len(js.get('elements', [])), 'elements,',
                      'osm_base', js.get('osm3s', {}).get('timestamp_osm_base'))
                return
            except Exception as ex:  # noqa
                last = ex
                print('  failed:', ex, flush=True)
                time.sleep(20)
    # macOS system Python (LibreSSL) can fail the TLS handshake with overpass-api.de: fall back to curl
    import subprocess
    tmp = OUT + '.part'
    for ep in ENDPOINTS:
        print('curl', ep, '...', flush=True)
        r = subprocess.run(['curl', '-sS', '--fail', '-m', '300', '-A', 'burj-quake-app data build',
                            '--data-urlencode', 'data=' + query(), '-o', tmp, ep])
        if r.returncode == 0:
            js = json.load(open(tmp))
            os.replace(tmp, OUT)
            print('saved', OUT, len(js.get('elements', [])), 'elements')
            return
    sys.exit(f'Overpass failed: {last}')


if __name__ == '__main__':
    main()
