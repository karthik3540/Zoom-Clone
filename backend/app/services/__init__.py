"""Meeting business logic, independent of HTTP.

Services take a SQLAlchemy Session, raise app.services.exceptions errors,
and run each write as one transaction (commit on success, roll back on error).
"""
