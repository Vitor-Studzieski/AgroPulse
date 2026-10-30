import math

EARTH_RADIUS_M = 6371008.8


def is_closed(ring):
    return len(ring) >= 4 and ring[0] == ring[-1]


def centroid(ring):
    points = ring[:-1] if ring[0] == ring[-1] else ring
    lon = sum(p[0] for p in points) / len(points)
    lat = sum(p[1] for p in points) / len(points)
    return {"type": "Point", "coordinates": [lon, lat]}


def area_ha(ring):
    lat0 = math.radians(sum(p[1] for p in ring) / len(ring))
    xs = [math.radians(p[0]) * EARTH_RADIUS_M * math.cos(lat0) for p in ring]
    ys = [math.radians(p[1]) * EARTH_RADIUS_M for p in ring]
    twice = sum(xs[i] * ys[i + 1] - xs[i + 1] * ys[i] for i in range(len(ring) - 1))
    return abs(twice) / 2 / 10_000


def square(lon, lat, side_km):
    dlat = side_km / 2 / 110.574
    dlon = side_km / 2 / (111.320 * math.cos(math.radians(lat)))
    ring = [
        [lon - dlon, lat - dlat],
        [lon + dlon, lat - dlat],
        [lon + dlon, lat + dlat],
        [lon - dlon, lat + dlat],
        [lon - dlon, lat - dlat],
    ]
    return {"type": "Polygon", "coordinates": [ring]}
