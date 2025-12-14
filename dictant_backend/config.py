import os


class Config:
    """Base configuration for the backend application.

    This configuration uses an environment variable to allow overriding the
    database URL in different environments (e.g. development vs production).
    By default, it stores data in a SQLite database called ``dictant.db`` in
    the working directory. Tracking modifications is disabled to avoid
    unnecessary overhead.
    """
    SECRET_KEY = os.environ.get('SECRET_KEY', 'please-change-me')
    # Use the environment variable DATABASE_URL if provided; otherwise fall back
    # to a local SQLite database file. SQLite is sufficient for small-scale
    # deployments and testing. For production, point this at a PostgreSQL
    # database or other relational database supported by SQLAlchemy.
    SQLALCHEMY_DATABASE_URI = os.environ.get(
        'DATABASE_URL',
        'sqlite:///dictant.db'
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False

