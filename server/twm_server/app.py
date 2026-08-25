"""HTTP surface for the user service (document 4 §4).

Place files are not served from here. The client reads those as static
assets; this process only touches visits, trips, profile, and identities.
"""
from __future__ import annotations

import json
import os
import sys
import traceback
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen

from .store import AuthError, IdentityTaken, MemoryStore, new_token

API_PREFIXES = ("/api", "")


@dataclass
class Config:
    auth_mode: str = "prod"
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect: str = ""
    app_origin: str = "http://127.0.0.1:5173"
    deletion_backup_days: int = 30

    @classmethod
    def from_env(cls) -> Config:
        return cls(
            auth_mode=os.environ.get("TWM_AUTH_MODE", "prod"),
            google_client_id=os.environ.get("GOOGLE_CLIENT_ID", ""),
            google_client_secret=os.environ.get("GOOGLE_CLIENT_SECRET", ""),
            google_redirect=os.environ.get(
                "GOOGLE_REDIRECT_URI",
                os.environ.get("TWM_GOOGLE_REDIRECT", ""),
            ),
            app_origin=os.environ.get("TWM_APP_ORIGIN", "http://127.0.0.1:5173"),
            deletion_backup_days=int(os.environ.get("TWM_DELETION_BACKUP_DAYS", "30")),
        )


@dataclass
class Response:
    status: int
    body: Any = None
    headers: dict[str, str] | None = None
    redirect: str | None = None


def _strip_prefix(path: str) -> str:
    for p in ("/api",):
        if path == p:
            return "/"
        if path.startswith(p + "/"):
            return path[len(p):]
    return path


def _bearer(header: str | None) -> str | None:
    if not header:
        return None
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return header.strip() or None


def dispatch(
    store: MemoryStore,
    cfg: Config,
    method: str,
    path: str,
    body: dict[str, Any] | None,
    auth: str | None,
    query: dict[str, list[str]] | None = None,
) -> Response:
    path = _strip_prefix(path)
    query = query or {}
    body = body or {}
    method = method.upper()
    uid = store.user_for_session(_bearer(auth))

    try:
        return _route(store, cfg, method, path, body, uid, auth, query)
    except IdentityTaken as e:
        return Response(409, {"error": str(e)})
    except AuthError as e:
        return Response(401, {"error": str(e)})


def _route(
    store: MemoryStore,
    cfg: Config,
    method: str,
    path: str,
    body: dict[str, Any],
    uid: str | None,
    auth: str | None,
    query: dict[str, list[str]],
) -> Response:
    if path in ("/health", "/") and method == "GET":
        return Response(200, {"ok": True, "place_data": False})

    if path == "/auth/config" and method == "GET":
        return Response(200, {
            "magic": True,
            "google": bool(cfg.google_client_id),
            "dev": cfg.auth_mode == "dev",
            "deletion_backup_days": cfg.deletion_backup_days,
        })

    if path == "/auth/magic-link" and method == "POST":
        email = (body.get("email") or "").strip()
        if "@" not in email:
            return Response(400, {"error": "an email address is needed"})
        token = store.create_magic_link(email)
        payload: dict[str, Any] = {"sent": True}
        if cfg.auth_mode == "dev":
            payload["dev_token"] = token
        else:
            print(f"magic-link for {email}: {cfg.app_origin}/?magic={token}", file=sys.stderr)
        return Response(200, payload)

    if path == "/auth/session" and method == "POST":
        token = body.get("token") or (query.get("token") or [None])[0]
        if not token:
            return Response(400, {"error": "missing sign-in token"})
        user_id = store.consume_magic_link(str(token))
        session = store.create_session(user_id)
        merged = store.merge_from_client(
            user_id,
            body.get("visits"),
            body.get("trips"),
            body.get("profile"),
        )
        return Response(200, {
            "session": session,
            "user": store.me(user_id),
            **merged,
            "deletion_backup_days": cfg.deletion_backup_days,
        })

    if path == "/auth/google" and method == "GET":
        if not cfg.google_client_id:
            if cfg.auth_mode == "dev":
                return Response(400, {"error": "use POST /auth/google in dev with email and sub"})
            return Response(501, {"error": "Google sign-in is not configured"})
        state = new_token()
        redirect = cfg.google_redirect or f"{cfg.app_origin.rstrip('/')}/api/auth/google/callback"
        params = urlencode({
            "client_id": cfg.google_client_id,
            "redirect_uri": redirect,
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "access_type": "online",
            "prompt": "select_account",
        })
        return Response(302, redirect=f"https://accounts.google.com/o/oauth2/v2/auth?{params}")

    if path == "/auth/google" and method == "POST":
        if cfg.auth_mode != "dev" and not body.get("id_token"):
            return Response(400, {"error": "Google sign-in needs an id token"})
        sub = body.get("sub") or ""
        email = body.get("email")
        if body.get("id_token") and cfg.google_client_id:
            info = _google_tokeninfo(str(body["id_token"]), cfg.google_client_id)
            sub = info["sub"]
            email = info.get("email")
        elif cfg.auth_mode != "dev":
            return Response(401, {"error": "Google sign-in is not available this way"})
        user_id = store.google_sign_in(str(sub), email, signed_in_user=uid)
        existing = _bearer(auth) if uid else None
        session = existing or store.create_session(user_id)
        merged = store.merge_from_client(
            user_id,
            body.get("visits"),
            body.get("trips"),
            body.get("profile"),
        )
        return Response(200, {
            "session": session,
            "user": store.me(user_id),
            **merged,
            "deletion_backup_days": cfg.deletion_backup_days,
        })

    if path == "/auth/google/callback" and method == "GET":
        code = (query.get("code") or [None])[0]
        if not code or not cfg.google_client_id:
            return Response(400, {"error": "Google callback missing code"})
        info = _google_exchange(str(code), cfg)
        user_id = store.google_sign_in(info["sub"], info.get("email"))
        session = store.create_session(user_id)
        dest = f"{cfg.app_origin.rstrip('/')}/?google=1#twm-session={session}"
        return Response(302, redirect=dest)

    if path == "/auth/logout" and method == "POST":
        token = _bearer(auth)
        if token:
            store.revoke_session(token)
        return Response(200, {"ok": True})

    if path == "/auth/me" and method == "GET":
        if not uid:
            return Response(401, {"error": "not signed in"})
        return Response(200, store.me(uid))

    if not uid and path not in ("/feedback/place",):
        if path.startswith("/visits") or path.startswith("/trips") or path in (
            "/export", "/import", "/account",
        ):
            return Response(401, {"error": "not signed in"})

    if path == "/visits" and method == "GET":
        return Response(200, {"visits": store.list_visits(uid)})  # type: ignore[arg-type]

    if path.startswith("/visits/") and method == "PUT":
        place_id = path[len("/visits/"):]
        if not place_id or "/" in place_id:
            return Response(400, {"error": "missing place_id"})
        row = dict(body)
        row["place_id"] = place_id
        saved = store.put_visit(uid, row)  # type: ignore[arg-type]
        return Response(200, saved)

    if path == "/visits/bulk" and method == "POST":
        n = store.bulk_put(uid, list(body.get("visits") or []))  # type: ignore[arg-type]
        return Response(200, {"written": n, "visits": store.list_visits(uid)})  # type: ignore[arg-type]

    if path == "/trips" and method == "GET":
        return Response(200, {"trips": store.list_trips(uid)})  # type: ignore[arg-type]

    if path == "/trips" and method == "POST":
        saved = store.put_trip(uid, body)  # type: ignore[arg-type]
        return Response(200, saved)

    if path.startswith("/trips/") and method == "PATCH":
        tid = path[len("/trips/"):]
        body = dict(body)
        body["id"] = tid
        saved = store.put_trip(uid, body)  # type: ignore[arg-type]
        return Response(200, saved)

    if path == "/export" and method == "GET":
        return Response(200, store.export(uid))  # type: ignore[arg-type]

    if path == "/import" and method == "POST":
        merged = store.merge_from_client(
            uid,  # type: ignore[arg-type]
            body.get("visits"),
            body.get("trips"),
            body.get("profile"),
        )
        return Response(200, merged)

    if path == "/feedback/place" and method == "POST":
        pid = body.get("place_id")
        note = body.get("note") or ""
        if not pid:
            return Response(400, {"error": "place_id is required"})
        store.add_feedback(uid, str(pid), str(note))
        return Response(204)

    if path == "/account" and method == "DELETE":
        if not uid:
            return Response(401, {"error": "not signed in"})
        store.delete_account(uid)
        token = _bearer(auth)
        if token:
            store.revoke_session(token)
        return Response(200, {
            "deleted": True,
            "backups_within_days": cfg.deletion_backup_days,
        })

    return Response(404, {"error": "not found"})


def _google_tokeninfo(id_token: str, audience: str) -> dict[str, Any]:
    url = "https://oauth2.googleapis.com/tokeninfo?id_token=" + id_token
    with urlopen(url, timeout=10) as resp:
        info = json.loads(resp.read().decode("utf-8"))
    if info.get("aud") != audience:
        raise AuthError("Google token was issued for a different app")
    return info


def _google_exchange(code: str, cfg: Config) -> dict[str, Any]:
    redirect = cfg.google_redirect or f"{cfg.app_origin.rstrip('/')}/api/auth/google/callback"
    data = urlencode({
        "code": code,
        "client_id": cfg.google_client_id,
        "client_secret": cfg.google_client_secret,
        "redirect_uri": redirect,
        "grant_type": "authorization_code",
    }).encode("utf-8")
    req = Request("https://oauth2.googleapis.com/token", data=data, method="POST")
    with urlopen(req, timeout=10) as resp:
        tokens = json.loads(resp.read().decode("utf-8"))
    id_token = tokens.get("id_token")
    if not id_token:
        raise AuthError("Google did not return an identity token")
    return _google_tokeninfo(id_token, cfg.google_client_id)


class Handler(BaseHTTPRequestHandler):
    store: MemoryStore
    cfg: Config
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("twm-server: " + (fmt % args) + "\n")

    def _cors(self) -> None:
        origin = self.headers.get("Origin") or self.cfg.app_origin
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Credentials", "true")

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        self._handle("GET")

    def do_POST(self) -> None:  # noqa: N802
        self._handle("POST")

    def do_PUT(self) -> None:  # noqa: N802
        self._handle("PUT")

    def do_PATCH(self) -> None:  # noqa: N802
        self._handle("PATCH")

    def do_DELETE(self) -> None:  # noqa: N802
        self._handle("DELETE")

    def _handle(self, method: str) -> None:
        parsed = urlparse(self.path)
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        body: dict[str, Any] | None = None
        if raw:
            try:
                body = json.loads(raw.decode("utf-8"))
            except json.JSONDecodeError:
                self._write(Response(400, {"error": "body is not JSON"}))
                return
        try:
            res = dispatch(
                self.store, self.cfg, method, parsed.path, body,
                self.headers.get("Authorization"),
                parse_qs(parsed.query),
            )
        except Exception:
            traceback.print_exc()
            res = Response(500, {"error": "the account service failed"})
        self._write(res)

    def _write(self, res: Response) -> None:
        if res.redirect:
            self.send_response(res.status)
            self._cors()
            self.send_header("Location", res.redirect)
            self.end_headers()
            return
        payload = b"" if res.body is None else json.dumps(res.body).encode("utf-8")
        self.send_response(res.status)
        self._cors()
        for k, v in (res.headers or {}).items():
            self.send_header(k, v)
        if res.body is not None:
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
        self.send_header("Connection", "close")
        self.end_headers()
        if payload and self.command != "HEAD":
            self.wfile.write(payload)
        self.close_connection = True


def serve(host: str = "127.0.0.1", port: int = 8787, store: MemoryStore | None = None, cfg: Config | None = None) -> ThreadingHTTPServer:
    Handler.store = store or MemoryStore()
    Handler.cfg = cfg or Config.from_env()
    httpd = ThreadingHTTPServer((host, port), Handler)
    httpd.allow_reuse_address = True
    return httpd
