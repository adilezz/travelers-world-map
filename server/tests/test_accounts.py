"""Stage 7 — Accounts. Each test names the rule it defends."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from twm_server.app import Config, dispatch
from twm_server.merge import merge_visits
from twm_server.store import IdentityTaken, MemoryStore

SQL = Path(__file__).resolve().parents[1] / "sql" / "001_init.sql"


def call(store, method, path, body=None, token=None):
    auth = f"Bearer {token}" if token else None
    return dispatch(store, Config(auth_mode="dev", google_client_id=""), method, path, body, auth)


def sign_in(store, email="traveler@example.com", visits=None, trips=None, profile=None):
    r = call(store, "POST", "/auth/magic-link", {"email": email})
    assert r.status == 200 and r.body.get("dev_token")
    r2 = call(store, "POST", "/auth/session", {
        "token": r.body["dev_token"],
        "visits": visits or [],
        "trips": trips or [],
        "profile": profile or {},
    })
    assert r2.status == 200, r2.body
    return r2


def test_sql_enables_row_level_security():
    """Row-level security at the database, not only in the API (doc 4 §12)."""
    sql = SQL.read_text(encoding="utf-8")
    assert "ENABLE ROW LEVEL SECURITY" in sql
    for table in ("visit", "trip", "trip_place", "profile"):
        assert f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY" in sql


def test_sql_has_no_place_database():
    """Place data stays static files and never shares a database with user data (doc 4 §1)."""
    sql = SQL.read_text(encoding="utf-8")
    assert "CREATE TABLE places" not in sql.lower().replace("place_feedback", "feedback")
    assert "CREATE TABLE place " not in sql.lower()
    assert " lat " not in sql.lower()
    assert " lon " not in sql.lower()
    assert " score " not in sql.lower()


def test_unmark_does_not_delete_the_row():
    """A visit row is never hard-deleted. Unmarking sets a flag (P4, doc 4 §3.2)."""
    store = MemoryStore()
    uid = store._new_user()
    store.put_visit(uid, {
        "place_id": "MAR-FES", "visited": True, "marked_at": "2020-01-01T00:00:00Z",
        "note": "the medina at dusk",
    })
    store.put_visit(uid, {
        "place_id": "MAR-FES", "visited": False, "marked_at": "2020-01-02T00:00:00Z",
    })
    row = store.visits[(uid, "MAR-FES")]
    assert row["visited"] is False
    assert row["note"] == "the medina at dusk"
    assert store.visit_deletes == 0
    r = call(store, "PUT", "/visits/MAR-FES",
             {"visited": False, "marked_at": "2020-01-03T00:00:00Z"},
             token=store.create_session(uid))
    assert r.status == 200
    assert r.body["visited"] is False
    assert (uid, "MAR-FES") in store.visits


def test_put_visit_is_idempotent():
    """PUT /visits/{place_id} is idempotent — a retry after a dropped connection is safe (doc 4 §4)."""
    store = MemoryStore()
    rec = sign_in(store)
    token = rec.body["session"]
    body = {"visited": True, "marked_at": "2021-06-01T12:00:00Z"}
    a = call(store, "PUT", "/visits/MAR-RABAT", body, token=token)
    b = call(store, "PUT", "/visits/MAR-RABAT", body, token=token)
    assert a.status == 200 and b.status == 200
    assert a.body == b.body
    assert len(store.list_visits(store.user_for_session(token))) == 1


def test_merge_offline_marks_are_kept():
    """Signing in merges, it does not replace. Last-write-wins per place_id by marked_at (doc 4 §8, doc 5 §6)."""
    remote = [
        {"place_id": "A", "visited": True, "marked_at": "2020-01-01T00:00:00Z"},
        {"place_id": "B", "visited": True, "marked_at": "2020-06-01T00:00:00Z", "note": "server"},
    ]
    local = [
        {"place_id": "B", "visited": True, "marked_at": "2021-01-01T00:00:00Z", "note": "offline later"},
        {"place_id": "C", "visited": True, "marked_at": "2021-02-01T00:00:00Z"},
    ]
    merged = {v["place_id"]: v for v in merge_visits(remote, local)}
    assert set(merged) == {"A", "B", "C"}
    assert merged["B"]["note"] == "offline later"
    assert merged["C"]["visited"] is True

    store = MemoryStore()
    first = sign_in(store, "merge@example.com", visits=remote)
    token = first.body["session"]
    call(store, "POST", "/auth/logout", token=token)

    second = sign_in(store, "merge@example.com", visits=local)
    ids = {v["place_id"] for v in second.body["visits"]}
    assert ids == {"A", "B", "C"}
    note = next(v["note"] for v in second.body["visits"] if v["place_id"] == "B")
    assert note == "offline later"


def test_local_tie_wins_so_nothing_is_lost():
    """Equal marked_at: keep the local row so an offline mark is not discarded (doc 5 §11)."""
    stamp = "2020-01-01T00:00:00Z"
    merged = merge_visits(
        [{"place_id": "X", "visited": False, "marked_at": stamp}],
        [{"place_id": "X", "visited": True, "marked_at": stamp}],
    )
    assert merged[0]["visited"] is True


def test_google_attaches_to_the_same_user():
    """Email and Google are linked identities on one user (doc 5 §6)."""
    store = MemoryStore()
    rec = sign_in(store, "same@example.com")
    token = rec.body["session"]
    g = call(store, "POST", "/auth/google", {
        "email": "same@example.com", "sub": "google-sub-1",
    }, token=token)
    assert g.status == 200, g.body
    assert g.body["user"]["id"] == rec.body["user"]["id"]
    assert set(g.body["user"]["providers"]) >= {"email", "google"}


def test_google_first_then_email_is_still_one_user():
    """A further provider attaches to the same user rather than creating a second (doc 5 §6)."""
    store = MemoryStore()
    g = call(store, "POST", "/auth/google", {
        "email": "both@example.com", "sub": "google-sub-2",
        "visits": [{"place_id": "P1", "visited": True, "marked_at": "2020-01-01T00:00:00Z"}],
    })
    assert g.status == 200, g.body
    rec = sign_in(store, "both@example.com")
    assert rec.body["user"]["id"] == g.body["user"]["id"]
    assert any(v["place_id"] == "P1" for v in rec.body["visits"])


def test_google_cannot_steal_another_users_identity():
    store = MemoryStore()
    a = call(store, "POST", "/auth/google", {"email": "a@example.com", "sub": "g-taken"})
    b = sign_in(store, "b@example.com")
    stolen = call(store, "POST", "/auth/google", {
        "email": "a@example.com", "sub": "g-taken",
    }, token=b.body["session"])
    assert stolen.status == 409


def test_signed_out_requests_are_rejected_and_place_files_are_not_here():
    """The API only touches things the traveler owns (doc 4 §4)."""
    store = MemoryStore()
    assert call(store, "GET", "/visits").status == 401
    health = call(store, "GET", "/health")
    assert health.status == 200 and health.body["place_data"] is False


def test_delete_account_removes_server_rows():
    """Delete-account removes the server rows (doc 5 §6). Export-first is the client's job."""
    store = MemoryStore()
    rec = sign_in(store, "gone@example.com", visits=[
        {"place_id": "Z", "visited": True, "marked_at": "2020-01-01T00:00:00Z"},
    ])
    token = rec.body["session"]
    exported = call(store, "GET", "/export", token=token)
    assert exported.status == 200
    assert any(v["place_id"] == "Z" for v in exported.body["visits"])
    gone = call(store, "DELETE", "/account", token=token)
    assert gone.status == 200 and gone.body["deleted"] is True
    assert gone.body["backups_within_days"] == 30
    assert store.users == {}
    assert store.visits == {}
    assert call(store, "GET", "/visits", token=token).status == 401


def test_rls_is_per_owner_in_the_store():
    """Every row is scoped to its owner (doc 4 §12)."""
    store = MemoryStore()
    a = sign_in(store, "a@example.com", visits=[
        {"place_id": "ONLY-A", "visited": True, "marked_at": "2020-01-01T00:00:00Z"},
    ])
    b = sign_in(store, "b@example.com")
    listed = call(store, "GET", "/visits", token=b.body["session"])
    assert listed.body["visits"] == []
    listed_a = call(store, "GET", "/visits", token=a.body["session"])
    assert {v["place_id"] for v in listed_a.body["visits"]} == {"ONLY-A"}
