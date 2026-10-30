"""Picture files by id; the folder may hold more files than rows, never fewer."""

import os
import tempfile
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from app.core.config import settings

SUFFIX = ".webp"
# Renamed into place once complete, so a picture is there whole or not at all.
_PARTIAL = ".part"


@dataclass(frozen=True)
class StoredFile:
    # None for a file whose name is no picture's.
    image_id: uuid.UUID | None
    name: str
    modified_at: datetime


class ImageStore:
    def __init__(self, directory: Path) -> None:
        self.directory = directory

    def _path(self, image_id: uuid.UUID) -> Path:
        return self.directory / f"{uuid.UUID(str(image_id))}{SUFFIX}"

    def save(self, image_id: uuid.UUID, data: bytes) -> None:
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
        try:
            return self._path(image_id).read_bytes()
        except FileNotFoundError:
            return None

    def delete(self, image_ids: Iterable[uuid.UUID]) -> int:
        """Missing files are skipped; returns how many were removed."""
        removed = 0
        for image_id in image_ids:
            try:
                self._path(image_id).unlink()
            except FileNotFoundError:
                continue
            removed += 1
        return removed

    def remove_file(self, name: str) -> bool:
        path = self.directory / Path(name).name
        try:
            path.unlink()
        except FileNotFoundError:
            return False
        return True

    def files(self) -> list[StoredFile]:
        """Partial files count under their intended id, so the purge sees orphans."""
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
    return ImageStore(Path(settings.image_storage_path))
