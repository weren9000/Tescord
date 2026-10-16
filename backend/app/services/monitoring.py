import asyncio
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID
import psutil
from sqlalchemy import delete, func, select, text
from sqlalchemy.dialects.postgresql import insert
from app.core.config import get_settings
from app.db.session import SessionLocal
from app.db.analytics import AnalyticsDay, AnalyticsVisitor, ResourceSample, AnalyticsHour
from app.db.models import User
from app.services.site_presence import site_presence_manager
from app.services.voice_signaling import voice_signaling_manager
from app.services.direct_call_signaling import direct_call_signaling_manager

logger=logging.getLogger(__name__)
latest: dict = {}
voice_users: set[str] = set()
FIELDS=['cpu_percent','cpu_count','memory_used','memory_total','swap_used','swap_total','disk_used','disk_total','net_in','net_out','uptime','backend_rss','online','voice']


def host_sample(previous):
    now=time.monotonic();net=psutil.net_io_counters();memory=psutil.virtual_memory();swap=psutil.swap_memory()
    path=Path(get_settings().uploads_dir).resolve()
    disk=psutil.disk_usage(str(path if path.exists() else path.anchor))
    cpu=psutil.cpu_times()
    total=sum(cpu)-getattr(cpu,'guest',0)-getattr(cpu,'guest_nice',0)
    idle=cpu.idle+getattr(cpu,'iowait',0)
    cpu_percent=None
    if previous and total>previous[3]:cpu_percent=max(0,min(100,100*(1-(idle-previous[4])/(total-previous[3]))))
    values=dict(cpu_percent=cpu_percent,cpu_count=psutil.cpu_count(),memory_used=memory.total-memory.available,memory_total=memory.total,swap_used=swap.used,swap_total=swap.total,disk_used=disk.used,disk_total=disk.total,uptime=time.time()-psutil.boot_time(),backend_rss=psutil.Process().memory_info().rss,net_in=None,net_out=None)
    if previous:
        elapsed=max(.1,now-previous[0]);values.update(net_in=max(0,net.bytes_recv-previous[1])/elapsed,net_out=max(0,net.bytes_sent-previous[2])/elapsed)
    return values,(now,net.bytes_recv,net.bytes_sent,total,idle)


def persist_sample(at,data,voices,old_voices,elapsed,cleanup=False,resource_at=None):
    with SessionLocal() as db:
        # The application and collector run in one production worker.
        if not db.scalar(text('SELECT pg_try_advisory_xact_lock(743190037)')):return
        known={str(u) for u in db.scalars(select(User.id).where(User.id.in_([UUID(u) for u in voices])))} if voices else set()
        for uid in known:
            same=old_voices.get(uid)==voices[uid]
            seconds=int(min(30,elapsed)) if same else 0
            stmt=insert(AnalyticsDay).values(day=at.date(),subject='u:'+uid,user_id=UUID(uid),voice_seconds=seconds,voice_sessions=int(not same))
            db.execute(stmt.on_conflict_do_update(index_elements=['day','subject'],set_={'voice_seconds':AnalyticsDay.voice_seconds+seconds,'voice_sessions':AnalyticsDay.voice_sessions+int(not same)}))
        if data is not None:
            stamp=(resource_at or at).replace(second=0,microsecond=0)
            db.execute(insert(ResourceSample).values(at=stamp,data=data).on_conflict_do_nothing(index_elements=['at']))
        if cleanup:
            db.execute(delete(AnalyticsVisitor).where(AnalyticsVisitor.last_seen<at-timedelta(days=2)))
            db.execute(delete(AnalyticsHour).where(AnalyticsHour.hour<at-timedelta(days=90)))
            db.execute(delete(AnalyticsDay).where(AnalyticsDay.day<(at-timedelta(days=365)).date()))
            db.execute(delete(ResourceSample).where(ResourceSample.at<at-timedelta(days=90)))
            cutoff=(at-timedelta(days=7)).replace(minute=0,second=0,microsecond=0)
            old=db.execute(select(func.date_trunc('hour',ResourceSample.at).label('bucket'),*[func.avg(ResourceSample.data[k].as_float()).label(k) for k in FIELDS]).where(ResourceSample.at<cutoff).group_by('bucket')).mappings().all()
            if old:
                db.execute(delete(ResourceSample).where(ResourceSample.at<cutoff))
                for row in old:db.add(ResourceSample(at=row['bucket'],data={k:row[k] for k in FIELDS}))
        db.commit()


async def service_status():
    from app.services.voice_sfu import _client
    from livekit import api
    result={'api':'online','database':'unknown','redis':'disabled','livekit':'disabled'}
    try:
        def ping_db():
            with SessionLocal() as db:db.execute(text('SELECT 1'))
        await asyncio.to_thread(ping_db);result['database']='online'
    except Exception:result['database']='offline'
    settings=get_settings()
    if settings.redis_url:
        try:
            from redis.asyncio import Redis
            client=Redis.from_url(settings.redis_url,socket_timeout=2,socket_connect_timeout=2)
            try:await client.ping();result['redis']='online'
            finally:await client.aclose()
        except Exception:result['redis']='offline'
    if settings.livekit_enabled:
        try:
            async with _client() as client:await client.room.list_rooms(api.ListRoomsRequest())
            result['livekit']='online'
        except Exception:result['livekit']='offline'
    return result


async def collect_metrics():
    global latest,voice_users
    previous=None;old_voices={};last=time.monotonic();last_minute=None;last_hour=None;buffer=[]
    while True:
        try:
            started=time.monotonic();now=datetime.now(timezone.utc)
            values,previous=await asyncio.to_thread(host_sample,previous)
            rooms=await voice_signaling_manager.snapshot_rooms()
            voices={p['user_id']:'room:'+room for room,people in rooms.items() for p in people}
            voices.update({u:'call:'+c for u,c in (await direct_call_signaling_manager.analytics_participants()).items()})
            voice_users=set(voices)
            values.update(online=len(site_presence_manager.snapshot_user_ids()),voice=len(voice_users))
            status=await service_status()
            latest={**values,'at':now.isoformat(),'services':status,'active_rooms':len(set(voices.values()))}
            minute=now.replace(second=0,microsecond=0);hour=now.replace(minute=0,second=0,microsecond=0)
            aggregate=None;resource_at=last_minute
            if last_minute is not None and minute!=last_minute and buffer:
                aggregate={k:sum(v[k] for v in buffer if v.get(k) is not None)/len([v for v in buffer if v.get(k) is not None]) if any(v.get(k) is not None for v in buffer) else None for k in FIELDS}
                buffer=[]
            last_minute=minute;buffer.append(values)
            await asyncio.to_thread(persist_sample,now,aggregate,voices,old_voices,started-last,hour!=last_hour,resource_at)
            old_voices=voices;last=started;last_hour=hour
        except asyncio.CancelledError:raise
        except Exception:logger.exception('Monitoring sample failed')
        await asyncio.sleep(15)
