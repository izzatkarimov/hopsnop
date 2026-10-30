import html
import json
import logging
import re
from collections.abc import Callable

import httpx
import pytest
from pydantic import SecretStr

from app.core.config import settings
from app.services.email import (
    ConsoleEmailSender,
    ResendEmailSender,
    email_verification_url,
    get_email_sender,
    password_reset_url,
)

API_KEY = "re_test_0123456789abcdefghij"
SENDER = "Hopsnop <no-reply@hopsnop.example>"
ADDRESS = "alice@example.com"
TOKEN = "raw-single-use-token-0123456789"

Reply = Callable[[httpx.Request], httpx.Response]


def accepted(request: httpx.Request) -> httpx.Response:
    return httpx.Response(200, json={"id": "4ef9a417-02e9-4d39-ad75-9611e0fcc33c"})


class Resend:
    def __init__(self, reply: Reply = accepted) -> None:
        self.requests: list[httpx.Request] = []
        self._reply = reply

    def _handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self._reply(request)

    def sender(self) -> ResendEmailSender:
        return ResendEmailSender(
            SecretStr(API_KEY), SENDER, transport=httpx.MockTransport(self._handle)
        )

    def body(self) -> dict:
        [request] = self.requests
        return json.loads(request.content)


def urls_in(text: str) -> set[str]:
    return set(re.findall(r"https?://[^\s\"'<>]+", text))


def test_a_verification_email_is_one_request_to_resends_email_api() -> None:
    resend = Resend()
    url = email_verification_url(TOKEN)

    resend.sender().send_email_verification(to=ADDRESS, url=url)

    [request] = resend.requests
    assert request.method == "POST"
    assert str(request.url) == "https://api.resend.com/emails"
    assert request.headers["Authorization"] == f"Bearer {API_KEY}"
    assert request.headers["Content-Type"] == "application/json"
    body = resend.body()
    assert set(body) == {"from", "to", "subject", "text", "html"}
    assert body["from"] == SENDER
    assert body["to"] == [ADDRESS]
    assert body["subject"] == "Verify your Hopsnop email address"
    assert url in body["text"]
    assert url in body["html"]


def test_a_verification_email_says_when_its_link_expires(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    resend = Resend()

    resend.sender().send_email_verification(to=ADDRESS, url=email_verification_url(TOKEN))
    monkeypatch.setattr(settings, "email_verification_token_lifetime_hours", 1)
    resend.sender().send_email_verification(to=ADDRESS, url=email_verification_url(TOKEN))

    texts = [json.loads(request.content)["text"] for request in resend.requests]
    assert "The link expires in 24 hours." in texts[0]
    assert "The link expires in 1 hour." in texts[1]


def test_a_reset_email_has_the_link_its_expiry_and_says_it_can_be_ignored() -> None:
    resend = Resend()
    url = password_reset_url(TOKEN)

    resend.sender().send_password_reset(to=ADDRESS, url=url)

    body = resend.body()
    assert body["to"] == [ADDRESS]
    assert body["subject"] == "Reset your Hopsnop password"
    for version in (body["text"], html.unescape(body["html"])):
        assert url in version
        assert "The link expires in 30 minutes." in version
        assert "If you didn't ask to reset your password, you can ignore this email." in version


@pytest.mark.parametrize("send", ["send_email_verification", "send_password_reset"])
def test_the_html_loads_nothing_and_links_nowhere_but_the_link(send: str) -> None:
    resend = Resend()
    url = password_reset_url(TOKEN)

    getattr(resend.sender(), send)(to=ADDRESS, url=url)

    page = resend.body()["html"]
    assert urls_in(page) == {url}
    for loads_something in ("<img", "<link", "<script", "<style", "<iframe", "src=", "url("):
        assert loads_something not in page.lower()


def test_the_html_is_escaped() -> None:
    resend = Resend()

    resend.sender().send_password_reset(
        to=ADDRESS, url='https://app.example/reset?token=a&b="<i>'
    )

    page = resend.body()["html"]
    assert 'href="https://app.example/reset?token=a&amp;b=&quot;&lt;i&gt;"' in page
    assert "<i>" not in page


def timeout(request: httpx.Request) -> httpx.Response:
    raise httpx.ReadTimeout("timed out", request=request)


def unreachable(request: httpx.Request) -> httpx.Response:
    raise httpx.ConnectError(f"cannot reach {request.url} for {ADDRESS}", request=request)


def refused(request: httpx.Request) -> httpx.Response:
    return httpx.Response(422, json={"message": f"Invalid `to`: {ADDRESS} ({API_KEY})"})


def unavailable(request: httpx.Request) -> httpx.Response:
    return httpx.Response(503, text=f"Unavailable for {ADDRESS}")


@pytest.mark.parametrize("send", ["send_email_verification", "send_password_reset"])
@pytest.mark.parametrize(
    ("reply", "logged"),
    [
        (timeout, "Resend timed out"),
        (unreachable, "ConnectError"),
        (refused, "Resend answered 422"),
        (unavailable, "Resend answered 503"),
    ],
)
def test_a_failure_is_logged_in_one_line_without_secrets_and_not_raised(
    caplog: pytest.LogCaptureFixture, send: str, reply: Reply, logged: str
) -> None:
    caplog.set_level(logging.DEBUG)
    resend = Resend(reply)
    url = password_reset_url(TOKEN)

    getattr(resend.sender(), send)(to=ADDRESS, url=url)

    assert len(resend.requests) == 1
    [record] = [r for r in caplog.records if r.name == "app.services.email"]
    assert record.levelno == logging.WARNING
    assert logged in record.getMessage()
    for secret in (API_KEY, ADDRESS, TOKEN, url, "Invalid", "Unavailable for"):
        assert secret not in caplog.text


def test_an_email_that_was_sent_is_not_logged(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)

    Resend().sender().send_password_reset(to=ADDRESS, url=password_reset_url(TOKEN))

    assert [r for r in caplog.records if r.name == "app.services.email"] == []
    assert TOKEN not in caplog.text


def test_the_key_is_not_in_the_senders_repr() -> None:
    assert API_KEY not in repr(Resend().sender())
    assert API_KEY not in repr(vars(Resend().sender()))


def configure_resend(monkeypatch: pytest.MonkeyPatch, *, key: bool, sender: bool) -> None:
    monkeypatch.setattr(settings, "resend_api_key", SecretStr(API_KEY) if key else None)
    monkeypatch.setattr(settings, "email_from", SENDER if sender else None)


@pytest.mark.parametrize(("key", "sender"), [(False, False), (True, False), (False, True)])
def test_development_without_resend_writes_the_links_to_the_log(
    monkeypatch: pytest.MonkeyPatch, key: bool, sender: bool
) -> None:
    monkeypatch.setattr(settings, "environment", "development")
    configure_resend(monkeypatch, key=key, sender=sender)

    assert isinstance(get_email_sender(), ConsoleEmailSender)


@pytest.mark.parametrize("environment", ["development", "production"])
def test_resend_is_used_wherever_it_is_configured(
    monkeypatch: pytest.MonkeyPatch, environment: str
) -> None:
    monkeypatch.setattr(settings, "environment", environment)
    configure_resend(monkeypatch, key=True, sender=True)

    assert isinstance(get_email_sender(), ResendEmailSender)


def test_production_without_resend_does_not_drop_email_quietly() -> None:
    assert not settings.is_development
    with pytest.raises(RuntimeError, match="RESEND_API_KEY and EMAIL_FROM"):
        get_email_sender()
