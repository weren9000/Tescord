import { HttpErrorResponse } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { Component, DestroyRef, ElementRef, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  EMPTY,
  Subject,
  catchError,
  debounceTime,
  distinctUntilChanged,
  exhaustMap,
  finalize,
  forkJoin,
  mergeMap,
  of,
  switchMap,
  takeUntil,
  tap
} from 'rxjs';

import { AuthApiService } from './core/api/auth-api.service';
import { API_BASE_URL } from './core/api/api-base';
import { SystemApiService } from './core/api/system-api.service';
import { WorkspaceApiService, WorkspaceMessageUploadEvent } from './core/api/workspace-api.service';
import { AttentionMentionItem } from './core/models/attention.models';
import {
  ConversationDirectoryUser,
  ConversationMemberPreview,
  ConversationSummary,
  CreateGroupConversationRequest,
} from './core/models/conversation.models';
import {
  BlockedFriendSummary,
  CreateFriendRequestRequest,
  FriendRequestSummary,
} from './core/models/friend.models';
import {
  AppEventsMessage,
  AppChannelsUpdatedEvent,
  AppAttachmentDeletedEvent,
  AppFriendRequestsChangedEvent,
  AppMessageCreatedEvent,
  AppMessageReadUpdatedEvent,
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
  AddWorkspaceMemberRequest,
  BlockedServerSummary,
  CreateWorkspaceChannelRequest,
  CurrentUserResponse,
  LeaveWorkspaceServerRequest,
  VoiceAdminChannel,
  VoiceAdminUser,
  VoiceChannelAccessEntry,
  VoiceJoinRequestCreateResponse,
  VoiceJoinRequestSummary,
  WorkspaceChannel,
  WorkspaceChatAttachmentSummary,
  WorkspaceMessage,
  WorkspaceMessageAttachment,
  WorkspaceMessageReaction,
  WorkspaceMessageReactionCode,
  WorkspaceMessageReactionsSnapshot,
  WorkspaceMessageReply,
  WorkspaceMessageSearchResult,
  WorkspaceMember,
  WorkspaceServer,
  WorkspaceChannelSearchResult,
  WorkspaceVoicePresenceChannel
} from './core/models/workspace.models';
import { AppEventsService } from './core/services/app-events.service';
import { BrowserPushService } from './core/services/browser-push.service';
import { DirectCallPeer, DirectCallService } from './core/services/direct-call.service';
import { VoiceParticipant, VoiceRoomService } from './core/services/voice-room.service';
import { MediaStreamSrcDirective } from './shared/media-stream-src.directive';

type AuthMode = 'login' | 'register';
type ChannelKind = 'text' | 'voice';
type WorkspaceMode = 'chats' | 'groups' | 'platforms';
type VoicePresenceTone = 'speaking' | 'open' | 'muted' | 'blocked';
type MemberPresenceTone = VoicePresenceTone | 'inactive';
type MobilePanel = 'servers' | 'channels' | 'members' | null;
type VoiceAccessRole = 'owner' | 'resident' | 'guest' | 'stranger';
type VoiceWorkspaceTab = 'chat' | 'channel';
type ConversationCreateTab = 'direct' | 'group';
type PushFeedbackTone = 'success' | 'warning' | 'error';
type MessageFocusKind = 'unread' | 'mention' | 'search';
type ChatMediaTab = 'gallery' | 'files';
type AttachmentActionSurface = 'message' | 'chat';
type MessageUploadOutcome = 'idle' | 'uploading' | 'cancelled' | 'failed';
type VoiceVideoSource = 'camera' | 'screen-share';
type VoiceVideoLayoutMode = 'grid-1' | 'grid-2' | 'grid-4' | 'grid-6' | 'grid-9' | 'presentation';
type CallSurfaceKind = 'direct' | 'group' | 'platform';
type VoiceCallSurfaceKind = Exclude<CallSurfaceKind, 'direct'>;
type CallWindowMode = 'expanded' | 'minimized';

interface LoginFormModel {
  email: string;
  password: string;
}

interface RegisterFormModel {
  email: string;
  password: string;
  password_confirmation: string;
  nick: string;
}

interface CreateGroupFormModel {
  name: string;
}

interface CreatePlatformFormModel {
  name: string;
  description: string;
}

interface CreateConversationFormModel {
  directUserId: string;
  name: string;
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
  meta: string | null;
}

interface GroupMemberItem {
  id: string;
  userId: string;
  publicId: number;
  login: string;
  nick: string;
  avatarUpdatedAt: string | null;
  role: string;
  roleLabel: string;
  isSelf: boolean;
  presenceLabel: string;
  isOnline: boolean;
  voiceParticipant: VoiceParticipant | null;
}

interface VoiceVideoTile {
  id: string;
  participantId: string;
  userId: string;
  nick: string;
  avatarUpdatedAt: string | null;
  stream: MediaStream;
  isSelf: boolean;
  speaking: boolean;
  muted: boolean;
  ownerMuted: boolean;
  source: VoiceVideoSource;
}

interface VoiceVideoScene {
  mode: VoiceVideoLayoutMode;
  stageTile: VoiceVideoTile | null;
  gridTiles: VoiceVideoTile[];
  secondaryTiles: VoiceVideoTile[];
  placeholderIds: string[];
  gridClass: string;
}

interface FullscreenMediaState {
  id: string;
  tileId: string | null;
  callId: string | null;
  kind: CallSurfaceKind;
  source: VoiceVideoSource;
  title: string;
  subtitle: string;
  stream: MediaStream;
  isSelf: boolean;
}

interface ActiveCallSurface {
  kind: CallSurfaceKind;
  id: string;
  title: string;
  subtitle: string;
  channelId: string | null;
  participantCount: number;
  activeSpeakerLabel: string | null;
}

interface VoiceCallSnapshot {
  kind: VoiceCallSurfaceKind;
  serverId: string;
  serverName: string;
  channel: WorkspaceChannel;
}

interface ComposerMentionCandidate {
  userId: string;
  publicId: number;
  nick: string;
  avatarUpdatedAt: string | null;
  isOnline: boolean;
}

interface ComposerMentionQueryState {
  start: number;
  end: number;
  query: string;
}

interface MessageContentSegment {
  text: string;
  mentionUserId: string | null;
}

interface TextHighlightChunk {
  text: string;
  highlighted: boolean;
}

interface ProfileUpdateTrigger {
  token: string;
  avatarFile: File | null;
  removeAvatar: boolean;
  successMessage: string;
  closeEditor: boolean;
}

interface VoiceAdminAssignmentFormModel {
  userId: string;
  role: VoiceAccessRole;
}

interface VoiceAdminChannelNameOption {
  name: string;
  groupsCount: number;
}

type VoiceAdminStatusTone = 'neutral' | 'online' | 'active' | 'warning' | 'danger';

interface VoiceAdminStatusChip {
  label: string;
  tone: VoiceAdminStatusTone;
}

interface VoiceAdminAccessViewModel {
  entry: VoiceChannelAccessEntry;
  roleLabel: string;
  statusChips: VoiceAdminStatusChip[];
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
  payload: CreateGroupConversationRequest;
}

interface CreatePlatformTrigger {
  token: string;
  payload: {
    name: string;
    description: string | null;
  };
}

interface SendFriendRequestTrigger {
  token: string;
  payload: CreateFriendRequestRequest;
  successMessage: string;
  closeModal?: boolean;
}

interface RespondFriendRequestTrigger {
  token: string;
  requestId: string;
  action: 'accept' | 'reject' | 'block';
}

interface FriendManagementTrigger {
  token: string;
  userId: string;
  action: 'remove' | 'block' | 'unblock';
  successMessage: string;
}

interface CreateChannelTrigger {
  token: string;
  serverId: string;
  payload: CreateWorkspaceChannelRequest;
}

interface CreateConversationTrigger {
  token: string;
  payload: CreateGroupConversationRequest;
}

interface AddServerMemberTrigger {
  token: string;
  serverId: string;
  payload: AddWorkspaceMemberRequest;
}

interface ServerMembershipActionTrigger {
  token: string;
  serverId: string;
  action: 'leave' | 'block' | 'unblock';
  payload?: LeaveWorkspaceServerRequest;
  successMessage: string;
}

interface PendingMessageNavigationState {
  serverId: string;
  channelId: string;
  focusMessageId: string | null;
  focusKind: MessageFocusKind;
}

interface PendingSearchNavigationState {
  serverId: string;
  channelId: string;
}

interface RemoveServerMemberTrigger {
  token: string;
  serverId: string;
  member: GroupMemberItem;
}

interface OpenDirectConversationTrigger {
  token: string;
  payload: {
    user_id?: string | null;
    user_public_id?: number | null;
  };
  closeModal: boolean;
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
    replyToMessageId?: string | null;
  };
}

interface MessageUploadProgressState {
  loaded: number;
  total: number | null;
  percent: number | null;
}

interface MarkChannelReadTrigger {
  token: string;
  channelId: string;
  lastMessageId: string | null;
}

interface DownloadAttachmentTrigger {
  token: string;
  attachment: WorkspaceMessageAttachment;
  surface: AttachmentActionSurface;
}

interface LoadAttachmentPreviewTrigger {
  token: string;
  attachment: WorkspaceMessageAttachment;
  openImageAfterLoad?: boolean;
  reportErrors?: boolean;
  surface?: AttachmentActionSurface;
}

interface LoadChatAttachmentsTrigger {
  token: string;
  channelId: string;
}

interface DeleteChatAttachmentTrigger {
  token: string;
  attachmentId: string;
  surface: AttachmentActionSurface;
}

interface VoiceMemberRoleTrigger {
  token: string;
  channelId: string;
  member: GroupMemberItem;
  role: Extract<VoiceAccessRole, 'resident' | 'guest' | 'stranger'>;
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

interface CallSwitchDescriptor {
  kind: CallSurfaceKind;
  id: string;
  title: string;
  subtitle: string;
  channelId: string | null;
}

interface PendingCallSwitchState {
  current: CallSwitchDescriptor;
  target: CallSwitchDescriptor;
  confirmLabel: string;
  action: () => void | Promise<void>;
}

interface UploadServerIconTrigger {
  token: string;
  serverId: string;
  file: File;
}

interface MessageReactionOption {
  code: WorkspaceMessageReactionCode;
  emoji?: string;
  assetPath?: string;
  label: string;
}

interface MessageReactionTrigger {
  token: string;
  message: WorkspaceMessage;
  reactionCode: WorkspaceMessageReactionCode;
  remove: boolean;
}

interface BrowserWakeLockSentinel extends EventTarget {
  release(): Promise<void>;
}

interface BrowserWakeLock {
  request(type: 'screen'): Promise<BrowserWakeLockSentinel>;
}

const SESSION_STORAGE_KEY = 'tescord.session';
const MESSAGES_PAGE_SIZE = 25;
const UNREAD_FOCUS_PAGE_PADDING = 24;
const MAX_UNREAD_FOCUS_PAGE_SIZE = 200;
const MAX_ATTACHMENT_SIZE_BYTES = 500 * 1024 * 1024;
const MAX_INLINE_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_PROFILE_AVATAR_DIMENSION = 300;
const MAX_PROFILE_AVATAR_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_PROFILE_AVATAR_SOURCE_BYTES = 8 * 1024 * 1024;
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
  { code: 'praying_cat', assetPath: '/assets/The praying cat.png', label: 'Молящийся кот' },
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
  imports: [CommonModule, FormsModule, MediaStreamSrcDirective],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  private readonly systemApi = inject(SystemApiService);
  private readonly authApi = inject(AuthApiService);
  private readonly workspaceApi = inject(WorkspaceApiService);
  private readonly appEvents = inject(AppEventsService);
  private readonly browserPush = inject(BrowserPushService);
  private readonly directCall = inject(DirectCallService);
  private readonly voiceRoom = inject(VoiceRoomService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly attachmentPreviewUrls = signal<Record<string, string>>({});
  private readonly loadingAttachmentPreviewIds = new Set<string>();
  private wakeLock: BrowserWakeLockSentinel | null = null;
  private wakeLockRequestInFlight = false;
  private readonly handlePresenceActivity = () => this.schedulePresenceHeartbeat();
  private readonly handleVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      this.schedulePresenceHeartbeat(true);
    }

    void this.syncWakeLock();
  };
  private readonly handleWakeLockRelease = () => {
    if (this.wakeLock) {
      this.wakeLock.removeEventListener('release', this.handleWakeLockRelease);
      this.wakeLock = null;
    }

    void this.syncWakeLock();
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
  private readonly sendFriendRequestTrigger$ = new Subject<SendFriendRequestTrigger>();
  private readonly respondFriendRequestTrigger$ = new Subject<RespondFriendRequestTrigger>();
  private readonly friendManagementTrigger$ = new Subject<FriendManagementTrigger>();
  private readonly openDirectConversationTrigger$ = new Subject<OpenDirectConversationTrigger>();
  private readonly createConversationSubmit$ = new Subject<CreateConversationTrigger>();
  private readonly createPlatformSubmit$ = new Subject<CreatePlatformTrigger>();
  private readonly addServerMemberTrigger$ = new Subject<AddServerMemberTrigger>();
  private readonly removeServerMemberTrigger$ = new Subject<RemoveServerMemberTrigger>();
  private readonly serverMembershipActionTrigger$ = new Subject<ServerMembershipActionTrigger>();
  private readonly createGroupSubmit$ = new Subject<CreateGroupTrigger>();
  private readonly createChannelSubmit$ = new Subject<CreateChannelTrigger>();
  private readonly deleteChannelTrigger$ = new Subject<DeleteChannelTrigger>();
  private readonly sendMessageTrigger$ = new Subject<SendMessageTrigger>();
  private readonly cancelMessageUploadTrigger$ = new Subject<void>();
  private readonly markChannelReadTrigger$ = new Subject<MarkChannelReadTrigger>();
  private readonly downloadAttachmentTrigger$ = new Subject<DownloadAttachmentTrigger>();
  private readonly loadAttachmentPreviewTrigger$ = new Subject<LoadAttachmentPreviewTrigger>();
  private readonly loadChatAttachmentsTrigger$ = new Subject<LoadChatAttachmentsTrigger>();
  private readonly deleteChatAttachmentTrigger$ = new Subject<DeleteChatAttachmentTrigger>();
  private readonly voiceMemberRoleTrigger$ = new Subject<VoiceMemberRoleTrigger>();
  private readonly kickVoiceMemberTrigger$ = new Subject<KickVoiceMemberTrigger>();
  private readonly voiceMemberOwnerMuteTrigger$ = new Subject<VoiceMemberOwnerMuteTrigger>();
  private readonly resolveVoiceRequestTrigger$ = new Subject<ResolveVoiceRequestTrigger>();
  private readonly voiceJoinRequestTrigger$ = new Subject<VoiceJoinRequestTrigger>();
  private readonly uploadServerIconTrigger$ = new Subject<UploadServerIconTrigger>();
  private readonly messageReactionTrigger$ = new Subject<MessageReactionTrigger>();
  private readonly profileUpdateTrigger$ = new Subject<ProfileUpdateTrigger>();
  private readonly globalSearchQuery$ = new Subject<string>();
  private readonly messageSearchQuery$ = new Subject<{ channelId: string | null; query: string }>();
  private readonly pendingMessageReactionKeys = new Set<string>();
  private readonly lastMarkedReadMessageIdByChannel = new Map<string, string | null>();
  private messageUploadCancelRequested = false;
  private pendingPushConversationId: string | null = null;
  private profileAvatarSelectionMode: 'instant' | 'editor' = 'instant';
  private profileAvatarPreviewObjectUrl: string | null = null;
  private readonly openedUnreadAnchorMessageId = signal<string | null>(null);
  private readonly openedMessageFocusKind = signal<MessageFocusKind | null>(null);
  private readonly pendingMessageNavigation = signal<PendingMessageNavigationState | null>(null);
  private readonly pendingSearchNavigation = signal<PendingSearchNavigationState | null>(null);
  private pushFeedbackTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private lastActiveCallSurfaceId: string | null = null;
  private readonly handleCallWindowKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') {
      return;
    }

    if (this.fullscreenMedia()) {
      event.preventDefault();
      event.stopPropagation();
      this.closeFullscreenMedia();
      return;
    }

    if (this.callWindowMode() !== 'expanded' || !this.activeCallSurface()) {
      return;
    }

    event.preventDefault();
    this.minimizeCallWindow();
  };
  private readonly handleDocumentFullscreenChange = (): void => {
    if (typeof document === 'undefined') {
      return;
    }

    const wasActive = this.callFullscreenNativeActive;
    const isActive = document.fullscreenElement === this.callFullscreenLayerElement;
    this.callFullscreenNativeActive = isActive;
    if (wasActive && !isActive && this.fullscreenMedia()) {
      this.fullscreenMedia.set(null);
      this.fullscreenMediaControlsVisible.set(true);
      this.clearFullscreenControlsHideTimer();
    }
  };

  @ViewChild('messageList')
  private messageListRef?: ElementRef<HTMLElement>;

  @ViewChild('attachmentInput')
  private attachmentInputRef?: ElementRef<HTMLInputElement>;

  @ViewChild('messageTextarea')
  private messageTextareaRef?: ElementRef<HTMLTextAreaElement>;

  @ViewChild('messageSearchInput')
  private messageSearchInputRef?: ElementRef<HTMLInputElement>;

  @ViewChild('profileAvatarInput')
  private profileAvatarInputRef?: ElementRef<HTMLInputElement>;

  @ViewChild('serverIconInput')
  private serverIconInputRef?: ElementRef<HTMLInputElement>;

  @ViewChild('directCallLocalScreenVideo')
  private set directCallLocalScreenVideoRef(ref: ElementRef<HTMLVideoElement> | undefined) {
    this.directCallLocalScreenVideoElement = ref?.nativeElement ?? null;
    this.syncDirectCallScreenVideos();
  }

  @ViewChild('directCallRemoteScreenVideo')
  private set directCallRemoteScreenVideoRef(ref: ElementRef<HTMLVideoElement> | undefined) {
    this.directCallRemoteScreenVideoElement = ref?.nativeElement ?? null;
    this.syncDirectCallScreenVideos();
  }

  @ViewChild('directCallExpandedLocalScreenVideo')
  private set directCallExpandedLocalScreenVideoRef(ref: ElementRef<HTMLVideoElement> | undefined) {
    this.directCallExpandedLocalScreenVideoElement = ref?.nativeElement ?? null;
    this.syncDirectCallScreenVideos();
  }

  @ViewChild('directCallExpandedRemoteScreenVideo')
  private set directCallExpandedRemoteScreenVideoRef(ref: ElementRef<HTMLVideoElement> | undefined) {
    this.directCallExpandedRemoteScreenVideoElement = ref?.nativeElement ?? null;
    this.syncDirectCallScreenVideos();
  }

  @ViewChild('callFullscreenLayer')
  private set callFullscreenLayerRef(ref: ElementRef<HTMLElement> | undefined) {
    this.callFullscreenLayerElement = ref?.nativeElement ?? null;
    if (this.callFullscreenRequestPending && this.callFullscreenLayerElement) {
      void this.enterNativeCallFullscreen();
    }
  }

  private directCallLocalScreenVideoElement: HTMLVideoElement | null = null;
  private directCallRemoteScreenVideoElement: HTMLVideoElement | null = null;
  private directCallExpandedLocalScreenVideoElement: HTMLVideoElement | null = null;
  private directCallExpandedRemoteScreenVideoElement: HTMLVideoElement | null = null;
  private callFullscreenLayerElement: HTMLElement | null = null;
  private callFullscreenRequestPending = false;
  private callFullscreenNativeActive = false;
  private fullscreenControlsHideTimeoutId: ReturnType<typeof setTimeout> | null = null;

  readonly health = signal<ApiHealthResponse | null>(null);
  readonly healthError = signal<string | null>(null);
  readonly authError = signal<string | null>(null);
  readonly workspaceError = signal<string | null>(null);
  readonly messageError = signal<string | null>(null);
  readonly managementError = signal<string | null>(null);
  readonly managementSuccess = signal<string | null>(null);
  readonly pushFeedback = signal<{ tone: PushFeedbackTone; message: string } | null>(null);
  readonly authLoading = signal(false);
  readonly workspaceLoading = signal(false);
  readonly messagesLoading = signal(false);
  readonly messagesLoadingMore = signal(false);
  readonly messageSubmitting = signal(false);
  readonly messageUploadProgress = signal<MessageUploadProgressState | null>(null);
  readonly messageUploadOutcome = signal<MessageUploadOutcome>('idle');
  readonly composerMentionQueryState = signal<ComposerMentionQueryState | null>(null);
  readonly composerMentionActiveIndex = signal(0);
  readonly downloadingAttachmentIds = signal<string[]>([]);
  readonly chatFilesModalOpen = signal(false);
  readonly chatFilesLoading = signal(false);
  readonly chatFilesError = signal<string | null>(null);
  readonly chatMediaTab = signal<ChatMediaTab>('gallery');
  readonly chatAttachments = signal<WorkspaceChatAttachmentSummary[]>([]);
  readonly deletingChatAttachmentId = signal<string | null>(null);
  readonly attachmentAvailabilityLabels = signal<Record<string, string>>({});
  readonly friendRequestsModalOpen = signal(false);
  readonly friendRequestsLoading = signal(false);
  readonly friendRequestsError = signal<string | null>(null);
  readonly attentionInboxLoading = signal(false);
  readonly attentionInboxError = signal<string | null>(null);
  readonly attentionMentions = signal<AttentionMentionItem[]>([]);
  readonly incomingFriendRequests = signal<FriendRequestSummary[]>([]);
  readonly outgoingFriendRequests = signal<FriendRequestSummary[]>([]);
  readonly pendingFriendRequestCount = signal(0);
  readonly friendRequestActionId = signal<string | null>(null);
  readonly blockedFriendsModalOpen = signal(false);
  readonly blockedFriendsLoading = signal(false);
  readonly blockedFriendsError = signal<string | null>(null);
  readonly blockedFriends = signal<BlockedFriendSummary[]>([]);
  readonly blockedServersModalOpen = signal(false);
  readonly blockedServersLoading = signal(false);
  readonly blockedServersError = signal<string | null>(null);
  readonly blockedServers = signal<BlockedServerSummary[]>([]);
  readonly friendManagementPendingUserId = signal<string | null>(null);
  readonly serverMembershipActionPendingServerId = signal<string | null>(null);
  readonly createConversationLoading = signal(false);
  readonly createGroupLoading = signal(false);
  readonly createPlatformLoading = signal(false);
  readonly createChannelLoading = signal(false);
  readonly conversationPushPendingId = signal<string | null>(null);
  readonly deletingChannelId = signal<string | null>(null);
  readonly authMode = signal<AuthMode>('login');
  readonly directCallScreenExpanded = signal(false);
  readonly callWindowMode = signal<CallWindowMode>('expanded');
  readonly callDockVolumeOpen = signal(false);
  readonly activeVoiceCallSnapshot = signal<VoiceCallSnapshot | null>(null);
  readonly fullscreenMedia = signal<FullscreenMediaState | null>(null);
  readonly fullscreenMediaControlsVisible = signal(true);

  readonly session = signal<AuthSessionResponse | null>(null);
  readonly currentUser = signal<CurrentUserResponse | null>(null);
  readonly workspaceMode = signal<WorkspaceMode>('chats');
  readonly servers = signal<WorkspaceServer[]>([]);
  readonly conversations = signal<ConversationSummary[]>([]);
  readonly conversationDirectory = signal<ConversationDirectoryUser[]>([]);
  readonly channels = signal<WorkspaceChannel[]>([]);
  readonly members = signal<WorkspaceMember[]>([]);
  readonly voicePresence = signal<WorkspaceVoicePresenceChannel[]>([]);
  readonly messages = signal<WorkspaceMessage[]>([]);
  readonly messageReactionOptions = MESSAGE_REACTION_OPTIONS;
  readonly messagesHasMore = signal(false);
  readonly messagesCursor = signal<string | null>(null);
  readonly selectedServerId = signal<string | null>(null);
  readonly selectedChannelId = signal<string | null>(null);
  readonly selectedReplyMessage = signal<WorkspaceMessage | null>(null);
  readonly settingsPanelOpen = signal(false);
  readonly voiceAdminPanelOpen = signal(false);
  readonly profileEditorOpen = signal(false);
  readonly createConversationModalOpen = signal(false);
  readonly createGroupModalOpen = signal(false);
  readonly createPlatformModalOpen = signal(false);
  readonly addGroupMemberModalOpen = signal(false);
  readonly createChannelModalOpen = signal(false);
  readonly platformSettingsModalOpen = signal(false);
  readonly platformSettingsDangerMenuOpen = signal(false);
  readonly platformVoiceSettingsChannelId = signal<string | null>(null);
  readonly groupMembersModalOpen = signal(false);
  readonly groupVoiceParticipantsExpanded = signal(false);
  readonly platformExpandedVoiceChannelId = signal<string | null>(null);
  readonly platformTextChannelsCollapsed = signal(false);
  readonly platformVoiceChannelsCollapsed = signal(false);
  readonly sideMenuOpen = signal(false);
  readonly quickCreateMenuOpen = signal(false);
  readonly conversationActionMenuOpen = signal(false);
  readonly pendingGroupOwnershipAction = signal<'leave' | 'block' | null>(null);
  readonly groupOwnershipModalOpen = signal(false);
  readonly groupOwnershipTransferUserId = signal('');
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
  readonly profileSaving = signal(false);
  readonly profileNotice = signal<string | null>(null);
  readonly profileError = signal<string | null>(null);
  readonly profileAvatarFile = signal<File | null>(null);
  readonly profileAvatarPreviewUrl = signal<string | null>(null);
  readonly profileAvatarRemove = signal(false);
  readonly ownerVoiceRequests = signal<VoiceJoinRequestSummary[]>([]);
  readonly activeOwnerRequestId = signal<string | null>(null);
  readonly ownerVoiceRequestModalOpen = signal(false);
  readonly addGroupMemberLoading = signal(false);
  readonly removingGroupMemberUserId = signal<string | null>(null);
  readonly directDirectoryQuery = signal('');
  readonly addGroupMemberQuery = signal('');
  readonly addGroupMemberUserId = signal<string>('');
  readonly voiceAdminChannels = signal<VoiceAdminChannel[]>([]);
  readonly voiceAdminUsers = signal<VoiceAdminUser[]>([]);
  readonly voiceAdminSelectedChannelName = signal<string | null>(null);
  readonly voiceAdminSelectedServerId = signal<string | null>(null);
  readonly voiceAdminSelectedChannelId = signal<string | null>(null);
  readonly voiceAccessEntriesByChannelId = signal<Record<string, VoiceChannelAccessEntry[]>>({});
  readonly pendingServerSwitch = signal<PendingServerSwitchState | null>(null);
  readonly pendingCallSwitch = signal<PendingCallSwitchState | null>(null);
  readonly globalSearchQuery = signal('');
  readonly globalSearchLoading = signal(false);
  readonly globalSearchError = signal<string | null>(null);
  readonly globalSearchChannelResults = signal<WorkspaceChannelSearchResult[]>([]);
  readonly messageSearchPanelOpen = signal(false);
  readonly messageSearchQuery = signal('');
  readonly messageSearchLoading = signal(false);
  readonly messageSearchError = signal<string | null>(null);
  readonly messageSearchResults = signal<WorkspaceMessageSearchResult[]>([]);
  readonly messageSearchFocusedMessageId = signal<string | null>(null);
  readonly conversationCreateTab = signal<ConversationCreateTab>('direct');
  readonly createConversationGroupMemberIds = signal<string[]>([]);
  readonly createGroupMemberIds = signal<string[]>([]);
  readonly conversationMentionTotalCount = computed(() =>
    this.conversations().reduce((total, conversation) => total + Math.max(0, conversation.mention_unread_count ?? 0), 0)
  );
  readonly serverMentionTotalCount = computed(() =>
    this.servers().reduce((total, server) => total + Math.max(0, server.mention_unread_count ?? 0), 0)
  );
  readonly notificationAlertCount = computed(
    () => this.pendingFriendRequestCount() + this.ownerVoiceRequests().length + this.conversationMentionTotalCount() + this.serverMentionTotalCount()
  );
  readonly friendRequestBadgeVisible = computed(() => this.notificationAlertCount() > 0);
  readonly isActiveGroupOwner = computed(() => {
    const activeServer = this.activeServer();
    return !!activeServer && activeServer.kind !== 'direct' && activeServer.member_role === 'owner';
  });
  readonly activeConversationPushEnabled = computed(() => this.activeConversation()?.push_enabled === true);

  readonly loginForm: LoginFormModel = {
    email: '',
    password: ''
  };

  readonly registerForm: RegisterFormModel = {
    email: '',
    password: '',
    password_confirmation: '',
    nick: ''
  };

  readonly createGroupForm: CreateGroupFormModel = {
    name: '',
  };

  readonly createPlatformForm: CreatePlatformFormModel = {
    name: '',
    description: '',
  };

  readonly createConversationForm: CreateConversationFormModel = {
    directUserId: '',
    name: '',
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
  readonly voiceCameraSupported = this.voiceRoom.cameraSupported;
  readonly voiceCameraEnabled = this.voiceRoom.cameraEnabled;
  readonly voiceLocalVideoStream = this.voiceRoom.localVideoStream;
  readonly voiceScreenShareSupported = this.voiceRoom.screenShareSupported;
  readonly voiceScreenSharing = this.voiceRoom.screenShareEnabled;
  readonly voiceLocalScreenStream = this.voiceRoom.localScreenShareStream;
  readonly outputDeviceSupported = this.voiceRoom.outputDeviceSupported;
  readonly directCallState = this.directCall.state;
  readonly directCallError = this.directCall.error;
  readonly directCallNotice = this.directCall.notice;
  readonly directCallPeer = this.directCall.peer;
  readonly directCallCanCall = this.directCall.canCall;
  readonly hasDirectCall = this.directCall.hasActiveCall;
  readonly directCallCameraSupported = this.directCall.cameraSupported;
  readonly directCallCameraEnabled = this.directCall.isCameraEnabled;
  readonly directCallLocalCameraStream = this.directCall.localCameraStream;
  readonly directCallRemoteCameraStream = this.directCall.remoteCameraStream;
  readonly directCallHasRemoteCamera = this.directCall.hasRemoteCamera;
  readonly directCallScreenSupported = this.directCall.screenShareSupported;
  readonly directCallScreenSharing = this.directCall.isScreenSharing;
  readonly directCallLocalScreenStream = this.directCall.localScreenStream;
  readonly directCallRemoteScreenStream = this.directCall.remoteScreenStream;
  readonly directCallHasRemoteScreen = this.directCall.hasRemoteScreenShare;
  readonly directCallMuted = this.directCall.localMuted;
  readonly directCallRemoteVolume = this.directCall.remoteVolume;
  readonly hasAnyDirectCallScreen = computed(
    () => this.directCallHasRemoteScreen() || this.directCallScreenSharing()
  );
  readonly hasAnyDirectCallVideo = computed(
    () => this.hasAnyDirectCallScreen() || this.directCallCameraEnabled() || this.directCallHasRemoteCamera()
  );
  readonly isChatsMode = computed(() => this.workspaceMode() === 'chats');
  readonly isGroupsMode = computed(() => this.workspaceMode() === 'groups');
  readonly isPlatformsMode = computed(() => this.workspaceMode() === 'platforms');
  readonly directConversations = computed(() =>
    this.conversations().filter((conversation) => conversation.kind === 'direct')
  );
  readonly groupConversations = computed(() =>
    this.conversations().filter((conversation) => conversation.kind === 'group_chat')
  );
  readonly platformSpaces = computed<WorkspaceServer[]>(() =>
    this.servers()
      .filter((server) => server.kind === 'workspace')
      .sort((left, right) => left.name.localeCompare(right.name, 'ru'))
  );
  readonly conversationSpaces = computed<WorkspaceServer[]>(() =>
    this.conversations().map((conversation) => ({
      id: conversation.id,
      name: conversation.title,
      slug: conversation.id,
      description: conversation.subtitle,
      icon_asset: conversation.icon_asset,
      icon_updated_at: conversation.icon_updated_at,
      member_role: conversation.member_role,
      kind: conversation.kind,
      unread_count: conversation.unread_count,
      mention_unread_count: conversation.mention_unread_count,
    }))
  );
  readonly directConversationSpaces = computed<WorkspaceServer[]>(() =>
    this.directConversations().map((conversation) => ({
      id: conversation.id,
      name: conversation.title,
      slug: conversation.id,
      description: conversation.subtitle,
      icon_asset: conversation.icon_asset,
      icon_updated_at: conversation.icon_updated_at,
      member_role: conversation.member_role,
      kind: conversation.kind,
      unread_count: conversation.unread_count,
      mention_unread_count: conversation.mention_unread_count,
    }))
  );
  readonly groupConversationSpaces = computed<WorkspaceServer[]>(() =>
    this.groupConversations().map((conversation) => ({
      id: conversation.id,
      name: conversation.title,
      slug: conversation.id,
      description: conversation.subtitle,
      icon_asset: conversation.icon_asset,
      icon_updated_at: conversation.icon_updated_at,
      member_role: conversation.member_role,
      kind: conversation.kind,
      unread_count: conversation.unread_count,
      mention_unread_count: conversation.mention_unread_count,
    }))
  );
  readonly currentSpaceList = computed<WorkspaceServer[]>(() =>
    this.isChatsMode()
      ? this.directConversationSpaces()
      : this.isGroupsMode()
        ? this.groupConversationSpaces()
        : this.platformSpaces()
  );

  readonly activeServer = computed(() => {
    const serverId = this.selectedServerId();
    return this.currentSpaceList().find((server) => server.id === serverId) ?? null;
  });
  readonly activeConversation = computed(() => {
    const serverId = this.selectedServerId();
    return this.conversations().find((conversation) => conversation.id === serverId) ?? null;
  });
  readonly activeConversationMemberIds = computed(() =>
    new Set(this.activeConversation()?.members.map((member) => member.user_id) ?? [])
  );
  readonly activeConversationPrimaryChannelId = computed(() => this.activeConversation()?.primary_channel_id ?? null);
  readonly activeDirectConversation = computed(() => this.activeConversation()?.kind === 'direct' ? this.activeConversation() : null);
  readonly activeGroupConversation = computed(() => this.activeConversation()?.kind === 'group_chat' ? this.activeConversation() : null);

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
    if (!connectedChannelId) {
      return null;
    }

    const visibleChannel = this.channels().find((channel) => channel.id === connectedChannelId) ?? null;
    if (visibleChannel) {
      return visibleChannel;
    }

    const snapshot = this.activeVoiceCallSnapshot();
    return snapshot?.channel.id === connectedChannelId ? snapshot.channel : null;
  });

  readonly connectedVoiceChannelId = computed(() => this.connectedVoiceChannel()?.id ?? null);
  readonly activeMessagingChannel = computed(() => {
    const groupTextChannel = this.activeGroupConversation() ? this.activeGroupTextChannel() : null;
    if (groupTextChannel) {
      return groupTextChannel;
    }

    const activeChannel = this.activeChannel();
    if (!activeChannel) {
      return null;
    }

    return activeChannel.type === 'text' || activeChannel.type === 'voice' ? activeChannel : null;
  });
  readonly isVoiceChannelSelected = computed(() => this.activeChannel()?.type === 'voice');
  readonly isTextChannelSelected = computed(() => this.activeChannel()?.type === 'text');
  readonly canUseActiveChannelChat = computed(() => this.activeMessagingChannel() !== null);
  readonly hasVoiceSession = computed(() =>
    this.voiceRoom.activeChannelId() !== null
    && this.connectedVoiceChannel() !== null
    && this.voiceState() !== 'idle'
  );
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
  readonly canUseComposerMentions = computed(() => {
    const activeServer = this.activeServer();
    if (!activeServer || !this.canUseActiveChannelChat()) {
      return false;
    }

    return activeServer.kind === 'workspace' || activeServer.kind === 'group_chat';
  });

  readonly canManageActiveGroup = computed(() => {
    const activeServer = this.activeServer();
    const currentUser = this.currentUser();
    if (!activeServer || !currentUser || (activeServer.kind !== 'workspace' && activeServer.kind !== 'group_chat')) {
      return false;
    }

    return currentUser.is_admin || activeServer.member_role === 'owner' || activeServer.member_role === 'admin';
  });
  readonly canOpenPlatformSettings = computed(() => {
    const activeServer = this.activeServer();
    if (!activeServer || activeServer.kind !== 'workspace') {
      return false;
    }

    if (this.canManageActiveGroup()) {
      return true;
    }

    return this.voiceChannels().some((channel) => channel.voice_access_role === 'owner');
  });

  readonly canEditActiveServerIcon = computed(() => this.canManageActiveGroup() && !this.isCompactVoiceWorkspaceViewport());
  readonly canCreateConversationGroup = computed(() =>
    this.createConversationForm.name.trim().length >= 2
    && !this.createConversationLoading()
  );
  readonly canCreateDirectConversation = computed(() =>
    this.resolveUserLookupPayload(this.createConversationForm.directUserId, this.directDirectoryQuery()) !== null
    && !this.createConversationLoading()
  );
  readonly canAddGroupMember = computed(() =>
    this.addGroupMemberUserId().trim().length > 0
    && !this.addGroupMemberLoading()
  );
  readonly directFriendLookupPublicId = computed(() => this.parsePublicUserId(this.directDirectoryQuery()));
  readonly directFriendLookupConversation = computed(() => {
    const publicId = this.directFriendLookupPublicId();
    return publicId === null ? null : this.findDirectConversationByPublicId(publicId);
  });
  readonly directFriendLookupState = computed<'idle' | 'invalid' | 'ready' | 'existing'>(() => {
    const query = this.directDirectoryQuery().trim();
    if (!query) {
      return 'idle';
    }

    const publicId = this.directFriendLookupPublicId();
    if (publicId === null) {
      return 'invalid';
    }

    return this.directFriendLookupConversation() ? 'existing' : 'ready';
  });
  readonly createConversationAvailableUsers = computed(() =>
    [...this.conversationDirectory()].sort((left, right) => {
      if (left.is_online !== right.is_online) {
        return left.is_online ? -1 : 1;
      }

      return this.displayNick(left.nick)
        .localeCompare(this.displayNick(right.nick), 'ru');
    })
  );
  readonly createGroupSelectedMemberCount = computed(() => this.createGroupMemberIds().length);
  readonly createConversationSelectedMemberCount = computed(() => this.createConversationGroupMemberIds().length);
  readonly personalChatEntries = computed(() => this.directConversationSpaces());
  readonly groupChatEntries = computed(() => this.groupConversationSpaces());
  readonly platformEntries = computed(() => this.platformSpaces());
  readonly hasGlobalSearchQuery = computed(() => this.buildSearchTerms(this.globalSearchQuery()).length > 0);
  readonly globalSearchDirectResults = computed(() => {
    const terms = this.buildSearchTerms(this.globalSearchQuery());
    if (!terms.length) {
      return [];
    }

    const currentUserId = this.currentUser()?.id ?? null;
    return this.directConversations().filter((conversation) => {
      const peer = conversation.members.find((member) => member.user_id !== currentUserId) ?? conversation.members[0] ?? null;
      return this.matchesSearchTerms(terms, [
        conversation.title,
        conversation.subtitle,
        peer?.login,
        peer ? this.formatPublicUserId(peer.public_id) : null,
      ]);
    });
  });
  readonly globalSearchGroupResults = computed(() => {
    const terms = this.buildSearchTerms(this.globalSearchQuery());
    if (!terms.length) {
      return [];
    }

    return this.groupConversations().filter((conversation) =>
      this.matchesSearchTerms(terms, [
        conversation.title,
        conversation.subtitle,
      ])
    );
  });
  readonly globalSearchPlatformResults = computed(() => {
    const terms = this.buildSearchTerms(this.globalSearchQuery());
    if (!terms.length) {
      return [];
    }

    return this.platformSpaces().filter((server) =>
      this.matchesSearchTerms(terms, [
        server.name,
        server.description,
        server.slug,
      ])
    );
  });
  readonly globalSearchTotalCount = computed(() =>
    this.globalSearchDirectResults().length
    + this.globalSearchGroupResults().length
    + this.globalSearchPlatformResults().length
    + this.globalSearchChannelResults().length
  );
  readonly globalSearchHasResults = computed(() => this.globalSearchTotalCount() > 0);
  readonly hasMessageSearchQuery = computed(() => this.messageSearchQuery().trim().length > 0);
  readonly messageSearchHasResults = computed(() => this.messageSearchResults().length > 0);
  readonly activeDirectPeer = computed(() => {
    const conversation = this.activeDirectConversation();
    if (!conversation) {
      return null;
    }

    return conversation.members.find((member) => member.user_id !== this.currentUser()?.id) ?? conversation.members[0] ?? null;
  });
  readonly activeGroupTextChannel = computed(() =>
    this.channels().find((channel) => channel.type === 'text') ?? null
  );
  readonly activeGroupVoiceChannel = computed(() =>
    this.channels().find((channel) => channel.type === 'voice') ?? null
  );
  readonly activeGroupVoiceParticipants = computed(() => {
    const voiceChannel = this.activeGroupVoiceChannel();
    if (!voiceChannel) {
      return [];
    }

    return this.voiceParticipantsForChannel(voiceChannel.id);
  });
  readonly activeCallSurface = computed<ActiveCallSurface | null>(() => {
    const directPeer = this.directCallPeer();
    if (directPeer && this.hasDirectCall()) {
      return {
        kind: 'direct',
        id: `direct:${directPeer.user_id}`,
        title: this.displayNick(directPeer.nick),
        subtitle: this.directCallSurfaceStatusLabel(),
        channelId: null,
        participantCount: 2,
        activeSpeakerLabel: null,
      };
    }

    if (!this.hasVoiceSession()) {
      return null;
    }

    const channel = this.connectedVoiceChannel();
    if (!channel) {
      return null;
    }

    const snapshot = this.activeVoiceCallSnapshot();
    const participants = this.voiceParticipantsForChannel(channel.id);
    const activeSpeaker = participants.find((participant) => participant.speaking && !participant.muted && !participant.owner_muted);
    const kind: VoiceCallSurfaceKind = snapshot?.channel.id === channel.id
      ? snapshot.kind
      : (this.activeServer()?.kind === 'workspace' ? 'platform' : 'group');
    const serverName = snapshot?.channel.id === channel.id
      ? snapshot.serverName
      : (this.activeServer()?.name ?? (kind === 'platform' ? 'Площадка' : 'Группа'));

    return {
      kind,
      id: `${kind}:${channel.id}`,
      title: serverName,
      subtitle: channel.name,
      channelId: channel.id,
      participantCount: participants.length,
      activeSpeakerLabel: activeSpeaker ? this.displayNick(activeSpeaker.nick) : null,
    };
  });
  readonly hasActiveCallSurface = computed(() => this.activeCallSurface() !== null);
  readonly callWindowExpanded = computed(() => this.hasActiveCallSurface() && this.callWindowMode() === 'expanded');
  readonly callDockParticipantLabel = computed(() => {
    const surface = this.activeCallSurface();
    if (!surface) {
      return '';
    }

    if (surface.kind === 'direct') {
      return this.directCallSurfaceStatusLabel();
    }

    if (this.voiceState() !== 'connected') {
      return this.voiceCallStateLabel();
    }

    const count = surface.participantCount;
    const remainder10 = count % 10;
    const remainder100 = count % 100;
    const noun =
      remainder10 === 1 && remainder100 !== 11
        ? 'участник'
        : remainder10 >= 2 && remainder10 <= 4 && (remainder100 < 12 || remainder100 > 14)
          ? 'участника'
          : 'участников';
    const speaker = surface.activeSpeakerLabel ? ` · говорит ${surface.activeSpeakerLabel}` : '';

    return `${count} ${noun}${speaker}`;
  });
  readonly activeCallVoiceParticipants = computed(() => {
    const surface = this.activeCallSurface();
    return surface?.channelId ? this.voiceParticipantsForChannel(surface.channelId) : [];
  });
  readonly activeCallVoiceVideoScene = computed(() => {
    const surface = this.activeCallSurface();
    return surface?.channelId ? this.voiceVideoSceneForChannel(surface.channelId) : null;
  });
  readonly activeCallSelfParticipant = computed(() =>
    this.activeCallVoiceParticipants().find((participant) => participant.is_self) ?? null
  );
  readonly activeCallMuted = computed(() => {
    const surface = this.activeCallSurface();
    if (!surface) {
      return false;
    }

    if (surface.kind === 'direct') {
      return this.directCallMuted();
    }

    return this.voiceMuted() || this.voiceOwnerMuted();
  });
  readonly activeCallVolume = computed(() => {
    const surface = this.activeCallSurface();
    return surface?.kind === 'direct' ? this.directCallRemoteVolume() : this.voiceSettings().masterVolume;
  });
  readonly activeCallVolumeMax = computed(() => (this.activeCallSurface()?.kind === 'direct' ? 100 : 200));
  readonly activeCallCanUseCamera = computed(() => {
    const surface = this.activeCallSurface();
    if (!surface) {
      return false;
    }

    if (surface.kind === 'direct') {
      return this.canToggleDirectCallCamera();
    }

    return this.voiceState() === 'connected'
      && !!surface.channelId
      && this.voiceCameraSupported()
      && this.connectedVoiceChannelId() === surface.channelId;
  });
  readonly activeCallCameraEnabled = computed(() => {
    const surface = this.activeCallSurface();
    return surface?.kind === 'direct' ? this.directCallCameraEnabled() : this.voiceCameraEnabled();
  });
  readonly activeCallCanShareScreen = computed(() => {
    const surface = this.activeCallSurface();
    if (!surface) {
      return false;
    }

    if (surface.kind === 'direct') {
      return this.canToggleDirectCallScreenShare();
    }

    return this.voiceState() === 'connected'
      && !!surface.channelId
      && this.voiceScreenShareSupported()
      && this.connectedVoiceChannelId() === surface.channelId;
  });
  readonly activeCallScreenSharing = computed(() => {
    const surface = this.activeCallSurface();
    return surface?.kind === 'direct' ? this.directCallScreenSharing() : this.voiceScreenSharing();
  });
  readonly activeCallPendingRequestCount = computed(() => {
    const surface = this.activeCallSurface();
    if (surface?.kind !== 'platform' || !surface.channelId) {
      return 0;
    }

    return this.platformVoiceChannelPendingRequestCount(surface.channelId);
  });
  readonly activeCallCanOpenSettings = computed(() => this.activeCallSurface()?.kind === 'platform' && this.canOpenPlatformSettings());
  readonly isIncomingDirectCall = computed(() => {
    const surface = this.activeCallSurface();
    return surface?.kind === 'direct' && this.directCallState() === 'incoming';
  });
  readonly shouldShowDockControls = computed(() =>
    this.hasActiveCallSurface() && (this.callWindowMode() === 'minimized' || this.isIncomingDirectCall())
  );
  readonly shouldShowWindowControls = computed(() =>
    this.hasActiveCallSurface() && this.callWindowMode() === 'expanded' && !this.isIncomingDirectCall()
  );
  readonly activeCallMediaControlsVisible = computed(() => {
    const surface = this.activeCallSurface();
    if (!surface) {
      return false;
    }

    return surface.kind === 'direct'
      ? this.directCallState() === 'connected'
      : this.voiceState() === 'connected';
  });
  readonly shouldShowDockMediaControls = computed(() =>
    this.shouldShowDockControls() && this.activeCallMediaControlsVisible()
  );
  readonly shouldShowWindowMediaControls = computed(() =>
    this.shouldShowWindowControls() && this.activeCallMediaControlsVisible()
  );
  readonly shouldShowDockSettings = computed(() => this.shouldShowDockControls() && this.activeCallCanOpenSettings());
  readonly shouldShowWindowSettings = computed(() => this.shouldShowWindowControls() && this.activeCallCanOpenSettings());
  readonly activeGroupMemberCount = computed(() => this.members().length);
  readonly composerMentionCandidates = computed<ComposerMentionCandidate[]>(() => {
    if (!this.canUseComposerMentions()) {
      return [];
    }

    const queryState = this.composerMentionQueryState();
    if (!queryState) {
      return [];
    }

    const normalizedQuery = queryState.query.trim().toLowerCase();
    return this.groupMembers()
      .filter((member) => !member.isSelf)
      .filter((member) => {
        if (!normalizedQuery) {
          return true;
        }

        return (
          this.displayNick(member.nick).toLowerCase().includes(normalizedQuery)
          || this.formatPublicUserId(member.publicId).includes(normalizedQuery)
        );
      })
      .slice(0, 7)
      .map((member) => ({
        userId: member.userId,
        publicId: member.publicId,
        nick: member.nick,
        avatarUpdatedAt: member.avatarUpdatedAt,
        isOnline: member.isOnline,
      }));
  });
  readonly composerMentionMenuOpen = computed(() =>
    !this.messageSubmitting()
    && this.composerMentionQueryState() !== null
    && this.composerMentionCandidates().length > 0
  );
  readonly activeComposerMentionCandidate = computed(() => {
    const candidates = this.composerMentionCandidates();
    if (!candidates.length) {
      return null;
    }

    const nextIndex = Math.min(Math.max(this.composerMentionActiveIndex(), 0), candidates.length - 1);
    return candidates[nextIndex] ?? null;
  });
  readonly platformManageableVoiceChannels = computed(() =>
    this.voiceChannels().filter((channel) => this.canManagePlatformVoiceChannel(channel))
  );
  readonly platformVoiceSettingsChannel = computed(() => {
    const channelId = this.platformVoiceSettingsChannelId();
    if (!channelId) {
      return null;
    }

    return this.voiceChannels().find((channel) => channel.id === channelId) ?? null;
  });
  readonly platformVoiceSettingsAccessEntries = computed(() => {
    const channelId = this.platformVoiceSettingsChannelId();
    if (!channelId) {
      return [];
    }

    return this.voiceAccessEntriesByChannelId()[channelId] ?? [];
  });
  readonly platformVoiceSettingsAccessView = computed<VoiceAdminAccessViewModel[]>(() =>
    [...this.platformVoiceSettingsAccessEntries()]
      .sort((left, right) => this.compareVoiceAccessEntries(left, right))
      .map((entry) => ({
        entry,
        roleLabel: this.formatVoiceAccessRole(entry.role),
        statusChips: this.buildVoiceAdminStatusChips(entry)
      }))
  );
  readonly platformVoiceSettingsOwnerEntry = computed(() =>
    this.platformVoiceSettingsAccessEntries().find((entry) => entry.role === 'owner') ?? null
  );
  readonly activePlatformVoiceRequests = computed(() => {
    const activeServer = this.activeServer();
    if (!activeServer || activeServer.kind !== 'workspace') {
      return [];
    }

    return this.ownerVoiceRequests()
      .filter((request) => request.server_id === activeServer.id && request.status === 'pending')
      .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));
  });
  readonly activePlatformVoiceRequestCount = computed(() => this.activePlatformVoiceRequests().length);
  readonly platformVoiceSettingsPendingRequests = computed(() => {
    const channelId = this.platformVoiceSettingsChannelId();
    if (!channelId) {
      return [];
    }

    return this.activePlatformVoiceRequests().filter((request) => request.channel_id === channelId);
  });
  readonly directDirectoryQueryNormalized = computed(() => this.directDirectoryQuery().trim().toLowerCase());
  readonly addGroupMemberQueryNormalized = computed(() => this.addGroupMemberQuery().trim().toLowerCase());
  readonly personalDirectoryCandidates = computed(() => {
    const query = this.directDirectoryQueryNormalized();
    return this.conversationDirectory()
      .filter((user) => {
        if (!query) {
          return true;
        }

        return (
          this.displayNick(user.nick).toLowerCase().includes(query)
          || user.login.toLowerCase().includes(query)
          || this.formatPublicUserId(user.public_id).includes(query)
        );
      })
      .sort((left, right) => {
        if (left.is_online !== right.is_online) {
          return left.is_online ? -1 : 1;
        }

        return this.displayNick(left.nick).localeCompare(this.displayNick(right.nick), 'ru');
      });
  });
  readonly personalKnownUsers = computed(() => {
    const currentUserId = this.currentUser()?.id ?? null;
    const usersById = new Map<string, ConversationDirectoryUser>();

    for (const conversation of this.directConversations()) {
      for (const member of conversation.members) {
        if (member.user_id === currentUserId || usersById.has(member.user_id)) {
          continue;
        }

        usersById.set(member.user_id, {
          user_id: member.user_id,
          public_id: member.public_id,
          login: member.login,
          nick: member.nick,
          avatar_updated_at: member.avatar_updated_at,
          is_online: member.is_online,
        });
      }
    }

    return [...usersById.values()];
  });
  readonly activeGroupKnownCandidates = computed(() => {
    const existingMemberIds = new Set(this.members().map((member) => member.user_id));
    const query = this.addGroupMemberQueryNormalized();
    return this.personalKnownUsers()
      .filter((user) => !existingMemberIds.has(user.user_id))
      .filter((user) => {
        if (!query) {
          return true;
        }

        return (
          this.displayNick(user.nick).toLowerCase().includes(query)
          || this.formatPublicUserId(user.public_id).includes(query)
        );
      })
      .sort((left, right) => {
        if (left.is_online !== right.is_online) {
          return left.is_online ? -1 : 1;
        }

        return this.displayNick(left.nick).localeCompare(this.displayNick(right.nick), 'ru');
      });
  });
  readonly currentUserAvatarUrl = computed(() =>
    this.buildUserAvatarUrl(this.currentUser()?.id ?? null, this.currentUser()?.avatar_updated_at ?? null)
  );
  readonly effectiveProfileAvatarUrl = computed(() => this.profileAvatarPreviewUrl() ?? this.currentUserAvatarUrl());
  readonly canSubmitProfile = computed(() => {
    const currentUser = this.currentUser();
    if (!currentUser || this.profileSaving()) {
      return false;
    }

    return (
      this.profileAvatarFile() !== null
      || this.profileAvatarRemove()
    );
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

    if (this.createPlatformLoading()) {
      return 'Создаем новую площадку';
    }

    if (this.createChannelLoading()) {
      return 'Создаем новый канал';
    }

    if (this.authLoading()) {
      return this.authMode() === 'register' ? 'Создаем аккаунт' : 'Выполняем вход';
    }

    if (this.workspaceLoading()) {
      return 'Загружаем чаты и каналы';
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
      return '';
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
    this.currentSpaceList().map((server) => ({
      id: server.id,
      label: this.buildServerLabel(server.name),
      name: server.name,
      iconUrl: this.resolveSpaceIconUrl(server.id, server.icon_asset, server.icon_updated_at),
      active: server.id === this.selectedServerId(),
      meta: server.kind === 'workspace'
        ? 'Площадка'
        : server.kind === 'direct'
          ? 'Друг'
          : 'Мини-группа'
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
          avatar_updated_at: participant.avatar_updated_at,
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
          publicId: member.public_id,
          login: member.login,
          nick: member.nick,
          avatarUpdatedAt: member.avatar_updated_at,
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
  readonly groupOwnershipCandidates = computed(() =>
    this.groupMembers().filter((member) => !member.isSelf)
  );
  readonly canManageGroupMembers = computed(() => this.canManageActiveGroup());

  readonly selectedMember = computed(() => {
    const userId = this.selectedMemberUserId();
    return this.groupMembers().find((member) => member.userId === userId) ?? null;
  });
  readonly selectedMemberDirectConversation = computed(() => {
    const member = this.selectedMember();
    return member ? this.findDirectConversationByUserId(member.userId) : null;
  });

  readonly selectedMemberVolume = computed(() => {
    const member = this.selectedMember();
    if (!member) {
      return 100;
    }

    return this.voiceRoom.getParticipantVolume(member.userId);
  });
  readonly selectedMemberDirectCallActive = computed(() => {
    const member = this.selectedMember();
    const peer = this.directCallPeer();
    if (!member || !peer || this.selectedVoiceMemberChannelId()) {
      return false;
    }

    return peer.user_id === member.userId;
  });
  readonly voiceAdminSelectedChannel = computed(() => {
    const selectedChannelId = this.voiceAdminSelectedChannelId();
    return this.voiceAdminChannels().find((channel) => channel.channel_id === selectedChannelId) ?? null;
  });
  readonly voiceAdminChannelNameOptions = computed<VoiceAdminChannelNameOption[]>(() => {
    const optionsByName = new Map<string, VoiceAdminChannelNameOption>();
    for (const channel of this.voiceAdminChannels()) {
      const existing = optionsByName.get(channel.channel_name);
      if (existing) {
        existing.groupsCount += 1;
        continue;
      }

      optionsByName.set(channel.channel_name, {
        name: channel.channel_name,
        groupsCount: 1
      });
    }

    return [...optionsByName.values()];
  });
  readonly voiceAdminGroupOptions = computed(() => {
    const selectedChannelName = this.voiceAdminSelectedChannelName();
    if (!selectedChannelName) {
      return [];
    }

    return [...this.voiceAdminChannels()]
      .filter((channel) => channel.channel_name === selectedChannelName)
      .sort((left, right) => this.compareServerNames(left.server_name, right.server_name));
  });

  readonly voiceAdminSelectedChannelAccess = computed(() => {
    const selectedChannelId = this.voiceAdminSelectedChannelId();
    if (!selectedChannelId) {
      return [];
    }

    return this.voiceAccessEntriesByChannelId()[selectedChannelId] ?? [];
  });
  readonly voiceAdminSelectedChannelAccessView = computed<VoiceAdminAccessViewModel[]>(() =>
    this.voiceAdminSelectedChannelAccess().map((entry) => ({
      entry,
      roleLabel: this.formatVoiceAccessRole(entry.role),
      statusChips: this.buildVoiceAdminStatusChips(entry)
    }))
  );
  readonly voiceAdminSelectedChannelStats = computed(() => {
    const entries = this.voiceAdminSelectedChannelAccess();
    return {
      total: entries.length,
      online: entries.filter((entry) => entry.is_online).length,
      inChannel: entries.filter((entry) => entry.is_in_channel).length,
      blocked: entries.filter((entry) => entry.owner_muted).length
    };
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

    if (this.currentUser()?.is_admin || this.canManageActiveGroup()) {
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

    if (role === 'guest') {
      return 'гость';
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

    const chatAttachment = this.chatAttachments().find((item) => item.id === attachmentId);
    if (chatAttachment) {
      return this.toAttachmentRecord(chatAttachment);
    }

    return null;
  });

  readonly openedImageAttachmentUrl = computed(() => {
    const attachment = this.openedImageAttachment();
    return attachment ? this.attachmentPreviewUrl(attachment) : null;
  });
  readonly chatGalleryAttachments = computed(() =>
    this.chatAttachments().filter((attachment) => this.isInlineImageAttachment(this.toAttachmentRecord(attachment)))
  );
  readonly chatFileAttachments = computed(() =>
    this.chatAttachments().filter((attachment) => !this.isInlineImageAttachment(this.toAttachmentRecord(attachment)))
  );

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
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.handleCallWindowKeydown);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('fullscreenchange', this.handleDocumentFullscreenChange);
    }

    this.destroyRef.onDestroy(() => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('keydown', this.handleCallWindowKeydown);
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('fullscreenchange', this.handleDocumentFullscreenChange);
      }
      this.appEvents.stop();
      this.directCall.stop();
      void this.releaseWakeLock();
      this.stopVoicePresencePolling();
      this.stopMemberPolling();
      this.stopMessageAutoRefreshPolling();
      this.stopVoiceJoinRequestPolling();
      this.stopVoiceJoinInboxPolling();
      this.stopPresenceKeepalive();
      this.teardownPresenceActivityTracking();
      this.clearPushFeedbackTimer();
      this.clearFullscreenControlsHideTimer();
      this.clearAttachmentPreviews();
      this.revokeProfileAvatarPreviewObjectUrl();
    });
    effect(() => {
      this.directCallLocalScreenStream();
      this.directCallRemoteScreenStream();
      if (!this.hasAnyDirectCallScreen() && this.directCallScreenExpanded()) {
        this.directCallScreenExpanded.set(false);
      }
      queueMicrotask(() => this.syncDirectCallScreenVideos());
    });
    effect(() => {
      const surfaceId = this.activeCallSurface()?.id ?? null;
      if (!surfaceId) {
        this.lastActiveCallSurfaceId = null;
        this.directCallScreenExpanded.set(false);
        this.callDockVolumeOpen.set(false);
        this.closeFullscreenMedia();
        return;
      }

      if (surfaceId !== this.lastActiveCallSurfaceId) {
        this.lastActiveCallSurfaceId = surfaceId;
        this.callWindowMode.set('expanded');
        this.callDockVolumeOpen.set(false);
      }
    });
    effect(() => {
      const activeChannelId = this.voiceRoom.activeChannelId();
      if (!activeChannelId) {
        if (this.activeVoiceCallSnapshot() !== null) {
          this.activeVoiceCallSnapshot.set(null);
        }
        return;
      }

      const visibleChannel = this.channels().find((channel) => channel.id === activeChannelId) ?? null;
      if (visibleChannel) {
        this.activeVoiceCallSnapshot.set(this.buildVoiceCallSnapshot(visibleChannel));
      }
    });
    effect(() => {
      const media = this.fullscreenMedia();
      if (!media) {
        return;
      }

      this.activeCallSurface();
      this.directCallLocalCameraStream();
      this.directCallRemoteCameraStream();
      this.directCallLocalScreenStream();
      this.directCallRemoteScreenStream();
      this.activeCallVoiceVideoScene();

      if (!this.fullscreenMediaStillAvailable(media)) {
        queueMicrotask(() => this.closeFullscreenMedia());
      }
    });
    effect(() => {
      const candidates = this.composerMentionCandidates();
      const activeIndex = this.composerMentionActiveIndex();
      if (!candidates.length) {
        if (activeIndex !== 0) {
          queueMicrotask(() => this.composerMentionActiveIndex.set(0));
        }
        return;
      }

      if (activeIndex > candidates.length - 1) {
        queueMicrotask(() => this.composerMentionActiveIndex.set(0));
      }
    });
    this.bindActionPipelines();
    this.browserPush.navigationRequests$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((conversationId) => this.handlePushConversationRequest(conversationId));
    this.appEvents.events$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => void this.handleAppEvent(event));
    this.setupPresenceActivityTracking();
    this.startPresenceKeepalive();
    this.loadHealth();
    this.restoreSession();
    void this.syncWakeLock();
  }

  private clearPushFeedbackTimer(): void {
    if (this.pushFeedbackTimeoutId === null) {
      return;
    }

    clearTimeout(this.pushFeedbackTimeoutId);
    this.pushFeedbackTimeoutId = null;
  }

  private setPushFeedback(feedback: { tone: PushFeedbackTone; message: string } | null): void {
    this.clearPushFeedbackTimer();
    this.pushFeedback.set(feedback);
    if (!feedback) {
      return;
    }

    this.pushFeedbackTimeoutId = setTimeout(() => {
      this.pushFeedback.set(null);
      this.pushFeedbackTimeoutId = null;
    }, 2000);
  }

  private bindActionPipelines(): void {
    this.bindAuthPipelines();
    this.bindGlobalSearchPipeline();
    this.bindMessageSearchPipeline();
    this.bindProfilePipeline();
    this.bindVoiceAdminPipelines();
    this.bindFriendRequestPipelines();
    this.bindRelationshipManagementPipelines();
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

  private bindGlobalSearchPipeline(): void {
    this.globalSearchQuery$
      .pipe(
        debounceTime(180),
        distinctUntilChanged(),
        switchMap((rawQuery) => {
          const token = this.session()?.access_token;
          const query = rawQuery.trim();
          if (!token || !query) {
            this.globalSearchLoading.set(false);
            this.globalSearchError.set(null);
            return of([] as WorkspaceChannelSearchResult[]);
          }

          this.globalSearchLoading.set(true);
          this.globalSearchError.set(null);
          return this.workspaceApi.searchWorkspaceChannels(token, query).pipe(
            catchError((error) => {
              this.globalSearchError.set(this.extractErrorMessage(error, 'Не удалось выполнить поиск по каналам'));
              return of([] as WorkspaceChannelSearchResult[]);
            }),
            finalize(() => {
              this.globalSearchLoading.set(false);
            })
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((results) => this.globalSearchChannelResults.set(results));
  }

  private bindMessageSearchPipeline(): void {
    this.messageSearchQuery$
      .pipe(
        debounceTime(180),
        distinctUntilChanged(
          (left, right) => left.channelId === right.channelId && left.query === right.query,
        ),
        switchMap(({ channelId, query: rawQuery }) => {
          const token = this.session()?.access_token;
          const query = rawQuery.trim();
          if (!token || !channelId || !query) {
            this.messageSearchLoading.set(false);
            this.messageSearchError.set(null);
            return of([] as WorkspaceMessageSearchResult[]);
          }

          this.messageSearchLoading.set(true);
          this.messageSearchError.set(null);
          return this.workspaceApi.searchChannelMessages(token, channelId, query).pipe(
            catchError((error) => {
              this.messageSearchError.set(this.extractErrorMessage(error, 'Не удалось выполнить поиск по сообщениям'));
              return of([] as WorkspaceMessageSearchResult[]);
            }),
            finalize(() => {
              this.messageSearchLoading.set(false);
            }),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((results) => this.messageSearchResults.set(results));
  }

  private bindFriendRequestPipelines(): void {
    this.sendFriendRequestTrigger$
      .pipe(
        exhaustMap(({ token, payload, successMessage, closeModal }) =>
          this.workspaceApi.createFriendRequest(token, payload).pipe(
            tap(() => {
              this.managementSuccess.set(successMessage);
              this.managementError.set(null);
              this.createConversationForm.directUserId = '';
              this.directDirectoryQuery.set('');
              void this.refreshFriendRequests(token);
              if (closeModal) {
                this.createConversationModalOpen.set(false);
                this.closeMemberVolume();
              }
            }),
            catchError((error) => {
              this.managementError.set(this.extractErrorMessage(error, 'Не удалось отправить запрос в друзья'));
              return EMPTY;
            }),
            finalize(() => {
              this.createConversationLoading.set(false);
            })
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    this.respondFriendRequestTrigger$
      .pipe(
        exhaustMap(({ token, requestId, action }) => {
          const request$ = action === 'accept'
            ? this.workspaceApi.acceptFriendRequest(token, requestId)
            : action === 'reject'
              ? this.workspaceApi.rejectFriendRequest(token, requestId)
              : this.workspaceApi.blockFriendRequest(token, requestId);

          const successMessage = action === 'accept'
            ? 'Пользователь добавлен в друзья'
            : action === 'reject'
              ? 'Запрос отклонен'
              : 'Пользователь заблокирован';

          return request$.pipe(
            tap(() => {
              this.managementSuccess.set(successMessage);
              this.friendRequestsError.set(null);
              void this.refreshFriendRequests(token);
              if (action === 'accept') {
                void this.refreshConversationsList(token);
                void this.loadConversationDirectory(token);
              }
              if (action === 'block' && this.blockedFriendsModalOpen()) {
                void this.refreshBlockedFriends(token);
              }
            }),
            catchError((error) => {
              this.friendRequestsError.set(this.extractErrorMessage(error, 'Не удалось обработать запрос'));
              return EMPTY;
            }),
            finalize(() => {
              this.friendRequestActionId.set(null);
            })
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private bindRelationshipManagementPipelines(): void {
    this.friendManagementTrigger$
      .pipe(
        exhaustMap(({ token, userId, action, successMessage }) => {
          const request$ = action === 'remove'
            ? this.workspaceApi.removeFriend(token, userId)
            : action === 'block'
              ? this.workspaceApi.blockFriend(token, userId)
              : this.workspaceApi.unblockFriend(token, userId);

          return request$.pipe(
            tap(() => {
              this.managementSuccess.set(successMessage);
              this.managementError.set(null);

              if (action === 'remove' || action === 'block') {
                const peer = this.activeDirectPeer();
                if (peer?.user_id === userId) {
                  void this.directCall.hangUp();
                  this.closeConversationActionMenu();
                }
                if (this.selectedMemberUserId() === userId) {
                  this.closeMemberVolume();
                }
                void this.refreshConversationsList(token);
                void this.loadConversationDirectory(token);
              }

              if (this.blockedFriendsModalOpen() || action === 'unblock' || action === 'block') {
                void this.refreshBlockedFriends(token);
              }
            }),
            catchError((error) => {
              this.managementError.set(
                this.extractErrorMessage(
                  error,
                  action === 'remove'
                    ? 'Не удалось удалить пользователя из друзей'
                    : action === 'block'
                      ? 'Не удалось заблокировать пользователя'
                      : 'Не удалось разблокировать пользователя'
                )
              );
              return EMPTY;
            }),
            finalize(() => {
              this.friendManagementPendingUserId.set(null);
            })
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    this.serverMembershipActionTrigger$
      .pipe(
        exhaustMap(({ token, serverId, action, payload, successMessage }) => {
          const request$ = action === 'leave'
            ? this.workspaceApi.leaveServer(token, serverId, payload ?? {})
            : action === 'block'
              ? this.workspaceApi.blockServer(token, serverId, payload ?? {})
              : this.workspaceApi.unblockServer(token, serverId);

          return request$.pipe(
            tap(() => {
              this.managementSuccess.set(successMessage);
              this.managementError.set(null);

              if (action === 'leave' || action === 'block') {
                if (this.selectedServerId() === serverId) {
                  this.closeConversationActionMenu();
                  this.closeGroupOwnershipModal();
                  this.closeGroupMembersPanel();
                  this.closeAddGroupMemberModal();
                  this.voiceRoom.leave();
                }
                void this.refreshServersList(token);
                void this.refreshConversationsList(token);
              }

              if (this.blockedServersModalOpen() || action === 'unblock' || action === 'block') {
                void this.refreshBlockedServers(token);
              }

              if (action === 'unblock') {
                void this.refreshServersList(token);
              }
            }),
            catchError((error) => {
              const activeSpaceLabel = this.activeManagedSpaceLabel();
              this.managementError.set(
                this.extractErrorMessage(
                  error,
                  action === 'leave'
                    ? `Не удалось выйти из ${activeSpaceLabel}`
                    : action === 'block'
                      ? `Не удалось заблокировать ${activeSpaceLabel}`
                      : 'Не удалось разблокировать пространство'
                )
              );
              return EMPTY;
            }),
            finalize(() => {
              this.serverMembershipActionPendingServerId.set(null);
            })
          );
        }),
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
    this.openDirectConversationTrigger$
      .pipe(
        exhaustMap(({ token, payload, closeModal }) =>
          this.workspaceApi.openDirectConversation(token, payload).pipe(
            tap((conversation) => {
              this.conversations.set(this.mergeConversationsById([...this.conversations(), conversation]));
              this.workspaceMode.set('chats');
              this.managementSuccess.set(`Личный чат «${conversation.title}» готов`);
              if (closeModal) {
                this.createConversationModalOpen.set(false);
                this.closeMemberVolume();
              }
              this.createConversationForm.directUserId = '';
              this.loadServerWorkspace(token, conversation.id);
            }),
            catchError((error) => {
              this.managementError.set(this.extractErrorMessage(error, 'Не удалось открыть личный чат'));
              return EMPTY;
            }),
            finalize(() => {
              this.createConversationLoading.set(false);
            })
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    this.createConversationSubmit$
      .pipe(
        exhaustMap(({ token, payload }) =>
          this.workspaceApi.createGroupConversation(token, payload).pipe(
            tap((conversation) => {
              this.conversations.set(this.mergeConversationsById([...this.conversations(), conversation]));
              this.workspaceMode.set('groups');
              this.createConversationModalOpen.set(false);
              this.conversationCreateTab.set('direct');
              this.createConversationForm.name = '';
              this.createConversationForm.directUserId = '';
              this.createConversationGroupMemberIds.set([]);
              this.managementSuccess.set(`Мини-группа «${conversation.title}» создана`);
              this.loadServerWorkspace(token, conversation.id);
            }),
            catchError((error) => {
              this.managementError.set(this.extractErrorMessage(error, 'Не удалось создать мини-группу'));
              return EMPTY;
            }),
            finalize(() => {
              this.createConversationLoading.set(false);
            })
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    this.addServerMemberTrigger$
      .pipe(
        exhaustMap(({ token, serverId, payload }) =>
          this.workspaceApi.addServerMember(token, serverId, payload).pipe(
            tap((member) => {
              this.members.update((currentMembers) => {
                if (currentMembers.some((entry) => entry.user_id === member.user_id)) {
                  return currentMembers;
                }

                return [...currentMembers, member];
              });
              this.addGroupMemberModalOpen.set(false);
              this.addGroupMemberUserId.set('');
              this.addGroupMemberQuery.set('');
              this.managementSuccess.set(
                `Участник ${this.displayNick(member.nick)} добавлен ${this.activeServer()?.kind === 'workspace' ? 'на площадку' : 'в группу'}`
              );
              void this.refreshConversationsList(token);
              void this.refreshMembers();
            }),
            catchError((error) => {
              this.managementError.set(this.extractErrorMessage(error, this.activeServer()?.kind === 'workspace' ? 'Не удалось добавить участника на площадку' : 'Не удалось добавить участника в группу'));
              return EMPTY;
            }),
            finalize(() => {
              this.addGroupMemberLoading.set(false);
            })
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    this.removeServerMemberTrigger$
      .pipe(
        exhaustMap(({ token, serverId, member }) =>
          this.workspaceApi.removeServerMember(token, serverId, member.userId).pipe(
            tap(() => {
              this.members.update((currentMembers) =>
                currentMembers.filter((entry) => entry.user_id !== member.userId)
              );

              if (this.selectedMemberUserId() === member.userId) {
                this.closeMemberVolume();
              }

              this.managementSuccess.set(
                `Участник ${this.displayNick(member.nick)} удален ${this.activeServer()?.kind === 'workspace' ? 'с площадки' : 'из группы'}`
              );
              void this.refreshConversationsList(token);
              void this.refreshMembers();
            }),
            catchError((error) => {
              this.managementError.set(this.extractErrorMessage(error, this.activeServer()?.kind === 'workspace' ? 'Не удалось удалить участника с площадки' : 'Не удалось удалить участника из группы'));
              return EMPTY;
            }),
            finalize(() => {
              this.removingGroupMemberUserId.set(null);
            })
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    this.createGroupSubmit$
      .pipe(
        exhaustMap(({ token, payload }) =>
          this.workspaceApi.createGroupConversation(token, payload).pipe(
            tap((conversation) => {
              this.conversations.set(this.mergeConversationsById([...this.conversations(), conversation]));
              this.workspaceMode.set('groups');
              this.createGroupForm.name = '';
              this.createGroupMemberIds.set([]);
              this.managementSuccess.set(`Группа «${conversation.title}» создана`);
              this.createGroupModalOpen.set(false);
              this.loadServerWorkspace(token, conversation.id);
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

    this.createPlatformSubmit$
      .pipe(
        exhaustMap(({ token, payload }) =>
          this.workspaceApi.createServer(token, payload).pipe(
            tap((server) => {
              this.servers.set(this.mergeServersById([...this.servers(), server]));
              this.workspaceMode.set('platforms');
              this.createPlatformForm.name = '';
              this.createPlatformForm.description = '';
              this.managementSuccess.set(`Площадка «${server.name}» создана`);
              this.createPlatformModalOpen.set(false);
              this.loadServerWorkspace(token, server.id);
            }),
            catchError((error) => {
              this.managementError.set(this.extractErrorMessage(error, 'Не удалось создать площадку'));
              return EMPTY;
            }),
            finalize(() => {
              this.createPlatformLoading.set(false);
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
        exhaustMap(({ token, channelId, payload }) => {
          let completed = false;
          let failed = false;

          return this.workspaceApi.sendMessage(token, channelId, payload).pipe(
            takeUntil(this.cancelMessageUploadTrigger$),
            tap((event: WorkspaceMessageUploadEvent) => {
              if (event.kind === 'progress') {
                this.messageUploadProgress.set({
                  loaded: event.loaded,
                  total: event.total,
                  percent: event.percent,
                });
                return;
              }

              completed = true;
              const message = event.message;
              this.messageDraft.set('');
              this.pendingFiles.set([]);
              this.selectedReplyMessage.set(null);
              this.clearComposerMentionState();
              this.scheduleMessageTextareaResize();
              this.messageUploadOutcome.set('idle');

              if (this.selectedChannelId() !== channelId) {
                return;
              }

              this.messages.update((messages) => this.mergeMessagesChronologically([...messages, message]));
              this.preloadInlineImagePreviews([message]);
              this.scrollMessagesToBottom();
              this.markChannelAsRead(channelId, message.id);
            }),
            catchError((error) => {
              failed = true;
              this.messageUploadOutcome.set('failed');
              this.messageError.set(this.extractErrorMessage(error, 'Не удалось отправить сообщение'));
              return EMPTY;
            }),
            finalize(() => {
              if (!completed && !failed && this.messageUploadCancelRequested) {
                this.messageUploadOutcome.set('cancelled');
              }

              this.messageUploadCancelRequested = false;
              this.messageSubmitting.set(false);
              this.messageUploadProgress.set(null);
            })
          )
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    this.markChannelReadTrigger$
      .pipe(
        switchMap(({ token, channelId, lastMessageId }) =>
          this.workspaceApi.markChannelRead(token, channelId, lastMessageId).pipe(catchError(() => EMPTY))
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    this.downloadAttachmentTrigger$
      .pipe(
        exhaustMap(({ token, attachment, surface }) =>
          this.workspaceApi.createAttachmentDownloadLink(token, attachment.id).pipe(
            tap(({ url }) => {
              this.clearAttachmentAvailability(attachment.id);
              const anchor = document.createElement('a');
              anchor.href = this.resolveApiUrl(url);
              anchor.download = attachment.filename;
              anchor.rel = 'noopener';
              anchor.style.display = 'none';
              document.body.appendChild(anchor);
              anchor.click();
              anchor.remove();
            }),
            catchError((error) => {
              this.handleAttachmentActionError(error, attachment.id, surface, 'Не удалось скачать файл');
              return EMPTY;
            }),
            finalize(() => {
              this.downloadingAttachmentIds.update((ids) => ids.filter((id) => id !== attachment.id));
            })
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    this.loadChatAttachmentsTrigger$
      .pipe(
        switchMap(({ token, channelId }) =>
          this.workspaceApi.getChannelAttachments(token, channelId).pipe(
            tap((attachments) => {
              if (!this.chatFilesModalOpen() || this.activeMessagingChannel()?.id !== channelId) {
                return;
              }

              this.chatAttachments.set(attachments);
              this.preloadChatAttachmentPreviews(attachments);
              if (this.chatMediaTab() === 'gallery' && !attachments.some((attachment) => this.isInlineImageAttachment(this.toAttachmentRecord(attachment)))) {
                this.chatMediaTab.set('files');
              }
              this.chatFilesError.set(null);
            }),
            catchError((error) => {
              this.chatFilesError.set(this.extractErrorMessage(error, 'Не удалось загрузить файлы чата'));
              return EMPTY;
            }),
            finalize(() => {
              this.chatFilesLoading.set(false);
            })
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    this.deleteChatAttachmentTrigger$
      .pipe(
        exhaustMap(({ token, attachmentId, surface }) =>
          this.workspaceApi.deleteAttachment(token, attachmentId).pipe(
            tap(() => {
              this.chatAttachments.update((items) => items.filter((item) => item.id !== attachmentId));
              this.applyAttachmentDeletedLocally(attachmentId);
              if (surface === 'chat') {
                this.chatFilesError.set(null);
              } else {
                this.messageError.set(null);
              }
            }),
            catchError((error) => {
              if (surface === 'chat') {
                this.chatFilesError.set(this.extractErrorMessage(error, 'Не удалось удалить файл'));
              } else {
                this.messageError.set(this.extractErrorMessage(error, 'Не удалось удалить файл'));
              }
              return EMPTY;
            }),
            finalize(() => {
              this.deletingChatAttachmentId.set(null);
            })
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    this.loadAttachmentPreviewTrigger$
      .pipe(
        mergeMap(({ token, attachment, openImageAfterLoad, reportErrors, surface }) =>
          this.workspaceApi.downloadAttachment(token, attachment.id).pipe(
            tap((blob) => {
              const objectUrl = URL.createObjectURL(blob);
              if (!this.shouldKeepAttachmentPreview(attachment.id)) {
                URL.revokeObjectURL(objectUrl);
                return;
              }

              this.clearAttachmentAvailability(attachment.id);
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
              this.handleAttachmentActionError(
                error,
                attachment.id,
                surface ?? 'message',
                'Не удалось загрузить вложение',
                reportErrors !== false
              );
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

  private bindProfilePipeline(): void {
    this.profileUpdateTrigger$
      .pipe(
        exhaustMap(({ token, avatarFile, removeAvatar, successMessage, closeEditor }) =>
          this.workspaceApi.updateCurrentUserProfile(token, {
            avatarFile,
            removeAvatar
          }).pipe(
            tap((updatedUser) => {
              this.applyCurrentUserProfile(updatedUser);
              this.profileNotice.set(successMessage);
              this.profileError.set(null);
              if (closeEditor) {
                this.profileEditorOpen.set(false);
              }
              this.clearPendingProfileAvatar();
            }),
            catchError((error) => {
              if (!closeEditor) {
                this.profileEditorOpen.set(true);
              }
              this.profileError.set(this.extractErrorMessage(error, 'Не удалось обновить профиль'));
              return EMPTY;
            }),
            finalize(() => {
              this.profileSaving.set(false);
            })
          )
        ),
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
              const memberName = this.displayNick(member.nick);
              this.managementSuccess.set(
                role === 'resident'
                  ? `${memberName} теперь житель канала`
                  : role === 'guest'
                    ? `${memberName} теперь гость канала`
                    : `${memberName} теперь чужак канала`
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
                this.managementSuccess.set(`${this.displayNick(member.nick)} отключен от канала`);
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
              const memberName = this.displayNick(member.nick);
              this.managementSuccess.set(
                nextOwnerMuted
                  ? `${memberName}: микрофон заблокирован владельцем`
                  : `${memberName}: блокировка микрофона снята`
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
              const keepModalOpen = this.ownerVoiceRequestModalOpen();
              this.ownerVoiceRequests.update((requests) => requests.filter((entry) => entry.id !== request.id));
              this.activeOwnerRequestId.set(this.ownerVoiceRequests()[0]?.id ?? null);
              this.ownerVoiceRequestModalOpen.set(keepModalOpen && this.ownerVoiceRequests().length > 0);
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
    this.uploadServerIconTrigger$
      .pipe(
        exhaustMap(({ token, serverId, file }) =>
          this.workspaceApi.uploadServerIcon(token, serverId, file).pipe(
            tap((updatedServer) => {
              this.servers.update((servers) =>
                servers
                  .map((server) => (server.id === updatedServer.id ? updatedServer : server))
                  .sort((left, right) => this.compareServers(left, right))
              );
              this.conversations.update((conversations) =>
                conversations.map((conversation) =>
                  conversation.id === updatedServer.id
                    ? {
                        ...conversation,
                        icon_asset: updatedServer.icon_asset,
                        icon_updated_at: updatedServer.icon_updated_at,
                      }
                    : conversation
                )
              );
              this.managementSuccess.set(`Иконка группы «${updatedServer.name}» обновлена`);
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
      email: this.loginForm.email.trim(),
      password: this.loginForm.password
    };

    if (!payload.email || !payload.password) {
      this.authError.set('Введите email и пароль');
      return;
    }

    this.authLoading.set(true);
    this.authError.set(null);
    this.loginSubmit$.next(payload);
  }

  submitRegistration(): void {
    const payload: AuthRegisterRequest = {
      email: this.registerForm.email.trim(),
      password: this.registerForm.password,
      password_confirmation: this.registerForm.password_confirmation,
      nick: this.registerForm.nick.trim()
    };

    if (!payload.email || !payload.password || !payload.password_confirmation || !payload.nick) {
      this.authError.set('Заполните email, ник и оба поля пароля');
      return;
    }

    if (payload.password !== payload.password_confirmation) {
      this.authError.set('Пароли не совпадают');
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

  openProfileEditor(): void {
    const currentUser = this.currentUser();
    if (!currentUser) {
      return;
    }

    this.closeMobilePanel();
    this.profileAvatarRemove.set(false);
    this.profileError.set(null);
    this.profileNotice.set(null);
    this.clearPendingProfileAvatar();
    this.profileEditorOpen.set(true);
  }

  closeProfileEditor(): void {
    this.profileEditorOpen.set(false);
    this.profileError.set(null);
    this.profileAvatarRemove.set(false);
    this.clearPendingProfileAvatar();
  }

  openProfileAvatarPicker(mode: 'instant' | 'editor' = 'instant'): void {
    this.profileAvatarSelectionMode = mode;
    this.profileError.set(null);
    this.profileNotice.set(null);
    this.profileAvatarInputRef?.nativeElement.click();
  }

  async onProfileAvatarSelection(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement | null;
    const selectedFile = input?.files?.[0] ?? null;
    if (input) {
      input.value = '';
    }

    if (!selectedFile) {
      return;
    }

    try {
      const preparedFile = await this.prepareProfileAvatarFile(selectedFile);
      if (this.profileAvatarSelectionMode === 'editor') {
        this.profileAvatarFile.set(preparedFile);
        this.profileAvatarRemove.set(false);
        this.setProfileAvatarPreview(preparedFile);
        return;
      }

      const token = this.session()?.access_token;
      const currentUser = this.currentUser();
      if (!token || !currentUser) {
        return;
      }

      this.profileSaving.set(true);
      this.profileError.set(null);
      this.profileNotice.set(null);
      this.profileUpdateTrigger$.next({
        token,
        avatarFile: preparedFile,
        removeAvatar: false,
        successMessage: 'Аватарка обновлена',
        closeEditor: false
      });
    } catch (error) {
      if (this.profileAvatarSelectionMode === 'instant') {
        this.profileEditorOpen.set(true);
      }
      this.profileError.set(error instanceof Error ? error.message : 'Не удалось подготовить аватарку');
    }
  }

  resetProfileAvatar(): void {
    if (!this.currentUserAvatarUrl() && !this.profileAvatarFile()) {
      return;
    }

    this.profileAvatarRemove.set(true);
    this.clearPendingProfileAvatar();
  }

  submitProfileChanges(): void {
    const token = this.session()?.access_token;
    if (!token || !this.currentUser()) {
      return;
    }


    if (!this.canSubmitProfile()) {
      this.profileEditorOpen.set(false);
      return;
    }

    this.profileSaving.set(true);
    this.profileError.set(null);
    this.profileNotice.set(null);
    this.profileUpdateTrigger$.next({
      token,
      avatarFile: this.profileAvatarFile(),
      removeAvatar: this.profileAvatarRemove(),
      successMessage: 'Профиль обновлен',
      closeEditor: true
    });
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

  toggleSideMenu(): void {
    this.closeQuickCreateMenu();
    this.sideMenuOpen.set(!this.sideMenuOpen());
  }

  closeSideMenu(): void {
    this.sideMenuOpen.set(false);
  }

  toggleQuickCreateMenu(): void {
    this.quickCreateMenuOpen.update((opened) => !opened);
  }

  closeQuickCreateMenu(): void {
    this.quickCreateMenuOpen.set(false);
  }

  openCreateGroupShortcut(): void {
    this.closeQuickCreateMenu();
    this.closeSideMenu();
    this.openCreateGroupModal();
  }

  openCreatePlatformShortcut(): void {
    this.closeQuickCreateMenu();
    this.closeSideMenu();
    this.openCreatePlatformModal();
  }

  openAddUserShortcut(): void {
    this.closeQuickCreateMenu();
    this.closeSideMenu();
    this.directDirectoryQuery.set('');
    this.openCreateConversationModal('direct');
  }

  openFriendRequestsModal(): void {
    const token = this.session()?.access_token;
    if (!token) {
      return;
    }

    this.friendRequestsModalOpen.set(true);
    this.friendRequestsLoading.set(true);
    this.friendRequestsError.set(null);
    this.attentionInboxLoading.set(true);
    this.attentionInboxError.set(null);
    void this.refreshAttentionInbox(token);
    void this.refreshVoiceJoinInbox();
    void this.refreshFriendRequests(token);
  }

  closeFriendRequestsModal(): void {
    this.friendRequestsModalOpen.set(false);
    this.friendRequestsLoading.set(false);
    this.friendRequestsError.set(null);
    this.attentionInboxLoading.set(false);
    this.attentionInboxError.set(null);
  }

  attentionMentionLocationLabel(item: AttentionMentionItem): string {
    if (item.server_kind === 'workspace') {
      return `${item.server_name} · ${item.channel_name ? '# ' + item.channel_name : 'канал'}`;
    }

    return item.server_name;
  }

  openAttentionMention(item: AttentionMentionItem): void {
    const token = this.session()?.access_token;
    if (!token) {
      return;
    }

    this.closeFriendRequestsModal();
    this.pendingMessageNavigation.set({
      serverId: item.server_id,
      channelId: item.channel_id,
      focusMessageId: item.focus_message_id,
      focusKind: 'mention',
    });
    this.workspaceMode.set(item.server_kind === 'workspace' ? 'platforms' : 'groups');

    if (this.selectedServerId() === item.server_id) {
      const targetChannel = this.channels().find((channel) => channel.id === item.channel_id) ?? null;
      if (targetChannel) {
        if (this.selectedChannelId() !== targetChannel.id || !this.messages().length) {
          void this.selectChannel(targetChannel, { connectVoice: false });
        } else {
          this.loadMessagesForChannel(token, targetChannel.id, undefined, this.buildInitialChannelLoadOptions(targetChannel));
        }
        return;
      }

      this.loadServerWorkspace(token, item.server_id);
      return;
    }

    this.selectServer(item.server_id);
  }

  respondToFriendRequest(requestId: string, action: 'accept' | 'reject' | 'block'): void {
    const token = this.session()?.access_token;
    if (!token || this.friendRequestActionId()) {
      return;
    }

    this.friendRequestActionId.set(requestId);
    this.friendRequestsError.set(null);
    this.respondFriendRequestTrigger$.next({ token, requestId, action });
  }

  isFriendRequestActionPending(requestId: string): boolean {
    return this.friendRequestActionId() === requestId;
  }

  openBlockedFriendsModal(): void {
    const token = this.session()?.access_token;
    if (!token) {
      return;
    }

    this.closeSideMenu();
    this.blockedFriendsModalOpen.set(true);
    this.blockedFriendsLoading.set(true);
    this.blockedFriendsError.set(null);
    void this.refreshBlockedFriends(token);
  }

  closeBlockedFriendsModal(): void {
    this.blockedFriendsModalOpen.set(false);
    this.blockedFriendsLoading.set(false);
    this.blockedFriendsError.set(null);
  }

  openBlockedServersModal(): void {
    const token = this.session()?.access_token;
    if (!token) {
      return;
    }

    this.closeSideMenu();
    this.blockedServersModalOpen.set(true);
    this.blockedServersLoading.set(true);
    this.blockedServersError.set(null);
    void this.refreshBlockedServers(token);
  }

  closeBlockedServersModal(): void {
    this.blockedServersModalOpen.set(false);
    this.blockedServersLoading.set(false);
    this.blockedServersError.set(null);
  }

  toggleConversationActionMenu(): void {
    this.conversationActionMenuOpen.update((opened) => !opened);
  }

  closeConversationActionMenu(): void {
    this.conversationActionMenuOpen.set(false);
  }

  togglePlatformSettingsDangerMenu(): void {
    this.platformSettingsDangerMenuOpen.update((opened) => !opened);
  }

  closePlatformSettingsDangerMenu(): void {
    this.platformSettingsDangerMenuOpen.set(false);
  }

  canManagePlatformVoiceChannel(channel: WorkspaceChannel): boolean {
    if (!this.isPlatformsMode() || channel.type !== 'voice') {
      return false;
    }

    if (this.canManageActiveGroup()) {
      return true;
    }

    return channel.voice_access_role === 'owner';
  }

  isPlatformVoiceSettingsSelected(channelId: string): boolean {
    return this.platformVoiceSettingsChannelId() === channelId;
  }

  openPlatformVoiceChannelSettings(channel: WorkspaceChannel): void {
    const token = this.session()?.access_token;
    if (!token || !this.canManagePlatformVoiceChannel(channel)) {
      return;
    }

    this.platformVoiceSettingsChannelId.set(channel.id);
    this.managementError.set(null);
    this.managementSuccess.set(null);
    void this.ensureVoiceChannelAccessLoaded(channel.id, true);
  }

  canPromotePlatformVoiceOwner(): boolean {
    return this.currentUser()?.is_admin === true || this.canManageActiveGroup();
  }

  isPlatformMemberManager(userId: string): boolean {
    const member = this.groupMembers().find((entry) => entry.userId === userId);
    return member?.role === 'owner' || member?.role === 'admin';
  }

  canEditPlatformVoiceRole(entry: VoiceChannelAccessEntry): boolean {
    const channel = this.platformVoiceSettingsChannel();
    if (!channel || !this.canManagePlatformVoiceChannel(channel)) {
      return false;
    }

    if (entry.role === 'owner') {
      return false;
    }

    if (!this.canPromotePlatformVoiceOwner() && this.isPlatformMemberManager(entry.user_id)) {
      return false;
    }

    return true;
  }

  platformVoiceRoleOptions(entry: VoiceChannelAccessEntry): VoiceAccessRole[] {
    const options: VoiceAccessRole[] = ['resident', 'guest', 'stranger'];
    if (this.canPromotePlatformVoiceOwner() || entry.role === 'owner') {
      options.unshift('owner');
    }

    return options;
  }

  updatePlatformVoiceRole(entry: VoiceChannelAccessEntry, roleValue: string): void {
    const token = this.session()?.access_token;
    const channel = this.platformVoiceSettingsChannel();
    if (!token || !channel || !this.canEditPlatformVoiceRole(entry)) {
      return;
    }

    const nextRole = roleValue as VoiceAccessRole;
    if (!this.platformVoiceRoleOptions(entry).includes(nextRole) || entry.role === nextRole) {
      return;
    }

    this.voiceAdminSaving.set(true);
    this.managementError.set(null);
    this.voiceAdminAccessMutation$.next({
      token,
      channelId: channel.id,
      userId: entry.user_id,
      role: nextRole,
      successMessage: 'Роль доступа к голосовому каналу обновлена',
      errorMessage: 'Не удалось обновить роль доступа к голосовому каналу',
    });
  }

  closeGroupOwnershipModal(): void {
    this.groupOwnershipModalOpen.set(false);
    this.pendingGroupOwnershipAction.set(null);
    this.groupOwnershipTransferUserId.set('');
  }

  isFriendManagementPending(userId: string): boolean {
    return this.friendManagementPendingUserId() === userId;
  }

  isServerMembershipActionPending(serverId: string): boolean {
    return this.serverMembershipActionPendingServerId() === serverId;
  }

  isActiveGroupActionPending(): boolean {
    const activeServer = this.activeServer();
    return !!activeServer && activeServer.kind !== 'direct' && this.isServerMembershipActionPending(activeServer.id);
  }

  removeActiveFriend(): void {
    const token = this.session()?.access_token;
    const peer = this.activeDirectPeer();
    if (!token || !peer || this.friendManagementPendingUserId()) {
      return;
    }

    this.friendManagementPendingUserId.set(peer.user_id);
    this.friendManagementTrigger$.next({
      token,
      userId: peer.user_id,
      action: 'remove',
      successMessage: `Пользователь ${this.displayNick(peer.nick)} удален из друзей`,
    });
  }

  blockActiveFriend(): void {
    const token = this.session()?.access_token;
    const peer = this.activeDirectPeer();
    if (!token || !peer || this.friendManagementPendingUserId()) {
      return;
    }

    this.friendManagementPendingUserId.set(peer.user_id);
    this.friendManagementTrigger$.next({
      token,
      userId: peer.user_id,
      action: 'block',
      successMessage: `Пользователь ${this.displayNick(peer.nick)} заблокирован`,
    });
  }

  unblockFriend(userId: string): void {
    const token = this.session()?.access_token;
    if (!token || this.friendManagementPendingUserId()) {
      return;
    }

    this.friendManagementPendingUserId.set(userId);
    this.friendManagementTrigger$.next({
      token,
      userId,
      action: 'unblock',
      successMessage: 'Пользователь разблокирован',
    });
  }

  leaveActiveGroup(): void {
    this.startActiveGroupMembershipAction('leave');
  }

  blockActiveGroup(): void {
    this.startActiveGroupMembershipAction('block');
  }

  leaveActivePlatform(): void {
    this.startActiveGroupMembershipAction('leave');
  }

  blockActivePlatform(): void {
    this.startActiveGroupMembershipAction('block');
  }

  unblockServer(serverId: string): void {
    const token = this.session()?.access_token;
    if (!token || this.serverMembershipActionPendingServerId()) {
      return;
    }

    this.serverMembershipActionPendingServerId.set(serverId);
    this.serverMembershipActionTrigger$.next({
      token,
      serverId,
      action: 'unblock',
      successMessage: 'Пространство разблокировано',
    });
  }

  submitGroupOwnershipTransfer(): void {
    const token = this.session()?.access_token;
    const activeServer = this.activeServer();
    const action = this.pendingGroupOwnershipAction();
    const newOwnerUserId = this.groupOwnershipTransferUserId().trim();
    if (!token || !activeServer || activeServer.kind === 'direct' || !action || !newOwnerUserId || this.serverMembershipActionPendingServerId()) {
      return;
    }

    const spaceLabel = activeServer.kind === 'workspace' ? 'Площадка' : 'Группа';
    this.serverMembershipActionPendingServerId.set(activeServer.id);
    this.serverMembershipActionTrigger$.next({
      token,
      serverId: activeServer.id,
      action,
      payload: {
        new_owner_user_id: newOwnerUserId,
      },
      successMessage: action === 'block' ? `${spaceLabel} передана и заблокирована` : `${spaceLabel} передана новому владельцу`,
    });
  }

  closeGroupForever(): void {
    const token = this.session()?.access_token;
    const activeServer = this.activeServer();
    const action = this.pendingGroupOwnershipAction();
    if (!token || !activeServer || activeServer.kind === 'direct' || !action || this.serverMembershipActionPendingServerId()) {
      return;
    }

    const spaceLabel = activeServer.kind === 'workspace' ? 'Площадка' : 'Группа';
    this.serverMembershipActionPendingServerId.set(activeServer.id);
    this.serverMembershipActionTrigger$.next({
      token,
      serverId: activeServer.id,
      action,
      payload: {
        close_group: true,
      },
      successMessage: `${spaceLabel} закрыта навсегда`,
    });
  }

  openAddGroupMemberModal(): void {
    const activeServer = this.activeServer();
    if (
      !this.session()?.access_token
      || !activeServer
      || (activeServer.kind !== 'group_chat' && activeServer.kind !== 'workspace')
      || !this.canManageActiveGroup()
    ) {
      return;
    }

    this.addGroupMemberUserId.set('');
    this.addGroupMemberQuery.set('');
    this.managementError.set(null);
    this.managementSuccess.set(null);
    this.addGroupMemberModalOpen.set(true);
  }

  closeAddGroupMemberModal(): void {
    this.addGroupMemberModalOpen.set(false);
    this.addGroupMemberUserId.set('');
    this.addGroupMemberQuery.set('');
  }

  openChatFilesModal(): void {
    const token = this.session()?.access_token;
    const activeChannel = this.activeMessagingChannel();
    if (!token || !activeChannel) {
      return;
    }

    this.chatFilesModalOpen.set(true);
    this.chatFilesLoading.set(true);
    this.chatFilesError.set(null);
    this.chatMediaTab.set('gallery');
    this.chatAttachments.set([]);
    this.loadChatAttachmentsTrigger$.next({
      token,
      channelId: activeChannel.id,
    });
  }

  closeChatFilesModal(): void {
    this.chatFilesModalOpen.set(false);
    this.chatFilesLoading.set(false);
    this.chatFilesError.set(null);
    this.chatAttachments.set([]);
    this.deletingChatAttachmentId.set(null);
  }

  selectChatMediaTab(tab: ChatMediaTab): void {
    this.chatMediaTab.set(tab);
  }

  downloadChatAttachment(attachment: WorkspaceChatAttachmentSummary): void {
    this.downloadAttachment(this.toAttachmentRecord(attachment), 'chat');
  }

  canDeleteChatAttachment(attachment: WorkspaceChatAttachmentSummary): boolean {
    return attachment.author.id === this.currentUser()?.id;
  }

  isDeletingChatAttachment(attachmentId: string): boolean {
    return this.deletingChatAttachmentId() === attachmentId;
  }

  deleteChatAttachment(attachment: WorkspaceChatAttachmentSummary): void {
    const token = this.session()?.access_token;
    if (!token || !this.canDeleteChatAttachment(attachment) || this.isDeletingChatAttachment(attachment.id)) {
      return;
    }

    this.deletingChatAttachmentId.set(attachment.id);
    this.chatFilesError.set(null);
    this.deleteChatAttachmentTrigger$.next({
      token,
      attachmentId: attachment.id,
      surface: 'chat',
    });
  }

  isChatGalleryAttachmentLoading(attachment: WorkspaceChatAttachmentSummary): boolean {
    return this.isAttachmentPreviewLoading(this.toAttachmentRecord(attachment));
  }

  chatAttachmentPreviewUrl(attachment: WorkspaceChatAttachmentSummary): string | null {
    return this.attachmentPreviewUrl(this.toAttachmentRecord(attachment));
  }

  openChatGalleryAttachment(attachment: WorkspaceChatAttachmentSummary): void {
    this.openImageAttachment(this.toAttachmentRecord(attachment), 'chat');
  }

  canDeleteMessageAttachment(message: WorkspaceMessage, attachment: WorkspaceMessageAttachment): boolean {
    return message.author.id === this.currentUser()?.id && !attachment.deleted_at;
  }

  isDeletingMessageAttachment(attachmentId: string): boolean {
    return this.isDeletingChatAttachment(attachmentId);
  }

  deleteMessageAttachment(
    attachment: WorkspaceMessageAttachment,
    surface: AttachmentActionSurface = 'message'
  ): void {
    const token = this.session()?.access_token;
    if (!token || attachment.deleted_at || !this.canDeleteAttachmentById(attachment.id) || this.isDeletingMessageAttachment(attachment.id)) {
      return;
    }

    this.deletingChatAttachmentId.set(attachment.id);
    if (surface === 'chat') {
      this.chatFilesError.set(null);
    } else {
      this.messageError.set(null);
    }
    this.deleteChatAttachmentTrigger$.next({
      token,
      attachmentId: attachment.id,
      surface,
    });
  }

  submitAddGroupMember(): void {
    const token = this.session()?.access_token;
    const serverId = this.selectedServerId();
    const selectedUserId = this.addGroupMemberUserId().trim();
    const payload = selectedUserId ? { user_id: selectedUserId } : null;
    if (!token || !serverId || !payload) {
      this.managementError.set(this.isPlatformsMode() ? 'Выберите пользователя для добавления на площадку' : 'Выберите пользователя для добавления в группу');
      return;
    }

    this.addGroupMemberLoading.set(true);
    this.managementError.set(null);
    this.managementSuccess.set(null);
    this.addServerMemberTrigger$.next({ token, serverId, payload });
  }

  updateGlobalSearchQuery(value: string): void {
    const nextValue = value.slice(0, 120);
    this.globalSearchQuery.set(nextValue);
    this.globalSearchError.set(null);
    if (!nextValue.trim()) {
      this.globalSearchChannelResults.set([]);
      this.globalSearchLoading.set(false);
    }
    this.globalSearchQuery$.next(nextValue);
  }

  clearGlobalSearch(): void {
    this.globalSearchQuery.set('');
    this.globalSearchLoading.set(false);
    this.globalSearchError.set(null);
    this.globalSearchChannelResults.set([]);
    this.globalSearchQuery$.next('');
  }

  toggleMessageSearchPanel(): void {
    if (!this.canUseActiveChannelChat()) {
      return;
    }

    if (this.messageSearchPanelOpen()) {
      this.closeMessageSearchPanel();
      return;
    }

    this.messageSearchPanelOpen.set(true);
    this.messageSearchError.set(null);
    this.focusMessageSearchInput();
  }

  closeMessageSearchPanel(): void {
    this.resetMessageSearchState();
  }

  updateMessageSearchQuery(value: string): void {
    const activeChannelId = this.activeMessagingChannel()?.id ?? null;
    const nextValue = value.slice(0, 120);
    this.messageSearchQuery.set(nextValue);
    this.messageSearchError.set(null);
    this.messageSearchFocusedMessageId.set(null);
    if (!nextValue.trim()) {
      this.messageSearchResults.set([]);
      this.messageSearchLoading.set(false);
    }
    this.messageSearchQuery$.next({ channelId: activeChannelId, query: nextValue });
  }

  focusMessageSearchResult(result: WorkspaceMessageSearchResult): void {
    const token = this.session()?.access_token;
    const activeChannel = this.activeMessagingChannel();
    if (!token || !activeChannel || activeChannel.id !== result.channel_id) {
      return;
    }

    this.messageSearchFocusedMessageId.set(result.id);
    if (this.messages().some((message) => message.id === result.id)) {
      this.openedUnreadAnchorMessageId.set(result.id);
      this.openedMessageFocusKind.set('search');
      this.scrollMessageIntoView(result.id);
      return;
    }

    this.loadMessagesForChannel(token, result.channel_id, undefined, {
      focusMessageId: result.id,
      focusKind: 'search',
      limit: MESSAGES_PAGE_SIZE,
    });
  }

  openGlobalSearchConversation(mode: WorkspaceMode, serverId: string): void {
    this.pendingSearchNavigation.set(null);
    this.clearGlobalSearch();
    this.applyWorkspaceMode(mode);
    this.selectServer(serverId);
  }

  openGlobalSearchChannel(result: WorkspaceChannelSearchResult): void {
    const token = this.session()?.access_token;
    if (!token) {
      return;
    }

    this.pendingSearchNavigation.set({
      serverId: result.server_id,
      channelId: result.channel_id,
    });
    this.clearGlobalSearch();
    this.applyWorkspaceMode('platforms');

    if (this.selectedServerId() === result.server_id) {
      const channel = this.channels().find((entry) => entry.id === result.channel_id) ?? null;
      if (channel) {
        void this.selectChannel(channel, { connectVoice: false });
        this.pendingSearchNavigation.set(null);
      } else {
        this.loadServerWorkspace(token, result.server_id);
      }
      return;
    }

    this.selectServer(result.server_id);
  }

  selectWorkspaceMode(mode: WorkspaceMode): void {
    if (this.workspaceMode() === mode) {
      return;
    }

    this.applyWorkspaceMode(mode);
    const spaces = mode === 'groups'
      ? this.groupConversationSpaces()
      : mode === 'platforms'
        ? this.platformSpaces()
        : this.directConversationSpaces();

    if (!spaces.some((space) => space.id === this.selectedServerId())) {
      const token = this.session()?.access_token;
      const nextSpaceId = spaces[0]?.id ?? null;
      if (token && nextSpaceId) {
        this.loadServerWorkspace(token, nextSpaceId);
      } else {
        this.selectedServerId.set(null);
        this.selectedChannelId.set(null);
        this.channels.set([]);
        this.members.set([]);
        this.voicePresence.set([]);
        this.resetTextChannelState();
      }
    }
  }

  private applyWorkspaceMode(mode: WorkspaceMode): void {
    this.closeQuickCreateMenu();
    this.closeConversationActionMenu();
    this.closeGroupOwnershipModal();
    this.workspaceMode.set(mode);
  }

  openMobileWorkspaceMode(mode: WorkspaceMode): void {
    if (!this.isCompactVoiceWorkspaceViewport()) {
      this.selectWorkspaceMode(mode);
      return;
    }

    const sameMode = this.workspaceMode() === mode;
    const serversPanelOpen = this.mobilePanel() === 'servers';
    if (sameMode && serversPanelOpen) {
      this.closeMobilePanel();
      return;
    }

    this.closeSideMenu();
    this.closeFriendRequestsModal();
    this.selectWorkspaceMode(mode);
    this.mobilePanel.set('servers');
  }

  toggleMobileFooterMenu(): void {
    if (!this.isCompactVoiceWorkspaceViewport()) {
      this.toggleSideMenu();
      return;
    }

    const shouldOpen = !this.sideMenuOpen();
    this.closeMobilePanel();
    this.closeFriendRequestsModal();
    this.closeQuickCreateMenu();
    this.sideMenuOpen.set(shouldOpen);
  }

  toggleMobileFooterNotifications(): void {
    if (!this.isCompactVoiceWorkspaceViewport()) {
      if (this.friendRequestsModalOpen()) {
        this.closeFriendRequestsModal();
      } else {
        this.openFriendRequestsModal();
      }
      return;
    }

    const shouldOpen = !this.friendRequestsModalOpen();
    this.closeMobilePanel();
    this.closeSideMenu();
    if (!shouldOpen) {
      this.closeFriendRequestsModal();
      return;
    }

    this.openFriendRequestsModal();
  }

  isMobileFooterWorkspaceModeActive(mode: WorkspaceMode): boolean {
    return this.workspaceMode() === mode && this.mobilePanel() === 'servers';
  }

  isMobileFooterMenuActive(): boolean {
    return this.sideMenuOpen();
  }

  isMobileFooterNotificationsActive(): boolean {
    return this.friendRequestsModalOpen();
  }

  openCreateGroupModal(): void {
    this.closeMobilePanel();
    this.createGroupForm.name = '';
    this.createGroupMemberIds.set([]);
    this.createGroupModalOpen.set(true);
    this.managementError.set(null);
    this.managementSuccess.set(null);
  }

  closeCreateGroupModal(): void {
    this.createGroupModalOpen.set(false);
    this.createGroupMemberIds.set([]);
  }

  openCreatePlatformModal(): void {
    this.closeMobilePanel();
    this.createPlatformForm.name = '';
    this.createPlatformForm.description = '';
    this.createPlatformModalOpen.set(true);
    this.managementError.set(null);
    this.managementSuccess.set(null);
  }

  closeCreatePlatformModal(): void {
    this.createPlatformModalOpen.set(false);
  }

  openCreateConversationModal(tab: ConversationCreateTab = 'direct'): void {
    if (!this.session()?.access_token) {
      return;
    }

    this.closeMobilePanel();
    this.workspaceMode.set(tab === 'group' ? 'groups' : 'chats');
    this.conversationCreateTab.set(tab);
    this.createConversationForm.directUserId = '';
    this.createConversationForm.name = '';
    this.createConversationGroupMemberIds.set([]);
    this.createConversationModalOpen.set(true);
    this.managementError.set(null);
    this.managementSuccess.set(null);
  }

  closeCreateConversationModal(): void {
    this.createConversationModalOpen.set(false);
    this.conversationCreateTab.set('direct');
  }

  switchConversationCreateTab(tab: ConversationCreateTab): void {
    this.conversationCreateTab.set(tab);
    this.managementError.set(null);
    this.managementSuccess.set(null);
  }

  private parsePublicUserId(value: string): number | null {
    const normalized = value.trim();
    if (!/^\d{5}$/.test(normalized)) {
      return null;
    }

    const parsed = Number(normalized);
    return Number.isInteger(parsed) ? parsed : null;
  }

  private resolveUserLookupPayload(
    selectedUserId: string,
    lookupValue: string,
  ): { user_id?: string | null; user_public_id?: number | null } | null {
    const normalizedUserId = selectedUserId.trim();
    if (normalizedUserId) {
      return { user_id: normalizedUserId };
    }

    const publicId = this.parsePublicUserId(lookupValue);
    if (publicId !== null) {
      return { user_public_id: publicId };
    }

    return null;
  }

  toggleCreateConversationMember(userId: string, selected: boolean): void {
    this.createConversationGroupMemberIds.update((memberIds) => {
      const nextIds = new Set(memberIds);
      if (selected) {
        nextIds.add(userId);
      } else {
        nextIds.delete(userId);
      }

      return [...nextIds];
    });
  }

  toggleCreateGroupMember(userId: string, selected: boolean): void {
    this.createGroupMemberIds.update((memberIds) => {
      const nextIds = new Set(memberIds);
      if (selected) {
        nextIds.add(userId);
      } else {
        nextIds.delete(userId);
      }

      return [...nextIds];
    });
  }

  openCreateChannelModal(type: ChannelKind): void {
    if (!this.canManageActiveGroup()) {
      return;
    }

    this.closeMobilePanel();
    this.platformSettingsModalOpen.set(false);
    this.createChannelForm.type = type;
    this.createChannelModalOpen.set(true);
    this.managementError.set(null);
    this.managementSuccess.set(null);
  }

  closeCreateChannelModal(): void {
    this.createChannelModalOpen.set(false);
  }

  openPlatformSettingsModal(): void {
    const activeServer = this.activeServer();
    if (!activeServer || activeServer.kind !== 'workspace' || !this.canOpenPlatformSettings()) {
      return;
    }

    this.closeConversationActionMenu();
    this.closePlatformSettingsDangerMenu();
    this.platformSettingsModalOpen.set(true);
    const preferredChannel =
      this.platformVoiceSettingsChannel()
      ?? this.platformManageableVoiceChannels()[0]
      ?? null;
    this.platformVoiceSettingsChannelId.set(preferredChannel?.id ?? null);
    if (preferredChannel) {
      const token = this.session()?.access_token;
      if (token) {
        void this.ensureVoiceChannelAccessLoaded(preferredChannel.id, true);
      }
    }
    this.managementError.set(null);
    this.managementSuccess.set(null);
  }

  closePlatformSettingsModal(): void {
    this.platformSettingsModalOpen.set(false);
    this.closePlatformSettingsDangerMenu();
    this.platformVoiceSettingsChannelId.set(null);
  }

  openPlatformSettingsAddMember(): void {
    this.closePlatformSettingsModal();
    this.openAddGroupMemberModal();
  }

  startPlatformSettingsMembershipAction(action: 'leave' | 'block'): void {
    this.startActiveGroupMembershipAction(action);
  }

  openPlatformSettingsMember(member: GroupMemberItem): void {
    this.closePlatformSettingsModal();
    this.openMemberCall(member);
  }

  platformMemberIdentityLabel(member: GroupMemberItem): string {
    return `ID: ${this.formatPublicUserId(member.publicId)} · ${member.roleLabel}`;
  }

  platformMemberPresenceLabel(member: GroupMemberItem): string {
    let activePresence: MemberPresenceTone = 'inactive';
    let activeChannelName: string | null = null;

    for (const channel of this.voicePresence()) {
      const participant = this.voiceParticipantsForChannel(channel.channel_id)
        .find((entry) => entry.user_id === member.userId);
      if (!participant) {
        continue;
      }

      const presence: MemberPresenceTone = participant.owner_muted
        ? 'blocked'
        : participant.speaking
          ? 'speaking'
          : participant.muted
            ? 'muted'
            : 'open';

      if (this.getPresenceWeight(presence) < this.getPresenceWeight(activePresence)) {
        activePresence = presence;
        activeChannelName = channel.channel_name;
      }
    }

    if (activeChannelName) {
      return this.formatVoiceActivityLabel(activePresence, activeChannelName);
    }

    return member.isOnline ? 'Онлайн' : 'Офлайн';
  }

  openServerIconPicker(): void {
    if (!this.canManageActiveGroup() || this.isCompactVoiceWorkspaceViewport() || !this.activeServer()) {
      return;
    }

    this.managementError.set(null);
    this.managementSuccess.set(null);
    this.serverIconInputRef?.nativeElement.click();
  }

  onServerIconSelection(event: Event): void {
    const token = this.session()?.access_token;
    const activeServer = this.activeServer();
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0] ?? null;
    if (!input) {
      return;
    }

    if (!token || !activeServer || this.serverIconSaving() || !file) {
      input.value = '';
      return;
    }

    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      this.managementError.set('Поддерживаются только PNG и JPG иконки группы');
      input.value = '';
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      this.managementError.set('Иконка группы превышает лимит 2 МБ');
      input.value = '';
      return;
    }

    this.serverIconSaving.set(true);
    this.managementError.set(null);
    this.managementSuccess.set(null);
    this.uploadServerIconTrigger$.next({
      token,
      serverId: activeServer.id,
      file,
    });
    input.value = '';
  }

  openGroupMembersPanel(): void {
    if (!this.isGroupsMode() && !this.isPlatformsMode()) {
      return;
    }

    this.groupMembersModalOpen.set(true);
  }

  closeGroupMembersPanel(): void {
    this.groupMembersModalOpen.set(false);
    this.removingGroupMemberUserId.set(null);
  }

  canRemoveGroupMember(member: GroupMemberItem): boolean {
    if (!this.canManageGroupMembers()) {
      return false;
    }

    if (member.isSelf) {
      return false;
    }

    return member.role !== 'owner';
  }

  isRemovingGroupMember(userId: string): boolean {
    return this.removingGroupMemberUserId() === userId;
  }

  removeGroupMember(member: GroupMemberItem): void {
    const token = this.session()?.access_token;
    const serverId = this.selectedServerId();
    if (!token || !serverId || !this.canRemoveGroupMember(member) || this.isRemovingGroupMember(member.userId)) {
      return;
    }

    this.managementError.set(null);
    this.managementSuccess.set(null);
    this.removingGroupMemberUserId.set(member.userId);
    this.removeServerMemberTrigger$.next({
      token,
      serverId,
      member,
    });
  }

  toggleGroupVoiceParticipantsExpanded(): void {
    const voiceChannel = this.activeGroupVoiceChannel();
    if (voiceChannel && this.connectedVoiceChannelId() === voiceChannel.id) {
      this.expandCallWindow();
      return;
    }

    this.groupVoiceParticipantsExpanded.update((expanded) => !expanded);
  }

  isPlatformVoiceChannelExpanded(channelId: string): boolean {
    return this.platformExpandedVoiceChannelId() === channelId;
  }

  isPlatformChannelSectionCollapsed(section: 'text' | 'voice'): boolean {
    return section === 'text' ? this.platformTextChannelsCollapsed() : this.platformVoiceChannelsCollapsed();
  }

  togglePlatformChannelSection(section: 'text' | 'voice'): void {
    if (section === 'text') {
      this.platformTextChannelsCollapsed.update((collapsed) => !collapsed);
      return;
    }

    const nextCollapsed = !this.platformVoiceChannelsCollapsed();
    this.platformVoiceChannelsCollapsed.set(nextCollapsed);
    if (nextCollapsed) {
      this.platformExpandedVoiceChannelId.set(null);
    }
  }

  togglePlatformVoiceChannelExpanded(channel: WorkspaceChannel): void {
    if (channel.type !== 'voice') {
      return;
    }

    if (this.connectedVoiceChannelId() === channel.id) {
      this.expandCallWindow();
      return;
    }

    this.platformVoiceChannelsCollapsed.set(false);
    this.platformExpandedVoiceChannelId.update((expandedChannelId) =>
      expandedChannelId === channel.id ? null : channel.id
    );
    void this.selectChannel(channel, { connectVoice: false });
  }

  openGroupMemberFromPanel(member: GroupMemberItem): void {
    this.closeGroupMembersPanel();
    this.openMemberCall(member);
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
      this.currentUser()?.is_admin === true || this.canManageActiveGroup() || currentChannel?.voice_access_role === 'owner';

    if (voiceChannelId && canManageVoiceChannel) {
      void this.ensureVoiceChannelAccessLoaded(voiceChannelId);
    }
  }

  openMemberCall(member: GroupMemberItem): void {
    this.closeMobilePanel();
    this.directCall.clearFeedback();
    this.selectedMemberUserId.set(member.userId);
    this.selectedVoiceMemberChannelId.set(null);
  }

  openActiveDirectPeerCall(): void {
    const peer = this.activeDirectPeer();
    if (!peer) {
      return;
    }

    this.directCall.clearFeedback();

    if (!peer.is_online) {
      this.setPushFeedback({
        tone: 'warning',
        message: `Друг ${this.displayNick(peer.nick)} сейчас офлайн`
      });
      return;
    }

    const activePeer = this.directCallPeer();
    if (this.hasDirectCall() && activePeer?.user_id === peer.user_id) {
      this.closeMobilePanel();
      this.selectedMemberUserId.set(null);
      this.selectedVoiceMemberChannelId.set(null);
      this.callWindowMode.set('expanded');
      return;
    }

    if (!this.directCallCanCall() && !this.hasDirectCall()) {
      this.setPushFeedback({
        tone: 'warning',
        message: 'Личный звонок пока недоступен'
      });
      return;
    }

    const directPeer: DirectCallPeer = {
      user_id: peer.user_id,
      nick: peer.nick,
      avatar_updated_at: peer.avatar_updated_at,
    };
    const target = this.directCallDescriptor(directPeer, 'Личный звонок');
    const action = () => {
      this.closeMobilePanel();
      this.selectedMemberUserId.set(null);
      this.selectedVoiceMemberChannelId.set(null);
      this.startDirectCall(directPeer);
    };

    if (!this.guardCallStart(target, action)) {
      return;
    }

    action();
  }

  private startActiveGroupMembershipAction(action: 'leave' | 'block'): void {
    const token = this.session()?.access_token;
    const activeServer = this.activeServer();
    if (!token || !activeServer || activeServer.kind === 'direct' || this.serverMembershipActionPendingServerId()) {
      return;
    }

    this.closeConversationActionMenu();
    this.closePlatformSettingsDangerMenu();
    if (activeServer.kind === 'workspace') {
      this.closePlatformSettingsModal();
    }
    if (this.isActiveGroupOwner()) {
      this.pendingGroupOwnershipAction.set(action);
      this.groupOwnershipTransferUserId.set('');
      this.groupOwnershipModalOpen.set(true);
      return;
    }

    const hiddenLabel = activeServer.kind === 'workspace' ? 'Площадка скрыта и заблокирована' : 'Группа скрыта и заблокирована';
    const leaveLabel = activeServer.kind === 'workspace' ? 'Вы вышли с площадки' : 'Вы вышли из группы';
    this.serverMembershipActionPendingServerId.set(activeServer.id);
    this.serverMembershipActionTrigger$.next({
      token,
      serverId: activeServer.id,
      action,
      payload: {},
      successMessage: action === 'block' ? hiddenLabel : leaveLabel,
    });
  }

  async toggleActiveGroupVoice(): Promise<void> {
    const voiceChannel = this.activeGroupVoiceChannel();
    if (!voiceChannel) {
      return;
    }

    if (this.connectedVoiceChannelId() === voiceChannel.id) {
      this.leaveVoiceChannel();
      return;
    }

    await this.handleVoiceChannelSelection(voiceChannel);
  }

  toggleGroupVoiceCamera(): void {
    if (!this.canToggleGroupVoiceCamera()) {
      return;
    }

    this.voiceRoom.toggleCamera();
  }

  canToggleGroupVoiceCamera(): boolean {
    return this.voiceCameraSupported() && this.connectedVoiceChannelId() === this.activeGroupVoiceChannel()?.id;
  }

  toggleGroupVoiceScreenShare(): void {
    if (!this.canToggleGroupVoiceScreenShare()) {
      return;
    }

    this.voiceRoom.toggleScreenShare();
  }

  canToggleGroupVoiceScreenShare(): boolean {
    return this.voiceScreenShareSupported() && this.connectedVoiceChannelId() === this.activeGroupVoiceChannel()?.id;
  }

  async togglePlatformVoiceChannel(channel: WorkspaceChannel, event?: Event): Promise<void> {
    event?.stopPropagation();
    if (channel.type !== 'voice') {
      return;
    }

    if (this.connectedVoiceChannelId() === channel.id) {
      this.leaveVoiceChannel();
      return;
    }

    const action = async () => {
      await this.selectChannel(channel, { connectVoice: false });
      this.platformExpandedVoiceChannelId.set(channel.id);
      await this.handleVoiceChannelSelection(channel, true);
    };

    if (!this.guardCallStart(this.voiceCallDescriptor(channel), action)) {
      return;
    }

    await action();
  }

  togglePlatformVoiceCamera(channel: WorkspaceChannel, event?: Event): void {
    event?.stopPropagation();
    if (!this.canTogglePlatformVoiceCamera(channel.id)) {
      return;
    }

    this.voiceRoom.toggleCamera();
  }

  canTogglePlatformVoiceCamera(channelId: string): boolean {
    return this.voiceCameraSupported() && this.connectedVoiceChannelId() === channelId;
  }

  togglePlatformVoiceScreenShare(channel: WorkspaceChannel, event?: Event): void {
    event?.stopPropagation();
    if (!this.canTogglePlatformVoiceScreenShare(channel.id)) {
      return;
    }

    this.voiceRoom.toggleScreenShare();
  }

  canTogglePlatformVoiceScreenShare(channelId: string): boolean {
    return this.voiceScreenShareSupported() && this.connectedVoiceChannelId() === channelId;
  }

  platformVoiceParticipantCount(channelId: string): number {
    return this.voiceParticipantsForChannel(channelId).length;
  }

  platformVoiceParticipants(channelId: string): VoiceParticipant[] {
    return this.voiceParticipantsForChannel(channelId);
  }

  voiceVideoSceneForChannel(channelId: string): VoiceVideoScene | null {
    if (this.connectedVoiceChannelId() !== channelId) {
      return null;
    }

    const participants = this.voiceParticipantsForChannel(channelId);
    const screenShareTiles = this.buildVoiceVideoTiles(participants, 'screen-share');
    const cameraTiles = this.buildVoiceVideoTiles(participants, 'camera');

    if (!screenShareTiles.length && !cameraTiles.length) {
      return null;
    }

    if (screenShareTiles.length) {
      const [stageTile, ...otherScreenShareTiles] = screenShareTiles;
      return {
        mode: 'presentation',
        stageTile,
        gridTiles: [],
        secondaryTiles: [...otherScreenShareTiles, ...cameraTiles],
        placeholderIds: [],
        gridClass: 'group-voice-video-grid--preview',
      };
    }

    const layout = this.voiceVideoLayoutForCount(cameraTiles.length);
    return {
      mode: layout,
      stageTile: null,
      gridTiles: cameraTiles,
      secondaryTiles: [],
      placeholderIds: this.voiceVideoPlaceholderIds(channelId, layout, cameraTiles.length),
      gridClass: `group-voice-video-grid--${layout}`,
    };
  }

  voiceVideoTileSourceLabel(tile: VoiceVideoTile): string {
    return tile.source === 'screen-share' ? 'Экран' : 'Камера';
  }

  voiceVideoTileStatusLabel(tile: VoiceVideoTile): string {
    if (tile.source === 'screen-share') {
      return tile.isSelf ? 'Вы показываете экран' : 'Показывает экран';
    }

    if (tile.isSelf) {
      return 'Вы';
    }

    if (tile.ownerMuted || tile.muted) {
      return 'Микрофон выключен';
    }

    return tile.speaking ? 'Говорит' : 'В эфире';
  }

  platformVoiceParticipantVolume(participant: VoiceParticipant): number {
    return this.groupVoiceParticipantVolume(participant);
  }

  setPlatformVoiceParticipantVolume(participant: VoiceParticipant, value: number | string): void {
    this.setGroupVoiceParticipantVolume(participant, value);
  }

  private buildVoiceVideoTiles(participants: VoiceParticipant[], source: VoiceVideoSource): VoiceVideoTile[] {
    const tiles = participants
      .map((participant) => {
        const stream = this.voiceVideoStreamForParticipant(participant, source);
        if (!stream) {
          return null;
        }

        return {
          id: `${participant.id}:${source}`,
          participantId: participant.id,
          userId: participant.user_id,
          nick: participant.nick,
          avatarUpdatedAt: participant.avatar_updated_at,
          stream,
          isSelf: participant.is_self,
          speaking: participant.speaking,
          muted: participant.muted,
          ownerMuted: participant.owner_muted,
          source,
        } satisfies VoiceVideoTile;
      })
      .filter((tile): tile is VoiceVideoTile => tile !== null);

    return tiles.sort((left, right) => {
      if (left.isSelf !== right.isSelf) {
        return left.isSelf ? 1 : -1;
      }

      if (left.source !== right.source) {
        return left.source === 'screen-share' ? -1 : 1;
      }

      if (left.speaking !== right.speaking) {
        return left.speaking ? -1 : 1;
      }

      return this.displayNick(left.nick).localeCompare(this.displayNick(right.nick), 'ru');
    });
  }

  private voiceVideoStreamForParticipant(participant: VoiceParticipant, source: VoiceVideoSource): MediaStream | null {
    if (participant.is_self) {
      return source === 'screen-share' ? this.voiceLocalScreenStream() : this.voiceLocalVideoStream();
    }

    return source === 'screen-share'
      ? this.voiceRoom.remoteScreenShareStreamForParticipant(participant.id)
      : this.voiceRoom.remoteVideoStreamForParticipant(participant.id);
  }

  private voiceVideoLayoutForCount(count: number): Exclude<VoiceVideoLayoutMode, 'presentation'> {
    if (count <= 1) {
      return 'grid-1';
    }

    if (count === 2) {
      return 'grid-2';
    }

    if (count <= 4) {
      return 'grid-4';
    }

    if (count <= 6) {
      return 'grid-6';
    }

    return 'grid-9';
  }

  private voiceVideoLayoutSlotCount(layout: Exclude<VoiceVideoLayoutMode, 'presentation'>): number {
    switch (layout) {
      case 'grid-1':
        return 1;
      case 'grid-2':
        return 2;
      case 'grid-4':
        return 4;
      case 'grid-6':
        return 6;
      case 'grid-9':
        return 9;
    }
  }

  private voiceVideoPlaceholderIds(
    channelId: string,
    layout: Exclude<VoiceVideoLayoutMode, 'presentation'>,
    tileCount: number,
  ): string[] {
    const placeholderCount = Math.max(0, this.voiceVideoLayoutSlotCount(layout) - tileCount);
    return Array.from({ length: placeholderCount }, (_, index) => `${channelId}:${layout}:placeholder:${index}`);
  }

  canTogglePlatformVoiceParticipantMute(participant: VoiceParticipant, channelId: string): boolean {
    return participant.is_self && this.connectedVoiceChannelId() === channelId;
  }

  togglePlatformVoiceParticipantMute(participant: VoiceParticipant, channelId: string): void {
    if (!this.canTogglePlatformVoiceParticipantMute(participant, channelId)) {
      return;
    }

    this.toggleVoiceMute();
  }

  platformVoiceChannelPendingRequestCount(channelId: string): number {
    return this.activePlatformVoiceRequests().filter((request) => request.channel_id === channelId).length;
  }

  platformVoiceChannelPendingRequestLabel(channelId: string): string {
    const count = this.platformVoiceChannelPendingRequestCount(channelId);
    if (count <= 0) {
      return '';
    }

    return count > 99 ? '99+' : String(count);
  }

  platformChannelMetaLabel(channel: WorkspaceChannel): string {
    if (channel.type === 'voice') {
      const metaParts = [`${this.platformVoiceParticipantCount(channel.id)} в голосе`];
      const pendingRequests = this.platformVoiceChannelPendingRequestCount(channel.id);
      if (pendingRequests > 0 && this.canManagePlatformVoiceChannel(channel)) {
        metaParts.push(`${pendingRequests} ждут`);
      }

      return metaParts.join(' · ');
    }

    return channel.topic?.trim() || 'Текстовый канал площадки';
  }

  isDefaultWorkspaceTextChannel(channel: WorkspaceChannel | null | undefined): boolean {
    if (!channel || channel.type !== 'text' || !this.isPlatformsMode()) {
      return false;
    }

    return channel.position === 0;
  }

  isProtectedWorkspaceChannel(channel: WorkspaceChannel | null | undefined): boolean {
    return this.isTavernChannel(channel) || this.isDefaultWorkspaceTextChannel(channel);
  }

  canDeleteWorkspaceChannel(channel: WorkspaceChannel): boolean {
    return this.canManageActiveGroup() && !this.isProtectedWorkspaceChannel(channel);
  }

  openDirectChatWithSelectedMember(): void {
    const token = this.session()?.access_token;
    const member = this.selectedMember();
    if (!token || !member || member.isSelf) {
      return;
    }

    const existingConversation = this.findDirectConversationByUserId(member.userId);
    if (existingConversation) {
      this.closeMemberVolume();
      this.workspaceMode.set('chats');
      this.loadServerWorkspace(token, existingConversation.id);
      return;
    }

    this.createConversationLoading.set(true);
    this.managementError.set(null);
    this.sendFriendRequestTrigger$.next({
      token,
      payload: { user_id: member.userId },
      successMessage: `Запрос в друзья отправлен пользователю ${this.displayNick(member.nick)}`,
      closeModal: true,
    });
  }

  closeMemberVolume(): void {
    this.selectedMemberUserId.set(null);
    this.selectedVoiceMemberChannelId.set(null);
  }

  closePendingCallSwitch(): void {
    this.pendingCallSwitch.set(null);
  }

  async confirmCallSwitch(): Promise<void> {
    const pendingSwitch = this.pendingCallSwitch();
    if (!pendingSwitch) {
      return;
    }

    this.pendingCallSwitch.set(null);
    await this.stopCallByDescriptor(pendingSwitch.current);
    await pendingSwitch.action();
    this.callWindowMode.set('expanded');
  }

  private guardCallStart(target: CallSwitchDescriptor, action: () => void | Promise<void>): boolean {
    const conflict = this.findCallConflict(target);
    if (!conflict) {
      return true;
    }

    this.pendingCallSwitch.set({
      current: conflict,
      target,
      confirmLabel: target.kind === 'direct' && this.directCallState() === 'incoming' ? 'Ответить и перейти' : 'Перейти',
      action,
    });
    this.callWindowMode.set('minimized');
    return false;
  }

  private findCallConflict(target: CallSwitchDescriptor): CallSwitchDescriptor | null {
    if (target.kind === 'direct') {
      const voiceCall = this.currentVoiceCallDescriptor();
      if (voiceCall) {
        return voiceCall;
      }

      const directCall = this.currentDirectCallDescriptor();
      return directCall && directCall.id !== target.id ? directCall : null;
    }

    const directCall = this.currentDirectCallDescriptor();
    if (directCall) {
      return directCall;
    }

    const voiceCall = this.currentVoiceCallDescriptor();
    return voiceCall && voiceCall.id !== target.id ? voiceCall : null;
  }

  private currentDirectCallDescriptor(): CallSwitchDescriptor | null {
    const peer = this.directCallPeer();
    if (!peer || !this.hasDirectCall()) {
      return null;
    }

    return this.directCallDescriptor(peer, this.directCallStatusLabel());
  }

  private currentVoiceCallDescriptor(): CallSwitchDescriptor | null {
    if (!this.hasVoiceSession()) {
      return null;
    }

    const channel = this.connectedVoiceChannel();
    if (!channel) {
      return null;
    }

    const snapshot = this.activeVoiceCallSnapshot();
    return this.voiceCallDescriptor(channel, snapshot?.channel.id === channel.id ? snapshot : undefined);
  }

  private directCallDescriptor(peer: DirectCallPeer, subtitle = 'Личный звонок'): CallSwitchDescriptor {
    return {
      kind: 'direct',
      id: `direct:${peer.user_id}`,
      title: this.displayNick(peer.nick),
      subtitle,
      channelId: null,
    };
  }

  private buildVoiceCallSnapshot(channel: WorkspaceChannel): VoiceCallSnapshot {
    const server =
      this.currentSpaceList().find((entry) => entry.id === channel.server_id)
      ?? this.activeServer();
    const kind: VoiceCallSurfaceKind = server?.kind === 'workspace' ? 'platform' : 'group';

    return {
      kind,
      serverId: channel.server_id,
      serverName: server?.name ?? (kind === 'platform' ? 'Площадка' : 'Группа'),
      channel,
    };
  }

  private voiceCallDescriptor(channel: WorkspaceChannel, snapshot = this.buildVoiceCallSnapshot(channel)): CallSwitchDescriptor {
    return {
      kind: snapshot.kind,
      id: `${snapshot.kind}:${channel.id}`,
      title: `${snapshot.serverName} → ${channel.name}`,
      subtitle: snapshot.kind === 'platform' ? 'Площадка' : 'Группа',
      channelId: channel.id,
    };
  }

  private async stopCallByDescriptor(call: CallSwitchDescriptor): Promise<void> {
    this.directCallScreenExpanded.set(false);
    if (call.kind === 'direct') {
      if (this.directCallState() === 'incoming') {
        this.rejectDirectCall();
        return;
      }

      await this.hangupDirectCall();
      return;
    }

    if (this.connectedVoiceChannelId()) {
      this.leaveVoiceChannel();
    }
  }

  private startDirectCall(peer: DirectCallPeer): void {
    this.directCall.openCall(peer);
    this.callWindowMode.set('expanded');
    this.closeMemberVolume();
  }

  minimizeCallWindow(event?: Event): void {
    event?.stopPropagation();
    if (!this.activeCallSurface()) {
      return;
    }

    this.directCallScreenExpanded.set(false);
    this.callDockVolumeOpen.set(false);
    this.callWindowMode.set('minimized');
  }

  expandCallWindow(event?: Event): void {
    event?.stopPropagation();
    if (!this.activeCallSurface()) {
      return;
    }

    this.callDockVolumeOpen.set(false);
    this.callWindowMode.set('expanded');
  }

  toggleActiveCallMute(event?: Event): void {
    event?.stopPropagation();
    const surface = this.activeCallSurface();
    if (!surface) {
      return;
    }

    if (surface.kind === 'direct') {
      this.directCall.toggleLocalMute();
      return;
    }

    this.toggleVoiceMute();
  }

  changeActiveCallVolume(value: number | string): void {
    const surface = this.activeCallSurface();
    if (!surface) {
      return;
    }

    if (surface.kind === 'direct') {
      this.directCall.updateRemoteVolume(value);
      return;
    }

    this.changeMasterVolume(value);
  }

  toggleCallDockVolume(event?: Event): void {
    event?.stopPropagation();
    if (!this.activeCallSurface()) {
      this.callDockVolumeOpen.set(false);
      return;
    }

    this.callDockVolumeOpen.update((open) => !open);
  }

  closeCallDockVolume(): void {
    this.callDockVolumeOpen.set(false);
  }

  async endActiveCall(event?: Event): Promise<void> {
    event?.stopPropagation();
    const surface = this.activeCallSurface();
    if (!surface) {
      return;
    }

    this.directCallScreenExpanded.set(false);
    this.callDockVolumeOpen.set(false);
    if (surface.kind === 'direct') {
      if (this.directCallState() === 'incoming') {
        this.rejectDirectCall();
        return;
      }

      await this.hangupDirectCall();
      return;
    }

    this.leaveVoiceChannel();
    this.callWindowMode.set('expanded');
  }

  toggleActiveCallCamera(event?: Event): void {
    event?.stopPropagation();
    const surface = this.activeCallSurface();
    if (!surface || !this.activeCallCanUseCamera()) {
      return;
    }

    if (surface.kind === 'direct') {
      this.toggleDirectCallCamera();
      return;
    }

    this.voiceRoom.toggleCamera();
  }

  toggleActiveCallScreenShare(event?: Event): void {
    event?.stopPropagation();
    const surface = this.activeCallSurface();
    if (!surface || !this.activeCallCanShareScreen()) {
      return;
    }

    if (surface.kind === 'direct') {
      if (this.directCallScreenSharing()) {
        this.stopDirectCallScreenShare();
      } else {
        this.startDirectCallScreenShare();
      }
      return;
    }

    this.voiceRoom.toggleScreenShare();
  }

  openActiveCallSettings(event?: Event): void {
    event?.stopPropagation();
    const surface = this.activeCallSurface();
    if (surface?.kind !== 'platform' || !surface.channelId || !this.canOpenPlatformSettings()) {
      return;
    }

    this.openPlatformSettingsModal();
    this.platformVoiceSettingsChannelId.set(surface.channelId);
    const token = this.session()?.access_token;
    if (token) {
      void this.ensureVoiceChannelAccessLoaded(surface.channelId, true);
    }
  }

  directCallSurfaceStatusLabel(): string {
    const state = this.directCallState();
    if (state === 'connected' || state === 'idle') {
      return '';
    }

    return this.directCallStatusLabel();
  }

  voiceCallStateLabel(): string {
    switch (this.voiceState()) {
      case 'connecting':
        return 'Подключаем';
      case 'error':
        return this.voiceError() ?? 'Нет связи';
      case 'connected':
      case 'idle':
        return '';
    }
  }

  directCallStatusLabel(): string {
    switch (this.directCallState()) {
      case 'incoming':
        return 'Входящий звонок';
      case 'outgoing':
        return 'Звоним';
      case 'connecting':
        return 'Подключаем';
      case 'connected':
        return 'Звонок идет';
      case 'idle':
        return 'Звонок завершен';
    }
  }

  activeCallMuteLabel(): string {
    const surface = this.activeCallSurface();
    if (!surface) {
      return 'Микрофон';
    }

    if (surface.kind !== 'direct' && this.voiceOwnerMuted()) {
      return 'Микрофон заблокирован владельцем';
    }

    return this.activeCallMuted() ? 'Включить микрофон' : 'Выключить микрофон';
  }

  activeCallKindLabel(kind: CallSurfaceKind): string {
    if (kind === 'direct') {
      return 'Личный звонок';
    }

    return kind === 'platform' ? 'Площадка' : 'Группа';
  }

  startDirectCallToSelectedMember(): void {
    const member = this.selectedMember();
    if (!member || member.isSelf) {
      return;
    }

    const peer: DirectCallPeer = {
      user_id: member.userId,
      nick: member.nick,
      avatar_updated_at: member.avatarUpdatedAt,
    };
    const action = () => this.startDirectCall(peer);

    if (!this.guardCallStart(this.directCallDescriptor(peer, 'Личный звонок'), action)) {
      return;
    }

    action();
  }

  acceptDirectCall(): void {
    const peer = this.directCallPeer();
    if (peer) {
      const action = () => {
        this.directCall.acceptIncoming();
        this.callWindowMode.set('expanded');
      };

      if (!this.guardCallStart(this.directCallDescriptor(peer, 'Входящий звонок'), action)) {
        return;
      }

      action();
      return;
    }

    this.directCall.acceptIncoming();
    this.callWindowMode.set('expanded');
  }

  rejectDirectCall(): void {
    this.directCall.rejectIncoming();
  }

  async hangupDirectCall(closeModal = false): Promise<void> {
    this.directCallScreenExpanded.set(false);
    await this.directCall.hangUp();
    if (closeModal) {
      this.closeMemberVolume();
    }
  }

  startDirectCallScreenShare(): void {
    void this.directCall.startScreenShare();
  }

  stopDirectCallScreenShare(): void {
    void this.directCall.stopScreenShare();
  }

  toggleDirectCallCamera(): void {
    if (!this.canToggleDirectCallCamera()) {
      return;
    }

    if (this.directCallCameraEnabled()) {
      void this.directCall.stopCamera();
      return;
    }

    void this.directCall.startCamera();
  }

  expandDirectCallScreen(): void {
    const hasRemoteScreen = this.directCallRemoteScreenStream();
    this.openDirectCallFullscreenMedia('screen-share', !hasRemoteScreen);
  }

  collapseDirectCallScreen(): void {
    this.directCallScreenExpanded.set(false);
  }

  openDirectCallFullscreenMedia(source: VoiceVideoSource, isSelf: boolean, event?: Event): void {
    event?.stopPropagation();
    const stream = this.directCallFullscreenStream(source, isSelf);
    if (!stream) {
      return;
    }

    const peer = this.directCallPeer();
    const title = isSelf ? 'Вы' : this.displayNick(peer?.nick ?? 'Собеседник');
    const subtitle = source === 'screen-share'
      ? (isSelf ? 'Ваш экран' : 'Экран собеседника')
      : (isSelf ? 'Ваша камера' : 'Камера собеседника');

    this.openCallFullscreenMedia({
      id: `direct:${isSelf ? 'self' : 'peer'}:${source}`,
      tileId: null,
      callId: this.activeCallSurface()?.id ?? null,
      kind: 'direct',
      source,
      title,
      subtitle,
      stream,
      isSelf,
    });
  }

  openVoiceTileFullscreenMedia(tile: VoiceVideoTile, event?: Event): void {
    event?.stopPropagation();
    const surface = this.activeCallSurface();
    this.openCallFullscreenMedia({
      id: `${surface?.id ?? 'voice'}:${tile.id}`,
      tileId: tile.id,
      callId: surface?.id ?? null,
      kind: surface?.kind === 'platform' ? 'platform' : 'group',
      source: tile.source,
      title: this.displayNick(tile.nick),
      subtitle: tile.source === 'screen-share'
        ? (tile.isSelf ? 'Ваш экран' : 'Демонстрация экрана')
        : (tile.isSelf ? 'Ваша камера' : 'Камера'),
      stream: tile.stream,
      isSelf: tile.isSelf,
    });
  }

  closeFullscreenMedia(event?: Event): void {
    event?.stopPropagation();
    const shouldExitNativeFullscreen =
      typeof document !== 'undefined'
      && document.fullscreenElement === this.callFullscreenLayerElement
      && typeof document.exitFullscreen === 'function';

    this.fullscreenMedia.set(null);
    this.fullscreenMediaControlsVisible.set(true);
    this.callFullscreenRequestPending = false;
    this.callFullscreenNativeActive = false;
    this.directCallScreenExpanded.set(false);
    this.clearFullscreenControlsHideTimer();

    if (shouldExitNativeFullscreen) {
      void document.exitFullscreen().catch(() => undefined);
    }
  }

  showFullscreenMediaControls(event?: Event): void {
    event?.stopPropagation();
    if (!this.fullscreenMedia()) {
      return;
    }

    this.fullscreenMediaControlsVisible.set(true);
    this.scheduleFullscreenControlsHide();
  }

  fullscreenMediaSourceLabel(media: FullscreenMediaState): string {
    return media.source === 'screen-share' ? 'Экран' : 'Камера';
  }

  canToggleDirectCallScreenShare(): boolean {
    if (!this.directCallScreenSupported()) {
      return false;
    }

    if (this.directCallScreenSharing()) {
      return true;
    }

    return this.directCallState() === 'connected';
  }

  canToggleDirectCallCamera(): boolean {
    return this.directCallCameraSupported() && this.directCallState() === 'connected';
  }

  canStartDirectCallToSelectedMember(): boolean {
    const member = this.selectedMember();
    if (!member || member.isSelf || this.selectedVoiceMemberChannelId()) {
      return false;
    }

    const peer = this.directCallPeer();
    if (!peer) {
      return this.directCallCanCall();
    }

    if (peer.user_id !== member.userId) {
      return false;
    }

    return this.directCallState() === 'idle';
  }

  selectedMemberHasOtherDirectCall(): boolean {
    const member = this.selectedMember();
    const peer = this.directCallPeer();
    if (!member || !peer || this.selectedVoiceMemberChannelId()) {
      return false;
    }

    return this.hasDirectCall() && peer.user_id !== member.userId;
  }

  directCallPeerLabel(): string {
    const peer = this.directCallPeer();
    if (!peer) {
      return 'собеседник';
    }

    return this.displayNick(peer.nick);
  }

  private syncDirectCallScreenVideos(): void {
    const localStream = this.directCallLocalScreenStream();
    const remoteStream = this.directCallRemoteScreenStream();

    for (const video of [
      this.directCallLocalScreenVideoElement,
      this.directCallExpandedLocalScreenVideoElement
    ]) {
      if (video && video.srcObject !== localStream) {
        video.srcObject = localStream;
      }
    }

    for (const video of [
      this.directCallRemoteScreenVideoElement,
      this.directCallExpandedRemoteScreenVideoElement
    ]) {
      if (video && video.srcObject !== remoteStream) {
        video.srcObject = remoteStream;
      }
    }
  }

  private openCallFullscreenMedia(media: FullscreenMediaState): void {
    this.directCallScreenExpanded.set(false);
    this.fullscreenMedia.set(media);
    this.fullscreenMediaControlsVisible.set(true);
    this.callFullscreenRequestPending = true;
    this.scheduleFullscreenControlsHide();
    queueMicrotask(() => {
      if (this.callFullscreenRequestPending) {
        void this.enterNativeCallFullscreen();
      }
    });
  }

  private directCallFullscreenStream(source: VoiceVideoSource, isSelf: boolean): MediaStream | null {
    if (source === 'screen-share') {
      return isSelf ? this.directCallLocalScreenStream() : this.directCallRemoteScreenStream();
    }

    return isSelf ? this.directCallLocalCameraStream() : this.directCallRemoteCameraStream();
  }

  private fullscreenMediaStillAvailable(media: FullscreenMediaState): boolean {
    if (!this.streamHasLiveTrack(media.stream) || !this.activeCallSurface()) {
      return false;
    }

    if (media.kind === 'direct') {
      return this.directCallFullscreenStream(media.source, media.isSelf) === media.stream;
    }

    const scene = this.activeCallVoiceVideoScene();
    if (!scene || !media.tileId) {
      return false;
    }

    return [
      ...(scene.stageTile ? [scene.stageTile] : []),
      ...scene.gridTiles,
      ...scene.secondaryTiles,
    ].some((tile) => tile.id === media.tileId && tile.stream === media.stream);
  }

  private streamHasLiveTrack(stream: MediaStream): boolean {
    return stream.getTracks().some((track) => track.readyState === 'live');
  }

  private async enterNativeCallFullscreen(): Promise<void> {
    const layer = this.callFullscreenLayerElement;
    this.callFullscreenRequestPending = false;
    if (!layer || typeof layer.requestFullscreen !== 'function') {
      return;
    }

    try {
      await layer.requestFullscreen();
      this.callFullscreenNativeActive = true;
    } catch {
      this.callFullscreenNativeActive = false;
    }
  }

  private scheduleFullscreenControlsHide(): void {
    this.clearFullscreenControlsHideTimer();
    this.fullscreenControlsHideTimeoutId = setTimeout(() => {
      if (this.fullscreenMedia()) {
        this.fullscreenMediaControlsVisible.set(false);
      }
    }, 2600);
  }

  private clearFullscreenControlsHideTimer(): void {
    if (!this.fullscreenControlsHideTimeoutId) {
      return;
    }

    clearTimeout(this.fullscreenControlsHideTimeoutId);
    this.fullscreenControlsHideTimeoutId = null;
  }

  selectVoiceAdminChannelName(channelName: string): void {
    if (this.voiceAdminSelectedChannelName() === channelName) {
      return;
    }

    this.voiceAdminSelectedChannelName.set(channelName);
    const matchingChannels = this.voiceAdminChannels()
      .filter((channel) => channel.channel_name === channelName)
      .sort((left, right) => this.compareServerNames(left.server_name, right.server_name));

    const nextChannel = matchingChannels.length === 1 ? matchingChannels[0] : null;
    this.voiceAdminSelectedServerId.set(nextChannel?.server_id ?? null);
    this.voiceAdminSelectedChannelId.set(nextChannel?.channel_id ?? null);

    if (nextChannel) {
      void this.ensureVoiceChannelAccessLoaded(nextChannel.channel_id, true);
    }
  }

  selectVoiceAdminChannel(channel: VoiceAdminChannel): void {
    this.voiceAdminSelectedChannelName.set(channel.channel_name);
    this.voiceAdminSelectedServerId.set(channel.server_id);
    this.voiceAdminSelectedChannelId.set(channel.channel_id);
    void this.ensureVoiceChannelAccessLoaded(channel.channel_id, true);
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

    const payload: CreateGroupConversationRequest = {
      name: this.createGroupForm.name.trim(),
      member_ids: this.createGroupMemberIds(),
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

  submitCreatePlatform(): void {
    const token = this.session()?.access_token;
    if (!token) {
      return;
    }

    const payload = {
      name: this.createPlatformForm.name.trim(),
      description: this.createPlatformForm.description.trim() || null,
    };

    if (!payload.name) {
      this.managementError.set('Введите название площадки');
      return;
    }

    this.createPlatformLoading.set(true);
    this.managementError.set(null);
    this.managementSuccess.set(null);
    this.createPlatformSubmit$.next({ token, payload });
  }

  startDirectConversationFromModal(): void {
    const token = this.session()?.access_token;
    const payload = this.resolveUserLookupPayload(this.createConversationForm.directUserId, this.directDirectoryQuery());
    if (!token || !payload) {
      this.managementError.set('Введите полный пятизначный ID пользователя');
      return;
    }

    if (payload.user_public_id) {
      const existingConversation = this.findDirectConversationByPublicId(payload.user_public_id);
      if (existingConversation) {
        this.createConversationLoading.set(false);
        this.managementError.set(null);
        this.managementSuccess.set(`Чат с ${existingConversation.title} уже открыт`);
        this.createConversationModalOpen.set(false);
        this.workspaceMode.set('chats');
        this.loadServerWorkspace(token, existingConversation.id);
        return;
      }
    }

    this.createConversationLoading.set(true);
    this.managementError.set(null);
    this.managementSuccess.set(null);
    this.sendFriendRequestTrigger$.next({
      token,
      payload,
      successMessage: 'Запрос в друзья отправлен',
      closeModal: true,
    });
  }

  submitCreateConversationGroup(): void {
    const token = this.session()?.access_token;
    if (!token) {
      return;
    }

    const payload: CreateGroupConversationRequest = {
      name: this.createConversationForm.name.trim(),
      member_ids: this.createConversationGroupMemberIds(),
    };

    if (payload.name.length < 2) {
      this.managementError.set('Введите название мини-группы');
      return;
    }

    this.createConversationLoading.set(true);
    this.managementError.set(null);
    this.managementSuccess.set(null);
    this.createConversationSubmit$.next({ token, payload });
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
    this.scheduleComposerMentionSync();
    this.schedulePresenceHeartbeat();
  }

  onMessageComposerKeydown(event: KeyboardEvent): void {
    if (this.composerMentionMenuOpen()) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.moveComposerMentionSelection(1);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.moveComposerMentionSelection(-1);
        return;
      }

      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        this.selectActiveComposerMention();
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        this.clearComposerMentionState();
        return;
      }
    }

    if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.shiftKey && this.canSendMessage()) {
      event.preventDefault();
      this.submitMessage();
      return;
    }

    this.scheduleComposerMentionSync();
  }

  onMessageComposerSelectionChange(): void {
    this.scheduleComposerMentionSync();
  }

  onMessageComposerBlur(): void {
    requestAnimationFrame(() => {
      const textarea = this.messageTextareaRef?.nativeElement;
      if (textarea && document.activeElement === textarea) {
        return;
      }

      this.clearComposerMentionState();
    });
  }

  openAttachmentPicker(): void {
    this.attachmentInputRef?.nativeElement.click();
  }

  onAttachmentSelection(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const selectedFiles = Array.from(input?.files ?? []);
    if (input) {
      input.value = '';
    }

    this.addPendingFiles(selectedFiles);
  }

  onMessageComposerPaste(event: ClipboardEvent): void {
    const clipboardData = event.clipboardData;
    if (!clipboardData || this.messageSubmitting()) {
      return;
    }

    const pastedImages = Array.from(clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item, index) => {
        const file = item.getAsFile();
        return file ? this.normalizeClipboardAttachmentFile(file, index) : null;
      })
      .filter((file): file is File => file !== null);

    this.addPendingFiles(pastedImages);
  }

  removePendingFile(index: number): void {
    this.pendingFiles.update((files) => files.filter((_, currentIndex) => currentIndex !== index));
    this.messageUploadOutcome.set('idle');
  }

  onMessageListScroll(): void {
    const element = this.messageListRef?.nativeElement;
    if (!element) {
      return;
    }

    if (element.scrollTop > 120) {
      const isNearBottom = element.scrollHeight - element.scrollTop - element.clientHeight <= 80;
      if (isNearBottom) {
        this.markLatestMessageAsRead();
      }
      return;
    }

    this.loadOlderMessages();
  }

  startReplyToMessage(message: WorkspaceMessage): void {
    this.selectedReplyMessage.set(message);
    this.schedulePresenceHeartbeat();
    this.focusMessageComposer();
  }

  clearReplyTarget(): void {
    this.selectedReplyMessage.set(null);
  }

  replyPreviewText(reply: WorkspaceMessageReply | WorkspaceMessage): string {
    if (reply.content.trim()) {
      return reply.content;
    }

    if ('attachments_count' in reply && reply.attachments_count > 0) {
      return `Вложений: ${reply.attachments_count}`;
    }

    if ('attachments' in reply && reply.attachments.length > 0) {
      return `Вложений: ${reply.attachments.length}`;
    }

    return 'Без текста';
  }

  submitMessage(): void {
    const token = this.session()?.access_token;
    const activeChannel = this.activeMessagingChannel();
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
      files: this.pendingFiles(),
      replyToMessageId: this.selectedReplyMessage()?.id ?? null,
    };
    const channelId = activeChannel.id;

    this.messageUploadCancelRequested = false;
    this.messageSubmitting.set(true);
    this.messageUploadOutcome.set(payload.files.length ? 'uploading' : 'idle');
    this.messageUploadProgress.set(payload.files.length ? { loaded: 0, total: null, percent: null } : null);
    this.messageError.set(null);
    this.schedulePresenceHeartbeat(true);
    this.sendMessageTrigger$.next({ token, channelId, payload });
  }

  selectComposerMentionCandidate(candidate: ComposerMentionCandidate): void {
    const mentionState = this.composerMentionQueryState();
    const textarea = this.messageTextareaRef?.nativeElement;
    if (!mentionState || !textarea) {
      return;
    }

    const draft = this.messageDraft();
    const mentionText = `@${this.composerMentionLabel(candidate)}`;
    const before = draft.slice(0, mentionState.start);
    const after = draft.slice(mentionState.end);
    const shouldAppendSpace = !after || !/^[\s.,!?;:)\]}]/.test(after);
    const nextDraft = `${before}${mentionText}${shouldAppendSpace ? ' ' : ''}${after}`;
    const nextCaretPosition = before.length + mentionText.length + (shouldAppendSpace ? 1 : 0);

    this.messageDraft.set(nextDraft);
    this.clearComposerMentionState();
    this.scheduleMessageTextareaResize();

    requestAnimationFrame(() => {
      textarea.focus();
      textarea.selectionStart = nextCaretPosition;
      textarea.selectionEnd = nextCaretPosition;
      this.syncComposerMentionState();
    });
  }

  highlightComposerMentionCandidate(index: number): void {
    this.composerMentionActiveIndex.set(index);
  }

  cancelMessageUpload(): void {
    if (!this.messageSubmitting()) {
      return;
    }

    this.messageUploadCancelRequested = true;
    this.cancelMessageUploadTrigger$.next();
  }

  messageUploadPercent(progress: MessageUploadProgressState | null): number {
    if (!progress) {
      return 0;
    }

    if (typeof progress.percent === 'number') {
      return progress.percent;
    }

    if (progress.total && progress.total > 0) {
      return Math.min(100, Math.round((progress.loaded / progress.total) * 100));
    }

    return 0;
  }

  messageUploadSummary(progress: MessageUploadProgressState | null): string {
    if (!progress) {
      return '';
    }

    if (progress.total && progress.total > 0) {
      return `${this.formatFileSize(progress.loaded)} из ${this.formatFileSize(progress.total)}`;
    }

    if (progress.loaded > 0) {
      return `${this.formatFileSize(progress.loaded)} загружено`;
    }

    return 'Подготовка загрузки...';
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

  reactionAssetPath(code: WorkspaceMessageReactionCode): string | null {
    return this.messageReactionOptions.find((option) => option.code === code)?.assetPath ?? null;
  }

  reactionLabel(code: WorkspaceMessageReactionCode): string {
    return this.messageReactionOptions.find((option) => option.code === code)?.label ?? 'Реакция';
  }

  messageReadReceiptLabel(message: WorkspaceMessage): string {
    if (!message.read_by.length) {
      return '';
    }

    const names = message.read_by
      .slice(0, 3)
      .map((reader) => this.displayNick(reader.nick));
    const suffix = message.read_by.length > 3 ? ` и еще ${message.read_by.length - 3}` : '';
    return `Прочитали: ${names.join(', ')}${suffix}`;
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

  private focusMessageComposer(): void {
    requestAnimationFrame(() => this.messageTextareaRef?.nativeElement.focus());
  }

  downloadAttachment(attachment: WorkspaceMessageAttachment, surface: AttachmentActionSurface = 'message'): void {
    const token = this.session()?.access_token;
    if (!token || this.isAttachmentDownloading(attachment)) {
      return;
    }

    if (attachment.deleted_at) {
      if (surface === 'chat') {
        this.chatFilesError.set('Файл удален');
      } else {
        this.messageError.set('Файл удален');
      }
      return;
    }

    this.downloadingAttachmentIds.update((ids) => (ids.includes(attachment.id) ? ids : [...ids, attachment.id]));
    this.downloadAttachmentTrigger$.next({ token, attachment, surface });
  }

  isAttachmentDownloading(attachment: WorkspaceMessageAttachment): boolean {
    return this.downloadingAttachmentIds().includes(attachment.id);
  }

  isChatAttachmentDownloading(attachmentId: string): boolean {
    return this.downloadingAttachmentIds().includes(attachmentId);
  }

  async joinActiveVoiceChannel(): Promise<void> {
    const activeChannel = this.activeChannel();
    if (!activeChannel || activeChannel.type !== 'voice') {
      return;
    }

    await this.handleVoiceChannelSelection(activeChannel);
  }

  leaveVoiceChannel(): void {
    this.activeVoiceCallSnapshot.set(null);
    this.callDockVolumeOpen.set(false);
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
    if (this.activeGroupConversation()) {
      this.selectedChannelId.set(this.activeGroupTextChannel()?.id ?? connectedVoiceChannel.id);
    } else {
      this.selectedChannelId.set(connectedVoiceChannel.id);
    }
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

  setSelectedVoiceMemberRole(role: Extract<VoiceAccessRole, 'resident' | 'guest' | 'stranger'>): void {
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

  ownerVoiceRequestQueueLabel(): string {
    const total = this.ownerVoiceRequests().length;
    if (total <= 0) {
      return 'Нет заявок';
    }

    const remainder10 = total % 10;
    const remainder100 = total % 100;
    const noun =
      remainder10 === 1 && remainder100 !== 11
        ? 'заявка'
        : remainder10 >= 2 && remainder10 <= 4 && (remainder100 < 12 || remainder100 > 14)
          ? 'заявки'
          : 'заявок';

    return `${total} ${noun}`;
  }

  focusPlatformVoiceRequest(request: VoiceJoinRequestSummary): void {
    const activeServer = this.activeServer();
    if (!activeServer || activeServer.kind !== 'workspace' || request.server_id !== activeServer.id) {
      return;
    }

    this.ownerVoiceRequestModalOpen.set(false);
    this.openPlatformSettingsModal();
    this.platformVoiceSettingsChannelId.set(request.channel_id);
    this.activeOwnerRequestId.set(request.id);
    const token = this.session()?.access_token;
    if (token) {
      void this.ensureVoiceChannelAccessLoaded(request.channel_id, true);
    }
  }

  resolveVoiceRequest(request: VoiceJoinRequestSummary, action: 'allow' | 'resident' | 'reject'): void {
    const token = this.session()?.access_token;
    if (!token) {
      return;
    }

    this.voiceOwnerActionLoading.set(true);
    this.managementError.set(null);
    this.resolveVoiceRequestTrigger$.next({
      token,
      request,
      action
    });
  }

  resolveActiveVoiceRequest(action: 'allow' | 'resident' | 'reject'): void {
    const activeRequest = this.activeOwnerRequest();
    if (!activeRequest) {
      return;
    }

    this.resolveVoiceRequest(activeRequest, action);
  }

  logout(): void {
    this.appEvents.stop();
    this.directCall.stop();
    this.stopMemberPolling();
    this.stopVoicePresencePolling();
    this.stopMessageAutoRefreshPolling();
    this.stopVoiceJoinRequestPolling();
    this.stopVoiceJoinInboxPolling();
    this.voiceRoom.leave();
    this.lastPresenceHeartbeatAt = 0;
    this.session.set(null);
    this.currentUser.set(null);
    this.workspaceMode.set('chats');
    this.servers.set([]);
    this.conversations.set([]);
    this.conversationDirectory.set([]);
    this.incomingFriendRequests.set([]);
    this.outgoingFriendRequests.set([]);
    this.attentionMentions.set([]);
    this.blockedFriends.set([]);
    this.blockedServers.set([]);
    this.pendingFriendRequestCount.set(0);
    this.pendingPushConversationId = null;
    this.pendingMessageNavigation.set(null);
    this.pendingSearchNavigation.set(null);
    this.setPushFeedback(null);
    this.clearGlobalSearch();
    this.channels.set([]);
    this.members.set([]);
    this.voicePresence.set([]);
    this.resetTextChannelState();
    this.selectedServerId.set(null);
    this.selectedChannelId.set(null);
    this.platformExpandedVoiceChannelId.set(null);
    this.settingsPanelOpen.set(false);
    this.voiceAdminPanelOpen.set(false);
    this.profileEditorOpen.set(false);
    this.createConversationModalOpen.set(false);
    this.createGroupModalOpen.set(false);
    this.createPlatformModalOpen.set(false);
    this.createChannelModalOpen.set(false);
    this.platformSettingsModalOpen.set(false);
    this.platformSettingsDangerMenuOpen.set(false);
    this.platformVoiceSettingsChannelId.set(null);
    this.friendRequestsModalOpen.set(false);
    this.blockedFriendsModalOpen.set(false);
    this.blockedServersModalOpen.set(false);
    this.groupMembersModalOpen.set(false);
    this.groupOwnershipModalOpen.set(false);
    this.quickCreateMenuOpen.set(false);
    this.conversationActionMenuOpen.set(false);
    this.selectedMemberUserId.set(null);
    this.selectedVoiceMemberChannelId.set(null);
    this.mobilePanel.set(null);
    this.pendingVoiceJoin.set(null);
    this.pendingCallSwitch.set(null);
    this.blockedVoiceJoinNotice.set(null);
    this.ownerVoiceRequests.set([]);
    this.activeOwnerRequestId.set(null);
    this.ownerVoiceRequestModalOpen.set(false);
    this.voiceAdminChannels.set([]);
    this.voiceAdminUsers.set([]);
    this.voiceAdminSelectedChannelName.set(null);
    this.voiceAdminSelectedServerId.set(null);
    this.voiceAdminSelectedChannelId.set(null);
    this.voiceAccessEntriesByChannelId.set({});
    this.conversationCreateTab.set('direct');
    this.createConversationGroupMemberIds.set([]);
    this.createGroupMemberIds.set([]);
    this.createConversationForm.directUserId = '';
    this.createConversationForm.name = '';
    this.authError.set(null);
    this.workspaceError.set(null);
    this.messageError.set(null);
    this.managementError.set(null);
    this.managementSuccess.set(null);
    this.authLoading.set(false);
    this.workspaceLoading.set(false);
    this.createConversationLoading.set(false);
    this.friendRequestsLoading.set(false);
    this.attentionInboxLoading.set(false);
    this.createGroupLoading.set(false);
    this.createPlatformLoading.set(false);
    this.createChannelLoading.set(false);
    this.conversationPushPendingId.set(null);
    this.friendRequestsError.set(null);
    this.attentionInboxError.set(null);
    this.authMode.set('login');
    this.clearStoredSession();
  }

  selectServer(serverId: string): void {
    const token = this.session()?.access_token;
    if (!token) {
      return;
    }

    if (serverId === this.selectedServerId()) {
      if (this.isCompactVoiceWorkspaceViewport()) {
        this.closeMobilePanel();
      }
      return;
    }

    const nextServer = this.currentSpaceList().find((server) => server.id === serverId) ?? null;
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
    if (this.isCompactVoiceWorkspaceViewport()) {
      this.closeMobilePanel();
    } else {
      this.closeMobilePanel();
    }
    this.stopMemberPolling();
    this.stopVoicePresencePolling();
    this.stopMessageAutoRefreshPolling();
    this.closePendingVoiceJoin();
    this.closeBlockedVoiceJoinNotice();
    this.closeGroupMembersPanel();
    if (this.hasVoiceConnection()) {
      this.voiceRoom.leave();
    }

    this.resetTextChannelState();
    this.loadServerWorkspace(token, serverId);
  }

  async selectChannel(channel: WorkspaceChannel, options: { connectVoice?: boolean } = {}): Promise<void> {
    const shouldConnectVoice = options.connectVoice ?? true;
    const selectedChannelChanged = this.selectedChannelId() !== channel.id;
    this.schedulePresenceHeartbeat();
    this.closeMobilePanel();
    this.closeChatFilesModal();
    if (selectedChannelChanged) {
      this.resetMessageSearchState();
    }
    this.selectedChannelId.set(channel.id);
    this.workspaceError.set(null);
    this.messageError.set(null);

    if (this.isPlatformsMode()) {
      if (channel.type === 'text') {
        this.platformTextChannelsCollapsed.set(false);
      }
      if (channel.type === 'voice') {
        this.platformVoiceChannelsCollapsed.set(false);
      }
    }

    if (channel.type === 'voice') {
      this.voiceWorkspaceTab.set(this.defaultVoiceWorkspaceTab());
    } else {
      this.voiceWorkspaceTab.set('chat');
    }

    const token = this.session()?.access_token;
    if (token && (channel.type === 'text' || channel.type === 'voice') && (selectedChannelChanged || !this.messages().length)) {
      this.loadMessagesForChannel(token, channel.id, undefined, this.buildInitialChannelLoadOptions(channel));
    }
    this.syncMessageAutoRefreshPolling();

    if (channel.type === 'voice') {
      if (shouldConnectVoice) {
        await this.handleVoiceChannelSelection(channel);
      }
      return;
    }
  }

  voiceParticipantsForChannel(channelId: string): VoiceParticipant[] {
    if (this.connectedVoiceChannelId() === channelId && this.voiceParticipants().length) {
      return this.voiceParticipants();
    }

    return this.serverVoicePresenceByChannelId().get(channelId) ?? [];
  }

  groupVoiceParticipantVolume(participant: VoiceParticipant): number {
    return this.voiceRoom.getParticipantVolume(participant.user_id);
  }

  setGroupVoiceParticipantVolume(participant: VoiceParticipant, value: number | string): void {
    if (participant.is_self) {
      return;
    }
    this.voiceRoom.updateParticipantVolume(participant.user_id, this.toRangeValue(value));
  }

  groupVoiceSelfStatusLabel(participant: VoiceParticipant): string {
    if (this.isGroupVoiceParticipantGloballyMuted(participant)) {
      return 'Вы заглушили свой микрофон';
    }

    return participant.speaking ? 'Ваш голос сейчас слышно' : 'Ваш микрофон включен';
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

  groupVoiceStateIconPath(participant: VoiceParticipant): string {
    if (this.isGroupVoiceParticipantGloballyMuted(participant)) {
      return '/assets/mic_block.svg';
    }

    if (!participant.is_self && this.isGroupVoiceParticipantLocallyMuted(participant)) {
      return '/assets/mic_off.svg';
    }

    if (participant.speaking) {
      return '/assets/mic_voice.svg';
    }

    return '/assets/mic.svg';
  }

  groupVoiceStateIconAlt(participant: VoiceParticipant): string {
    if (this.isGroupVoiceParticipantGloballyMuted(participant)) {
      return participant.is_self ? 'Ваш микрофон заглушен' : 'Пользователь заглушил свой микрофон';
    }

    if (!participant.is_self && this.isGroupVoiceParticipantLocallyMuted(participant)) {
      return 'Вы выключили громкость этого участника';
    }

    if (participant.speaking) {
      return 'Пользователь говорит';
    }

    return 'Микрофон активен';
  }

  canToggleGroupVoiceParticipantMute(participant: VoiceParticipant): boolean {
    return participant.is_self && this.connectedVoiceChannelId() === this.activeGroupVoiceChannel()?.id;
  }

  groupVoiceStateActionLabel(participant: VoiceParticipant): string {
    return this.isGroupVoiceParticipantGloballyMuted(participant)
      ? 'Включить микрофон'
      : 'Заглушить свой микрофон';
  }

  toggleGroupVoiceParticipantMute(participant: VoiceParticipant): void {
    if (!this.canToggleGroupVoiceParticipantMute(participant)) {
      return;
    }

    this.toggleVoiceMute();
  }

  private isGroupVoiceParticipantGloballyMuted(participant: VoiceParticipant): boolean {
    if (participant.is_self) {
      return this.voiceMuted() || this.voiceOwnerMuted();
    }

    return participant.owner_muted || participant.muted;
  }

  private isGroupVoiceParticipantLocallyMuted(participant: VoiceParticipant): boolean {
    return !participant.is_self && this.groupVoiceParticipantVolume(participant) <= 0;
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

  messageUploadOutcomeLabel(): string {
    if (this.messageUploadOutcome() === 'uploading') {
      return 'Загружается';
    }

    if (this.messageUploadOutcome() === 'cancelled') {
      return 'Отменено';
    }

    if (this.messageUploadOutcome() === 'failed') {
      return 'Ошибка';
    }

    return 'Готов к отправке';
  }

  attachmentMetaLabel(attachment: WorkspaceMessageAttachment): string {
    return `${this.attachmentKindLabel(attachment)} · ${this.formatFileSize(attachment.size_bytes)}`;
  }

  attachmentStateLabel(attachment: WorkspaceMessageAttachment): string {
    if (attachment.deleted_at) {
      return 'Удален';
    }

    const availabilityLabel = this.attachmentAvailabilityLabel(attachment.id);
    if (availabilityLabel) {
      return availabilityLabel;
    }

    if (this.isAttachmentDownloading(attachment)) {
      return 'Подготовка скачивания';
    }

    if (this.isAttachmentPreviewLoading(attachment) && (this.isInlineImageAttachment(attachment) || this.isInlineAudioAttachment(attachment))) {
      return 'Загружается';
    }

    return 'Доступен';
  }

  isAttachmentUnavailable(attachment: WorkspaceMessageAttachment): boolean {
    return this.attachmentAvailabilityLabel(attachment.id) !== null;
  }

  chatAttachmentMetaLabel(attachment: WorkspaceChatAttachmentSummary): string {
    return this.attachmentMetaLabel(this.toAttachmentRecord(attachment));
  }

  chatAttachmentStateLabel(attachment: WorkspaceChatAttachmentSummary): string {
    return this.attachmentStateLabel(this.toAttachmentRecord(attachment));
  }

  isChatAttachmentUnavailable(attachment: WorkspaceChatAttachmentSummary): boolean {
    return this.isAttachmentUnavailable(this.toAttachmentRecord(attachment));
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
    if (attachment.deleted_at) {
      return false;
    }

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
    if (attachment.deleted_at) {
      return false;
    }

    const mimeType = attachment.mime_type.toLowerCase();
    if (mimeType === 'audio/mpeg' || mimeType === 'audio/mp3' || mimeType === 'audio/x-mpeg') {
      return true;
    }

    return /\.mp3$/i.test(attachment.filename);
  }

  audioPreviewUrl(attachment: WorkspaceMessageAttachment): string | null {
    return this.attachmentPreviewUrl(attachment);
  }

  openedImageAttachmentMetaLabel(): string {
    const attachment = this.openedImageAttachment();
    return attachment ? this.attachmentMetaLabel(attachment) : '';
  }

  openedImageAttachmentStateLabel(): string {
    const attachment = this.openedImageAttachment();
    return attachment ? this.attachmentStateLabel(attachment) : '';
  }

  canDeleteOpenedImageAttachment(): boolean {
    const attachment = this.openedImageAttachment();
    return attachment ? this.canDeleteAttachmentById(attachment.id) && !attachment.deleted_at : false;
  }

  deleteOpenedImageAttachment(): void {
    const attachment = this.openedImageAttachment();
    if (!attachment) {
      return;
    }

    this.deleteMessageAttachment(attachment, this.chatFilesModalOpen() ? 'chat' : 'message');
  }

  openImageAttachment(attachment: WorkspaceMessageAttachment, surface: AttachmentActionSurface = 'message'): void {
    if (attachment.deleted_at) {
      if (surface === 'chat') {
        this.chatFilesError.set('Файл удален');
      } else {
        this.messageError.set('Файл удален');
      }
      return;
    }

    const previewUrl = this.imagePreviewUrl(attachment);
    if (previewUrl) {
      this.openedImageAttachmentId.set(
        this.openedImageAttachmentId() === attachment.id ? null : attachment.id
      );
      return;
    }

    this.requestAttachmentPreview(attachment, {
      openImageAfterLoad: true,
      reportErrors: true,
      surface,
    });
  }

  loadAudioAttachment(attachment: WorkspaceMessageAttachment): void {
    if (attachment.deleted_at) {
      this.messageError.set('Файл удален');
      return;
    }

    this.requestAttachmentPreview(attachment, {
      reportErrors: true,
      surface: 'message',
    });
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

  private getWakeLockApi(): BrowserWakeLock | null {
    if (typeof navigator === 'undefined') {
      return null;
    }

    return ((navigator as Navigator & { wakeLock?: BrowserWakeLock }).wakeLock ?? null);
  }

  private async syncWakeLock(): Promise<void> {
    const wakeLockApi = this.getWakeLockApi();
    if (!wakeLockApi || typeof document === 'undefined') {
      return;
    }

    if (document.visibilityState === 'visible') {
      await this.requestWakeLock(wakeLockApi);
      return;
    }

    await this.releaseWakeLock();
  }

  private async requestWakeLock(wakeLockApi = this.getWakeLockApi()): Promise<void> {
    if (!wakeLockApi || typeof document === 'undefined' || document.visibilityState !== 'visible') {
      return;
    }

    if (this.wakeLock || this.wakeLockRequestInFlight) {
      return;
    }

    this.wakeLockRequestInFlight = true;

    try {
      const sentinel = await wakeLockApi.request('screen');
      sentinel.addEventListener('release', this.handleWakeLockRelease);
      this.wakeLock = sentinel;
    } catch {
      // Some mobile browsers can reject wake lock on low battery or system policy.
    } finally {
      this.wakeLockRequestInFlight = false;
    }
  }

  private async releaseWakeLock(): Promise<void> {
    if (!this.wakeLock) {
      return;
    }

    const sentinel = this.wakeLock;
    this.wakeLock = null;
    sentinel.removeEventListener('release', this.handleWakeLockRelease);

    try {
      await sentinel.release();
    } catch {
      // Ignore release errors when the browser already dropped the lock.
    }
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
          const previousRequestIds = new Set(this.ownerVoiceRequests().map((request) => request.id));
          const hasNewRequests = requests.some((request) => !previousRequestIds.has(request.id));
          this.ownerVoiceRequests.set(requests);
          if (!requests.length) {
            this.ownerVoiceRequestModalOpen.set(false);
          } else if (hasNewRequests) {
            this.ownerVoiceRequestModalOpen.set(true);
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

          const nextChannelId = this.syncVoiceAdminSelection(channels);
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
          this.syncVoiceAdminSelection(channels);
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
      case 'message_read_updated':
        this.handleMessageReadUpdatedEvent(event);
        return;
      case 'attachment_deleted':
        this.handleAttachmentDeletedEvent(event);
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
          await this.refreshConversationsList(token);
          await this.refreshAttentionInboxIfOpen();
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
      case 'friend_requests_changed':
        await this.handleFriendRequestsChangedEvent(event);
        return;
    }
  }

  private async resyncAfterAppEventsReconnect(): Promise<void> {
    const token = this.session()?.access_token;
    if (!token) {
      return;
    }

    await this.refreshServersList(token);
    await this.refreshConversationsList(token);

    if (this.selectedServerId()) {
      await this.refreshChannelsForCurrentServer(token);
      await this.refreshMembers();
      await this.refreshVoicePresence();
    }

    if (this.pendingVoiceJoin()) {
      await this.refreshPendingVoiceJoin();
    }

    await this.refreshVoiceJoinInbox();
    await this.refreshFriendRequests(token);
    await this.refreshAttentionInbox(token);
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

    this.voiceAccessEntriesByChannelId.update((currentState) => {
      const nextState: Record<string, VoiceChannelAccessEntry[]> = {};

      for (const [channelId, entries] of Object.entries(currentState)) {
        nextState[channelId] = entries.map((entry) =>
          entry.user_id === event.user_id
            ? {
                ...entry,
                is_online: event.is_online
              }
            : entry
        );
      }

      return nextState;
    });
  }

  private handleMessageCreatedEvent(event: AppMessageCreatedEvent): void {
    const preview = this.buildConversationListPreview(event.message);
    this.conversations.update((conversations) =>
      conversations.map((conversation) =>
        conversation.id === event.server_id
          ? {
              ...conversation,
              subtitle: preview,
            }
          : conversation
      )
    );

    const isWorkspaceServer = this.servers().some((server) => server.id === event.server_id);
    const isOwnMessage = event.message.author.id === this.currentUser()?.id;
    const isSelectedConversation = event.server_id === this.selectedServerId();
    const mentionsCurrentUser = this.messageMentionsUserId(event.message, this.currentUser()?.id);

    if (!isSelectedConversation) {
      if (!isOwnMessage) {
        if (isWorkspaceServer) {
          this.bumpServerUnreadCount(event.server_id);
          if (mentionsCurrentUser) {
            this.bumpServerMentionUnreadCount(event.server_id);
            void this.refreshAttentionInboxIfOpen();
          }
        } else {
          this.bumpConversationUnreadCount(event.server_id);
          this.setConversationFirstUnreadMessageIdIfMissing(event.server_id, event.message.id);
          if (mentionsCurrentUser) {
            this.bumpConversationMentionUnreadCount(event.server_id);
            this.setConversationFirstMentionUnreadMessageIdIfMissing(event.server_id, event.message.id);
            void this.refreshAttentionInboxIfOpen();
          }
        }
      }
      return;
    }

    const activeChannel = this.activeMessagingChannel();
    if (
      !activeChannel
      || (activeChannel.type !== 'text' && activeChannel.type !== 'voice')
      || activeChannel.id !== event.message.channel_id
    ) {
      if (!isOwnMessage) {
        if (isWorkspaceServer) {
          this.bumpChannelUnreadCount(event.message.channel_id);
          this.bumpServerUnreadCount(event.server_id);
          this.setChannelFirstUnreadMessageIdIfMissing(event.message.channel_id, event.message.id);
          if (mentionsCurrentUser) {
            this.bumpChannelMentionUnreadCount(event.message.channel_id);
            this.bumpServerMentionUnreadCount(event.server_id);
            this.setChannelFirstMentionUnreadMessageIdIfMissing(event.message.channel_id, event.message.id);
            void this.refreshAttentionInboxIfOpen();
          }
        } else {
          this.bumpConversationUnreadCount(event.server_id);
          this.setConversationFirstUnreadMessageIdIfMissing(event.server_id, event.message.id);
          if (mentionsCurrentUser) {
            this.bumpConversationMentionUnreadCount(event.server_id);
            this.setConversationFirstMentionUnreadMessageIdIfMissing(event.server_id, event.message.id);
            void this.refreshAttentionInboxIfOpen();
          }
        }
      }
      return;
    }

    const listElement = this.messageListRef?.nativeElement;
    const isNearBottom =
      !listElement || listElement.scrollHeight - listElement.scrollTop - listElement.clientHeight <= 80;

    this.messages.update((messages) => this.mergeMessagesChronologically([...messages, event.message]));
    this.preloadInlineImagePreviews([event.message]);

    if (isNearBottom || isOwnMessage) {
      this.scrollMessagesToBottom();
    }

    if (!isOwnMessage && isNearBottom) {
      this.markChannelAsRead(event.message.channel_id, event.message.id);
      return;
    }

    if (!isOwnMessage) {
      if (isWorkspaceServer) {
        this.bumpChannelUnreadCount(event.message.channel_id);
        this.bumpServerUnreadCount(event.server_id);
        this.setChannelFirstUnreadMessageIdIfMissing(event.message.channel_id, event.message.id);
        if (mentionsCurrentUser) {
          this.bumpChannelMentionUnreadCount(event.message.channel_id);
          this.bumpServerMentionUnreadCount(event.server_id);
          this.setChannelFirstMentionUnreadMessageIdIfMissing(event.message.channel_id, event.message.id);
          void this.refreshAttentionInboxIfOpen();
        }
      } else {
        this.bumpConversationUnreadCount(event.server_id);
        this.setConversationFirstUnreadMessageIdIfMissing(event.server_id, event.message.id);
        if (mentionsCurrentUser) {
          this.bumpConversationMentionUnreadCount(event.server_id);
          this.setConversationFirstMentionUnreadMessageIdIfMissing(event.server_id, event.message.id);
          void this.refreshAttentionInboxIfOpen();
        }
      }
    }
  }

  private handleMessageReactionsUpdatedEvent(event: AppMessageReactionsUpdatedEvent): void {
    if (event.server_id !== this.selectedServerId()) {
      return;
    }

    this.applyMessageReactionSnapshot(event.snapshot, true);
  }

  private handleAttachmentDeletedEvent(event: AppAttachmentDeletedEvent): void {
    if (event.server_id !== this.selectedServerId()) {
      return;
    }

    this.chatAttachments.update((items) => items.filter((item) => item.id !== event.attachment_id));
    this.applyAttachmentDeletedLocally(event.attachment_id);
  }

  private handleMessageReadUpdatedEvent(event: AppMessageReadUpdatedEvent): void {
    const readerId = event.state.user_id;
    const currentUserId = this.currentUser()?.id;
    if (readerId === currentUserId) {
      const activeServer = this.activeServer();
      if (activeServer?.kind === 'workspace' && activeServer.id === event.server_id) {
        const channelUnreadCount = this.channels().find((channel) => channel.id === event.channel_id)?.unread_count ?? 0;
        const channelMentionUnreadCount = this.channels().find((channel) => channel.id === event.channel_id)?.mention_unread_count ?? 0;
        this.setChannelUnreadCount(event.channel_id, 0);
        this.setChannelMentionUnreadCount(event.channel_id, 0);
        this.setChannelFirstUnreadMessageId(event.channel_id, null);
        if (channelUnreadCount > 0) {
          this.bumpServerUnreadCount(activeServer.id, -channelUnreadCount);
        }
        if (channelMentionUnreadCount > 0) {
          this.bumpServerMentionUnreadCount(activeServer.id, -channelMentionUnreadCount);
        }
      } else {
        this.setConversationUnreadCountByChannelId(event.channel_id, 0);
        this.setConversationMentionUnreadCountByChannelId(event.channel_id, 0);
        this.setConversationFirstUnreadMessageIdByChannelId(event.channel_id, null);
        this.setConversationFirstMentionUnreadMessageIdByChannelId(event.channel_id, null);
      }
      void this.refreshAttentionInboxIfOpen();
    }

    if (event.server_id !== this.selectedServerId()) {
      return;
    }

    this.messages.update((messages) =>
      messages.map((message) => {
        const withoutReader = message.read_by.filter((reader) => reader.id !== readerId);
        if (event.state.last_read_message_id !== message.id || readerId === message.author.id || readerId === currentUserId) {
          if (withoutReader.length === message.read_by.length) {
            return message;
          }

          return {
            ...message,
            read_by: withoutReader,
          };
        }

        return {
          ...message,
          read_by: [
            {
              id: readerId,
              public_id: event.state.public_id,
              nick: event.state.nick,
              avatar_updated_at: event.state.avatar_updated_at,
            },
            ...withoutReader,
          ],
        };
      })
    );
  }

  private applyChannelsSnapshot(
    channels: WorkspaceChannel[],
    token: string,
    preferredSelectedChannelId: string | null = this.selectedChannelId()
  ): void {
    const connectedVoiceChannelId = this.voiceRoom.activeChannelId();
    const preferredGroupTextChannelId = this.activeGroupConversation()
      ? (channels.find((channel) => channel.type === 'text')?.id ?? null)
      : null;
    const normalizedPreferredSelectedChannelId =
      preferredGroupTextChannelId
      && preferredSelectedChannelId
      && channels.find((channel) => channel.id === preferredSelectedChannelId)?.type === 'voice'
        ? preferredGroupTextChannelId
        : preferredSelectedChannelId;

    this.channels.set(channels);
    this.syncActiveServerUnreadCountFromChannels(channels);

    const connectedVoiceSnapshot = this.activeVoiceCallSnapshot();
    const connectedVoiceBelongsToCurrentServer =
      !connectedVoiceSnapshot || connectedVoiceSnapshot.serverId === this.selectedServerId();

    if (
      connectedVoiceChannelId
      && connectedVoiceBelongsToCurrentServer
      && !channels.some((channel) => channel.id === connectedVoiceChannelId)
    ) {
      this.voiceRoom.leave();
    }

    if (
      this.platformExpandedVoiceChannelId()
      && !channels.some((channel) => channel.id === this.platformExpandedVoiceChannelId())
    ) {
      this.platformExpandedVoiceChannelId.set(null);
    }

    const nextSelectedChannelId =
      (normalizedPreferredSelectedChannelId && channels.some((channel) => channel.id === normalizedPreferredSelectedChannelId)
        ? normalizedPreferredSelectedChannelId
        : null)
      ?? preferredGroupTextChannelId
      ?? (connectedVoiceChannelId && channels.some((channel) => channel.id === connectedVoiceChannelId)
        ? connectedVoiceChannelId
        : null)
      ?? channels[0]?.id
      ?? null;

    const selectedChannelChanged = nextSelectedChannelId !== this.selectedChannelId();
    this.selectedChannelId.set(nextSelectedChannelId);
    this.filterVoicePresenceToVisibleChannels(channels);

    const pendingSearchNavigation = this.pendingSearchNavigation();
    if (
      pendingSearchNavigation
      && pendingSearchNavigation.serverId === this.selectedServerId()
    ) {
      this.pendingSearchNavigation.set(null);
    }

    if (
      this.selectedVoiceMemberChannelId()
      && !channels.some((channel) => channel.id === this.selectedVoiceMemberChannelId())
    ) {
      this.closeMemberVolume();
    }

    if (
      this.platformVoiceSettingsChannelId()
      && !channels.some((channel) => channel.id === this.platformVoiceSettingsChannelId())
    ) {
      const fallbackChannel = channels.find((channel) => this.canManagePlatformVoiceChannel(channel)) ?? null;
      this.platformVoiceSettingsChannelId.set(fallbackChannel?.id ?? null);
      if (fallbackChannel && this.platformSettingsModalOpen()) {
        void this.ensureVoiceChannelAccessLoaded(fallbackChannel.id, true);
      }
    }

    const nextSelectedChannel = channels.find((channel) => channel.id === nextSelectedChannelId) ?? null;
    if (!nextSelectedChannel) {
      this.resetTextChannelState();
      this.syncMessageAutoRefreshPolling();
      return;
    }

    if (nextSelectedChannel.type === 'text' || nextSelectedChannel.type === 'voice') {
      if (selectedChannelChanged) {
        this.loadMessagesForChannel(
          token,
          nextSelectedChannel.id,
          undefined,
          this.buildInitialChannelLoadOptions(nextSelectedChannel),
        );
      }
    } else if (selectedChannelChanged) {
      this.resetTextChannelState();
    }

    this.syncMessageAutoRefreshPolling();
  }

  private syncActiveServerUnreadCountFromChannels(channels: WorkspaceChannel[]): void {
    const activeServer = this.activeServer();
    if (!activeServer || activeServer.kind !== 'workspace') {
      return;
    }

    const unreadCount = channels.reduce((total, channel) => total + Math.max(0, channel.unread_count ?? 0), 0);
    const mentionUnreadCount = channels.reduce((total, channel) => total + Math.max(0, channel.mention_unread_count ?? 0), 0);
    this.setServerUnreadCount(activeServer.id, unreadCount);
    this.setServerMentionUnreadCount(activeServer.id, mentionUnreadCount);
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

    return [...serversById.values()].sort((left, right) => this.compareServers(left, right));
  }

  private mergeConversationsById(conversations: ConversationSummary[]): ConversationSummary[] {
    const conversationsById = new Map<string, ConversationSummary>();
    for (const conversation of conversations) {
      conversationsById.set(conversation.id, conversation);
    }

    return [...conversationsById.values()].sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === 'direct' ? -1 : 1;
      }

      return left.title.localeCompare(right.title, 'ru');
    });
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
    this.patchMessagesFromMemberSnapshot(event.members);
  }

  private handleVoicePresenceUpdatedEvent(event: AppVoicePresenceUpdatedEvent): void {
    if (event.server_id !== this.selectedServerId()) {
      this.patchVoiceAdminEntriesFromPresenceEvent(event);
      this.voiceRoom.syncParticipantProfiles(this.flattenVoicePresenceParticipants(event.voice_presence));
      return;
    }

    this.applyVoicePresenceSnapshot(event.voice_presence);
    this.patchVoiceAdminEntriesFromPresenceEvent(event);
    this.voiceRoom.syncParticipantProfiles(this.flattenVoicePresenceParticipants(event.voice_presence));
  }

  private async refreshServersList(token: string): Promise<void> {
    this.workspaceApi
      .getServers(token)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (servers) => {
          this.servers.set(this.mergeServersById(servers));
        },
        error: () => {
          // Silent realtime refresh should not interrupt the current session.
        }
      });
  }

  private async refreshConversationsList(token: string): Promise<void> {
    const previousSelectedServerId = this.selectedServerId();

    this.workspaceApi
      .getConversations(token)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (conversations) => {
          const mergedConversations = this.mergeConversationsById(conversations);
          this.conversations.set(mergedConversations);
          this.tryOpenPendingPushConversation(token);

          let spaces = this.currentSpaceList();

          if (!spaces.length) {
            const fallbackMode = this.directConversationSpaces().length
              ? 'chats'
              : this.groupConversationSpaces().length
                ? 'groups'
                : this.platformSpaces().length
                  ? 'platforms'
                  : null;

            if (fallbackMode) {
              this.workspaceMode.set(fallbackMode);
              spaces = this.currentSpaceList();
            }
          }

          if (!spaces.length) {
            this.appEvents.setActiveServer(null);
            this.selectedServerId.set(null);
            this.selectedChannelId.set(null);
            this.channels.set([]);
            this.members.set([]);
            this.voicePresence.set([]);
            this.resetTextChannelState();
            return;
          }

          if (!previousSelectedServerId || !spaces.some((space) => space.id === previousSelectedServerId)) {
            this.loadServerWorkspace(token, spaces[0].id);
          }
        },
        error: () => {
          // Silent realtime refresh should not interrupt the current session.
        }
      });
  }

  private async refreshFriendRequests(token: string): Promise<void> {
    this.workspaceApi
      .getFriendRequests(token)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (overview) => {
          this.incomingFriendRequests.set(overview.incoming);
          this.outgoingFriendRequests.set(overview.outgoing);
          this.pendingFriendRequestCount.set(overview.incoming.length);
          this.friendRequestsLoading.set(false);
        },
        error: (error) => {
          this.friendRequestsLoading.set(false);
          this.friendRequestsError.set(this.extractErrorMessage(error, 'Не удалось загрузить запросы в друзья'));
        }
      });
  }

  private async refreshAttentionInbox(token: string): Promise<void> {
    this.workspaceApi
      .getAttentionInbox(token)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (inbox) => {
          this.attentionMentions.set(inbox.mentions);
          this.attentionInboxLoading.set(false);
          this.attentionInboxError.set(null);
        },
        error: (error) => {
          this.attentionInboxLoading.set(false);
          this.attentionInboxError.set(this.extractErrorMessage(error, 'Не удалось загрузить упоминания'));
        }
      });
  }

  private async refreshAttentionInboxIfOpen(): Promise<void> {
    if (!this.friendRequestsModalOpen()) {
      return;
    }

    const token = this.session()?.access_token;
    if (!token) {
      return;
    }

    this.attentionInboxLoading.set(true);
    this.attentionInboxError.set(null);
    await this.refreshAttentionInbox(token);
  }

  private async refreshBlockedFriends(token: string): Promise<void> {
    this.workspaceApi
      .getBlockedFriends(token)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blockedFriends) => {
          this.blockedFriends.set(blockedFriends);
          this.blockedFriendsLoading.set(false);
        },
        error: (error) => {
          this.blockedFriendsLoading.set(false);
          this.blockedFriendsError.set(this.extractErrorMessage(error, 'Не удалось загрузить заблокированных пользователей'));
        }
      });
  }

  private async refreshBlockedServers(token: string): Promise<void> {
    this.workspaceApi
      .getBlockedServers(token)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blockedServers) => {
          this.blockedServers.set(blockedServers);
          this.blockedServersLoading.set(false);
        },
        error: (error) => {
          this.blockedServersLoading.set(false);
          this.blockedServersError.set(this.extractErrorMessage(error, 'Не удалось загрузить заблокированные группы и площадки'));
        }
      });
  }

  private async loadConversationDirectory(token: string): Promise<void> {
    this.workspaceApi
      .getConversationDirectory(token)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (users) => {
          this.conversationDirectory.set(users);
        },
        error: () => {
          // Keep existing directory until the next successful refresh.
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

  private async handleFriendRequestsChangedEvent(event: AppFriendRequestsChangedEvent): Promise<void> {
    this.pendingFriendRequestCount.set(event.pending_incoming_count);
    const token = this.session()?.access_token;
    if (!token) {
      return;
    }

    await this.refreshFriendRequests(token);
  }

  private async handleResolvedVoiceJoinRequest(request: VoiceJoinRequestSummary): Promise<void> {
    this.stopVoiceJoinRequestPolling();

    if (request.status === 'allowed' || request.status === 'resident') {
      const channel = this.channels().find((entry) => entry.id === request.channel_id) ?? this.activeChannel();
      this.pendingVoiceJoin.set(null);
      if (channel && channel.type === 'voice') {
        const allowedChannel = {
          ...channel,
          voice_access_role: request.status === 'resident' ? 'resident' : 'guest'
        } satisfies WorkspaceChannel;
        const action = () => this.connectToVoiceChannel(allowedChannel);

        if (!this.guardCallStart(this.voiceCallDescriptor(allowedChannel), action)) {
          return;
        }

        await action();
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

  private async initializeBrowserPush(token: string): Promise<void> {
    try {
      await this.browserPush.initialize(token);
      this.tryOpenPendingPushConversation(token);
    } catch {
      // Push initialization should stay silent until the user explicitly toggles it.
    }
  }

  private handlePushConversationRequest(conversationId: string): void {
    if (!conversationId) {
      return;
    }

    this.pendingPushConversationId = conversationId;
    const token = this.session()?.access_token;
    if (!token) {
      return;
    }

    this.tryOpenPendingPushConversation(token);
  }

  private tryOpenPendingPushConversation(token: string): void {
    const conversationId = this.pendingPushConversationId;
    if (!conversationId) {
      return;
    }

    const conversation = this.conversations().find((item) => item.id === conversationId);
    if (!conversation) {
      return;
    }

    this.pendingPushConversationId = null;
    this.workspaceMode.set(conversation.kind === 'group_chat' ? 'groups' : 'chats');

    if (conversation.id === this.selectedServerId()) {
      this.closeMobilePanel();
      return;
    }

    this.selectServer(conversation.id);
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
      this.directCall.start(session.access_token);
      void this.initializeBrowserPush(session.access_token);
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
    this.directCall.start(session.access_token);
    void this.initializeBrowserPush(session.access_token);
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
    this.friendRequestsLoading.set(true);
    this.friendRequestsError.set(null);
    this.mobilePanel.set(this.isCompactVoiceWorkspaceViewport() ? 'servers' : null);
    this.voiceRoom.leave();

    forkJoin({
      me: this.workspaceApi.getCurrentUser(token),
      servers: this.workspaceApi.getServers(token),
      conversations: this.workspaceApi.getConversations(token)
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ me, servers, conversations }) => {
          this.currentUser.set(me);
          this.servers.set(this.mergeServersById(servers));
          const mergedConversations = this.mergeConversationsById(conversations);
          this.conversations.set(mergedConversations);
          this.tryOpenPendingPushConversation(token);
          this.schedulePresenceHeartbeat(true);
          void this.loadConversationDirectory(token);
          void this.refreshFriendRequests(token);

          const directSpaces = mergedConversations.filter((conversation) => conversation.kind === 'direct');
          const groupSpaces = mergedConversations.filter((conversation) => conversation.kind === 'group_chat');
          const platformSpaces = this.mergeServersById(servers).filter((server) => server.kind === 'workspace');

          if (!directSpaces.length && !groupSpaces.length && !platformSpaces.length) {
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
          const previousMode = this.workspaceMode();
          const preferredMode = previousMode === 'groups'
            ? (groupSpaces.length ? 'groups' : directSpaces.length ? 'chats' : 'platforms')
            : previousMode === 'platforms'
              ? (platformSpaces.length ? 'platforms' : directSpaces.length ? 'chats' : 'groups')
              : (directSpaces.length ? 'chats' : groupSpaces.length ? 'groups' : 'platforms');
          this.workspaceMode.set(preferredMode);

          const preferredSpaceList = preferredMode === 'groups'
            ? this.mapConversationSpaces(groupSpaces)
            : preferredMode === 'platforms'
              ? platformSpaces
              : this.mapConversationSpaces(directSpaces);
          const fallbackSpaceList = preferredMode === 'groups'
            ? (directSpaces.length ? this.mapConversationSpaces(directSpaces) : platformSpaces)
            : preferredMode === 'platforms'
              ? (directSpaces.length ? this.mapConversationSpaces(directSpaces) : this.mapConversationSpaces(groupSpaces))
              : (groupSpaces.length ? this.mapConversationSpaces(groupSpaces) : platformSpaces);
          const preferredServerId =
            selectedServerId && preferredSpaceList.some((server) => server.id === selectedServerId)
              ? selectedServerId
              : preferredSpaceList[0]?.id ?? fallbackSpaceList[0]?.id ?? null;

          if (!preferredServerId) {
            this.workspaceLoading.set(false);
            return;
          }

          this.loadServerWorkspace(token, preferredServerId);
        },
        error: (error) => {
          this.friendRequestsLoading.set(false);
          this.stopMemberPolling();
          this.stopVoicePresencePolling();
          this.stopMessageAutoRefreshPolling();
          this.stopVoiceJoinInboxPolling();
          this.appEvents.stop();
          this.directCall.stop();
          this.workspaceLoading.set(false);
          this.voiceRoom.leave();
          this.session.set(null);
          this.currentUser.set(null);
          this.servers.set([]);
          this.conversations.set([]);
          this.conversationDirectory.set([]);
          this.attentionMentions.set([]);
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
    const pendingNavigation = this.pendingMessageNavigation();
    const pendingSearchNavigation = this.pendingSearchNavigation();
    const previousSelectedChannelId =
      pendingNavigation?.serverId === serverId
        ? pendingNavigation.channelId
        : pendingSearchNavigation?.serverId === serverId
          ? pendingSearchNavigation.channelId
        : this.selectedChannelId();

    this.stopMemberPolling(false);
    this.stopVoicePresencePolling();
    this.workspaceLoading.set(true);
    this.workspaceError.set(null);
    this.managementError.set(null);
    this.managementSuccess.set(null);
    this.setPushFeedback(null);
    this.selectedServerId.set(serverId);
    this.appEvents.setActiveServer(serverId);
    this.selectedChannelId.set(null);
    this.platformExpandedVoiceChannelId.set(null);
    this.platformTextChannelsCollapsed.set(false);
    this.platformVoiceChannelsCollapsed.set(false);
    this.closeConversationActionMenu();
    this.closeGroupOwnershipModal();
    this.closePlatformSettingsModal();
    this.groupMembersModalOpen.set(false);
    this.groupVoiceParticipantsExpanded.set(false);
    this.closeChatFilesModal();
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
          this.workspaceError.set(this.extractErrorMessage(error, 'Не удалось загрузить данные выбранного пространства'));
        }
      });
  }

  private async handleVoiceChannelSelection(channel: WorkspaceChannel, skipCallSwitchGuard = false): Promise<void> {
    if (!skipCallSwitchGuard) {
      const action = () => this.handleVoiceChannelSelection(channel, true);
      if (!this.guardCallStart(this.voiceCallDescriptor(channel), action)) {
        return;
      }
    }

    if (channel.voice_access_role === 'stranger' || channel.voice_access_role === 'guest') {
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
    this.activeVoiceCallSnapshot.set(this.buildVoiceCallSnapshot(channel));
    await this.voiceRoom.join(channel.id, token, currentUser);
    if (this.isPlatformsMode()) {
      this.platformExpandedVoiceChannelId.set(channel.id);
    }
    this.callWindowMode.set('expanded');
    this.pendingVoiceJoin.set(null);
    this.stopVoiceJoinRequestPolling();
    if (this.currentUser()?.is_admin || this.canManageActiveGroup() || channel.voice_access_role === 'owner') {
      void this.ensureVoiceChannelAccessLoaded(channel.id, true);
    }
  }

  private defaultVoiceWorkspaceTab(): VoiceWorkspaceTab {
    return this.isCompactVoiceWorkspaceViewport() ? 'chat' : 'channel';
  }

  private isCompactVoiceWorkspaceViewport(): boolean {
    return typeof window !== 'undefined' && window.matchMedia('(max-width: 920px)').matches;
  }

  private buildInitialChannelLoadOptions(
    channel: WorkspaceChannel,
  ): { focusMessageId?: string | null; limit?: number; focusKind?: MessageFocusKind } {
    const pendingNavigation = this.pendingMessageNavigation();
    if (
      pendingNavigation
      && pendingNavigation.serverId === this.selectedServerId()
      && pendingNavigation.channelId === channel.id
      && pendingNavigation.focusMessageId
    ) {
      return {
        focusMessageId: pendingNavigation.focusMessageId,
        focusKind: pendingNavigation.focusKind,
        limit: Math.min(
          MAX_UNREAD_FOCUS_PAGE_SIZE,
          Math.max(MESSAGES_PAGE_SIZE, this.channelUnreadCount(channel) * 2 + UNREAD_FOCUS_PAGE_PADDING),
        ),
      };
    }

    const focusMessageId =
      this.channelMentionUnreadCount(channel) > 0 && channel.first_mention_unread_message_id
        ? channel.first_mention_unread_message_id
        : channel.first_unread_message_id;
    const unreadCount = this.channelUnreadCount(channel);
    if (!focusMessageId || unreadCount <= 0) {
      return {};
    }

    return {
      focusMessageId,
      focusKind:
        this.channelMentionUnreadCount(channel) > 0 && channel.first_mention_unread_message_id === focusMessageId
          ? 'mention'
          : 'unread',
      limit: Math.min(
        MAX_UNREAD_FOCUS_PAGE_SIZE,
        Math.max(MESSAGES_PAGE_SIZE, unreadCount * 2 + UNREAD_FOCUS_PAGE_PADDING),
      ),
    };
  }

  private loadMessagesForChannel(
    token: string,
    channelId: string,
    before?: string | null,
    options: { focusMessageId?: string | null; limit?: number; focusKind?: MessageFocusKind } = {},
  ): void {
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
      this.openedUnreadAnchorMessageId.set(options.focusMessageId ?? null);
      this.openedMessageFocusKind.set(options.focusKind ?? null);
      this.messageSearchFocusedMessageId.set(options.focusKind === 'search' ? options.focusMessageId ?? null : null);
    }

    this.workspaceApi
      .getMessages(token, channelId, options.limit ?? MESSAGES_PAGE_SIZE, before, options.focusMessageId)
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

          const pendingNavigation = this.pendingMessageNavigation();
          if (pendingNavigation && pendingNavigation.channelId === channelId) {
            this.pendingMessageNavigation.set(null);
          }

          if (isLoadingMore) {
            this.restoreMessageScrollPosition(previousScrollHeight, previousScrollTop);
          } else {
            const focusMessageId = options.focusMessageId ?? null;
            if (focusMessageId && page.items.some((message) => message.id === focusMessageId)) {
              this.scrollMessageIntoView(focusMessageId);
            } else {
              this.scrollMessagesToBottom();
            }
            const latestMessage = page.items.length ? page.items[page.items.length - 1] : null;
            this.markChannelAsRead(channelId, latestMessage?.id ?? null);
          }
        },
        error: (error) => {
          this.messagesLoading.set(false);
          this.messagesLoadingMore.set(false);
          this.messageError.set(this.extractErrorMessage(error, 'Не удалось загрузить сообщения'));
          const pendingNavigation = this.pendingMessageNavigation();
          if (pendingNavigation && pendingNavigation.channelId === channelId) {
            this.pendingMessageNavigation.set(null);
          }
        }
      });
  }

  private loadOlderMessages(): void {
    const token = this.session()?.access_token;
    const activeChannel = this.activeMessagingChannel();
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

  private compareServers(left: WorkspaceServer, right: WorkspaceServer): number {
    const leftIsCommon = left.name.trim().toLowerCase() === 'общая';
    const rightIsCommon = right.name.trim().toLowerCase() === 'общая';

    if (leftIsCommon && !rightIsCommon) {
      return -1;
    }

    if (!leftIsCommon && rightIsCommon) {
      return 1;
    }

    return left.name.localeCompare(right.name, 'ru');
  }

  private compareServerNames(leftName: string, rightName: string): number {
    const leftIsCommon = leftName.trim().toLowerCase() === 'общая';
    const rightIsCommon = rightName.trim().toLowerCase() === 'общая';

    if (leftIsCommon && !rightIsCommon) {
      return -1;
    }

    if (!leftIsCommon && rightIsCommon) {
      return 1;
    }

    return leftName.localeCompare(rightName, 'ru');
  }

  private syncVoiceAdminSelection(channels: VoiceAdminChannel[]): string | null {
    const selectedChannelId = this.voiceAdminSelectedChannelId();
    const selectedChannelName = this.voiceAdminSelectedChannelName();
    const selectedServerId = this.voiceAdminSelectedServerId();
    const preferredSelectedChannel = selectedChannelId
      ? channels.find((channel) => channel.channel_id === selectedChannelId) ?? null
      : null;

    const nextChannelName = preferredSelectedChannel?.channel_name
      ?? (selectedChannelName && channels.some((channel) => channel.channel_name === selectedChannelName)
        ? selectedChannelName
        : null)
      ?? channels[0]?.channel_name
      ?? null;

    this.voiceAdminSelectedChannelName.set(nextChannelName);

    if (!nextChannelName) {
      this.voiceAdminSelectedServerId.set(null);
      this.voiceAdminSelectedChannelId.set(null);
      return null;
    }

    const matchingChannels = channels
      .filter((channel) => channel.channel_name === nextChannelName)
      .sort((left, right) => this.compareServerNames(left.server_name, right.server_name));

    const nextChannel =
      preferredSelectedChannel?.channel_name === nextChannelName
        ? preferredSelectedChannel
        : (selectedServerId
            ? matchingChannels.find((channel) => channel.server_id === selectedServerId) ?? null
            : null)
          ?? (matchingChannels.length === 1 ? matchingChannels[0] : null);

    this.voiceAdminSelectedServerId.set(nextChannel?.server_id ?? null);
    this.voiceAdminSelectedChannelId.set(nextChannel?.channel_id ?? null);
    return nextChannel?.channel_id ?? null;
  }

  private requestAttachmentPreview(
    attachment: WorkspaceMessageAttachment,
    options?: {
      openImageAfterLoad?: boolean;
      reportErrors?: boolean;
      surface?: AttachmentActionSurface;
    }
  ): void {
    const token = this.session()?.access_token;
    if (!token) {
      return;
    }

    if (attachment.deleted_at) {
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

    if (options?.surface === 'chat') {
      this.chatFilesError.set(null);
    } else {
      this.messageError.set(null);
    }
    this.loadingAttachmentPreviewIds.add(attachment.id);
    this.loadAttachmentPreviewTrigger$.next({
      token,
      attachment,
      openImageAfterLoad: options?.openImageAfterLoad === true,
      reportErrors: options?.reportErrors,
      surface: options?.surface,
    });
  }

  private preloadInlineImagePreviews(messages: WorkspaceMessage[]): void {
    for (const message of messages) {
      for (const attachment of message.attachments) {
        if (!this.isInlineImageAttachment(attachment)) {
          continue;
        }

        this.requestAttachmentPreview(attachment, {
          reportErrors: false,
          surface: 'message',
        });
      }
    }
  }

  private preloadChatAttachmentPreviews(attachments: WorkspaceChatAttachmentSummary[]): void {
    for (const attachment of attachments) {
      const normalizedAttachment = this.toAttachmentRecord(attachment);
      if (!this.isInlineImageAttachment(normalizedAttachment)) {
        continue;
      }

      this.requestAttachmentPreview(normalizedAttachment, {
        reportErrors: false,
        surface: 'chat',
      });
    }
  }

  private shouldKeepAttachmentPreview(attachmentId: string): boolean {
    if (this.messages().some((message) => message.attachments.some((attachment) => attachment.id === attachmentId))) {
      return true;
    }

    return this.chatAttachments().some((attachment) => attachment.id === attachmentId);
  }

  private handleAttachmentActionError(
    error: unknown,
    attachmentId: string,
    surface: AttachmentActionSurface,
    fallback: string,
    reportErrors = true,
  ): void {
    let message = this.extractErrorMessage(error, fallback);

    if (error instanceof HttpErrorResponse) {
      if (error.status === 410) {
        this.clearAttachmentAvailability(attachmentId);
        this.applyAttachmentDeletedLocally(attachmentId);
        message = 'Файл удален';
      } else if (error.status === 404) {
        this.attachmentAvailabilityLabels.update((labels) => ({
          ...labels,
          [attachmentId]: 'Недоступен',
        }));
        message = 'Файл недоступен';
      } else if (error.status === 403) {
        this.attachmentAvailabilityLabels.update((labels) => ({
          ...labels,
          [attachmentId]: 'Нет доступа',
        }));
        message = 'Нет доступа к файлу';
      }
    }

    if (!reportErrors) {
      return;
    }

    if (surface === 'chat') {
      this.chatFilesError.set(message);
    } else {
      this.messageError.set(message);
    }
  }

  private attachmentAvailabilityLabel(attachmentId: string): string | null {
    return this.attachmentAvailabilityLabels()[attachmentId] ?? null;
  }

  private clearAttachmentAvailability(attachmentId: string): void {
    if (!this.attachmentAvailabilityLabels()[attachmentId]) {
      return;
    }

    this.attachmentAvailabilityLabels.update((labels) => {
      const nextLabels = { ...labels };
      delete nextLabels[attachmentId];
      return nextLabels;
    });
  }

  private attachmentKindLabel(attachment: WorkspaceMessageAttachment): string {
    const mimeType = attachment.mime_type.toLowerCase();
    if (mimeType.startsWith('image/')) {
      return 'Изображение';
    }

    if (mimeType.startsWith('audio/')) {
      return 'Аудио';
    }

    if (mimeType === 'application/pdf') {
      return 'PDF';
    }

    const extensionMatch = attachment.filename.match(/\.([a-z0-9]+)$/i);
    if (extensionMatch) {
      return extensionMatch[1].toUpperCase();
    }

    return 'Файл';
  }

  private toAttachmentRecord(
    attachment: WorkspaceMessageAttachment | WorkspaceChatAttachmentSummary
  ): WorkspaceMessageAttachment {
    if ('deleted_at' in attachment) {
      return attachment;
    }

    return {
      id: attachment.id,
      filename: attachment.filename,
      mime_type: attachment.mime_type,
      size_bytes: attachment.size_bytes,
      created_at: attachment.created_at,
      deleted_at: null,
    };
  }

  private canDeleteAttachmentById(attachmentId: string): boolean {
    const currentUserId = this.currentUser()?.id;
    if (!currentUserId) {
      return false;
    }

    for (const message of this.messages()) {
      if (message.author.id !== currentUserId) {
        continue;
      }

      if (message.attachments.some((attachment) => attachment.id === attachmentId)) {
        return true;
      }
    }

    const chatAttachment = this.chatAttachments().find((attachment) => attachment.id === attachmentId);
    return chatAttachment?.author.id === currentUserId;
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
    const activeChannel = this.activeMessagingChannel();
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

          const currentMessages = this.messages();
          const latestMessage = currentMessages.length ? currentMessages[currentMessages.length - 1] : null;
          this.markChannelAsRead(channelId, latestMessage?.id ?? null);
        },
        error: () => {
          // Silent refresh should not interrupt reading with transient errors.
        }
      });
  }

  private resetTextChannelState(): void {
    const selectedChannelId = this.selectedChannelId();
    if (selectedChannelId) {
      this.lastMarkedReadMessageIdByChannel.delete(selectedChannelId);
    }
    this.resetMessageSearchState();
    this.openedUnreadAnchorMessageId.set(null);
    this.openedMessageFocusKind.set(null);
    this.messages.set([]);
    this.clearAttachmentPreviews();
    this.openedMessageReactionPickerId.set(null);
    this.selectedReplyMessage.set(null);
    this.messagesHasMore.set(false);
    this.messagesCursor.set(null);
    this.messagesLoading.set(false);
    this.messagesLoadingMore.set(false);
    this.messageSubmitting.set(false);
    this.messageUploadOutcome.set('idle');
    this.messageDraft.set('');
    this.clearComposerMentionState();
    this.pendingFiles.set([]);
    this.messageError.set(null);
    this.chatFilesModalOpen.set(false);
    this.chatFilesLoading.set(false);
    this.chatFilesError.set(null);
    this.chatMediaTab.set('gallery');
    this.chatAttachments.set([]);
    this.deletingChatAttachmentId.set(null);
    this.scheduleMessageTextareaResize();
  }

  private resetMessageSearchState(): void {
    this.messageSearchPanelOpen.set(false);
    this.messageSearchQuery.set('');
    this.messageSearchLoading.set(false);
    this.messageSearchError.set(null);
    this.messageSearchResults.set([]);
    this.messageSearchFocusedMessageId.set(null);
    this.messageSearchQuery$.next({ channelId: null, query: '' });
  }

  private applyAttachmentDeletedLocally(attachmentId: string): void {
    this.downloadingAttachmentIds.update((ids) => ids.filter((id) => id !== attachmentId));
    this.loadingAttachmentPreviewIds.delete(attachmentId);
    this.clearAttachmentAvailability(attachmentId);

    const currentPreviewUrl = this.attachmentPreviewUrls()[attachmentId];
    if (currentPreviewUrl) {
      URL.revokeObjectURL(currentPreviewUrl);
      this.attachmentPreviewUrls.update((currentUrls) => {
        const nextUrls = { ...currentUrls };
        delete nextUrls[attachmentId];
        return nextUrls;
      });
    }

    if (this.openedImageAttachmentId() === attachmentId) {
      this.openedImageAttachmentId.set(null);
    }

    const deletedAt = new Date().toISOString();
    this.messages.update((messages) =>
      messages.map((message) => {
        let changed = false;
        const nextAttachments = message.attachments.map((attachment) => {
          if (attachment.id !== attachmentId || attachment.deleted_at) {
            return attachment;
          }

          changed = true;
          return {
            ...attachment,
            deleted_at: deletedAt,
          };
        });

        return changed
          ? {
              ...message,
              attachments: nextAttachments,
            }
          : message;
      })
    );
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

  private scheduleComposerMentionSync(): void {
    requestAnimationFrame(() => this.syncComposerMentionState());
  }

  private syncComposerMentionState(): void {
    const textarea = this.messageTextareaRef?.nativeElement;
    if (!textarea || !this.canUseComposerMentions() || this.messageSubmitting()) {
      this.clearComposerMentionState();
      return;
    }

    const selectionStart = textarea.selectionStart ?? 0;
    const selectionEnd = textarea.selectionEnd ?? selectionStart;
    if (selectionStart !== selectionEnd) {
      this.clearComposerMentionState();
      return;
    }

    const nextState = this.findComposerMentionQueryState(this.messageDraft(), selectionStart);
    if (!nextState) {
      this.clearComposerMentionState();
      return;
    }

    const previousState = this.composerMentionQueryState();
    if (
      !previousState
      || previousState.start !== nextState.start
      || previousState.end !== nextState.end
      || previousState.query !== nextState.query
    ) {
      this.composerMentionActiveIndex.set(0);
    }

    this.composerMentionQueryState.set(nextState);
  }

  private clearComposerMentionState(): void {
    this.composerMentionQueryState.set(null);
    this.composerMentionActiveIndex.set(0);
  }

  private findComposerMentionQueryState(value: string, caretIndex: number): ComposerMentionQueryState | null {
    if (caretIndex < 0 || caretIndex > value.length) {
      return null;
    }

    const beforeCaret = value.slice(0, caretIndex);
    const mentionStart = beforeCaret.lastIndexOf('@');
    if (mentionStart < 0) {
      return null;
    }

    const previousChar = mentionStart > 0 ? value[mentionStart - 1] : '';
    if (previousChar && /[\p{L}\p{N}_]/u.test(previousChar)) {
      return null;
    }

    const query = beforeCaret.slice(mentionStart + 1);
    if (/[\s\r\n@]/.test(query)) {
      return null;
    }

    const afterCaret = value.slice(caretIndex);
    const tokenEndOffset = afterCaret.search(/[\s\r\n.,!?;:)\]}@]/);
    const tokenEnd = tokenEndOffset === -1 ? value.length : caretIndex + tokenEndOffset;

    return {
      start: mentionStart,
      end: tokenEnd,
      query,
    };
  }

  private moveComposerMentionSelection(direction: 1 | -1): void {
    const candidates = this.composerMentionCandidates();
    if (!candidates.length) {
      return;
    }

    const nextIndex = (this.composerMentionActiveIndex() + direction + candidates.length) % candidates.length;
    this.composerMentionActiveIndex.set(nextIndex);
  }

  private selectActiveComposerMention(): void {
    const candidate = this.activeComposerMentionCandidate();
    if (!candidate) {
      return;
    }

    this.selectComposerMentionCandidate(candidate);
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

  private scrollMessageIntoView(messageId: string): void {
    requestAnimationFrame(() => {
      const element = this.messageListRef?.nativeElement;
      if (!element) {
        return;
      }

      const messageElement = element.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
      if (!messageElement) {
        element.scrollTop = element.scrollHeight;
        return;
      }

      messageElement.scrollIntoView({ block: 'center' });
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
    this.attachmentAvailabilityLabels.set({});
    this.openedImageAttachmentId.set(null);
  }

  private markLatestMessageAsRead(): void {
    const activeChannel = this.activeMessagingChannel();
    if (!activeChannel || (activeChannel.type !== 'text' && activeChannel.type !== 'voice')) {
      return;
    }

    const messages = this.messages();
    const latestMessage = messages.length ? messages[messages.length - 1] : null;
    this.markChannelAsRead(activeChannel.id, latestMessage?.id ?? null);
  }

  private markChannelAsRead(channelId: string, lastMessageId: string | null): void {
    const token = this.session()?.access_token;
    if (!token || !channelId || !lastMessageId) {
      return;
    }

    if (this.lastMarkedReadMessageIdByChannel.get(channelId) === lastMessageId) {
      return;
    }

    this.lastMarkedReadMessageIdByChannel.set(channelId, lastMessageId);
    const activeServer = this.activeServer();
    if (activeServer?.kind === 'workspace') {
      const channelUnreadCount = this.channels().find((channel) => channel.id === channelId)?.unread_count ?? 0;
      const channelMentionUnreadCount = this.channels().find((channel) => channel.id === channelId)?.mention_unread_count ?? 0;
      this.setChannelUnreadCount(channelId, 0);
      this.setChannelMentionUnreadCount(channelId, 0);
      this.setChannelFirstUnreadMessageId(channelId, null);
      this.setChannelFirstMentionUnreadMessageId(channelId, null);
      if (channelUnreadCount > 0) {
        this.bumpServerUnreadCount(activeServer.id, -channelUnreadCount);
      }
      if (channelMentionUnreadCount > 0) {
        this.bumpServerMentionUnreadCount(activeServer.id, -channelMentionUnreadCount);
      }
    } else {
      this.setConversationUnreadCountByChannelId(channelId, 0);
      this.setConversationMentionUnreadCountByChannelId(channelId, 0);
      this.setConversationFirstUnreadMessageIdByChannelId(channelId, null);
      this.setConversationFirstMentionUnreadMessageIdByChannelId(channelId, null);
    }
    this.markChannelReadTrigger$.next({ token, channelId, lastMessageId });
  }

  private buildUserAvatarUrl(userId: string | null, avatarUpdatedAt: string | null): string | null {
    if (!userId || !avatarUpdatedAt) {
      return null;
    }

    return `${API_BASE_URL}/api/users/${encodeURIComponent(userId)}/avatar?v=${encodeURIComponent(avatarUpdatedAt)}`;
  }

  private patchMessagesFromMemberSnapshot(members: WorkspaceMember[]): void {
    const membersByUserId = new Map(members.map((member) => [member.user_id, member]));
    this.messages.update((messages) =>
      messages.map((message) => {
        const member = membersByUserId.get(message.author.id);
        const replyAuthorMember = message.reply_to ? membersByUserId.get(message.reply_to.author.id) : null;

        return {
          ...message,
          author: member
            ? {
                ...message.author,
                nick: member.nick,
                avatar_updated_at: member.avatar_updated_at
              }
            : message.author,
          reply_to: message.reply_to && replyAuthorMember
            ? {
                ...message.reply_to,
                author: {
                  ...message.reply_to.author,
                  nick: replyAuthorMember.nick,
                  avatar_updated_at: replyAuthorMember.avatar_updated_at
                }
              }
            : message.reply_to,
          read_by: message.read_by.map((reader) => {
            const readerMember = membersByUserId.get(reader.id);
            return readerMember
              ? {
                  ...reader,
                  nick: readerMember.nick,
                  avatar_updated_at: readerMember.avatar_updated_at
                }
              : reader;
          })
        };
      })
    );
  }

  private flattenVoicePresenceParticipants(voicePresence: WorkspaceVoicePresenceChannel[]): VoiceParticipant[] {
    return voicePresence.flatMap((channel) =>
      channel.participants.map((participant) => ({
        id: participant.participant_id,
        user_id: participant.user_id,
        nick: participant.nick,
        avatar_updated_at: participant.avatar_updated_at,
        muted: participant.muted,
        owner_muted: participant.owner_muted,
        speaking: false,
        is_self: participant.user_id === this.currentUser()?.id
      }))
    );
  }

  private applyCurrentUserProfile(updatedUser: CurrentUserResponse): void {
    this.currentUser.set(updatedUser);
    this.session.update((session) => {
      if (!session) {
        return session;
      }

      const nextSession = {
        ...session,
        user: {
          ...session.user,
          ...updatedUser
        }
      };
      this.persistSession(nextSession);
      return nextSession;
    });

    this.members.update((members) =>
      members.map((member) =>
        member.user_id === updatedUser.id
          ? {
              ...member,
              nick: updatedUser.nick,
              avatar_updated_at: updatedUser.avatar_updated_at
            }
          : member
      )
    );

    this.messages.update((messages) =>
      messages.map((message) =>
        ({
          ...message,
          author:
            message.author.id === updatedUser.id
              ? {
                  ...message.author,
                  nick: updatedUser.nick,
                          avatar_updated_at: updatedUser.avatar_updated_at
                }
              : message.author,
          reply_to:
            message.reply_to?.author.id === updatedUser.id
              ? {
                  ...message.reply_to,
                  author: {
                    ...message.reply_to.author,
                    nick: updatedUser.nick,
                                avatar_updated_at: updatedUser.avatar_updated_at
                  }
                }
              : message.reply_to,
          read_by: message.read_by.map((reader) =>
            reader.id === updatedUser.id
              ? {
                  ...reader,
                  nick: updatedUser.nick,
                      avatar_updated_at: updatedUser.avatar_updated_at
                }
              : reader
          )
        })
      )
    );

    this.voicePresence.update((channels) =>
      channels.map((channel) => ({
        ...channel,
        participants: channel.participants.map((participant) =>
          participant.user_id === updatedUser.id
            ? {
                ...participant,
                nick: updatedUser.nick,
                    avatar_updated_at: updatedUser.avatar_updated_at
              }
            : participant
        )
      }))
    );

    this.voiceAdminUsers.update((users) =>
      users.map((user) =>
        user.user_id === updatedUser.id
          ? {
              ...user,
              nick: updatedUser.nick,
              avatar_updated_at: updatedUser.avatar_updated_at
            }
          : user
      )
    );

    this.voiceAccessEntriesByChannelId.update((currentState) => {
      const nextState: Record<string, VoiceChannelAccessEntry[]> = {};
      for (const [channelId, entries] of Object.entries(currentState)) {
        nextState[channelId] = entries.map((entry) =>
          entry.user_id === updatedUser.id
            ? {
                ...entry,
                nick: updatedUser.nick,
                    avatar_updated_at: updatedUser.avatar_updated_at
              }
            : entry
        );
      }

      return nextState;
    });

    this.voiceRoom.syncCurrentUserProfile(updatedUser);
  }

  private revokeProfileAvatarPreviewObjectUrl(): void {
    if (!this.profileAvatarPreviewObjectUrl) {
      return;
    }

    URL.revokeObjectURL(this.profileAvatarPreviewObjectUrl);
    this.profileAvatarPreviewObjectUrl = null;
  }

  private clearPendingProfileAvatar(): void {
    this.profileAvatarFile.set(null);
    this.profileAvatarPreviewUrl.set(null);
    this.revokeProfileAvatarPreviewObjectUrl();
  }

  private setProfileAvatarPreview(file: File): void {
    this.revokeProfileAvatarPreviewObjectUrl();
    this.profileAvatarPreviewObjectUrl = URL.createObjectURL(file);
    this.profileAvatarPreviewUrl.set(this.profileAvatarPreviewObjectUrl);
  }

  private async prepareProfileAvatarFile(file: File): Promise<File> {
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      throw new Error('Поддерживаются только PNG и JPG аватарки');
    }

    if (file.size > MAX_PROFILE_AVATAR_SOURCE_BYTES) {
      throw new Error('Исходное изображение слишком большое. Выберите файл до 8 МБ');
    }

    const image = await this.loadFileAsImage(file);
    if (image.width !== image.height) {
      throw new Error('Аватарка должна быть квадратной 1:1');
    }

    const targetSize = Math.min(MAX_PROFILE_AVATAR_DIMENSION, image.width, image.height);
    let preparedFile = file;

    if (image.width > MAX_PROFILE_AVATAR_DIMENSION || image.height > MAX_PROFILE_AVATAR_DIMENSION) {
      preparedFile = await this.resizeProfileAvatarFile(file, image, targetSize);
    }

    if (preparedFile.size > MAX_PROFILE_AVATAR_UPLOAD_BYTES) {
      throw new Error('Аватарка превышает лимит 2 МБ');
    }

    return preparedFile;
  }

  private loadFileAsImage(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Не удалось прочитать изображение'));
      };
      image.src = objectUrl;
    });
  }

  private resizeProfileAvatarFile(file: File, image: HTMLImageElement, targetSize: number): Promise<File> {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      canvas.width = targetSize;
      canvas.height = targetSize;

      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('Не удалось подготовить изображение'));
        return;
      }

      context.drawImage(image, 0, 0, targetSize, targetSize);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Не удалось сохранить изображение'));
            return;
          }

          resolve(
            new File([blob], file.name, {
              type: file.type,
              lastModified: Date.now()
            })
          );
        },
        file.type,
        file.type === 'image/jpeg' ? 0.92 : undefined
      );
    });
  }

  private addPendingFiles(files: File[]): void {
    if (!files.length) {
      return;
    }

    const validFiles: File[] = [];
    let rejectedFile: File | null = null;

    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
        rejectedFile = file;
        continue;
      }

      validFiles.push(file);
    }

    if (validFiles.length) {
      this.pendingFiles.set([...this.pendingFiles(), ...validFiles]);
      this.messageUploadOutcome.set('idle');
      this.messageError.set(null);
      this.schedulePresenceHeartbeat();
    }

    if (rejectedFile) {
      this.messageError.set(`Файл ${rejectedFile.name} превышает лимит 500 МБ`);
    }
  }

  private normalizeClipboardAttachmentFile(file: File, index: number): File {
    if (file.name) {
      return file;
    }

    const extension = this.attachmentFileExtensionByMimeType(file.type);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return new File([file], `clipboard-${timestamp}-${index + 1}${extension}`, {
      type: file.type,
      lastModified: file.lastModified || Date.now()
    });
  }

  private attachmentFileExtensionByMimeType(mimeType: string): string {
    switch (mimeType.toLowerCase()) {
      case 'image/png':
        return '.png';
      case 'image/jpeg':
        return '.jpg';
      case 'image/gif':
        return '.gif';
      case 'image/webp':
        return '.webp';
      default:
        return '';
    }
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
    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }

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

  private buildServerCustomIconUrl(serverId: string, iconUpdatedAt: string | null | undefined): string | null {
    if (!serverId || !iconUpdatedAt) {
      return null;
    }

    return `${API_BASE_URL}/api/servers/${serverId}/icon-file?v=${encodeURIComponent(iconUpdatedAt)}`;
  }

  private mapConversationSpaces(conversations: ConversationSummary[]): WorkspaceServer[] {
    return conversations.map((conversation) => ({
      id: conversation.id,
      name: conversation.title,
      slug: conversation.id,
      description: conversation.subtitle,
      icon_asset: conversation.icon_asset,
      icon_updated_at: conversation.icon_updated_at,
      member_role: conversation.member_role,
      kind: conversation.kind,
      unread_count: conversation.unread_count,
      mention_unread_count: conversation.mention_unread_count,
    }));
  }

  private resolveServerIconAsset(server: WorkspaceServer): string | null {
    return server.icon_asset ?? DEFAULT_SERVER_ICON_ASSET_BY_NAME[server.name] ?? null;
  }

  private serverIconUrl(server: WorkspaceServer): string | null {
    const customIconUrl = this.buildServerCustomIconUrl(server.id, server.icon_updated_at);
    if (customIconUrl) {
      return customIconUrl;
    }

    const iconAsset = this.resolveServerIconAsset(server);
    return iconAsset ? this.buildServerIconAssetUrl(iconAsset) : null;
  }

  private resolveConversationIconUrl(conversationId: string): string | null {
    const conversation = this.conversations().find((item) => item.id === conversationId);
    if (!conversation) {
      return null;
    }

    if (conversation.kind === 'direct') {
      const peer = conversation.members.find((member) => member.user_id !== this.currentUser()?.id) ?? conversation.members[0];
      return this.buildUserAvatarUrl(peer?.user_id ?? null, peer?.avatar_updated_at ?? null);
    }

    const customIconUrl = this.buildServerCustomIconUrl(conversation.id, conversation.icon_updated_at);
    if (customIconUrl) {
      return customIconUrl;
    }

    return conversation.icon_asset ? this.buildServerIconAssetUrl(conversation.icon_asset) : null;
  }

  resolveSpaceIconUrl(
    spaceId: string,
    iconAsset: string | null,
    iconUpdatedAt: string | null | undefined = null,
  ): string | null {
    if (this.isChatsMode()) {
      return this.resolveConversationIconUrl(spaceId);
    }

    const server = this.servers().find((item) => item.id === spaceId);
    if (!server) {
      const customIconUrl = this.buildServerCustomIconUrl(spaceId, iconUpdatedAt);
      if (customIconUrl) {
        return customIconUrl;
      }

      return iconAsset ? this.buildServerIconAssetUrl(iconAsset) : null;
    }

    return this.serverIconUrl(server);
  }

  private buildServerLabel(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean);
    const initials = words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? '').join('');
    return initials || name.slice(0, 2).toUpperCase();
  }

  formatMemberRole(role: string): string {
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

  formatOnlineStatus(isOnline: boolean): string {
    return isOnline ? 'Онлайн' : 'Офлайн';
  }

  displayNick(nick: string | null | undefined): string {
    return (nick ?? '').trim();
  }

  displayNickInitials(nick: string | null | undefined): string {
    const label = this.displayNick(nick).trim();
    if (!label) {
      return '--';
    }

    const parts = label.split(/\s+/u).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
    }

    return label.slice(0, 2).toUpperCase();
  }

  formatPublicUserId(publicId: number | null | undefined): string {
    if (typeof publicId !== 'number' || !Number.isFinite(publicId)) {
      return '00000';
    }

    return Math.trunc(publicId).toString().padStart(5, '0');
  }

  composerMentionLabel(candidate: ComposerMentionCandidate): string {
    const nick = this.displayNick(candidate.nick);
    return nick || this.formatPublicUserId(candidate.publicId);
  }

  userAvatarUrl(userId: string | null | undefined, avatarUpdatedAt: string | null | undefined): string | null {
    return this.buildUserAvatarUrl(userId ?? null, avatarUpdatedAt ?? null);
  }

  conversationPeer(conversation: ConversationSummary): ConversationDirectoryUser | ConversationMemberPreview | null {
    return conversation.members.find((member) => member.user_id !== this.currentUser()?.id) ?? conversation.members[0] ?? null;
  }

  conversationIconUrl(conversation: ConversationSummary): string | null {
    if (conversation.kind === 'direct') {
      const peer = this.conversationPeer(conversation);
      return this.userAvatarUrl(peer?.user_id ?? null, peer?.avatar_updated_at ?? null);
    }

    const customIconUrl = this.buildServerCustomIconUrl(conversation.id, conversation.icon_updated_at);
    if (customIconUrl) {
      return customIconUrl;
    }

    const iconAsset = conversation.icon_asset ?? DEFAULT_SERVER_ICON_ASSET_BY_NAME[conversation.title] ?? null;
    return iconAsset ? this.buildServerIconAssetUrl(iconAsset) : null;
  }

  activeSpaceIconUrl(): string | null {
    const activeServer = this.activeServer();
    if (!activeServer) {
      return null;
    }

    if (activeServer.kind === 'workspace') {
      return this.serverIconUrl(activeServer);
    }

    const activeConversation = this.activeConversation();
    return activeConversation ? this.conversationIconUrl(activeConversation) : null;
  }

  platformMetaLabel(server: WorkspaceServer): string {
    return server.description?.trim() || 'Площадка с каналами';
  }

  conversationMetaLabel(conversation: ConversationSummary): string {
    return conversation.subtitle ?? 'Сообщений пока нет';
  }

  conversationUnreadCount(conversation: ConversationSummary): number {
    return Math.max(0, conversation.unread_count ?? 0);
  }

  conversationUnreadBadgeLabel(conversation: ConversationSummary): string {
    const unreadCount = this.conversationUnreadCount(conversation);
    return unreadCount > 99 ? '99+' : String(unreadCount);
  }

  conversationMentionUnreadCount(conversation: ConversationSummary): number {
    return Math.max(0, conversation.mention_unread_count ?? 0);
  }

  conversationMentionUnreadBadgeLabel(conversation: ConversationSummary): string {
    const mentionUnreadCount = this.conversationMentionUnreadCount(conversation);
    return mentionUnreadCount > 99 ? '99+' : String(mentionUnreadCount);
  }

  platformUnreadCount(server: WorkspaceServer): number {
    return Math.max(0, server.unread_count ?? 0);
  }

  platformUnreadBadgeLabel(server: WorkspaceServer): string {
    const unreadCount = this.platformUnreadCount(server);
    return unreadCount > 99 ? '99+' : String(unreadCount);
  }

  platformMentionUnreadCount(server: WorkspaceServer): number {
    return Math.max(0, server.mention_unread_count ?? 0);
  }

  platformMentionUnreadBadgeLabel(server: WorkspaceServer): string {
    const mentionUnreadCount = this.platformMentionUnreadCount(server);
    return mentionUnreadCount > 99 ? '99+' : String(mentionUnreadCount);
  }

  channelUnreadCount(channel: WorkspaceChannel): number {
    return Math.max(0, channel.unread_count ?? 0);
  }

  channelUnreadBadgeLabel(channel: WorkspaceChannel): string {
    const unreadCount = this.channelUnreadCount(channel);
    return unreadCount > 99 ? '99+' : String(unreadCount);
  }

  channelMentionUnreadCount(channel: WorkspaceChannel): number {
    return Math.max(0, channel.mention_unread_count ?? 0);
  }

  channelMentionUnreadBadgeLabel(channel: WorkspaceChannel): string {
    const mentionUnreadCount = this.channelMentionUnreadCount(channel);
    return mentionUnreadCount > 99 ? '99+' : String(mentionUnreadCount);
  }

  messageMentionsCurrentUser(message: WorkspaceMessage): boolean {
    const currentUserId = this.currentUser()?.id;
    if (!currentUserId) {
      return false;
    }

    return message.mentioned_user_ids.includes(currentUserId);
  }

  messageContentSegments(message: WorkspaceMessage): MessageContentSegment[] {
    const content = message.content ?? '';
    if (!content || !message.mentioned_user_ids.length) {
      return [{ text: content, mentionUserId: null }];
    }

    const mentionCandidates = this.messageMentionCandidatesByUserId(message);
    if (!mentionCandidates.size) {
      return [{ text: content, mentionUserId: null }];
    }

    const orderedCandidates = [...mentionCandidates.entries()]
      .flatMap(([userId, tokens]) => [...tokens].map((token) => ({ userId, token })))
      .sort((left, right) => right.token.length - left.token.length);

    const normalizedContent = content;
    const contentFolded = normalizedContent.toLocaleLowerCase('ru-RU');
    const segments: MessageContentSegment[] = [];

    let segmentStart = 0;
    let searchFrom = 0;
    while (searchFrom < normalizedContent.length) {
      const mentionStart = contentFolded.indexOf('@', searchFrom);
      if (mentionStart < 0) {
        break;
      }

      if (!this.hasMentionBoundaryAt(normalizedContent, mentionStart)) {
        searchFrom = mentionStart + 1;
        continue;
      }

      const matchedCandidate = orderedCandidates.find((candidate) => {
        const mentionEnd = mentionStart + candidate.token.length;
        return (
          contentFolded.startsWith(candidate.token, mentionStart)
          && this.hasMentionBoundaryAfter(normalizedContent, mentionEnd)
        );
      });

      if (!matchedCandidate) {
        searchFrom = mentionStart + 1;
        continue;
      }

      if (mentionStart > segmentStart) {
        segments.push({
          text: normalizedContent.slice(segmentStart, mentionStart),
          mentionUserId: null,
        });
      }

      const mentionEnd = mentionStart + matchedCandidate.token.length;
      segments.push({
        text: normalizedContent.slice(mentionStart, mentionEnd),
        mentionUserId: matchedCandidate.userId,
      });
      segmentStart = mentionEnd;
      searchFrom = mentionEnd;
    }

    if (segmentStart < normalizedContent.length) {
      segments.push({
        text: normalizedContent.slice(segmentStart),
        mentionUserId: null,
      });
    }

    return segments.length ? segments : [{ text: normalizedContent, mentionUserId: null }];
  }

  isMentionSegmentCurrentUser(segment: MessageContentSegment): boolean {
    return !!segment.mentionUserId && segment.mentionUserId === this.currentUser()?.id;
  }

  messageTextHighlightChunks(text: string): TextHighlightChunk[] {
    return this.buildTextHighlightChunks(text, this.messageSearchQuery());
  }

  messageSearchPreviewChunks(result: WorkspaceMessageSearchResult): TextHighlightChunk[] {
    return this.buildTextHighlightChunks(this.messageSearchPreviewText(result), this.messageSearchQuery());
  }

  messageSearchPreviewText(result: WorkspaceMessageSearchResult): string {
    const content = (result.content ?? '').trim();
    if (!content) {
      return 'Сообщение без текста';
    }

    const terms = this.buildSearchTerms(this.messageSearchQuery());
    if (!terms.length) {
      return content.length > 180 ? `${content.slice(0, 177).trimEnd()}...` : content;
    }

    const foldedContent = content.toLocaleLowerCase('ru-RU');
    const matchIndex = terms
      .map((term) => foldedContent.indexOf(term))
      .filter((index) => index >= 0)
      .sort((left, right) => left - right)[0] ?? 0;

    const previewRadius = 72;
    const start = Math.max(0, matchIndex - previewRadius);
    const end = Math.min(content.length, matchIndex + previewRadius + 48);
    const prefix = start > 0 ? '... ' : '';
    const suffix = end < content.length ? ' ...' : '';
    return `${prefix}${content.slice(start, end).trim()}${suffix}`;
  }

  isSearchFocusedMessage(message: WorkspaceMessage): boolean {
    return this.openedMessageFocusKind() === 'search' && this.messageSearchFocusedMessageId() === message.id;
  }

  openMentionSegmentUser(segment: MessageContentSegment): void {
    if (!segment.mentionUserId) {
      return;
    }

    const member = this.groupMembers().find((entry) => entry.userId === segment.mentionUserId) ?? null;
    if (!member) {
      return;
    }

    this.openMemberCall(member);
  }

  shouldShowUnreadDivider(message: WorkspaceMessage): boolean {
    return this.openedUnreadAnchorMessageId() === message.id;
  }

  unreadDividerLabel(): string {
    if (this.openedMessageFocusKind() === 'mention') {
      return 'Упоминания';
    }

    if (this.openedMessageFocusKind() === 'search') {
      return 'Результат поиска';
    }

    return 'Непрочитанные';
  }

  activeConversationPushIcon(): string {
    return this.activeConversationPushEnabled() ? '/assets/push_on.svg' : '/assets/push_off.svg';
  }

  activeConversationPushActionLabel(): string {
    return this.activeConversationPushEnabled() ? 'Отключить push-уведомления' : 'Включить push-уведомления';
  }

  isActiveConversationPushPending(): boolean {
    const conversationId = this.activeConversation()?.id;
    return !!conversationId && this.conversationPushPendingId() === conversationId;
  }

  activeSpaceKindLabel(): string {
    if (this.isChatsMode()) {
      return 'Друг';
    }

    if (this.isPlatformsMode()) {
      return 'Площадка';
    }

    return 'Группа';
  }

  activeManagedSpaceLabel(): string {
    return this.isPlatformsMode() ? 'площадка' : 'группа';
  }

  activeManagedSpaceLabelCapitalized(): string {
    return this.isPlatformsMode() ? 'Площадка' : 'Группа';
  }

  activeManagedSpaceGenitiveLabel(): string {
    return this.isPlatformsMode() ? 'площадки' : 'группы';
  }

  activeManagedSpaceAccusativeLabel(): string {
    return this.isPlatformsMode() ? 'площадку' : 'группу';
  }

  blockedServerKindLabel(server: BlockedServerSummary): string {
    return server.kind === 'workspace' ? 'Площадка' : 'Группа';
  }

  activeSpaceMetaLabel(): string {
    if (this.isChatsMode()) {
      const peer = this.activeDirectPeer();
      return peer ? `ID: ${this.formatPublicUserId(peer.public_id)}` : 'Друг';
    }

    if (this.isPlatformsMode()) {
      const textChannelsCount = this.textChannels().length;
      const voiceChannelsCount = this.voiceChannels().length;
      return `${textChannelsCount} текстовых · ${voiceChannelsCount} голосовых`;
    }

    const group = this.activeGroupConversation();
    if (!group) {
      return 'Групповой чат';
    }

    return `${this.activeGroupMemberCount()} участников`;
  }

  globalSearchChannelLabel(channel: WorkspaceChannelSearchResult): string {
    return channel.type === 'text' ? `# ${channel.name}` : channel.name;
  }

  globalSearchChannelMetaLabel(channel: WorkspaceChannelSearchResult): string {
    const typeLabel = channel.type === 'voice' ? 'Голосовой канал' : 'Текстовый канал';
    return channel.topic?.trim() ? `${channel.server_name} · ${channel.topic}` : `${channel.server_name} · ${typeLabel}`;
  }

  globalSearchChannelTypeLabel(channel: WorkspaceChannelSearchResult): string {
    return channel.type === 'voice' ? 'Голос' : 'Текст';
  }

  searchBadgeLabel(count: number): string {
    return count > 99 ? '99+' : String(Math.max(0, count));
  }

  private buildConversationListPreview(message: WorkspaceMessage): string {
    const normalizedContent = message.content.trim().replace(/\s+/gu, ' ');
    if (normalizedContent) {
      return normalizedContent;
    }

    if (message.attachments.length > 1) {
      return `Вложения: ${message.attachments.length}`;
    }

    if (message.attachments.length === 1) {
      return 'Вложение';
    }

    return 'Новое сообщение';
  }

  private messageMentionsUserId(message: WorkspaceMessage, userId: string | null | undefined): boolean {
    if (!userId) {
      return false;
    }

    return message.mentioned_user_ids.includes(userId);
  }

  private messageMentionCandidatesByUserId(message: WorkspaceMessage): Map<string, Set<string>> {
    const candidatesByUserId = new Map<string, Set<string>>();
    const activeConversationMembers = (this.activeConversation()?.members ?? []).map((member) => ({
      userId: member.user_id,
      publicId: member.public_id,
      nick: member.nick,
    }));
    const serverMembers = this.members().map((member) => ({
      userId: member.user_id,
      publicId: member.public_id,
      nick: member.nick,
    }));
    const users = [
      ...activeConversationMembers,
      ...serverMembers,
    ];

    for (const user of users) {
      if (!message.mentioned_user_ids.includes(user.userId) || candidatesByUserId.has(user.userId)) {
        continue;
      }

      const tokens = new Set<string>();
      const normalizedNick = this.displayNick(user.nick).trim();
      if (normalizedNick) {
        tokens.add(`@${normalizedNick.toLocaleLowerCase('ru-RU')}`);
      }
      tokens.add(`@${this.formatPublicUserId(user.publicId)}`);
      candidatesByUserId.set(user.userId, tokens);
    }

    return candidatesByUserId;
  }

  private hasMentionBoundaryAt(content: string, index: number): boolean {
    if (index <= 0) {
      return true;
    }

    return this.isMentionBoundaryChar(content[index - 1] ?? '');
  }

  private buildSearchTerms(value: string): string[] {
    return value
      .trim()
      .toLocaleLowerCase('ru-RU')
      .split(/\s+/)
      .filter((part) => part.length > 0);
  }

  private buildTextHighlightChunks(text: string, query: string): TextHighlightChunk[] {
    if (!text) {
      return [{ text: '', highlighted: false }];
    }

    const escapedTerms = [...new Set(this.buildSearchTerms(query))]
      .sort((left, right) => right.length - left.length)
      .map((term) => this.escapeRegExp(term));

    if (!escapedTerms.length) {
      return [{ text, highlighted: false }];
    }

    const chunks: TextHighlightChunk[] = [];
    const matcher = new RegExp(`(${escapedTerms.join('|')})`, 'giu');
    let lastIndex = 0;

    for (const match of text.matchAll(matcher)) {
      const matchIndex = match.index ?? 0;
      const matchedText = match[0] ?? '';
      if (!matchedText) {
        continue;
      }

      if (matchIndex > lastIndex) {
        chunks.push({
          text: text.slice(lastIndex, matchIndex),
          highlighted: false,
        });
      }

      chunks.push({
        text: matchedText,
        highlighted: true,
      });
      lastIndex = matchIndex + matchedText.length;
    }

    if (lastIndex < text.length) {
      chunks.push({
        text: text.slice(lastIndex),
        highlighted: false,
      });
    }

    return chunks.length ? chunks : [{ text, highlighted: false }];
  }

  private matchesSearchTerms(terms: string[], values: Array<string | null | undefined>): boolean {
    if (!terms.length) {
      return false;
    }

    const haystack = values
      .filter((value): value is string => Boolean(value))
      .join(' ')
      .toLocaleLowerCase('ru-RU');

    return terms.every((term) => haystack.includes(term));
  }

  private hasMentionBoundaryAfter(content: string, index: number): boolean {
    if (index >= content.length) {
      return true;
    }

    return this.isMentionBoundaryChar(content[index] ?? '');
  }

  private isMentionBoundaryChar(character: string): boolean {
    return !/[\p{L}\p{N}_]/u.test(character);
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private focusMessageSearchInput(): void {
    queueMicrotask(() => this.messageSearchInputRef?.nativeElement.focus());
  }

  directConversationById(conversationId: string): ConversationSummary | null {
    return this.directConversations().find((conversation) => conversation.id === conversationId) ?? null;
  }

  findDirectConversationByUserId(userId: string): ConversationSummary | null {
    return this.directConversations().find((conversation) =>
      conversation.members.some((member) => member.user_id === userId)
    ) ?? null;
  }

  private findDirectConversationByPublicId(publicId: number): ConversationSummary | null {
    return this.directConversations().find((conversation) =>
      conversation.members.some((member) => member.public_id === publicId)
    ) ?? null;
  }

  groupConversationById(conversationId: string): ConversationSummary | null {
    return this.groupConversations().find((conversation) => conversation.id === conversationId) ?? null;
  }

  async toggleActiveConversationPush(): Promise<void> {
    const token = this.session()?.access_token;
    const conversation = this.activeConversation();
    if (!token || !conversation || this.isActiveConversationPushPending()) {
      return;
    }

    const nextEnabled = !conversation.push_enabled;
    this.conversationPushPendingId.set(conversation.id);
    this.setPushFeedback(null);

    try {
      if (nextEnabled) {
        const result = await this.browserPush.enableConversationPush(token, conversation.id);
        this.setConversationPushEnabled(conversation.id, true);
        this.setPushFeedback({
          tone: result.warning ? 'warning' : 'success',
          message: result.warning ?? 'Push-уведомления включены для этого чата'
        });
      } else {
        await this.browserPush.disableConversationPush(token, conversation.id);
        this.setConversationPushEnabled(conversation.id, false);
        this.setPushFeedback({
          tone: 'success',
          message: 'Push-уведомления выключены для этого чата'
        });
      }
    } catch (error) {
      this.setPushFeedback({
        tone: 'error',
        message: this.extractErrorMessage(
          error,
          nextEnabled
            ? 'Не удалось включить push-уведомления'
            : 'Не удалось выключить push-уведомления'
        )
      });
    } finally {
      this.conversationPushPendingId.set(null);
    }
  }

  private setConversationUnreadCount(serverId: string, unreadCount: number): void {
    const normalizedUnreadCount = Math.max(0, unreadCount);
    this.conversations.update((conversations) =>
      conversations.map((conversation) =>
        conversation.id === serverId
          ? {
              ...conversation,
              unread_count: normalizedUnreadCount,
            }
          : conversation
      )
    );
  }

  private setConversationMentionUnreadCount(serverId: string, mentionUnreadCount: number): void {
    const normalizedMentionUnreadCount = Math.max(0, mentionUnreadCount);
    this.conversations.update((conversations) =>
      conversations.map((conversation) =>
        conversation.id === serverId
          ? {
              ...conversation,
              mention_unread_count: normalizedMentionUnreadCount,
            }
          : conversation
      )
    );
  }

  private setConversationFirstUnreadMessageId(serverId: string, messageId: string | null): void {
    this.conversations.update((conversations) =>
      conversations.map((conversation) =>
        conversation.id === serverId
          ? {
              ...conversation,
              first_unread_message_id: messageId,
            }
          : conversation
      )
    );
  }

  private setConversationFirstMentionUnreadMessageId(serverId: string, messageId: string | null): void {
    this.conversations.update((conversations) =>
      conversations.map((conversation) =>
        conversation.id === serverId
          ? {
              ...conversation,
              first_mention_unread_message_id: messageId,
            }
          : conversation
      )
    );
  }

  private setConversationFirstUnreadMessageIdIfMissing(serverId: string, messageId: string): void {
    this.conversations.update((conversations) =>
      conversations.map((conversation) =>
        conversation.id === serverId && !conversation.first_unread_message_id
          ? {
              ...conversation,
              first_unread_message_id: messageId,
            }
          : conversation
      )
    );
  }

  private setConversationFirstMentionUnreadMessageIdIfMissing(serverId: string, messageId: string): void {
    this.conversations.update((conversations) =>
      conversations.map((conversation) =>
        conversation.id === serverId && !conversation.first_mention_unread_message_id
          ? {
              ...conversation,
              first_mention_unread_message_id: messageId,
            }
          : conversation
      )
    );
  }

  private setConversationPushEnabled(serverId: string, pushEnabled: boolean): void {
    this.conversations.update((conversations) =>
      conversations.map((conversation) =>
        conversation.id === serverId
          ? {
              ...conversation,
              push_enabled: pushEnabled,
            }
          : conversation
      )
    );
  }

  private setServerUnreadCount(serverId: string, unreadCount: number): void {
    const normalizedUnreadCount = Math.max(0, unreadCount);
    this.servers.update((servers) =>
      servers.map((server) =>
        server.id === serverId
          ? {
              ...server,
              unread_count: normalizedUnreadCount,
            }
          : server
      )
    );
  }

  private setServerMentionUnreadCount(serverId: string, mentionUnreadCount: number): void {
    const normalizedMentionUnreadCount = Math.max(0, mentionUnreadCount);
    this.servers.update((servers) =>
      servers.map((server) =>
        server.id === serverId
          ? {
              ...server,
              mention_unread_count: normalizedMentionUnreadCount,
            }
          : server
      )
    );
  }

  private setChannelUnreadCount(channelId: string, unreadCount: number): void {
    const normalizedUnreadCount = Math.max(0, unreadCount);
    this.channels.update((channels) =>
      channels.map((channel) =>
        channel.id === channelId
          ? {
              ...channel,
              unread_count: normalizedUnreadCount,
            }
          : channel
      )
    );
  }

  private setChannelMentionUnreadCount(channelId: string, mentionUnreadCount: number): void {
    const normalizedMentionUnreadCount = Math.max(0, mentionUnreadCount);
    this.channels.update((channels) =>
      channels.map((channel) =>
        channel.id === channelId
          ? {
              ...channel,
              mention_unread_count: normalizedMentionUnreadCount,
            }
          : channel
      )
    );
  }

  private setChannelFirstUnreadMessageId(channelId: string, messageId: string | null): void {
    this.channels.update((channels) =>
      channels.map((channel) =>
        channel.id === channelId
          ? {
              ...channel,
              first_unread_message_id: messageId,
            }
          : channel
      )
    );
  }

  private setChannelFirstMentionUnreadMessageId(channelId: string, messageId: string | null): void {
    this.channels.update((channels) =>
      channels.map((channel) =>
        channel.id === channelId
          ? {
              ...channel,
              first_mention_unread_message_id: messageId,
            }
          : channel
      )
    );
  }

  private setChannelFirstUnreadMessageIdIfMissing(channelId: string, messageId: string): void {
    this.channels.update((channels) =>
      channels.map((channel) =>
        channel.id === channelId && !channel.first_unread_message_id
          ? {
              ...channel,
              first_unread_message_id: messageId,
            }
          : channel
      )
    );
  }

  private setChannelFirstMentionUnreadMessageIdIfMissing(channelId: string, messageId: string): void {
    this.channels.update((channels) =>
      channels.map((channel) =>
        channel.id === channelId && !channel.first_mention_unread_message_id
          ? {
              ...channel,
              first_mention_unread_message_id: messageId,
            }
          : channel
      )
    );
  }

  private bumpServerUnreadCount(serverId: string, delta = 1): void {
    if (!delta) {
      return;
    }

    this.servers.update((servers) =>
      servers.map((server) =>
        server.id === serverId
          ? {
              ...server,
              unread_count: Math.max(0, (server.unread_count ?? 0) + delta),
            }
          : server
      )
    );
  }

  private bumpServerMentionUnreadCount(serverId: string, delta = 1): void {
    if (!delta) {
      return;
    }

    this.servers.update((servers) =>
      servers.map((server) =>
        server.id === serverId
          ? {
              ...server,
              mention_unread_count: Math.max(0, (server.mention_unread_count ?? 0) + delta),
            }
          : server
      )
    );
  }

  private bumpChannelUnreadCount(channelId: string, delta = 1): void {
    if (!delta) {
      return;
    }

    this.channels.update((channels) =>
      channels.map((channel) =>
        channel.id === channelId
          ? {
              ...channel,
              unread_count: Math.max(0, (channel.unread_count ?? 0) + delta),
            }
          : channel
      )
    );
  }

  private bumpChannelMentionUnreadCount(channelId: string, delta = 1): void {
    if (!delta) {
      return;
    }

    this.channels.update((channels) =>
      channels.map((channel) =>
        channel.id === channelId
          ? {
              ...channel,
              mention_unread_count: Math.max(0, (channel.mention_unread_count ?? 0) + delta),
            }
          : channel
      )
    );
  }

  private setConversationUnreadCountByChannelId(channelId: string, unreadCount: number): void {
    const normalizedUnreadCount = Math.max(0, unreadCount);
    this.conversations.update((conversations) =>
      conversations.map((conversation) =>
        conversation.primary_channel_id === channelId
          ? {
              ...conversation,
              unread_count: normalizedUnreadCount,
            }
          : conversation
      )
    );
  }

  private setConversationMentionUnreadCountByChannelId(channelId: string, mentionUnreadCount: number): void {
    const normalizedMentionUnreadCount = Math.max(0, mentionUnreadCount);
    this.conversations.update((conversations) =>
      conversations.map((conversation) =>
        conversation.primary_channel_id === channelId
          ? {
              ...conversation,
              mention_unread_count: normalizedMentionUnreadCount,
            }
          : conversation
      )
    );
  }

  private setConversationFirstUnreadMessageIdByChannelId(channelId: string, messageId: string | null): void {
    this.conversations.update((conversations) =>
      conversations.map((conversation) =>
        conversation.primary_channel_id === channelId
          ? {
              ...conversation,
              first_unread_message_id: messageId,
            }
          : conversation
      )
    );
  }

  private setConversationFirstMentionUnreadMessageIdByChannelId(channelId: string, messageId: string | null): void {
    this.conversations.update((conversations) =>
      conversations.map((conversation) =>
        conversation.primary_channel_id === channelId
          ? {
              ...conversation,
              first_mention_unread_message_id: messageId,
            }
          : conversation
      )
    );
  }

  private bumpConversationUnreadCount(serverId: string, delta = 1): void {
    if (!delta) {
      return;
    }

    this.conversations.update((conversations) =>
      conversations.map((conversation) =>
        conversation.id === serverId
          ? {
              ...conversation,
              unread_count: Math.max(0, (conversation.unread_count ?? 0) + delta),
            }
          : conversation
      )
    );
  }

  private bumpConversationMentionUnreadCount(serverId: string, delta = 1): void {
    if (!delta) {
      return;
    }

    this.conversations.update((conversations) =>
      conversations.map((conversation) =>
        conversation.id === serverId
          ? {
              ...conversation,
              mention_unread_count: Math.max(0, (conversation.mention_unread_count ?? 0) + delta),
            }
          : conversation
      )
    );
  }

  activeConversationIconUrl(): string | null {
    const conversation = this.activeConversation();
    return conversation ? this.conversationIconUrl(conversation) : null;
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

  private compareVoiceAccessEntries(left: VoiceChannelAccessEntry, right: VoiceChannelAccessEntry): number {
    const roleOrder = { owner: 0, resident: 1, guest: 2, stranger: 3 };
    const leftRoleWeight = roleOrder[left.role] ?? 4;
    const rightRoleWeight = roleOrder[right.role] ?? 4;
    if (leftRoleWeight !== rightRoleWeight) {
      return leftRoleWeight - rightRoleWeight;
    }

    if (left.is_in_channel !== right.is_in_channel) {
      return left.is_in_channel ? -1 : 1;
    }

    if (left.is_online !== right.is_online) {
      return left.is_online ? -1 : 1;
    }

    return this.displayNick(left.nick).localeCompare(this.displayNick(right.nick), 'ru');
  }

  private formatVoiceAccessRole(role: VoiceAccessRole): string {
    if (role === 'owner') {
      return 'Владелец';
    }

    if (role === 'resident') {
      return 'Житель';
    }

    if (role === 'guest') {
      return 'Гость';
    }

    return 'Чужак';
  }

  voiceAccessRoleLabel(role: VoiceAccessRole): string {
    return this.formatVoiceAccessRole(role);
  }

  buildVoiceAdminStatusChips(entry: VoiceChannelAccessEntry): VoiceAdminStatusChip[] {
    const chips: VoiceAdminStatusChip[] = [
      {
        label: this.formatVoiceAccessRole(entry.role),
        tone: 'neutral'
      },
      {
        label: entry.is_online ? 'Онлайн' : 'Офлайн',
        tone: entry.is_online ? 'online' : 'neutral'
      }
    ];

    if (entry.is_in_channel) {
      chips.push({
        label: entry.owner_muted ? 'В канале · заглушен' : entry.muted ? 'В канале · микрофон выкл.' : 'В канале',
        tone: entry.owner_muted ? 'danger' : entry.muted ? 'warning' : 'active'
      });
    }

    if (!entry.is_in_channel && entry.owner_muted) {
      chips.push({
        label: 'Микрофон заблокирован',
        tone: 'danger'
      });
    }

    if (entry.temporary_access_until) {
      chips.push({
        label: `Впущен до ${this.formatShortDateTime(entry.temporary_access_until)}`,
        tone: 'active'
      });
    }

    if (entry.blocked_until) {
      chips.push({
        label: `Блок до ${this.formatShortDateTime(entry.blocked_until)}`,
        tone: 'warning'
      });
    }

    return chips;
  }

  private formatShortDateTime(value: string): string {
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

  private patchVoiceAdminEntriesFromPresenceEvent(event: AppVoicePresenceUpdatedEvent): void {
    const channelIdsForServer = new Set(
      this.voiceAdminChannels()
        .filter((channel) => channel.server_id === event.server_id)
        .map((channel) => channel.channel_id)
    );

    if (!channelIdsForServer.size) {
      return;
    }

    const participantsByChannelId = new Map(
      event.voice_presence.map((channel) => [
        channel.channel_id,
        new Map(channel.participants.map((participant) => [participant.user_id, participant]))
      ])
    );

    this.voiceAccessEntriesByChannelId.update((currentState) => {
      const nextState = { ...currentState };

      for (const [channelId, entries] of Object.entries(currentState)) {
        if (!channelIdsForServer.has(channelId)) {
          continue;
        }

        const participantsByUserId = participantsByChannelId.get(channelId) ?? new Map();
        nextState[channelId] = entries.map((entry) => {
          const participant = participantsByUserId.get(entry.user_id);
          return {
            ...entry,
            is_in_channel: Boolean(participant),
            muted: participant?.muted ?? false,
            owner_muted: participant?.owner_muted ?? entry.owner_muted
          };
        });
      }

      return nextState;
    });
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

  private resolveApiUrl(path: string): string {
    if (/^https?:\/\//i.test(path)) {
      return path;
    }

    return new URL(path, API_BASE_URL).toString();
  }

  private toRangeValue(value: number | string): number {
    const normalized = typeof value === 'number' ? value : Number.parseFloat(value);
    if (Number.isNaN(normalized)) {
      return 0;
    }

    return normalized;
  }
}
