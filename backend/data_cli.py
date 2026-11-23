import argparse
from io import StringIO
from pathlib import Path

from sqlalchemy.exc import SQLAlchemyError

from backend.series import database_url, engine_for, import_csv, init_database

MAX_CSV_BYTES = 2 * 1024 * 1024


def main():
    parser = argparse.ArgumentParser(description="Initialize or import EconoMind data")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("init")
    load = commands.add_parser("import")
    load.add_argument("file", type=Path)
    load.add_argument("--source", required=True)
    args = parser.parse_args()

    url = database_url()
    if not url:
        parser.error("set ECONOMIND_DATABASE_URL first")
    engine = None
    try:
        engine = engine_for(url)
        if args.command == "init":
            init_database(engine)
            print("Database initialized")
            return
        with args.file.open("rb") as file:
            content = file.read(MAX_CSV_BYTES + 1)
        if len(content) > MAX_CSV_BYTES:
            raise ValueError("CSV exceeds the 2 MiB limit")
        dataset_id = import_csv(
            engine, StringIO(content.decode("utf-8-sig"), newline=""), args.source,
        )
        print(f"dataset_id={dataset_id}")
    except UnicodeDecodeError:
        parser.exit(1, "Import failed: CSV must be UTF-8\n")
    except (OSError, ValueError) as error:
        parser.exit(1, f"Operation failed: {error}\n")
    except SQLAlchemyError as error:
        parser.exit(1, f"Database operation failed ({type(error).__name__})\n")
    finally:
        if engine is not None:
            engine.dispose()


if __name__ == "__main__":
    main()
