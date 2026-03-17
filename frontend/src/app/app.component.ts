import { HttpErrorResponse } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { Component, DestroyRef, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
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
  WorkspaceMessage,
  WorkspaceMessageAttachment,
  WorkspaceMember,
  WorkspaceServer,
  WorkspaceVoicePresenceChannel
} from './core/models/workspace.models';
import { VoiceParticipant, VoiceRoomService } from './core/services/voice-room.service';

type AuthMode = 'login' | 'register';
type ChannelKind = 'text' | 'voice';
type VoicePresenceTone = 'speaking' | 'open' | 'muted';
type MemberPresenceTone = VoicePresenceTone | 'inactive';
type MobilePanel = 'servers' | 'channels' | 'members' | null;

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
  presenceLabel: string;
  isOnline: boolean;
  voiceParticipant: VoiceParticipant | null;
}

const SESSION_STORAGE_KEY = 'tescord.session';
const MESSAGES_PAGE_SIZE = 25;
const MAX_ATTACHMENT_SIZE_BYTES = 50 * 1024 * 1024;
const MEMBERS_POLL_INTERVAL_MS = 15000;
const PRESENCE_ACTIVITY_THROTTLE_MS = 15000;
const PRESENCE_KEEPALIVE_INTERVAL_MS = 30000;
const VOICE_PRESENCE_POLL_INTERVAL_MS = 3000;

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
  private readonly imageAttachmentUrls = signal<Record<string, string>>({});
  private readonly loadingImageAttachmentIds = new Set<string>();
  private readonly handlePresenceActivity = () => this.schedulePresenceHeartbeat();
  private readonly handleVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      this.schedulePresenceHeartbeat(true);
      void this.refreshMembers();
    }
  };
  private voicePresencePollIntervalId: number | null = null;
  private memberPollIntervalId: number | null = null;
  private presenceKeepaliveIntervalId: number | null = null;
  private lastPresenceHeartbeatAt = 0;

  @ViewChild('messageList')
  private messageListRef?: ElementRef<HTMLElement>;

  @ViewChild('attachmentInput')
  private attachmentInputRef?: ElementRef<HTMLInputElement>;

  readonly health = signal<ApiHealthResponse | null>(null);
  readonly healthError = signal<string | null>(null);
  readonly authError = signal<string | null>(null);
  readonly workspaceError = signal<string | null>(null);
  readonly messageError = signal<string | null>(null);
  readonly managementError = signal<string | null>(null);
  readonly managementSuccess = signal<string | null>(null);
  readonly authLoading = signal(false);
  readonly workspaceLoading = signal(false);
  readonly messagesLoading = signal(false);
  readonly messagesLoadingMore = signal(false);
  readonly messageSubmitting = signal(false);
  readonly createGroupLoading = signal(false);
  readonly createChannelLoading = signal(false);
  readonly authMode = signal<AuthMode>('login');

  readonly session = signal<AuthSessionResponse | null>(null);
  readonly currentUser = signal<CurrentUserResponse | null>(null);
  readonly servers = signal<WorkspaceServer[]>([]);
  readonly channels = signal<WorkspaceChannel[]>([]);
  readonly members = signal<WorkspaceMember[]>([]);
  readonly voicePresence = signal<WorkspaceVoicePresenceChannel[]>([]);
  readonly messages = signal<WorkspaceMessage[]>([]);
  readonly messagesHasMore = signal(false);
  readonly messagesCursor = signal<string | null>(null);
  readonly selectedServerId = signal<string | null>(null);
  readonly selectedChannelId = signal<string | null>(null);
  readonly settingsPanelOpen = signal(false);
  readonly createGroupModalOpen = signal(false);
  readonly createChannelModalOpen = signal(false);
  readonly selectedMemberUserId = signal<string | null>(null);
  readonly mobilePanel = signal<MobilePanel>(null);
  readonly messageDraft = signal('');
  readonly pendingFiles = signal<File[]>([]);

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
  readonly isTextChannelSelected = computed(() => this.activeChannel()?.type === 'text');
  readonly hasVoiceConnection = computed(() => this.voiceRoom.isConnected() && this.connectedVoiceChannel() !== null);
  readonly isInActiveVoiceChannel = computed(
    () => this.hasVoiceConnection() && this.activeChannel()?.id === this.connectedVoiceChannel()?.id
  );
  readonly showVoiceDock = computed(() => this.hasVoiceConnection() && !this.isInActiveVoiceChannel());
  readonly canSendMessage = computed(() => {
    if (!this.isTextChannelSelected() || this.messageSubmitting()) {
      return false;
    }

    return this.messageDraft().trim().length > 0 || this.pendingFiles().length > 0;
  });

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

  readonly serverShortcuts = computed<ServerShortcut[]>(() =>
    this.servers().map((server) => ({
      id: server.id,
      label: this.buildServerLabel(server.name),
      name: server.name,
      active: server.id === this.selectedServerId()
    }))
  );

  readonly serverVoicePresenceByChannelId = computed(() => {
    const currentUserId = this.currentUser()?.id ?? null;
    const presenceByChannel = new Map<string, VoiceParticipant[]>();

    for (const channel of this.voicePresence()) {
      presenceByChannel.set(
        channel.channel_id,
        channel.participants.map((participant) => ({
          id: participant.participant_id,
          user_id: participant.user_id,
          nick: participant.nick,
          full_name: participant.full_name,
          muted: participant.muted,
          speaking: false,
          is_self: currentUserId === participant.user_id,
        }))
      );
    }

    return presenceByChannel;
  });

  readonly groupMembers = computed<GroupMemberItem[]>(() => {
    const currentUser = this.currentUser();
    const localVoiceParticipantsByUserId = new Map(
      this.voiceParticipants().map((participant) => [participant.user_id, participant])
    );

    return [...this.members()]
      .map((member) => {
        const voiceParticipant = localVoiceParticipantsByUserId.get(member.user_id) ?? null;

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
          isOnline: member.is_online,
          presenceLabel: this.formatOnlineStatus(member.is_online),
          voiceParticipant
        };
      })
      .sort((left, right) => {
        const leftPresenceWeight = this.getOnlineWeight(left.isOnline);
        const rightPresenceWeight = this.getOnlineWeight(right.isOnline);
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

  readonly mobileWorkspaceSubtitle = computed(() => {
    const activeChannel = this.activeChannel();
    if (activeChannel) {
      return activeChannel.type === 'voice' ? `Голосовой: ${activeChannel.name}` : `# ${activeChannel.name}`;
    }

    return this.activeServer()?.description ?? 'Откройте группу и выберите канал';
  });

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.stopVoicePresencePolling();
      this.stopMemberPolling();
      this.stopPresenceKeepalive();
      this.teardownPresenceActivityTracking();
      this.clearImageAttachmentPreviews();
    });
    this.setupPresenceActivityTracking();
    this.startPresenceKeepalive();
    this.loadHealth();
    this.restoreSession();
  }

  switchAuthMode(mode: AuthMode): void {
    this.authMode.set(mode);
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
    this.closeMobilePanel();
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

    this.closeMobilePanel();
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

    this.closeMobilePanel();
    this.createChannelForm.type = type;
    this.createChannelModalOpen.set(true);
    this.managementError.set(null);
    this.managementSuccess.set(null);
  }

  closeCreateChannelModal(): void {
    this.createChannelModalOpen.set(false);
  }

  openMemberVolume(member: GroupMemberItem): void {
    this.closeMobilePanel();
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

  onMessageDraftChange(value: string): void {
    this.messageDraft.set(value);
    this.schedulePresenceHeartbeat();
  }

  openAttachmentPicker(): void {
    this.attachmentInputRef?.nativeElement.click();
  }

  onAttachmentSelection(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const selectedFiles = Array.from(input?.files ?? []);
    if (!selectedFiles.length) {
      return;
    }

    const validFiles: File[] = [];
    let rejectedFile: File | null = null;

    for (const file of selectedFiles) {
      if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
        rejectedFile = file;
        continue;
      }

      validFiles.push(file);
    }

    if (validFiles.length) {
      this.pendingFiles.set([...this.pendingFiles(), ...validFiles]);
      this.messageError.set(null);
      this.schedulePresenceHeartbeat();
    }

    if (rejectedFile) {
      this.messageError.set(`Файл ${rejectedFile.name} превышает лимит 50 МБ`);
    }

    if (input) {
      input.value = '';
    }
  }

  removePendingFile(index: number): void {
    this.pendingFiles.update((files) => files.filter((_, currentIndex) => currentIndex !== index));
  }

  onMessageListScroll(): void {
    const element = this.messageListRef?.nativeElement;
    if (!element || element.scrollTop > 120) {
      return;
    }

    this.loadOlderMessages();
  }

  submitMessage(): void {
    const token = this.session()?.access_token;
    const activeChannel = this.activeChannel();
    if (!token || !activeChannel || activeChannel.type !== 'text' || !this.canSendMessage()) {
      return;
    }

    const payload = {
      content: this.messageDraft().trim(),
      files: this.pendingFiles()
    };
    const channelId = activeChannel.id;

    this.messageSubmitting.set(true);
    this.messageError.set(null);
    this.schedulePresenceHeartbeat(true);

    this.workspaceApi
      .sendMessage(token, channelId, payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (message) => {
          this.messageSubmitting.set(false);
          this.messageDraft.set('');
          this.pendingFiles.set([]);

          if (this.selectedChannelId() !== channelId) {
            return;
          }

          this.messages.update((messages) => [...messages, message]);
          this.primeImageAttachmentPreviews([message]);
          this.scrollMessagesToBottom();
        },
        error: (error) => {
          this.messageSubmitting.set(false);
          this.messageError.set(this.extractErrorMessage(error, 'Не удалось отправить сообщение'));
        }
      });
  }

  downloadAttachment(attachment: WorkspaceMessageAttachment): void {
    const token = this.session()?.access_token;
    if (!token) {
      return;
    }

    this.workspaceApi
      .downloadAttachment(token, attachment.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          const objectUrl = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = objectUrl;
          anchor.download = attachment.filename;
          anchor.click();
          window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        },
        error: (error) => {
          this.messageError.set(this.extractErrorMessage(error, 'Не удалось скачать файл'));
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

    this.closeMobilePanel();
    this.selectedChannelId.set(connectedVoiceChannel.id);
  }

  toggleMobilePanel(panel: Exclude<MobilePanel, null>): void {
    this.mobilePanel.set(this.mobilePanel() === panel ? null : panel);
  }

  closeMobilePanel(): void {
    this.mobilePanel.set(null);
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
    this.stopMemberPolling();
    this.stopVoicePresencePolling();
    this.voiceRoom.leave();
    this.lastPresenceHeartbeatAt = 0;
    this.session.set(null);
    this.currentUser.set(null);
    this.servers.set([]);
    this.channels.set([]);
    this.members.set([]);
    this.voicePresence.set([]);
    this.resetTextChannelState();
    this.selectedServerId.set(null);
    this.selectedChannelId.set(null);
    this.settingsPanelOpen.set(false);
    this.createGroupModalOpen.set(false);
    this.createChannelModalOpen.set(false);
    this.selectedMemberUserId.set(null);
    this.mobilePanel.set(null);
    this.authError.set(null);
    this.workspaceError.set(null);
    this.messageError.set(null);
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

    this.schedulePresenceHeartbeat(true);
    this.closeMobilePanel();
    this.stopMemberPolling();
    this.stopVoicePresencePolling();
    if (this.hasVoiceConnection()) {
      this.voiceRoom.leave();
    }

    this.resetTextChannelState();
    this.loadServerWorkspace(token, serverId);
  }

  async selectChannel(channel: WorkspaceChannel): Promise<void> {
    this.schedulePresenceHeartbeat();
    this.closeMobilePanel();
    this.selectedChannelId.set(channel.id);
    this.workspaceError.set(null);
    this.messageError.set(null);

    if (channel.type === 'voice') {
      this.resetTextChannelState();
      await this.connectToVoiceChannel(channel);
      return;
    }

    const token = this.session()?.access_token;
    if (token) {
      this.loadMessagesForChannel(token, channel.id);
    }
  }

  voiceParticipantsForChannel(channelId: string): VoiceParticipant[] {
    if (this.connectedVoiceChannelId() === channelId && this.voiceParticipants().length) {
      return this.voiceParticipants();
    }

    return this.serverVoicePresenceByChannelId().get(channelId) ?? [];
  }

  voiceParticipantTone(participant: VoiceParticipant): VoicePresenceTone {
    if (participant.muted) {
      return 'muted';
    }

    return participant.speaking ? 'speaking' : 'open';
  }

  imagePreviewUrl(attachment: WorkspaceMessageAttachment): string | null {
    return this.imageAttachmentUrls()[attachment.id] ?? null;
  }

  isInlineImageAttachment(attachment: WorkspaceMessageAttachment): boolean {
    const mimeType = attachment.mime_type.toLowerCase();
    if (mimeType === 'image/png' || mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
      return true;
    }

    return /\.(png|jpe?g)$/i.test(attachment.filename);
  }

  openImageAttachment(attachment: WorkspaceMessageAttachment): void {
    const previewUrl = this.imagePreviewUrl(attachment);
    if (previewUrl) {
      window.open(previewUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    this.downloadAttachment(attachment);
  }

  private startVoicePresencePolling(): void {
    this.stopVoicePresencePolling(false);
    void this.refreshVoicePresence();
    this.voicePresencePollIntervalId = window.setInterval(() => {
      void this.refreshVoicePresence();
    }, VOICE_PRESENCE_POLL_INTERVAL_MS);
  }

  private startMemberPolling(): void {
    this.stopMemberPolling(false);
    void this.refreshMembers();
    this.memberPollIntervalId = window.setInterval(() => {
      void this.refreshMembers();
    }, MEMBERS_POLL_INTERVAL_MS);
  }

  private stopVoicePresencePolling(clearState = true): void {
    if (this.voicePresencePollIntervalId !== null) {
      window.clearInterval(this.voicePresencePollIntervalId);
      this.voicePresencePollIntervalId = null;
    }

    if (clearState) {
      this.voicePresence.set([]);
    }
  }

  private stopMemberPolling(clearState = true): void {
    if (this.memberPollIntervalId !== null) {
      window.clearInterval(this.memberPollIntervalId);
      this.memberPollIntervalId = null;
    }

    if (clearState) {
      this.members.set([]);
    }
  }

  private startPresenceKeepalive(): void {
    if (typeof window === 'undefined') {
      return;
    }

    this.stopPresenceKeepalive();
    this.presenceKeepaliveIntervalId = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }

      this.schedulePresenceHeartbeat(true);
    }, PRESENCE_KEEPALIVE_INTERVAL_MS);
  }

  private stopPresenceKeepalive(): void {
    if (this.presenceKeepaliveIntervalId !== null) {
      window.clearInterval(this.presenceKeepaliveIntervalId);
      this.presenceKeepaliveIntervalId = null;
    }
  }

  private setupPresenceActivityTracking(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    window.addEventListener('mousemove', this.handlePresenceActivity, { passive: true });
    window.addEventListener('pointerdown', this.handlePresenceActivity, { passive: true });
    window.addEventListener('touchstart', this.handlePresenceActivity, { passive: true });
    window.addEventListener('keydown', this.handlePresenceActivity);
    window.addEventListener('focus', this.handlePresenceActivity);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  private teardownPresenceActivityTracking(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    window.removeEventListener('mousemove', this.handlePresenceActivity);
    window.removeEventListener('pointerdown', this.handlePresenceActivity);
    window.removeEventListener('touchstart', this.handlePresenceActivity);
    window.removeEventListener('keydown', this.handlePresenceActivity);
    window.removeEventListener('focus', this.handlePresenceActivity);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
  }

  private schedulePresenceHeartbeat(force = false): void {
    const token = this.session()?.access_token;
    if (!token) {
      return;
    }

    if (!force && typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return;
    }

    const now = Date.now();
    if (!force && now - this.lastPresenceHeartbeatAt < PRESENCE_ACTIVITY_THROTTLE_MS) {
      return;
    }

    this.lastPresenceHeartbeatAt = now;
    this.workspaceApi
      .sendPresenceHeartbeat(token)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          const currentUserId = this.currentUser()?.id;
          if (!currentUserId) {
            return;
          }

          this.members.update((members) =>
            members.map((member) =>
              member.user_id === currentUserId
                ? {
                    ...member,
                    is_online: true
                  }
                : member
            )
          );
        },
        error: () => {
          this.lastPresenceHeartbeatAt = 0;
        }
      });
  }

  private async refreshMembers(): Promise<void> {
    const token = this.session()?.access_token;
    const serverId = this.selectedServerId();
    if (!token || !serverId) {
      this.members.set([]);
      return;
    }

    this.workspaceApi
      .getMembers(token, serverId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (members) => {
          if (this.selectedServerId() !== serverId) {
            return;
          }

          this.members.set(members);
        },
        error: () => {
          if (this.selectedServerId() !== serverId) {
            return;
          }

          this.members.set([]);
        }
      });
  }

  private async refreshVoicePresence(): Promise<void> {
    const token = this.session()?.access_token;
    const serverId = this.selectedServerId();
    if (!token || !serverId) {
      this.voicePresence.set([]);
      return;
    }

    this.workspaceApi
      .getVoicePresence(token, serverId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (voicePresence) => {
          if (this.selectedServerId() !== serverId) {
            return;
          }

          this.voicePresence.set(voicePresence);
        },
        error: () => {
          if (this.selectedServerId() !== serverId) {
            return;
          }

          this.voicePresence.set([]);
        }
      });
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
      this.schedulePresenceHeartbeat(true);
      this.bootstrapWorkspace(session.access_token);
    } catch {
      this.clearStoredSession();
    }
  }

  private handleAuthenticatedSession(session: AuthSessionResponse): void {
    this.session.set(session);
    this.currentUser.set(session.user);
    this.persistSession(session);
    this.schedulePresenceHeartbeat(true);
    this.authLoading.set(false);
    this.authError.set(null);
    this.managementError.set(null);
    this.managementSuccess.set(null);
    this.bootstrapWorkspace(session.access_token);
  }

  private bootstrapWorkspace(token: string): void {
    this.workspaceLoading.set(true);
    this.workspaceError.set(null);
    this.closeMobilePanel();
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
          this.schedulePresenceHeartbeat(true);

          if (!servers.length) {
            this.stopMemberPolling();
            this.stopVoicePresencePolling();
            this.resetTextChannelState();
            this.selectedServerId.set(null);
            this.selectedChannelId.set(null);
            this.channels.set([]);
            this.members.set([]);
            this.voicePresence.set([]);
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
          this.stopMemberPolling();
          this.stopVoicePresencePolling();
          this.workspaceLoading.set(false);
          this.voiceRoom.leave();
          this.session.set(null);
          this.currentUser.set(null);
          this.servers.set([]);
          this.channels.set([]);
          this.members.set([]);
          this.voicePresence.set([]);
          this.resetTextChannelState();
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

    this.stopMemberPolling(false);
    this.stopVoicePresencePolling();
    this.workspaceLoading.set(true);
    this.workspaceError.set(null);
    this.managementError.set(null);
    this.managementSuccess.set(null);
    this.selectedServerId.set(serverId);
    this.selectedChannelId.set(null);
    this.selectedMemberUserId.set(null);
    this.voicePresence.set([]);
    this.resetTextChannelState();

    forkJoin({
      channels: this.workspaceApi.getChannels(token, serverId),
      members: this.workspaceApi.getMembers(token, serverId),
      voicePresence: this.workspaceApi.getVoicePresence(token, serverId)
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ channels, members, voicePresence }) => {
          this.channels.set(channels);
          this.members.set(members);
          this.voicePresence.set(voicePresence);

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
          const selectedChannel = channels.find((channel) => channel.id === nextSelectedChannelId) ?? null;
          if (selectedChannel?.type === 'text') {
            this.loadMessagesForChannel(token, selectedChannel.id);
          }
          this.startMemberPolling();
          this.startVoicePresencePolling();
          this.workspaceLoading.set(false);
        },
        error: (error) => {
          this.stopMemberPolling();
          this.stopVoicePresencePolling();
          this.channels.set([]);
          this.members.set([]);
          this.voicePresence.set([]);
          this.resetTextChannelState();
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

  private loadMessagesForChannel(token: string, channelId: string, before?: string | null): void {
    const isLoadingMore = Boolean(before);
    const listElement = this.messageListRef?.nativeElement;
    const previousScrollHeight = listElement?.scrollHeight ?? 0;
    const previousScrollTop = listElement?.scrollTop ?? 0;

    if (isLoadingMore) {
      if (this.messagesLoadingMore()) {
        return;
      }

      this.messagesLoadingMore.set(true);
    } else {
      this.messagesLoading.set(true);
      this.messages.set([]);
      this.clearImageAttachmentPreviews();
      this.messagesHasMore.set(false);
      this.messagesCursor.set(null);
      this.messageError.set(null);
    }

    this.workspaceApi
      .getMessages(token, channelId, MESSAGES_PAGE_SIZE, before)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page) => {
          if (this.selectedChannelId() !== channelId) {
            return;
          }

          if (isLoadingMore) {
            this.messages.update((messages) => [...page.items, ...messages]);
          } else {
            this.messages.set(page.items);
          }
          this.primeImageAttachmentPreviews(page.items);

          this.messagesHasMore.set(page.has_more);
          this.messagesCursor.set(page.next_before);
          this.messagesLoading.set(false);
          this.messagesLoadingMore.set(false);

          if (isLoadingMore) {
            this.restoreMessageScrollPosition(previousScrollHeight, previousScrollTop);
          } else {
            this.scrollMessagesToBottom();
          }
        },
        error: (error) => {
          this.messagesLoading.set(false);
          this.messagesLoadingMore.set(false);
          this.messageError.set(this.extractErrorMessage(error, 'Не удалось загрузить сообщения'));
        }
      });
  }

  private loadOlderMessages(): void {
    const token = this.session()?.access_token;
    const activeChannel = this.activeChannel();
    if (
      !token
      || !activeChannel
      || activeChannel.type !== 'text'
      || !this.messagesHasMore()
      || !this.messagesCursor()
      || this.messagesLoading()
      || this.messagesLoadingMore()
    ) {
      return;
    }

    this.loadMessagesForChannel(token, activeChannel.id, this.messagesCursor());
  }

  private resetTextChannelState(): void {
    this.messages.set([]);
    this.clearImageAttachmentPreviews();
    this.messagesHasMore.set(false);
    this.messagesCursor.set(null);
    this.messagesLoading.set(false);
    this.messagesLoadingMore.set(false);
    this.messageSubmitting.set(false);
    this.messageDraft.set('');
    this.pendingFiles.set([]);
    this.messageError.set(null);
  }

  private scrollMessagesToBottom(): void {
    requestAnimationFrame(() => {
      const element = this.messageListRef?.nativeElement;
      if (!element) {
        return;
      }

      element.scrollTop = element.scrollHeight;
    });
  }

  private restoreMessageScrollPosition(previousScrollHeight: number, previousScrollTop: number): void {
    requestAnimationFrame(() => {
      const element = this.messageListRef?.nativeElement;
      if (!element) {
        return;
      }

      element.scrollTop = element.scrollHeight - previousScrollHeight + previousScrollTop;
    });
  }

  private primeImageAttachmentPreviews(messages: WorkspaceMessage[]): void {
    const token = this.session()?.access_token;
    if (!token) {
      return;
    }

    for (const message of messages) {
      for (const attachment of message.attachments) {
        if (!this.isInlineImageAttachment(attachment)) {
          continue;
        }

        if (this.imageAttachmentUrls()[attachment.id] || this.loadingImageAttachmentIds.has(attachment.id)) {
          continue;
        }

        this.loadingImageAttachmentIds.add(attachment.id);
        this.workspaceApi
          .downloadAttachment(token, attachment.id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: (blob) => {
              this.loadingImageAttachmentIds.delete(attachment.id);
              const objectUrl = URL.createObjectURL(blob);
              const attachmentStillVisible = this.messages().some((message) =>
                message.attachments.some((messageAttachment) => messageAttachment.id === attachment.id)
              );
              if (!attachmentStillVisible) {
                URL.revokeObjectURL(objectUrl);
                return;
              }

              this.imageAttachmentUrls.update((currentUrls) => ({
                ...currentUrls,
                [attachment.id]: objectUrl
              }));
            },
            error: () => {
              this.loadingImageAttachmentIds.delete(attachment.id);
            }
          });
      }
    }
  }

  private clearImageAttachmentPreviews(): void {
    const currentUrls = this.imageAttachmentUrls();
    for (const objectUrl of Object.values(currentUrls)) {
      URL.revokeObjectURL(objectUrl);
    }

    this.loadingImageAttachmentIds.clear();
    this.imageAttachmentUrls.set({});
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

  private formatVoiceActivityLabel(presence: MemberPresenceTone, channelName: string | null): string {
    if (!channelName) {
      return 'Не активен в каналах';
    }

    if (presence === 'speaking') {
      return `Говорит в ${channelName}`;
    }

    return `В канале ${channelName}`;
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

  private formatOnlineStatus(isOnline: boolean): string {
    return isOnline ? 'Онлайн' : 'Офлайн';
  }

  private getOnlineWeight(isOnline: boolean): number {
    return isOnline ? 0 : 1;
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

  formatMessageTime(value: string): string {
    const timestamp = Date.parse(value);
    if (Number.isNaN(timestamp)) {
      return value;
    }

    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(timestamp));
  }

  formatFileSize(sizeBytes: number): string {
    if (sizeBytes >= 1024 * 1024) {
      return `${(sizeBytes / (1024 * 1024)).toFixed(1)} МБ`;
    }

    if (sizeBytes >= 1024) {
      return `${Math.round(sizeBytes / 1024)} КБ`;
    }

    return `${sizeBytes} Б`;
  }

  private toRangeValue(value: number | string): number {
    const normalized = typeof value === 'number' ? value : Number.parseFloat(value);
    if (Number.isNaN(normalized)) {
      return 0;
    }

    return normalized;
  }
}
