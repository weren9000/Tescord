import { HttpErrorResponse } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';

import { AuthApiService } from './core/api/auth-api.service';
import { SystemApiService } from './core/api/system-api.service';
import { WorkspaceApiService } from './core/api/workspace-api.service';
import { AuthSessionResponse } from './core/models/auth.models';
import { ApiHealthResponse } from './core/models/system.models';
import {
  CurrentUserResponse,
  WorkspaceChannel,
  WorkspaceMember,
  WorkspaceServer
} from './core/models/workspace.models';
import { VoiceParticipant, VoiceRoomService } from './core/services/voice-room.service';

type AuthMode = 'login' | 'register';
type ChannelKind = 'text' | 'voice';
type MemberPresenceTone = 'inactive' | 'speaking' | 'open' | 'muted';

interface LoginFormModel {
  login: string;
  password: string;
}

interface RegisterFormModel {
  login: string;
  password: string;
  full_name: string;
  nick: string;
  character_name: string;
}

interface CreateGroupFormModel {
  name: string;
  description: string;
}

interface CreateChannelFormModel {
  name: string;
  topic: string;
  type: ChannelKind;
}

interface ServerShortcut {
  id: string;
  label: string;
  name: string;
  active: boolean;
}

interface GroupMemberItem {
  id: string;
  userId: string;
  login: string;
  nick: string;
  fullName: string;
  characterName: string | null;
  role: string;
  roleLabel: string;
  isSelf: boolean;
  presence: MemberPresenceTone;
  presenceLabel: string;
  voiceParticipant: VoiceParticipant | null;
}

const ADMIN_CREDENTIALS: LoginFormModel = {
  login: 'weren9000',
  password: 'Vfrfhjys9000'
};

const SESSION_STORAGE_KEY = 'tescord.session';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  private readonly systemApi = inject(SystemApiService);
  private readonly authApi = inject(AuthApiService);
  private readonly workspaceApi = inject(WorkspaceApiService);
  private readonly voiceRoom = inject(VoiceRoomService);
  private readonly destroyRef = inject(DestroyRef);

  readonly health = signal<ApiHealthResponse | null>(null);
  readonly healthError = signal<string | null>(null);
  readonly authError = signal<string | null>(null);
  readonly workspaceError = signal<string | null>(null);
  readonly managementError = signal<string | null>(null);
  readonly managementSuccess = signal<string | null>(null);
  readonly authLoading = signal(false);
  readonly workspaceLoading = signal(false);
  readonly createGroupLoading = signal(false);
  readonly createChannelLoading = signal(false);
  readonly authMode = signal<AuthMode>('login');

  readonly session = signal<AuthSessionResponse | null>(null);
  readonly currentUser = signal<CurrentUserResponse | null>(null);
  readonly servers = signal<WorkspaceServer[]>([]);
  readonly channels = signal<WorkspaceChannel[]>([]);
  readonly members = signal<WorkspaceMember[]>([]);
  readonly selectedServerId = signal<string | null>(null);
  readonly selectedChannelId = signal<string | null>(null);
  readonly settingsPanelOpen = signal(false);
  readonly createGroupModalOpen = signal(false);
  readonly createChannelModalOpen = signal(false);
  readonly selectedMemberUserId = signal<string | null>(null);

  readonly loginForm: LoginFormModel = {
    login: '',
    password: ''
  };

  readonly registerForm: RegisterFormModel = {
    login: '',
    password: '',
    full_name: '',
    nick: '',
    character_name: ''
  };

  readonly createGroupForm: CreateGroupFormModel = {
    name: '',
    description: ''
  };

  readonly createChannelForm: CreateChannelFormModel = {
    name: '',
    topic: '',
    type: 'text'
  };

  readonly isAuthenticated = computed(() => this.session() !== null);
  readonly isAdmin = computed(() => this.currentUser()?.is_admin === true);
  readonly voiceParticipants = this.voiceRoom.participants;
  readonly voiceError = this.voiceRoom.error;
  readonly voiceState = this.voiceRoom.state;
  readonly voiceMuted = this.voiceRoom.localMuted;
  readonly voiceSettings = this.voiceRoom.settings;
  readonly settingsNotice = this.voiceRoom.settingsNotice;
  readonly devicesLoading = this.voiceRoom.devicesLoading;
  readonly inputDevices = this.voiceRoom.inputDevices;
  readonly outputDevices = this.voiceRoom.outputDevices;
  readonly outputDeviceSupported = this.voiceRoom.outputDeviceSupported;

  readonly activeServer = computed(() => {
    const serverId = this.selectedServerId();
    return this.servers().find((server) => server.id === serverId) ?? null;
  });

  readonly activeChannel = computed(() => {
    const channelId = this.selectedChannelId();
    return this.channels().find((channel) => channel.id === channelId) ?? null;
  });

  readonly textChannels = computed(() => this.channels().filter((channel) => channel.type === 'text'));
  readonly voiceChannels = computed(() => this.channels().filter((channel) => channel.type === 'voice'));

  readonly connectedVoiceChannel = computed(() => {
    const connectedChannelId = this.voiceRoom.activeChannelId();
    return this.channels().find((channel) => channel.id === connectedChannelId) ?? null;
  });

  readonly connectedVoiceChannelId = computed(() => this.connectedVoiceChannel()?.id ?? null);
  readonly isVoiceChannelSelected = computed(() => this.activeChannel()?.type === 'voice');
  readonly hasVoiceConnection = computed(() => this.voiceRoom.isConnected() && this.connectedVoiceChannel() !== null);
  readonly isInActiveVoiceChannel = computed(
    () => this.hasVoiceConnection() && this.activeChannel()?.id === this.connectedVoiceChannel()?.id
  );
  readonly showVoiceDock = computed(() => this.hasVoiceConnection() && !this.isInActiveVoiceChannel());

  readonly canManageActiveGroup = computed(() => {
    const activeServer = this.activeServer();
    const currentUser = this.currentUser();
    if (!activeServer || !currentUser) {
      return false;
    }

    return currentUser.is_admin || activeServer.member_role === 'owner' || activeServer.member_role === 'admin';
  });

  readonly statusTone = computed(() => {
    if (
      this.authError() ||
      this.workspaceError() ||
      this.healthError() ||
      this.managementError() ||
      this.voiceError()
    ) {
      return 'offline';
    }

    if (
      this.authLoading() ||
      this.workspaceLoading() ||
      this.createGroupLoading() ||
      this.createChannelLoading() ||
      this.voiceState() === 'connecting'
    ) {
      return 'checking';
    }

    const health = this.health();
    if (!health) {
      return 'checking';
    }

    return health.status === 'ok' && health.database === 'online' ? 'healthy' : 'warning';
  });

  readonly statusLabel = computed(() => {
    if (this.voiceError()) {
      return 'Ошибка голосового канала';
    }

    if (this.managementError()) {
      return 'Ошибка управления группой';
    }

    if (this.authError()) {
      return 'Нужна авторизация';
    }

    if (this.workspaceError()) {
      return 'Не удалось загрузить рабочее пространство';
    }

    if (this.healthError()) {
      return 'Бэкенд недоступен';
    }

    if (this.voiceState() === 'connecting') {
      return 'Подключаем голосовой канал';
    }

    if (this.hasVoiceConnection()) {
      return `В голосе: ${this.connectedVoiceChannel()?.name ?? 'канал активен'}`;
    }

    if (this.createGroupLoading()) {
      return 'Создаем новую группу';
    }

    if (this.createChannelLoading()) {
      return 'Создаем новый канал';
    }

    if (this.authLoading()) {
      return this.authMode() === 'register' ? 'Создаем аккаунт' : 'Выполняем вход';
    }

    if (this.workspaceLoading()) {
      return 'Загружаем группы и каналы';
    }

    const health = this.health();
    if (!health) {
      return 'Проверяем API';
    }

    return health.status === 'ok' && health.database === 'online'
      ? 'API и база данных готовы'
      : 'API доступно, база данных еще поднимается';
  });

  readonly activeChannelHeading = computed(() => {
    const channel = this.activeChannel();
    if (!channel) {
      return 'Канал не выбран';
    }

    return channel.type === 'voice' ? `Голосовой: ${channel.name}` : `# ${channel.name}`;
  });

  readonly voiceStatusLabel = computed(() => {
    if (this.voiceError()) {
      return this.voiceError();
    }

    if (this.voiceState() === 'connecting') {
      return 'Подключаемся к голосовой комнате';
    }

    if (this.isInActiveVoiceChannel()) {
      return this.voiceMuted() ? 'Вы в канале, микрофон выключен' : 'Вы в канале, микрофон включен';
    }

    if (this.hasVoiceConnection()) {
      return `Сейчас активен канал ${this.connectedVoiceChannel()?.name ?? ''}`.trim();
    }

    return 'Можно подключиться к голосовому каналу';
  });

  readonly voiceDockLabel = computed(() => {
    if (!this.hasVoiceConnection()) {
      return '';
    }

    return this.voiceMuted()
      ? 'Голос работает в фоне, микрофон выключен'
      : 'Голос работает в фоне, микрофон включен';
  });

  readonly composerHint = computed(() => {
    if (this.showVoiceDock()) {
      return `Вы остаетесь в голосовом канале ${this.connectedVoiceChannel()?.name ?? ''}, пока не выйдете из него или не смените группу.`;
    }

    if (this.isVoiceChannelSelected()) {
      return 'Голосовой канал использует микрофон браузера и остается активным, пока вы находитесь в этой группе.';
    }

    return 'Следующий шаг после этого интерфейса: история сообщений, отправка текста и вложения.';
  });

  readonly serverShortcuts = computed<ServerShortcut[]>(() =>
    this.servers().map((server) => ({
      id: server.id,
      label: this.buildServerLabel(server.name),
      name: server.name,
      active: server.id === this.selectedServerId()
    }))
  );

  readonly groupMembers = computed<GroupMemberItem[]>(() => {
    const currentUser = this.currentUser();
    const voiceParticipantsByUserId = new Map(this.voiceParticipants().map((participant) => [participant.user_id, participant]));

    return [...this.members()]
      .map((member) => {
        const voiceParticipant = voiceParticipantsByUserId.get(member.user_id) ?? null;
        const presence = voiceParticipant ? this.voiceParticipantTone(voiceParticipant) : 'inactive';

        return {
          id: member.id,
          userId: member.user_id,
          login: member.login,
          nick: member.nick,
          fullName: member.full_name,
          characterName: member.character_name,
          role: member.role,
          roleLabel: this.formatMemberRole(member.role),
          isSelf: currentUser?.id === member.user_id,
          presence,
          presenceLabel: this.formatPresenceLabel(presence),
          voiceParticipant
        };
      })
      .sort((left, right) => {
        const leftPresenceWeight = this.getPresenceWeight(left.presence);
        const rightPresenceWeight = this.getPresenceWeight(right.presence);
        if (leftPresenceWeight !== rightPresenceWeight) {
          return leftPresenceWeight - rightPresenceWeight;
        }

        const leftRoleWeight = this.getRoleWeight(left.role);
        const rightRoleWeight = this.getRoleWeight(right.role);
        if (leftRoleWeight !== rightRoleWeight) {
          return leftRoleWeight - rightRoleWeight;
        }

        return left.nick.localeCompare(right.nick, 'ru');
      });
  });

  readonly selectedMember = computed(() => {
    const userId = this.selectedMemberUserId();
    return this.groupMembers().find((member) => member.userId === userId) ?? null;
  });

  readonly selectedMemberVolume = computed(() => {
    const member = this.selectedMember();
    if (!member) {
      return 100;
    }

    return this.voiceRoom.getParticipantVolume(member.userId);
  });

  readonly localizedEnvironment = computed(() => {
    const environment = this.health()?.environment;

    if (environment === 'development') {
      return 'разработка';
    }

    if (environment === 'staging') {
      return 'стейджинг';
    }

    if (environment === 'production') {
      return 'прод';
    }

    if (environment === 'test') {
      return 'тест';
    }

    return environment ?? 'неизвестно';
  });

  readonly localizedDatabaseStatus = computed(() => {
    const database = this.health()?.database;

    if (database === 'online') {
      return 'онлайн';
    }

    if (database === 'offline') {
      return 'офлайн';
    }

    return 'неизвестно';
  });

  constructor() {
    this.loadHealth();
    this.restoreSession();
  }

  switchAuthMode(mode: AuthMode): void {
    this.authMode.set(mode);
    this.authError.set(null);
  }

  useAdminAccount(): void {
    this.authMode.set('login');
    this.loginForm.login = ADMIN_CREDENTIALS.login;
    this.loginForm.password = ADMIN_CREDENTIALS.password;
    this.authError.set(null);
  }

  submitLogin(): void {
    const payload = {
      login: this.loginForm.login.trim(),
      password: this.loginForm.password
    };

    if (!payload.login || !payload.password) {
      this.authError.set('Введите логин и пароль');
      return;
    }

    this.authLoading.set(true);
    this.authError.set(null);

    this.authApi
      .login(payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (session) => this.handleAuthenticatedSession(session),
        error: (error) => {
          this.authLoading.set(false);
          this.authError.set(this.extractErrorMessage(error, 'Не удалось выполнить вход'));
        }
      });
  }

  submitRegistration(): void {
    const payload = {
      login: this.registerForm.login.trim(),
      password: this.registerForm.password,
      full_name: this.registerForm.full_name.trim(),
      nick: this.registerForm.nick.trim(),
      character_name: this.registerForm.character_name.trim()
    };

    if (!payload.login || !payload.password || !payload.full_name || !payload.nick || !payload.character_name) {
      this.authError.set('Заполните все поля регистрации');
      return;
    }

    this.authLoading.set(true);
    this.authError.set(null);

    this.authApi
      .register(payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (session) => this.handleAuthenticatedSession(session),
        error: (error) => {
          this.authLoading.set(false);
          this.authError.set(this.extractErrorMessage(error, 'Не удалось зарегистрироваться'));
        }
      });
  }

  openVoiceSettings(): void {
    this.settingsPanelOpen.set(true);
    void this.voiceRoom.refreshDevices();
  }

  closeVoiceSettings(): void {
    this.settingsPanelOpen.set(false);
  }

  openCreateGroupModal(): void {
    if (!this.isAdmin()) {
      return;
    }

    this.createGroupModalOpen.set(true);
    this.managementError.set(null);
    this.managementSuccess.set(null);
  }

  closeCreateGroupModal(): void {
    this.createGroupModalOpen.set(false);
  }

  openCreateChannelModal(type: ChannelKind): void {
    if (!this.canManageActiveGroup()) {
      return;
    }

    this.createChannelForm.type = type;
    this.createChannelModalOpen.set(true);
    this.managementError.set(null);
    this.managementSuccess.set(null);
  }

  closeCreateChannelModal(): void {
    this.createChannelModalOpen.set(false);
  }

  openMemberVolume(member: GroupMemberItem): void {
    this.selectedMemberUserId.set(member.userId);
  }

  closeMemberVolume(): void {
    this.selectedMemberUserId.set(null);
  }

  submitCreateGroup(): void {
    const token = this.session()?.access_token;
    if (!token) {
      return;
    }

    const payload = {
      name: this.createGroupForm.name.trim(),
      description: this.createGroupForm.description.trim() || null
    };

    if (!payload.name) {
      this.managementError.set('Введите название группы');
      return;
    }

    this.createGroupLoading.set(true);
    this.managementError.set(null);
    this.managementSuccess.set(null);

    this.workspaceApi
      .createServer(token, payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (server) => {
          const updatedServers = [...this.servers(), server].sort((left, right) => left.name.localeCompare(right.name, 'ru'));
          this.servers.set(updatedServers);
          this.createGroupForm.name = '';
          this.createGroupForm.description = '';
          this.managementSuccess.set(`Группа «${server.name}» создана`);
          this.createGroupLoading.set(false);
          this.createGroupModalOpen.set(false);
          this.selectServer(server.id);
        },
        error: (error) => {
          this.createGroupLoading.set(false);
          this.managementError.set(this.extractErrorMessage(error, 'Не удалось создать группу'));
        }
      });
  }

  submitCreateChannel(): void {
    const token = this.session()?.access_token;
    const activeServer = this.activeServer();
    if (!token || !activeServer) {
      return;
    }

    const payload = {
      name: this.createChannelForm.name.trim(),
      topic: this.createChannelForm.topic.trim() || null,
      type: this.createChannelForm.type
    };

    if (!payload.name) {
      this.managementError.set('Введите название канала');
      return;
    }

    this.createChannelLoading.set(true);
    this.managementError.set(null);
    this.managementSuccess.set(null);

    this.workspaceApi
      .createChannel(token, activeServer.id, payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (channel) => {
          const updatedChannels = [...this.channels(), channel].sort((left, right) => left.position - right.position);
          this.channels.set(updatedChannels);
          this.selectedChannelId.set(channel.id);
          this.createChannelForm.name = '';
          this.createChannelForm.topic = '';
          this.createChannelForm.type = 'text';
          this.managementSuccess.set(
            channel.type === 'voice'
              ? `Голосовой канал ${channel.name} создан`
              : `Текстовый канал #${channel.name} создан`
          );
          this.createChannelLoading.set(false);
          this.createChannelModalOpen.set(false);
        },
        error: (error) => {
          this.createChannelLoading.set(false);
          this.managementError.set(this.extractErrorMessage(error, 'Не удалось создать канал'));
        }
      });
  }

  async joinActiveVoiceChannel(): Promise<void> {
    const activeChannel = this.activeChannel();
    if (!activeChannel || activeChannel.type !== 'voice') {
      return;
    }

    await this.connectToVoiceChannel(activeChannel);
  }

  leaveVoiceChannel(): void {
    this.voiceRoom.leave();
  }

  toggleVoiceMute(): void {
    this.voiceRoom.toggleMute();
  }

  openConnectedVoiceChannel(): void {
    const connectedVoiceChannel = this.connectedVoiceChannel();
    if (!connectedVoiceChannel) {
      return;
    }

    this.selectedChannelId.set(connectedVoiceChannel.id);
  }

  changeInputDevice(deviceId: string): void {
    void this.voiceRoom.updateInputDevice(deviceId || null);
  }

  refreshVoiceDevices(): void {
    void this.voiceRoom.refreshDevices();
  }

  changeOutputDevice(deviceId: string): void {
    void this.voiceRoom.updateOutputDevice(deviceId || null);
  }

  changeVoiceSensitivity(value: number | string): void {
    this.voiceRoom.updateSensitivity(this.toRangeValue(value));
  }

  changeMasterVolume(value: number | string): void {
    this.voiceRoom.updateMasterVolume(this.toRangeValue(value));
  }

  changeMemberVolume(userId: string, value: number | string): void {
    this.voiceRoom.updateParticipantVolume(userId, this.toRangeValue(value));
  }

  logout(): void {
    this.voiceRoom.leave();
    this.session.set(null);
    this.currentUser.set(null);
    this.servers.set([]);
    this.channels.set([]);
    this.members.set([]);
    this.selectedServerId.set(null);
    this.selectedChannelId.set(null);
    this.settingsPanelOpen.set(false);
    this.createGroupModalOpen.set(false);
    this.createChannelModalOpen.set(false);
    this.selectedMemberUserId.set(null);
    this.authError.set(null);
    this.workspaceError.set(null);
    this.managementError.set(null);
    this.managementSuccess.set(null);
    this.authLoading.set(false);
    this.workspaceLoading.set(false);
    this.createGroupLoading.set(false);
    this.createChannelLoading.set(false);
    this.authMode.set('login');
    this.clearStoredSession();
  }

  selectServer(serverId: string): void {
    const token = this.session()?.access_token;
    if (!token || serverId === this.selectedServerId()) {
      return;
    }

    if (this.hasVoiceConnection()) {
      this.voiceRoom.leave();
    }

    this.loadServerWorkspace(token, serverId);
  }

  async selectChannel(channel: WorkspaceChannel): Promise<void> {
    this.selectedChannelId.set(channel.id);
    this.workspaceError.set(null);

    if (channel.type === 'voice') {
      await this.connectToVoiceChannel(channel);
    }
  }

  voiceParticipantsForChannel(channelId: string): VoiceParticipant[] {
    return this.connectedVoiceChannelId() === channelId ? this.voiceParticipants() : [];
  }

  voiceParticipantTone(participant: VoiceParticipant): MemberPresenceTone {
    if (participant.muted) {
      return 'muted';
    }

    return participant.speaking ? 'speaking' : 'open';
  }

  private loadHealth(): void {
    this.systemApi
      .getHealth()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (health) => {
          this.health.set(health);
          this.healthError.set(null);
        },
        error: () => {
          this.health.set(null);
          this.healthError.set('FastAPI не отвечает по адресу http://127.0.0.1:8000/api/health');
        }
      });
  }

  private restoreSession(): void {
    if (typeof localStorage === 'undefined') {
      return;
    }

    const rawSession = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!rawSession) {
      return;
    }

    try {
      const session = JSON.parse(rawSession) as AuthSessionResponse;
      if (!session.access_token || !session.user) {
        throw new Error('invalid session');
      }

      this.session.set(session);
      this.currentUser.set(session.user);
      this.bootstrapWorkspace(session.access_token);
    } catch {
      this.clearStoredSession();
    }
  }

  private handleAuthenticatedSession(session: AuthSessionResponse): void {
    this.session.set(session);
    this.currentUser.set(session.user);
    this.persistSession(session);
    this.authLoading.set(false);
    this.authError.set(null);
    this.managementError.set(null);
    this.managementSuccess.set(null);
    this.bootstrapWorkspace(session.access_token);
  }

  private bootstrapWorkspace(token: string): void {
    this.workspaceLoading.set(true);
    this.workspaceError.set(null);
    this.voiceRoom.leave();

    forkJoin({
      me: this.workspaceApi.getCurrentUser(token),
      servers: this.workspaceApi.getServers(token)
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ me, servers }) => {
          this.currentUser.set(me);
          this.servers.set(servers);

          if (!servers.length) {
            this.selectedServerId.set(null);
            this.selectedChannelId.set(null);
            this.channels.set([]);
            this.members.set([]);
            this.workspaceLoading.set(false);
            return;
          }

          const selectedServerId = this.selectedServerId();
          const preferredServerId =
            selectedServerId && servers.some((server) => server.id === selectedServerId)
              ? selectedServerId
              : servers[0].id;

          this.loadServerWorkspace(token, preferredServerId);
        },
        error: (error) => {
          this.workspaceLoading.set(false);
          this.voiceRoom.leave();
          this.session.set(null);
          this.currentUser.set(null);
          this.servers.set([]);
          this.channels.set([]);
          this.members.set([]);
          this.selectedServerId.set(null);
          this.selectedChannelId.set(null);
          this.clearStoredSession();
          this.authError.set(this.extractErrorMessage(error, 'Сессия устарела. Войдите снова.'));
        }
      });
  }

  private loadServerWorkspace(token: string, serverId: string): void {
    const previousSelectedChannelId = this.selectedChannelId();
    const connectedVoiceChannelId = this.voiceRoom.activeChannelId();

    this.workspaceLoading.set(true);
    this.workspaceError.set(null);
    this.managementError.set(null);
    this.managementSuccess.set(null);
    this.selectedServerId.set(serverId);
    this.selectedChannelId.set(null);
    this.selectedMemberUserId.set(null);

    forkJoin({
      channels: this.workspaceApi.getChannels(token, serverId),
      members: this.workspaceApi.getMembers(token, serverId)
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ channels, members }) => {
          this.channels.set(channels);
          this.members.set(members);

          const nextSelectedChannelId =
            (previousSelectedChannelId && channels.some((channel) => channel.id === previousSelectedChannelId)
              ? previousSelectedChannelId
              : null)
            ?? (connectedVoiceChannelId && channels.some((channel) => channel.id === connectedVoiceChannelId)
              ? connectedVoiceChannelId
              : null)
            ?? channels[0]?.id
            ?? null;

          this.selectedChannelId.set(nextSelectedChannelId);
          this.workspaceLoading.set(false);
        },
        error: (error) => {
          this.channels.set([]);
          this.members.set([]);
          this.workspaceLoading.set(false);
          this.workspaceError.set(this.extractErrorMessage(error, 'Не удалось загрузить данные выбранной группы'));
        }
      });
  }

  private async connectToVoiceChannel(channel: WorkspaceChannel): Promise<void> {
    const token = this.session()?.access_token;
    const currentUser = this.currentUser();
    if (!token || !currentUser || channel.type !== 'voice') {
      return;
    }

    this.workspaceError.set(null);
    await this.voiceRoom.join(channel.id, token, currentUser);
  }

  private persistSession(session: AuthSessionResponse): void {
    if (typeof localStorage === 'undefined') {
      return;
    }

    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  }

  private clearStoredSession(): void {
    if (typeof localStorage === 'undefined') {
      return;
    }

    localStorage.removeItem(SESSION_STORAGE_KEY);
  }

  private extractErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      const detail =
        typeof error.error === 'object' && error.error !== null
          ? (error.error as { detail?: unknown }).detail
          : null;

      if (typeof detail === 'string' && detail.trim()) {
        return detail;
      }
    }

    return fallback;
  }

  private buildServerLabel(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean);
    const initials = words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? '').join('');
    return initials || name.slice(0, 2).toUpperCase();
  }

  private formatMemberRole(role: string): string {
    if (role === 'owner') {
      return 'владелец';
    }

    if (role === 'admin') {
      return 'администратор';
    }

    return 'участник';
  }

  private formatPresenceLabel(presence: MemberPresenceTone): string {
    if (presence === 'speaking') {
      return 'говорит';
    }

    if (presence === 'open') {
      return 'микрофон включен';
    }

    if (presence === 'muted') {
      return 'микрофон выключен';
    }

    return 'не в голосе';
  }

  private getPresenceWeight(presence: MemberPresenceTone): number {
    if (presence === 'speaking') {
      return 0;
    }

    if (presence === 'open') {
      return 1;
    }

    if (presence === 'muted') {
      return 2;
    }

    return 3;
  }

  private getRoleWeight(role: string): number {
    if (role === 'owner') {
      return 0;
    }

    if (role === 'admin') {
      return 1;
    }

    return 2;
  }

  private toRangeValue(value: number | string): number {
    const normalized = typeof value === 'number' ? value : Number.parseFloat(value);
    if (Number.isNaN(normalized)) {
      return 0;
    }

    return normalized;
  }
}
