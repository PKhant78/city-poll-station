"""Bounded Euclidean Voronoi geometry, without computational geometry libraries."""
import math


def districts(stations):
    cells = []
    for station in stations:
        polygon = [[0, 0], [100, 0], [100, 100], [0, 100]]
        for other in stations:
            if other is station:
                continue
            # Closer to station iff (other-station) dot (p-midpoint) <= 0.
            nx, ny = other['x'] - station['x'], other['y'] - station['y']
            mx, my = (other['x'] + station['x']) / 2, (other['y'] + station['y']) / 2
            clipped = []
            for start, end in zip(polygon, polygon[1:] + polygon[:1]):
                ds = nx * (start[0] - mx) + ny * (start[1] - my)
                de = nx * (end[0] - mx) + ny * (end[1] - my)
                if (ds <= 0) != (de <= 0):
                    t = ds / (ds - de)
                    clipped.append([start[0] + t * (end[0] - start[0]), start[1] + t * (end[1] - start[1])])
                if de <= 0:
                    clipped.append(end)
            polygon = clipped
            if not polygon:
                break
        cells.append(dict(station_id=station['id'], vertices=polygon))
    return cells


def nearest(stations, x, y):
    if not stations:
        return [], None
    distances = [(s['x'] - x) ** 2 + (s['y'] - y) ** 2 for s in stations]
    best = min(distances)
    return [s['id'] for s, d in zip(stations, distances) if math.isclose(d, best, rel_tol=1e-10, abs_tol=1e-10)], math.sqrt(best)
