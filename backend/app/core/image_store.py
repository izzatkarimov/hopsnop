"""Where the files of uploaded pictures are kept.

A picture is a file named after its id, in one folder
(``IMAGE_STORAGE_PATH``). The id is a random UUID that the application makes
itself, never anything a client sent, so a file name can never point outside
the folder.

The database is what says which pictures exist; the folder may hold more
files than that, never fewer:

- A file is written before the row that refers to it is committed. If the
  request fails in between, the file is left without a row.
- A file is removed after the row that referred to it has been removed and
  committed. If that removal does not happen, the file is left without a row.

Either way a row never points at a missing file, and what is left over is a
file that nothing refers to. The retention purge removes those
(``app.services.retention``).

This is the only module that touches the files. A store in some other place,
an S3 bucket say, would be another class with the same four methods.
"""

import os
import tempfile
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from app.core.config import settings

# Every picture is stored in this one format (``app.services.images``).
SUFFIX = ".webp"
# A file that is being written. It is renamed into place once complete, so a
# picture is either there whole or not at all.
_PARTIAL = ".part"


@dataclass(frozen=True)
class StoredFile:
    """A file in the store, as the purge sees it."""

    # The picture's id, or None for a file whose name is no picture's.
    image_id: uuid.UUID | None
    name: str
    modified_at: datetime


class ImageStore:
    def __init__(self, directory: Path) -> None:
        self.directory = directory

    def _path(self, image_id: uuid.UUID) -> Path:
        return self.directory / f"{uuid.UUID(str(image_id))}{SUFFIX}"

    def save(self, image_id: uuid.UUID, data: bytes) -> None:
        """Store a picture under its id, whole or not at all."""
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        descriptor, partial = tempfile.mkstemp(
            dir=self.directory, prefix=f"{image_id}.", suffix=_PARTIAL
        )
        try:
            with os.fdopen(descriptor, "wb") as file:
                file.write(data)
                file.flush()
                os.fsync(file.fileno())
            os.replace(partial, self._path(image_id))
        except BaseException:
            Path(partial).unlink(missing_ok=True)
            raise

    def read(self, image_id: uuid.UUID) -> bytes | None:
        """The picture's bytes, or None if there is no such file."""
        try:
            return self._path(image_id).read_bytes()
        except FileNotFoundError:
            return None

    def delete(self, image_ids: Iterable[uuid.UUID]) -> int:
        """Remove these pictures' files. Those that are not there are skipped.

        Returns how many were removed.
        """
        removed = 0
        for image_id in image_ids:
            try:
                self._path(image_id).unlink()
            except FileNotFoundError:
                continue
            removed += 1
        return removed

    def remove_file(self, name: str) -> bool:
        """Remove a file of the folder by its name, for the purge."""
        path = self.directory / Path(name).name
        try:
            path.unlink()
        except FileNotFoundError:
            return False
        return True

    def files(self) -> list[StoredFile]:
        """Every file in the folder, with the picture it is, if it is one.

        A partial file left by a write that never finished is listed under
        the id it was being written for, so that it is treated like any
        other file of a picture that no row refers to.
        """
        if not self.directory.is_dir():
            return []
        found = []
        for entry in os.scandir(self.directory):
            if not entry.is_file(follow_symlinks=False):
                continue
            modified_at = datetime.fromtimestamp(
                entry.stat(follow_symlinks=False).st_mtime, timezone.utc
            )
            found.append(
                StoredFile(_image_id_of(entry.name), entry.name, modified_at)
            )
        return found


def _image_id_of(name: str) -> uuid.UUID | None:
    stem = name.split(".", 1)[0]
    try:
        return uuid.UUID(stem)
    except ValueError:
        return None


def image_store() -> ImageStore:
    """The store, where the settings say it is at this moment."""
    return ImageStore(Path(settings.image_storage_path))
