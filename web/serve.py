"""Local dev server for the MI-CHIPS web app.

Serves this folder at http://localhost:5173 with caching disabled, so edits show up on reload.
Usage:  python3 web/serve.py   (or from inside web/: python3 serve.py)

WebXR needs a secure context: localhost works on this machine; a headset or phone needs HTTPS
(see README: GitHub Pages, or a tunnel such as `npx localtunnel`).
"""
import functools
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
ROOT = os.path.dirname(os.path.abspath(__file__))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".csv": "text/csv"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    handler = functools.partial(NoCacheHandler, directory=ROOT)
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as httpd:
        print(f"MI-CHIPS web app on http://localhost:{PORT}")
        httpd.serve_forever()
