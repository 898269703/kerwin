from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool


class Database:
    def __init__(self, dsn: str):
        self.pool = AsyncConnectionPool(dsn, min_size=1, max_size=5, open=False, kwargs={"row_factory": dict_row})

    async def open(self):
        await self.pool.open()
        await self.pool.wait()

    async def close(self):
        await self.pool.close()

    async def migrate(self, migration_path: str):
        sql = Path(migration_path).read_text(encoding="utf-8")
        async with self.pool.connection() as conn:
            await conn.execute(sql)
            await conn.commit()

    async def fetch_all(self, sql: str, params=()):
        async with self.pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(sql, params)
                return list(await cur.fetchall())

    async def fetch_one(self, sql: str, params=()):
        async with self.pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(sql, params)
                return await cur.fetchone()

    async def execute(self, sql: str, params=()):
        async with self.pool.connection() as conn:
            await conn.execute(sql, params)
            await conn.commit()

    async def ping(self) -> bool:
        row = await self.fetch_one("SELECT 1 AS ok")
        return bool(row and row.get("ok") == 1)
