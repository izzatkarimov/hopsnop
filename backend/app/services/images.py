"""Every upload is decoded and redrawn as a metadata-free WebP; only that is stored."""

import warnings
from dataclasses import dataclass
from io import BytesIO
from typing import Literal

from PIL import Image, ImageCms, ImageOps, UnidentifiedImageError

# The only decoders an upload can reach.
ACCEPTED_FORMATS = ("JPEG", "PNG", "WEBP")

# Checked from the header before decoding, against decompression bombs.
MAX_PIXELS = 50_000_000

# Cut from the middle of the picture.
AVATAR_SIZE = 400
# Longer side; a smaller picture isn't enlarged.
STORY_MAX_SIDE = 1440

_QUALITY = 85
# 0 to 6; 4 is the encoder's default.
_METHOD = 4

Purpose = Literal["avatar", "story"]


class ImageError(Exception):
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
    data: bytes
    width: int
    height: int


def make_picture(upload: bytes, purpose: Purpose) -> Picture:
    try:
        with warnings.catch_warnings():
            # Pillow warns by its own limit; ``MAX_PIXELS`` is the one that applies.
            warnings.simplefilter("ignore", Image.DecompressionBombWarning)
            opened = Image.open(BytesIO(upload), formats=ACCEPTED_FORMATS)
        with opened as image:
            width, height = image.size
            if width < 1 or height < 1:
                raise UnreadableImageError
            if width * height > MAX_PIXELS:
                raise TooManyPixelsError
            # JPEG only: decode at the smallest scale at least as large as what is kept.
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
        # Not an accepted format, or damaged; which of these isn't told.
        raise UnreadableImageError from None

    out = BytesIO()
    picture.save(out, "WEBP", quality=_QUALITY, method=_METHOD)
    return Picture(out.getvalue(), *picture.size)


def _decoded_size(width: int, height: int, purpose: Purpose) -> tuple[int, int]:
    if purpose == "avatar":
        # Both sides at least the avatar's, so the square can be cut.
        return AVATAR_SIZE, AVATAR_SIZE
    scale = min(1.0, STORY_MAX_SIDE / max(width, height))
    return max(1, round(width * scale)), max(1, round(height * scale))


def _redraw(image: Image.Image, purpose: Purpose) -> Image.Image:
    image = ImageOps.exif_transpose(image)
    image = _in_srgb(image)
    if purpose == "avatar":
        image = ImageOps.fit(
            image, (AVATAR_SIZE, AVATAR_SIZE), Image.Resampling.LANCZOS
        )
    else:
        image.thumbnail((STORY_MAX_SIDE, STORY_MAX_SIDE), Image.Resampling.LANCZOS)
    # A new image: EXIF, XMP, comments and the profile stay behind with the old one.
    clean = Image.new(image.mode, image.size)
    clean.paste(image)
    return clean


def _in_srgb(image: Image.Image) -> Image.Image:
    """Converted with its profile, to look the same; an unusable one is ignored."""
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
