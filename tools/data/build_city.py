#!/usr/bin/env python3
"""Build data/city.json (+ .gz) and data/preview.png from the cached Overpass dump.

    ~/.whatif-venv/bin/python tools/data/build_city.py

Input : data/raw/osm_downtown.json  (fetch_osm.py)
Output: data/city.json, data/city.json.gz, data/preview.png, data/burj_khalifa_osm.json

Derived from OpenStreetMap data, (c) OpenStreetMap contributors, ODbL 1.0.
Pure Python 3 (stdlib); PIL only for the preview.
"""
import gzip, json, math, os, re, sys
from collections import Counter, defaultdict

LAT0, LON0 = 25.197139, 55.274111
KX = math.cos(math.radians(LAT0)) * 111320.0
KZ = 110574.0
B = 1600.0          # half-size of the output box, metres
DP_TOL = 0.5        # Douglas-Peucker tolerance, metres
MIN_AREA = 12.0     # drop building slivers below this, m^2
LEVEL_H = 3.6
BURJ_WAY = 446646206

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
RAW = os.path.join(ROOT, 'data', 'raw', 'osm_downtown.json')
OUT = os.path.join(ROOT, 'data', 'city.json')

# ---------------------------------------------------------------- geometry

def proj(lat, lon):
    return ((lon - LON0) * KX, -(lat - LAT0) * KZ)


def area2(r):
    """Shoelace sum in (x,z). Positive = clockwise seen from above (north up)."""
    s = 0.0
    n = len(r)
    for i in range(n):
        x1, z1 = r[i]; x2, z2 = r[(i + 1) % n]
        s += x1 * z2 - x2 * z1
    return s / 2.0


def area(r):
    return abs(area2(r))


def centroid(r):
    a = area2(r)
    if abs(a) < 1e-9:
        return (sum(p[0] for p in r) / len(r), sum(p[1] for p in r) / len(r))
    cx = cz = 0.0
    n = len(r)
    for i in range(n):
        x1, z1 = r[i]; x2, z2 = r[(i + 1) % n]
        c = x1 * z2 - x2 * z1
        cx += (x1 + x2) * c; cz += (z1 + z2) * c
    return (cx / (6 * a), cz / (6 * a))


def orient(r, ccw):
    """ccw=True -> counter-clockwise seen from above (east right, north up),
    i.e. CCW in the (x, -z) plane == negative shoelace in (x, z)."""
    is_ccw = area2(r) < 0
    return r if is_ccw == ccw else r[::-1]


def pip(pt, r):
    x, z = pt; inside = False
    n = len(r); j = n - 1
    for i in range(n):
        xi, zi = r[i]; xj, zj = r[j]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi + 1e-300) + xi:
            inside = not inside
        j = i
    return inside


def dp(pts, tol):
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, az = pts[a]; bx, bz = pts[b]
        dx, dz = bx - ax, bz - az; L = math.hypot(dx, dz)
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            px, pz = pts[i]
            d = abs(dx * (az - pz) - (ax - px) * dz) / L if L > 1e-9 else math.hypot(px - ax, pz - az)
            if d > best:
                best, bi = d, i
        if best > tol:
            keep[bi] = True; stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep) if k]


def simplify_ring(r, tol=DP_TOL):
    if len(r) < 4:
        return r
    # split the closed ring at the vertex farthest from vertex 0 so DP keeps both
    far = max(range(len(r)), key=lambda i: (r[i][0] - r[0][0]) ** 2 + (r[i][1] - r[0][1]) ** 2)
    a = dp(r[:far + 1], tol); b = dp(r[far:] + [r[0]], tol)
    out = a[:-1] + b[:-1]
    return out if len(out) >= 3 else r


def clip_ring(r, b=B):
    """Sutherland-Hodgman against the square [-b, b]^2."""
    def clip(poly, inside, inter):
        out = []
        if not poly:
            return out
        prev = poly[-1]
        for cur in poly:
            if inside(cur):
                if not inside(prev):
                    out.append(inter(prev, cur))
                out.append(cur)
            elif inside(prev):
                out.append(inter(prev, cur))
            prev = cur
        return out

    def ix(v):
        return lambda p, q: (v, p[1] + (q[1] - p[1]) * (v - p[0]) / (q[0] - p[0]))

    def iz(v):
        return lambda p, q: (p[0] + (q[0] - p[0]) * (v - p[1]) / (q[1] - p[1]), v)
    r = clip(r, lambda p: p[0] >= -b, ix(-b))
    r = clip(r, lambda p: p[0] <= b, ix(b))
    r = clip(r, lambda p: p[1] >= -b, iz(-b))
    r = clip(r, lambda p: p[1] <= b, iz(b))
    return r


def clip_line(pts, b=B):
    """Liang-Barsky per segment; returns list of polylines inside the box."""
    out, cur = [], []
    for i in range(len(pts) - 1):
        (x0, z0), (x1, z1) = pts[i], pts[i + 1]
        dx, dz = x1 - x0, z1 - z0
        t0, t1, ok = 0.0, 1.0, True
        for p, q in ((-dx, x0 + b), (dx, b - x0), (-dz, z0 + b), (dz, b - z0)):
            if p == 0:
                if q < 0:
                    ok = False; break
            else:
                t = q / p
                if p < 0:
                    t0 = max(t0, t)
                else:
                    t1 = min(t1, t)
        if not ok or t0 > t1:
            if len(cur) > 1:
                out.append(cur)
            cur = []; continue
        a = (x0 + t0 * dx, z0 + t0 * dz); c = (x0 + t1 * dx, z0 + t1 * dz)
        if not cur:
            cur = [a]
        cur.append(c)
        if t1 < 1.0:
            out.append(cur); cur = []
    if len(cur) > 1:
        out.append(cur)
    return out


def R(v):
    v = round(v, 1)
    return int(v) if v == int(v) else v


def rp(pts):
    return [[R(x), R(z)] for x, z in pts]


def open_ring(pts):
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    # drop consecutive duplicates
    o = []
    for p in pts:
        if not o or (abs(o[-1][0] - p[0]) > 1e-6 or abs(o[-1][1] - p[1]) > 1e-6):
            o.append(p)
    return o

# ---------------------------------------------------------------- OSM parsing

def way_pts(geom):
    return [proj(g['lat'], g['lon']) for g in geom if g]


def assemble(ways):
    """Join member ways (lists of points) into closed rings."""
    rings, open_ = [], []
    for w in ways:
        if len(w) < 2:
            continue
        if w[0] == w[-1]:
            rings.append(w)
        else:
            open_.append(list(w))
    key = lambda p: (round(p[0], 3), round(p[1], 3))
    while open_:
        cur = open_.pop()
        changed = True
        while key(cur[0]) != key(cur[-1]) and changed:
            changed = False
            for i, w in enumerate(open_):
                if key(w[0]) == key(cur[-1]):
                    cur += w[1:]
                elif key(w[-1]) == key(cur[-1]):
                    cur += w[::-1][1:]
                elif key(w[-1]) == key(cur[0]):
                    cur = w[:-1] + cur
                elif key(w[0]) == key(cur[0]):
                    cur = w[::-1][:-1] + cur
                else:
                    continue
                open_.pop(i); changed = True; break
        if key(cur[0]) == key(cur[-1]) and len(cur) >= 4:
            rings.append(cur)
    return rings


def polygons(el):
    """-> list of (outer_ring, [holes]) in projected metres, rings open."""
    if el['type'] == 'way':
        g = el.get('geometry')
        if not g:
            return []
        pts = way_pts(g)
        if len(pts) < 4 or pts[0] != pts[-1]:
            return []
        return [(open_ring(pts), [])]
    if el['type'] == 'relation':
        outers = assemble([way_pts(m['geometry']) for m in el.get('members', [])
                           if m['type'] == 'way' and m.get('geometry') and m.get('role', 'outer') in ('outer', '')])
        inners = assemble([way_pts(m['geometry']) for m in el.get('members', [])
                           if m['type'] == 'way' and m.get('geometry') and m.get('role') == 'inner'])
        outers = [open_ring(r) for r in outers]
        inners = [open_ring(r) for r in inners]
        res = [(o, []) for o in outers if len(o) >= 3]
        for h in inners:
            if len(h) < 3:
                continue
            c = h[0]
            for o, hs in res:
                if pip(c, o):
                    hs.append(h); break
        return res
    return []


NUM = re.compile(r'-?\d+(?:\.\d+)?')


def num(v, feet_ok=True):
    if v is None:
        return None
    s = str(v).strip().split(';')[0]
    m = NUM.search(s.replace(',', '.'))
    if not m:
        return None
    x = float(m.group())
    if feet_ok and ("'" in s or 'ft' in s):
        x *= 0.3048
    return x


TYPE_DEFAULT = {  # typology fallback heights, metres
    'house': 8, 'villa': 8, 'detached': 8, 'semidetached_house': 8, 'terrace': 9, 'bungalow': 5,
    'residential': 20, 'apartments': 20, 'hotel': 40, 'dormitory': 20,
    'retail': 14, 'supermarket': 10, 'kiosk': 4, 'shop': 8,
    'commercial': 30, 'office': 30, 'tower': 60,
    'industrial': 10, 'warehouse': 10, 'garages': 10, 'garage': 4, 'parking': 15, 'carport': 4,
    'roof': 6, 'shed': 3, 'hut': 3, 'service': 6, 'transformer_tower': 6,
    'mosque': 14, 'civic': 15, 'public': 15, 'school': 12, 'hospital': 25, 'government': 20,
    'train_station': 15, 'construction': 20, 'yes': 12,
}


def bld_type(t):
    v = t.get('building') or t.get('building:part') or 'yes'
    if v in ('yes', 'part') and t.get('building:part') and t.get('building:part') not in ('yes', 'part'):
        v = t['building:part']
    return v


def heights(t, typ):
    """-> (top, base, est, levels)"""
    lv = num(t.get('building:levels'), False)
    minlv = num(t.get('building:min_level') or t.get('min_level'), False)
    rh = num(t.get('roof:height')) or 0.0
    rl = num(t.get('roof:levels'), False) or 0.0
    h = num(t.get('height') or t.get('building:height'))
    base = num(t.get('min_height'))
    if base is None:
        base = minlv * LEVEL_H if minlv else 0.0
    est = False
    if h is None:
        if lv:
            h = (lv + rl) * LEVEL_H + rh
        else:
            h = base + TYPE_DEFAULT.get(typ, 12)
            est = True
    if h <= base:
        h = base + (lv * LEVEL_H if lv else 3.0)
    return h, base, est, lv

# ---------------------------------------------------------------- main build

def main():
    raw = json.load(open(RAW))
    els = raw['elements']
    osm_ts = raw.get('osm3s', {}).get('timestamp_osm_base')
    inbox = lambda p: -B <= p[0] <= B and -B <= p[1] <= B

    # ---- buildings and parts
    outlines, parts = [], []
    for el in els:
        t = el.get('tags', {})
        if 'building:part' in t and t['building:part'] != 'no':
            dst = parts
        elif 'building' in t and t['building'] != 'no':
            dst = outlines
        else:
            continue
        for outer, holes in polygons(el):
            if len(outer) < 3:
                continue
            dst.append({'el': el, 't': t, 'outer': outer, 'holes': holes,
                        'c': centroid(outer), 'a': area(outer) - sum(area(h) for h in holes)})

    # Burj Khalifa: outline + its parts are excluded
    burj = next((o for o in outlines if o['el']['id'] == BURJ_WAY), None)
    if burj is None:
        burj = next(o for o in outlines if 'Burj Khalifa' in (o['t'].get('name:en', '') + o['t'].get('name', '')))
    burj_ring = burj['outer']

    def in_burj(o):
        return pip(o['c'], burj_ring)

    # attach parts to outlines (centroid-in-polygon, bbox prefilter)
    def bb(r):
        xs = [p[0] for p in r]; zs = [p[1] for p in r]
        return min(xs), min(zs), max(xs), max(zs)
    for o in outlines:
        o['bb'] = bb(o['outer']); o['parts'] = []
    grid = defaultdict(list)
    G = 100.0
    for i, o in enumerate(outlines):
        x0, z0, x1, z1 = o['bb']
        for gx in range(int(math.floor(x0 / G)), int(math.floor(x1 / G)) + 1):
            for gz in range(int(math.floor(z0 / G)), int(math.floor(z1 / G)) + 1):
                grid[(gx, gz)].append(i)
    for p in parts:
        c = p['c']
        best = None
        for i in grid.get((int(math.floor(c[0] / G)), int(math.floor(c[1] / G))), []):
            o = outlines[i]
            if o['el'] is p['el']:
                continue
            if pip(c, o['outer']) and (best is None or o['a'] < best['a']):
                best = o
        p['host'] = best
        if best is not None:
            best['parts'].append(p)

    stats = Counter()
    buildings = []
    burj_parts = []

    def emit(o, is_part):
        t = o['t']
        typ = bld_type(t)
        h, base, est, lv = heights(t, typ)
        outer = simplify_ring(o['outer'])
        if len(outer) < 3 or area(outer) < MIN_AREA:
            stats['dropSliver'] += 1; return
        if not inbox(o['c']):
            stats['dropOutside'] += 1; return
        holes = [orient(simplify_ring(hh), False) for hh in o['holes'] if area(hh) >= 1.0]
        b = {'id': f"{o['el']['type'][0]}{o['el']['id']}", 'type': typ, 'h': R(h), 'minH': R(base),
             'poly': rp(orient(outer, True))}
        nm = t.get('name:en') or t.get('name')
        if nm:
            b['name'] = nm
        if holes:
            b['holes'] = [rp(hh) for hh in holes]
        if lv:
            b['levels'] = int(lv) if lv == int(lv) else lv
        rs = t.get('roof:shape')
        if rs and rs != 'flat':
            b['roof'] = rs
            rh = num(t.get('roof:height'))
            if rh:
                b['roofH'] = R(rh)
        col = t.get('building:colour') or t.get('colour')
        if col:
            b['colour'] = col
        if t.get('roof:colour'):
            b['roofColour'] = t['roof:colour']
        mat = t.get('building:material') or t.get('material')
        if mat:
            b['material'] = mat
        if is_part:
            b['part'] = True
        if est:
            b['hEst'] = True; stats['hEst'] += 1
        elif t.get('height') or t.get('building:height'):
            stats['hTagged'] += 1
        else:
            stats['hFromLevels'] += 1
        if h >= 150:
            b['landmark'] = True
        buildings.append(b)

    for o in outlines:
        if o is burj:
            continue
        if in_burj(o) and o['a'] < burj['a']:
            burj_parts.append(o); continue
        real_parts = [p for p in o['parts'] if p['el'] is not o['el']]
        cover = sum(p['a'] for p in real_parts)
        if real_parts and cover >= 0.4 * o['a']:
            stats['outlineReplacedByParts'] += 1
            continue  # parts represent this building
        if real_parts:
            stats['outlineKeptPartialParts'] += 1
        emit(o, False)
    for p in parts:
        if in_burj(p) or (p['host'] is burj):
            burj_parts.append(p); continue
        emit(p, True)

    # ---- Burj Khalifa footprint report
    bc = centroid(burj_ring)
    rad = [(math.degrees(math.atan2(p[0] - bc[0], -(p[1] - bc[1]))) % 360, math.hypot(p[0] - bc[0], p[1] - bc[1]), p)
           for p in burj_ring]
    tips = []
    for ang, r, p in sorted(rad, key=lambda a: -a[1]):
        if all(min(abs(ang - a), 360 - abs(ang - a)) > 60 for a, _, _ in tips):
            tips.append((ang, r, p))
        if len(tips) == 3:
            break
    tips.sort()
    burj_info = {
        'osmId': f"w{burj['el']['id']}", 'tags': burj['t'],
        'centroid': [R(bc[0]), R(bc[1])],
        'area_m2': R(burj['a']),
        'outline': rp(orient(burj_ring, True)),
        'wingTips': [{'bearingDeg': round(a, 1), 'dist': R(r), 'x': R(p[0]), 'z': R(p[1])} for a, r, p in tips],
        'excludedParts': [f"{p['el']['type'][0]}{p['el']['id']}" for p in burj_parts],
        'note': 'bearing = degrees clockwise from true north, measured from the outline centroid; '
                'in app coords a bearing b points along (x, z) = (sin b, -cos b).',
    }

    # ---- roads
    WIDTH = {'motorway': 3.6, 'trunk': 3.6, 'primary': 3.5, 'secondary': 3.4, 'tertiary': 3.3,
             'motorway_link': 3.6, 'trunk_link': 3.5, 'primary_link': 3.5, 'secondary_link': 3.4,
             'tertiary_link': 3.3, 'residential': 3.0, 'unclassified': 3.0, 'service': 3.0,
             'living_street': 3.0, 'track': 3.0, 'busway': 3.5, 'road': 3.0}
    LANES = {'motorway': 6, 'trunk': 6, 'primary': 4, 'secondary': 4, 'tertiary': 2,
             'motorway_link': 2, 'trunk_link': 2, 'primary_link': 1, 'secondary_link': 1,
             'tertiary_link': 1, 'residential': 2, 'unclassified': 2, 'service': 1, 'living_street': 2,
             'track': 1, 'busway': 2, 'road': 2}
    PATHW = {'footway': 2.5, 'pedestrian': 5.0, 'path': 2.0, 'cycleway': 2.5, 'steps': 3.0,
             'bridleway': 2.0}
    SKIP = {'corridor', 'proposed', 'elevator', 'platform', 'bus_stop', 'raceway', 'abandoned',
            'razed', 'disused', 'escape'}
    roads, plazas, parking = [], [], []
    for el in els:
        t = el.get('tags', {})
        hw = t.get('highway')
        if el['type'] != 'way' or not hw or not el.get('geometry'):
            continue
        cls = t.get('construction', 'road') if hw == 'construction' else hw
        if hw in SKIP or cls in SKIP or t.get('indoor') in ('yes', 'corridor', 'room'):
            continue
        pts = way_pts(el['geometry'])
        if t.get('area') == 'yes' and pts[0] == pts[-1]:
            ring = clip_ring(open_ring(pts))
            if len(ring) >= 3 and area(ring) > 4:
                plazas.append({'kind': cls, 'poly': rp(orient(simplify_ring(ring), True))})
            continue
        lv = num(t.get('level'), False)
        if lv is not None and lv < 0 and t.get('tunnel') is None:
            t = dict(t, tunnel='yes')
        lanes = num(t.get('lanes'), False)
        w = num(t.get('width'))
        if cls in PATHW:
            lanes_o = None
            width = w or PATHW[cls]
        else:
            lanes_o = int(lanes) if lanes else LANES.get(cls, 2)
            if t.get('oneway') not in ('yes', '1', '-1') and not lanes and cls.endswith('_link'):
                lanes_o = 2
            width = w or round(lanes_o * WIDTH.get(cls, 3.0) + (1.0 if cls in ('motorway', 'trunk', 'primary') else 0.0), 1)
        layer = int(num(t.get('layer'), False) or 0)
        for seg in clip_line(pts):
            seg = dp(seg, DP_TOL)
            if len(seg) < 2:
                continue
            r = {'cls': cls, 'width': R(width), 'pts': rp(seg)}
            if lanes_o:
                r['lanes'] = lanes_o
            if t.get('oneway') in ('yes', '1', '-1') or cls in ('motorway', 'motorway_link') and t.get('oneway') != 'no':
                r['oneway'] = -1 if t.get('oneway') == '-1' else 1
            if t.get('bridge') and t['bridge'] != 'no':
                r['bridge'] = 1
            if t.get('tunnel') and t['tunnel'] != 'no':
                r['tunnel'] = 1
            if layer:
                r['layer'] = layer
            if lv:
                r['level'] = R(lv)
            nm = t.get('name:en') or t.get('name')
            if nm and cls not in PATHW:
                r['name'] = nm
            roads.append(r)

    # ---- rail
    rail = []
    KIND = {'subway': 'metro', 'light_rail': 'metro', 'monorail': 'metro', 'tram': 'tram',
            'rail': 'rail', 'narrow_gauge': 'rail', 'funicular': 'rail'}
    for el in els:
        t = el.get('tags', {})
        k = KIND.get(t.get('railway'))
        if el['type'] != 'way' or not k or not el.get('geometry'):
            continue
        for seg in clip_line(way_pts(el['geometry'])):
            seg = dp(seg, DP_TOL)
            r = {'kind': k, 'bridge': 1 if t.get('bridge', 'no') != 'no' else 0, 'pts': rp(seg)}
            if t.get('tunnel', 'no') != 'no':
                r['tunnel'] = 1
            if t.get('layer'):
                r['layer'] = int(num(t['layer'], False) or 0)
            nm = t.get('name:en') or t.get('name')
            if nm:
                r['name'] = nm
            rail.append(r)

    # ---- areas: water / green / plazas / parking
    def area_feats(el):
        out = []
        for outer, holes in polygons(el):
            o = clip_ring(outer)
            if len(o) < 3 or area(o) < 4:
                continue
            o = orient(simplify_ring(o), True)
            hs = [orient(simplify_ring(h), False) for h in holes if all(inbox(p) for p in h) and area(h) > 2]
            f = {'poly': rp(o)}
            if hs:
                f['holes'] = [rp(h) for h in hs]
            out.append(f)
        return out

    water, green = [], []
    GREEN_LEISURE = {'park', 'garden', 'pitch', 'playground'}
    GREEN_LANDUSE = {'grass', 'recreation_ground', 'village_green', 'forest', 'meadow', 'flowerbed'}
    GREEN_NATURAL = {'scrub', 'grassland', 'wood', 'sand', 'beach'}
    for el in els:
        t = el.get('tags', {})
        if 'building' in t or 'building:part' in t:
            continue
        if el['type'] == 'node':
            continue
        kind = None; dst = None
        if t.get('natural') == 'water' or (t.get('water') and t.get('natural') in (None, 'water')):
            dst, kind = water, t.get('water', 'water')
            nm = (t.get('name:en') or t.get('name') or '')
            if 'Burj Khalifa Lake' in nm:
                kind = 'lake'
        elif t.get('leisure') == 'swimming_pool':
            dst, kind = water, 'pool'
        elif t.get('amenity') == 'fountain' and el['type'] in ('way', 'relation'):
            dst, kind = water, 'fountain'
        elif t.get('leisure') in GREEN_LEISURE:
            dst, kind = green, t['leisure']
        elif t.get('landuse') in GREEN_LANDUSE:
            dst, kind = green, t['landuse']
        elif t.get('natural') in GREEN_NATURAL:
            dst, kind = green, t['natural']
        elif t.get('amenity') == 'parking':
            dst, kind = parking, t.get('parking', 'surface')
        elif t.get('area:highway') or t.get('place') == 'square':
            dst, kind = plazas, t.get('area:highway', 'square')
        if dst is None:
            continue
        for f in area_feats(el):
            f = dict({'kind': kind}, **f)
            nm = t.get('name:en') or t.get('name')
            if nm:
                f['name'] = nm
            dst.append(f)
    # largest first (renderers can z-order / pick)
    for L in (water, green, plazas, parking):
        L.sort(key=lambda f: -area(f['poly']))

    # ---- trees
    trees = []
    for el in els:
        t = el.get('tags', {})
        if el['type'] == 'node' and t.get('natural') == 'tree':
            p = proj(el['lat'], el['lon'])
            if inbox(p):
                trees.append([R(p[0]), R(p[1])])
    nrow = 0
    for el in els:
        t = el.get('tags', {})
        if el['type'] == 'way' and t.get('natural') == 'tree_row' and el.get('geometry'):
            pts = way_pts(el['geometry'])
            carry = 0.0
            for i in range(len(pts) - 1):
                (x0, z0), (x1, z1) = pts[i], pts[i + 1]
                L = math.hypot(x1 - x0, z1 - z0); d = carry
                while d <= L:
                    p = (x0 + (x1 - x0) * d / L, z0 + (z1 - z0) * d / L)
                    if inbox(p):
                        trees.append([R(p[0]), R(p[1])]); nrow += 1
                    d += 8.0
                carry = d - L

    # ---- landmarks
    WANT = [('The Dubai Mall', ['The Dubai Mall', 'Dubai Mall']),
            ('Address Downtown', ['The Address - Downtown Dubai', 'Address Downtown', 'The Address Downtown']),
            ('Address Boulevard', ['Address Boulevard']),
            ('Dubai Opera', ['Dubai Opera']),
            ('Souk Al Bahar', ['Souk Al Bahar']),
            ('The Dubai Fountain', ['The Dubai Fountain', 'Dubai Fountain']),
            ('Burj Khalifa Lake', ['Burj Khalifa Lake']),
            ('Emirates Towers', ['Emirates Towers', 'Jumeirah Emirates Towers', 'Emirates Office Tower']),
            ('Burj Khalifa / Dubai Mall Metro', ['Burj Khalifa/Dubai Mall', 'Burj Khalifa / Dubai Mall', 'دبي مول / برج خليفة']),
            ('Address Sky View', ['The Address - Sky View Tower 1']),
            ('Address Fountain Views', ['The Address - Fountain Views 3']),
            ('Opera Grand', ['Opera Grand']),
            ('Vida Downtown', ['Vida Downtown', 'Vida Dubai Mall']),
            ('The Palace Downtown', ['The Palace Downtown', 'Palace Downtown']),
            ('Emaar Square', ['Emaar Square']),
            ('The Index', ['The Index']),
            ('Dubai International Financial Centre', ['The Gate', 'Dubai International Financial Centre']),
            ('Burj Khalifa', ['Burj Khalifa'])]
    named = []
    for el in els:
        t = el.get('tags', {})
        names = [t.get(k) for k in ('name:en', 'name', 'official_name', 'alt_name') if t.get(k)]
        if not names:
            continue
        if el['type'] == 'node':
            p = proj(el['lat'], el['lon']); a = 0.0
        else:
            pp = polygons(el)
            if pp:
                o = max(pp, key=lambda q: area(q[0])); p = centroid(o[0]); a = area(o[0])
            elif el.get('geometry'):
                g = way_pts(el['geometry']); p = g[len(g) // 2]; a = 0.0
            else:
                continue
        named.append((names, p, a, el, t))
    landmarks = []
    for label, keys in WANT:
        best = None
        for names, p, a, el, t in named:
            if t.get('highway') or t.get('railway') in ('subway',):
                continue
            if any(n.strip().lower() == k.lower() for n in names for k in keys):
                score = (0 if any(n.strip().lower() == keys[0].lower() for n in names) else 1,
                         -(num(t.get('height')) or 0), -a)  # prefer the tower over its podium
                if best is None or score < best[0]:
                    best = (score, p, el, t)
        if best and inbox(best[1]):
            _, p, el, t = best
            lm = {'name': label, 'x': R(p[0]), 'z': R(p[1]), 'osm': f"{el['type'][0]}{el['id']}"}
            h = num(t.get('height'))
            if h:
                lm['h'] = R(h)
            landmarks.append(lm)
    # The Dubai Fountain is not mapped as a named feature in OSM. Its jets sit in the
    # middle of Burj Lake, between the tower podium and Souk Al Bahar (~25.1955 N, 55.2752 E).
    if not any(l['name'] == 'The Dubai Fountain' for l in landmarks):
        fx, fz = proj(25.1955, 55.2752)
        landmarks.append({'name': 'The Dubai Fountain', 'x': R(fx), 'z': R(fz), 'approx': True})

    # ---- assemble
    buildings.sort(key=lambda b: -b['h'])
    city = {
        'meta': {
            'bbox': [-B, -B, B, B], 'bboxNote': '[xmin, zmin, xmax, zmax], metres; x=east, z=south, y=up',
            'lat0': LAT0, 'lon0': LON0,
            'proj': 'x=(lon-lon0)*cos(lat0)*111320, z=-(lat-lat0)*110574',
            'winding': 'outer rings CCW seen from above (CCW in the (x,-z) plane); holes CW',
            'counts': {}, 'sources': ['OpenStreetMap via Overpass API (overpass-api.de / overpass.kumi.systems)'],
            'osmTimestamp': osm_ts,
            'license': 'ODbL 1.0, © OpenStreetMap contributors',
            'attribution': '© OpenStreetMap contributors',
            'stats': dict(stats, treeRowGenerated=nrow),
            'burjKhalifa': {k: burj_info[k] for k in ('osmId', 'centroid', 'area_m2', 'wingTips', 'outline', 'excludedParts', 'note')},
        },
        'buildings': buildings, 'roads': roads, 'rail': rail, 'water': water, 'green': green,
        'trees': trees, 'plazas': plazas, 'parking': parking, 'landmarks': landmarks,
    }
    city['meta']['counts'] = {k: len(v) for k, v in city.items() if isinstance(v, list)}
    s = json.dumps(city, ensure_ascii=False, separators=(',', ':'))
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(s)
    with gzip.open(OUT + '.gz', 'wb', 9) as f:
        f.write(s.encode('utf-8'))
    with open(os.path.join(ROOT, 'data', 'burj_khalifa_osm.json'), 'w', encoding='utf-8') as f:
        json.dump(burj_info, f, ensure_ascii=False, indent=1)
    print('city.json', len(s.encode()), 'bytes; gz', os.path.getsize(OUT + '.gz'))
    print('counts', city['meta']['counts'])
    print('stats', city['meta']['stats'])
    print('burj', burj_info['centroid'], burj_info['area_m2'], burj_info['wingTips'], 'parts', len(burj_parts))
    preview(city)


# ---------------------------------------------------------------- preview

def preview(city):
    from PIL import Image, ImageDraw, ImageFont
    S = 2400; k = S / (2 * B)
    T = lambda p: ((p[0] + B) * k, (p[1] + B) * k)   # z south -> image down: north up
    img = Image.new('RGB', (S, S), (238, 236, 230))
    d = ImageDraw.Draw(img)
    for f in city['green']:
        d.polygon([T(p) for p in f['poly']], fill=(196, 222, 170) if f['kind'] != 'sand' else (232, 220, 180))
    for f in city['plazas']:
        d.polygon([T(p) for p in f['poly']], fill=(225, 215, 200))
    for f in city['parking']:
        d.polygon([T(p) for p in f['poly']], fill=(215, 215, 220))
    for f in city['water']:
        d.polygon([T(p) for p in f['poly']], fill=(120, 170, 220) if f['kind'] != 'pool' else (150, 200, 235))
        for h in f.get('holes', []):
            d.polygon([T(p) for p in h], fill=(238, 236, 230))
    order = ['footway', 'steps', 'path', 'cycleway', 'pedestrian', 'service', 'residential', 'unclassified',
             'tertiary_link', 'tertiary', 'secondary_link', 'secondary', 'primary_link', 'primary',
             'trunk_link', 'trunk', 'motorway_link', 'motorway']
    rk = {c: i for i, c in enumerate(order)}
    for r in sorted(city['roads'], key=lambda r: (r.get('layer', 0), rk.get(r['cls'], 5))):
        foot = r['cls'] in ('footway', 'steps', 'path', 'cycleway', 'pedestrian')
        col = (250, 250, 250) if foot else ((250, 200, 90) if r['cls'].startswith(('motorway', 'trunk')) else (255, 255, 255))
        if r.get('bridge'):
            col = (230, 120, 60) if not foot else (240, 170, 140)
        if r.get('tunnel'):
            col = (170, 170, 170)
        w = max(1, int(r['width'] * k)) if not foot else 1
        d.line([T(p) for p in r['pts']], fill=col, width=w)
    # buildings coloured by height
    def hcol(h):
        stops = [(0, (68, 1, 84)), (20, (59, 82, 139)), (60, (33, 145, 140)), (150, (94, 201, 98)), (350, (253, 231, 37))]
        for (h0, c0), (h1, c1) in zip(stops, stops[1:]):
            if h <= h1:
                u = max(0, (h - h0) / (h1 - h0))
                return tuple(int(a + (b - a) * u) for a, b in zip(c0, c1))
        return stops[-1][1]
    for b in sorted(city['buildings'], key=lambda b: b['h']):
        d.polygon([T(p) for p in b['poly']], fill=hcol(b['h']), outline=(255, 0, 255) if b.get('hEst') else (40, 40, 40))
    for r in city['rail']:
        d.line([T(p) for p in r['pts']], fill=(220, 30, 30) if r['kind'] == 'metro' else (150, 30, 160), width=6)
    for x, z in city['trees']:
        cx, cy = T((x, z)); d.ellipse([cx - 3, cy - 3, cx + 3, cy + 3], fill=(40, 120, 40))
    bk = city['meta']['burjKhalifa']
    d.polygon([T(p) for p in bk['outline']], fill=(255, 40, 40), outline=(0, 0, 0))
    c = T(bk['centroid'])
    for tip in bk['wingTips']:
        d.line([c, T((tip['x'], tip['z']))], fill=(0, 0, 0), width=3)
    try:
        font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 30)
        small = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 22)
    except Exception:
        font = small = ImageFont.load_default()
    for lm in city['landmarks']:
        x, y = T((lm['x'], lm['z']))
        d.ellipse([x - 7, y - 7, x + 7, y + 7], fill=(0, 0, 0))
        d.text((x + 10, y - 14), lm['name'], fill=(0, 0, 0), font=small, stroke_width=3, stroke_fill=(255, 255, 255))
    # grid every 500 m + axes
    for v in range(-1500, 1501, 500):
        d.line([T((v, -B)), T((v, B))], fill=(0, 0, 0) if v == 0 else (180, 180, 180), width=1)
        d.line([T((-B, v)), T((B, v))], fill=(0, 0, 0) if v == 0 else (180, 180, 180), width=1)
        d.text(T((v + 5, -B + 5)), f'x{v}', fill=(0, 0, 0), font=small)
        d.text(T((-B + 5, v + 5)), f'z{v}', fill=(0, 0, 0), font=small)
    d.text((20, S - 80), 'N up | x east, z south | colour = height (purple 0 -> yellow 350 m), magenta outline = estimated | '
           '© OpenStreetMap contributors (ODbL)', fill=(0, 0, 0), font=font)
    img.save(os.path.join(ROOT, 'data', 'preview.png'))
    print('preview.png written')


if __name__ == '__main__':
    main()
