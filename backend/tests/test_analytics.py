from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4
from sqlalchemy import delete, select
from app.db.session import SessionLocal
from app.db.models import User
from app.db.analytics import AnalyticsDay, AnalyticsVisitor, ResourceSample, AnalyticsHour
from app.services.analytics import record_activity
from app.services.monitoring import host_sample, persist_sample
from test_inventory import accounts


def test_permissions_periods_and_self_exclusion(accounts):
    client,people=accounts
    admin,profile,_=people[0]
    ordinary,user,_=people[1]
    url='/api/admin/statistics'
    assert client.get(url).status_code==401
    assert client.get(url,headers=admin).status_code==403
    assert client.get(url,headers=ordinary).status_code==403
    with SessionLocal() as db:
        db.get(User,UUID(profile['id'])).is_admin=True
        db.commit()
    for headers in [admin,ordinary]:
        for _ in range(3):
            assert client.post('/api/analytics/activity',headers=headers).status_code==204
    for days in [1,7,30]:
        response=client.get(url,headers=admin,params={'days':days})
        assert response.status_code==200,response.text
        assert response.headers['cache-control']=='no-store'
        assert len(response.json()['daily'])==days
    assert client.get(url,headers=admin,params={'days':2}).status_code==422
    full=client.get(url,headers=admin).json()
    filtered=client.get(url,headers=admin,params={'exclude_self':'true'}).json()
    assert full['totals']['active']-filtered['totals']['active']==1
    assert full['totals']['visits']-filtered['totals']['visits']==1
    assert 'email' not in str(full) and 'password' not in str(full)


def test_session_deduplication_and_inactivity(accounts):
    _,people=accounts
    uid=UUID(people[1][1]['id']);subject='u:'+str(uid)
    now=datetime.now(timezone.utc).replace(hour=1,minute=0,second=0,microsecond=0)
    with SessionLocal() as db:
        for offset in [0,0,10,60,120,1921]:
            record_activity(db,subject,uid,now+timedelta(seconds=offset))
        row=db.get(AnalyticsDay,(now.date(),subject))
        assert row.visits==2 and row.actions==4
        hour=db.get(AnalyticsHour,(now,subject))
        assert hour.visits==2 and hour.actions==4


def test_guest_bot_filter_and_browser_dedup(accounts):
    client,_=accounts
    browser=str(uuid4())
    from app.core.config import get_settings
    import hmac,hashlib
    subject='g:'+hmac.new(get_settings().secret_key.encode(),browser.encode(),hashlib.sha256).hexdigest()
    try:
        assert client.post('/api/analytics/visit',json={'browser_id':browser},headers={'User-Agent':'Googlebot'}).status_code==204
        with SessionLocal() as db:assert db.get(AnalyticsVisitor,subject) is None
        for _ in range(3):
            assert client.post('/api/analytics/visit',json={'browser_id':browser}).status_code==204
        with SessionLocal() as db:
            rows=list(db.scalars(select(AnalyticsDay).where(AnalyticsDay.subject==subject)))
            assert len(rows)==1 and rows[0].visits==1 and rows[0].user_id is None
    finally:
        with SessionLocal() as db:
            db.execute(delete(AnalyticsDay).where(AnalyticsDay.subject==subject))
            db.execute(delete(AnalyticsHour).where(AnalyticsHour.subject==subject))
            db.execute(delete(AnalyticsVisitor).where(AnalyticsVisitor.subject==subject));db.commit()


def test_resource_sampling_and_voice_estimates(accounts):
    _,people=accounts
    first,previous=host_sample(None);second,_=host_sample(previous)
    assert first['cpu_percent'] is None
    assert second['memory_total']>0 and second['disk_total']>0
    assert second['net_in']>=0
    # Back-to-back reads can precede the next kernel CPU accounting tick.
    assert second['cpu_percent'] is None or 0<=second['cpu_percent']<=100
    uid=people[1][1]['id'];voices={uid:'room:test'}
    now=datetime.now(timezone.utc)
    persist_sample(now,None,voices,{},15)
    persist_sample(now,None,voices,voices,15)
    with SessionLocal() as db:
        row=db.get(AnalyticsDay,(now.date(),'u:'+uid))
        assert row.voice_sessions==1 and row.voice_seconds==15


def test_custom_range_and_missing_hourly_history(accounts):
    client,people=accounts
    headers,user,_=people[0]
    with SessionLocal() as db:
        db.get(User,UUID(user['id'])).is_admin=True;db.commit()
    today=datetime.now(timezone.utc).date()
    start=datetime(2000,1,1,tzinfo=timezone.utc).date()
    response=client.get('/api/admin/statistics',headers=headers,params={'start_date':str(start),'end_date':str(start)})
    assert response.status_code==200,response.text
    data=response.json()
    assert len(data['daily'])==1 and data['daily'][0]['day']==str(start)
    assert data['visit_interval']=='hour' and len(data['visits_history'])==24
    assert data['activity_available'] is False
    assert all(row['visits'] is None for row in data['visits_history'])
    assert all(start.isoformat() in row['at'] for row in data['visits_history'])
    for params in [{'start_date':str(start)}, {'start_date':str(today),'end_date':str(start)},
                   {'start_date':str(start),'end_date':str(today+timedelta(days=1))},
                   {'start_date':str(today-timedelta(days=90)),'end_date':str(today)}]:
        assert client.get('/api/admin/statistics',headers=headers,params=params).status_code==422
