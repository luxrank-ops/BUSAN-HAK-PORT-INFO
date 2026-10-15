#!/usr/bin/env python3
"""미리보기 정적 서버 — / 는 preview.html 로 리다이렉트."""
import http.server
import os
import socketserver

ROOT = os.path.dirname(os.path.abspath(__file__))  # docs/ui-structure
REPO = os.path.dirname(os.path.dirname(ROOT))       # 저장소 루트
PORT = int(os.environ.get("PORT", "4173"))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=REPO, **kwargs)

    def do_GET(self):
        if self.path in ("/", ""):
            self.send_response(302)
            self.send_header("Location", "/docs/ui-structure/preview.html")
            self.end_headers()
            return
        super().do_GET()


if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("0.0.0.0", PORT), Handler) as httpd:
        print(f"preview server on :{PORT} -> /docs/ui-structure/preview.html")
        httpd.serve_forever()
