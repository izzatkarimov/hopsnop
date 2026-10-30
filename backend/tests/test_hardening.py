import asyncio
import json
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings, settings
from app.core.middleware import RequestBodyLimitMiddleware
from app.main import _FORM_OVERHEAD_BYTES, app, create_app
from app.models import User
from app.services import posts as posts_service
from helpers import PASSWORD, columns, log_in, registration, set_cookie, story_form

FOREIGN_ORIGIN = "https://evil.example"
CSP = "default-src 'none'; frame-ancestors 'none'"
PRODUCTION_SECRET = "a-rate-limit-secret-of-sufficient-length"
RESEND_KEY = "re_test_0123456789abcdefghij"

LEGITIMATE_NAMES = [
    "Alice",
    "Alice O'Neil-Smith Jr.",
    "Zoë Müller",
    "José Ángel Ñandú",
    "Łukasz Żółć",
    "Nguyễn Thị Minh Khai",
    "Иззат Каримов",
    "Ελένη",
    "山田 太郎",
    "김민준",
    "محمد",
    "דוד",
    "अनुष्का",
    # Written with a zero-width non-joiner, as Persian requires.
    "علی\u200cرضا",
    # Decomposed: a letter followed by a combining accent.
    "Zoe\u0308",
    "Alice 🌱",
    # One emoji made of three, held together by zero-width joiners.
    "Fam 👨\u200d👩\u200d👧",
    # A symbol with the selector that makes it an emoji.
    "I ❤\ufe0f cats",
    "❤\ufe0f",
    "🌱",
    "7",
    ":-)",
    "★",
    "x",
    "a" * 50,
]

REFUSED_NAMES = {
    "NUL": "Ali\x00ce",
    "only a zero-width space": "\u200b",
    "zero-width space inside": "Ali\u200bce",
    "zero-width joiner inside an ASCII name": "ad\u200dmin",
    "zero-width non-joiner inside an ASCII name": "ad\u200cmin",
    "zero-width non-joiner at the end": "علی\u200c",
    "only joiners": "\u200d\u200c\u200d",
    "word joiner": "Ali\u2060ce",
    "byte order mark": "\ufeffAlice",
    "soft hyphen": "Ali\u00adce",
    "right-to-left override": "\u202eecilA",
    "left-to-right override": "\u202dAlice",
    "right-to-left embedding": "Alice\u202b",
    "right-to-left isolate": "\u2067Alice\u2069",
    "right-to-left mark": "Alice\u200f",
    "tab inside": "Ali\tce",
    "newline inside": "Alice\nAdministrator",
    "escape": "Ali\x1bce",
    "delete": "Ali\x7fce",
    "C1 control": "Ali\x85ce",
    "line separator": "Alice\u2028Admin",
    "paragraph separator": "Alice\u2029Admin",
    # Marks with no character before them; the first two show as nothing at all.
    "only a variation selector": "\ufe0f",
    "only a combining grapheme joiner": "\u034f",
    "only variation selectors": "\ufe0f\ufe0e\ufe0f",
    "only a supplementary variation selector": "\U000e0100",
    "only a combining accent": "\u0301",
    "only marks, with a space between them": "\u034f \ufe0f",
    "Hangul filler": "\u3164",
    "Hangul filler inside": "Ali\u3164ce",
    "blank Braille pattern": "\u2800",
    "private-use character": "Ali\ue000ce",
    "tag character": "Alice\U000e0041",
    "unassigned code point": "Ali\u0378ce",
}


@pytest.fixture
def production_app(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    assert settings.environment == "production"
    with TestClient(create_app(), base_url="https://testserver") as client:
        yield client


@pytest.fixture
def development_app(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setattr(settings, "environment", "development")
    with TestClient(create_app(), base_url="http://testserver") as client:
        yield client


def make_settings(monkeypatch: pytest.MonkeyPatch, **values: object) -> Settings:
    for name in Settings.model_fields:
        monkeypatch.delenv(name.upper(), raising=False)
    values.setdefault("database_url", "postgresql+psycopg://unused")
    return Settings(_env_file=None, **values)


def production(monkeypatch: pytest.MonkeyPatch, **values: object) -> Settings:
    values = {
        "environment": "production",
        "frontend_url": "https://app.hopsnop.example",
        "rate_limit_secret": PRODUCTION_SECRET,
        "resend_api_key": RESEND_KEY,
        "email_from": "Hopsnop <no-reply@hopsnop.example>",
        **values,
    }
    # None stands for "not configured at all".
    return make_settings(
        monkeypatch, **{k: v for k, v in values.items() if v is not None}
    )


@pytest.mark.parametrize("name", LEGITIMATE_NAMES)
def test_legitimate_display_name_is_accepted_at_registration(
    client: TestClient, name: str
) -> None:
    response = client.post("/auth/register", json=registration(display_name=name))

    assert response.status_code == 201
    assert response.json()["display_name"] == name


@pytest.mark.parametrize("name", LEGITIMATE_NAMES)
def test_legitimate_display_name_is_accepted_in_the_profile(
    alice_client: TestClient, name: str
) -> None:
    response = alice_client.patch("/users/me", json={"display_name": name})

    assert response.status_code == 200
    assert response.json()["display_name"] == name
    assert alice_client.get("/users/alice").json()["display_name"] == name


@pytest.mark.parametrize("reason", REFUSED_NAMES)
def test_unseen_characters_are_refused_at_registration(
    client: TestClient, session: Session, reason: str
) -> None:
    response = client.post(
        "/auth/register", json=registration(display_name=REFUSED_NAMES[reason])
    )

    assert response.status_code == 422
    [error] = response.json()["detail"]
    assert error["loc"] == ["body", "display_name"]
    assert session.scalar(select(func.count()).select_from(User)) == 0


@pytest.mark.parametrize("reason", REFUSED_NAMES)
def test_unseen_characters_are_refused_in_the_profile(
    alice_client: TestClient, session: Session, alice_account: User, reason: str
) -> None:
    response = alice_client.patch(
        "/users/me", json={"display_name": REFUSED_NAMES[reason]}
    )

    assert response.status_code == 422
    [error] = response.json()["detail"]
    assert error["loc"] == ["body", "display_name"]
    assert columns(session, alice_account)["display_name"] == "Alice"


def test_registration_and_profile_apply_one_and_the_same_rule() -> None:
    from app.schemas.auth import DisplayName
    from app.schemas.user import ProfileDisplayName

    assert ProfileDisplayName is DisplayName


def test_refused_display_name_is_not_echoed(client: TestClient) -> None:
    response = client.post(
        "/auth/register",
        json=registration(display_name="Administrator\u202e (verified)"),
    )

    assert response.status_code == 422
    assert "Administrator" not in response.text
    assert "\\u202e" not in response.text and "\u202e" not in response.text


def test_surrounding_whitespace_is_still_trimmed_not_refused(
    client: TestClient,
) -> None:
    response = client.post(
        "/auth/register", json=registration(display_name="  Alice Smith \n")
    )

    assert response.status_code == 201
    assert response.json()["display_name"] == "Alice Smith"


@pytest.mark.parametrize("name", ["", "   ", "\t\n", "a" * 51])
def test_length_rules_for_display_names_are_unchanged(
    client: TestClient, name: str
) -> None:
    response = client.post("/auth/register", json=registration(display_name=name))

    assert response.status_code == 422


def test_nul_in_a_login_identifier_is_a_validation_error(
    client: TestClient, alice_account: User
) -> None:
    for identifier in ("ali\x00ce", "\x00", "alice@example.com\x00"):
        response = client.post(
            "/auth/login", json={"identifier": identifier, "password": PASSWORD}
        )

        assert response.status_code == 422
        [error] = response.json()["detail"]
        assert error["loc"] == ["body", "identifier"]


def test_nul_in_a_display_name_is_a_validation_error(client: TestClient) -> None:
    response = client.post(
        "/auth/register", json=registration(display_name="Ali\x00ce")
    )

    assert response.status_code == 422


def test_nul_is_never_an_internal_error_anywhere(
    make_client, session: Session, alice_account: User
) -> None:
    client = make_client(raise_server_exceptions=False)
    log_in(client)
    nul = "a\x00b"
    post = client.post("/posts", json={"content": "Hello"}).json()

    answers = {
        "register username": client.post(
            "/auth/register", json=registration(username=nul)
        ),
        "register email": client.post(
            "/auth/register", json=registration(email=f"{nul}@example.com")
        ),
        "register display name": client.post(
            "/auth/register", json=registration(display_name=nul)
        ),
        "register password": client.post(
            "/auth/register",
            json=registration(
                username="carol", email="carol@example.com", password=nul * 5
            ),
        ),
        "login identifier": client.post(
            "/auth/login", json={"identifier": nul, "password": PASSWORD}
        ),
        "login password": client.post(
            "/auth/login", json={"identifier": "alice", "password": nul}
        ),
        "verify token": client.post("/auth/verify-email", json={"token": nul}),
        "reset token": client.post(
            "/auth/reset-password", json={"token": nul, "new_password": PASSWORD}
        ),
        "forgot email": client.post("/auth/forgot-password", json={"email": nul}),
        "resend email": client.post("/auth/resend-verification", json={"email": nul}),
        "change current": client.post(
            "/auth/change-password",
            json={"current_password": nul, "new_password": "another passphrase!"},
        ),
        "profile name": client.patch("/users/me", json={"display_name": nul}),
        "profile bio": client.patch("/users/me", json={"bio": nul}),
        "post content": client.post("/posts", json={"content": nul}),
        "post edit": client.patch(f"/posts/{post['id']}", json={"content": nul}),
        "story caption": client.post("/stories", **story_form(caption=nul)),
        "username in path": client.get("/users/a%00b"),
        "username in follow": client.post("/users/a%00b/follow"),
        "cursor": client.get("/feed", params={"cursor": nul}),
    }

    statuses = {name: response.status_code for name, response in answers.items()}
    assert 500 not in statuses.values(), statuses
    assert all(200 <= status < 500 for status in statuses.values()), statuses
    for name in ("login identifier", "register display name", "profile name"):
        assert statuses[name] == 422, name


def body_of(size: int) -> bytes:
    frame = len(json.dumps({"content": ""}).encode())
    return json.dumps({"content": "x" * (size - frame)}).encode()


def post_raw(client: TestClient, path: str, body: bytes, **kwargs: object):
    return client.post(
        path, content=body, headers={"Content-Type": "application/json"}, **kwargs
    )


def test_body_over_the_limit_is_refused(client: TestClient) -> None:
    limit = settings.max_request_body_bytes

    response = post_raw(client, "/auth/login", body_of(limit + 1))

    assert response.status_code == 413
    assert response.json() == {"detail": "Request body too large."}
    assert response.headers["content-type"] == "application/json"


def test_body_of_exactly_the_limit_is_let_through(client: TestClient) -> None:
    limit = settings.max_request_body_bytes

    response = post_raw(client, "/posts", body_of(limit))

    assert response.status_code == 401


def test_oversized_body_never_reaches_authentication(
    client: TestClient, session: Session, alice_account: User, monkeypatch
) -> None:
    from app.services import auth as auth_service

    reached = []
    monkeypatch.setattr(
        auth_service, "log_in", lambda *args, **kwargs: reached.append(1)
    )
    monkeypatch.setattr(
        auth_service, "verify_password", lambda *args: reached.append(1)
    )
    padding = "x" * (8 * 1024 * 1024)

    response = client.post(
        "/auth/login",
        json={"identifier": "alice", "password": PASSWORD, "junk": padding},
    )

    assert response.status_code == 413
    assert reached == []
    assert "set-cookie" not in response.headers


@pytest.mark.parametrize(
    ("method", "path"), [("PUT", "/users/me/avatar"), ("POST", "/stories")]
)
def test_routes_that_take_a_picture_have_a_limit_of_their_own(
    alice_client: TestClient, method: str, path: str
) -> None:
    limit = settings.max_image_upload_bytes + _FORM_OVERHEAD_BYTES

    response = alice_client.request(
        method,
        path,
        content=b"\0" * (limit + 1),
        headers={"Content-Type": "multipart/form-data; boundary=x"},
    )

    assert response.status_code == 413


def test_oversized_body_is_refused_on_every_kind_of_route(
    alice_client: TestClient, session: Session
) -> None:
    big = body_of(settings.max_request_body_bytes + 1)
    users = session.scalar(select(func.count()).select_from(User))

    for method, path in [
        ("POST", "/auth/register"),
        ("POST", "/auth/change-password"),
        ("POST", "/posts"),
        ("PATCH", "/users/me"),
        ("POST", "/users/alice/follow"),
        ("GET", "/feed"),
        ("POST", "/no/such/route"),
    ]:
        response = alice_client.request(
            method, path, content=big, headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 413, path

    assert session.scalar(select(func.count()).select_from(User)) == users


def test_body_without_a_declared_length_is_measured_as_it_arrives(
    client: TestClient,
) -> None:
    limit = settings.max_request_body_bytes

    def chunks(total: int) -> Iterator[bytes]:
        sent = 0
        while sent < total:
            size = min(4096, total - sent)
            sent += size
            yield b"x" * size

    # A generator makes the client send chunks and no Content-Length.
    too_big = client.post("/auth/login", content=chunks(limit + 1))
    fits = client.post("/auth/login", content=chunks(limit))

    assert too_big.status_code == 413
    assert fits.status_code == 422


def test_chunked_body_within_the_limit_arrives_intact(
    alice_client: TestClient,
) -> None:
    payload = json.dumps({"content": "Sent in pieces"}).encode()

    response = alice_client.post(
        "/posts",
        content=iter([payload[:7], payload[7:20], payload[20:]]),
        headers={"Content-Type": "application/json"},
    )

    assert response.status_code == 201
    assert response.json()["content"] == "Sent in pieces"


CHUNKED_WITH_A_LENGTH = [
    {"Content-Length": "10", "Transfer-Encoding": "chunked"},
    {"Transfer-Encoding": "chunked", "Content-Length": "10"},
    {"Content-Length": "0", "Transfer-Encoding": "chunked"},
]


@pytest.mark.parametrize("headers", CHUNKED_WITH_A_LENGTH)
def test_small_declared_length_beside_chunked_encoding_does_not_get_around_the_limit(
    client: TestClient,
    session: Session,
    alice_account: User,
    monkeypatch: pytest.MonkeyPatch,
    headers: dict[str, str],
) -> None:
    from app.services import auth as auth_service

    reached = []
    monkeypatch.setattr(
        auth_service, "log_in", lambda *args, **kwargs: reached.append(1)
    )
    padding = "x" * (settings.max_request_body_bytes * 4)
    body = json.dumps(
        {"identifier": "alice", "password": PASSWORD, "junk": padding}
    ).encode()

    def chunks() -> Iterator[bytes]:
        for start in range(0, len(body), 8192):
            yield body[start : start + 8192]

    # h11 reads the chunks when given both headers; the declared length says nothing.
    response = client.post(
        "/auth/login",
        content=chunks(),
        headers={"Content-Type": "application/json", **headers},
    )

    assert response.status_code == 413
    assert response.json() == {"detail": "Request body too large."}
    assert reached == []


@pytest.mark.parametrize("headers", CHUNKED_WITH_A_LENGTH)
def test_chunked_body_within_the_limit_is_accepted_whatever_length_it_declares(
    alice_client: TestClient, headers: dict[str, str]
) -> None:
    payload = json.dumps({"content": "Sent in pieces"}).encode()

    response = alice_client.post(
        "/posts",
        content=iter([payload[:7], payload[7:]]),
        headers={"Content-Type": "application/json", **headers},
    )

    assert response.status_code == 201
    assert response.json()["content"] == "Sent in pieces"


def run_body_limit(
    headers: list[tuple[bytes, bytes]], chunks: list[bytes], *, limit: int = 100
) -> tuple[list[dict], list[bytes], int]:
    sent: list[dict] = []
    handed_on: list[bytes] = []
    pending = [
        {"type": "http.request", "body": chunk, "more_body": number < len(chunks) - 1}
        for number, chunk in enumerate(chunks)
    ]
    read = 0

    async def receive() -> dict:
        nonlocal read
        read += 1
        return pending.pop(0)

    async def send(message: dict) -> None:
        sent.append(message)

    async def application(scope: dict, receive, send) -> None:
        while True:
            message = await receive()
            handed_on.append(message["body"])
            if not message.get("more_body", False):
                break
        await send({"type": "http.response.start", "status": 200, "headers": []})

    middleware = RequestBodyLimitMiddleware(application, max_bytes=limit)
    scope = {"type": "http", "method": "POST", "path": "/", "headers": headers}
    asyncio.run(middleware(scope, receive, send))
    return sent, handed_on, read


@pytest.mark.parametrize(
    "headers",
    [
        [(b"content-length", b"10"), (b"transfer-encoding", b"chunked")],
        [(b"transfer-encoding", b"chunked"), (b"content-length", b"10")],
        [(b"transfer-encoding", b"chunked")],
        [],
    ],
)
def test_body_that_arrives_in_chunks_is_cut_off_where_it_passes_the_limit(
    headers: list[tuple[bytes, bytes]],
) -> None:
    sent, handed_on, read = run_body_limit(headers, [b"x" * 60] * 5)

    assert sent[0]["status"] == 413
    assert handed_on == []
    assert read == 2


def test_declared_length_alone_is_still_taken_at_its_word() -> None:
    within = [(b"content-length", b"100")]
    beyond = [(b"content-length", b"101")]

    sent, handed_on, read = run_body_limit(within, [b"x" * 50, b"x" * 50])
    assert sent[0]["status"] == 200
    assert handed_on == [b"x" * 50, b"x" * 50]

    sent, handed_on, read = run_body_limit(beyond, [b"x" * 101])
    assert sent[0]["status"] == 413
    assert (handed_on, read) == ([], 0)


def test_chunked_body_within_the_limit_is_handed_on_whole_and_once() -> None:
    headers = [(b"content-length", b"3"), (b"transfer-encoding", b"chunked")]

    sent, handed_on, _ = run_body_limit(headers, [b"x" * 40, b"y" * 40, b"z" * 20])

    assert sent[0]["status"] == 200
    assert handed_on == [b"x" * 40 + b"y" * 40 + b"z" * 20]


def test_declared_length_that_is_not_a_number_does_not_get_around_the_limit(
    client: TestClient,
) -> None:
    response = client.post(
        "/auth/login",
        content=b"x" * (settings.max_request_body_bytes + 1),
        headers={"Content-Length": "not-a-number"},
    )

    assert response.status_code in (400, 413)


def test_largest_legitimate_requests_are_far_below_the_limit(
    alice_client: TestClient,
) -> None:
    # The longest value of each field, in the costliest characters: 4 bytes, 12 escaped.
    astral = "\U0001f331"

    def escaped(payload: dict) -> bytes:
        return json.dumps(payload, ensure_ascii=True).encode()

    requests = [
        ("POST", "/posts", {"content": astral * 300}),
        ("PATCH", "/users/me", {"display_name": astral * 50, "bio": astral * 160}),
        (
            "POST",
            "/auth/change-password",
            {"current_password": PASSWORD, "new_password": astral * 128},
        ),
    ]

    for method, path, payload in requests:
        body = escaped(payload)
        response = alice_client.request(
            method, path, content=body, headers={"Content-Type": "application/json"}
        )

        assert response.status_code in (200, 201), (path, response.text)
        assert len(body) * 8 < settings.max_request_body_bytes, path


def test_refusal_for_size_carries_cors_and_security_headers(
    client: TestClient,
) -> None:
    response = post_raw(
        client, "/auth/login", body_of(settings.max_request_body_bytes + 1)
    )
    from_frontend = client.post(
        "/auth/login",
        content=body_of(settings.max_request_body_bytes + 1),
        headers={
            "Content-Type": "application/json",
            "Origin": settings.frontend_origin,
        },
    )

    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["cache-control"] == "no-store"
    assert (
        from_frontend.headers["access-control-allow-origin"]
        == settings.frontend_origin
    )


def test_limit_is_configurable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "max_request_body_bytes", 100)

    with TestClient(create_app(), base_url="https://testserver") as small:
        assert post_raw(small, "/auth/login", body_of(101)).status_code == 413
        assert post_raw(small, "/auth/login", body_of(100)).status_code == 422
    local = make_settings(monkeypatch, environment="development")
    assert local.max_request_body_bytes == 64 * 1024
    with pytest.raises(ValidationError):
        make_settings(monkeypatch, environment="development", max_request_body_bytes=0)


def test_every_kind_of_response_carries_the_security_headers(
    make_client, session: Session, alice_account: User, monkeypatch
) -> None:
    client = make_client(raise_server_exceptions=False)
    log_in(client)
    anonymous = make_client()

    def fail(*args: object, **kwargs: object) -> None:
        raise RuntimeError("boom")

    answers = {
        "200": client.get("/auth/me"),
        "200 public": anonymous.get("/feed"),
        "200 health": anonymous.get("/health"),
        "201": client.post("/posts", json={"content": "Hello"}),
        "204": client.delete(
            f"/posts/{client.post('/posts', json={'content': 'x'}).json()['id']}"
        ),
        "400": anonymous.get("/feed?cursor=abc"),
        "401": anonymous.get("/auth/me"),
        "403": client.post("/posts", json={}, headers={"Origin": FOREIGN_ORIGIN}),
        "404 route": anonymous.get("/no/such/route"),
        "404 resource": anonymous.get("/users/nobody_here"),
        "405": anonymous.put("/feed"),
        "409": anonymous.post("/auth/register", json=registration()),
        "413": anonymous.post("/auth/login", content=b"x" * 70000),
        "422": anonymous.post("/auth/login", json={}),
        "preflight": anonymous.options(
            "/posts",
            headers={
                "Origin": settings.frontend_origin,
                "Access-Control-Request-Method": "POST",
            },
        ),
    }
    monkeypatch.setattr(posts_service, "list_for_you_feed", fail)
    answers["500"] = client.get("/feed")

    assert answers["500"].status_code == 500
    assert answers["204"].status_code == 204
    for name, response in answers.items():
        headers = response.headers
        assert headers["x-content-type-options"] == "nosniff", name
        assert headers["referrer-policy"] == "no-referrer", name
        assert headers["content-security-policy"] == CSP, name
        assert headers["cache-control"] == "no-store", name


def test_headers_do_not_replace_what_a_response_already_says(
    alice_client: TestClient,
) -> None:
    response = alice_client.get("/auth/me")

    for name in ("cache-control", "x-content-type-options", "referrer-policy"):
        assert len(response.headers.get_list(name)) == 1, name
    assert response.headers["content-type"] == "application/json"


def test_transport_security_is_left_to_whatever_terminates_tls(
    alice_client: TestClient,
) -> None:
    response = alice_client.get("/auth/me")

    assert "strict-transport-security" not in response.headers


def test_security_headers_do_not_loosen_cors(alice_client: TestClient) -> None:
    foreign = alice_client.get("/auth/me", headers={"Origin": FOREIGN_ORIGIN})
    own = alice_client.get("/auth/me", headers={"Origin": settings.frontend_origin})

    assert "access-control-allow-origin" not in foreign.headers
    assert own.headers["access-control-allow-origin"] == settings.frontend_origin
    assert own.headers["access-control-allow-credentials"] == "true"


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
def test_api_documentation_is_not_served_in_production(
    production_app: TestClient, path: str
) -> None:
    response = production_app.get(path)

    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}
    assert "swagger" not in response.text.lower()


def test_production_application_still_serves_the_api(
    production_app: TestClient,
) -> None:
    assert production_app.get("/health").json() == {"status": "ok"}
    assert production_app.get("/auth/me").status_code == 401
    assert production_app.get("/docs/oauth2-redirect").status_code == 404


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
def test_api_documentation_is_served_in_development(
    development_app: TestClient, path: str
) -> None:
    response = development_app.get(path)

    assert response.status_code == 200


def test_documentation_pages_can_load_their_scripts_in_development(
    development_app: TestClient,
) -> None:
    page = development_app.get("/docs")
    schema = development_app.get("/openapi.json")

    assert "content-security-policy" not in page.headers
    assert page.headers["x-content-type-options"] == "nosniff"
    assert schema.headers["content-security-policy"] == CSP
    assert "/auth/change-password" in schema.json()["paths"]


def test_whether_documentation_is_served_follows_the_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert production(monkeypatch).api_docs_enabled is False
    assert make_settings(monkeypatch, environment="development").api_docs_enabled


def test_production_with_everything_in_order_starts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configured = production(monkeypatch)

    assert configured.frontend_origin == "https://app.hopsnop.example"
    assert configured.session_cookie_secure is True


def test_production_does_not_start_without_a_frontend_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pytest.raises(ValidationError, match="FRONTEND_URL must be set"):
        production(monkeypatch, frontend_url=None)


def test_forgetting_the_environment_does_not_fall_back_to_localhost(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pytest.raises(ValidationError):
        make_settings(monkeypatch)


@pytest.mark.parametrize(
    "url",
    [
        "http://localhost:3000",
        "http://app.hopsnop.example",
        "http://127.0.0.1:3000",
    ],
)
def test_production_does_not_start_with_a_plain_http_frontend(
    monkeypatch: pytest.MonkeyPatch, url: str
) -> None:
    with pytest.raises(ValidationError, match="https"):
        production(monkeypatch, frontend_url=url)


def test_production_does_not_start_without_a_rate_limit_secret(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pytest.raises(ValidationError, match="RATE_LIMIT_SECRET must be set"):
        production(monkeypatch, rate_limit_secret=None)


@pytest.mark.parametrize(
    "secret", ["", "short", "x" * 31, "development-only-rate-limit-secret"]
)
def test_production_does_not_start_with_a_weak_rate_limit_secret(
    monkeypatch: pytest.MonkeyPatch, secret: str
) -> None:
    with pytest.raises(ValidationError, match="RATE_LIMIT_SECRET"):
        production(monkeypatch, rate_limit_secret=secret)


@pytest.mark.parametrize(
    ("name", "message"),
    [
        ("resend_api_key", "RESEND_API_KEY must be set"),
        ("email_from", "EMAIL_FROM must be set"),
    ],
)
@pytest.mark.parametrize("value", [None, "", "   "])
def test_production_does_not_start_without_a_way_to_send_email(
    monkeypatch: pytest.MonkeyPatch, name: str, message: str, value: str | None
) -> None:
    with pytest.raises(ValidationError, match=message):
        production(monkeypatch, **{name: value})


@pytest.mark.parametrize(
    "sender", ["no-reply@hopsnop.example", "Hopsnop <no-reply@hopsnop.example>"]
)
def test_the_sender_is_an_address_with_or_without_a_name(
    monkeypatch: pytest.MonkeyPatch, sender: str
) -> None:
    assert production(monkeypatch, email_from=f"  {sender} ").email_from == sender


@pytest.mark.parametrize("sender", ["Hopsnop", "no-reply", "Hopsnop <no-reply>"])
def test_a_sender_without_an_address_is_refused(
    monkeypatch: pytest.MonkeyPatch, sender: str
) -> None:
    with pytest.raises(ValidationError, match="email_from"):
        production(monkeypatch, email_from=sender)


def test_the_resend_key_is_never_shown(monkeypatch: pytest.MonkeyPatch) -> None:
    configured = production(monkeypatch)
    assert RESEND_KEY not in repr(configured)
    assert RESEND_KEY not in str(configured)

    with pytest.raises(ValidationError) as refused:
        production(monkeypatch, email_from="Hopsnop")
    assert RESEND_KEY not in str(refused.value)


def test_development_needs_no_configuration_beyond_the_database(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    local = make_settings(monkeypatch, environment="development")

    assert local.frontend_url == "http://localhost:3000"
    assert local.frontend_origin == "http://localhost:3000"
    assert local.rate_limit_secret.get_secret_value()


def test_development_accepts_what_is_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    local = make_settings(
        monkeypatch,
        environment="development",
        frontend_url="http://localhost:5173",
        rate_limit_secret="my-own",
    )

    assert local.frontend_origin == "http://localhost:5173"
    assert local.rate_limit_secret.get_secret_value() == "my-own"


def test_rate_limit_secret_is_not_shown_when_settings_are_printed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configured = production(monkeypatch)

    assert PRODUCTION_SECRET not in repr(configured)
    assert PRODUCTION_SECRET not in str(configured.model_dump())


def test_limits_are_settings_with_defaults_and_cannot_be_switched_off(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configured = production(monkeypatch, login_failures_per_ip=7)

    assert configured.login_failures_per_ip == 7
    assert configured.login_failures_per_identifier_and_ip == 5
    assert (
        configured.login_failures_per_identifier
        > configured.login_failures_per_identifier_and_ip
    )
    assert configured.rate_limit_window.total_seconds() == 15 * 60
    for name in (
        "login_failures_per_identifier_and_ip",
        "login_failures_per_identifier",
        "login_failures_per_ip",
        "registrations_per_ip",
        "email_requests_per_ip",
        "token_redemptions_per_ip",
        "password_confirmation_failures",
        "data_exports_per_account",
        "rate_limit_window_minutes",
    ):
        with pytest.raises(ValidationError):
            production(monkeypatch, **{name: 0})


@pytest.mark.parametrize(
    ("pair", "account"), [(5, 14), (5, 5), (5, 6), (7, 20), (1, 2), (10, 29)]
)
@pytest.mark.parametrize("environment", ["production", "development"])
def test_account_limit_must_be_three_times_the_limit_of_one_address(
    monkeypatch: pytest.MonkeyPatch, environment: str, pair: int, account: int
) -> None:
    with pytest.raises(ValidationError, match="LOGIN_FAILURES_PER_IDENTIFIER"):
        production(
            monkeypatch,
            environment=environment,
            login_failures_per_identifier_and_ip=pair,
            login_failures_per_identifier=account,
        )


@pytest.mark.parametrize(("pair", "account"), [(5, 15), (5, 20), (1, 3), (10, 100)])
def test_account_limit_of_three_times_or_more_is_accepted(
    monkeypatch: pytest.MonkeyPatch, pair: int, account: int
) -> None:
    configured = production(
        monkeypatch,
        login_failures_per_identifier_and_ip=pair,
        login_failures_per_identifier=account,
    )

    assert configured.login_failures_per_identifier == account


def test_default_limits_satisfy_the_relationship_with_room_to_spare(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configured = production(monkeypatch)
    pair = configured.login_failures_per_identifier_and_ip
    account = configured.login_failures_per_identifier

    assert (pair, account) == (5, 20)
    assert account - 2 * pair >= pair


def test_raising_only_the_address_limit_is_refused_and_says_why(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pytest.raises(ValidationError) as refused:
        production(monkeypatch, login_failures_per_identifier_and_ip=10)

    message = str(refused.value)
    assert "LOGIN_FAILURES_PER_IDENTIFIER must be at least 3 times" in message
    assert "LOGIN_FAILURES_PER_IDENTIFIER_AND_IP" in message
    assert PRODUCTION_SECRET not in message


def test_session_cookie_has_the_host_prefix_in_production(
    client: TestClient, alice_account: User
) -> None:
    cookie = set_cookie(log_in(client))

    assert cookie.key == "__Host-hopsnop_session"
    assert cookie["secure"] is True
    assert cookie["path"] == "/"
    assert cookie["domain"] == ""


def test_cookie_without_the_prefix_is_not_a_session(
    make_client, alice_account: User
) -> None:
    client = make_client()
    log_in(client)
    token = client.cookies.get("__Host-hopsnop_session")
    planted = make_client()
    planted.cookies.set("hopsnop_session", token)

    assert planted.get("/auth/me").status_code == 401
    assert client.get("/auth/me").status_code == 200


def test_logout_clears_the_cookie_under_its_prefixed_name(
    alice_client: TestClient,
) -> None:
    response = alice_client.post("/auth/logout")

    cleared = response.headers["set-cookie"]
    assert cleared.startswith('__Host-hopsnop_session="";')
    assert "Max-Age=0" in cleared and "Secure" in cleared and "Path=/" in cleared
    assert "Domain" not in cleared
    assert alice_client.cookies.get("__Host-hopsnop_session") is None
    assert alice_client.get("/auth/me").status_code == 401


def test_development_cookie_has_no_prefix_and_works_over_http(
    client: TestClient, alice_account: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "environment", "development")

    cookie = set_cookie(log_in(client))

    assert cookie.key == "hopsnop_session"
    assert cookie["secure"] == ""
    assert client.get("/auth/me").status_code == 200
    assert client.post("/auth/logout").status_code == 204
    assert client.get("/auth/me").status_code == 401


def test_cookie_name_follows_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    assert production(monkeypatch).session_cookie == "__Host-hopsnop_session"
    assert (
        production(monkeypatch, session_cookie_name="sid").session_cookie
        == "__Host-sid"
    )
    local = make_settings(monkeypatch, environment="development")
    assert local.session_cookie == "hopsnop_session"
