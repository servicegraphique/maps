#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MAPFINDER — serveur local minimal (aucune dépendance, Python 3.7+).

Pourquoi un serveur et pas un double-clic sur index.html ?
  Ouvert en file://, le navigateur bloque les appels réseau (fetch) vers les API
  externes et certaines ressources pour des raisons de sécurité (CORS / origine).
  Un serveur local sur http://localhost résout ce problème en une commande.

Usage :
    python serve.py [--port 8000] [--host 127.0.0.1] [--no-browser]
"""
import argparse
import contextlib
import http.server
import mimetypes
import os
import socket
import socketserver
import sys
import threading
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("application/json", ".json")


class Handler(http.server.SimpleHTTPRequestHandler):
    """Handler qui sert le dossier du projet et empêche la mise en cache agressive."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, must-revalidate")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, fmt, *args):
        # Journal compact : ne pollue pas la console Windows.
        sys.stdout.write("  %s\n" % (fmt % args))


def free_port(preferred: int, host: str = "127.0.0.1") -> int:
    for port in range(preferred, preferred + 40):
        with contextlib.closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind((host, port))
                return port
            except OSError:
                continue
    raise RuntimeError("Aucun port libre trouvé entre %d et %d" % (preferred, preferred + 39))


def main() -> int:
    parser = argparse.ArgumentParser(description="Serveur local MAPFINDER")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--host", default="127.0.0.1",
                        help="interface d'écoute (127.0.0.1 par défaut, 0.0.0.0 pour le réseau local)")
    args = parser.parse_args()

    port = free_port(args.port, args.host)
    url = "http://localhost:%d/" % port

    print("")
    print("  ╔══════════════════════════════════════════════════════════╗")
    print("  ║   MAPFINDER — recherche et géolocalisation de bâtiments  ║")
    print("  ╚══════════════════════════════════════════════════════════╝")
    print("")
    print("  Application servie depuis : %s" % ROOT)
    print("  Adresse                   : %s" % url)
    print("")
    print("  Les recherches, vues aériennes et photos nécessitent une")
    print("  connexion Internet. Fermez cette fenêtre pour arrêter.")
    print("")

    if not args.no_browser:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer((args.host, port), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n  Serveur arrêté.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
