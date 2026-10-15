"""Bounded, content-free activity counters. All report days use UTC."""
from datetime import datetime, timedelta, timezone
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert
from app.db.analytics import AnalyticsDay, AnalyticsVisitor


def record_activity(db, subject, user_id=None, now=None):
    now = now or datetime.now(timezone.utc)
    # Serialize only this visitor, including their simultaneous tabs/devices.
    db.execute(text('SELECT pg_advisory_xact_lock(hashtext(:key))'), {'key':'analytics:'+subject})
    visitor = db.get(AnalyticsVisitor,subject)
    if visitor and now-visitor.last_seen < timedelta(seconds=30):return
    new_visit = visitor is None or now-visitor.last_seen >= timedelta(minutes=30)
    if visitor is None:db.add(AnalyticsVisitor(subject=subject,user_id=user_id,last_seen=now))
    else:visitor.last_seen=now
    stmt=insert(AnalyticsDay).values(day=now.date(),subject=subject,user_id=user_id,visits=int(new_visit),actions=1)
    db.execute(stmt.on_conflict_do_update(index_elements=['day','subject'],set_={'visits':AnalyticsDay.visits+int(new_visit),'actions':AnalyticsDay.actions+1}))
    db.commit()
