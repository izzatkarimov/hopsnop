"""Where the API serves the pictures, as the responses name them.

The addresses are paths on the API itself, to be put after the API's own
origin. No picture is ever served from anywhere else, so whoever views one
is seen by this server alone.
"""

import uuid


def avatar_url(username: str, avatar_id: uuid.UUID) -> str:
    """The account's current picture. A new picture is a new address: the
    old one stops working the moment the picture is replaced or removed."""
    return f"/users/{username}/avatar/{avatar_id}"


def story_media_url(story_id: uuid.UUID) -> str:
    """The picture of a story. It is served to whoever may see the story."""
    return f"/stories/{story_id}/media"
