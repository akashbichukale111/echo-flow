import json
import sqlite3
from typing import Protocol

class Conflict(Exception):
    pass

class Store(Protocol):
    def create(self, kind: str, ident: str, payload: dict) -> dict: ...
    def get(self, kind: str, ident: str) -> dict | None: ...
    def update(self, kind: str, ident: str, revision: int, payload: dict) -> dict: ...
    def list(self, kind: str, limit: int = 100) -> list[dict]: ...

class SQLiteStore:
    def __init__(self, path):
        self.path = path
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("""
                CREATE TABLE IF NOT EXISTS records (
                    kind TEXT NOT NULL,
                    id TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    revision INTEGER NOT NULL,
                    PRIMARY KEY (kind, id)
                )
            """)

    def connect(self):
        return sqlite3.connect(self.path, timeout=10)

    def create(self, kind, ident, payload):
        payload = {**payload, "id": ident, "revision": 0}
        with self.connect() as db:
            db.execute(
                "INSERT INTO records VALUES (?, ?, ?, ?)",
                (kind, ident, json.dumps(payload), 0)
            )
        return payload

    def get(self, kind, ident):
        with self.connect() as db:
            row = db.execute(
                "SELECT payload FROM records WHERE kind=? AND id=?", (kind, ident)
            ).fetchone()
        return json.loads(row[0]) if row else None

    def update(self, kind, ident, revision, payload):
        payload = {**payload, "id": ident, "revision": revision + 1}
        with self.connect() as db:
            cursor = db.execute(
                """UPDATE records SET payload=?, revision=?
                   WHERE kind=? AND id=? AND revision=?""",
                (json.dumps(payload), revision + 1, kind, ident, revision)
            )
            if cursor.rowcount != 1:
                raise Conflict("Trip changed; reload before retrying")
        return payload

    def list(self, kind, limit=100):
        with self.connect() as db:
            rows = db.execute(
                "SELECT payload FROM records WHERE kind=? ORDER BY rowid DESC LIMIT ?",
                (kind, min(limit, 100))
            ).fetchall()
        return [json.loads(row[0]) for row in rows]

class DynamoStore:
    def __init__(self, table, region):
        import boto3
        import os
        if not table:
            raise ValueError("DYNAMODB_TABLE is required for STORE_MODE=dynamodb")
        self.table = boto3.resource("dynamodb", region_name=region).Table(table)
        self.s3 = boto3.client("s3", region_name=region)
        self.bucket = os.getenv("S3_BUCKET", "")

    def create(self, kind, ident, payload):
        payload = {**payload, "id": ident, "revision": 0}
        
        if kind in ("evidence", "report"):
            import json
            if not self.bucket:
                raise ValueError("S3_BUCKET is required for S3 storage in dynamodb mode")
            self.s3.put_object(
                Bucket=self.bucket,
                Key=f"{kind}/{ident}.json",
                Body=json.dumps(payload),
                ContentType="application/json"
            )
            return payload

        self.table.put_item(
            Item={
                "kind": kind, "id": ident, "payload": json.dumps(payload),
                "revision": 0,
            },
            ConditionExpression="attribute_not_exists(id)",
        )
        return payload

    def get(self, kind, ident):
        if kind in ("evidence", "report"):
            import json
            from botocore.exceptions import ClientError
            try:
                obj = self.s3.get_object(Bucket=self.bucket, Key=f"{kind}/{ident}.json")
                return json.loads(obj["Body"].read())
            except ClientError as e:
                if e.response["Error"]["Code"] == "NoSuchKey":
                    return None
                raise

        item = self.table.get_item(
            Key={"kind": kind, "id": ident}, ConsistentRead=True
        ).get("Item")
        return json.loads(item["payload"]) if item else None

    def update(self, kind, ident, revision, payload):
        if kind == "evidence":
            raise NotImplementedError("Evidence updates not supported in S3")
            
        from botocore.exceptions import ClientError
        payload = {**payload, "id": ident, "revision": revision + 1}
        try:
            self.table.put_item(
                Item={
                    "kind": kind, "id": ident,
                    "payload": json.dumps(payload), "revision": revision + 1,
                },
                ConditionExpression="revision = :old",
                ExpressionAttributeValues={":old": revision},
            )
        except ClientError as exc:
            if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
                raise Conflict("Trip changed; reload before retrying") from exc
            raise
        return payload

    def list(self, kind, limit=100):
        if kind == "evidence":
            raise NotImplementedError("Evidence listing not supported in S3")
            
        from boto3.dynamodb.conditions import Key
        result = self.table.query(
            KeyConditionExpression=Key("kind").eq(kind),
            Limit=min(limit, 100),
        )
        return [json.loads(item["payload"]) for item in result.get("Items", [])]
