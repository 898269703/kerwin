from pathlib import Path

from app.database import migration_paths


def test_migration_paths_load_all_sql_files_in_order(tmp_path: Path):
    (tmp_path / "004_search_discovery.sql").write_text("SELECT 4;", encoding="utf-8")
    (tmp_path / "001_init.sql").write_text("SELECT 1;", encoding="utf-8")
    (tmp_path / "README.md").write_text("ignore", encoding="utf-8")

    paths = migration_paths(tmp_path)

    assert [path.name for path in paths] == ["001_init.sql", "004_search_discovery.sql"]
