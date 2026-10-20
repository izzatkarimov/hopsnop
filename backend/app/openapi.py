"""Writes the API's OpenAPI schema, the description of every route and body.

    python -m app.openapi > openapi.json

The frontend's types are generated from the file this writes
(``frontend/lib/api-schema.d.ts``, see the frontend's ``npm run api:types``),
and CI regenerates both and fails if either differs from what is committed.
So a change to what the API accepts or answers cannot reach the frontend
unnoticed.

The schema is built from the routes and the Pydantic models alone. Nothing
connects to the database, but the settings are loaded, so ``DATABASE_URL``
must be set to something, as for any other command of the application.
"""

import json
import sys

from app.main import create_app


def main() -> None:
    schema = create_app().openapi()
    json.dump(schema, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
