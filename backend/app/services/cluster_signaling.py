"""Redis-backed signaling managers; sockets themselves never leave their worker."""
import asyncio
from time import time
from uuid import uuid4
from starlette.websockets import WebSocketState
from app.services import cluster as c


class ClusterVoiceSignalingManager:
    async def connect(self, websocket, channel_id, *, user_id, public_id, nick,
                      avatar_updated_at=None, owner_muted=False):
        from app.services.voice_signaling import VoiceAdmissionError, VoiceParticipant
        from app.core.config import get_settings
        participant = VoiceParticipant(uuid4().hex, user_id, public_id, nick,
                                       avatar_updated_at, owner_muted=owner_muted)
        if websocket.application_state != WebSocketState.CONNECTED:
            await websocket.accept()
        c.local_sockets[participant.id] = websocket
        def change(state, events):
            room = state['rooms'].setdefault(channel_id, {})
            if any(p['participant']['user_id'] == user_id for p in room.values()):
                raise VoiceAdmissionError(4409, 'Already connected')
            if len(room) >= get_settings().voice_room_capacity:
                raise VoiceAdmissionError(4429, 'Voice room full')
            existing = [p['participant'] for p in room.values()]
            c.send(events, room, {'type': 'peer_joined', 'participant': participant.to_payload()})
            room[participant.id] = {'worker': c.WORKER, 'participant': participant.to_payload()}
            c.send(events, [participant.id], {'type': 'room_state', 'self_id': participant.id,
                   'self_participant': participant.to_payload(), 'participants': existing})
        try:
            await c.mutate(change)
        except BaseException:
            c.local_sockets.pop(participant.id, None)
            raise
        return participant

    async def disconnect(self, channel_id, participant_id, *, close_socket=False,
                         code=4003, reason='Voice access revoked'):
        def change(state, events):
            room = state['rooms'].get(channel_id, {})
            if room.pop(participant_id, None) is None:
                return
            if close_socket:
                c.send(events, [participant_id], close={'code': code, 'reason': reason})
            c.send(events, room, {'type': 'peer_left', 'participant_id': participant_id})
            if not room:
                state['rooms'].pop(channel_id, None)
        try:
            await c.mutate(change)
        finally:
            if not close_socket:
                c.local_sockets.pop(participant_id, None)

    async def relay(self, channel_id, *, source_id, target_id, message_type, payload):
        def change(state, events):
            room = state['rooms'].get(channel_id, {})
            if source_id not in room or target_id not in room:
                return False
            c.send(events, [target_id], {'type': message_type, 'from_id': source_id, 'payload': payload})
            return True
        return await c.mutate(change)

    async def update_mute_state(self, channel_id, participant_id, muted):
        def change(state, events):
            room = state['rooms'].get(channel_id, {})
            if participant_id in room:
                room[participant_id]['participant']['muted'] = muted
                c.send(events, [p for p in room if p != participant_id],
                       {'type': 'mute_state', 'participant_id': participant_id, 'muted': muted})
        await c.mutate(change)

    async def update_owner_mute_state(self, channel_id, user_id, owner_muted):
        def change(state, events):
            room = state['rooms'].get(channel_id, {})
            for pid, p in room.items():
                if p['participant']['user_id'] == user_id:
                    p['participant']['owner_muted'] = owner_muted
                    c.send(events, room, {'type': 'owner_mute_state', 'participant_id': pid,
                                         'owner_muted': owner_muted})
        await c.mutate(change)

    async def snapshot_rooms(self, channel_ids=None):
        state = await asyncio.to_thread(c.read_state)
        return {cid: [p['participant'] for p in room.values()]
                for cid, room in state['rooms'].items() if room and (channel_ids is None or cid in channel_ids)}

    async def disconnect_user_sessions(self, channel_id, user_id):
        await self._remove(channel_id, user_id=user_id, code=4003, reason='Voice access revoked')

    async def disconnect_channel_sessions(self, channel_id, *, code=1012, reason='Voice channel removed'):
        await self._remove(channel_id, code=code, reason=reason)

    async def _remove(self, channel_id, *, user_id=None, code, reason):
        def change(state, events):
            room = state['rooms'].get(channel_id, {})
            removed = [pid for pid, p in room.items() if user_id is None or p['participant']['user_id'] == user_id]
            c.send(events, removed, close={'code': code, 'reason': reason})
            for pid in removed:
                del room[pid]
                c.send(events, room, {'type': 'peer_left', 'participant_id': pid})
            if not room:
                state['rooms'].pop(channel_id, None)
        await c.mutate(change)


def user_call(state, uid):
    return next((call for call in state['calls'].values()
                 if uid in (call['caller_user_id'], call['callee_user_id'])), None)


def accepted(call, uid):
    other = call['callee_user_id'] if uid == call['caller_user_id'] else call['caller_user_id']
    return {'type': 'call_accepted', 'call_id': call['id'], 'transport': 'sfu', 'peer': call['peers'][other]}


class ClusterDirectCallSignalingManager:
    async def analytics_participants(self):
        state = await asyncio.to_thread(c.read_state)
        return {uid: call['id'] for call in state['calls'].values() if call['status'] == 'active'
                for uid in (call['caller_user_id'], call['callee_user_id'])}

    def media_allowed(self, call_id, user_id, client_id):
        call = c.read_state()['calls'].get(call_id)
        return bool(call and call['status'] == 'active' and call['owners'].get(user_id) == client_id)

    async def connect(self, websocket, *, user_id, nick, avatar_updated_at=None, client_id=''):
        if websocket.application_state != WebSocketState.CONNECTED:
            await websocket.accept()
        cid = uuid4().hex
        client_id = client_id or cid
        peer = {'user_id': user_id, 'nick': nick, 'avatar_updated_at': avatar_updated_at.isoformat() if avatar_updated_at else None}
        c.local_sockets[cid] = websocket
        def change(state, events):
            state['connections'][cid] = dict(worker=c.WORKER, user_id=user_id, client_id=client_id, peer=peer)
            call = user_call(state, user_id)
            restored = None
            if call and call['owners'].get(user_id) == client_id:
                call['missing'].pop(user_id, None)
                restored = accepted(call, user_id)
                if call['status'] == 'ringing':
                    restored['type'] = 'call_ringing'
            elif call and call['status'] == 'ringing' and call['callee_user_id'] == user_id:
                restored = {'type': 'incoming_call', 'call_id': call['id'], 'peer': call['peers'][call['caller_user_id']]}
            c.send(events, [cid], {'type': 'ready', 'user_id': user_id, 'call_id': call['id'] if restored else None})
            if restored:
                c.send(events, [cid], restored)
        try:
            await c.mutate(change)
        except BaseException:
            c.local_sockets.pop(cid, None)
            raise
        return cid

    async def disconnect(self, user_id, connection_id, websocket):
        if c.local_sockets.get(connection_id) is not websocket:
            return
        c.local_sockets.pop(connection_id, None)
        def change(state, events):
            conn = state['connections'].pop(connection_id, None)
            call = user_call(state, user_id)
            if conn and call and call['owners'].get(user_id) == conn['client_id']:
                if not c.user_connections(state, user_id, conn['client_id']):
                    call['missing'].setdefault(user_id, time() + 20)
        await c.mutate(change)

    async def request_call(self, caller_user_id, target_user_id, connection_id):
        call_id = uuid4().hex
        def change(state, events):
            caller = state['connections'].get(connection_id)
            targets = c.user_connections(state, target_user_id)
            if not caller or caller['user_id'] != caller_user_id:
                return False
            error = None
            if caller_user_id == target_user_id:
                error = 'Нельзя позвонить самому себе'
            elif not targets:
                error = 'Пользователь сейчас недоступен для личного звонка'
            elif user_call(state, caller_user_id) or user_call(state, target_user_id):
                error = 'У одного из участников уже есть активный звонок'
            if error:
                c.send(events, [connection_id], {'type': 'call_rejected', 'call_id': None, 'detail': error})
                return False
            target = state['connections'][targets[0]]
            state['calls'][call_id] = dict(id=call_id, caller_user_id=caller_user_id, callee_user_id=target_user_id,
                status='ringing', owners={caller_user_id: caller['client_id']},
                peers={caller_user_id: caller['peer'], target_user_id: target['peer']}, expires_at=time() + 45, missing={})
            c.send(events, c.user_connections(state, caller_user_id, caller['client_id']),
                   {'type': 'call_ringing', 'call_id': call_id, 'peer': target['peer']})
            c.send(events, targets, {'type': 'incoming_call', 'call_id': call_id, 'peer': caller['peer']})
            return True
        return await c.mutate(change)

    async def respond_to_call(self, user_id, call_id, *, accept, connection_id):
        def change(state, events):
            call = state['calls'].get(call_id)
            conn = state['connections'].get(connection_id)
            if not call or call['callee_user_id'] != user_id or call['status'] != 'ringing' or not conn or conn['user_id'] != user_id:
                return False
            if not accept:
                c.end_call(state, events, call, 'Звонок отклонён')
                return True
            call['status'] = 'active'
            call['owners'][user_id] = conn['client_id']
            for uid, device in call['owners'].items():
                c.send(events, c.user_connections(state, uid, device), accepted(call, uid))
            c.send(events, c.user_connections(state, user_id, exclude_client_id=conn['client_id']),
                   {'type': 'call_ended', 'call_id': call_id, 'detail': 'Ответили на другом устройстве'})
            return True
        return await c.mutate(change)

    async def hangup(self, user_id, call_id, *, detail='Звонок завершён', client_id=None):
        def change(state, events):
            call = state['calls'].get(call_id)
            if not call or user_id not in (call['caller_user_id'], call['callee_user_id']):
                return False
            if client_id and call['owners'].get(user_id) != client_id:
                return False
            c.end_call(state, events, call, detail)
            return True
        ended = await c.mutate(change)
        if ended:
            from app.services.direct_call_sfu import delete_call_room
            await delete_call_room(call_id)
        return ended
