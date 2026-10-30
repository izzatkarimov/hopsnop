import io
import json
import uuid
import zipfile
from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from http.cookies import Morsel, SimpleCookie
from urllib.parse import parse_qs, urlsplit

from fastapi.testclient import TestClient
from httpx import Response
from PIL import Image
from sqlalchemy import String, Text, Uuid, event, func, select, table, update
from sqlalchemy import column as sql_column
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.image_store import image_store
from app.core.security import hash_password
from app.db.base import Base
from app.db.session import engine
from app.models import (
    EmailVerificationToken,
    Follow,
    PasswordResetToken,
    Post,
    Story,
    User,
)

PASSWORD = "correct horse battery staple"
# Hashed once: Argon2 is slow by design.
PASSWORD_HASH = hash_password(PASSWORD)

SENSITIVE_KEYS = {"password", "new_password", "password_hash", "token", "token_hash"}


def add_user(
    session: Session,
    username: str,
    *,
    verified: bool = True,
    active: bool = True,
) -> User:
    user = User(
        username=username,
        email=f"{username}@example.com",
        password_hash=PASSWORD_HASH,
        display_name=username.title(),
        is_active=active,
        email_verified_at=datetime.now(timezone.utc) if verified else None,
    )
    session.add(user)
    session.flush()
    return user


def follow(session: Session, follower: User, following: User) -> None:
    session.add(Follow(follower_id=follower.id, following_id=following.id))
    session.flush()


def add_post(
    session: Session,
    author: User,
    content: str = "Hello, Hopsnop!",
    *,
    parent: Post | None = None,
    created_at: datetime | None = None,
    deleted: bool = False,
) -> Post:
    created_at = created_at or datetime.now(timezone.utc)
    post = Post(
        author_id=None if deleted else author.id,
        content=None if deleted else content,
        parent_post_id=parent.id if parent is not None else None,
        created_at=created_at,
        updated_at=created_at,
        deleted_at=created_at if deleted else None,
    )
    session.add(post)
    session.flush()
    return post


def erase(session: Session, post: Post, at: datetime | None = None) -> None:
    post.author = None
    post.author_id = None
    post.content = None
    post.deleted_at = at or datetime.now(timezone.utc)
    session.flush()


def picture(
    image_format: str = "JPEG",
    size: tuple[int, int] = (64, 48),
    color: tuple[int, ...] = (200, 40, 40),
    **save: object,
) -> bytes:
    mode = "RGBA" if len(color) == 4 else "RGB"
    out = io.BytesIO()
    Image.new(mode, size, color).save(out, image_format, **save)
    return out.getvalue()


JPEG = picture()
# For rows written directly to the database; files go into the store as they are.
STORED_PICTURE = picture("WEBP", (32, 24))


def picture_form(
    data: bytes = JPEG, name: str = "photo.jpg", content_type: str = "image/jpeg"
) -> dict:
    return {"image": (name, data, content_type)}


def story_form(caption: str | None = None, data: bytes = JPEG) -> dict:
    form: dict = {"files": picture_form(data)}
    if caption is not None:
        form["data"] = {"caption": caption}
    return form


def store_picture(data: bytes = STORED_PICTURE) -> uuid.UUID:
    image_id = uuid.uuid4()
    image_store().save(image_id, data)
    return image_id


def stored_pictures() -> set[uuid.UUID]:
    return {
        stored.image_id
        for stored in image_store().files()
        if stored.image_id is not None
    }


def unzip(response: Response) -> tuple[dict, dict[str, bytes]]:
    files = {}
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        for name in archive.namelist():
            files[name.split("/", 1)[1]] = archive.read(name)
    return json.loads(files.pop("export.json")), files


class ExportAnswer:
    def __init__(self, response) -> None:
        self.response = response
        self.document_bytes = None
        if response.headers.get("content-type") == "application/zip":
            with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
                (name,) = [n for n in archive.namelist() if n.endswith("/export.json")]
                self.document_bytes = archive.read(name)

    def json(self):
        if self.document_bytes is None:
            return self.response.json()
        return json.loads(self.document_bytes)

    @property
    def text(self) -> str:
        if self.document_bytes is None:
            return self.response.text
        return self.document_bytes.decode("utf-8")

    @property
    def content(self) -> bytes:
        if self.document_bytes is None:
            return self.response.content
        return self.document_bytes

    def __getattr__(self, name: str):
        return getattr(self.response, name)


def add_story(
    session: Session,
    author: User,
    caption: str | None = None,
    *,
    created_at: datetime | None = None,
    media_id: uuid.UUID | None = None,
) -> Story:
    created_at = created_at or datetime.now(timezone.utc)
    story = Story(
        author_id=author.id,
        media_id=media_id or store_picture(),
        media_width=32,
        media_height=24,
        media_type="image",
        caption=caption,
        created_at=created_at,
        expires_at=created_at + timedelta(hours=24),
    )
    session.add(story)
    session.flush()
    return story


def let_cooldown_pass(session: Session) -> None:
    age = timedelta(seconds=settings.email_token_cooldown_seconds + 1)
    for model in (EmailVerificationToken, PasswordResetToken):
        session.execute(update(model).values(created_at=model.created_at - age))
    session.flush()


def post_columns(session: Session, post_id: object) -> dict[str, object]:
    """Plain query: what's in the database, not what a session object remembers."""
    row = session.execute(select(Post.__table__).where(Post.id == post_id)).one()
    return dict(row._mapping)


def stored_post(session: Session, post_id: object) -> dict[str, object] | None:
    row = session.execute(
        select(Post.__table__).where(Post.id == post_id)
    ).one_or_none()
    return dict(row._mapping) if row is not None else None


def where_text_is_stored(session: Session, text: str) -> list[str]:
    found = []
    for name, model_table in sorted(Base.metadata.tables.items()):
        for model_column in model_table.columns:
            if not isinstance(model_column.type, (String, Text)):
                continue
            holds_it = sql_column(model_column.name).contains(text, autoescape=True)
            count = session.scalar(
                select(func.count()).select_from(table(name)).where(holds_it)
            )
            if count:
                found.append(f"{name}.{model_column.name}")
    return found


def where_id_is_stored(session: Session, value: object) -> list[str]:
    found = []
    for name, model_table in sorted(Base.metadata.tables.items()):
        for model_column in model_table.columns:
            if not isinstance(model_column.type, Uuid):
                continue
            count = session.scalar(
                select(func.count())
                .select_from(table(name))
                .where(sql_column(model_column.name) == value)
            )
            if count:
                found.append(f"{name}.{model_column.name}")
    return found


def what_is_left_of(
    session: Session, *, user_id: object, texts: Iterable[str]
) -> list[str]:
    left = [f"{place} (the id)" for place in where_id_is_stored(session, user_id)]
    for text in texts:
        left += [f"{place} ({text!r})" for place in where_text_is_stored(session, text)]
    return left


def registration(**overrides: object) -> dict:
    return {
        "username": "alice",
        "email": "alice@example.com",
        "password": PASSWORD,
        "display_name": "Alice",
        **overrides,
    }


def log_in(
    client: TestClient,
    identifier: str = "alice",
    password: str = PASSWORD,
) -> Response:
    return client.post(
        "/auth/login",
        json={"identifier": identifier, "password": password},
    )


def session_token(client: TestClient) -> str | None:
    return client.cookies.get(settings.session_cookie)


def plant_session_cookie(client: TestClient, value: str) -> None:
    # The jar's domain and path for test-server cookies: a later Set-Cookie replaces it.
    client.cookies.set(
        settings.session_cookie,
        value,
        domain="testserver.local",
        path="/",
    )


def set_cookie(response: Response) -> Morsel:
    cookie = SimpleCookie()
    cookie.load(response.headers["set-cookie"])
    return cookie[settings.session_cookie]


def token_from(url: str) -> str:
    return parse_qs(urlsplit(url).query)["token"][0]


def expire(session: Session, row: object) -> None:
    now = datetime.now(timezone.utc)
    row.created_at = now - timedelta(hours=2)
    row.expires_at = now - timedelta(hours=1)
    session.flush()


def keys_in(payload: object) -> set[str]:
    if isinstance(payload, dict):
        found = set(payload)
        for value in payload.values():
            found |= keys_in(value)
        return found
    if isinstance(payload, list):
        return set().union(*(keys_in(item) for item in payload))
    return set()


def columns(session: Session, user: User) -> dict[str, object]:
    session.refresh(user)
    return {column.key: getattr(user, column.key) for column in User.__table__.columns}


@contextmanager
def recorded_selects() -> Iterator[list[str]]:
    statements: list[str] = []

    def record(conn, cursor, statement, parameters, context, executemany) -> None:
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", record)
