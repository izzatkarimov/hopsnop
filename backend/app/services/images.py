"""Turning an uploaded file into a picture that is safe to store and show.

Nothing that is uploaded is stored as it came. Every upload is decoded,
checked and drawn again as a new image, and only that is kept:

- **The type is what the bytes are.** JPEG, PNG and WebP are accepted, and
  which one a file is, is read from the file itself. What the client says it
  is (a file name, a declared content type) is not looked at. Pillow is told
  to try those three decoders and no others, so an upload never reaches the
  code of some rarely used format.
- **Its size is checked before it is decoded.** The dimensions are read from
  the header, and a picture of more than ``MAX_PIXELS`` is refused before any
  of it is unpacked: a small file can claim to be enormous (a decompression
  bomb). A large JPEG is decoded at a reduced scale to begin with, which
  costs a fraction of the memory.
- **Nothing but the pixels is carried over.** It is turned the right way up
  (by its EXIF orientation), converted to sRGB if it carries a colour
  profile, scaled down, and written as a new WebP file with no metadata at
  all. The location a phone recorded, the camera, the time it was taken, the
  software that edited it, any comment or thumbnail: none of it is in what
  is stored, because none of it is written.
- **Only the first frame** of an animated PNG or WebP is kept.

What a client gets back is therefore always a WebP file made by this server,
of a size this server chose.
"""

import warnings
from dataclasses import dataclass
from io import BytesIO
from typing import Literal

from PIL import Image, ImageCms, ImageOps, UnidentifiedImageError

# The formats that are decoded at all.
ACCEPTED_FORMATS = ("JPEG", "PNG", "WEBP")

# The most pixels an upload may have, read from its header before it is
# decoded. 50 million is more than a 48-megapixel phone photo and far below
# what would exhaust the server's memory.
MAX_PIXELS = 50_000_000

# An avatar is a square of this many pixels a side, cut from the middle of
# the picture.
AVATAR_SIZE = 400
# A story's picture keeps its proportions; its longer side is at most this.
# A smaller picture is not enlarged.
STORY_MAX_SIDE = 1440

# WebP quality. Pictures are viewed on screens, at the sizes above.
_QUALITY = 85
# How long the encoder works at compressing (0 to 6); 4 is its default.
_METHOD = 4

Purpose = Literal["avatar", "story"]


class ImageError(Exception):
    """An upload that is not made a picture. Reported as ``detail`` with
    ``status_code``."""

    status_code = 422
    detail = "The file could not be used as a picture."


class UnreadableImageError(ImageError):
    detail = "The file is not a JPEG, PNG or WebP picture that can be read."


class TooManyPixelsError(ImageError):
    detail = f"The picture is larger than {MAX_PIXELS // 1_000_000} megapixels."


class ImageTooLargeError(ImageError):
    status_code = 413
    detail = "The file is too large."


@dataclass(frozen=True)
class Picture:
    """A picture as it is stored: WebP, and nothing else in the file."""

    data: bytes
    width: int
    height: int


def make_picture(upload: bytes, purpose: Purpose) -> Picture:
    """Decode an upload and draw it again as the picture ``purpose`` needs.

    Raises ``UnreadableImageError`` for anything that is not a picture this
    server reads, and ``TooManyPixelsError`` for one that is too large to
    decode.
    """
    try:
        with warnings.catch_warnings():
            # Pillow warns of large pictures as it opens them, by a limit of
            # its own. The limit that applies is ``MAX_PIXELS``, below.
            warnings.simplefilter("ignore", Image.DecompressionBombWarning)
            opened = Image.open(BytesIO(upload), formats=ACCEPTED_FORMATS)
        with opened as image:
            width, height = image.size
            if width < 1 or height < 1:
                raise UnreadableImageError
            if width * height > MAX_PIXELS:
                raise TooManyPixelsError
            # For a JPEG, decode at the smallest scale that is still at least
            # as large as what is kept. Other formats ignore this.
            image.draft("RGB", _decoded_size(width, height, purpose))
            image.load()
            picture = _redraw(image, purpose)
    except ImageError:
        raise
    except Image.DecompressionBombError:
        # Pillow's own refusal, of a picture far beyond ``MAX_PIXELS``.
        raise TooManyPixelsError from None
    except (
        UnidentifiedImageError,
        OSError,
        SyntaxError,
        ValueError,
        EOFError,
    ):
        # Not one of the formats, or a file of one that is damaged or not
        # what it claims. Which of these it was is not told.
        raise UnreadableImageError from None

    out = BytesIO()
    picture.save(out, "WEBP", quality=_QUALITY, method=_METHOD)
    return Picture(out.getvalue(), *picture.size)


def _decoded_size(width: int, height: int, purpose: Purpose) -> tuple[int, int]:
    if purpose == "avatar":
        # Both sides at least the avatar's, so the square can be cut from it.
        return AVATAR_SIZE, AVATAR_SIZE
    scale = min(1.0, STORY_MAX_SIDE / max(width, height))
    return max(1, round(width * scale)), max(1, round(height * scale))


def _redraw(image: Image.Image, purpose: Purpose) -> Image.Image:
    """The pixels of the image, upright, in sRGB, at the size that is kept,
    in a new image that carries nothing else."""
    image = ImageOps.exif_transpose(image)
    image = _in_srgb(image)
    if purpose == "avatar":
        image = ImageOps.fit(
            image, (AVATAR_SIZE, AVATAR_SIZE), Image.Resampling.LANCZOS
        )
    else:
        image.thumbnail((STORY_MAX_SIDE, STORY_MAX_SIDE), Image.Resampling.LANCZOS)
    # A new image of the same pixels. Whatever the decoder read besides them
    # (EXIF, XMP, comments, the colour profile) stays behind with the old
    # one, so nothing of it can be written by accident.
    clean = Image.new(image.mode, image.size)
    clean.paste(image)
    return clean


def _in_srgb(image: Image.Image) -> Image.Image:
    """The image in RGB, or RGBA if it has transparency, and in sRGB.

    A picture that carries a colour profile (a phone's Display P3, say, or a
    CMYK print profile) is converted with it, so that it looks the same once
    the profile is gone. One whose profile cannot be used is taken as it is.
    """
    has_alpha = image.mode in ("RGBA", "LA", "PA") or (
        image.mode == "P" and "transparency" in image.info
    )
    mode = "RGBA" if has_alpha else "RGB"
    profile = image.info.get("icc_profile")
    if profile:
        try:
            source = ImageCms.ImageCmsProfile(BytesIO(profile))
            converted = ImageCms.profileToProfile(
                image if image.mode in ("RGB", "RGBA", "CMYK") else image.convert(mode),
                source,
                ImageCms.createProfile("sRGB"),
                outputMode=mode,
            )
            if converted is not None:
                return converted
        except (ImageCms.PyCMSError, OSError, ValueError, TypeError):
            pass
    return image.convert(mode)
