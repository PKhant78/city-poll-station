import importlib.util
import pytest
from fastapi.testclient import TestClient
from main import create_app


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(f'sqlite:///{tmp_path}/test.db')) as client:
        yield client


def test_geometry_and_query_contract(client):
    stations = [dict(id='a',name='First',x=25,y=50),dict(id='b',name='Second',x=75,y=50)]
    response = client.post('/api/geometry', json={'stations': stations})
    assert response.status_code == 200
    assert len(response.json()['districts']) == 2
    assert client.post('/api/query', json={'stations': stations, 'x':50,'y':50}).json() == {'station_ids':['a','b'],'distance':25}
    assert client.post('/api/query', json={'stations': [], 'x':0,'y':0}).json() == {'station_ids':[], 'distance':None}


@pytest.mark.parametrize('change', [
    {'x': -0.1}, {'x':100.1}, {'y':-1}, {'y':101}, {'x':'NaN'}, {'y':'Infinity'},
    {'id':''}, {'name':''},
])
def test_invalid_stations_rejected(client, change):
    station = dict(id='a', name='A', x=10, y=20)
    station.update(change)
    response = client.post('/api/geometry', json={'stations':[station]})
    assert response.status_code == 422


@pytest.mark.parametrize('kind', ['coordinates','ids','limit'])
def test_invalid_station_sets_rejected(client, kind):
    stations = [dict(id='a', name='A',x=10,y=20),dict(id='b', name='B',x=30,y=40)]
    if kind == 'coordinates':
        stations[1].update(x=10,y=20)
    elif kind == 'ids':
        stations[1]['id'] = 'a'
    else:
        stations = [dict(id=str(i),name='A',x=i/10,y=20) for i in range(201)]
    assert client.post('/api/geometry', json={'stations':stations}).status_code == 422


@pytest.mark.parametrize('x,y,valid', [(50,50,False),(25,50,False),(0,0,True),(100,100,True),(50,49,False),(49,50,True),(-1,0,False),(101,0,False),('NaN',0,False)])
def test_validate_new_station(client,x,y,valid):
    stations = [dict(id='a',name='A',x=25,y=50),dict(id='b',name='B',x=75,y=50)]
    response = client.post('/api/validate-station',json={'stations':stations,'x':x,'y':y})
    assert response.status_code == (200 if valid else 422)
    if valid:
        assert response.json() == {'valid':True}
    else:
        assert response.json()['detail']


def test_station_limit_applies_to_additions(client):
    stations = [dict(id=str(i),name='A',x=i/10,y=20) for i in range(200)]
    assert client.post('/api/validate-station',json={'stations':stations,'x':90,'y':90}).status_code == 422


def test_registration_persists_hashed_password_and_session(client):
    from sqlalchemy import text
    assert client.get('/api/auth/me').status_code == 401
    response = client.post('/api/auth/register',json={'email':'Alice@Example.com','password':'password123'})
    assert response.status_code == 201
    user = response.json()['user']
    assert user['email'] == 'alice@example.com'
    assert user['id']
    cookie = response.headers['set-cookie']
    assert 'HttpOnly' in cookie and 'SameSite=lax' in cookie
    assert client.get('/api/auth/me').json() == {'user': user}
    with client.app.state.engine.connect() as connection:
        password = connection.execute(text('select password_hash from users')).scalar_one()
        token_hash = connection.execute(text('select token_hash from sessions')).scalar_one()
    assert password.startswith('scrypt$') and 'password123' not in password
    import hashlib
    assert token_hash == hashlib.sha256(client.cookies['session'].encode()).hexdigest()
    assert token_hash != client.cookies['session']


def test_login_logout_expiry_and_restart(tmp_path):
    from sqlalchemy import text
    url = f'sqlite:///{tmp_path}/persist.db'
    credentials = {'email':'alice@example.com','password':'password123'}
    with TestClient(create_app(url)) as first:
        user = first.post('/api/auth/register',json=credentials).json()['user']
        old_token = first.cookies['session']
    with TestClient(create_app(url)) as second:
        second.cookies.set('session',old_token,domain='testserver.local',path='/')
        assert second.get('/api/auth/me').json()['user'] == user
        assert second.post('/api/auth/logout').status_code == 200
        assert second.get('/api/auth/me').status_code == 401
        second.cookies.set('session',old_token,domain='testserver.local',path='/')
        assert second.get('/api/auth/me').status_code == 401
        assert second.post('/api/auth/login',json={**credentials,'password':'wrongpass'}).status_code == 401
        assert second.post('/api/auth/login',json={**credentials,'email':'nobody@example.com'}).status_code == 401
        assert second.post('/api/auth/login',json=credentials).json()['user'] == user
        assert second.cookies['session'] != old_token
        with second.app.state.engine.begin() as db:
            db.execute(text('update sessions set expires_at=0'))
        assert second.get('/api/auth/me').status_code == 401


def test_duplicate_registration_and_bad_credentials(client):
    credentials = {'email':'alice@example.com','password':'password123'}
    assert client.post('/api/auth/register',json=credentials).status_code == 201
    assert client.post('/api/auth/register',json=credentials).status_code == 409
    for values in [{'email':'not-an-email'}, {'password':'short'}, {'email':'a@'}, {'email':'x'*255+'@example.com'}, {'password':'a'*1025}]:
        assert client.post('/api/auth/register',json={**credentials,**values}).status_code == 422


def test_plans_persist_across_restart(tmp_path):
    url = f'sqlite:///{tmp_path}/plans.db'
    body = {'name':'Morning plan','show_districts':True,'stations':[dict(id='a',name='First',x=10.5,y=30.2)]}
    with TestClient(create_app(url)) as client:
        assert client.get('/api/plans').status_code == 401
        assert client.post('/api/plans',json=body).status_code == 401
        client.post('/api/auth/register',json={'email':'alice@example.com','password':'password123'})
        response = client.post('/api/plans',json=body)
        assert response.status_code == 201
        plan = response.json()
        assert plan['id'] and plan['updated_at']
        assert {k:plan[k] for k in body} == body
        assert client.get('/api/plans').json() == {'plans':[plan]}
        token = client.cookies['session']
    with TestClient(create_app(url)) as client:
        client.cookies.set('session',token,domain='testserver.local',path='/')
        assert client.get('/api/plans').json() == {'plans':[plan]}


def test_plan_update_delete_and_ownership(client):
    credentials = {'email':'alice@example.com','password':'password123'}
    client.post('/api/auth/register',json=credentials)
    body = {'name':'One','show_districts':True,'stations':[]}
    plan = client.post('/api/plans',json=body).json()
    id = plan['id']
    # A final set may contain points on former boundaries; insertion history is not revalidated.
    body.update(name='Two',show_districts=False,stations=[dict(id=str(i),name='A',x=x,y=50) for i,x in enumerate([25,75,50])])
    response = client.put(f'/api/plans/{id}',json=body)
    assert response.status_code == 200
    assert response.json()['name'] == 'Two'
    assert response.json()['stations'] == body['stations']
    assert response.json()['updated_at'] >= plan['updated_at']
    client.post('/api/auth/logout')
    assert client.put(f'/api/plans/{id}',json=body).status_code == 401
    assert client.delete(f'/api/plans/{id}').status_code == 401
    client.post('/api/auth/register',json={**credentials,'email':'bob@example.com'})
    assert client.get('/api/plans').json() == {'plans':[]}
    assert client.put(f'/api/plans/{id}',json=body).status_code == 404
    assert client.delete(f'/api/plans/{id}').status_code == 404
    client.post('/api/auth/login',json=credentials)
    assert len(client.get('/api/plans').json()['plans']) == 1
    assert client.delete(f'/api/plans/{id}').status_code == 204
    assert client.get('/api/plans').json() == {'plans':[]}
    assert client.delete(f'/api/plans/{id}').status_code == 404


def test_invalid_plan_does_not_mutate_storage(client):
    client.post('/api/auth/register',json={'email':'alice@example.com','password':'password123'})
    body = {'name':'Valid','show_districts':True,'stations':[dict(id='a',name='A',x=0,y=0)]}
    id = client.post('/api/plans',json=body).json()['id']
    invalid = [
        {**body,'name':''},
        {**body,'name':'   '},
        {**body,'stations':[dict(id='a',name='   ',x=10,y=0)]},
        {**body,'stations':[dict(id='   ',name='Station',x=10,y=0)]},
        {**body,'stations':[dict(id='a',name='A',x=101,y=0)]},
        {**body,'stations':[dict(id='a',name='A',x='NaN',y=0)]},
        {**body,'stations':[body['stations'][0],dict(id='a',name='B',x=10,y=10)]},
        {**body,'stations':[body['stations'][0],dict(id='b',name='B',x=0,y=0)]},
    ]
    for candidate in invalid:
        assert client.post('/api/plans',json=candidate).status_code == 422
        assert client.put(f'/api/plans/{id}',json=candidate).status_code == 422
    assert client.get('/api/plans').json()['plans'][0]['name'] == 'Valid'
    assert len(client.get('/api/plans').json()['plans']) == 1


@pytest.mark.parametrize('value',['1e309','-1e309','NaN','Infinity'])
def test_raw_nonfinite_request_returns_clean_validation_error(client, value):
    response = client.post('/api/query',content='{"stations":[],"x":'+value+',"y":0}',headers={'content-type':'application/json'})
    assert response.status_code in (400,422)
    assert response.json()['detail']


@pytest.mark.parametrize('origin', ['https://evil.example', 'null', 'http://localhost:5174.evil.example', 'http://127.0.0.1:5174'])
def test_cross_origin_writes_are_rejected(client, origin):
    response = client.post('/api/auth/register', json={'email':'alice@example.com','password':'password123'}, headers={'origin':origin})
    assert response.status_code == 403
    assert client.post('/api/auth/login', json={'email':'alice@example.com','password':'password123'}).status_code == 401


@pytest.mark.parametrize('origin', ['http://localhost:5180', 'http://127.0.0.1:5180', 'http://localhost:8000', 'http://127.0.0.1:8000'])
def test_allowed_origins_and_cors(client, origin):
    response = client.options('/api/auth/register', headers={'origin':origin,'access-control-request-method':'POST','access-control-request-headers':'content-type'})
    assert response.status_code == 200
    assert response.headers['access-control-allow-origin'] == origin
    assert response.headers['access-control-allow-credentials'] == 'true'
    assert client.post('/api/auth/register', json={'email':'alice@example.com','password':'password123'}, headers={'origin':origin}).status_code == 201


def test_secure_cookie_configuration(tmp_path, monkeypatch):
    monkeypatch.setenv('COOKIE_SECURE', 'true')
    with TestClient(create_app(f'sqlite:///{tmp_path}/secure.db'), base_url='https://testserver') as client:
        response = client.post('/api/auth/register',json={'email':'alice@example.com','password':'password123'})
        assert 'Secure' in response.headers['set-cookie']
        assert client.get('/api/auth/me').status_code == 200
        response = client.post('/api/auth/logout')
        assert 'Secure' in response.headers['set-cookie']
        assert client.get('/api/auth/me').status_code == 401


def test_optional_static_build(tmp_path, monkeypatch):
    import main
    build = tmp_path / 'dist'
    build.mkdir()
    (build / 'index.html').write_text('<h1>Polling application</h1>')
    (build / 'asset.js').write_text('console.log("ready")')
    monkeypatch.setattr(main, 'FRONTEND_DIST', build)
    with TestClient(create_app('sqlite:///:memory:')) as client:
        assert client.get('/').text == '<h1>Polling application</h1>'
        assert client.get('/asset.js').status_code == 200
        assert client.get('/api/health').json() == {'status':'ok'}
        assert client.get('/api/not-found').status_code == 404


def test_health():
    assert importlib.util.find_spec('main') is not None, 'API module is missing'
    from fastapi.testclient import TestClient
    from main import create_app
    with TestClient(create_app('sqlite:///:memory:')) as client:
        assert client.get('/api/health').json() == {'status': 'ok'}
