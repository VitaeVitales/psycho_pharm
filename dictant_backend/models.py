"""Database models for the dictation backend.

This module defines the SQLAlchemy models used by the application. Two
primary models are defined:

* :class:`Settings` stores the current test configuration, including the
  list of drug names, the duration of the test, the password code, the
  session name, the active indication key, and a mapping of indication
  sets. Only a single row of this table is expected to exist at any
  given time; when the configuration is updated via the admin API, the
  existing row is overwritten.

* :class:`Submission` records each submission from a student. It captures
  identifying information about the student, the name of the session under
  which the submission took place, timestamps for the start and end of the
  test, any warnings (stored as JSON), the answers provided (also JSON),
  and whether the submission was sent automatically (due to inactivity or
  time expiry) or manually by the student.
"""

from datetime import datetime  # можно оставить, если где-то пригодится

from .extensions import db  # <-- ключевое: используем общий db

from sqlalchemy import UniqueConstraint


class Settings(db.Model):
    """A single-row table storing the current test settings.

    Fields storing lists or dictionaries are persisted as JSON strings.
    """
    __tablename__ = "settings"

    id = db.Column(db.Integer, primary_key=True)
    # JSON encoded list of drug names (length defined by admin)
    drugs = db.Column(db.Text, nullable=True)
    # Duration of the dictation in minutes
    duration = db.Column(db.Integer, nullable=True)
    # Password code needed to start the test
    code = db.Column(db.String(100), nullable=True)
    # Human-readable name for the session (e.g. "Нейролептики, октябрь 2025")
    session_name = db.Column(db.String(200), nullable=True)
    # Key identifying which indication set is active
    indication_key = db.Column(db.String(100), nullable=True)
    # JSON encoded mapping of keys to lists of indications
    indication_sets = db.Column(db.Text, nullable=True)

    # JSON encoded answer key mapping drug indices to correct values. The
    # structure is a dictionary where each key is a string index ("0".."9")
    # and the value contains the correct answers for that drug (mnn,
    # trade names, forms, indications, doses, half-life and elimination).
    answer_key = db.Column(db.Text, nullable=True)


class Submission(db.Model):
    """Represents a completed or automatically submitted test from a student."""
    __tablename__ = "submissions"

    id = db.Column(db.Integer, primary_key=True)
    # Name of the session at the time of submission
    session_name = db.Column(db.String(200), nullable=True)
    exam_session_id = db.Column(db.Integer, nullable=True, index=True)
    # Student's full name
    student_name = db.Column(db.String(200), nullable=False)
    # Student group or year of study
    group = db.Column(db.String(200), nullable=True)
    # ISO timestamp when the student started the test
    start_time = db.Column(db.DateTime, nullable=True)
    # ISO timestamp when the student finished or was auto-submitted
    end_time = db.Column(db.DateTime, nullable=True)
    # JSON encoded list of warnings (each warning can be a dict with type/time)
    warnings = db.Column(db.Text, nullable=True)
    # JSON encoded dict of answers
    answers = db.Column(db.Text, nullable=True)
    # Whether the submission was automatically sent (True) or manually (False)
    auto_submitted = db.Column(db.Boolean, default=False)

    # Total score achieved by the student for this submission. May be
    # ``None`` if the system has not yet computed a score or if
    # automatic scoring is disabled.
    score = db.Column(db.Float, nullable=True)

    # Optional JSON encoded breakdown of the score for each drug and
    # category. This can be used for detailed reporting. The format is a
    # dictionary keyed by drug index with nested details about how each
    # component of the answer was graded.
    score_details = db.Column(db.Text, nullable=True)


class ActiveSession(db.Model):
    __tablename__ = "active_sessions"

    id = db.Column(db.Integer, primary_key=True)

    # Чёткая привязка к студенту
    student_name = db.Column(db.String(200), nullable=False)
    group = db.Column(db.String(200), nullable=True)

    # Какая учебная сессия
    session_name = db.Column(db.String(200), nullable=False)

    # Когда начал
    start_time = db.Column(db.DateTime, nullable=False)

    # Живая активность — время последнего действия
    last_activity = db.Column(db.DateTime, nullable=False)

    # Текущее состояние (пишет, завис, авто-сохранён, отключился)
    status = db.Column(db.String(50), nullable=False, default="active")

    # Можешь при желании хранить прогресс
    # например процент заполненных полей, если надо

class ExamSession(db.Model):
    __tablename__ = "exam_sessions"

    id = db.Column(db.Integer, primary_key=True)
    session_name = db.Column(db.String(200), nullable=False, unique=True)
    join_code = db.Column(db.String(32), nullable=False, unique=True)

    # На этапе 1 можно оставить nullable, чтобы не зависеть от drugset-логики
    drugset_id = db.Column(db.Integer, nullable=True)

    is_open = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)


class SessionRoster(db.Model):
    __tablename__ = "session_rosters"

    id = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(
        db.Integer,
        db.ForeignKey("exam_sessions.id"),
        nullable=False,
        index=True
    )

    full_name_raw = db.Column(db.String(255), nullable=False)
    full_name_key = db.Column(db.String(255), nullable=False)

    __table_args__ = (
        UniqueConstraint("session_id", "full_name_key", name="uq_roster_session_namekey"),
    )
