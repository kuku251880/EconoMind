import hashlib
import os
import secrets
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from typing import Annotated

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, SecretStr, StringConstraints
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.engine import Engine

from backend.series import database_url, engine_for, sessions, users

SESSION_COOKIE = "economind_session"
SESSION_TTL = timedelta(hours=12)
hasher = PasswordHasher()

router = APIRouter(prefix="/api/v1/auth", tags=["accounts"], max_body_size=4096)


class Credentials(BaseModel):
    email: EmailStr
    password: Annotated[SecretStr, StringConstraints(min_length=1, max_length=128)]


class Registration(Credentials):
    password: Annotated[SecretStr, StringConstraints(min_length=12, max_length=128)]


class Account(BaseModel):
    id: int
    email: str


def require_browser_header(
    request_header: Annotated[str | None, Header(alias="X-EconoMind-Request")] = None,
):
    if request_header != "1":
        raise HTTPException(403, "Missing request header")


def require_database() -> Engine:
    url = database_url()
    if not url:
        raise HTTPException(503, "Database is not configured")
    try:
        return engine_for(url)
    except ValueError as error:
        raise HTTPException(503, "Database is unavailable") from error


Database = Annotated[Engine, Depends(require_database)]


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def cookie_token(request: Request) -> str | None:
    token = request.cookies.get(SESSION_COOKIE)
    return token if token is not None and len(token) == 43 else None


def find_account(request: Request, engine: Engine) -> Account | None:
    token = cookie_token(request)
    if not token:
        return None
    with engine.connect() as connection:
        row = connection.execute(
            select(users.c.id, users.c.email)
            .join(sessions, sessions.c.user_id == users.c.id)
            .where(sessions.c.token_hash == token_hash(token), sessions.c.expires_at > datetime.now(UTC))
        ).mappings().one_or_none()
    return Account(**row) if row else None


def require_account(request: Request, engine: Database) -> Account:
    account = find_account(request, engine)
    if account is None:
        raise HTTPException(401, "Please sign in")
    return account


SignedIn = Annotated[Account, Depends(require_account)]


@lru_cache(maxsize=1)
def dummy_hash() -> str:
    return hasher.hash(secrets.token_urlsafe(32))


@router.post("/register", status_code=201, dependencies=[Depends(require_browser_header)])
def register(body: Registration, engine: Database) -> Account:
    email = body.email.casefold()
    if len(email) > 254:
        raise HTTPException(422, "Email address is too long")
    statement = insert(users).values(email=email, password_hash=hasher.hash(body.password.get_secret_value()))
    with engine.begin() as connection:
        user_id = connection.execute(
            statement.on_conflict_do_nothing(index_elements=["email"]).returning(users.c.id)
        ).scalar_one_or_none()
    if user_id is None:
        raise HTTPException(409, "Email already registered")
    return Account(id=user_id, email=email)


@router.post("/login", dependencies=[Depends(require_browser_header)])
def login(body: Credentials, request: Request, response: Response, engine: Database) -> Account:
    with engine.connect() as connection:
        account = connection.execute(
            select(users.c.id, users.c.email, users.c.password_hash).where(users.c.email == body.email.casefold())
        ).mappings().one_or_none()
    stored_hash = account["password_hash"] if account else None
    password = body.password.get_secret_value()
    try:
        hasher.verify(stored_hash or dummy_hash(), password)
    except (VerificationError, InvalidHashError) as error:
        raise HTTPException(401, "Invalid email or password") from error
    if account is None or not stored_hash:
        raise HTTPException(401, "Invalid email or password")
    token = secrets.token_urlsafe(32)
    now = datetime.now(UTC)
    old_token = cookie_token(request)
    with engine.begin() as connection:
        connection.execute(sessions.delete().where(sessions.c.expires_at <= now))
        if old_token:
            connection.execute(sessions.delete().where(sessions.c.token_hash == token_hash(old_token)))
        if hasher.check_needs_rehash(stored_hash):
            connection.execute(
                users.update().where(users.c.id == account["id"], users.c.password_hash == stored_hash)
                .values(password_hash=hasher.hash(password))
            )
        connection.execute(sessions.insert().values(
            token_hash=token_hash(token), user_id=account["id"], expires_at=now + SESSION_TTL,
        ))
    response.set_cookie(
        SESSION_COOKIE, token, max_age=int(SESSION_TTL.total_seconds()), httponly=True,
        secure=os.getenv("ECONOMIND_SECURE_COOKIES") == "1", samesite="strict",
    )
    return Account(id=account["id"], email=account["email"])


@router.get("/me")
def me(account: SignedIn) -> Account:
    return account


@router.post("/logout", status_code=204, dependencies=[Depends(require_browser_header)])
def logout(request: Request, response: Response, engine: Database) -> None:
    token = cookie_token(request)
    if token:
        with engine.begin() as connection:
            connection.execute(sessions.delete().where(sessions.c.token_hash == token_hash(token)))
    response.delete_cookie(
        SESSION_COOKIE, httponly=True, samesite="strict",
        secure=os.getenv("ECONOMIND_SECURE_COOKIES") == "1",
    )
