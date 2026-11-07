"""Sirve la interfaz de CANCHA en el equipo local."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from functools import partial
from urllib.parse import urlsplit
import argparse
import webbrowser


class CanchaHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        path = urlsplit(self.path).path
        if path == "/":
            self.path = "/index.html"
        elif path not in {"/index.html", "/style.css", "/controller.js", "/protocol.js"}:
            self.send_error(404)
            return None
        return super().send_head()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    handler = partial(CanchaHandler, directory=str(Path(__file__).parent))
    try:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), handler)
    except OSError as exc:
        raise SystemExit(f'No se pudo abrir el puerto {args.port}: {exc}')
    url = f'http://localhost:{args.port}/'
    print(f'CANCHA: {url}\nUsa Chrome o Edge. Ctrl+C para cerrar.', flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

if __name__ == '__main__':
    main()
