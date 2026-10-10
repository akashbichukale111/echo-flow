"""Tamper-evident, append-only audit.

* Each event carries seq, prev_hash and hash (SHA-256 over canonical JSON): editing or removing any
  event breaks the chain, which `verify_chain` detects.
* Events are also appended to a separate sink. SQLite: triggers abort UPDATE/DELETE. DynamoDB: the Lambda
  role is granted PutItem/GetItem/Query only (no Update/Delete) and puts are conditional.
There is no API that edits or deletes audit events.
"""
import hashlib
import json
import os
import sqlite3
from typing import Protocol

GENESIS = "GENESIS"


def canonical(event: dict) -> bytes:
    body = {k: v for k, v in event.items() if k != "hash"}
    return json.dumps(body, sort_keys=True, separators=(",", ":"), allow_nan=False, default=str).encode()


def seal(event: dict, prev_hash: str, seq: int) -> dict:
    event["seq"], event["prev_hash"] = seq, prev_hash
    event["hash"] = hashlib.sha256(canonical(event)).hexdigest()
    return event


def verify_chain(events: list[dict]) -> dict:
    prev = GENESIS
    for i, e in enumerate(events, start=1):
        if e.get("seq") != i or e.get("prev_hash") != prev:
            return {"valid": False, "events": len(events), "broken_at_seq": i, "reason": "chain linkage broken",
                    "head_hash": None}
        if hashlib.sha256(canonical(e)).hexdigest() != e.get("hash"):
            return {"valid": False, "events": len(events), "broken_at_seq": i, "reason": "event content altered",
                    "head_hash": None}
        prev = e["hash"]
    return {"valid": True, "events": len(events), "broken_at_seq": None, "reason": "", "head_hash": prev}


class AuditSink(Protocol):
    name: str
    def append(self, scenario_id: str, events: list[dict]) -> None: ...
    def read(self, scenario_id: str) -> list[dict]: ...
    def health(self) -> bool: ...


class NullSink:
    name = "NOT CONNECTED"
    def append(self, scenario_id, events): return None
    def read(self, scenario_id): return []
    def health(self): return False


class SQLiteAuditSink:
    name = "sqlite-append-only"

    def __init__(self, path: str):
        self.path = path
        db = sqlite3.connect(path, timeout=10)
        try:
            with db:
                db.execute("CREATE TABLE IF NOT EXISTS audit (scenario_id TEXT NOT NULL, seq INTEGER NOT NULL, "
                           "hash TEXT NOT NULL, event TEXT NOT NULL, PRIMARY KEY (scenario_id, seq))")
                db.execute("CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit "
                           "BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END")
                db.execute("CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit "
                           "BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END")
        finally:
            db.close()

    def _db(self):
        return sqlite3.connect(self.path, timeout=10)

    def append(self, scenario_id, events):
        db = self._db()
        try:
            with db:
                for e in events:
                    db.execute("INSERT OR IGNORE INTO audit VALUES (?,?,?,?)",
                               (scenario_id, e["seq"], e["hash"], json.dumps(e, sort_keys=True, default=str)))
        finally:
            db.close()

    def read(self, scenario_id):
        db = self._db()
        try:
            rows = db.execute("SELECT event FROM audit WHERE scenario_id=? ORDER BY seq", (scenario_id,)).fetchall()
        finally:
            db.close()
        return [json.loads(r[0]) for r in rows]

    def health(self):
        db = self._db()
        try:
            return db.execute("SELECT 1").fetchone()[0] == 1
        finally:
            db.close()


class DynamoAuditSink:
    name = "dynamodb-append-only"

    def __init__(self, table_name: str):
        import boto3
        self.table = boto3.resource("dynamodb").Table(table_name)

    def append(self, scenario_id, events):
        from decimal import Decimal

        from botocore.exceptions import ClientError
        for e in events:
            try:
                self.table.put_item(
                    Item={"scenario_id": scenario_id, "seq": Decimal(e["seq"]), "hash": e["hash"],
                          "event": json.dumps(e, sort_keys=True, default=str)},
                    ConditionExpression="attribute_not_exists(seq)")
            except ClientError as exc:
                if exc.response["Error"]["Code"] != "ConditionalCheckFailedException":
                    raise

    def read(self, scenario_id):
        from boto3.dynamodb.conditions import Key
        items, kwargs = [], {"KeyConditionExpression": Key("scenario_id").eq(scenario_id),
                             "ConsistentRead": True}
        while True:
            r = self.table.query(**kwargs)
            items += r["Items"]
            if "LastEvaluatedKey" not in r:
                break
            kwargs["ExclusiveStartKey"] = r["LastEvaluatedKey"]
        return [json.loads(i["event"]) for i in sorted(items, key=lambda i: int(i["seq"]))]

    def health(self):
        self.table.load()
        return True


def sink_for(repo) -> "AuditSink":
    from .repository import DynamoRepository, SQLiteRepository
    if isinstance(repo, SQLiteRepository):
        return SQLiteAuditSink(repo.path)
    if isinstance(repo, DynamoRepository) and os.getenv("ECHO_AUDIT_TABLE"):
        return DynamoAuditSink(os.environ["ECHO_AUDIT_TABLE"])
    return NullSink()
