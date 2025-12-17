from flask import Flask, send_from_directory
from .config import Config
from .extensions import db, socketio, cors


def create_app():
    app = Flask(__name__, static_folder="static", static_url_path="")
    app.config.from_object(Config)

    cors(app)
    db.init_app(app)
    socketio.init_app(app)

    with app.app_context():
        from . import models  # важно: зарегистрировать ВСЕ модели перед create_all()
        db.create_all()

    # Register Blueprints
    from .admin import admin_bp
    from .student import student_bp

    # IMPORTANT: exports is its own blueprint (admin_exports_bp) -> must be registered too
    from .admin.routes_exports import admin_exports_bp

    app.register_blueprint(admin_bp)
    app.register_blueprint(admin_exports_bp)
    app.register_blueprint(student_bp)

    @app.route("/")
    def index():
        return send_from_directory(app.static_folder, "index.html")

    return app


