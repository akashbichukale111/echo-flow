import json
import sqlite3
import threading
from copy import deepcopy

from .config import settings
from .seed import WORKSPACES, seed_state

MAX_BYTES = 300_000

class ConflictError(Exception):
    pass

class CapacityError(Exception):
    pass

def encode(state: dict) -> str:
    text = json.dumps(state, allow_nan=False, separators=(",", ":"))
    if len(text.encode()) > MAX_BYTES:
        raise CapacityError(
            "Pilot workspace capacity reached; archive/export before adding records"
        )
    return text

def default_workspace() -> str:
    return "pilot" if settings.mode == "pilot" else "demo"

def check(workspace: str | None) -> str:
    workspace = workspace or default_workspace()
    if workspace not in WORKSPACES:
        raise ValueError("Unknown workspace")
    return workspace

# Workspaces: demo (id 1, unchanged from earlier releases) and pilot (id 2).
# Pilot content is seeded lazily so a missing dataset never blocks startup.
_IDS = {"demo": 1, "pilot": 2}

class SQLiteRepository:
    def __init__(self, path: str):
        self.path = path
        self.lock = threading.RLock()
        with sqlite3.connect(path) as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute(
                "CREATE TABLE IF NOT EXISTS workspace "
                "(id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, "
                "payload TEXT NOT NULL)"
            )
            connection.execute(
                "INSERT OR IGNORE INTO workspace VALUES (1, 1, ?)",
                (encode(seed_state("demo")),)
            )

    def _ensure(self, connection, workspace: str):
        if workspace == "pilot":
            connection.execute(
                "INSERT OR IGNORE INTO workspace VALUES (2, 1, ?)",
                (encode(seed_state("pilot")),)
            )

    def read(self, workspace: str | None = None) -> dict:
        workspace = check(workspace)
        with self.lock, sqlite3.connect(self.path) as connection:
            self._ensure(connection, workspace)
            result = connection.execute(
                "SELECT payload FROM workspace WHERE id=?", (_IDS[workspace],)
            ).fetchone()
        return json.loads(result[0])

    def mutate(self, operation, workspace: str | None = None):
        workspace = check(workspace)
        with self.lock, sqlite3.connect(self.path, timeout=5) as connection:
            connection.execute("BEGIN IMMEDIATE")
            self._ensure(connection, workspace)
            revision, payload = connection.execute(
                "SELECT revision, payload FROM workspace WHERE id=?",
                (_IDS[workspace],)
            ).fetchone()
            state = json.loads(payload)
            result = operation(state)
            connection.execute(
                "UPDATE workspace SET revision=?, payload=? WHERE id=?",
                (revision + 1, encode(state), _IDS[workspace])
            )
            return deepcopy(result)

class DynamoRepository:
    def __init__(self, table: str):
        import boto3
        self.table = boto3.resource(
            "dynamodb", region_name=settings.region
        ).Table(table)

    @staticmethod
    def _key(workspace: str) -> str:
        return f"workspace:{workspace}"

    def _item(self, workspace: str):
        from botocore.exceptions import ClientError
        key = {"pk": self._key(workspace)}
        found = self.table.get_item(Key=key, ConsistentRead=True).get("Item")
        if found:
            return found
        try:
            self.table.put_item(
                Item={**key, "revision": 1,
                      "payload": encode(seed_state(workspace))},
                ConditionExpression="attribute_not_exists(pk)"
            )
        except ClientError as error:
            if error.response["Error"]["Code"] != \
                    "ConditionalCheckFailedException":
                raise
        return self.table.get_item(Key=key, ConsistentRead=True)["Item"]

    def read(self, workspace: str | None = None):
        return json.loads(self._item(check(workspace))["payload"])

    def mutate(self, operation, workspace: str | None = None):
        from botocore.exceptions import ClientError
        workspace = check(workspace)
        item = self._item(workspace)
        state = json.loads(item["payload"])
        result = operation(state)
        try:
            self.table.put_item(
                Item={
                    "pk": self._key(workspace),
                    "revision": int(item["revision"]) + 1,
                    "payload": encode(state)
                },
                ConditionExpression="revision = :revision",
                ExpressionAttributeValues={":revision": item["revision"]}
            )
        except ClientError as error:
            if error.response["Error"]["Code"] == \
                    "ConditionalCheckFailedException":
                raise ConflictError(
                    "Workspace changed concurrently; refresh and retry"
                ) from error
            raise
        return deepcopy(result)

def create_repository():
    return DynamoRepository(settings.table) if settings.table \
        else SQLiteRepository(settings.database)
