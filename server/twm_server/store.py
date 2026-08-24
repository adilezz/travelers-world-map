"""In-memory user store implementing the Postgres schema's contract.

A visit row is never dropped to unmark. Account deletion removes the user
and every row they own. Identities (email, Google) attach to one user.
"""
from __future__ import annotations

import hashlib
import secrets
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from .merge import merge_profile, merge_trips, merge_visits


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def new_token() -> str:
    return secrets.token_urlsafe(32)


def norm_email(email: str) -> str:
    return email.strip().lower()


@dataclass
class MemoryStore:
    magic_minutes: int = 15
    session_days: int = 30
    users: dict[str, dict[str, Any]] = field(default_factory=dict)
    identities: list[dict[str, Any]] = field(default_factory=list)
    sessions: dict[str, dict[str, Any]] = field(default_factory=dict)
    magic: dict[str, dict[str, Any]] = field(default_factory=dict)
    visits: dict[tuple[str, str], dict[str, Any]] = field(default_factory=dict)
    trips: dict[str, dict[str, Any]] = field(default_factory=dict)
    profiles: dict[str, dict[str, Any]] = field(default_factory=dict)
    feedback: list[dict[str, Any]] = field(default_factory=list)
    visit_deletes: int = 0

    def _new_user(self) -> str:
        uid = str(uuid.uuid4())
        self.users[uid] = {"id": uid, "created_at": _iso(_utcnow())}
        return uid

    def _identities_for(self, user_id: str) -> list[dict[str, Any]]:
        return [i for i in self.identities if i["user_id"] == user_id]

    def _user_for_identity(self, provider: str, subject: str) -> str | None:
        for i in self.identities:
            if i["provider"] == provider and i["subject"] == subject:
                return i["user_id"]
        return None

    def _user_for_email(self, email: str) -> str | None:
        want = norm_email(email)
        for i in self.identities:
            if i.get("email") and norm_email(i["email"]) == want:
                return i["user_id"]
        return None

    def _attach(self, user_id: str, provider: str, subject: str, email: str | None) -> None:
        existing = self._user_for_identity(provider, subject)
        if existing == user_id:
            return
        if existing and existing != user_id:
            raise IdentityTaken(f"{provider} identity already attached to another user")
        self.identities.append({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "provider": provider,
            "subject": subject,
            "email": norm_email(email) if email else None,
        })

    def create_magic_link(self, email: str) -> str:
        token = new_token()
        self.magic[hash_token(token)] = {
            "email": norm_email(email),
            "expires_at": _utcnow() + timedelta(minutes=self.magic_minutes),
            "used_at": None,
        }
        return token

    def consume_magic_link(self, token: str) -> str:
        row = self.magic.get(hash_token(token))
        if not row or row["used_at"] is not None:
            raise AuthError("that sign-in link is not valid")
        if _utcnow() > row["expires_at"]:
            raise AuthError("that sign-in link has expired")
        row["used_at"] = _utcnow()
        email = row["email"]
        uid = self._user_for_identity("email", email) or self._user_for_email(email)
        if uid is None:
            uid = self._new_user()
        self._attach(uid, "email", email, email)
        return uid

    def google_sign_in(self, sub: str, email: str | None, signed_in_user: str | None = None) -> str:
        if not sub:
            raise AuthError("Google did not return a stable identifier")
        existing = self._user_for_identity("google", sub)
        if signed_in_user:
            if existing and existing != signed_in_user:
                raise IdentityTaken("that Google account is already attached to another user")
            self._attach(signed_in_user, "google", sub, email)
            if email:
                try:
                    self._attach(signed_in_user, "email", norm_email(email), email)
                except IdentityTaken:
                    pass
            return signed_in_user
        if existing:
            return existing
        if email:
            by_email = self._user_for_email(email)
            if by_email:
                self._attach(by_email, "google", sub, email)
                return by_email
        uid = self._new_user()
        self._attach(uid, "google", sub, email)
        if email:
            try:
                self._attach(uid, "email", norm_email(email), email)
            except IdentityTaken:
                pass
        return uid

    def create_session(self, user_id: str) -> str:
        token = new_token()
        self.sessions[hash_token(token)] = {
            "user_id": user_id,
            "expires_at": _utcnow() + timedelta(days=self.session_days),
        }
        return token

    def user_for_session(self, token: str | None) -> str | None:
        if not token:
            return None
        row = self.sessions.get(hash_token(token))
        if not row:
            return None
        if _utcnow() > row["expires_at"]:
            return None
        if row["user_id"] not in self.users:
            return None
        return row["user_id"]

    def revoke_session(self, token: str) -> None:
        self.sessions.pop(hash_token(token), None)

    def me(self, user_id: str) -> dict[str, Any]:
        ids = self._identities_for(user_id)
        emails = [i["email"] for i in ids if i.get("email")]
        return {
            "id": user_id,
            "email": emails[0] if emails else None,
            "providers": sorted({i["provider"] for i in ids}),
        }

    def list_visits(self, user_id: str) -> list[dict[str, Any]]:
        return [dict(v) for (uid, _), v in self.visits.items() if uid == user_id]

    def put_visit(self, user_id: str, visit: dict[str, Any]) -> dict[str, Any]:
        pid = visit["place_id"]
        key = (user_id, pid)
        existing = self.visits.get(key, {"place_id": pid})
        row = dict(existing)
        row["place_id"] = pid
        row["visited"] = bool(visit.get("visited", row.get("visited", False)))
        row["marked_at"] = visit.get("marked_at") or row.get("marked_at") or _iso(_utcnow())
        if "visited_on" in visit:
            row["visited_on"] = visit["visited_on"]
        if "note" in visit:
            row["note"] = visit["note"]
        self.visits[key] = row
        return dict(row)

    def bulk_put(self, user_id: str, visits: list[dict[str, Any]]) -> int:
        n = 0
        for v in visits:
            if not v.get("place_id"):
                continue
            self.put_visit(user_id, v)
            n += 1
        return n

    def list_trips(self, user_id: str) -> list[dict[str, Any]]:
        return [dict(t) for t in self.trips.values() if t["user_id"] == user_id]

    def put_trip(self, user_id: str, trip: dict[str, Any]) -> dict[str, Any]:
        tid = trip.get("id") or f"trip-{uuid.uuid4().hex[:12]}"
        existing = self.trips.get(tid)
        if existing and existing["user_id"] != user_id:
            raise AuthError("that trip belongs to someone else")
        row = {
            "id": tid,
            "user_id": user_id,
            "title": trip.get("title") or (existing or {}).get("title") or "Untitled trip",
            "start": trip.get("start") or trip.get("start_date"),
            "end": trip.get("end") or trip.get("end_date"),
            "dayCount": int(trip.get("dayCount") or trip.get("day_count") or 1),
            "stops": list(trip.get("stops") or []),
            "updated_at": trip.get("updated_at") or _iso(_utcnow()),
        }
        self.trips[tid] = row
        return {k: v for k, v in row.items() if k != "user_id"}

    def get_profile(self, user_id: str) -> dict[str, Any]:
        return dict(self.profiles.get(user_id) or {})

    def put_profile(self, user_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        cur = dict(self.profiles.get(user_id) or {})
        for k in ("displayName", "display_name", "homeCountry", "home_country", "passport", "theme", "units"):
            if k in patch and patch[k] is not None:
                cur[k] = patch[k]
        self.profiles[user_id] = cur
        return dict(cur)

    def merge_from_client(
        self,
        user_id: str,
        visits: list[dict[str, Any]] | None,
        trips: list[dict[str, Any]] | None,
        profile: dict[str, Any] | None,
    ) -> dict[str, Any]:
        merged_v = merge_visits(self.list_visits(user_id), visits or [])
        self.bulk_put(user_id, merged_v)
        merged_t = merge_trips(self.list_trips(user_id), trips or [])
        for t in merged_t:
            self.put_trip(user_id, t)
        merged_p = merge_profile(self.get_profile(user_id), profile)
        if merged_p:
            self.put_profile(user_id, merged_p)
        return {
            "visits": self.list_visits(user_id),
            "trips": self.list_trips(user_id),
            "profile": self.get_profile(user_id),
        }

    def export(self, user_id: str) -> dict[str, Any]:
        return {
            "format": "travelers-world-map/record",
            "version": 1,
            "exported_at": _iso(_utcnow()),
            "note": (
                "place_id values are stable across database rebuilds and are the "
                "only identifier this file depends on. visited=false rows are "
                "places that were marked and later unmarked; they are kept so that "
                "anything attached to them survives."
            ),
            "visits": self.list_visits(user_id),
            "trips": self.list_trips(user_id),
            "profile": self.get_profile(user_id),
        }

    def delete_account(self, user_id: str) -> None:
        """Removes server rows. The local copy is the client's business."""
        self.visits = {k: v for k, v in self.visits.items() if k[0] != user_id}
        self.trips = {k: v for k, v in self.trips.items() if v["user_id"] != user_id}
        self.profiles.pop(user_id, None)
        self.identities = [i for i in self.identities if i["user_id"] != user_id]
        self.sessions = {k: v for k, v in self.sessions.items() if v["user_id"] != user_id}
        self.users.pop(user_id, None)

    def add_feedback(self, user_id: str | None, place_id: str, note: str) -> None:
        self.feedback.append({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "place_id": place_id,
            "note": note,
            "created_at": _iso(_utcnow()),
        })


class AuthError(Exception):
    pass


class IdentityTaken(AuthError):
    pass
