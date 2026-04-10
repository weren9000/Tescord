from __future__ import annotations

from contextlib import contextmanager
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from sqlalchemy import select

from app.db.models import Server, User
from app.db.session import SessionLocal
from app.main import app
from app.services.site_presence import site_presence_manager

TEST_PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n"
    b"\x00\x00\x00\rIHDR"
    b"\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
    b"\x00\x00\x00\rIDATx\x9cc`\x00\x01\x00\x00\x05\x00\x01"
    b"\r\n-\xb4"
    b"\x00\x00\x00\x00IEND\xaeB`\x82"
)


@pytest.fixture(autouse=True)
def reset_site_presence_state() -> None:
    with site_presence_manager._lock:
        site_presence_manager._last_seen.clear()

    yield

    with site_presence_manager._lock:
        site_presence_manager._last_seen.clear()


def login_admin_user(client: TestClient) -> str:
    response = client.post(
        "/api/auth/login",
        json={
            "email": "weren9000@kva-chat.local",
            "password": "Vfrfhjys9000",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["token_type"] == "bearer"
    assert payload["user"]["is_admin"] is True
    return payload["access_token"]


def register_regular_user(client: TestClient) -> tuple[str, dict[str, str]]:
    suffix = uuid4().hex[:8]
    payload = {
        "email": f"player_{suffix}@example.test",
        "password": "testpass123",
        "password_confirmation": "testpass123",
        "nick": f"hero_{suffix}",
    }
    response = client.post("/api/auth/register", json=payload)

    assert response.status_code == 201
    return response.json()["access_token"], payload


def get_current_user_profile(client: TestClient, token: str) -> dict[str, str]:
    response = client.get("/api/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    return response.json()


def send_presence_heartbeat(client: TestClient, token: str) -> None:
    response = client.post("/api/presence/heartbeat", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 204


def delete_user(login: str) -> None:
    with SessionLocal() as db:
        user = db.execute(select(User).where(User.email == login)).scalar_one_or_none()
        if user is not None:
            db.delete(user)
            db.commit()


def delete_server(server_id: str) -> None:
    with SessionLocal() as db:
        server = db.get(Server, server_id)
        if server is not None:
            db.delete(server)
            db.commit()


def get_seed_server_and_voice_channel(client: TestClient, token: str) -> tuple[dict[str, str], dict[str, str]]:
    servers_response = client.get("/api/servers", headers={"Authorization": f"Bearer {token}"})
    assert servers_response.status_code == 200
    server = next(server for server in servers_response.json() if server["slug"] == "forgehold-collective")

    channels_response = client.get(
        f"/api/servers/{server['id']}/channels",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert channels_response.status_code == 200
    voice_channel = next(
        channel
        for channel in channels_response.json()
        if channel["type"] == "voice" and channel["name"] != "РўР°РІРµСЂРЅР°"
    )
    return server, voice_channel


def get_seed_server_and_tavern_channel(client: TestClient, token: str) -> tuple[dict[str, str], dict[str, str]]:
    servers_response = client.get("/api/servers", headers={"Authorization": f"Bearer {token}"})
    assert servers_response.status_code == 200
    server = next(server for server in servers_response.json() if server["slug"] == "forgehold-collective")

    channels_response = client.get(
        f"/api/servers/{server['id']}/channels",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert channels_response.status_code == 200
    voice_channel = next(
        channel
        for channel in channels_response.json()
        if channel["type"] == "voice" and channel["name"] == "РўР°РІРµСЂРЅР°"
    )
    return server, voice_channel


def get_seed_server_and_text_channel(client: TestClient, token: str) -> tuple[dict[str, str], dict[str, str]]:
    servers_response = client.get("/api/servers", headers={"Authorization": f"Bearer {token}"})
    assert servers_response.status_code == 200
    server = next(server for server in servers_response.json() if server["slug"] == "forgehold-collective")

    channels_response = client.get(
        f"/api/servers/{server['id']}/channels",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert channels_response.status_code == 200
    text_channel = next(channel for channel in channels_response.json() if channel["type"] == "text")
    return server, text_channel


def create_temp_text_channel(client: TestClient, token: str, suffix: str) -> tuple[dict[str, str], dict[str, str]]:
    create_group_response = client.post(
        "/api/servers",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": f"РўРµРєСЃС‚РѕРІР°СЏ РіСЂСѓРїРїР° {suffix}",
            "description": "Р’СЂРµРјРµРЅРЅР°СЏ РіСЂСѓРїРїР° РґР»СЏ С‚РµСЃС‚РѕРІ СЃРѕРѕР±С‰РµРЅРёР№",
        },
    )
    assert create_group_response.status_code == 201
    group = create_group_response.json()

    channel_response = client.post(
        f"/api/servers/{group['id']}/channels",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": f"С‡Р°С‚-{suffix}",
            "topic": "РўРµСЃС‚РѕРІС‹Р№ С‡Р°С‚",
            "type": "text",
        },
    )
    assert channel_response.status_code == 201
    return group, channel_response.json()


@contextmanager
def connect_app_events_websocket(client: TestClient, token: str, server_id: str | None = None):
    with client.websocket_connect(f"/api/events/ws?token={token}") as websocket:
        ready_event = websocket.receive_json()
        assert ready_event["type"] == "ready"
        if server_id is not None:
            websocket.send_json({"type": "subscribe_server", "server_id": server_id})
        yield websocket


def test_admin_login_returns_access_token() -> None:
    with TestClient(app) as client:
        token = login_admin_user(client)

    assert token


def test_register_user_returns_session_and_profile() -> None:
    with TestClient(app) as client:
        _, payload = register_regular_user(client)
        try:
            login_response = client.post(
                "/api/auth/login",
                json={
                    "email": payload["email"],
                    "password": payload["password"],
                },
            )
        finally:
            delete_user(payload["email"])

    assert login_response.status_code == 200
    user = login_response.json()["user"]
    assert user["email"] == payload["email"]
    assert user["nick"] == payload["nick"]
    assert user["is_admin"] is False


def test_current_user_endpoint_returns_admin_user() -> None:
    with TestClient(app) as client:
        token = login_admin_user(client)
        response = client.get("/api/me", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["email"] == "weren9000@kva-chat.local"
    assert payload["nick"] == "weren9000"
    assert payload["is_admin"] is True


def test_user_can_update_avatar() -> None:
    with TestClient(app) as client:
        token, payload = register_regular_user(client)

        try:
            update_response = client.put(
                "/api/me/profile",
                headers={"Authorization": f"Bearer {token}"},
                data={"remove_avatar": "false"},
                files={
                    "avatar": ("avatar.png", TEST_PNG_BYTES, "image/png"),
                },
            )
            assert update_response.status_code == 200
            updated_user = update_response.json()
            assert updated_user["avatar_updated_at"] is not None

            current_user_response = client.get("/api/me", headers={"Authorization": f"Bearer {token}"})
            assert current_user_response.status_code == 200
            assert current_user_response.json()["avatar_updated_at"] == updated_user["avatar_updated_at"]

            avatar_response = client.get(f"/api/users/{updated_user['id']}/avatar")
            assert avatar_response.status_code == 200
            assert avatar_response.headers["content-type"].startswith("image/png")
            assert avatar_response.content == TEST_PNG_BYTES
        finally:
            delete_user(payload["email"])


def test_admin_can_create_text_and_voice_channels() -> None:
    suffix = uuid4().hex[:6]

    with TestClient(app) as client:
        token = login_admin_user(client)
        create_group_response = client.post(
            "/api/servers",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "name": f"Р“СЂСѓРїРїР° {suffix}",
                "description": "РўРµСЃС‚РѕРІР°СЏ РіСЂСѓРїРїР° Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂР°",
            },
        )

        assert create_group_response.status_code == 201
        group = create_group_response.json()

        try:
            text_channel_response = client.post(
                f"/api/servers/{group['id']}/channels",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "name": f"С‚РµРєСЃС‚-{suffix}",
                    "topic": "Р Р°Р±РѕС‡РёР№ С‚РµРєСЃС‚РѕРІС‹Р№ РєР°РЅР°Р»",
                    "type": "text",
                },
            )
            voice_channel_response = client.post(
                f"/api/servers/{group['id']}/channels",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "name": f"РіРѕР»РѕСЃ-{suffix}",
                    "topic": "Р Р°Р±РѕС‡Р°СЏ РіРѕР»РѕСЃРѕРІР°СЏ РєРѕРјРЅР°С‚Р°",
                    "type": "voice",
                },
            )
            channels_response = client.get(
                f"/api/servers/{group['id']}/channels",
                headers={"Authorization": f"Bearer {token}"},
            )
        finally:
            delete_server(group["id"])

    assert text_channel_response.status_code == 201
    assert text_channel_response.json()["type"] == "text"
    assert voice_channel_response.status_code == 201
    assert voice_channel_response.json()["type"] == "voice"
    assert channels_response.status_code == 200
    assert any(channel["name"] == "РўР°РІРµСЂРЅР°" for channel in channels_response.json())


def test_admin_can_delete_text_and_voice_channels() -> None:
    suffix = uuid4().hex[:6]

    with TestClient(app) as client:
        token = login_admin_user(client)
        create_group_response = client.post(
            "/api/servers",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "name": f"Р“СЂСѓРїРїР° СѓРґР°Р»РµРЅРёСЏ {suffix}",
                "description": "РџСЂРѕРІРµСЂРєР° СѓРґР°Р»РµРЅРёСЏ РєР°РЅР°Р»РѕРІ",
            },
        )

        assert create_group_response.status_code == 201
        group = create_group_response.json()

        try:
            text_channel_response = client.post(
                f"/api/servers/{group['id']}/channels",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "name": f"С‚РµРєСЃС‚-{suffix}",
                    "topic": "РЈРґР°Р»СЏРµРјС‹Р№ С‚РµРєСЃС‚РѕРІС‹Р№ РєР°РЅР°Р»",
                    "type": "text",
                },
            )
            voice_channel_response = client.post(
                f"/api/servers/{group['id']}/channels",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "name": f"РіРѕР»РѕСЃ-{suffix}",
                    "topic": "РЈРґР°Р»СЏРµРјС‹Р№ РіРѕР»РѕСЃРѕРІРѕР№ РєР°РЅР°Р»",
                    "type": "voice",
                },
            )
            assert text_channel_response.status_code == 201
            assert voice_channel_response.status_code == 201

            text_channel = text_channel_response.json()
            voice_channel = voice_channel_response.json()

            delete_text_response = client.delete(
                f"/api/servers/{group['id']}/channels/{text_channel['id']}",
                headers={"Authorization": f"Bearer {token}"},
            )
            delete_voice_response = client.delete(
                f"/api/servers/{group['id']}/channels/{voice_channel['id']}",
                headers={"Authorization": f"Bearer {token}"},
            )
            channels_response = client.get(
                f"/api/servers/{group['id']}/channels",
                headers={"Authorization": f"Bearer {token}"},
            )
        finally:
            delete_server(group["id"])

    assert delete_text_response.status_code == 204
    assert delete_voice_response.status_code == 204
    assert channels_response.status_code == 200
    channel_ids = {channel["id"] for channel in channels_response.json()}
    assert text_channel["id"] not in channel_ids
    assert voice_channel["id"] not in channel_ids


def test_admin_can_update_server_icon() -> None:
    suffix = uuid4().hex[:6]

    with TestClient(app) as client:
        token = login_admin_user(client)
        create_group_response = client.post(
            "/api/servers",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "name": f"РРєРѕРЅРєР° Р“СЂСѓРїРїР° {suffix}",
                "description": "Р“СЂСѓРїРїР° РґР»СЏ РїСЂРѕРІРµСЂРєРё РёРєРѕРЅРєРё",
            },
        )
        assert create_group_response.status_code == 201
        group = create_group_response.json()

        try:
            update_response = client.patch(
                f"/api/servers/{group['id']}/icon",
                headers={"Authorization": f"Bearer {token}"},
                json={"icon_asset": "РРјРїРµСЂРёСЏ.png"},
            )
            assert update_response.status_code == 200
            assert update_response.json()["icon_asset"] == "РРјРїРµСЂРёСЏ.png"

            servers_response = client.get("/api/servers", headers={"Authorization": f"Bearer {token}"})
            assert servers_response.status_code == 200
        finally:
            delete_server(group["id"])

    updated_group = next(server for server in servers_response.json() if server["id"] == group["id"])
    assert updated_group["icon_asset"] == "РРјРїРµСЂРёСЏ.png"


def test_regular_user_cannot_create_group() -> None:
    with TestClient(app) as client:
        token, payload = register_regular_user(client)
        try:
            response = client.post(
                "/api/servers",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "name": "Р—Р°РїСЂРµС‰РµРЅРЅР°СЏ РіСЂСѓРїРїР°",
                    "description": "РџСЂРѕРІРµСЂРєР° РїСЂР°РІ",
                },
            )
        finally:
            delete_user(payload["email"])

    assert response.status_code == 403


def test_regular_user_cannot_delete_channel() -> None:
    suffix = uuid4().hex[:6]

    with TestClient(app) as client:
        admin_token = login_admin_user(client)
        token, payload = register_regular_user(client)
        group, channel = create_temp_text_channel(client, admin_token, suffix)

        try:
            response = client.delete(
                f"/api/servers/{group['id']}/channels/{channel['id']}",
                headers={"Authorization": f"Bearer {token}"},
            )
        finally:
            delete_server(group["id"])
            delete_user(payload["email"])

    assert response.status_code == 403


def test_servers_and_channels_endpoints_return_seed_workspace() -> None:
    with TestClient(app) as client:
        token = login_admin_user(client)
        server, _ = get_seed_server_and_voice_channel(client, token)
        channels_response = client.get(
            f"/api/servers/{server['id']}/channels",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert channels_response.status_code == 200
    channels = channels_response.json()
    assert any(channel["name"] == "backend" for channel in channels)
    assert any(channel["type"] == "voice" for channel in channels)


def test_app_events_websocket_reports_ready_and_ping() -> None:
    with TestClient(app) as client:
        token = login_admin_user(client)

        with connect_app_events_websocket(client, token) as websocket:
            websocket.send_json({"type": "ping"})
            pong_event = websocket.receive_json()

    assert pong_event == {"type": "pong"}


def test_app_events_websocket_pushes_new_message_to_connected_clients() -> None:
    suffix = uuid4().hex[:6]

    with TestClient(app) as client:
        admin_token = login_admin_user(client)
        regular_token, payload = register_regular_user(client)
        server, text_channel = get_seed_server_and_text_channel(client, admin_token)

        try:
            with connect_app_events_websocket(client, regular_token, server["id"]) as websocket:
                send_message_response = client.post(
                    f"/api/channels/{text_channel['id']}/messages",
                    headers={"Authorization": f"Bearer {admin_token}"},
                    data={"content": f"realtime-{suffix}"},
                )

                assert send_message_response.status_code == 201
                pushed_event = websocket.receive_json()
        finally:
            delete_user(payload["email"])

    assert pushed_event["type"] == "message_created"
    assert pushed_event["server_id"] == text_channel["server_id"]
    assert pushed_event["message"]["channel_id"] == text_channel["id"]
    assert pushed_event["message"]["content"] == f"realtime-{suffix}"


def test_app_events_websocket_pushes_message_reaction_updates() -> None:
    suffix = uuid4().hex[:6]

    with TestClient(app) as client:
        admin_token = login_admin_user(client)
        regular_token, payload = register_regular_user(client)
        server, text_channel = get_seed_server_and_text_channel(client, admin_token)

        try:
            create_message_response = client.post(
                f"/api/channels/{text_channel['id']}/messages",
                headers={"Authorization": f"Bearer {admin_token}"},
                data={"content": f"react-{suffix}"},
            )
            assert create_message_response.status_code == 201
            message_id = create_message_response.json()["id"]

            with connect_app_events_websocket(client, regular_token, server["id"]) as websocket:
                reaction_response = client.put(
                    f"/api/messages/{message_id}/reactions/like",
                    headers={"Authorization": f"Bearer {admin_token}"},
                )

                assert reaction_response.status_code == 200
                pushed_event = websocket.receive_json()
        finally:
            delete_user(payload["email"])

    assert pushed_event["type"] == "message_reactions_updated"
    assert pushed_event["server_id"] == server["id"]
    assert pushed_event["channel_id"] == text_channel["id"]
    assert pushed_event["snapshot"]["message_id"] == message_id
    assert pushed_event["snapshot"]["reactions"] == [{"code": "like", "count": 1, "reacted": False}]


def test_regular_user_can_access_all_groups_channels_and_members() -> None:
    with TestClient(app) as client:
        token, payload = register_regular_user(client)
        try:
            server, text_channel = get_seed_server_and_text_channel(client, token)
            servers_response = client.get("/api/servers", headers={"Authorization": f"Bearer {token}"})
            channels_response = client.get(
                f"/api/servers/{server['id']}/channels",
                headers={"Authorization": f"Bearer {token}"},
            )
            members_response = client.get(
                f"/api/servers/{server['id']}/members",
                headers={"Authorization": f"Bearer {token}"},
            )
        finally:
            delete_user(payload["email"])

    assert servers_response.status_code == 200
    listed_server = next(item for item in servers_response.json() if item["id"] == server["id"])
    assert listed_server["member_role"] == "member"

    assert channels_response.status_code == 200
    channels = channels_response.json()
    assert any(channel["id"] == text_channel["id"] for channel in channels)
    tavern_channel = next(channel for channel in channels if channel["type"] == "voice" and channel["name"] == "РўР°РІРµСЂРЅР°")
    assert tavern_channel["voice_access_role"] == "resident"

    assert members_response.status_code == 200
    members = members_response.json()
    assert members
    assert any(member["login"] == "weren9000" for member in members)
    assert any(member["login"] == payload["login"] for member in members)


def test_server_members_endpoint_returns_seed_members() -> None:
    with TestClient(app) as client:
        token = login_admin_user(client)
        server, _ = get_seed_server_and_voice_channel(client, token)
        response = client.get(
            f"/api/servers/{server['id']}/members",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert response.status_code == 200
    members = response.json()
    assert members
    admin_member = next(member for member in members if member["login"] == "weren9000")
    assert admin_member["nick"] == "weren9000"
    assert admin_member["role"] in {"owner", "admin"}
    assert admin_member["is_online"] is False


def test_presence_heartbeat_marks_member_online() -> None:
    with TestClient(app) as client:
        token = login_admin_user(client)
        server, _ = get_seed_server_and_voice_channel(client, token)
        send_presence_heartbeat(client, token)
        response = client.get(
            f"/api/servers/{server['id']}/members",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert response.status_code == 200
    members = response.json()
    admin_member = next(member for member in members if member["login"] == "weren9000")
    assert admin_member["is_online"] is True


def test_voice_websocket_connects_and_returns_room_state() -> None:
    with TestClient(app) as client:
        token = login_admin_user(client)
        _, voice_channel = get_seed_server_and_voice_channel(client, token)

        with client.websocket_connect(f"/api/voice/channels/{voice_channel['id']}/ws?token={token}") as socket:
            room_state = socket.receive_json()
            assert room_state["type"] == "room_state"
            assert isinstance(room_state["self_id"], str)
            assert room_state["participants"] == []

            socket.send_json({"type": "ping"})
            pong = socket.receive_json()
            assert pong == {"type": "pong"}


def test_regular_user_can_join_voice_channel_as_resident() -> None:
    with TestClient(app) as client:
        admin_token = login_admin_user(client)
        token, payload = register_regular_user(client)
        try:
            _, voice_channel = get_seed_server_and_voice_channel(client, admin_token)
            current_user = get_current_user_profile(client, token)
            assign_response = client.put(
                f"/api/voice/channels/{voice_channel['id']}/access/{current_user['id']}",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={"role": "resident"},
            )
            assert assign_response.status_code == 200

            with client.websocket_connect(f"/api/voice/channels/{voice_channel['id']}/ws?token={token}") as socket:
                room_state = socket.receive_json()
                assert room_state["type"] == "room_state"
                assert isinstance(room_state["self_id"], str)
        finally:
            delete_user(payload["email"])


def test_regular_user_can_join_default_tavern_without_manual_assignment() -> None:
    with TestClient(app) as client:
        token, payload = register_regular_user(client)
        try:
            _, tavern_channel = get_seed_server_and_tavern_channel(client, token)

            with client.websocket_connect(f"/api/voice/channels/{tavern_channel['id']}/ws?token={token}") as socket:
                room_state = socket.receive_json()
                assert room_state["type"] == "room_state"
                assert isinstance(room_state["self_id"], str)
        finally:
            delete_user(payload["email"])


def test_guest_can_request_voice_access_and_join_after_owner_allows() -> None:
    with TestClient(app) as client:
        admin_token = login_admin_user(client)
        token, payload = register_regular_user(client)
        try:
            _, voice_channel = get_seed_server_and_voice_channel(client, admin_token)
            current_user = get_current_user_profile(client, token)
            assign_response = client.put(
                f"/api/voice/channels/{voice_channel['id']}/access/{current_user['id']}",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={"role": "guest"},
            )
            assert assign_response.status_code == 200

            channels_response = client.get(
                f"/api/servers/{voice_channel['server_id']}/channels",
                headers={"Authorization": f"Bearer {token}"},
            )
            assert channels_response.status_code == 200
            listed_voice_channel = next(
                channel for channel in channels_response.json() if channel["id"] == voice_channel["id"]
            )
            assert listed_voice_channel["voice_access_role"] == "guest"

            request_response = client.post(
                f"/api/voice/channels/{voice_channel['id']}/requests",
                headers={"Authorization": f"Bearer {token}"},
            )
            assert request_response.status_code == 200
            request_payload = request_response.json()
            assert request_payload["can_join_now"] is False
            request_id = request_payload["request"]["id"]

            inbox_response = client.get(
                "/api/voice/requests/inbox",
                headers={"Authorization": f"Bearer {admin_token}"},
            )
            assert inbox_response.status_code == 200
            assert any(request["id"] == request_id for request in inbox_response.json())

            resolve_response = client.post(
                f"/api/voice/requests/{request_id}/resolve",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={"action": "allow"},
            )
            assert resolve_response.status_code == 200
            assert resolve_response.json()["status"] == "allowed"

            with client.websocket_connect(f"/api/voice/channels/{voice_channel['id']}/ws?token={token}") as socket:
                room_state = socket.receive_json()
                assert room_state["type"] == "room_state"
                assert isinstance(room_state["self_id"], str)
        finally:
            delete_user(payload["email"])


def test_kicked_guest_sees_retry_wait_details() -> None:
    with TestClient(app) as client:
        admin_token = login_admin_user(client)
        token, payload = register_regular_user(client)
        try:
            _, voice_channel = get_seed_server_and_voice_channel(client, admin_token)
            current_user = get_current_user_profile(client, token)
            assign_response = client.put(
                f"/api/voice/channels/{voice_channel['id']}/access/{current_user['id']}",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={"role": "guest"},
            )
            assert assign_response.status_code == 200

            request_response = client.post(
                f"/api/voice/channels/{voice_channel['id']}/requests",
                headers={"Authorization": f"Bearer {token}"},
            )
            assert request_response.status_code == 200
            request_id = request_response.json()["request"]["id"]

            resolve_response = client.post(
                f"/api/voice/requests/{request_id}/resolve",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={"action": "allow"},
            )
            assert resolve_response.status_code == 200

            kick_response = client.post(
                f"/api/voice/channels/{voice_channel['id']}/participants/{current_user['id']}/kick",
                headers={"Authorization": f"Bearer {admin_token}"},
            )
            assert kick_response.status_code == 200

            blocked_response = client.post(
                f"/api/voice/channels/{voice_channel['id']}/requests",
                headers={"Authorization": f"Bearer {token}"},
            )
        finally:
            delete_user(payload["email"])

    assert blocked_response.status_code == 403
    detail = blocked_response.json()["detail"]
    assert detail["blocked_until"] is not None
    assert isinstance(detail["retry_after_seconds"], int)
    assert 1 <= detail["retry_after_seconds"] <= 300
    assert "РџРѕРІС‚РѕСЂРёС‚СЊ РїРѕРїС‹С‚РєСѓ РјРѕР¶РЅРѕ С‡РµСЂРµР·" in detail["message"]


def test_kicked_guest_voice_websocket_is_closed_immediately() -> None:
    with TestClient(app) as client:
        admin_token = login_admin_user(client)
        token, payload = register_regular_user(client)
        try:
            _, voice_channel = get_seed_server_and_voice_channel(client, admin_token)
            current_user = get_current_user_profile(client, token)
            assign_response = client.put(
                f"/api/voice/channels/{voice_channel['id']}/access/{current_user['id']}",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={"role": "guest"},
            )
            assert assign_response.status_code == 200

            request_response = client.post(
                f"/api/voice/channels/{voice_channel['id']}/requests",
                headers={"Authorization": f"Bearer {token}"},
            )
            assert request_response.status_code == 200
            request_id = request_response.json()["request"]["id"]

            resolve_response = client.post(
                f"/api/voice/requests/{request_id}/resolve",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={"action": "allow"},
            )
            assert resolve_response.status_code == 200

            with client.websocket_connect(f"/api/voice/channels/{voice_channel['id']}/ws?token={token}") as socket:
                room_state = socket.receive_json()
                assert room_state["type"] == "room_state"

                kick_response = client.post(
                    f"/api/voice/channels/{voice_channel['id']}/participants/{current_user['id']}/kick",
                    headers={"Authorization": f"Bearer {admin_token}"},
                )
                assert kick_response.status_code == 200

                with pytest.raises(WebSocketDisconnect) as disconnect_error:
                    socket.receive_json()
        finally:
            delete_user(payload["email"])

    assert disconnect_error.value.code == 4003


def test_owner_mute_updates_voice_socket_and_presence() -> None:
    with TestClient(app) as client:
        admin_token = login_admin_user(client)
        token, payload = register_regular_user(client)
        try:
            server, voice_channel = get_seed_server_and_voice_channel(client, admin_token)
            current_user = get_current_user_profile(client, token)
            assign_response = client.put(
                f"/api/voice/channels/{voice_channel['id']}/access/{current_user['id']}",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={"role": "resident"},
            )
            assert assign_response.status_code == 200

            with client.websocket_connect(f"/api/voice/channels/{voice_channel['id']}/ws?token={token}") as socket:
                room_state = socket.receive_json()
                assert room_state["type"] == "room_state"
                assert room_state["self_participant"]["owner_muted"] is False

                mute_response = client.put(
                    f"/api/voice/channels/{voice_channel['id']}/participants/{current_user['id']}/owner-mute",
                    headers={"Authorization": f"Bearer {admin_token}"},
                    json={"owner_muted": True},
                )
                assert mute_response.status_code == 200
                muted_entry = next(
                    entry for entry in mute_response.json() if entry["user_id"] == current_user["id"]
                )
                assert muted_entry["owner_muted"] is True

                owner_mute_event = socket.receive_json()
                assert owner_mute_event == {
                    "type": "owner_mute_state",
                    "participant_id": room_state["self_id"],
                    "owner_muted": True,
                }

                presence_response = client.get(
                    f"/api/servers/{server['id']}/voice-presence",
                    headers={"Authorization": f"Bearer {token}"},
                )
        finally:
            delete_user(payload["email"])

    assert presence_response.status_code == 200
    channels = presence_response.json()
    active_channel = next(channel for channel in channels if channel["channel_id"] == voice_channel["id"])
    participant = next(item for item in active_channel["participants"] if item["user_id"] == current_user["id"])
    assert participant["owner_muted"] is True


def test_voice_presence_endpoint_returns_active_voice_participants() -> None:
    with TestClient(app) as client:
        token = login_admin_user(client)
        server, voice_channel = get_seed_server_and_voice_channel(client, token)

        with client.websocket_connect(f"/api/voice/channels/{voice_channel['id']}/ws?token={token}") as socket:
            room_state = socket.receive_json()
            assert room_state["type"] == "room_state"

            response = client.get(
                f"/api/servers/{server['id']}/voice-presence",
                headers={"Authorization": f"Bearer {token}"},
            )

    assert response.status_code == 200
    channels = response.json()
    assert channels
    active_channel = next(channel for channel in channels if channel["channel_id"] == voice_channel["id"])
    assert active_channel["participants"]
    assert any(participant["user_id"] for participant in active_channel["participants"])


def test_voice_channel_supports_text_messages() -> None:
    suffix = uuid4().hex[:6]

    with TestClient(app) as client:
        token = login_admin_user(client)
        _, voice_channel = get_seed_server_and_voice_channel(client, token)

        create_response = client.post(
            f"/api/channels/{voice_channel['id']}/messages",
            headers={"Authorization": f"Bearer {token}"},
            data={"content": f"voice-chat-{suffix}"},
        )

        assert create_response.status_code == 201
        created_message = create_response.json()

        list_response = client.get(
            f"/api/channels/{voice_channel['id']}/messages?limit=10",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert list_response.status_code == 200
    items = list_response.json()["items"]
    assert any(message["id"] == created_message["id"] for message in items)
    assert created_message["channel_id"] == voice_channel["id"]
    assert created_message["content"] == f"voice-chat-{suffix}"


def test_hidden_voice_channel_messages_are_not_accessible_without_role() -> None:
    with TestClient(app) as client:
        admin_token = login_admin_user(client)
        _, voice_channel = get_seed_server_and_voice_channel(client, admin_token)
        user_token, payload = register_regular_user(client)

        try:
            list_response = client.get(
                f"/api/channels/{voice_channel['id']}/messages?limit=10",
                headers={"Authorization": f"Bearer {user_token}"},
            )
            create_response = client.post(
                f"/api/channels/{voice_channel['id']}/messages",
                headers={"Authorization": f"Bearer {user_token}"},
                data={"content": "hidden-voice-chat"},
            )
        finally:
            delete_user(payload["email"])

    assert list_response.status_code == 404
    assert create_response.status_code == 404


def test_text_messages_endpoint_supports_lazy_loading() -> None:
    with TestClient(app) as client:
        token = login_admin_user(client)
        _, text_channel = get_seed_server_and_text_channel(client, token)

        first_page_response = client.get(
            f"/api/channels/{text_channel['id']}/messages?limit=10",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert first_page_response.status_code == 200
        first_page = first_page_response.json()
        assert len(first_page["items"]) == 10
        assert first_page["has_more"] is True
        assert first_page["next_before"]

        second_page_response = client.get(
            f"/api/channels/{text_channel['id']}/messages?limit=10&before={first_page['next_before']}",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert second_page_response.status_code == 200
    second_page = second_page_response.json()
    assert len(second_page["items"]) == 10
    assert {message["id"] for message in first_page["items"]}.isdisjoint(
        {message["id"] for message in second_page["items"]}
    )


def test_can_send_message_with_attachment_and_download_it() -> None:
    suffix = uuid4().hex[:6]

    with TestClient(app) as client:
        token = login_admin_user(client)
        group, channel = create_temp_text_channel(client, token, suffix)

        try:
            create_message_response = client.post(
                f"/api/channels/{channel['id']}/messages",
                headers={"Authorization": f"Bearer {token}"},
                data={"content": "РЎРѕРѕР±С‰РµРЅРёРµ СЃ РІР»РѕР¶РµРЅРёРµРј"},
                files=[
                    ("files", ("brief.txt", b"Altgramm attachment payload", "text/plain")),
                ],
            )
            assert create_message_response.status_code == 201
            created_message = create_message_response.json()
            assert created_message["content"] == "РЎРѕРѕР±С‰РµРЅРёРµ СЃ РІР»РѕР¶РµРЅРёРµРј"
            assert len(created_message["attachments"]) == 1

            attachment_id = created_message["attachments"][0]["id"]
            download_response = client.get(
                f"/api/attachments/{attachment_id}",
                headers={"Authorization": f"Bearer {token}"},
            )
        finally:
            delete_server(group["id"])

    assert download_response.status_code == 200
    assert download_response.headers["content-type"].startswith("text/plain")
    assert download_response.content == b"Altgramm attachment payload"


def test_can_add_and_remove_message_reactions() -> None:
    suffix = uuid4().hex[:6]

    with TestClient(app) as client:
        token = login_admin_user(client)
        group, channel = create_temp_text_channel(client, token, suffix)

        try:
            create_message_response = client.post(
                f"/api/channels/{channel['id']}/messages",
                headers={"Authorization": f"Bearer {token}"},
                data={"content": "reaction-target"},
            )
            assert create_message_response.status_code == 201
            message_id = create_message_response.json()["id"]

            add_reaction_response = client.put(
                f"/api/messages/{message_id}/reactions/heart",
                headers={"Authorization": f"Bearer {token}"},
            )
            assert add_reaction_response.status_code == 200

            list_response = client.get(
                f"/api/channels/{channel['id']}/messages?limit=10",
                headers={"Authorization": f"Bearer {token}"},
            )
            assert list_response.status_code == 200

            remove_reaction_response = client.delete(
                f"/api/messages/{message_id}/reactions/heart",
                headers={"Authorization": f"Bearer {token}"},
            )
            assert remove_reaction_response.status_code == 200
        finally:
            delete_server(group["id"])

    add_snapshot = add_reaction_response.json()
    assert add_snapshot["message_id"] == message_id
    assert add_snapshot["reactions"] == [{"code": "heart", "count": 1, "reacted": True}]

    listed_message = next(message for message in list_response.json()["items"] if message["id"] == message_id)
    assert listed_message["reactions"] == [{"code": "heart", "count": 1, "reacted": True}]

    remove_snapshot = remove_reaction_response.json()
    assert remove_snapshot["message_id"] == message_id
    assert remove_snapshot["reactions"] == []


def test_can_add_praying_cat_message_reaction() -> None:
    suffix = uuid4().hex[:6]

    with TestClient(app) as client:
        token = login_admin_user(client)
        group, channel = create_temp_text_channel(client, token, suffix)

        try:
            create_message_response = client.post(
                f"/api/channels/{channel['id']}/messages",
                headers={"Authorization": f"Bearer {token}"},
                data={"content": "praying-cat-target"},
            )
            assert create_message_response.status_code == 201
            message_id = create_message_response.json()["id"]

            add_reaction_response = client.put(
                f"/api/messages/{message_id}/reactions/praying_cat",
                headers={"Authorization": f"Bearer {token}"},
            )
            assert add_reaction_response.status_code == 200
        finally:
            delete_server(group["id"])

    add_snapshot = add_reaction_response.json()
    assert add_snapshot["message_id"] == message_id
    assert add_snapshot["reactions"] == [{"code": "praying_cat", "count": 1, "reacted": True}]


def test_can_reply_to_existing_message() -> None:
    suffix = uuid4().hex[:6]

    with TestClient(app) as client:
        token = login_admin_user(client)
        group, channel = create_temp_text_channel(client, token, suffix)

        try:
            root_message_response = client.post(
                f"/api/channels/{channel['id']}/messages",
                headers={"Authorization": f"Bearer {token}"},
                data={"content": "РСЃС…РѕРґРЅРѕРµ СЃРѕРѕР±С‰РµРЅРёРµ"},
            )
            assert root_message_response.status_code == 201
            root_message = root_message_response.json()

            reply_message_response = client.post(
                f"/api/channels/{channel['id']}/messages",
                headers={"Authorization": f"Bearer {token}"},
                data={
                    "content": "РћС‚РІРµС‚ РЅР° СЃРѕРѕР±С‰РµРЅРёРµ",
                    "reply_to_message_id": root_message["id"],
                },
            )
            assert reply_message_response.status_code == 201

            list_response = client.get(
                f"/api/channels/{channel['id']}/messages?limit=10",
                headers={"Authorization": f"Bearer {token}"},
            )
        finally:
            delete_server(group["id"])

    assert list_response.status_code == 200
    reply_message = next(message for message in list_response.json()["items"] if message["content"] == "РћС‚РІРµС‚ РЅР° СЃРѕРѕР±С‰РµРЅРёРµ")
    assert reply_message["reply_to"]["id"] == root_message["id"]
    assert reply_message["reply_to"]["content"] == "РСЃС…РѕРґРЅРѕРµ СЃРѕРѕР±С‰РµРЅРёРµ"


def test_message_read_state_updates_message_and_pushes_event() -> None:
    suffix = uuid4().hex[:6]

    with TestClient(app) as client:
        admin_token = login_admin_user(client)
        regular_token, payload = register_regular_user(client)
        group, channel = create_temp_text_channel(client, admin_token, suffix)

        try:
            message_response = client.post(
                f"/api/channels/{channel['id']}/messages",
                headers={"Authorization": f"Bearer {admin_token}"},
                data={"content": "РЎРѕРѕР±С‰РµРЅРёРµ РґР»СЏ РїСЂРѕС‡С‚РµРЅРёСЏ"},
            )
            assert message_response.status_code == 201
            message = message_response.json()

            with connect_app_events_websocket(client, admin_token, group["id"]) as websocket:
                mark_read_response = client.post(
                    f"/api/channels/{channel['id']}/read",
                    headers={"Authorization": f"Bearer {regular_token}"},
                    json={"last_message_id": message["id"]},
                )
                assert mark_read_response.status_code == 200
                read_event = websocket.receive_json()

            list_response = client.get(
                f"/api/channels/{channel['id']}/messages?limit=10",
                headers={"Authorization": f"Bearer {admin_token}"},
            )
        finally:
            delete_server(group["id"])
            delete_user(payload["email"])

    assert read_event["type"] == "message_read_updated"
    assert read_event["channel_id"] == channel["id"]
    assert read_event["state"]["last_read_message_id"] == message["id"]
    listed_message = next(item for item in list_response.json()["items"] if item["id"] == message["id"])
    assert len(listed_message["read_by"]) == 1
    assert listed_message["read_by"][0]["id"] == mark_read_response.json()["user_id"]


