from datetime import datetime, timedelta, timezone
import hashlib
import hmac
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel
from sqlalchemy import Date, cast, func, select
from sqlalchemy.orm import Session
from app.api.dependencies.auth import get_current_user
from app.api.routes.admin_directory import require_admin
from app.core.config import get_settings
from app.db.analytics import AnalyticsDay, AnalyticsSetting, ResourceSample
from app.db.models import Channel, Message, Server, ServerKind, User
from app.db.session import get_db
from app.services.analytics import record_activity
from app.services import monitoring
from app.services.rate_limits import enforce_limit
from app.services.site_presence import site_presence_manager

router=APIRouter(tags=['analytics'])


class Visit(BaseModel):
    browser_id: UUID


@router.post('/analytics/visit',status_code=204)
def guest_visit(body:Visit,request:Request,db:Session=Depends(get_db)):
    enforce_limit('guest-analytics',request.client.host if request.client else 'unknown',60,3600)
    if any(bot in request.headers.get('user-agent','').lower() for bot in ['bot','crawler','spider']):return
    subject='g:'+hmac.new(get_settings().secret_key.encode(),str(body.browser_id).encode(),hashlib.sha256).hexdigest()
    record_activity(db,subject)


@router.post('/analytics/activity',status_code=204)
def activity(user:User=Depends(get_current_user),db:Session=Depends(get_db)):
    record_activity(db,'u:'+str(user.id),user.id)


@router.get('/admin/statistics')
def statistics(response:Response,days:int=Query(1),exclude_self:bool=False,actor:User=Depends(require_admin),db:Session=Depends(get_db)):
    if days not in (1,7,30):raise HTTPException(422,'Unsupported period')
    response.headers['Cache-Control']='no-store'
    now=datetime.now(timezone.utc);today=now.date();start=today-timedelta(days=days-1)
    start_at=datetime.combine(start,datetime.min.time(),tzinfo=timezone.utc)
    tracked=db.get(AnalyticsSetting,'started_at')
    rows={}
    for i in range(days):
        day=start+timedelta(days=i);rows[day]=dict(day=day.isoformat(),active=0,visits=0,guest_visits=0,messages=0,registrations=0,voice_seconds=0,voice_sessions=0)
    terms=[AnalyticsDay.day>=start,AnalyticsDay.day<=today]
    if exclude_self:terms.append((AnalyticsDay.user_id!=actor.id)|(AnalyticsDay.user_id.is_(None)))
    aggregates=db.execute(select(AnalyticsDay.day,func.count().filter((AnalyticsDay.user_id.is_not(None))&(AnalyticsDay.actions>0)).label('active'),func.coalesce(func.sum(AnalyticsDay.visits).filter(AnalyticsDay.user_id.is_not(None)),0).label('visits'),func.coalesce(func.sum(AnalyticsDay.visits).filter(AnalyticsDay.user_id.is_(None)),0).label('guest_visits'),func.sum(AnalyticsDay.voice_seconds).label('voice_seconds'),func.sum(AnalyticsDay.voice_sessions).label('voice_sessions')).where(*terms).group_by(AnalyticsDay.day)).mappings()
    for row in aggregates:
        rows[row['day']].update({k:row[k] for k in ['active','visits','guest_visits','voice_seconds','voice_sessions']})
    for model,field,user_column in [(Message,'messages',Message.author_id),(User,'registrations',User.id)]:
        day=cast(func.timezone('UTC',model.created_at),Date)
        query=select(day.label('day'),func.count().label('n')).where(model.created_at>=start_at)
        if exclude_self:query=query.where(user_column!=actor.id)
        for row in db.execute(query.group_by(day)).mappings():
            if row['day'] in rows:rows[row['day']][field]=row['n']
    active=db.scalar(select(func.count(func.distinct(AnalyticsDay.user_id))).where(*terms,AnalyticsDay.actions>0))
    totals={key:sum(row[key] for row in rows.values()) for key in ['visits','guest_visits','messages','registrations','voice_seconds','voice_sessions']}
    totals['active']=active
    online=site_presence_manager.snapshot_user_ids();voice=set(monitoring.voice_users)
    if exclude_self:online.discard(actor.id);voice.discard(str(actor.id))
    totals.update(online=len(online),voice=len(voice))
    top=select(Server.id,Server.name,Server.kind,func.count(Message.id).label('messages')).join(Channel,Channel.server_id==Server.id).join(Message,Message.channel_id==Channel.id).where(Server.kind.in_([ServerKind.GROUP_CHAT,ServerKind.WORKSPACE]),Message.created_at>=start_at)
    if exclude_self:top=top.where(Message.author_id!=actor.id)
    top_rows=db.execute(top.group_by(Server.id).order_by(func.count(Message.id).desc(),Server.id).limit(10)).mappings()
    bucket=func.date_trunc('minute' if days==1 else 'hour',ResourceSample.at)
    metrics=['cpu_percent','memory_used','memory_total','disk_used','disk_total','net_in','net_out']
    resource_rows=db.execute(select(bucket.label('at'),*[func.avg(ResourceSample.data[k].as_float()).label(k) for k in metrics]).where(ResourceSample.at>=start_at).group_by(bucket).order_by(bucket)).mappings().all()
    return dict(started_at=tracked.value if tracked else None,timezone='UTC',days=days,totals=totals,daily=list(rows.values()),top=[dict(r) for r in top_rows],resources=monitoring.latest or None,resource_history=[dict(r) for r in resource_rows],voice_estimated=True)
