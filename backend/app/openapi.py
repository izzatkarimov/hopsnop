"""Prints the OpenAPI schema (``python -m app.openapi``); CI checks it's current."""

import json
import sys

from app.main import create_app


def main() -> None:
    schema = create_app().openapi()
    json.dump(schema, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
