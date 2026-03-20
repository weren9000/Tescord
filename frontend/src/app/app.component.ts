import { HttpErrorResponse } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { Component, DestroyRef, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { EMPTY, Subject, catchError, exhaustMap, finalize, forkJoin, mergeMap, tap } from 'rxjs';

import { AuthApiService } from './core/api/auth-api.service';
import { SystemApiService } from './core/api/system-api.service';
import { WorkspaceApiService } from './core/api/workspace-api.service';
import {
  AppEventsMessage,
  AppChannelsUpdatedEvent,
  AppMessageCreatedEvent,
  AppMessageReactionsUpdatedEvent,
  AppMembersUpdatedEvent,
  AppPresenceUpdatedEvent,
  AppServerChangedEvent,
  AppVoicePresenceUpdatedEvent,
  AppVoiceRequestResolvedEvent
} from './core/models/app-events.models';
import { AuthLoginRequest, AuthRegisterRequest, AuthSessionResponse } from './core/models/auth.models';
import { ApiHealthResponse } from './core/models/system.models';
import {
  CreateWorkspaceChannelRequest,
  CreateWorkspaceServerRequest,
  CurrentUserResponse,
  VoiceAdminChannel,
  VoiceAdminUser,
  VoiceChannelAccessEntry,
  VoiceJoinRequestCreateResponse,
  VoiceJoinRequestSummary,
  WorkspaceChannel,
  WorkspaceMessage,
  WorkspaceMessageAttachment,
  WorkspaceMessageReaction,
  WorkspaceMessageReactionCode,
  WorkspaceMessageReactionsSnapshot,
  WorkspaceMember,
  WorkspaceServer,
  WorkspaceVoicePresenceChannel
} from './core/models/workspace.models';
import { AppEventsService } from './core/services/app-events.service';
import { VoiceParticipant, VoiceRoomService } from './core/services/voice-room.service';

type AuthMode = 'login' | 'register';
type ChannelKind = 'text' | 'voice';
type VoicePresenceTone = 'speaking' | 'open' | 'muted' | 'blocked';
type MemberPresenceTone = VoicePresenceTone | 'inactive';
type MobilePanel = 'servers' | 'channels' | 'members' | null;
type VoiceAccessRole = 'owner' | 'resident' | 'stranger';
type VoiceWorkspaceTab = 'chat' | 'channel';

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
  iconUrl: string | null;
  active: boolean;
}

interface ServerIconOption {
  asset: string;
  label: string;
  url: string;
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

interface VoiceAdminAssignmentFormModel {
  userId: string;
  role: VoiceAccessRole;
}

interface PendingVoiceJoinState {
  requestId: string;
  channelId: string;
  channelName: string;
  detail: string;
}

interface BlockedVoiceJoinState {
  channelId: string;
  channelName: string;
  detail: string;
  blockedUntil: string | null;
  retryAfterSeconds: number | null;
}

interface VoiceAdminAccessMutation {
  token: string;
  channelId: string;
  userId: string;
  role: VoiceAccessRole | null;
  successMessage: string;
  errorMessage: string;
  resetAssignmentUserId?: boolean;
}

interface CreateGroupTrigger {
  token: string;
  payload: CreateWorkspaceServerRequest;
}

interface CreateChannelTrigger {
  token: string;
  serverId: string;
  payload: CreateWorkspaceChannelRequest;
}

interface DeleteChannelTrigger {
  token: string;
  serverId: string;
  channel: WorkspaceChannel;
}

interface SendMessageTrigger {
  token: string;
  channelId: string;
  payload: {
    content: string;
    files: File[];
  };
}

interface DownloadAttachmentTrigger {
  token: string;
  attachment: WorkspaceMessageAttachment;
}

interface LoadAttachmentPreviewTrigger {
  token: string;
  attachment: WorkspaceMessageAttachment;
  openImageAfterLoad?: boolean;
  reportErrors?: boolean;
}

interface VoiceMemberRoleTrigger {
  token: string;
  channelId: string;
  member: GroupMemberItem;
  role: Extract<VoiceAccessRole, 'resident' | 'stranger'>;
}

interface KickVoiceMemberTrigger {
  token: string;
  channelId: string;
  member: GroupMemberItem;
}

interface VoiceMemberOwnerMuteTrigger {
  token: string;
  channelId: string;
  member: GroupMemberItem;
  nextOwnerMuted: boolean;
}

interface ResolveVoiceRequestTrigger {
  token: string;
  request: VoiceJoinRequestSummary;
  action: 'allow' | 'resident' | 'reject';
}

interface VoiceJoinRequestTrigger {
  token: string;
  channel: WorkspaceChannel;
}

interface PendingServerSwitchState {
  serverId: string;
  fromServerName: string;
  toServerName: string;
}

interface UpdateServerIconTrigger {
  token: string;
  serverId: string;
  iconAsset: string;
  iconLabel: string;
}

interface MessageReactionOption {
  code: WorkspaceMessageReactionCode;
  emoji: string;
  label: string;
}

interface MessageReactionTrigger {
  token: string;
  message: WorkspaceMessage;
  reactionCode: WorkspaceMessageReactionCode;
  remove: boolean;
}

const SESSION_STORAGE_KEY = 'tescord.session';
const MESSAGES_PAGE_SIZE = 25;
const MAX_ATTACHMENT_SIZE_BYTES = 50 * 1024 * 1024;
const MAX_INLINE_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const PRESENCE_ACTIVITY_THROTTLE_MS = 30000;
const PRESENCE_KEEPALIVE_INTERVAL_MS = 45000;
const MESSAGE_REACTION_OPTIONS: readonly MessageReactionOption[] = [
  { code: 'heart', emoji: '❤️', label: 'Сердечко' },
  { code: 'like', emoji: '👍', label: 'Лайк' },
  { code: 'dislike', emoji: '👎', label: 'Дизлайк' },
  { code: 'angry', emoji: '😡', label: 'Гнев' },
  { code: 'cry', emoji: '😢', label: 'Плачет' },
  { code: 'confused', emoji: '😕', label: 'Недоумение' },
  { code: 'displeased', emoji: '😒', label: 'Недовольство' },
  { code: 'laugh', emoji: '😂', label: 'Смех' },
  { code: 'fire', emoji: '🔥', label: 'Огонь' },
  { code: 'wow', emoji: '😮', label: 'Удивление' },
];
const SERVER_ICON_ASSETS = [
  'Общая.png',
  'Ан-Зайлиль.png',
  'Валенвуд.png',
  'Венценосные.png',
  'Дом Даггерфорльский.png',
  'Дом Каменный кулак.png',
  'Дом Меркатто.png',
  'Дом Редоран.png',
  'Дом Тельванни.png',
  'Дом Титус.png',
  'Дом Фроуд.png',
  'Дракон.png',
  'Империя.png',
  'Клан Диренни.png',
  'Матиссен.png',
  'Некроманты.png',
  'Орден Араксии.png',
  'Орден Вирвека.png',
  'Орден Красной горы.png',
  'Орден Мелора.png',
  'Орден Талора.png',
  'Предшественники.png',
  'Разбойники.png',
  'Саммерсет.png',
  'Северное племя.png',
  'Скайрим.png',
  'Хай Рок.png',
  'Хаммерфелл.png',
  'Хист.png',
  'Чернотопье.png',
  'Эльсвеер.png',
  'Южное племя.png'
] as const;
const SERVER_ICON_URL_BY_ASSET: Record<(typeof SERVER_ICON_ASSETS)[number], string> = {
  'Общая.png': '/assets/group-icons/icon-01.png',
  'Ан-Зайлиль.png': '/assets/group-icons/icon-02.png',
  'Валенвуд.png': '/assets/group-icons/icon-03.png',
  'Венценосные.png': '/assets/group-icons/icon-04.png',
  'Дом Даггерфорльский.png': '/assets/group-icons/icon-05.png',
  'Дом Каменный кулак.png': '/assets/group-icons/icon-06.png',
  'Дом Меркатто.png': '/assets/group-icons/icon-07.png',
  'Дом Редоран.png': '/assets/group-icons/icon-08.png',
  'Дом Тельванни.png': '/assets/group-icons/icon-09.png',
  'Дом Титус.png': '/assets/group-icons/icon-10.png',
  'Дом Фроуд.png': '/assets/group-icons/icon-11.png',
  'Дракон.png': '/assets/group-icons/icon-12.png',
  'Империя.png': '/assets/group-icons/icon-13.png',
  'Клан Диренни.png': '/assets/group-icons/icon-14.png',
  'Матиссен.png': '/assets/group-icons/icon-15.png',
  'Некроманты.png': '/assets/group-icons/icon-16.png',
  'Орден Араксии.png': '/assets/group-icons/icon-17.png',
  'Орден Вирвека.png': '/assets/group-icons/icon-18.png',
  'Орден Красной горы.png': '/assets/group-icons/icon-19.png',
  'Орден Мелора.png': '/assets/group-icons/icon-20.png',
  'Орден Талора.png': '/assets/group-icons/icon-21.png',
  'Предшественники.png': '/assets/group-icons/icon-22.png',
  'Разбойники.png': '/assets/group-icons/icon-23.png',
  'Саммерсет.png': '/assets/group-icons/icon-24.png',
  'Северное племя.png': '/assets/group-icons/icon-25.png',
  'Скайрим.png': '/assets/group-icons/icon-26.png',
  'Хай Рок.png': '/assets/group-icons/icon-27.png',
  'Хаммерфелл.png': '/assets/group-icons/icon-28.png',
  'Хист.png': '/assets/group-icons/icon-29.png',
  'Чернотопье.png': '/assets/group-icons/icon-30.png',
  'Эльсвеер.png': '/assets/group-icons/icon-31.png',
  'Южное племя.png': '/assets/group-icons/icon-32.png'
};
const DEFAULT_SERVER_ICON_ASSET_BY_NAME: Record<string, string> = {
  'Общая': 'Общая.png',
  'Империя': 'Империя.png',
  'Саммерсет': 'Саммерсет.png',
  'Хай Рок': 'Хай Рок.png',
  'Валенвуд': 'Валенвуд.png',
  'Хаммерфелл': 'Хаммерфелл.png',
  'Скайрим': 'Скайрим.png',
  'Тельваннис': 'Дом Тельванни.png',
  'Солтсхейм': 'Дракон.png',
  'Эльсвеер': 'Эльсвеер.png'
};

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
  private readonly appEvents = inject(AppEventsService);
  private readonly voiceRoom = inject(VoiceRoomService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly attachmentPreviewUrls = signal<Record<string, string>>({});
  private readonly loadingAttachmentPreviewIds = new Set<string>();
  private readonly handlePresenceActivity = () => this.schedulePresenceHeartbeat();
  private readonly handleVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      this.schedulePresenceHeartbeat(true);
    }
  };
  private voicePresencePollIntervalId: number | null = null;
  private memberPollIntervalId: number | null = null;
  private messageAutoRefreshIntervalId: number | null = null;
  private presenceKeepaliveIntervalId: number | null = null;
  private voiceJoinRequestPollIntervalId: number | null = null;
  private voiceJoinInboxPollIntervalId: number | null = null;
  private lastPresenceHeartbeatAt = 0;
  private readonly loginSubmit$ = new Subject<AuthLoginRequest>();
  private readonly registrationSubmit$ = new Subject<AuthRegisterRequest>();
  private readonly voiceAdminAccessMutation$ = new Subject<VoiceAdminAccessMutation>();
  private readonly createGroupSubmit$ = new Subject<CreateGroupTrigger>();
  private readonly createChannelSubmit$ = new Subject<CreateChannelTrigger>();
  private readonly deleteChannelTrigger$ = new Subject<DeleteChannelTrigger>();
  private readonly sendMessageTrigger$ = new Subject<SendMessageTrigger>();
  private readonly downloadAttachmentTrigger$ = new Subject<DownloadAttachmentTrigger>();
  private readonly loadAttachmentPreviewTrigger$ = new Subject<LoadAttachmentPreviewTrigger>();
  private readonly voiceMemberRoleTrigger$ = new Subject<VoiceMemberRoleTrigger>();
  private readonly kickVoiceMemberTrigger$ = new Subject<KickVoiceMemberTrigger>();
  private readonly voiceMemberOwnerMuteTrigger$ = new Subject<VoiceMemberOwnerMuteTrigger>();
  private readonly resolveVoiceRequestTrigger$ = new Subject<ResolveVoiceRequestTrigger>();
  private readonly voiceJoinRequestTrigger$ = new Subject<VoiceJoinRequestTrigger>();
  private readonly updateServerIconTrigger$ = new Subject<UpdateServerIconTrigger>();
  private readonly messageReactionTrigger$ = new Subject<MessageReactionTrigger>();
  private readonly pendingMessageReactionKeys = new Set<string>();

  @ViewChild('messageList')
  private messageListRef?: ElementRef<HTMLElement>;

  @ViewChild('attachmentInput')
  private attachmentInputRef?: ElementRef<HTMLInputElement>;

  @ViewChild('messageTextarea')
  private messageTextareaRef?: ElementRef<HTMLTextAreaElement>;

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
  readonly deletingChannelId = signal<string | null>(null);
  readonly authMode = signal<AuthMode>('login');

  readonly session = signal<AuthSessionResponse | null>(null);
  readonly currentUser = signal<CurrentUserResponse | null>(null);
  readonly servers = signal<WorkspaceServer[]>([]);
  readonly channels = signal<WorkspaceChannel[]>([]);
  readonly members = signal<WorkspaceMember[]>([]);
  readonly voicePresence = signal<WorkspaceVoicePresenceChannel[]>([]);
  readonly messages = signal<WorkspaceMessage[]>([]);
  readonly messageReactionOptions = MESSAGE_REACTION_OPTIONS;
  readonly messagesHasMore = signal(false);
  readonly messagesCursor = signal<string | null>(null);
  readonly selectedServerId = signal<string | null>(null);
  readonly selectedChannelId = signal<string | null>(null);
  readonly settingsPanelOpen = signal(false);
  readonly voiceAdminPanelOpen = signal(false);
  readonly createGroupModalOpen = signal(false);
  readonly createChannelModalOpen = signal(false);
  readonly serverIconModalOpen = signal(false);
  readonly selectedMemberUserId = signal<string | null>(null);
  readonly selectedVoiceMemberChannelId = signal<string | null>(null);
  readonly openedImageAttachmentId = signal<string | null>(null);
  readonly openedMessageReactionPickerId = signal<string | null>(null);
  readonly mobilePanel = signal<MobilePanel>(null);
  readonly voiceWorkspaceTab = signal<VoiceWorkspaceTab>('chat');
  readonly messageDraft = signal('');
  readonly pendingFiles = signal<File[]>([]);
  readonly voiceAdminChannelsLoading = signal(false);
  readonly voiceAdminUsersLoading = signal(false);
  readonly voiceAdminAccessLoading = signal(false);
  readonly voiceAdminSaving = signal(false);
  readonly voiceOwnerActionLoading = signal(false);
  readonly serverIconSaving = signal(false);
  readonly pendingVoiceJoin = signal<PendingVoiceJoinState | null>(null);
  readonly blockedVoiceJoinNotice = signal<BlockedVoiceJoinState | null>(null);
  readonly ownerVoiceRequests = signal<VoiceJoinRequestSummary[]>([]);
  readonly activeOwnerRequestId = signal<string | null>(null);
  readonly ownerVoiceRequestModalOpen = signal(false);
  readonly voiceAdminChannels = signal<VoiceAdminChannel[]>([]);
  readonly voiceAdminUsers = signal<VoiceAdminUser[]>([]);
  readonly voiceAdminSelectedChannelId = signal<string | null>(null);
  readonly voiceAccessEntriesByChannelId = signal<Record<string, VoiceChannelAccessEntry[]>>({});
  readonly pendingServerSwitch = signal<PendingServerSwitchState | null>(null);
  readonly serverIconOptions: ServerIconOption[] = SERVER_ICON_ASSETS.map((asset) => ({
    asset,
    label: asset.replace(/\.png$/i, ''),
    url: this.buildServerIconAssetUrl(asset)
  }));

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

  readonly voiceAdminAssignmentForm: VoiceAdminAssignmentFormModel = {
    userId: '',
    role: 'resident'
  };

  readonly isAuthenticated = computed(() => this.session() !== null);
  readonly isAdmin = computed(() => this.currentUser()?.is_admin === true);
  readonly voiceParticipants = this.voiceRoom.participants;
  readonly voiceError = this.voiceRoom.error;
  readonly voiceState = this.voiceRoom.state;
  readonly voiceMuted = this.voiceRoom.localMuted;
  readonly voiceOwnerMuted = this.voiceRoom.ownerMuted;
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
  readonly tavernVoiceChannel = computed(
    () => this.voiceChannels().find((channel) => this.isTavernChannel(channel)) ?? null
  );
  readonly regularVoiceChannels = computed(() =>
    this.voiceChannels().filter((channel) => !this.isTavernChannel(channel))
  );

  readonly connectedVoiceChannel = computed(() => {
    const connectedChannelId = this.voiceRoom.activeChannelId();
    return this.channels().find((channel) => channel.id === connectedChannelId) ?? null;
  });

  readonly connectedVoiceChannelId = computed(() => this.connectedVoiceChannel()?.id ?? null);
  readonly isVoiceChannelSelected = computed(() => this.activeChannel()?.type === 'voice');
  readonly isTextChannelSelected = computed(() => this.activeChannel()?.type === 'text');
  readonly canUseActiveChannelChat = computed(() => {
    const activeChannel = this.activeChannel();
    return activeChannel?.type === 'text' || activeChannel?.type === 'voice';
  });
  readonly hasVoiceConnection = computed(() => this.voiceRoom.isConnected() && this.connectedVoiceChannel() !== null);
  readonly isInActiveVoiceChannel = computed(
    () => this.hasVoiceConnection() && this.activeChannel()?.id === this.connectedVoiceChannel()?.id
  );
  readonly showVoiceDock = computed(
    () => this.hasVoiceConnection() && !this.isInActiveVoiceChannel() && !this.isVoiceChannelSelected()
  );
  readonly showVoiceWorkspaceShell = computed(() => this.isVoiceChannelSelected());
  readonly showVoiceWorkspaceChat = computed(
    () => this.canUseActiveChannelChat() && (!this.isVoiceChannelSelected() || this.voiceWorkspaceTab() === 'chat')
  );
  readonly showVoiceWorkspaceChannel = computed(
    () => this.isVoiceChannelSelected() && this.voiceWorkspaceTab() === 'channel'
  );
  readonly activeVoiceRoster = computed(() => {
    const activeChannelId = this.activeChannel()?.id;
    if (!activeChannelId) {
      return [];
    }

    return this.voiceParticipantsForChannel(activeChannelId);
  });
  readonly activeVoiceRosterCount = computed(() => this.activeVoiceRoster().length);
  readonly workspaceOverlayVisible = computed(
    () => this.showVoiceWorkspaceChat() && (this.workspaceLoading() || this.messagesLoading())
  );
  readonly workspaceOverlayLabel = computed(() => {
    if (this.workspaceLoading()) {
      return 'Загружаем рабочую область';
    }

    if (this.showVoiceWorkspaceChat() && this.messagesLoading()) {
      return 'Загружаем сообщения';
    }

    return '';
  });
  readonly canSendMessage = computed(() => {
    if (!this.canUseActiveChannelChat() || this.messageSubmitting()) {
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

  readonly canEditActiveServerIcon = computed(() => this.canManageActiveGroup() && !this.isCompactVoiceWorkspaceViewport());
  readonly activeServerIconAsset = computed(() => {
    const activeServer = this.activeServer();
    if (!activeServer) {
      return null;
    }

    return this.resolveServerIconAsset(activeServer);
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
      if (this.voiceOwnerMuted()) {
        return 'Вы в канале, микрофон заблокирован владельцем';
      }

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

    if (this.voiceOwnerMuted()) {
      return 'Голос работает в фоне, микрофон заблокирован владельцем';
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
      iconUrl: this.serverIconUrl(server),
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
          owner_muted: participant.owner_muted,
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

  readonly voiceAdminSelectedChannel = computed(() => {
    const selectedChannelId = this.voiceAdminSelectedChannelId();
    return this.voiceAdminChannels().find((channel) => channel.channel_id === selectedChannelId) ?? null;
  });

  readonly voiceAdminSelectedChannelAccess = computed(() => {
    const selectedChannelId = this.voiceAdminSelectedChannelId();
    if (!selectedChannelId) {
      return [];
    }

    return this.voiceAccessEntriesByChannelId()[selectedChannelId] ?? [];
  });

  readonly activeOwnerRequest = computed(() => {
    if (!this.ownerVoiceRequestModalOpen()) {
      return null;
    }

    const requests = this.ownerVoiceRequests();
    const activeRequestId = this.activeOwnerRequestId();
    return requests.find((request) => request.id === activeRequestId) ?? requests[0] ?? null;
  });

  readonly selectedVoiceMemberAccessEntry = computed(() => {
    const userId = this.selectedMemberUserId();
    const channelId = this.selectedVoiceMemberChannelId();
    if (!userId || !channelId) {
      return null;
    }

    const entries = this.voiceAccessEntriesByChannelId()[channelId] ?? [];
    return entries.find((entry) => entry.user_id === userId) ?? null;
  });

  readonly selectedVoiceManagerAccessEntry = computed(() => {
    const currentUserId = this.currentUser()?.id;
    const channelId = this.selectedVoiceMemberChannelId();
    if (!currentUserId || !channelId) {
      return null;
    }

    const entries = this.voiceAccessEntriesByChannelId()[channelId] ?? [];
    return entries.find((entry) => entry.user_id === currentUserId) ?? null;
  });

  readonly canManageSelectedVoiceMember = computed(() => {
    const member = this.selectedMember();
    if (!member || member.isSelf) {
      return false;
    }

    if (this.currentUser()?.is_admin) {
      return true;
    }

    return this.selectedVoiceManagerAccessEntry()?.role === 'owner';
  });

  readonly selectedVoiceMemberRoleLabel = computed(() => {
    const role = this.selectedVoiceMemberAccessEntry()?.role;
    if (role === 'owner') {
      return 'владелец';
    }

    if (role === 'resident') {
      return 'житель';
    }

    if (role === 'stranger') {
      return 'чужак';
    }

    return 'нет доступа';
  });

  readonly selectedVoiceMemberOwnerMuted = computed(() => {
    const accessEntry = this.selectedVoiceMemberAccessEntry();
    if (accessEntry) {
      return accessEntry.owner_muted;
    }

    return this.selectedMember()?.voiceParticipant?.owner_muted ?? false;
  });

  readonly canToggleSelectedVoiceMemberOwnerMute = computed(() => {
    if (!this.canManageSelectedVoiceMember()) {
      return false;
    }

    return this.selectedVoiceMemberAccessEntry()?.role !== 'owner';
  });

  readonly openedImageAttachment = computed(() => {
    const attachmentId = this.openedImageAttachmentId();
    if (!attachmentId) {
      return null;
    }

    for (const message of this.messages()) {
      const attachment = message.attachments.find((item) => item.id === attachmentId);
      if (attachment) {
        return attachment;
      }
    }

    return null;
  });

  readonly openedImageAttachmentUrl = computed(() => {
    const attachment = this.openedImageAttachment();
    return attachment ? this.attachmentPreviewUrl(attachment) : null;
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
      if (activeChannel.type === 'voice') {
        return this.voiceWorkspaceTab() === 'channel' ? activeChannel.name : `Чат · ${activeChannel.name}`;
      }

      return `# ${activeChannel.name}`;
    }

    return this.activeServer()?.description ?? 'Откройте группу и выберите канал';
  });

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.appEvents.stop();
      this.stopVoicePresencePolling();
      this.stopMemberPolling();
      this.stopMessageAutoRefreshPolling();
      this.stopVoiceJoinRequestPolling();
      this.stopVoiceJoinInboxPolling();
      this.stopPresenceKeepalive();
      this.teardownPresenceActivityTracking();
      this.clearAttachmentPreviews();
    });
    this.bindActionPipelines();
    this.appEvents.events$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => void this.handleAppEvent(event));
    this.setupPresenceActivityTracking();
    this.startPresenceKeepalive();
    this.loadHealth();
    this.restoreSession();
  }

  private bindActionPipelines(): void {
    this.bindAuthPipelines();
    this.bindVoiceAdminPipelines();
    this.bindWorkspaceMutationPipelines();
    this.bindMessagePipelines();
    this.bindVoiceOwnershipPipelines();
    this.bindVoiceJoinRequestPipeline();
    this.bindServerIconPipeline();
  }

  private bindAuthPipelines(): void {
    this.loginSubmit$
      .pipe(
        exhaustMap((payload) =>
          this.authApi.login(payload).pipe(
            tap((session) => this.handleAuthenticatedSession(session)),
            catchError((error) => {
              this.authError.set(this.extractErrorMessage(error, 'Не удалось выполнить вход'));
              return EMPTY;
            }),
            finalize(() => {
              this.authLoading.set(false);
            })
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    this.registrationSubmit$
      .pipe(
        exhaustMap((payload) =>
          this.authApi.register(payload).pipe(
            tap((session) => this.handleAuthenticatedSession(session)),
            catchError((error) => {
              this.authError.set(this.extractErrorMessage(error, 'Не удалось зарегистрироваться'));
              return EMPTY;
            }),
            finalize(() => {
              this.authLoading.set(false);
            })
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private bindVoiceAdminPipelines(): void {
    this.voiceAdminAccessMutation$
      .pipe(
        exhaustMap((mutation) =>
          this.workspaceApi.updateVoiceChannelAccess(mutation.token, mutation.channelId, mutation.userId, mutation.role).pipe(
            tap((entries) => {
              this.setVoiceChannelAccessEntries(mutation.channelId, entries);
              if (mutation.resetAssignmentUserId) {
                this.voiceAdminAssignmentForm.userId = '';
              }
              this.managementSuccess.set(mutation.successMessage);
              void this.refreshVoiceAdminChannels();
            }),
            catchError((error) => {
              this.managementError.set(this.extractErrorMessage(error, mutation.errorMessage));
              return EMPTY;
            }),
            finalize(() => {
              this.voiceAdminSaving.set(false);
            })
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private bindWorkspaceMutationPipelines(): void {
    this.createGroupSubmit$
      .pipe(
        exhaustMap(({ token, payload }) =>
          this.workspaceApi.createServer(token, payload).pipe(
            tap((server) => {
              const updatedServers = this.mergeServersById([...this.servers(), server]).sort(
                (left, right) => left.name.localeCompare(right.name, 'ru')
              );
              this.servers.set(updatedServers);
              this.createGroupForm.name = '';
              this.createGroupForm.description = '';
              this.managementSuccess.set(`Группа «${server.name}» создана`);
              this.createGroupModalOpen.set(false);
              this.selectServer(server.id);
            }),
            catchError((error) => {
              this.managementError.set(this.extractErrorMessage(error, 'Не удалось создать группу'));
              return EMPTY;
            }),
            finalize(() => {
              this.createGroupLoading.set(false);
            })
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    this.createChannelSubmit$
      .pipe(
        exhaustMap(({ token, serverId, payload }) =>
          this.workspaceApi.createChannel(token, serverId, payload).pipe(
            tap((channel) => {
              const updatedChannels = this.mergeChannelsById([...this.channels(), channel]).sort(
                (left, right) => left.position - right.position
              );
              this.applyChannelsSnapshot(updatedChannels, token, channel.id);
              this.createChannelForm.name = '';
              this.createChannelForm.topic = '';
              this.createChannelForm.type = 'text';
              this.managementSuccess.set(
                channel.type === 'voice'
                  ? `Голосовой канал ${channel.name} создан`
                  : `Текстовый канал #${channel.name} создан`
              );
              this.createChannelModalOpen.set(false);
            }),
            catchError((error) => {
              this.managementError.set(this.extractErrorMessage(error, 'Не удалось создать канал'));
              return EMPTY;
            }),
            finalize(() => {
              this.createChannelLoading.set(false);
            })
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    this.deleteChannelTrigger$
      .pipe(
        exhaustMap(({ token, serverId, channel }) =>
          this.workspaceApi.deleteChannel(token, serverId, channel.id).pipe(
            tap(() => {
              if (channel.type === 'voice') {
                this.voicePresence.update((entries) => entries.filter((entry) => entry.channel_id !== channel.id));

                if (this.voiceAdminSelectedChannelId() === channel.id) {
                  this.voiceAdminSelectedChannelId.set(null);
                }

                if (this.voiceAdminPanelOpen()) {
                  void this.refreshVoiceAdminChannels();
                }
              }

              this.managementSuccess.set(
                channel.type === 'voice'
                  ? `Голосовой канал ${channel.name} удален`
                  : `Текстовый канал #${channel.name} удален`
              );
              this.applyChannelsSnapshot(
                this.channels().filter((existingChannel) => existingChannel.id !== channel.id),
                token
              );
            }),
            catchError((error) => {
              this.managementError.set(this.extractErrorMessage(error, 'Не удалось удалить канал'));
              return EMPTY;
            }),
            finalize(() => {
              this.deletingChannelId.set(null);
            })
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private bindMessagePipelines(): void {
    this.sendMessageTrigger$
      .pipe(
        exhaustMap(({ token, channelId, payload }) =>
          this.workspaceApi.sendMessage(token, channelId, payload).pipe(
            tap((message) => {
              this.messageDraft.set('');
              this.pendingFiles.set([]);
              this.scheduleMessageTextareaResize();

              if (this.selectedChannelId() !== channelId) {
                return;
              }

              this.messages.update((messages) => this.mergeMessagesChronologically([...messages, message]));
              this.preloadInlineImagePreviews([message]);
              this.scrollMessagesToBottom();
            }),
            catchError((error) => {
              this.messageError.set(this.extractErrorMessage(error, 'Не удалось отправить сообщение'));
              return EMPTY;
            }),
            finalize(() => {
              this.messageSubmitting.set(false);
            })
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    this.downloadAttachmentTrigger$
      .pipe(
        exhaustMap(({ token, attachment }) =>
          this.workspaceApi.downloadAttachment(token, attachment.id).pipe(
            tap((blob) => {
              const objectUrl = URL.createObjectURL(blob);
              const anchor = document.createElement('a');
              anchor.href = objectUrl;
              anchor.download = attachment.filename;
              anchor.click();
              window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
            }),
            catchError((error) => {
              this.messageError.set(this.extractErrorMessage(error, 'Не удалось скачать файл'));
              return EMPTY;
            })
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    this.loadAttachmentPreviewTrigger$
      .pipe(
        mergeMap(({ token, attachment, openImageAfterLoad, reportErrors }) =>
          this.workspaceApi.downloadAttachment(token, attachment.id).pipe(
            tap((blob) => {
              const objectUrl = URL.createObjectURL(blob);
              const attachmentStillVisible = this.messages().some((message) =>
                message.attachments.some((messageAttachment) => messageAttachment.id === attachment.id)
              );
              if (!attachmentStillVisible) {
                URL.revokeObjectURL(objectUrl);
                return;
              }

              const previousUrl = this.attachmentPreviewUrls()[attachment.id];
              if (previousUrl) {
                URL.revokeObjectURL(previousUrl);
              }

              this.attachmentPreviewUrls.update((currentUrls) => ({
                ...currentUrls,
                [attachment.id]: objectUrl
              }));

              if (openImageAfterLoad) {
                this.openedImageAttachmentId.set(attachment.id);
              }
            }),
            catchError((error) => {
              this.messageError.set(this.extractErrorMessage(error, 'Не удалось загрузить вложение'));
              return EMPTY;
            }),
            finalize(() => {
              this.loadingAttachmentPreviewIds.delete(attachment.id);
            })
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    this.messageReactionTrigger$
      .pipe(
        mergeMap(({ token, message, reactionCode, remove }) => {
          const request$ = remove
            ? this.workspaceApi.removeMessageReaction(token, message.id, reactionCode)
            : this.workspaceApi.addMessageReaction(token, message.id, reactionCode);

          return request$.pipe(
            tap((snapshot) => {
              this.applyMessageReactionSnapshot(snapshot);
              this.openedMessageReactionPickerId.set(null);
            }),
            catchError((error) => {
              this.messageError.set(this.extractErrorMessage(error, 'Не удалось обновить реакцию'));
              return EMPTY;
            }),
            finalize(() => {
              this.pendingMessageReactionKeys.delete(this.buildMessageReactionKey(message.id, reactionCode));
            })
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private bindVoiceOwnershipPipelines(): void {
    this.voiceMemberRoleTrigger$
      .pipe(
        exhaustMap(({ token, channelId, member, role }) =>
          this.workspaceApi.updateVoiceChannelAccess(token, channelId, member.userId, role).pipe(
            tap((entries) => {
              this.setVoiceChannelAccessEntries(channelId, entries);
              this.managementSuccess.set(
                role === 'resident'
                  ? `${member.nick} теперь житель канала`
                  : `${member.nick} теперь чужак канала`
              );
            }),
            catchError((error) => {
              this.managementError.set(this.extractErrorMessage(error, 'Не удалось изменить роль участника'));
              return EMPTY;
            }),
            finalize(() => {
              this.voiceOwnerActionLoading.set(false);
            })
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    this.kickVoiceMemberTrigger$
      .pipe(
        exhaustMap(({ token, channelId, member }) =>
          this.workspaceApi.kickVoiceParticipant(token, channelId, member.userId).pipe(
            tap((entries) => {
              this.setVoiceChannelAccessEntries(channelId, entries);
              this.managementSuccess.set(`${member.nick} выгнан из канала на 5 минут`);
            }),
            catchError((error) => {
              this.managementError.set(this.extractErrorMessage(error, 'Не удалось выгнать участника'));
              return EMPTY;
            }),
            finalize(() => {
              this.voiceOwnerActionLoading.set(false);
            })
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    this.voiceMemberOwnerMuteTrigger$
      .pipe(
        exhaustMap(({ token, channelId, member, nextOwnerMuted }) =>
          this.workspaceApi.updateVoiceParticipantOwnerMute(token, channelId, member.userId, nextOwnerMuted).pipe(
            tap((entries) => {
              this.setVoiceChannelAccessEntries(channelId, entries);
              this.managementSuccess.set(
                nextOwnerMuted
                  ? `${member.nick}: микрофон заблокирован владельцем`
                  : `${member.nick}: блокировка микрофона снята`
              );
            }),
            catchError((error) => {
              this.managementError.set(this.extractErrorMessage(error, 'Не удалось изменить доступ к микрофону'));
              return EMPTY;
            }),
            finalize(() => {
              this.voiceOwnerActionLoading.set(false);
            })
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    this.resolveVoiceRequestTrigger$
      .pipe(
        exhaustMap(({ token, request, action }) =>
          this.workspaceApi.resolveVoiceJoinRequest(token, request.id, action).pipe(
            tap(() => {
              this.ownerVoiceRequests.update((requests) => requests.filter((entry) => entry.id !== request.id));
              this.activeOwnerRequestId.set(this.ownerVoiceRequests()[0]?.id ?? null);
              this.ownerVoiceRequestModalOpen.set(this.ownerVoiceRequests().length > 0);
              this.managementSuccess.set(
                action === 'allow'
                  ? 'Пользователь может зайти в канал'
                  : action === 'resident'
                    ? 'Пользователь стал жителем канала'
                    : 'Пользователь выгнан и не сможет зайти 5 минут'
              );
            }),
            catchError((error) => {
              this.managementError.set(this.extractErrorMessage(error, 'Не удалось обработать запрос на вход'));
              return EMPTY;
            }),
            finalize(() => {
              this.voiceOwnerActionLoading.set(false);
            })
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private bindVoiceJoinRequestPipeline(): void {
    this.voiceJoinRequestTrigger$
      .pipe(
        exhaustMap(({ token, channel }) =>
          this.workspaceApi.requestVoiceJoin(token, channel.id).pipe(
            tap((response: VoiceJoinRequestCreateResponse) => {
              if (response.can_join_now) {
                this.pendingVoiceJoin.set(null);
                void this.connectToVoiceChannel(channel);
                return;
              }

              if (!response.request) {
                this.workspaceError.set(response.detail);
                return;
              }

              this.pendingVoiceJoin.set({
                requestId: response.request.id,
                channelId: response.request.channel_id,
                channelName: response.request.channel_name,
                detail: response.detail
              });
            }),
            catchError((error) => {
              const blockedNotice = this.extractBlockedVoiceJoinNotice(error);
              if (blockedNotice) {
                this.openBlockedVoiceJoinNotice(
                  channel.id,
                  channel.name,
                  blockedNotice.message,
                  blockedNotice.retryAfterSeconds,
                  blockedNotice.blockedUntil
                );
                return EMPTY;
              }

              this.workspaceError.set(this.extractErrorMessage(error, 'Не удалось отправить запрос владельцу канала'));
              return EMPTY;
            })
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private bindServerIconPipeline(): void {
    this.updateServerIconTrigger$
      .pipe(
        exhaustMap(({ token, serverId, iconAsset, iconLabel }) =>
          this.workspaceApi.updateServerIcon(token, serverId, iconAsset).pipe(
            tap((updatedServer) => {
              this.servers.update((servers) =>
                servers
                  .map((server) => (server.id === updatedServer.id ? updatedServer : server))
                  .sort((left, right) => left.name.localeCompare(right.name, 'ru'))
              );
              this.managementSuccess.set(`Иконка группы «${updatedServer.name}» обновлена: ${iconLabel}`);
              this.serverIconModalOpen.set(false);
            }),
            catchError((error) => {
              this.managementError.set(this.extractErrorMessage(error, 'Не удалось обновить иконку группы'));
              return EMPTY;
            }),
            finalize(() => {
              this.serverIconSaving.set(false);
            })
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  switchAuthMode(mode: AuthMode): void {
    this.authMode.set(mode);
    this.authError.set(null);
  }

  submitLogin(): void {
    const payload: AuthLoginRequest = {
      login: this.loginForm.login.trim(),
      password: this.loginForm.password
    };

    if (!payload.login || !payload.password) {
      this.authError.set('Введите логин и пароль');
      return;
    }

    this.authLoading.set(true);
    this.authError.set(null);
    this.loginSubmit$.next(payload);
  }

  submitRegistration(): void {
    const payload: AuthRegisterRequest = {
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
    this.registrationSubmit$.next(payload);
  }

  openVoiceSettings(): void {
    this.closeMobilePanel();
    this.settingsPanelOpen.set(true);
    void this.voiceRoom.refreshDevices();
  }

  openVoiceAdminPanel(): void {
    if (!this.isAdmin()) {
      return;
    }

    this.closeMobilePanel();
    this.voiceAdminPanelOpen.set(true);
    this.managementError.set(null);
    this.managementSuccess.set(null);
    void this.loadVoiceAdminData();
  }

  closeVoiceAdminPanel(): void {
    this.voiceAdminPanelOpen.set(false);
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

  openServerIconModal(): void {
    if (!this.canManageActiveGroup() || this.isCompactVoiceWorkspaceViewport() || !this.activeServer()) {
      return;
    }

    this.serverIconModalOpen.set(true);
    this.managementError.set(null);
    this.managementSuccess.set(null);
  }

  closeServerIconModal(): void {
    this.serverIconModalOpen.set(false);
  }

  selectServerIcon(iconAsset: string): void {
    const token = this.session()?.access_token;
    const activeServer = this.activeServer();
    if (!token || !activeServer || this.serverIconSaving()) {
      return;
    }

    if (this.resolveServerIconAsset(activeServer) === iconAsset) {
      this.serverIconModalOpen.set(false);
      return;
    }

    const iconLabel = iconAsset.replace(/\.png$/i, '');
    this.serverIconSaving.set(true);
    this.managementError.set(null);
    this.managementSuccess.set(null);
    this.updateServerIconTrigger$.next({
      token,
      serverId: activeServer.id,
      iconAsset,
      iconLabel
    });
  }

  isDeletingChannel(channelId: string): boolean {
    return this.deletingChannelId() === channelId;
  }

  openMemberVolume(member: GroupMemberItem, voiceChannelId: string | null = null): void {
    this.closeMobilePanel();
    this.selectedMemberUserId.set(member.userId);
    this.selectedVoiceMemberChannelId.set(voiceChannelId);
    const currentChannel = voiceChannelId
      ? this.channels().find((channel) => channel.id === voiceChannelId) ?? null
      : null;
    const canManageVoiceChannel =
      this.currentUser()?.is_admin === true || currentChannel?.voice_access_role === 'owner';

    if (voiceChannelId && canManageVoiceChannel) {
      void this.ensureVoiceChannelAccessLoaded(voiceChannelId);
    }
  }

  closeMemberVolume(): void {
    this.selectedMemberUserId.set(null);
    this.selectedVoiceMemberChannelId.set(null);
  }

  selectVoiceAdminChannel(channelId: string): void {
    this.voiceAdminSelectedChannelId.set(channelId);
    void this.ensureVoiceChannelAccessLoaded(channelId, true);
  }

  submitVoiceAdminAssignment(): void {
    const token = this.session()?.access_token;
    const channelId = this.voiceAdminSelectedChannelId();
    if (!token || !channelId || !this.voiceAdminAssignmentForm.userId) {
      return;
    }

    this.voiceAdminSaving.set(true);
    this.managementError.set(null);
    this.voiceAdminAccessMutation$.next({
      token,
      channelId,
      userId: this.voiceAdminAssignmentForm.userId,
      role: this.voiceAdminAssignmentForm.role,
      successMessage: 'Доступ к голосовому каналу обновлен',
      errorMessage: 'Не удалось обновить доступ к голосовому каналу',
      resetAssignmentUserId: true
    });
  }

  applyVoiceAdminRole(userId: string, role: VoiceAccessRole): void {
    const token = this.session()?.access_token;
    const channelId = this.voiceAdminSelectedChannelId();
    if (!token || !channelId) {
      return;
    }

    this.voiceAdminSaving.set(true);
    this.managementError.set(null);
    this.voiceAdminAccessMutation$.next({
      token,
      channelId,
      userId,
      role,
      successMessage: 'Роль доступа обновлена',
      errorMessage: 'Не удалось обновить роль доступа'
    });
  }

  removeVoiceAdminAccess(userId: string): void {
    const token = this.session()?.access_token;
    const channelId = this.voiceAdminSelectedChannelId();
    if (!token || !channelId) {
      return;
    }

    this.voiceAdminSaving.set(true);
    this.managementError.set(null);
    this.voiceAdminAccessMutation$.next({
      token,
      channelId,
      userId,
      role: null,
      successMessage: 'Пользователь скрыт из голосового канала',
      errorMessage: 'Не удалось убрать доступ к голосовому каналу'
    });
  }

  submitCreateGroup(): void {
    const token = this.session()?.access_token;
    if (!token) {
      return;
    }

    const payload: CreateWorkspaceServerRequest = {
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
    this.createGroupSubmit$.next({ token, payload });
  }

  submitCreateChannel(): void {
    const token = this.session()?.access_token;
    const activeServer = this.activeServer();
    if (!token || !activeServer) {
      return;
    }

    const payload: CreateWorkspaceChannelRequest = {
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
    this.createChannelSubmit$.next({
      token,
      serverId: activeServer.id,
      payload
    });
  }

  deleteChannel(channel: WorkspaceChannel): void {
    const token = this.session()?.access_token;
    const activeServer = this.activeServer();
    if (!token || !activeServer || !this.canManageActiveGroup()) {
      return;
    }

    const channelTypeLabel = channel.type === 'voice' ? 'голосовой' : 'текстовый';
    if (
      typeof window !== 'undefined'
      && !window.confirm(`Удалить ${channelTypeLabel} канал «${channel.name}»?`)
    ) {
      return;
    }

    if (this.connectedVoiceChannelId() === channel.id) {
      this.voiceRoom.leave();
    }

    if (this.pendingVoiceJoin()?.channelId === channel.id) {
      this.closePendingVoiceJoin();
    }

    if (this.selectedVoiceMemberChannelId() === channel.id) {
      this.closeMemberVolume();
    }

    this.deletingChannelId.set(channel.id);
    this.managementError.set(null);
    this.managementSuccess.set(null);
    this.deleteChannelTrigger$.next({
      token,
      serverId: activeServer.id,
      channel
    });
  }

  onMessageDraftChange(value: string): void {
    this.messageDraft.set(value);
    this.scheduleMessageTextareaResize();
    this.schedulePresenceHeartbeat();
  }

  onMessageComposerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.shiftKey && this.canSendMessage()) {
      event.preventDefault();
      this.submitMessage();
    }
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
    if (
      !token
      || !activeChannel
      || (activeChannel.type !== 'text' && activeChannel.type !== 'voice')
      || !this.canSendMessage()
    ) {
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
    this.sendMessageTrigger$.next({ token, channelId, payload });
  }

  toggleMessageReactionPicker(messageId: string): void {
    this.openedMessageReactionPickerId.set(
      this.openedMessageReactionPickerId() === messageId ? null : messageId
    );
  }

  closeMessageReactionPicker(): void {
    this.openedMessageReactionPickerId.set(null);
  }

  reactionEmoji(code: WorkspaceMessageReactionCode): string {
    return this.messageReactionOptions.find((option) => option.code === code)?.emoji ?? '🙂';
  }

  reactionLabel(code: WorkspaceMessageReactionCode): string {
    return this.messageReactionOptions.find((option) => option.code === code)?.label ?? 'Реакция';
  }

  isMessageReactionPending(messageId: string, reactionCode: WorkspaceMessageReactionCode): boolean {
    return this.pendingMessageReactionKeys.has(this.buildMessageReactionKey(messageId, reactionCode));
  }

  toggleMessageReaction(message: WorkspaceMessage, reactionCode: WorkspaceMessageReactionCode): void {
    const token = this.session()?.access_token;
    if (!token || this.isMessageReactionPending(message.id, reactionCode)) {
      return;
    }

    const existingReaction = message.reactions.find((reaction) => reaction.code === reactionCode);
    const remove = existingReaction?.reacted === true;
    const reactionKey = this.buildMessageReactionKey(message.id, reactionCode);

    this.pendingMessageReactionKeys.add(reactionKey);
    this.messageError.set(null);
    this.schedulePresenceHeartbeat(true);
    this.messageReactionTrigger$.next({ token, message, reactionCode, remove });
  }

  downloadAttachment(attachment: WorkspaceMessageAttachment): void {
    const token = this.session()?.access_token;
    if (!token) {
      return;
    }

    this.downloadAttachmentTrigger$.next({ token, attachment });
  }

  async joinActiveVoiceChannel(): Promise<void> {
    const activeChannel = this.activeChannel();
    if (!activeChannel || activeChannel.type !== 'voice') {
      return;
    }

    await this.handleVoiceChannelSelection(activeChannel);
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
    this.voiceWorkspaceTab.set(this.defaultVoiceWorkspaceTab());
  }

  selectVoiceWorkspaceTab(tab: VoiceWorkspaceTab): void {
    this.voiceWorkspaceTab.set(tab);
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

  changeMicrophoneGain(value: number | string): void {
    this.voiceRoom.updateMicrophoneGain(this.toRangeValue(value));
  }

  changeMasterVolume(value: number | string): void {
    this.voiceRoom.updateMasterVolume(this.toRangeValue(value));
  }

  changeMemberVolume(userId: string, value: number | string): void {
    this.voiceRoom.updateParticipantVolume(userId, this.toRangeValue(value));
  }

  openVoiceParticipantControls(userId: string, channelId: string): void {
    if (!channelId) {
      return;
    }

    const member = this.groupMembers().find((entry) => entry.userId === userId);
    if (!member) {
      return;
    }

    this.openMemberVolume(member, channelId);
  }

  setSelectedVoiceMemberRole(role: Extract<VoiceAccessRole, 'resident' | 'stranger'>): void {
    const token = this.session()?.access_token;
    const channelId = this.selectedVoiceMemberChannelId();
    const member = this.selectedMember();
    if (!token || !channelId || !member) {
      return;
    }

    this.voiceOwnerActionLoading.set(true);
    this.managementError.set(null);
    this.voiceMemberRoleTrigger$.next({ token, channelId, member, role });
  }

  kickSelectedVoiceMember(): void {
    const token = this.session()?.access_token;
    const channelId = this.selectedVoiceMemberChannelId();
    const member = this.selectedMember();
    if (!token || !channelId || !member) {
      return;
    }

    this.voiceOwnerActionLoading.set(true);
    this.managementError.set(null);
    this.kickVoiceMemberTrigger$.next({ token, channelId, member });
  }

  toggleSelectedVoiceMemberOwnerMute(): void {
    const token = this.session()?.access_token;
    const channelId = this.selectedVoiceMemberChannelId();
    const member = this.selectedMember();
    if (!token || !channelId || !member || !this.canToggleSelectedVoiceMemberOwnerMute()) {
      return;
    }

    const nextOwnerMuted = !this.selectedVoiceMemberOwnerMuted();
    this.voiceOwnerActionLoading.set(true);
    this.managementError.set(null);
    this.voiceMemberOwnerMuteTrigger$.next({ token, channelId, member, nextOwnerMuted });
  }

  closePendingVoiceJoin(): void {
    this.pendingVoiceJoin.set(null);
    this.stopVoiceJoinRequestPolling();
  }

  closeBlockedVoiceJoinNotice(): void {
    this.blockedVoiceJoinNotice.set(null);
  }

  closeActiveOwnerRequest(): void {
    this.ownerVoiceRequestModalOpen.set(false);
    this.activeOwnerRequestId.set(null);
  }

  resolveActiveVoiceRequest(action: 'allow' | 'resident' | 'reject'): void {
    const token = this.session()?.access_token;
    const activeRequest = this.activeOwnerRequest();
    if (!token || !activeRequest) {
      return;
    }

    this.voiceOwnerActionLoading.set(true);
    this.managementError.set(null);
    this.resolveVoiceRequestTrigger$.next({
      token,
      request: activeRequest,
      action
    });
  }

  logout(): void {
    this.appEvents.stop();
    this.stopMemberPolling();
    this.stopVoicePresencePolling();
    this.stopMessageAutoRefreshPolling();
    this.stopVoiceJoinRequestPolling();
    this.stopVoiceJoinInboxPolling();
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
    this.voiceAdminPanelOpen.set(false);
    this.createGroupModalOpen.set(false);
    this.createChannelModalOpen.set(false);
    this.selectedMemberUserId.set(null);
    this.selectedVoiceMemberChannelId.set(null);
    this.mobilePanel.set(null);
    this.pendingVoiceJoin.set(null);
    this.blockedVoiceJoinNotice.set(null);
    this.ownerVoiceRequests.set([]);
    this.activeOwnerRequestId.set(null);
    this.ownerVoiceRequestModalOpen.set(false);
    this.voiceAdminChannels.set([]);
    this.voiceAdminUsers.set([]);
    this.voiceAdminSelectedChannelId.set(null);
    this.voiceAccessEntriesByChannelId.set({});
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

    const nextServer = this.servers().find((server) => server.id === serverId) ?? null;
    const currentServer = this.activeServer();
    if (this.hasVoiceConnection() && currentServer && nextServer) {
      this.pendingServerSwitch.set({
        serverId,
        fromServerName: currentServer.name,
        toServerName: nextServer.name
      });
      return;
    }

    this.performServerSelection(serverId);
  }

  stayInCurrentServer(): void {
    this.pendingServerSwitch.set(null);
  }

  confirmServerSwitch(): void {
    const pendingServerSwitch = this.pendingServerSwitch();
    const token = this.session()?.access_token;
    if (!pendingServerSwitch || !token) {
      this.pendingServerSwitch.set(null);
      return;
    }

    this.pendingServerSwitch.set(null);
    this.performServerSelection(pendingServerSwitch.serverId);
  }

  private performServerSelection(serverId: string): void {
    const token = this.session()?.access_token;
    if (!token) {
      return;
    }

    this.schedulePresenceHeartbeat(true);
    this.closeMobilePanel();
    this.stopMemberPolling();
    this.stopVoicePresencePolling();
    this.stopMessageAutoRefreshPolling();
    this.closePendingVoiceJoin();
    this.closeBlockedVoiceJoinNotice();
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
      this.voiceWorkspaceTab.set(this.defaultVoiceWorkspaceTab());
    } else {
      this.voiceWorkspaceTab.set('chat');
    }

    const token = this.session()?.access_token;
    if (token && (channel.type === 'text' || channel.type === 'voice')) {
      this.loadMessagesForChannel(token, channel.id);
    }
    this.syncMessageAutoRefreshPolling();

    if (channel.type === 'voice') {
      await this.handleVoiceChannelSelection(channel);
      return;
    }
  }

  voiceParticipantsForChannel(channelId: string): VoiceParticipant[] {
    if (this.connectedVoiceChannelId() === channelId && this.voiceParticipants().length) {
      return this.voiceParticipants();
    }

    return this.serverVoicePresenceByChannelId().get(channelId) ?? [];
  }

  voiceParticipantTone(participant: VoiceParticipant): VoicePresenceTone {
    if (participant.owner_muted) {
      return 'blocked';
    }

    if (participant.muted) {
      return 'muted';
    }

    return participant.speaking ? 'speaking' : 'open';
  }

  voiceStateIconPath(participant: VoiceParticipant): string {
    const tone = this.voiceParticipantTone(participant);
    if (tone === 'blocked') {
      return '/assets/mic_block.svg';
    }

    if (tone === 'muted') {
      return '/assets/mic_off.svg';
    }

    if (tone === 'speaking') {
      return '/assets/mic_voice.svg';
    }

    return '/assets/mic.svg';
  }

  voiceStateIconAlt(participant: VoiceParticipant): string {
    const tone = this.voiceParticipantTone(participant);
    if (tone === 'blocked') {
      return 'Микрофон заблокирован владельцем';
    }

    if (tone === 'muted') {
      return 'Микрофон выключен пользователем';
    }

    if (tone === 'speaking') {
      return 'Пользователь говорит';
    }

    return 'Микрофон активен';
  }

  voiceMuteControlIconPath(): string {
    if (this.voiceOwnerMuted()) {
      return '/assets/mic_block.svg';
    }

    if (this.voiceMuted()) {
      return '/assets/mic_off.svg';
    }

    return '/assets/mic.svg';
  }

  voiceMuteControlLabel(): string {
    if (this.voiceOwnerMuted()) {
      return 'Микрофон заблокирован владельцем';
    }

    return this.voiceMuted() ? 'Включить микрофон' : 'Выключить микрофон';
  }

  attachmentPreviewUrl(attachment: WorkspaceMessageAttachment): string | null {
    return this.attachmentPreviewUrls()[attachment.id] ?? null;
  }

  imagePreviewUrl(attachment: WorkspaceMessageAttachment): string | null {
    return this.attachmentPreviewUrl(attachment);
  }

  isAttachmentPreviewLoading(attachment: WorkspaceMessageAttachment): boolean {
    return this.loadingAttachmentPreviewIds.has(attachment.id);
  }

  isInlineImageAttachment(attachment: WorkspaceMessageAttachment): boolean {
    if (attachment.size_bytes > MAX_INLINE_IMAGE_SIZE_BYTES) {
      return false;
    }

    const mimeType = attachment.mime_type.toLowerCase();
    if (mimeType === 'image/png' || mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
      return true;
    }

    return /\.(png|jpe?g)$/i.test(attachment.filename);
  }

  isTavernChannel(channel: WorkspaceChannel | null | undefined): boolean {
    if (!channel || channel.type !== 'voice') {
      return false;
    }

    return channel.name.trim().toLocaleLowerCase('ru-RU') === 'таверна';
  }

  isInlineAudioAttachment(attachment: WorkspaceMessageAttachment): boolean {
    const mimeType = attachment.mime_type.toLowerCase();
    if (mimeType === 'audio/mpeg' || mimeType === 'audio/mp3' || mimeType === 'audio/x-mpeg') {
      return true;
    }

    return /\.mp3$/i.test(attachment.filename);
  }

  audioPreviewUrl(attachment: WorkspaceMessageAttachment): string | null {
    return this.attachmentPreviewUrl(attachment);
  }

  openImageAttachment(attachment: WorkspaceMessageAttachment): void {
    const previewUrl = this.imagePreviewUrl(attachment);
    if (previewUrl) {
      this.openedImageAttachmentId.set(
        this.openedImageAttachmentId() === attachment.id ? null : attachment.id
      );
      return;
    }

    this.requestAttachmentPreview(attachment, { openImageAfterLoad: true });
  }

  loadAudioAttachment(attachment: WorkspaceMessageAttachment): void {
    this.requestAttachmentPreview(attachment);
  }

  closeImageAttachment(): void {
    this.openedImageAttachmentId.set(null);
  }

  private startVoicePresencePolling(): void {
    this.stopVoicePresencePolling(false);
    void this.refreshVoicePresence();
  }

  private startVoiceJoinInboxPolling(): void {
    if (typeof window === 'undefined') {
      return;
    }

    this.stopVoiceJoinInboxPolling(false);
    void this.refreshVoiceJoinInbox();
  }

  private stopVoiceJoinInboxPolling(clearState = true): void {
    if (this.voiceJoinInboxPollIntervalId !== null) {
      window.clearInterval(this.voiceJoinInboxPollIntervalId);
      this.voiceJoinInboxPollIntervalId = null;
    }

    if (clearState) {
      this.ownerVoiceRequests.set([]);
      this.activeOwnerRequestId.set(null);
      this.ownerVoiceRequestModalOpen.set(false);
    }
  }

  private startVoiceJoinRequestPolling(): void {
    this.stopVoiceJoinRequestPolling();
    void this.refreshPendingVoiceJoin();
  }

  private stopVoiceJoinRequestPolling(): void {
    if (this.voiceJoinRequestPollIntervalId !== null) {
      window.clearInterval(this.voiceJoinRequestPollIntervalId);
      this.voiceJoinRequestPollIntervalId = null;
    }
  }

  private startMemberPolling(): void {
    this.stopMemberPolling(false);
    void this.refreshMembers();
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
    const currentUserId = this.currentUser()?.id;
    if (currentUserId) {
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
    }

    if (this.appEvents.connected()) {
      this.appEvents.sendActivity();
      return;
    }

    this.workspaceApi
      .sendPresenceHeartbeat(token)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          // Local optimistic update is already applied above.
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

          this.applyMembersSnapshot(members);
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

          this.applyVoicePresenceSnapshot(voicePresence);
        },
        error: () => {
          if (this.selectedServerId() !== serverId) {
            return;
          }

          this.voicePresence.set([]);
        }
      });
  }

  private async refreshVoiceJoinInbox(): Promise<void> {
    const token = this.session()?.access_token;
    if (!token) {
      this.ownerVoiceRequests.set([]);
      this.activeOwnerRequestId.set(null);
      this.ownerVoiceRequestModalOpen.set(false);
      return;
    }

    this.workspaceApi
      .getVoiceJoinInbox(token)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (requests) => {
          this.ownerVoiceRequests.set(requests);
          if (requests.length) {
            this.ownerVoiceRequestModalOpen.set(true);
          } else {
            this.ownerVoiceRequestModalOpen.set(false);
          }
          const activeRequestId = this.activeOwnerRequestId();
          if (activeRequestId && requests.some((request) => request.id === activeRequestId)) {
            return;
          }

          this.activeOwnerRequestId.set(requests[0]?.id ?? null);
        },
        error: () => {
          this.ownerVoiceRequests.set([]);
          this.activeOwnerRequestId.set(null);
          this.ownerVoiceRequestModalOpen.set(false);
        }
      });
  }

  private async refreshPendingVoiceJoin(): Promise<void> {
    const token = this.session()?.access_token;
    const pendingJoin = this.pendingVoiceJoin();
    if (!token || !pendingJoin) {
      this.stopVoiceJoinRequestPolling();
      return;
    }

    this.workspaceApi
      .getVoiceJoinRequest(token, pendingJoin.requestId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: async (request) => {
          if (request.status === 'pending') {
            return;
          }

          await this.handleResolvedVoiceJoinRequest(request);
        },
        error: () => {
          this.stopVoiceJoinRequestPolling();
        }
      });
  }

  private async loadVoiceAdminData(): Promise<void> {
    const token = this.session()?.access_token;
    if (!token || !this.isAdmin()) {
      return;
    }

    this.voiceAdminChannelsLoading.set(true);
    this.voiceAdminUsersLoading.set(true);

    forkJoin({
      channels: this.workspaceApi.getVoiceAdminChannels(token),
      users: this.workspaceApi.getVoiceAdminUsers(token)
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ channels, users }) => {
          this.voiceAdminChannelsLoading.set(false);
          this.voiceAdminUsersLoading.set(false);
          this.voiceAdminChannels.set(channels);
          this.voiceAdminUsers.set(users);

          const preferredChannelId = this.voiceAdminSelectedChannelId();
          const nextChannelId =
            (preferredChannelId && channels.some((channel) => channel.channel_id === preferredChannelId)
              ? preferredChannelId
              : null)
            ?? channels[0]?.channel_id
            ?? null;

          this.voiceAdminSelectedChannelId.set(nextChannelId);
          if (!this.voiceAdminAssignmentForm.userId) {
            this.voiceAdminAssignmentForm.userId = users[0]?.user_id ?? '';
          }
          if (nextChannelId) {
            void this.ensureVoiceChannelAccessLoaded(nextChannelId, true);
          }
        },
        error: (error) => {
          this.voiceAdminChannelsLoading.set(false);
          this.voiceAdminUsersLoading.set(false);
          this.managementError.set(this.extractErrorMessage(error, 'Не удалось загрузить голосовые каналы для управления'));
        }
      });
  }

  private async refreshVoiceAdminChannels(): Promise<void> {
    const token = this.session()?.access_token;
    if (!token || !this.isAdmin()) {
      return;
    }

    this.workspaceApi
      .getVoiceAdminChannels(token)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (channels) => {
          this.voiceAdminChannels.set(channels);
        },
        error: () => {
          // Keep existing state until the next successful refresh.
        }
      });
  }

  private async ensureVoiceChannelAccessLoaded(channelId: string, force = false): Promise<void> {
    const token = this.session()?.access_token;
    if (!token) {
      return;
    }

    if (!force && this.voiceAccessEntriesByChannelId()[channelId]) {
      return;
    }

    this.voiceAdminAccessLoading.set(true);
    this.workspaceApi
      .getVoiceChannelAccess(token, channelId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (entries) => {
          this.voiceAdminAccessLoading.set(false);
          this.setVoiceChannelAccessEntries(channelId, entries);
        },
        error: (error) => {
          this.voiceAdminAccessLoading.set(false);
          this.managementError.set(this.extractErrorMessage(error, 'Не удалось загрузить список ролей голосового канала'));
        }
      });
  }

  private setVoiceChannelAccessEntries(channelId: string, entries: VoiceChannelAccessEntry[]): void {
    this.voiceAccessEntriesByChannelId.update((currentState) => ({
      ...currentState,
      [channelId]: entries
    }));
  }

  private async handleAppEvent(event: AppEventsMessage): Promise<void> {
    switch (event.type) {
      case 'ready':
        await this.resyncAfterAppEventsReconnect();
        return;
      case 'pong':
        return;
      case 'error':
        return;
      case 'presence_updated':
        this.handlePresenceUpdatedEvent(event);
        return;
      case 'message_created':
        this.handleMessageCreatedEvent(event);
        return;
      case 'message_reactions_updated':
        this.handleMessageReactionsUpdatedEvent(event);
        return;
      case 'channels_updated':
        this.handleChannelsUpdatedEvent(event);
        return;
      case 'members_updated':
        this.handleMembersUpdatedEvent(event);
        return;
      case 'voice_presence_updated':
        this.handleVoicePresenceUpdatedEvent(event);
        return;
      case 'servers_changed': {
        const token = this.session()?.access_token;
        if (token) {
          await this.refreshServersList(token);
        }
        return;
      }
      case 'server_changed':
        await this.handleServerChangedEvent(event);
        return;
      case 'voice_inbox_changed':
        await this.refreshVoiceJoinInbox();
        return;
      case 'voice_request_resolved':
        await this.handleVoiceRequestResolvedEvent(event);
        return;
    }
  }

  private async resyncAfterAppEventsReconnect(): Promise<void> {
    const token = this.session()?.access_token;
    if (!token) {
      return;
    }

    await this.refreshServersList(token);

    if (this.selectedServerId()) {
      await this.refreshChannelsForCurrentServer(token);
      await this.refreshMembers();
      await this.refreshVoicePresence();
    }

    if (this.pendingVoiceJoin()) {
      await this.refreshPendingVoiceJoin();
    }

    await this.refreshVoiceJoinInbox();
    this.refreshCurrentChannelMessages();
  }

  private handlePresenceUpdatedEvent(event: AppPresenceUpdatedEvent): void {
    this.members.update((members) =>
      members.map((member) =>
        member.user_id === event.user_id
          ? {
              ...member,
              is_online: event.is_online
            }
          : member
      )
    );
  }

  private handleMessageCreatedEvent(event: AppMessageCreatedEvent): void {
    if (event.server_id !== this.selectedServerId()) {
      return;
    }

    const activeChannel = this.activeChannel();
    if (
      !activeChannel
      || (activeChannel.type !== 'text' && activeChannel.type !== 'voice')
      || activeChannel.id !== event.message.channel_id
    ) {
      return;
    }

    const listElement = this.messageListRef?.nativeElement;
    const isNearBottom =
      !listElement || listElement.scrollHeight - listElement.scrollTop - listElement.clientHeight <= 80;

    this.messages.update((messages) => this.mergeMessagesChronologically([...messages, event.message]));
    this.preloadInlineImagePreviews([event.message]);

    if (isNearBottom || event.message.author.id === this.currentUser()?.id) {
      this.scrollMessagesToBottom();
    }
  }

  private handleMessageReactionsUpdatedEvent(event: AppMessageReactionsUpdatedEvent): void {
    if (event.server_id !== this.selectedServerId()) {
      return;
    }

    this.applyMessageReactionSnapshot(event.snapshot, true);
  }

  private applyChannelsSnapshot(
    channels: WorkspaceChannel[],
    token: string,
    preferredSelectedChannelId: string | null = this.selectedChannelId()
  ): void {
    const connectedVoiceChannelId = this.voiceRoom.activeChannelId();

    this.channels.set(channels);

    if (connectedVoiceChannelId && !channels.some((channel) => channel.id === connectedVoiceChannelId)) {
      this.voiceRoom.leave();
    }

    const nextSelectedChannelId =
      (preferredSelectedChannelId && channels.some((channel) => channel.id === preferredSelectedChannelId)
        ? preferredSelectedChannelId
        : null)
      ?? (connectedVoiceChannelId && channels.some((channel) => channel.id === connectedVoiceChannelId)
        ? connectedVoiceChannelId
        : null)
      ?? channels[0]?.id
      ?? null;

    const selectedChannelChanged = nextSelectedChannelId !== this.selectedChannelId();
    this.selectedChannelId.set(nextSelectedChannelId);
    this.filterVoicePresenceToVisibleChannels(channels);

    if (
      this.selectedVoiceMemberChannelId()
      && !channels.some((channel) => channel.id === this.selectedVoiceMemberChannelId())
    ) {
      this.closeMemberVolume();
    }

    const nextSelectedChannel = channels.find((channel) => channel.id === nextSelectedChannelId) ?? null;
    if (!nextSelectedChannel) {
      this.resetTextChannelState();
      this.syncMessageAutoRefreshPolling();
      return;
    }

    if (nextSelectedChannel.type === 'text' || nextSelectedChannel.type === 'voice') {
      if (selectedChannelChanged) {
        this.loadMessagesForChannel(token, nextSelectedChannel.id);
      }
    } else if (selectedChannelChanged) {
      this.resetTextChannelState();
    }

    this.syncMessageAutoRefreshPolling();
  }

  private applyMembersSnapshot(members: WorkspaceMember[]): void {
    this.members.set(members);

    if (this.selectedMemberUserId() && !members.some((member) => member.user_id === this.selectedMemberUserId())) {
      this.closeMemberVolume();
    }
  }

  private applyVoicePresenceSnapshot(voicePresence: WorkspaceVoicePresenceChannel[]): void {
    const visibleVoiceChannelIds = new Set(
      this.channels()
        .filter((channel) => channel.type === 'voice')
        .map((channel) => channel.id)
    );

    this.voicePresence.set(
      voicePresence.filter((channel) => visibleVoiceChannelIds.has(channel.channel_id))
    );
  }

  private filterVoicePresenceToVisibleChannels(channels: WorkspaceChannel[]): void {
    const visibleVoiceChannelIds = new Set(
      channels.filter((channel) => channel.type === 'voice').map((channel) => channel.id)
    );
    this.voicePresence.update((entries) =>
      entries.filter((entry) => visibleVoiceChannelIds.has(entry.channel_id))
    );
  }

  private handleChannelsUpdatedEvent(event: AppChannelsUpdatedEvent): void {
    const token = this.session()?.access_token;
    if (!token || event.server_id !== this.selectedServerId()) {
      if (this.voiceAdminPanelOpen()) {
        void this.refreshVoiceAdminChannels();
      }
      return;
    }

    this.applyChannelsSnapshot(event.channels, token);

    if (this.voiceAdminPanelOpen()) {
      void this.refreshVoiceAdminChannels();

      const selectedVoiceAdminChannelId = this.voiceAdminSelectedChannelId();
      if (selectedVoiceAdminChannelId) {
        void this.ensureVoiceChannelAccessLoaded(selectedVoiceAdminChannelId, true);
      }
    }
  }

  private mergeServersById(servers: WorkspaceServer[]): WorkspaceServer[] {
    const serversById = new Map<string, WorkspaceServer>();
    for (const server of servers) {
      serversById.set(server.id, server);
    }

    return [...serversById.values()];
  }

  private mergeChannelsById(channels: WorkspaceChannel[]): WorkspaceChannel[] {
    const channelsById = new Map<string, WorkspaceChannel>();
    for (const channel of channels) {
      channelsById.set(channel.id, channel);
    }

    return [...channelsById.values()];
  }

  private handleMembersUpdatedEvent(event: AppMembersUpdatedEvent): void {
    if (event.server_id !== this.selectedServerId()) {
      return;
    }

    this.applyMembersSnapshot(event.members);
  }

  private handleVoicePresenceUpdatedEvent(event: AppVoicePresenceUpdatedEvent): void {
    if (event.server_id !== this.selectedServerId()) {
      return;
    }

    this.applyVoicePresenceSnapshot(event.voice_presence);
  }

  private async refreshServersList(token: string): Promise<void> {
    const previousSelectedServerId = this.selectedServerId();

    this.workspaceApi
      .getServers(token)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (servers) => {
          this.servers.set(servers);

          if (!servers.length) {
            this.appEvents.setActiveServer(null);
            this.selectedServerId.set(null);
            this.selectedChannelId.set(null);
            this.channels.set([]);
            this.members.set([]);
            this.voicePresence.set([]);
            this.resetTextChannelState();
            return;
          }

          if (!previousSelectedServerId || !servers.some((server) => server.id === previousSelectedServerId)) {
            this.loadServerWorkspace(token, servers[0].id);
          }
        },
        error: () => {
          // Silent realtime refresh should not interrupt the current session.
        }
      });
  }

  private async handleServerChangedEvent(event: AppServerChangedEvent): Promise<void> {
    const token = this.session()?.access_token;
    if (!token) {
      return;
    }

    if (event.server_id === this.selectedServerId()) {
      if (event.reason === 'voice_presence_changed') {
        await this.refreshVoicePresence();
      } else {
        await this.refreshChannelsForCurrentServer(token);

        if (event.reason === 'voice_access_changed') {
          await this.refreshVoicePresence();
        }
      }
    }

    if (this.voiceAdminPanelOpen()) {
      await this.refreshVoiceAdminChannels();

      const selectedVoiceAdminChannelId = this.voiceAdminSelectedChannelId();
      if (selectedVoiceAdminChannelId) {
        await this.ensureVoiceChannelAccessLoaded(selectedVoiceAdminChannelId, true);
      }
    }
  }

  private async handleVoiceRequestResolvedEvent(event: AppVoiceRequestResolvedEvent): Promise<void> {
    const pendingJoin = this.pendingVoiceJoin();
    if (!pendingJoin || pendingJoin.requestId !== event.request.id) {
      return;
    }

    await this.handleResolvedVoiceJoinRequest(event.request);
  }

  private async handleResolvedVoiceJoinRequest(request: VoiceJoinRequestSummary): Promise<void> {
    this.stopVoiceJoinRequestPolling();

    if (request.status === 'allowed' || request.status === 'resident') {
      const channel = this.channels().find((entry) => entry.id === request.channel_id) ?? this.activeChannel();
      this.pendingVoiceJoin.set(null);
      if (channel && channel.type === 'voice') {
        await this.connectToVoiceChannel({
          ...channel,
          voice_access_role: request.status === 'resident' ? 'resident' : 'stranger'
        });
      }
      return;
    }

    this.pendingVoiceJoin.set(null);
    this.openBlockedVoiceJoinNotice(
      request.channel_id,
      request.channel_name,
      this.buildBlockedVoiceJoinMessage(
        request.retry_after_seconds,
        request.blocked_until,
        'Владелец канала отклонил вход.'
      ),
      request.retry_after_seconds,
      request.blocked_until
    );
  }

  private async refreshChannelsForCurrentServer(token: string): Promise<void> {
    const serverId = this.selectedServerId();
    if (!serverId) {
      return;
    }

    const previousSelectedChannelId = this.selectedChannelId();

    this.workspaceApi
      .getChannels(token, serverId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (channels) => {
          if (this.selectedServerId() !== serverId) {
            return;
          }
          this.applyChannelsSnapshot(channels, token, previousSelectedChannelId);
        },
        error: () => {
          // Keep current list until the next successful refresh.
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
      this.appEvents.start(session.access_token);
      this.schedulePresenceHeartbeat(true);
      this.startVoiceJoinInboxPolling();
      this.bootstrapWorkspace(session.access_token);
    } catch {
      this.clearStoredSession();
    }
  }

  private handleAuthenticatedSession(session: AuthSessionResponse): void {
    this.session.set(session);
    this.currentUser.set(session.user);
    this.appEvents.start(session.access_token);
    this.persistSession(session);
    this.schedulePresenceHeartbeat(true);
    this.startVoiceJoinInboxPolling();
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
            this.appEvents.setActiveServer(null);
            this.stopMemberPolling();
            this.stopVoicePresencePolling();
            this.stopMessageAutoRefreshPolling();
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
          this.stopMessageAutoRefreshPolling();
          this.stopVoiceJoinInboxPolling();
    this.appEvents.stop();
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

    this.stopMemberPolling(false);
    this.stopVoicePresencePolling();
    this.workspaceLoading.set(true);
    this.workspaceError.set(null);
    this.managementError.set(null);
    this.managementSuccess.set(null);
    this.selectedServerId.set(serverId);
    this.appEvents.setActiveServer(serverId);
    this.selectedChannelId.set(null);
    this.selectedMemberUserId.set(null);
    this.selectedVoiceMemberChannelId.set(null);
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
          this.applyChannelsSnapshot(channels, token, previousSelectedChannelId);
          this.applyMembersSnapshot(members);
          this.applyVoicePresenceSnapshot(voicePresence);
          this.syncMessageAutoRefreshPolling();
          this.workspaceLoading.set(false);
        },
        error: (error) => {
          this.stopMemberPolling();
          this.stopVoicePresencePolling();
          this.stopMessageAutoRefreshPolling();
          this.channels.set([]);
          this.members.set([]);
          this.voicePresence.set([]);
          this.resetTextChannelState();
          this.workspaceLoading.set(false);
          this.workspaceError.set(this.extractErrorMessage(error, 'Не удалось загрузить данные выбранной группы'));
        }
      });
  }

  private async handleVoiceChannelSelection(channel: WorkspaceChannel): Promise<void> {
    if (channel.voice_access_role === 'stranger') {
      await this.requestVoiceChannelEntry(channel);
      return;
    }

    await this.connectToVoiceChannel(channel);
  }

  private async requestVoiceChannelEntry(channel: WorkspaceChannel): Promise<void> {
    const token = this.session()?.access_token;
    if (!token) {
      return;
    }

    this.workspaceError.set(null);
    this.closeBlockedVoiceJoinNotice();
    this.voiceJoinRequestTrigger$.next({ token, channel });
  }

  private async connectToVoiceChannel(channel: WorkspaceChannel): Promise<void> {
    const token = this.session()?.access_token;
    const currentUser = this.currentUser();
    if (!token || !currentUser || channel.type !== 'voice') {
      return;
    }

    this.workspaceError.set(null);
    this.closeBlockedVoiceJoinNotice();
    await this.voiceRoom.join(channel.id, token, currentUser);
    this.pendingVoiceJoin.set(null);
    this.stopVoiceJoinRequestPolling();
    if (this.currentUser()?.is_admin || channel.voice_access_role === 'owner') {
      void this.ensureVoiceChannelAccessLoaded(channel.id, true);
    }
  }

  private defaultVoiceWorkspaceTab(): VoiceWorkspaceTab {
    return this.isCompactVoiceWorkspaceViewport() ? 'chat' : 'channel';
  }

  private isCompactVoiceWorkspaceViewport(): boolean {
    return typeof window !== 'undefined' && window.matchMedia('(max-width: 920px)').matches;
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
      this.clearAttachmentPreviews();
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

          this.preloadInlineImagePreviews(page.items);

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
      || (activeChannel.type !== 'text' && activeChannel.type !== 'voice')
      || !this.messagesHasMore()
      || !this.messagesCursor()
      || this.messagesLoading()
      || this.messagesLoadingMore()
    ) {
      return;
    }

    this.loadMessagesForChannel(token, activeChannel.id, this.messagesCursor());
  }

  private requestAttachmentPreview(
    attachment: WorkspaceMessageAttachment,
    options?: { openImageAfterLoad?: boolean }
  ): void {
    const token = this.session()?.access_token;
    if (!token) {
      return;
    }

    if (this.attachmentPreviewUrl(attachment)) {
      if (options?.openImageAfterLoad) {
        this.openedImageAttachmentId.set(
          this.openedImageAttachmentId() === attachment.id ? null : attachment.id
        );
      }
      return;
    }

    if (this.loadingAttachmentPreviewIds.has(attachment.id)) {
      return;
    }

    this.messageError.set(null);
    this.loadingAttachmentPreviewIds.add(attachment.id);
    this.loadAttachmentPreviewTrigger$.next({
      token,
      attachment,
      openImageAfterLoad: options?.openImageAfterLoad === true
    });
  }

  private preloadInlineImagePreviews(messages: WorkspaceMessage[]): void {
    for (const message of messages) {
      for (const attachment of message.attachments) {
        if (!this.isInlineImageAttachment(attachment)) {
          continue;
        }

        this.requestAttachmentPreview(attachment);
      }
    }
  }

  private applyMessageReactionSnapshot(
    snapshot: WorkspaceMessageReactionsSnapshot,
    preserveExistingReacted = false,
  ): void {
    this.messages.update((messages) =>
      messages.map((message) =>
        message.id === snapshot.message_id
          ? {
              ...message,
              reactions: preserveExistingReacted
                ? snapshot.reactions.map((reaction) => ({
                    ...reaction,
                    reacted:
                      message.reactions.find((existingReaction) => existingReaction.code === reaction.code)?.reacted
                      ?? reaction.reacted,
                  }))
                : snapshot.reactions,
            }
          : message
      )
    );
  }

  private buildMessageReactionKey(messageId: string, reactionCode: WorkspaceMessageReactionCode): string {
    return `${messageId}:${reactionCode}`;
  }

  private syncMessageAutoRefreshPolling(): void {
    this.stopMessageAutoRefreshPolling();
  }

  private stopMessageAutoRefreshPolling(): void {
    if (this.messageAutoRefreshIntervalId !== null) {
      window.clearInterval(this.messageAutoRefreshIntervalId);
      this.messageAutoRefreshIntervalId = null;
    }
  }

  private refreshCurrentChannelMessages(): void {
    const token = this.session()?.access_token;
    const activeChannel = this.activeChannel();
    if (
      !token
      || !activeChannel
      || (activeChannel.type !== 'text' && activeChannel.type !== 'voice')
      || this.workspaceLoading()
      || this.messagesLoading()
      || this.messagesLoadingMore()
    ) {
      return;
    }

    const channelId = activeChannel.id;
    const listElement = this.messageListRef?.nativeElement;
    const isNearBottom = !listElement || listElement.scrollHeight - listElement.scrollTop - listElement.clientHeight <= 80;

    this.workspaceApi
      .getMessages(token, channelId, MESSAGES_PAGE_SIZE)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page) => {
          if (this.selectedChannelId() !== channelId) {
            return;
          }

          const existingMessages = this.messages();
          if (!existingMessages.length) {
            this.messages.set(page.items);
            this.preloadInlineImagePreviews(page.items);
            if (isNearBottom) {
              this.scrollMessagesToBottom();
            }
            return;
          }

          const existingIds = new Set(existingMessages.map((message) => message.id));
          const newItems = page.items.filter((message) => !existingIds.has(message.id));
          if (!newItems.length) {
            return;
          }

          this.messages.set(this.mergeMessagesChronologically([...existingMessages, ...page.items]));
          this.preloadInlineImagePreviews(newItems);

          if (isNearBottom) {
            this.scrollMessagesToBottom();
          }
        },
        error: () => {
          // Silent refresh should not interrupt reading with transient errors.
        }
      });
  }

  private resetTextChannelState(): void {
    this.messages.set([]);
    this.clearAttachmentPreviews();
    this.openedMessageReactionPickerId.set(null);
    this.messagesHasMore.set(false);
    this.messagesCursor.set(null);
    this.messagesLoading.set(false);
    this.messagesLoadingMore.set(false);
    this.messageSubmitting.set(false);
    this.messageDraft.set('');
    this.pendingFiles.set([]);
    this.messageError.set(null);
    this.scheduleMessageTextareaResize();
  }

  private mergeMessagesChronologically(messages: WorkspaceMessage[]): WorkspaceMessage[] {
    const uniqueMessages = new Map<string, WorkspaceMessage>();

    for (const message of messages) {
      uniqueMessages.set(message.id, message);
    }

    return [...uniqueMessages.values()].sort((left, right) => left.created_at.localeCompare(right.created_at));
  }

  private scheduleMessageTextareaResize(): void {
    requestAnimationFrame(() => {
      const textarea = this.messageTextareaRef?.nativeElement;
      if (!textarea) {
        return;
      }

      const maxHeight = typeof window !== 'undefined' && window.innerWidth <= 640 ? 120 : 168;
      textarea.style.height = '0px';

      const nextHeight = Math.min(Math.max(textarea.scrollHeight, 44), maxHeight);
      textarea.style.height = `${nextHeight}px`;
      textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
    });
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

  private clearAttachmentPreviews(): void {
    const currentUrls = this.attachmentPreviewUrls();
    for (const objectUrl of Object.values(currentUrls)) {
      URL.revokeObjectURL(objectUrl);
    }

    this.loadingAttachmentPreviewIds.clear();
    this.attachmentPreviewUrls.set({});
    this.openedImageAttachmentId.set(null);
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

      if (typeof detail === 'object' && detail !== null) {
        const message = (detail as { message?: unknown }).message;
        if (typeof message === 'string' && message.trim()) {
          return message;
        }
      }
    }

    return fallback;
  }

  private openBlockedVoiceJoinNotice(
    channelId: string,
    channelName: string,
    detail: string,
    retryAfterSeconds: number | null,
    blockedUntil: string | null
  ): void {
    this.pendingVoiceJoin.set(null);
    this.stopVoiceJoinRequestPolling();
    this.workspaceError.set(null);
    this.blockedVoiceJoinNotice.set({
      channelId,
      channelName,
      detail,
      retryAfterSeconds,
      blockedUntil
    });
  }

  private extractBlockedVoiceJoinNotice(error: unknown): {
    message: string;
    retryAfterSeconds: number | null;
    blockedUntil: string | null;
  } | null {
    if (!(error instanceof HttpErrorResponse) || typeof error.error !== 'object' || error.error === null) {
      return null;
    }

    const detail = (error.error as { detail?: unknown }).detail;
    if (typeof detail !== 'object' || detail === null) {
      return null;
    }

    const message = (detail as { message?: unknown }).message;
    if (typeof message !== 'string' || !message.trim()) {
      return null;
    }

    const retryAfterSecondsValue = (detail as { retry_after_seconds?: unknown }).retry_after_seconds;
    const blockedUntilValue = (detail as { blocked_until?: unknown }).blocked_until;

    return {
      message,
      retryAfterSeconds: typeof retryAfterSecondsValue === 'number' ? retryAfterSecondsValue : null,
      blockedUntil: typeof blockedUntilValue === 'string' ? blockedUntilValue : null
    };
  }

  private buildBlockedVoiceJoinMessage(
    retryAfterSeconds: number | null,
    blockedUntil: string | null,
    fallback: string
  ): string {
    if (typeof retryAfterSeconds === 'number' && retryAfterSeconds >= 0) {
      return `${fallback} Повторить попытку можно через ${this.formatRetryWait(retryAfterSeconds)}.`;
    }

    if (blockedUntil) {
      const blockedUntilDate = new Date(blockedUntil);
      if (!Number.isNaN(blockedUntilDate.getTime())) {
        const seconds = Math.max(0, Math.ceil((blockedUntilDate.getTime() - Date.now()) / 1000));
        return `${fallback} Повторить попытку можно через ${this.formatRetryWait(seconds)}.`;
      }
    }

    return fallback;
  }

  private formatRetryWait(totalSeconds: number): string {
    const normalizedSeconds = Math.max(0, Math.ceil(totalSeconds));
    const minutes = Math.floor(normalizedSeconds / 60);
    const seconds = normalizedSeconds % 60;

    if (minutes > 0 && seconds > 0) {
      return `${minutes} мин ${seconds} сек`;
    }

    if (minutes > 0) {
      return `${minutes} мин`;
    }

    return `${seconds} сек`;
  }

  private buildServerIconAssetUrl(iconAsset: string): string {
    return SERVER_ICON_URL_BY_ASSET[iconAsset as keyof typeof SERVER_ICON_URL_BY_ASSET] ?? '';
  }

  private resolveServerIconAsset(server: WorkspaceServer): string | null {
    return server.icon_asset ?? DEFAULT_SERVER_ICON_ASSET_BY_NAME[server.name] ?? null;
  }

  private serverIconUrl(server: WorkspaceServer): string | null {
    const iconAsset = this.resolveServerIconAsset(server);
    return iconAsset ? this.buildServerIconAssetUrl(iconAsset) : null;
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

    if (presence === 'blocked') {
      return 'микрофон заблокирован';
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

    if (presence === 'blocked') {
      return `Микрофон заблокирован в ${channelName}`;
    }

    return `В канале ${channelName}`;
  }

  private getPresenceWeight(presence: MemberPresenceTone): number {
    if (presence === 'speaking') {
      return 0;
    }

    if (presence === 'blocked') {
      return 1;
    }

    if (presence === 'open') {
      return 2;
    }

    if (presence === 'muted') {
      return 3;
    }

    return 4;
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
