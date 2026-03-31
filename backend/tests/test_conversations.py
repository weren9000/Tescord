from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app

from test_auth_workspace import (
    delete_server,
    delete_user,
    get_current_user_profile,
    login_admin_user,
    register_regular_user,
)


def test_open_direct_conversation_creates_single_shared_chat() -> None:
    with TestClient(app) as client:
        admin_token = login_admin_user(client)
        user_token, payload = register_regular_user(client)
        conversation_id = None

        try:
            user_profile = get_current_user_profile(client, user_token)

            first_response = client.post(
                "/api/conversations/direct",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={"user_id": user_profile["id"]},
            )
            assert first_response.status_code == 201
            conversation = first_response.json()
            conversation_id = conversation["id"]
            assert conversation["kind"] == "direct"
            assert conversation["primary_channel_id"]

            second_response = client.post(
                "/api/conversations/direct",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={"user_id": user_profile["id"]},
            )
            assert second_response.status_code == 201
            assert second_response.json()["id"] == conversation["id"]

            user_conversations_response = client.get(
                "/api/conversations",
                headers={"Authorization": f"Bearer {user_token}"},
            )
            assert user_conversations_response.status_code == 200
            assert any(item["id"] == conversation["id"] for item in user_conversations_response.json())
        finally:
            if conversation_id is not None:
                delete_server(conversation_id)
            delete_user(payload["email"])


def test_open_direct_conversation_by_public_id() -> None:
    with TestClient(app) as client:
        admin_token = login_admin_user(client)
        user_token, payload = register_regular_user(client)
        conversation_id = None

        try:
            user_profile = get_current_user_profile(client, user_token)

            response = client.post(
                "/api/conversations/direct",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={"user_public_id": user_profile["public_id"]},
            )
            assert response.status_code == 201
            conversation = response.json()
            conversation_id = conversation["id"]
            assert conversation["kind"] == "direct"
            assert any(member["public_id"] == user_profile["public_id"] for member in conversation["members"])
        finally:
            if conversation_id is not None:
                delete_server(conversation_id)
            delete_user(payload["email"])


def test_conversation_messages_are_private_to_members() -> None:
    with TestClient(app) as client:
        admin_token = login_admin_user(client)
        user_token, payload = register_regular_user(client)
        outsider_token, outsider_payload = register_regular_user(client)

        conversation_id = None
        try:
            user_profile = get_current_user_profile(client, user_token)

            conversation_response = client.post(
                "/api/conversations/direct",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={"user_id": user_profile["id"]},
            )
            assert conversation_response.status_code == 201
            conversation = conversation_response.json()
            conversation_id = conversation["id"]
            channel_id = conversation["primary_channel_id"]

            message_response = client.post(
                f"/api/channels/{channel_id}/messages",
                headers={"Authorization": f"Bearer {admin_token}"},
                data={"content": "РџСЂРёРІРµС‚ РёР· Р»РёС‡РЅРѕРіРѕ С‡Р°С‚Р°"},
            )
            assert message_response.status_code == 201

            member_messages_response = client.get(
                f"/api/channels/{channel_id}/messages",
                headers={"Authorization": f"Bearer {user_token}"},
            )
            assert member_messages_response.status_code == 200
            assert member_messages_response.json()["items"][0]["content"] == "РџСЂРёРІРµС‚ РёР· Р»РёС‡РЅРѕРіРѕ С‡Р°С‚Р°"

            outsider_messages_response = client.get(
                f"/api/channels/{channel_id}/messages",
                headers={"Authorization": f"Bearer {outsider_token}"},
            )
            assert outsider_messages_response.status_code == 404
        finally:
            if conversation_id is not None:
                delete_server(conversation_id)
            delete_user(payload["email"])
            delete_user(outsider_payload["email"])


def test_user_can_create_group_conversation() -> None:
    with TestClient(app) as client:
        owner_token, owner_payload = register_regular_user(client)
        member_one_token, member_one_payload = register_regular_user(client)
        _, member_two_payload = register_regular_user(client)

        conversation_id = None
        try:
            member_one_profile = get_current_user_profile(client, member_one_token)
            member_two_login_response = client.post(
                "/api/auth/login",
                json={"email": member_two_payload["email"], "password": member_two_payload["password"]},
            )
            assert member_two_login_response.status_code == 200
            member_two_profile = member_two_login_response.json()["user"]

            group_response = client.post(
                "/api/conversations/group",
                headers={"Authorization": f"Bearer {owner_token}"},
                json={
                    "name": f"РњРёРЅРё-РіСЂСѓРїРїР° {uuid4().hex[:6]}",
                    "member_ids": [member_one_profile["id"], member_two_profile["id"]],
                },
            )
            assert group_response.status_code == 201
            conversation = group_response.json()
            conversation_id = conversation["id"]
            assert conversation["kind"] == "group_chat"
            assert len(conversation["members"]) == 3

            members_response = client.get(
                f"/api/servers/{conversation['id']}/members",
                headers={"Authorization": f"Bearer {owner_token}"},
            )
            assert members_response.status_code == 200
            assert len(members_response.json()) == 3
        finally:
            if conversation_id is not None:
                delete_server(conversation_id)
            delete_user(owner_payload["email"])
            delete_user(member_one_payload["email"])
            delete_user(member_two_payload["email"])


def test_user_can_create_group_conversation_alone() -> None:
    with TestClient(app) as client:
        owner_token, owner_payload = register_regular_user(client)
        conversation_id = None

        try:
            group_response = client.post(
                "/api/conversations/group",
                headers={"Authorization": f"Bearer {owner_token}"},
                json={
                    "name": f"Соло-группа {uuid4().hex[:6]}",
                    "member_ids": [],
                },
            )
            assert group_response.status_code == 201
            conversation = group_response.json()
            conversation_id = conversation["id"]
            assert conversation["kind"] == "group_chat"
            assert len(conversation["members"]) == 1
            assert conversation["members"][0]["role"] == "owner"
        finally:
            if conversation_id is not None:
                delete_server(conversation_id)
            delete_user(owner_payload["email"])

