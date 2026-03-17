from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db.models import Server, User
from app.db.session import SessionLocal
from app.main import app


def login_admin_user(client: TestClient) -> str:
    response = client.post(
        "/api/auth/login",
        json={
            "login": "weren9000",
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
        "login": f"player_{suffix}",
        "password": "testpass123",
        "full_name": "Иван Петров",
        "nick": f"hero_{suffix}",
        "character_name": "Рыцарь Севера",
    }
    response = client.post("/api/auth/register", json=payload)

    assert response.status_code == 201
    return response.json()["access_token"], payload


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
    voice_channel = next(channel for channel in channels_response.json() if channel["type"] == "voice")
    return server, voice_channel


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
                    "login": payload["login"],
                    "password": payload["password"],
                },
            )
        finally:
            delete_user(payload["login"])

    assert login_response.status_code == 200
    user = login_response.json()["user"]
    assert user["login"] == payload["login"]
    assert user["nick"] == payload["nick"]
    assert user["character_name"] == payload["character_name"]
    assert user["is_admin"] is False


def test_current_user_endpoint_returns_admin_user() -> None:
    with TestClient(app) as client:
        token = login_admin_user(client)
        response = client.get("/api/me", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["login"] == "weren9000"
    assert payload["nick"] == "weren9000"
    assert payload["is_admin"] is True


def test_admin_can_create_text_and_voice_channels() -> None:
    suffix = uuid4().hex[:6]

    with TestClient(app) as client:
        token = login_admin_user(client)
        create_group_response = client.post(
            "/api/servers",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "name": f"Группа {suffix}",
                "description": "Тестовая группа администратора",
            },
        )

        assert create_group_response.status_code == 201
        group = create_group_response.json()

        try:
            text_channel_response = client.post(
                f"/api/servers/{group['id']}/channels",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "name": f"текст-{suffix}",
                    "topic": "Рабочий текстовый канал",
                    "type": "text",
                },
            )
            voice_channel_response = client.post(
                f"/api/servers/{group['id']}/channels",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "name": f"голос-{suffix}",
                    "topic": "Рабочая голосовая комната",
                    "type": "voice",
                },
            )
        finally:
            delete_server(group["id"])

    assert text_channel_response.status_code == 201
    assert text_channel_response.json()["type"] == "text"
    assert voice_channel_response.status_code == 201
    assert voice_channel_response.json()["type"] == "voice"


def test_regular_user_cannot_create_group() -> None:
    with TestClient(app) as client:
        token, payload = register_regular_user(client)
        try:
            response = client.post(
                "/api/servers",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "name": "Запрещенная группа",
                    "description": "Проверка прав",
                },
            )
        finally:
            delete_user(payload["login"])

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


def test_regular_user_can_access_all_groups_channels_and_members() -> None:
    with TestClient(app) as client:
        token, payload = register_regular_user(client)
        try:
            server, _ = get_seed_server_and_voice_channel(client, token)
            servers_response = client.get("/api/servers", headers={"Authorization": f"Bearer {token}"})
            members_response = client.get(
                f"/api/servers/{server['id']}/members",
                headers={"Authorization": f"Bearer {token}"},
            )
        finally:
            delete_user(payload["login"])

    assert servers_response.status_code == 200
    listed_server = next(item for item in servers_response.json() if item["id"] == server["id"])
    assert listed_server["member_role"] == "member"

    assert members_response.status_code == 200
    members = members_response.json()
    assert members
    assert any(member["login"] == "weren9000" for member in members)


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


def test_regular_user_can_join_voice_channel() -> None:
    with TestClient(app) as client:
        token, payload = register_regular_user(client)
        try:
            _, voice_channel = get_seed_server_and_voice_channel(client, token)
            with client.websocket_connect(f"/api/voice/channels/{voice_channel['id']}/ws?token={token}") as socket:
                room_state = socket.receive_json()
                assert room_state["type"] == "room_state"
                assert isinstance(room_state["self_id"], str)
        finally:
            delete_user(payload["login"])
