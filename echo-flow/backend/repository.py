import json
import os
import sqlite3
from decimal import Decimal
from typing import Protocol

from .domain import uid


class Conflict(RuntimeError):
    """The stored scenario changed after this request read it."""


class Repository(Protocol):
    def create(self, document: dict) -> None: ...
    def get(self, scenario_id: str) -> dict: ...
    def save(self, document: dict, expected_version: int) -> dict: ...
    def health(self) -> bool: ...


class SQLiteRepository:
    def __init__(self, path: str):
        self.path = path
        db = self.connect()
        try:
            with db:
                db.execute("CREATE TABLE IF NOT EXISTS scenarios ("
                           "id TEXT PRIMARY KEY, version INTEGER NOT NULL, document TEXT NOT NULL)")
        finally:
            db.close()

    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.execute("PRAGMA journal_mode=WAL")
        return db

    def _run(self, fn):
        db = self.connect()
        try:
            with db:
                return fn(db)
        finally:
            db.close()

    def create(self, document: dict) -> None:
        self._run(lambda db: db.execute(
            "INSERT INTO scenarios VALUES (?, ?, ?)",
            (document["id"], 0, json.dumps(document, allow_nan=False))))

    def get(self, scenario_id: str) -> dict:
        row = self._run(lambda db: db.execute(
            "SELECT document FROM scenarios WHERE id = ?", (scenario_id,)).fetchone())
        if row is None:
            raise KeyError(scenario_id)
        return json.loads(row[0])

    def save(self, document: dict, expected_version: int) -> dict:
        document = {**document, "version": expected_version + 1}
        result = self._run(lambda db: db.execute(
            "UPDATE scenarios SET version=?, document=? WHERE id=? AND version=?",
            (document["version"], json.dumps(document, allow_nan=False),
             document["id"], expected_version)))
        if result.rowcount != 1:
            raise Conflict("Scenario changed; reload before retrying")
        return document

    def health(self) -> bool:
        return self._run(lambda db: db.execute("SELECT 1").fetchone()[0] == 1)


class DynamoRepository:
    """DynamoDB stores versioned pointers; immutable snapshots live in S3."""

    def __init__(self):
        import boto3
        self.table = boto3.resource("dynamodb").Table(os.environ["ECHO_TABLE"])
        self.s3 = boto3.client("s3")
        self.bucket = os.environ["ECHO_BUCKET"]

    def upload(self, document: dict) -> str:
        key = f"scenarios/{document['id']}/{uid()}.json"
        self.s3.put_object(Bucket=self.bucket, Key=key,
                           Body=json.dumps(document, allow_nan=False).encode(),
                           ContentType="application/json", ServerSideEncryption="AES256")
        return key

    def create(self, document: dict) -> None:
        key = self.upload(document)
        self.table.put_item(Item={"id": document["id"], "version": Decimal(0), "s3_key": key},
                            ConditionExpression="attribute_not_exists(id)")

    def get(self, scenario_id: str) -> dict:
        item = self.table.get_item(Key={"id": scenario_id}, ConsistentRead=True).get("Item")
        if not item:
            raise KeyError(scenario_id)
        response = self.s3.get_object(Bucket=self.bucket, Key=item["s3_key"])
        return json.loads(response["Body"].read())

    def save(self, document: dict, expected_version: int) -> dict:
        from botocore.exceptions import ClientError
        document = {**document, "version": expected_version + 1}
        key = self.upload(document)
        try:
            self.table.update_item(
                Key={"id": document["id"]},
                UpdateExpression="SET #v = :new, s3_key = :key",
                ConditionExpression="#v = :old",
                ExpressionAttributeNames={"#v": "version"},
                ExpressionAttributeValues={":new": Decimal(expected_version + 1),
                                           ":old": Decimal(expected_version), ":key": key})
        except ClientError as exc:
            if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
                raise Conflict("Scenario changed; reload before retrying") from exc
            raise
        return document

    def health(self) -> bool:
        self.table.load()
        self.s3.head_bucket(Bucket=self.bucket)
        return True


def repository() -> Repository:
    if os.getenv("ECHO_STORE", "sqlite") == "dynamodb":
        return DynamoRepository()
    return SQLiteRepository(os.getenv("ECHO_SQLITE_PATH", "echo-flow.sqlite3"))
