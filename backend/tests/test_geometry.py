import importlib.util
import math
import pytest


def station(id, x, y):
    return dict(id=id, name=id, x=x, y=y)


def test_empty_geometry():
    assert importlib.util.find_spec('geometry') is not None, 'geometry module is missing'
    from geometry import districts, nearest
    assert districts([]) == []
    assert nearest([], 40, 60) == ([], None)


def test_single_station_owns_square():
    from geometry import districts, nearest
    assert districts([station('a', 20.5, 40.25)]) == [dict(station_id='a', vertices=[[0, 0], [100, 0], [100, 100], [0, 100]])]
    assert nearest([station('a', 0, 0)], 3, 4) == (['a'], 5)


@pytest.mark.parametrize('points,query,expected', [
    ([(25,50), (75,50)], (50, 50), ['0','1']),
    ([(25,25), (75,25), (50,75)], (50,43.75), ['0','1','2']),
    ([(25,25), (75,25), (75,75), (25,75)], (50,50), ['0','1','2','3']),
    ([(10,10),(50,50),(90,90)], (90,89), ['2']),
])
def test_nearest_returns_all_ties(points, query, expected):
    from geometry import nearest
    ids, distance = nearest([station(str(i),*p) for i,p in enumerate(points)], *query)
    assert ids == expected
    assert distance == pytest.approx(math.dist(points[int(expected[0])], query))


@pytest.mark.parametrize('points', [
    [(25, 50), (75, 50)],
    [(10, 50), (50, 50), (90, 50)],
    [(0, 0), (100, 0), (100, 100), (0, 100)],
    [(12.3, 18.8), (42.1, 79.4), (80.6, 22.7), (87, 90)],
])
def test_clipped_cells_cover_square_and_own_their_vertices(points):
    from geometry import districts, nearest
    stations = [station(str(i), *p) for i,p in enumerate(points)]
    cells = districts(stations)
    areas = []
    for cell in cells:
        vertices = cell['vertices']
        assert len(vertices) >= 3
        area = abs(sum(a[0]*b[1] - b[0]*a[1] for a,b in zip(vertices, vertices[1:]+vertices[:1])))/2
        areas.append(area)
        for x,y in vertices:
            assert -1e-8 <= x <= 100+1e-8 and -1e-8 <= y <= 100+1e-8
            assert cell['station_id'] in nearest(stations, x, y)[0]
    assert sum(areas) == pytest.approx(10000)

