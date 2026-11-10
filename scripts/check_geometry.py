"""Deterministic geometry property checks; run with backend's Python environment."""
import math
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from geometry import districts

rng = random.Random(2026)
counts = [1, 2, 3, 5, 10, 25, 50, 100, 200]
for count in counts:
    stations = [dict(id=str(i), x=rng.random() * 100, y=rng.random() * 100) for i in range(count)]
    total = 0
    for station, cell in zip(stations, districts(stations)):
        vertices = cell['vertices']
        total += abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(vertices, vertices[1:] + vertices[:1]))) / 2
        for x, y in vertices:
            assert -1e-8 <= x <= 100 + 1e-8 and -1e-8 <= y <= 100 + 1e-8
            own = (x - station['x']) ** 2 + (y - station['y']) ** 2
            assert all(own <= (x - other['x']) ** 2 + (y - other['y']) ** 2 + 1e-7 for other in stations)
    assert math.isclose(total, 10000, abs_tol=1e-6), total
print(f'PASS: {len(counts)} seeded geometry cases up to 200 stations; area conservation, city bounds and nearest-owner inequalities.')
