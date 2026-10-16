"""Serve the built frontend locally with the same public SPA routes as nginx."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

root = Path(__file__).resolve().parents[1] / 'frontend/dist/frontend/browser'
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(root), **kwargs)
    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/login' or path.startswith(('/invite/', '/channels/')):
            self.path = '/index.html'
        super().do_GET()

if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', 4200), Handler).serve_forever()
