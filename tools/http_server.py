#!/usr/bin/env python
# Many tests expect there to be an http server on port 4545 servering the deno
# root directory.
import os
from threading import Thread
import signal
import sys
import SimpleHTTPServer
import SocketServer
from util import root_path
from time import sleep
import BaseHTTPServer, SimpleHTTPServer
import ssl

PORT = 4545
PORT_HTTPS = 4555
THREADS = []


def serve_forever():
    os.chdir(root_path)  # Hopefully the main thread doesn't also chdir.
    Handler = SimpleHTTPServer.SimpleHTTPRequestHandler
    SocketServer.TCPServer.allow_reuse_address = True
    httpd = SocketServer.TCPServer(("", PORT), Handler)
    print "Deno test server http://localhost:%d/" % PORT
    httpd.serve_forever()


def serve_https_forever():
    os.chdir(root_path)  # Hopefully the main thread doesn't also chdir.

    httpd = BaseHTTPServer.HTTPServer(
        ("", PORT_HTTPS), SimpleHTTPServer.SimpleHTTPRequestHandler)
    httpd.socket = ssl.wrap_socket(
        httpd.socket, certfile='./tools/expired_cert.pem', server_side=True)
    print "Deno test server https://localhost:%d/" % PORT_HTTPS
    httpd.serve_forever()


def spawn():
    global THREADS
    t1 = Thread(target=serve_forever)
    t1.daemon = True
    t1.start()
    THREADS.append(t1)
    t2 = Thread(target=serve_https_forever)
    t2.daemon = True
    t2.start()
    THREADS.append(t2)
    sleep(1)  # TODO I'm too lazy to figure out how to do this properly.


def handler(signal, frame):
    global THREADS
    for t in THREADS:
        t.alive = False
    sys.exit(42)


if __name__ == '__main__':
    signal.signal(signal.SIGINT, handler)
    spawn()
    # Python sucks.
    while True:
        signal.pause()
