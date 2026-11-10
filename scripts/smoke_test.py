"""Exercise a running API against its real database. Creates two QA accounts."""
import json
import math
import os
import uuid
from http.cookiejar import CookieJar
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener

BASE = os.environ.get('API_URL', 'http://127.0.0.1:8000')


class Client:
    def __init__(self):
        self.opener = build_opener(HTTPCookieProcessor(CookieJar()))

    def request(self, method, path, body=None, status=200):
        request = Request(BASE + path, data=None if body is None else json.dumps(body).encode(),
                          headers={'Content-Type': 'application/json'}, method=method)
        try:
            response = self.opener.open(request, timeout=20)
        except HTTPError as error:
            response = error
        payload = response.read()
        assert response.status == status, (method, path, response.status, payload)
        return json.loads(payload) if payload else None


def main():
    alice, bob = Client(), Client()
    alice.request('GET', '/api/health')
    stations = [dict(id='west', name='West Hall', x=25.25, y=50),
                dict(id='east', name='East Hall', x=74.75, y=50)]
    geometry = alice.request('POST', '/api/geometry', {'stations': stations})
    assert len(geometry['districts']) == 2
    for district in geometry['districts']:
        vertices = district['vertices']
        area = abs(sum(p[0] * q[1] - q[0] * p[1] for p, q in zip(vertices, vertices[1:] + vertices[:1]))) / 2
        assert math.isclose(area, 5000)
    query = alice.request('POST', '/api/query', dict(stations=stations, x=50, y=50))
    assert set(query['station_ids']) == {'west', 'east'}
    corners = [dict(id=str(i), name=f'Corner {i}', x=x, y=y) for i, (x, y) in enumerate([(0, 0), (100, 0), (100, 100), (0, 100)])]
    junction = alice.request('POST', '/api/query', dict(stations=corners, x=50, y=50))
    assert len(junction['station_ids']) == 4
    empty = alice.request('POST', '/api/query', dict(stations=[], x=50, y=50))
    assert empty['station_ids'] == [] and empty['distance'] is None
    alice.request('POST', '/api/query', dict(stations=stations, x=-1, y=50), status=422)
    alice.request('POST', '/api/geometry', {'stations': [dict(id='invalid', name='Outside', x=101, y=20)]}, status=422)
    alice.request('POST', '/api/validate-station', dict(stations=stations, x=50, y=20), status=422)
    alice.request('POST', '/api/validate-station', dict(stations=stations, x=101, y=20), status=422)
    alice.request('POST', '/api/validate-station', dict(stations=stations, x=0, y=0))
    credentials = dict(email=f'qa-{uuid.uuid4().hex}@example.com', password='QA-password-2026!')
    alice.request('POST', '/api/auth/register', credentials, status=201)
    alice.request('GET', '/api/auth/me')
    plan = alice.request('POST', '/api/plans', dict(name='QA district plan', stations=stations, show_districts=True), status=201)
    plan_id = plan['id']
    listed = alice.request('GET', '/api/plans')['plans']
    assert any(p['id'] == plan_id and p['stations'] == stations for p in listed)
    bob.request('POST', '/api/auth/register', dict(email=f'qa-{uuid.uuid4().hex}@example.com', password='QA-password-2026!'), status=201)
    assert bob.request('GET', '/api/plans')['plans'] == []
    bob.request('PUT', f'/api/plans/{plan_id}', dict(name='Unauthorized', stations=[], show_districts=False), status=404)
    alice.request('POST', '/api/auth/logout')
    alice.request('GET', '/api/auth/me', status=401)
    alice.request('POST', '/api/auth/login', credentials)
    restored = alice.request('GET', '/api/plans')['plans']
    assert any(p['id'] == plan_id and p['stations'] == stations for p in restored)
    updated = alice.request('PUT', f'/api/plans/{plan_id}', dict(name='QA revised plan', stations=stations[:1], show_districts=False))
    assert updated['name'] == 'QA revised plan'
    assert next(p for p in alice.request('GET', '/api/plans')['plans'] if p['id'] == plan_id)['stations'] == stations[:1]
    print('PASS: health, Voronoi coverage, boundary ties, placement validation, register, cookie session, PostgreSQL save/read/update, ownership, logout and login persistence.')


if __name__ == '__main__':
    main()
