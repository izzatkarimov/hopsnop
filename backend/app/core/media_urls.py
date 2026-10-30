"""Picture paths on the API itself, so only this server sees who views one."""

import uuid


def avatar_url(username: str, avatar_id: uuid.UUID) -> str:
    """Includes the id, so the old address stops working when the picture changes."""
    return f"/users/{username}/avatar/{avatar_id}"


def story_media_url(story_id: uuid.UUID) -> str:
    return f"/stories/{story_id}/media"
