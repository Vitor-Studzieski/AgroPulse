import math

EARTH_RADIUS_M = 6371008.8


def is_closed(ring):
    return len(ring) >= 4 and ring[0] == ring[-1]


def _as_rings(polygon):
    if not polygon:
        raise ValueError("polígono precisa ter ao menos um anel")
    if polygon[0] and isinstance(polygon[0][0], (int, float)):
        return [polygon]
    return polygon


def _project_polygon(rings):
    points = [point for ring in rings for point in ring[:-1]]
    if not points:
        raise ValueError("polígono precisa ter pontos")
    lon0 = sum(point[0] for point in points) / len(points)
    lat0 = sum(point[1] for point in points) / len(points)
    lat_scale = math.cos(math.radians(lat0))
    if abs(lat_scale) < 1e-12:
        raise ValueError("não é possível calcular talhões nos polos")

    projected = []
    for ring in rings:
        if not is_closed(ring):
            raise ValueError("anel GeoJSON precisa conter 4+ pontos e fechar no primeiro")
        projected.append(
            [
                (
                    math.radians(point[0] - lon0) * EARTH_RADIUS_M * lat_scale,
                    math.radians(point[1] - lat0) * EARTH_RADIUS_M,
                )
                for point in ring[:-1]
            ]
        )
    return projected, lon0, lat0, lat_scale


def _ring_measure(points):
    twice_area = 0.0
    centroid_x_sum = 0.0
    centroid_y_sum = 0.0
    for index, (x1, y1) in enumerate(points):
        x2, y2 = points[(index + 1) % len(points)]
        cross = x1 * y2 - x2 * y1
        twice_area += cross
        centroid_x_sum += (x1 + x2) * cross
        centroid_y_sum += (y1 + y2) * cross
    if abs(twice_area) < 1e-8:
        raise ValueError("anel GeoJSON precisa delimitar uma área positiva")
    return abs(twice_area) / 2, centroid_x_sum / (3 * twice_area), centroid_y_sum / (
        3 * twice_area
    )


def _cross(a, b, c):
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _on_segment(a, b, point):
    epsilon = 1e-7
    return (
        abs(_cross(a, b, point)) <= epsilon
        and min(a[0], b[0]) - epsilon <= point[0] <= max(a[0], b[0]) + epsilon
        and min(a[1], b[1]) - epsilon <= point[1] <= max(a[1], b[1]) + epsilon
    )


def _segments_intersect(a, b, c, d):
    first = _cross(a, b, c)
    second = _cross(a, b, d)
    third = _cross(c, d, a)
    fourth = _cross(c, d, b)
    if first * second < 0 and third * fourth < 0:
        return True
    return (
        (abs(first) <= 1e-7 and _on_segment(a, b, c))
        or (abs(second) <= 1e-7 and _on_segment(a, b, d))
        or (abs(third) <= 1e-7 and _on_segment(c, d, a))
        or (abs(fourth) <= 1e-7 and _on_segment(c, d, b))
    )


def _rings_intersect(first, second):
    for first_index, a in enumerate(first):
        b = first[(first_index + 1) % len(first)]
        for second_index, c in enumerate(second):
            d = second[(second_index + 1) % len(second)]
            if _segments_intersect(a, b, c, d):
                return True
    return False


def _point_in_ring(point, ring):
    inside = False
    previous = ring[-1]
    for current in ring:
        if (current[1] > point[1]) != (previous[1] > point[1]):
            intersection_x = (previous[0] - current[0]) * (point[1] - current[1]) / (
                previous[1] - current[1]
            ) + current[0]
            if point[0] < intersection_x:
                inside = not inside
        previous = current
    return inside


def point_in_polygon(polygon, point):
    """Return whether a [longitude, latitude] point is strictly inside a polygon."""
    rings = _as_rings(polygon)
    outer = rings[0]
    for index, start in enumerate(outer):
        if _on_segment(start, outer[(index + 1) % len(outer)], point):
            return False
    if not _point_in_ring(point, outer):
        return False
    for hole in rings[1:]:
        for index, start in enumerate(hole):
            if _on_segment(start, hole[(index + 1) % len(hole)], point):
                return False
        if _point_in_ring(point, hole):
            return False
    return True


def spread_points(polygon, count, occupied=()):
    """Choose deterministic, separated points inside a GeoJSON polygon."""
    if count < 1:
        return []
    rings = _as_rings(polygon)
    outer = rings[0]
    longitudes = [point[0] for point in outer]
    latitudes = [point[1] for point in outer]
    min_lon, max_lon = min(longitudes), max(longitudes)
    min_lat, max_lat = min(latitudes), max(latitudes)
    center = centroid(rings)["coordinates"]
    cos_lat = max(0.01, math.cos(math.radians(center[1])))
    candidates = []
    seen = set()
    for grid_size in (18, 32, 56, 96, 160, 256):
        for row in range(grid_size):
            lat = min_lat + (row + 0.5) / grid_size * (max_lat - min_lat)
            for column in range(grid_size):
                lon = min_lon + (column + 0.5) / grid_size * (max_lon - min_lon)
                point = [lon, lat]
                key = (round(lon, 12), round(lat, 12))
                if key not in seen and point_in_polygon(rings, point):
                    candidates.append(point)
                    seen.add(key)
        if len(candidates) >= count:
            break

    # A scanline fallback finds interior points in long, narrow polygons that
    # may not contain any cell center at the coarser grid resolutions.
    latitudes = sorted({point[1] for ring in rings for point in ring[:-1]})
    scanlines = [(first + second) / 2 for first, second in zip(latitudes, latitudes[1:]) if first < second]
    for lat in scanlines:
        intersections = []
        for ring in rings:
            for start, end in zip(ring, ring[1:]):
                if (start[1] > lat) != (end[1] > lat):
                    intersections.append(start[0] + (end[0] - start[0]) * (lat - start[1]) / (end[1] - start[1]))
        intersections.sort()
        for index in range(0, len(intersections) - 1, 2):
            point = [(intersections[index] + intersections[index + 1]) / 2, lat]
            key = (round(point[0], 12), round(point[1], 12))
            if key not in seen and point_in_polygon(rings, point):
                candidates.append(point)
                seen.add(key)

    selected = []
    used = [list(point) for point in occupied if point and len(point) == 2]
    while len(selected) < count and candidates:
        if used:
            score = lambda point: min(
                ((point[0] - item[0]) * cos_lat) ** 2 + (point[1] - item[1]) ** 2
                for item in used
            )
            index = max(range(len(candidates)), key=lambda item: score(candidates[item]))
        else:
            index = min(
                range(len(candidates)),
                key=lambda item: (candidates[item][0] - center[0]) ** 2 * cos_lat**2
                + (candidates[item][1] - center[1]) ** 2,
            )
        point = candidates.pop(index)
        selected.append(point)
        used.append(point)

    if len(selected) < count:
        fallback = center if point_in_polygon(rings, center) else (candidates[0] if candidates else outer[0])
        selected.extend([list(fallback) for _ in range(count - len(selected))])
    return selected


def interior_point(polygon):
    rings = _as_rings(polygon)
    center = centroid(rings)["coordinates"]
    if point_in_polygon(rings, center):
        return {"type": "Point", "coordinates": center}
    return {"type": "Point", "coordinates": spread_points(rings, 1)[0]}


def validate_polygon(polygon):
    """Reject self-crossing rings and interior rings outside or overlapping the shell."""
    rings = _as_rings(polygon)
    projected, _, _, _ = _project_polygon(rings)
    for ring in projected:
        if len(set(ring)) != len(ring):
            raise ValueError("anel GeoJSON não pode repetir vértices")
        for first_index in range(len(ring)):
            a = ring[first_index]
            b = ring[(first_index + 1) % len(ring)]
            for second_index in range(first_index + 1, len(ring)):
                if second_index == first_index + 1 or (
                    first_index == 0 and second_index == len(ring) - 1
                ):
                    continue
                c = ring[second_index]
                d = ring[(second_index + 1) % len(ring)]
                if _segments_intersect(a, b, c, d):
                    raise ValueError("anel GeoJSON não pode cruzar a si mesmo")

    outer = projected[0]
    holes = projected[1:]
    for index, hole in enumerate(holes):
        if _rings_intersect(outer, hole) or not _point_in_ring(hole[0], outer):
            raise ValueError("anéis internos precisam ficar dentro do contorno externo")
        for other_hole in holes[:index]:
            if (
                _rings_intersect(other_hole, hole)
                or _point_in_ring(hole[0], other_hole)
                or _point_in_ring(other_hole[0], hole)
            ):
                raise ValueError("anéis internos não podem se cruzar ou sobrepor")


def _polygon_measure(polygon):
    rings = _as_rings(polygon)
    projected, lon0, lat0, lat_scale = _project_polygon(rings)
    measured = [_ring_measure(ring) for ring in projected]
    net_area = measured[0][0] - sum(item[0] for item in measured[1:])
    if net_area <= 0:
        raise ValueError("área líquida do polígono precisa ser positiva")
    centroid_x = (
        measured[0][0] * measured[0][1]
        - sum(area * x for area, x, _ in measured[1:])
    ) / net_area
    centroid_y = (
        measured[0][0] * measured[0][2]
        - sum(area * y for area, _, y in measured[1:])
    ) / net_area
    centroid_lon = lon0 + math.degrees(centroid_x / (EARTH_RADIUS_M * lat_scale))
    centroid_lat = lat0 + math.degrees(centroid_y / EARTH_RADIUS_M)
    return net_area, {"type": "Point", "coordinates": [centroid_lon, centroid_lat]}


def centroid(polygon):
    return _polygon_measure(polygon)[1]


def area_ha(polygon):
    return _polygon_measure(polygon)[0] / 10_000


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
