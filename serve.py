import http.server
import os

os.chdir('frontend')
http.server.HTTPServer(('localhost', 8000), http.server.SimpleHTTPRequestHandler).serve_forever()