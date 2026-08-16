import os
import sys

# Ensure root directory is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app import app


class VercelPathFix:
    def __init__(self, wsgi_app):
        self.wsgi_app = wsgi_app

    def __call__(self, environ, start_response):
        matched = environ.get("HTTP_X_MATCHED_PATH") or environ.get("HTTP_X_NOW_ROUTE")
        if matched and not matched.startswith("/api/index"):
            environ["PATH_INFO"] = matched.split("?")[0]
        else:
            path = environ.get("PATH_INFO", "")
            if path.startswith("/api/index") or path in ("/api", "/api/"):
                environ["PATH_INFO"] = "/"
        return self.wsgi_app(environ, start_response)


app.wsgi_app = VercelPathFix(app.wsgi_app)

if __name__ == "__main__":
    app.run()
