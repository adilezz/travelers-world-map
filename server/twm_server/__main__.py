"""Run the user service: python -m twm_server"""
from __future__ import annotations

import os

from .app import Config, serve
from .store import MemoryStore


def main() -> None:
    host = os.environ.get("TWM_HOST", "127.0.0.1")
    port = int(os.environ.get("TWM_PORT", "8787"))
    cfg = Config.from_env()
    httpd = serve(host, port, MemoryStore(), cfg)
    print(f"twm user service on http://{host}:{port}  auth_mode={cfg.auth_mode}", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
