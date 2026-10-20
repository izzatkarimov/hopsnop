"""Pictures: how an upload is made into one, where it is served and to whom,
and that it goes when what it belongs to goes.

The rules are in ``app.services.images`` (what is kept of an upload),
``app.core.image_store`` (the files) and the services of profiles and
stories (who may see which picture).
"""

import io
import os
import struct
import time
import zlib
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageCms, ImageFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.image_store import image_store
from app.models import Story, User
from app.services import images, retention
from app.services import stories as stories_service
from helpers import (
    JPEG,
    PASSWORD,
    add_post,
    add_story,
    add_user,
    follow,
    log_in,
    picture,
    picture_form,
    store_picture,
    stored_pictures,
    story_form,
    unzip,
)

FOREIGN_ORIGIN = "https://evil.example"
FRONTEND = "http://localhost:3000"
UNREADABLE = {"detail": "The file is not a JPEG, PNG or WebP picture that can be read."}
TOO_LARGE = {"detail": "The file is too large."}
# What a WebP file made by the server may consist of: the image itself, and
# its transparency. No EXIF, XMP or ICCP chunk.
IMAGE_CHUNKS = {b"VP8 ", b"VP8L", b"VP8X", b"ALPH"}


def chunks_of(data: bytes) -> list[bytes]:
    """The kinds of the chunks of a WebP file, in order."""
    assert data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    kinds, at = [], 12
    while at + 8 <= len(data):
        size = struct.unpack("<I", data[at + 4 : at + 8])[0]
        kinds.append(data[at : at + 4])
        at += 8 + size + (size & 1)
    return kinds


def decoded(data: bytes) -> Image.Image:
    image = Image.open(io.BytesIO(data))
    image.load()
    return image


def srgb_profile() -> bytes:
    return ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()


def photo_with_metadata() -> bytes:
    """A JPEG as a phone might save it: where and when it was taken, with
    what, by whom, with which software, and a colour profile."""
    exif = Image.Exif()
    exif[0x010F] = "PhoneMaker"  # Make
    exif[0x0110] = "PhoneModel 15"  # Model
    exif[0x0131] = "EditorApp 2.0"  # Software
    exif[0x0132] = "2026:10:19 23:59:00"  # DateTime
    exif[0x013B] = "Alice Liddell"  # Artist
    exif[0x8825] = {1: "N", 2: (52.0, 13.0, 37.0), 3: "E", 4: (21.0, 0.0, 30.0)}
    return picture(
        "JPEG",
        (120, 90),
        exif=exif.tobytes(),
        icc_profile=srgb_profile(),
        comment=b"SecretComment",
    )


IDENTIFYING = [b"PhoneMaker", b"PhoneModel", b"EditorApp", b"Alice Liddell", b"SecretComment"]


def png_claiming(width: int, height: int) -> bytes:
    """A tiny PNG file whose header claims a picture of this size."""

    def chunk(kind: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(kind + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", crc)

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(b""))
        + chunk(b"IEND", b"")
    )


# Lossy compression moves colours a little; these tell red from blue.
def red(pixel: tuple[int, ...]) -> bool:
    return pixel[0] > 170 and pixel[1] < 90 and pixel[2] < 90


def blue(pixel: tuple[int, ...]) -> bool:
    return pixel[2] > 170 and pixel[0] < 90 and pixel[1] < 90


# --- what is kept of an upload ---------------------------------------------


@pytest.mark.parametrize("image_format", ["JPEG", "PNG", "WEBP"])
@pytest.mark.parametrize("purpose", ["avatar", "story"])
def test_every_accepted_format_becomes_a_webp_file(
    image_format: str, purpose: images.Purpose
) -> None:
    result = images.make_picture(picture(image_format), purpose)

    assert set(chunks_of(result.data)) <= IMAGE_CHUNKS
    assert decoded(result.data).format == "WEBP"


@pytest.mark.parametrize(
    "data",
    [
        b"",
        b"not a picture",
        b"<svg xmlns='http://www.w3.org/2000/svg'/>",
        picture("GIF"),
        picture("BMP"),
        picture("TIFF"),
        picture("ICO"),
        JPEG[: len(JPEG) // 2],
        png_claiming(0, 10),
    ],
    ids=["empty", "text", "svg", "gif", "bmp", "tiff", "ico", "truncated", "no width"],
)
def test_anything_else_is_refused(data: bytes) -> None:
    with pytest.raises(images.UnreadableImageError):
        images.make_picture(data, "story")


def test_nothing_but_the_pixels_is_kept() -> None:
    upload = photo_with_metadata()
    for identifying in IDENTIFYING:
        assert identifying in upload

    for purpose in ("avatar", "story"):
        stored = images.make_picture(upload, purpose).data

        assert set(chunks_of(stored)) <= IMAGE_CHUNKS
        for identifying in IDENTIFYING:
            assert identifying not in stored
        shown = decoded(stored)
        assert dict(shown.getexif()) == {}
        assert "icc_profile" not in shown.info
        assert "exif" not in shown.info


def test_picture_is_turned_the_right_way_up() -> None:
    # Red on the left, blue on the right, and the EXIF orientation 6: to be
    # shown upright it has to be turned a quarter clockwise.
    image = Image.new("RGB", (60, 30), (255, 0, 0))
    image.paste((0, 0, 255), (30, 0, 60, 30))
    exif = Image.Exif()
    exif[0x0112] = 6
    upload = io.BytesIO()
    image.save(upload, "JPEG", exif=exif.tobytes(), quality=95)

    result = images.make_picture(upload.getvalue(), "story")

    shown = decoded(result.data).convert("RGB")
    assert (result.width, result.height) == shown.size == (30, 60)
    # Turned clockwise, what was on the left is now at the top.
    assert red(shown.getpixel((15, 10)))
    assert blue(shown.getpixel((15, 50)))


def test_avatar_is_a_square_cut_from_the_middle() -> None:
    image = Image.new("RGB", (800, 400), (0, 0, 255))
    image.paste((255, 0, 0), (200, 0, 600, 400))
    upload = io.BytesIO()
    image.save(upload, "PNG")

    result = images.make_picture(upload.getvalue(), "avatar")

    shown = decoded(result.data).convert("RGB")
    assert (result.width, result.height) == shown.size == (400, 400)
    for corner in ((5, 5), (394, 5), (5, 394), (394, 394)):
        assert red(shown.getpixel(corner)), corner


def test_story_keeps_its_proportions_and_is_never_larger_than_its_limit() -> None:
    large = images.make_picture(picture("JPEG", (3000, 1500)), "story")
    tall = images.make_picture(picture("PNG", (500, 2880)), "story")
    small = images.make_picture(picture("JPEG", (64, 48)), "story")

    assert (large.width, large.height) == (1440, 720)
    assert (tall.width, tall.height) == (250, 1440)
    # A small picture is not enlarged.
    assert (small.width, small.height) == (64, 48)
    for result in (large, tall, small):
        assert decoded(result.data).size == (result.width, result.height)


def test_transparency_is_kept() -> None:
    image = Image.new("RGBA", (400, 400), (255, 0, 0, 255))
    image.paste((0, 0, 0, 0), (0, 0, 200, 400))
    upload = io.BytesIO()
    image.save(upload, "PNG")

    shown = decoded(images.make_picture(upload.getvalue(), "avatar").data)

    assert shown.mode == "RGBA"
    assert shown.getpixel((50, 200))[3] == 0
    assert shown.getpixel((350, 200))[3] == 255


def test_only_the_first_frame_of_an_animation_is_kept() -> None:
    frames = [Image.new("RGB", (40, 40), color) for color in ((255, 0, 0), (0, 0, 255))]
    upload = io.BytesIO()
    frames[0].save(upload, "WEBP", save_all=True, append_images=frames[1:], duration=100)
    assert decoded(upload.getvalue()).n_frames == 2

    shown = decoded(images.make_picture(upload.getvalue(), "story").data)

    assert getattr(shown, "n_frames", 1) == 1
    assert red(shown.convert("RGB").getpixel((20, 20)))


def test_colour_profile_is_applied_and_then_left_behind() -> None:
    with_profile = images.make_picture(
        picture("JPEG", color=(200, 40, 40), icc_profile=srgb_profile()), "story"
    )
    # A profile that is not one does not stop the picture from being used.
    broken_profile = images.make_picture(
        picture("JPEG", color=(200, 40, 40), icc_profile=b"not a profile"), "story"
    )

    for result in (with_profile, broken_profile):
        shown = decoded(result.data)
        assert "icc_profile" not in shown.info
        assert red(shown.convert("RGB").getpixel((10, 10)))


def test_cmyk_picture_is_drawn_in_rgb() -> None:
    upload = io.BytesIO()
    Image.new("CMYK", (40, 30), (0, 255, 255, 0)).save(upload, "JPEG")

    shown = decoded(images.make_picture(upload.getvalue(), "story").data)

    assert shown.mode == "RGB"
    assert red(shown.getpixel((20, 15)))


def test_picture_that_claims_too_many_pixels_is_refused_before_it_is_decoded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def no_decoding(*args: object, **kwargs: object) -> None:
        raise AssertionError("the picture must not be decoded")

    monkeypatch.setattr(ImageFile.ImageFile, "load", no_decoding)
    # 100 million pixels, and four billion, in files of a few dozen bytes.
    for bomb in (png_claiming(10_000, 10_000), png_claiming(65_535, 65_535)):
        assert len(bomb) < 100

        with pytest.raises(images.TooManyPixelsError):
            images.make_picture(bomb, "story")


# --- uploading an avatar -----------------------------------------------------


def upload_avatar(client: TestClient, data: bytes = JPEG, **kwargs: object):
    return client.put("/users/me/avatar", files=picture_form(data), **kwargs)


def avatar_id_of(session: Session, username: str = "alice"):
    session.expire_all()
    return session.scalar(select(User.avatar_id).where(User.username == username))


def test_user_can_upload_a_picture(
    alice_client: TestClient, session: Session
) -> None:
    response = upload_avatar(alice_client, photo_with_metadata())

    assert response.status_code == 200
    avatar_id = avatar_id_of(session)
    assert avatar_id is not None
    assert response.json()["avatar_url"] == f"/users/alice/avatar/{avatar_id}"
    assert stored_pictures() == {avatar_id}
    stored = image_store().read(avatar_id)
    assert decoded(stored).size == (400, 400)
    for identifying in IDENTIFYING:
        assert identifying not in stored


def test_picture_is_served_to_anyone_from_the_api(
    alice_client: TestClient, make_client
) -> None:
    url = upload_avatar(alice_client).json()["avatar_url"]

    response = make_client().get(url)

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/webp"
    assert response.headers["cache-control"] == "private, max-age=86400"
    assert response.headers["cross-origin-resource-policy"] == "same-site"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert decoded(response.content).size == (400, 400)


def test_browser_that_has_the_picture_is_told_so(
    alice_client: TestClient, make_client
) -> None:
    url = upload_avatar(alice_client).json()["avatar_url"]
    visitor = make_client()
    first = visitor.get(url)

    again = visitor.get(url, headers={"If-None-Match": first.headers["etag"]})

    assert again.status_code == 304
    assert again.content == b""


def test_new_picture_replaces_the_old_one_and_its_address(
    alice_client: TestClient, make_client, session: Session
) -> None:
    old_url = upload_avatar(alice_client).json()["avatar_url"]
    old_id = avatar_id_of(session)

    new_url = upload_avatar(alice_client, picture("PNG")).json()["avatar_url"]

    assert new_url != old_url
    assert stored_pictures() == {avatar_id_of(session)}
    assert old_id not in stored_pictures()
    visitor = make_client()
    assert visitor.get(old_url).status_code == 404
    assert visitor.get(new_url).status_code == 200


def test_user_can_remove_their_picture(
    alice_client: TestClient, make_client, session: Session
) -> None:
    url = upload_avatar(alice_client).json()["avatar_url"]

    removed = alice_client.delete("/users/me/avatar")
    again = alice_client.delete("/users/me/avatar")

    assert removed.status_code == again.status_code == 200
    assert removed.json()["avatar_url"] is None
    assert again.json()["avatar_url"] is None
    assert avatar_id_of(session) is None
    assert stored_pictures() == set()
    assert make_client().get(url).status_code == 404


def test_picture_is_shown_wherever_the_account_is(
    alice_client: TestClient, bob_client: TestClient, session: Session,
    alice_account: User, bob_account: User,
) -> None:
    url = upload_avatar(alice_client).json()["avatar_url"]
    follow(session, bob_account, alice_account)
    add_post(session, alice_account, "Hello")
    add_story(session, alice_account)

    answers = {
        "profile": bob_client.get("/users/alice").json()["avatar_url"],
        "own profile": alice_client.get("/users/me").json()["avatar_url"],
        "account": alice_client.get("/auth/me").json()["avatar_url"],
        "post": bob_client.get("/feed").json()["items"][0]["author"]["avatar_url"],
        "follower list": bob_client.get("/users/bob/following").json()["items"][0][
            "avatar_url"
        ],
        "story": bob_client.get("/stories").json()["items"][0]["author"]["avatar_url"],
    }

    assert answers == dict.fromkeys(answers, url)


def test_picture_cannot_be_set_by_naming_an_address(
    alice_client: TestClient, session: Session
) -> None:
    only_address = alice_client.patch(
        "/users/me", json={"avatar_url": "https://tracker.example/pixel.png"}
    )
    with_name = alice_client.patch(
        "/users/me",
        json={"display_name": "Alice L.", "avatar_url": "https://tracker.example/p.png"},
    )

    assert only_address.status_code == 422
    assert with_name.status_code == 200
    assert with_name.json()["avatar_url"] is None
    assert avatar_id_of(session) is None


def test_upload_that_is_not_a_picture_changes_nothing(
    alice_client: TestClient, session: Session
) -> None:
    url = upload_avatar(alice_client).json()["avatar_url"]
    before = stored_pictures()

    response = upload_avatar(alice_client, b"<?php system($_GET['c']); ?>")

    assert response.status_code == 422
    assert response.json() == UNREADABLE
    assert stored_pictures() == before
    assert alice_client.get("/users/me").json()["avatar_url"] == url


def test_picture_larger_than_the_limit_is_refused(
    alice_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    upload = picture("PNG", (300, 300), color=(1, 2, 3))
    monkeypatch.setattr(settings, "max_image_upload_bytes", len(upload) - 1)

    response = upload_avatar(alice_client, upload)

    assert response.status_code == 413
    assert response.json() == TOO_LARGE
    assert stored_pictures() == set()


def test_body_far_beyond_the_limit_is_refused_before_it_is_read(
    alice_client: TestClient,
) -> None:
    response = upload_avatar(alice_client, b"\0" * (settings.max_image_upload_bytes + 128 * 1024))

    assert response.status_code == 413
    assert stored_pictures() == set()


def test_uploads_are_limited_per_account_avatars_and_stories_together(
    alice_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "image_uploads_per_account", 3)

    answers = [
        upload_avatar(alice_client).status_code,
        alice_client.post("/stories", **story_form()).status_code,
        # A refused file counts as well: it was decoded all the same.
        upload_avatar(alice_client, b"not a picture").status_code,
    ]
    refused = upload_avatar(alice_client)

    assert answers == [200, 201, 422]
    assert refused.status_code == 429
    assert int(refused.headers["retry-after"]) > 0


def test_picture_cannot_be_uploaded_from_another_site(
    alice_client: TestClient, session: Session
) -> None:
    response = upload_avatar(alice_client, headers={"Origin": FOREIGN_ORIGIN})

    assert response.status_code == 403
    assert avatar_id_of(session) is None
    assert stored_pictures() == set()


def test_uploading_and_removing_need_a_session(client: TestClient) -> None:
    assert upload_avatar(client).status_code == 401
    assert client.delete("/users/me/avatar").status_code == 401
    assert stored_pictures() == set()


@pytest.mark.parametrize("hidden", ["deactivated", "unverified"])
def test_picture_of_an_account_that_is_not_shown_is_not_found(
    make_client, session: Session, hidden: str
) -> None:
    carol = add_user(
        session, "carol", active=hidden != "deactivated", verified=hidden != "unverified"
    )
    carol.avatar_id = store_picture()
    session.flush()

    response = make_client().get(f"/users/carol/avatar/{carol.avatar_id}")

    assert response.status_code == 404


def test_picture_is_found_only_under_its_own_account_and_current_id(
    alice_client: TestClient, make_client, session: Session, bob_account: User
) -> None:
    upload_avatar(alice_client)
    alice_avatar = avatar_id_of(session)
    bob_account.avatar_id = store_picture()
    session.flush()
    visitor = make_client()

    assert visitor.get(f"/users/alice/avatar/{alice_avatar}").status_code == 200
    assert visitor.get(f"/users/ALICE/avatar/{alice_avatar}").status_code == 200
    assert visitor.get(f"/users/bob/avatar/{alice_avatar}").status_code == 404
    assert visitor.get(f"/users/alice/avatar/{bob_account.avatar_id}").status_code == 404
    assert visitor.get(f"/users/alice/avatar/{store_picture()}").status_code == 404
    assert visitor.get("/users/alice/avatar/not-an-id").status_code == 422
    assert visitor.get("/users/alice/avatar/../../etc/passwd").status_code == 404


# --- the picture of a story ----------------------------------------------------


@pytest.fixture
def followed(session: Session, alice_account: User, bob_account: User) -> None:
    follow(session, bob_account, alice_account)


def test_story_picture_is_served_to_whoever_may_see_the_story(
    alice_client: TestClient,
    bob_client: TestClient,
    make_client,
    session: Session,
    followed: None,
) -> None:
    story = alice_client.post("/stories", **story_form()).json()
    carol = make_client()
    add_user(session, "carol")
    log_in(carol, "carol")

    answers = {
        "author": alice_client.get(story["media_url"]),
        "follower": bob_client.get(story["media_url"]),
        "somebody else": carol.get(story["media_url"]),
        "anonymous": make_client().get(story["media_url"]),
    }

    assert {who: response.status_code for who, response in answers.items()} == {
        "author": 200,
        "follower": 200,
        "somebody else": 404,
        "anonymous": 401,
    }
    served = answers["follower"]
    assert served.content == answers["author"].content
    assert served.headers["content-type"] == "image/webp"
    assert served.headers["cache-control"] == "private, no-cache"
    assert served.headers["cross-origin-resource-policy"] == "same-site"


def test_browser_is_asked_again_every_time_and_unfollowing_ends_it(
    alice_client: TestClient,
    bob_client: TestClient,
    session: Session,
    alice_account: User,
    bob_account: User,
    followed: None,
) -> None:
    url = alice_client.post("/stories", **story_form()).json()["media_url"]
    etag = bob_client.get(url).headers["etag"]

    still_shown = bob_client.get(url, headers={"If-None-Match": etag})
    bob_client.delete("/users/alice/follow")
    unfollowed = bob_client.get(url, headers={"If-None-Match": etag})

    assert still_shown.status_code == 304
    # A copy in the browser is not a way around who may see the story.
    assert unfollowed.status_code == 404


def test_picture_of_an_expired_story_is_not_found(
    alice_client: TestClient, bob_client: TestClient, followed: None, clock
) -> None:
    url = alice_client.post("/stories", **story_form()).json()["media_url"]
    clock.advance(hours=24)

    assert bob_client.get(url).status_code == 404
    assert alice_client.get(url).status_code == 404


def test_deleting_a_story_removes_its_picture(
    alice_client: TestClient, session: Session
) -> None:
    story = alice_client.post("/stories", **story_form()).json()
    assert len(stored_pictures()) == 1

    assert alice_client.delete(f"/stories/{story['id']}").status_code == 204

    assert stored_pictures() == set()
    assert alice_client.get(story["media_url"]).status_code == 404


def test_story_that_is_not_saved_leaves_no_picture_behind(
    make_client, session: Session, alice_account: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fail(*args: object, **kwargs: object) -> None:
        raise RuntimeError("the database went away")

    monkeypatch.setattr(stories_service, "hold_account", fail)
    client = make_client(raise_server_exceptions=False)
    log_in(client, "alice")

    response = client.post("/stories", **story_form())

    assert response.status_code == 500
    assert session.scalar(select(func.count()).select_from(Story)) == 0
    assert stored_pictures() == set()


# --- what goes with what -------------------------------------------------------


def test_deleting_an_account_removes_its_pictures_and_no_one_elses(
    alice_client: TestClient,
    bob_client: TestClient,
    session: Session,
    followed: None,
) -> None:
    upload_avatar(alice_client)
    alice_client.post("/stories", **story_form())
    bobs = bob_client.post("/stories", **story_form()).json()
    bobs_picture = session.scalar(select(Story.media_id).where(Story.id == bobs["id"]))
    assert len(stored_pictures()) == 3

    response = alice_client.post("/auth/delete-account", json={"password": PASSWORD})

    assert response.status_code == 204
    assert stored_pictures() == {bobs_picture}


def test_purge_removes_the_pictures_of_the_stories_it_removes(
    session: Session, alice_account: User
) -> None:
    long_ago = datetime.now(timezone.utc) - timedelta(days=10)
    old = add_story(session, alice_account, created_at=long_ago).media_id
    current = add_story(session, alice_account).media_id

    retention.purge(session, datetime.now(timezone.utc))

    assert stored_pictures() == {current}
    assert old not in stored_pictures()


def age(image_id: object, hours: float) -> None:
    """Make the picture's file as old as this."""
    path = image_store().directory / f"{image_id}.webp"
    then = time.time() - hours * 3600
    os.utime(path, (then, then))


def test_purge_removes_old_files_that_no_row_refers_to_and_nothing_else(
    session: Session, alice_account: User
) -> None:
    now = datetime.now(timezone.utc)
    alice_account.avatar_id = avatar = store_picture()
    story = add_story(session, alice_account)
    old_orphan, new_orphan = store_picture(), store_picture()
    for image_id in (avatar, story.media_id, old_orphan):
        age(image_id, hours=5)
    # A file that is no picture's is not this purge's to remove.
    (image_store().directory / "notes.txt").write_text("not a picture")
    session.flush()

    pending = retention.pending(session, now)
    report = retention.purge(session, now)

    assert pending.orphaned_pictures == report.orphaned_pictures == 1
    assert stored_pictures() == {avatar, story.media_id, new_orphan}
    assert (image_store().directory / "notes.txt").exists()


def test_purge_removes_a_file_whose_writing_never_finished(session: Session) -> None:
    directory = image_store().directory
    directory.mkdir(parents=True, exist_ok=True)
    partial = directory / f"{store_picture()}.webp.abc123.part"
    partial.write_bytes(b"half a picture")
    then = time.time() - 5 * 3600
    os.utime(partial, (then, then))

    retention.purge(session, datetime.now(timezone.utc))

    assert not partial.exists()


def test_no_picture_is_left_without_a_file(session: Session, alice_account: User) -> None:
    # The other way round from the purge: every row names a file that is
    # there, after everything above has had its turn.
    alice_account.avatar_id = store_picture()
    add_story(session, alice_account)
    session.flush()

    retention.purge(session, datetime.now(timezone.utc) + timedelta(hours=2))

    named = {alice_account.avatar_id, *session.scalars(select(Story.media_id))}
    assert named <= stored_pictures()


# --- the export -----------------------------------------------------------------


def export(client: TestClient, **kwargs: object):
    return client.post("/users/me/export", json={"password": PASSWORD}, **kwargs)


def test_export_is_an_archive_of_the_document_and_the_pictures(
    alice_client: TestClient,
    bob_client: TestClient,
    session: Session,
    alice_account: User,
    bob_account: User,
) -> None:
    follow(session, alice_account, bob_account)
    avatar_url = upload_avatar(alice_client).json()["avatar_url"]
    story = alice_client.post("/stories", **story_form("Mine")).json()
    bobs = bob_client.post("/stories", **story_form("Bob's")).json()
    alice_client.post(f"/stories/{bobs['id']}/view")

    response = export(alice_client, headers={"Origin": FRONTEND})

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert response.headers["cache-control"] == "no-store"
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    assert response.headers["content-disposition"] == (
        f'attachment; filename="hopsnop-export-alice-{day}.zip"'
    )
    # The frontend may read the name of the file to save.
    assert "content-disposition" in response.headers[
        "access-control-expose-headers"
    ].lower()
    document, files = unzip(response)
    story_file = f"images/stories/{story['id']}.webp"
    assert document["export_version"] == 2
    assert document["account"]["avatar_file"] == "images/avatar.webp"
    assert [entry["media_file"] for entry in document["stories"]] == [story_file]
    assert set(files) == {"images/avatar.webp", story_file}
    # The files are the pictures exactly as the API serves them.
    assert files["images/avatar.webp"] == alice_client.get(avatar_url).content
    assert files[story_file] == alice_client.get(story["media_url"]).content


def test_archive_holds_one_folder_named_like_the_file(alice_client: TestClient) -> None:
    import zipfile

    response = export(alice_client)

    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        names = archive.namelist()
    folder = response.headers["content-disposition"].split('"')[1].removesuffix(".zip")
    assert names == [f"{folder}/export.json"]


def test_export_without_pictures_names_none(alice_client: TestClient) -> None:
    document, files = unzip(export(alice_client))

    assert document["account"]["avatar_file"] is None
    assert document["stories"] == []
    assert files == {}


def test_same_data_makes_the_same_archive(
    alice_client: TestClient, alice_account: User
) -> None:
    upload_avatar(alice_client)
    alice_client.post("/stories", **story_form())

    first_document, first_files = unzip(export(alice_client))
    second_document, second_files = unzip(export(alice_client))

    first_document.pop("generated_at")
    second_document.pop("generated_at")
    assert first_document == second_document
    assert first_files == second_files
