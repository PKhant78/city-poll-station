from fastapi import FastAPI, HTTPException, Depends, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from contextlib import asynccontextmanager
import os
import secrets
import time
from database import Base, User, LoginSession, database, DEFAULT_DATABASE_URL
from security import hash_password, token_digest
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from security import verify_password
from schemas import StationSet, Query, PlanInput
from database import Plan
from datetime import datetime, timezone
from geometry import districts, nearest

FRONTEND_DIST = Path(__file__).resolve().parent.parent / 'frontend' / 'dist'
DEFAULT_ALLOWED_ORIGINS = 'http://localhost:5180,http://127.0.0.1:5180,http://localhost:8000,http://127.0.0.1:8000'


class Credentials(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=8, max_length=1024)

    @field_validator('email')
    @classmethod
    def validate_email(cls, value):
        import re
        value = value.strip().lower()
        if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', value):
            raise ValueError('Enter a valid email address.')
        return value


def create_app(database_url=None):
    engine, sessions = database(database_url or os.getenv('DATABASE_URL', DEFAULT_DATABASE_URL))

    @asynccontextmanager
    async def lifespan(application):
        Base.metadata.create_all(engine)
        yield
        engine.dispose()

    application = FastAPI(title='City Polling Plans', lifespan=lifespan)
    application.state.engine = engine
    secure_cookie = os.getenv('COOKIE_SECURE', 'false').lower() == 'true'
    allowed_origins = {origin.strip() for origin in os.getenv('ALLOWED_ORIGINS', DEFAULT_ALLOWED_ORIGINS).split(',') if origin.strip()}

    @application.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        # Never echo input: it can contain passwords or non-JSON finite values.
        errors = [{'type': error['type'], 'loc': error['loc'], 'msg': error['msg']} for error in exc.errors()]
        return JSONResponse(status_code=422, content={'detail': errors})

    @application.middleware('http')
    async def check_origin(request, call_next):
        origin = request.headers.get('origin')
        if request.method not in {'GET', 'HEAD', 'OPTIONS'} and origin is not None and origin not in allowed_origins:
            return JSONResponse(status_code=403, content={'detail': 'Origin is not allowed.'})
        return await call_next(request)

    application.add_middleware(CORSMiddleware, allow_origins=sorted(allowed_origins), allow_credentials=True,
                               allow_methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allow_headers=['Content-Type'])

    def get_db():
        with sessions() as db:
            yield db

    def current_user(request: Request, db=Depends(get_db)):
        token = request.cookies.get('session')
        session = db.get(LoginSession, token_digest(token)) if token else None
        if session is None or session.expires_at <= time.time():
            raise HTTPException(401, 'Please sign in.')
        user = db.get(User, session.user_id)
        if user is None:
            raise HTTPException(401, 'Please sign in.')
        return user

    def user_json(user):
        return {'id': user.id, 'email': user.email}

    def start_session(user, response, db):
        token = secrets.token_urlsafe(32)
        db.add(LoginSession(token_hash=token_digest(token), user_id=user.id))
        db.commit()
        response.set_cookie('session', token, httponly=True, samesite='lax', max_age=604800, secure=secure_cookie, path='/')
        return {'user': user_json(user)}

    @application.post('/api/auth/register', status_code=201)
    def register(body: Credentials, response: Response, db=Depends(get_db)):
        user = User(email=body.email.strip().lower(), password_hash=hash_password(body.password))
        db.add(user)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, 'An account with this email already exists.')
        return start_session(user, response, db)

    @application.post('/api/auth/login')
    def login(body: Credentials, response: Response, db=Depends(get_db)):
        user = db.scalar(select(User).where(User.email == body.email))
        if user is None or not verify_password(body.password, user.password_hash):
            raise HTTPException(401, 'Invalid email or password.')
        return start_session(user, response, db)

    @application.post('/api/auth/logout')
    def logout(request: Request, response: Response, db=Depends(get_db)):
        token = request.cookies.get('session')
        session = db.get(LoginSession, token_digest(token)) if token else None
        if session:
            db.delete(session)
            db.commit()
        response.delete_cookie('session', path='/', httponly=True, samesite='lax', secure=secure_cookie)
        return {'ok': True}

    @application.get('/api/auth/me')
    def me(user=Depends(current_user)):
        return {'user': user_json(user)}

    def plan_json(plan):
        return {'id':plan.id, 'name':plan.name, 'stations':plan.stations, 'show_districts':plan.show_districts, 'updated_at':datetime.fromtimestamp(plan.updated_at, timezone.utc).isoformat()}

    @application.get('/api/plans')
    def list_plans(user=Depends(current_user), db=Depends(get_db)):
        plans = db.scalars(select(Plan).where(Plan.user_id == user.id).order_by(Plan.updated_at.desc(), Plan.id))
        return {'plans':[plan_json(p) for p in plans]}

    @application.post('/api/plans', status_code=201)
    def create_plan(body: PlanInput, user=Depends(current_user), db=Depends(get_db)):
        plan = Plan(user_id=user.id, name=body.name, stations=body.points(), show_districts=body.show_districts)
        db.add(plan)
        db.commit()
        return plan_json(plan)

    def owned_plan(plan_id, user, db):
        plan = db.scalar(select(Plan).where(Plan.id == plan_id, Plan.user_id == user.id))
        if plan is None:
            raise HTTPException(404, 'Plan not found.')
        return plan

    @application.put('/api/plans/{plan_id}')
    def update_plan(plan_id: str, body: PlanInput, user=Depends(current_user), db=Depends(get_db)):
        plan = owned_plan(plan_id, user, db)
        plan.name = body.name
        plan.stations = body.points()
        plan.show_districts = body.show_districts
        plan.updated_at = time.time()
        db.commit()
        return plan_json(plan)

    @application.delete('/api/plans/{plan_id}', status_code=204)
    def delete_plan(plan_id: str, user=Depends(current_user), db=Depends(get_db)):
        db.delete(owned_plan(plan_id, user, db))
        db.commit()
        return Response(status_code=204)

    @application.get('/api/health')
    def health():
        return {'status': 'ok'}

    @application.post('/api/geometry')
    def geometry(body: StationSet):
        return {'districts': districts(body.points())}

    @application.post('/api/query')
    def query(body: Query):
        ids, distance = nearest(body.points(), body.x, body.y)
        return {'station_ids': ids, 'distance': distance}

    @application.post('/api/validate-station')
    def validate_station(body: Query):
        if len(body.stations) >= 200:
            raise HTTPException(422, 'A plan may contain at most 200 stations.')
        if any(s.x == body.x and s.y == body.y for s in body.stations):
            raise HTTPException(422, 'A station already exists at these coordinates.')
        ids, _ = nearest(body.points(), body.x, body.y)
        if len(ids) > 1:
            raise HTTPException(422, 'A new station cannot be placed on an existing district boundary.')
        return {'valid': True}

    if FRONTEND_DIST.is_dir():
        application.mount('/', StaticFiles(directory=FRONTEND_DIST, html=True), name='frontend')

    return application


app = create_app()
