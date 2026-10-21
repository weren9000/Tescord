import { WorkspaceStateStore } from './core/services/workspace-state.store';
import { prepareProfileAvatarFile, normalizeClipboardAttachmentFile } from './shared/image-files';
import { AuthPageComponent } from './auth/auth-page.component';
import { SessionStorageService } from './core/services/session-storage.service';
import {MessageTextComponent, RenderedMessageSegment} from './workspace/message-text.component';
import {BoundedCache} from './shared/bounded-cache';
import {ShopComponent} from './workspace/shop.component';
import {UserCardDirective} from './workspace/user-card.directive';
import {UserCardService} from './workspace/user-card.service';
import {UserCardComponent} from './workspace/user-card.component';
import {AndroidCallOutputComponent} from './workspace/android-call-output.component';
import {WalletDialogComponent} from './workspace/wallet-dialog.component';
import {WalletBalanceComponent} from './workspace/wallet-balance.component';
import {WalletService} from './workspace/wallet.service';
import {LandingComponent} from './landing/landing.component';
import {FriendLinkComponent} from './workspace/friend-link.component';
import {FriendInviteComponent} from './workspace/friend-invite.component';
import {MobileViewportDirective} from './workspace/mobile-viewport.directive';
import {PwaInstallService} from './core/services/pwa-install.service';
import {PlatformListComponent} from './workspace/platform-list.component';
import {PlatformChatsComponent} from './workspace/platform-chats.component';
import {PlatformApiService} from './core/api/platform-api.service';
import {AdminDirectoryComponent} from './workspace/admin-directory.component';
import {AudioDevicePickerComponent} from './workspace/audio-device-picker.component';
import { InfoPanelComponent } from './workspace/info-panel.component';
import { ActionMenuComponent } from './workspace/action-menu.component';
import { ThemeControllerComponent } from './workspace/theme-controller.component';
import { DesktopPreferencesService } from './workspace/desktop-preferences.service';
import { DesktopPreferencesComponent } from './workspace/desktop-preferences.component';
import { SidebarResizeDirective } from './workspace/sidebar-resize.directive';
import { MessageGestureDirective } from './workspace/message-gesture.directive';
import { MessageActionsComponent } from './workspace/message-actions.component';
import { EmojiPickerComponent } from './workspace/emoji-picker.component';
import { WallpapersComponent, WallpaperStyle } from './workspace/wallpapers.component';
import { synchronizeMessages } from './core/services/message-sync';
import { InventoryComponent } from './workspace/inventory.component';
import { SectionNavigationComponent } from './workspace/section-navigation.component';
import { UiIconComponent } from './workspace/ui-icon.component';
import { ConversationListComponent } from './workspace/conversation-list.component';
import { QuickSwitchComponent, QuickLink } from './workspace/quick-switch.component';
import { InviteManagerComponent } from './workspace/invite-manager.component';
import { ActivityService } from './core/services/activity.service';
import { InvitesApiService, InvitePreview, FriendSpaceInvitation } from './core/api/invites-api.service';
import { WorkspaceMemoryService } from './core/services/workspace-memory.service';
import { isMessageContinuation } from './core/services/message-layout';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {AvatarPickerComponent, AvatarChoice} from './workspace/avatar-picker.component';
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
  firstValueFrom,
  forkJoin,
  mergeMap,
  of,
  switchMap,
  throwError,
  map,
  takeUntil,
  tap
} from 'rxjs';

import { AuthFormStore } from './core/services/auth-form.store';
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
import { AuthSessionResponse } from './core/models/auth.models';
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

type ChannelKind = 'text' | 'voice';
type WorkspaceMode = 'chats' | 'groups' | 'platforms';
type VoicePresenceTone = 'speaking' | 'open' | 'muted' | 'blocked';
type MemberPresenceTone = VoicePresenceTone | 'inactive';
type MobilePanel = 'servers' | 'channels' | 'members' | null;
type VoiceAccessRole = 'owner' | 'resident' | 'guest' | 'stranger';
type VoiceWorkspaceTab = 'chat' | 'channel';
type ConversationCreateTab = 'direct' | 'group';
type PushFeedbackTone = 'success' | 'warning' | 'error';
type MessageFocusKind = 'unread' | 'mention' | 'search' | 'restore';
type ChatMediaTab = 'gallery' | 'files';
type AttachmentActionSurface = 'message' | 'chat';
type MessageUploadOutcome = 'idle' | 'uploading' | 'cancelled' | 'failed';
type VoiceVideoSource = 'camera' | 'screen-share';
type VoiceVideoLayoutMode = 'grid-1' | 'grid-2' | 'grid-4' | 'grid-6' | 'grid-9' | 'presentation';
type CallSurfaceKind = 'direct' | 'group' | 'platform';
type VoiceCallSurfaceKind = Exclude<CallSurfaceKind, 'direct'>;
type CallWindowMode = 'expanded' | 'minimized';

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
  avatarPreset?: string | null;
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
    clientMessageId: string;
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

const MESSAGES_PAGE_SIZE = 25;
const UNREAD_FOCUS_PAGE_PADDING = 24;
const MAX_UNREAD_FOCUS_PAGE_SIZE = 200;
const MAX_ATTACHMENT_SIZE_BYTES = 500 * 1024 * 1024;
const MAX_INLINE_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const PRESENCE_ACTIVITY_THROTTLE_MS = 30000;
const PRESENCE_KEEPALIVE_INTERVAL_MS = 60000;
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
  providers: [AuthFormStore, WorkspaceStateStore],
    selector: 'app-root',
    imports: [PlatformChatsComponent, AuthPageComponent, MessageTextComponent, ShopComponent, UserCardDirective, UserCardComponent, WalletDialogComponent, WalletBalanceComponent, AndroidCallOutputComponent, LandingComponent, FriendLinkComponent, FriendInviteComponent, MobileViewportDirective, PlatformListComponent, AdminDirectoryComponent, AvatarPickerComponent, AudioDevicePickerComponent, InfoPanelComponent, ActionMenuComponent, CommonModule, FormsModule, MediaStreamSrcDirective, SectionNavigationComponent, UiIconComponent, ConversationListComponent, QuickSwitchComponent, InviteManagerComponent, InventoryComponent, WallpapersComponent, ThemeControllerComponent, MessageGestureDirective, MessageActionsComponent, EmojiPickerComponent, DesktopPreferencesComponent, SidebarResizeDirective],
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.scss', './app-layout.scss', './call-workspace.scss', './platform-workspace.scss', './invite-entry.scss', './palette-theme.scss', './avatar-presets.scss', './mobile-workspace.scss', './chat-bubbles.scss', './conference-stage.scss']
})
export class AppComponent {
  readonly platformApi = inject(PlatformApiService);
  readonly selectedPlatformId = signal<string | null>(null);
  readonly pendingPlatformInvite = signal(/^\/platform-invite\/([A-Za-z0-9_-]{43})\/?$/.exec(window.location.pathname)?.[1] ?? null);
  readonly activePlatform = computed(() => this.platformApi.platforms().find(p => p.id === this.selectedPlatformId()) ?? null);
  readonly platformConversations = computed(() => this.conversations().filter(c => !!c.platform_id));
  platformNotificationsEnabled(conversation: ConversationSummary): boolean {
    return !conversation.platform_id || this.platformApi.platforms().find(p => p.id === conversation.platform_id)?.notifications_enabled === true;
  }
  readonly selectedPlatformChats = computed(() => this.platformConversations().filter(c => c.platform_id === this.selectedPlatformId()).sort((a,b) => (a.platform_position ?? 0) - (b.platform_position ?? 0)));
  async platformChanged(chatId: string | null): Promise<void> {
    const token = this.session()?.access_token;
    if (!token) return;
    try {
      const conversations = await firstValueFrom(this.workspaceApi.getConversations(token));
      this.conversations.set(conversations);
      if (chatId) this.openWorkspaceTarget(chatId);
      else if (!conversations.some(c => c.id === this.selectedServerId())) {
        const next = this.selectedPlatformChats()[0];
        if(next) this.openWorkspaceTarget(next.id);
        else {this.selectedServerId.set(null);this.selectedChannelId.set(null);this.channels.set([]);this.members.set([]);this.resetTextChannelState();}
      }
    } catch(error) {this.workspaceError.set(this.extractErrorMessage(error, 'Не удалось обновить площадку'));}
  }
  private readonly workspaceState = inject(WorkspaceStateStore);
  readonly pwa=inject(PwaInstallService);
  readonly adminDirectoryOpen = signal(false);
  openAdminDirectory(): void { if(this.isAdmin()||this.currentUser()?.is_avatar_admin){this.closeSideMenu();this.adminDirectoryOpen.set(true);} }
  private readonly invitesApi = inject(InvitesApiService);
  readonly desktopPreferences = inject(DesktopPreferencesService);
  readonly pinPending = signal<string[]>([]);
  readonly pinError = signal<string | null>(null);
  toggleConversationPin(id: string): void {
    const token = this.session()?.access_token;
    const conversation = this.conversations().find(c => c.id === id);
    if (!token || !conversation || this.pinPending().includes(id)) return;
    this.pinError.set(null);
    this.pinPending.update(ids => [...ids, id]);
    this.workspaceApi.setConversationPin(token, id, !conversation.pinned)
      .pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.pinPending.update(ids => ids.filter(value => value !== id))))
      .subscribe({
        next: result => {
          if (this.session()?.access_token !== token) return;
          this.conversations.update(items => items.map(c => c.id === id ? {...c, pinned: result.pinned} : c));
        },
        error: () => { if (this.session()?.access_token === token) this.pinError.set('Не удалось изменить закрепление. Попробуйте ещё раз.'); },
      });
  }
  readonly inviteManagerSpace = signal<{id: string; name: string} | null>(null);
  readonly pendingFriendInvite=signal(new URLSearchParams(window.location.search).get('friend'));
  readonly walletOpen=signal(false);
  readonly userCards=inject(UserCardService);
  readonly userCardVoiceControls=computed(()=>{const id=this.userCards.selected()?.id;return !!id&&this.activeCallVoiceParticipants().some(p=>p.user_id===id);});
  openUserCardVoice(id:string):void{this.callParticipantId.set(id);}
  openUserCardChat(id:string):void{const token=this.session()?.access_token;if(!token)return;this.closeConversationInfo();this.closeGroupMembersPanel();this.closeFriendRequestsModal();this.workspaceMode.set('chats');this.loadServerWorkspace(token,id);}
  private readonly walletService=inject(WalletService);
  private readonly walletConnection=effect(()=>{this.walletService.connect(this.session()?.access_token??'');if(!this.session())this.walletOpen.set(false);});
  readonly friendNotices=signal<{id:string;user_id:string;nick:string;reason:string}[]>([]);
  readonly memberFriendBusy=signal(false);
  readonly memberFriendError=signal('');
  memberFriendLabel(userId:string):string {
    if(this.findDirectConversationByUserId(userId))return 'Написать сообщение';
    if(this.incomingFriendRequests().some(r=>r.user.user_id===userId))return 'Принять заявку';
    if(this.outgoingFriendRequests().some(r=>r.user.user_id===userId))return 'Заявка отправлена · отменить';
    return 'Добавить в друзья';
  }
  async memberFriendAction(userId:string):Promise<void>{
    const token=this.session()?.access_token;
    if(!token||userId===this.currentUser()?.id||this.memberFriendBusy())return;
    const conversation=this.findDirectConversationByUserId(userId);
    if(conversation){this.closeMemberVolume();this.closeGroupMembersPanel();this.closeConversationInfo();this.closeFriendRequestsModal();this.workspaceMode.set('chats');this.loadServerWorkspace(token,conversation.id);return;}
    this.memberFriendBusy.set(true);this.memberFriendError.set('');
    const incoming=this.incomingFriendRequests().find(r=>r.user.user_id===userId);
    const outgoing=this.outgoingFriendRequests().find(r=>r.user.user_id===userId);
    try{
      if(incoming)await firstValueFrom(this.workspaceApi.acceptFriendRequest(token,incoming.id));
      else if(outgoing)await firstValueFrom(this.profileHttp.post(API_BASE_URL+'/api/friends/requests/'+outgoing.id+'/cancel',{},{headers:{Authorization:'Bearer '+token}}));
      else await firstValueFrom(this.workspaceApi.createFriendRequest(token,{user_id:userId}));
      await this.refreshFriendRequests(token);
      if(incoming)await this.refreshConversationsList(token);
    }catch(error){this.memberFriendError.set(this.extractErrorMessage(error,'Не удалось обработать заявку'));await this.refreshFriendRequests(token);}
    finally{this.memberFriendBusy.set(false);}
  }
  async friendLinkJoined(serverId:string):Promise<void>{
    const token=this.session()?.access_token;if(!token)return;
    this.dismissFriendInvite();this.workspaceMode.set('chats');
    await this.refreshConversationsList(token);
    this.loadServerWorkspace(token,serverId);
  }
  async dismissFriendNotice(id:string):Promise<void>{
    const token=this.session()?.access_token;if(!token)return;
    try{await firstValueFrom(this.profileHttp.delete(API_BASE_URL+'/api/friends/notices/'+id,{headers:{Authorization:'Bearer '+token}}));this.friendNotices.update(rows=>rows.filter(n=>n.id!==id));}
    catch{this.friendRequestsError.set('Не удалось скрыть уведомление');}
  }
  dismissFriendInvite():void{this.pendingFriendInvite.set(null);const url=new URL(window.location.href);url.searchParams.delete('friend');window.history.replaceState({},'',url.pathname+url.search+url.hash);}
  readonly pendingInviteCode = signal(/^\/invite\/([^/]+)\/?$/.exec(window.location.pathname)?.[1] ?? null);
  readonly invitePreview = signal<InvitePreview | null>(null);
  readonly inviteError = signal('');
  readonly inviteJoining = signal(false);
  private inviteReturnFocus: HTMLElement | null = null;
  openInvites(): void {
    const space = this.activeServer();
    if (!space || this.isChatsMode() || !this.canManageActiveGroup()) return;
    this.inviteReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.closeConversationActionMenu();
    this.inviteManagerSpace.set({id: space.id, name: space.name});
  }
  closeInvites(): void {
    this.inviteManagerSpace.set(null);
    const target = this.inviteReturnFocus?.isConnected ? this.inviteReturnFocus : document.querySelector<HTMLElement>('.conversation-head__settings-toggle');
    target?.focus();
  }
  dismissInvite(): void {
    if (this.inviteJoining()) return;
    this.pendingInviteCode.set(null); this.invitePreview.set(null); this.inviteError.set('');
    window.history.replaceState({}, '', '/');
    const token = this.session()?.access_token;
    if (token) this.bootstrapWorkspace(token);
  }
  retryInvite(): void {
    const token = this.session()?.access_token;
    if (token && !this.inviteJoining()) this.bootstrapWorkspace(token);
  }
  private previewPendingInvite(): void {
    const code = this.pendingInviteCode();
    if (!code) return;
    this.invitesApi.preview(code).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: result => { if (this.pendingInviteCode() === code) this.invitePreview.set(result); },
      error: error => { if (this.pendingInviteCode() === code && !this.session()) this.inviteError.set(this.extractErrorMessage(error, 'Не удалось проверить приглашение')); },
    });
  }
  private readonly workspaceMemory = inject(WorkspaceMemoryService);
  readonly quickSwitchOpen = signal(false);
  readonly showJumpToLatest = signal(false);
  private quickSwitchReturnFocus: HTMLElement | null = null;
  private workspaceLoadId = 0;
  private messageLoadId = 0;
  private homeSpaceId: string | null = null;
  private readonly workspaceKeydown = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && this.session()) {
      event.preventDefault();
      this.quickSwitchOpen() ? this.closeQuickSwitch() : this.openQuickSwitch();
    }
  };
  private readonly saveWorkspacePosition = () => this.rememberMessagePosition();
  private positionSaveTimer?: ReturnType<typeof setTimeout>;
  private readonly saveHiddenPosition = () => {
    if (document.visibilityState === 'hidden') this.rememberMessagePosition();
  };
  readonly messageActionsTarget = signal<WorkspaceMessage | null>(null);
  readonly messageActionsAnchor=signal<{x:number;y:number}|null>(null);
  readonly composerEmojiOpen=signal(false);
  private readonly bubbleDayFormat=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric'});
  private readonly bubbleClockFormat=new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit'});
  private readonly messageViewCache = new WeakMap<WorkspaceMessage, {query:string;source:MessageContentSegment[];value:RenderedMessageSegment[]}>();
  messageTextModel(message:WorkspaceMessage):RenderedMessageSegment[]{
    const source=this.messageContentSegments(message),query=this.messageSearchQuery();
    const cached=this.messageViewCache.get(message);
    if(cached&&cached.query===query&&cached.source===source)return cached.value;
    const value=source.map(segment=>({...segment,chunks:this.messageTextHighlightChunks(segment.text).map(chunk=>({...chunk,links:!segment.mentionUserId&&!chunk.highlighted?this.messageLinks(chunk.text):[]}))}));
    this.messageViewCache.set(message,{query,source,value});return value;
  }
  private readonly linkCache = new BoundedCache<{text:string;url:string|null}[]>();
  private readonly highlightCache = new BoundedCache<TextHighlightChunk[]>();
  private readonly previewCache = new BoundedCache<string>();
  private segmentCache = new WeakMap<WorkspaceMessage, {content:string;mentions:string;context:object;value:MessageContentSegment[]}>();
  private readonly mentionContext = computed(() => ({members:this.members(), conversation:this.activeConversation()?.members}));
  messageLinks(text:string):{text:string;url:string|null}[]{return this.linkCache.get(text,()=>this.parseMessageLinks(text));}
  private parseMessageLinks(text:string):{text:string;url:string|null}[]{return text.split(/(https?:\/\/[^\s<>]+)/g).filter(Boolean).flatMap(part=>{if(!/^https?:\/\//i.test(part))return [{text:part,url:null}];const clean=part.replace(/[.,!?]+$/,'');try{const url=new URL(clean);if(!['http:','https:'].includes(url.protocol))return [{text:part,url:null}];return [{text:clean,url:clean},...(clean.length<part.length?[{text:part.slice(clean.length),url:null}]:[])];}catch{return [{text:part,url:null}];}});}
  insertComposerEmoji(emoji:string):void {const field=this.messageTextareaRef?.nativeElement;const draft=this.messageDraft();const at=field?.selectionStart??draft.length;const end=field?.selectionEnd??at;this.onMessageDraftChange(draft.slice(0,at)+emoji+draft.slice(end));this.composerEmojiOpen.set(false);requestAnimationFrame(()=>{field?.focus();field?.setSelectionRange(at+emoji.length,at+emoji.length);});}
  reactFromMenu(code:WorkspaceMessageReactionCode):void {const target=this.messageActionsTarget();this.closeMessageActions();if(target)this.toggleMessageReaction(target,this.messageReactionOptions.find(item=>item.emoji===code)?.code??code);}
  messageDay(value:string):string{return this.bubbleDayFormat.format(new Date(value));}
  startsMessageDay(message:WorkspaceMessage,index:number):boolean{return index===0||new Date(message.created_at).toDateString()!==new Date(this.messages()[index-1].created_at).toDateString();}
  messageClock(value:string):string{return this.bubbleClockFormat.format(new Date(value));}
  goToReply(message:WorkspaceMessage):void {const reply=message.reply_to;const token=this.session()?.access_token;const channel=this.activeMessagingChannel();if(!reply||!token||!channel)return;this.messageSearchFocusedMessageId.set(reply.id);if(this.messages().some(m=>m.id===reply.id)){this.openedMessageFocusKind.set('search');this.scrollMessageIntoView(reply.id);return;}this.loadMessagesForChannel(token,channel.id,undefined,{focusMessageId:reply.id,focusKind:'search',limit:MESSAGES_PAGE_SIZE,preserve:true});}
  menuImage(message:WorkspaceMessage){return message.attachments.find(a=>a.mime_type.startsWith('image/')&&!a.deleted_at);}
  private messageActionsFocus: HTMLElement | null = null;
  openMessageActions(message: WorkspaceMessage, event?: Event): void {
    this.composerEmojiOpen.set(false);
    event?.preventDefault();
    this.messageActionsFocus = this.messageListRef?.nativeElement.querySelector<HTMLElement>(`[data-message-id="${message.id}"]`) ?? null;
    const rect=this.messageActionsFocus?.getBoundingClientRect();this.messageActionsAnchor.set(event instanceof MouseEvent?{x:event.clientX,y:event.clientY}:rect?{x:rect.left+45,y:rect.top+20}:null);
    this.messageActionsTarget.set(message);
  }
  closeMessageActions(): void {
    this.messageActionsTarget.set(null);
    const focus = this.messageActionsFocus;
    this.messageActionsFocus = null;
    requestAnimationFrame(() => { if (focus?.isConnected) focus.focus({preventScroll:true}); });
  }
  canDeletePlatformMessage(message: WorkspaceMessage): boolean {
    if(!this.activeConversation()?.platform_id)return false;
    if(message.author.id===this.currentUser()?.id)return true;
    const role=this.activeConversation()?.member_role;
    const target=this.activeConversation()?.members.find(m=>m.user_id===message.author.id)?.role;
    return target!=='owner' && (role==='owner' || (role==='admin' && target!=='admin'));
  }
  async deletePlatformMessage(message: WorkspaceMessage): Promise<void> {
    const token=this.session()?.access_token, platformId=this.activeConversation()?.platform_id;
    if(!token || !platformId || !this.canDeletePlatformMessage(message) || !confirm('Удалить сообщение для всех участников?'))return;
    try{await firstValueFrom(this.platformApi.request(token,'DELETE',`/${platformId}/messages/${message.id}`));
      this.messages.update(rows=>rows.map(m=>m.id===message.id?{...m,content:'Сообщение удалено',attachments:[],reactions:[]}:m));
    }catch(error){this.messageError.set(this.extractErrorMessage(error,'Не удалось удалить сообщение'));}
  }
  chooseMessageAction(action: 'reply'|'open-image'|'download-image'|'delete'): void {
    if(action==='delete'){const target=this.messageActionsTarget();this.closeMessageActions();if(target)void this.deletePlatformMessage(target);return;}
    const message = this.messageActionsTarget();
    this.closeMessageActions();
    if (!message || !this.messages().some(item => item.id === message.id)) return;
    // Run after the modal restores focus, so the composer/picker gets final focus.
    requestAnimationFrame(() => {
      if (action === 'reply') this.startReplyToMessage(message);
      else {
        const image = this.menuImage(message);
        if(image){if(action==='open-image')this.openImageAttachment(image);else this.downloadAttachment(image);}
      }
    });
  }
  private readonly workspacePopState = () => {
    const target = this.readWorkspaceUrl();
    if (target && this.session()) this.openWorkspaceTarget(target.spaceId, target.channelId);
    else if (this.session()) this.openHome();
  };
  readonly sidebarQuery = signal('');
  private matchesPlatformChannel(channel: WorkspaceChannel): boolean {
    const query=this.sidebarQuery().trim().toLocaleLowerCase('ru');
    if (!`${channel.name} ${channel.topic ?? ''}`.toLocaleLowerCase('ru').includes(query)) return false;
    return true;
  }
  resetPlatformChannelFilters(): void { this.sidebarQuery.set(''); }
  readonly expandedPlatformRosters = signal(new Set<string>());
  async togglePlatformVoiceRoom(channel: WorkspaceChannel): Promise<void> {
    this.togglePlatformRoster(channel.id);
    if (this.selectedChannelId() !== channel.id) {
      await this.selectChannel(channel, {connectVoice: false, preserveMobilePanel: true});
    }
  }
  togglePlatformRoster(channelId: string): void {
    this.expandedPlatformRosters.update(current => {
      const next = new Set(current);
      next.has(channelId) ? next.delete(channelId) : next.add(channelId);
      return next;
    });
  }
  private readonly platformSectionState = new Map<string, {text: boolean; voice: boolean}>();
  readonly platformChoices = computed(() => this.platformApi.platforms().map(space => ({
    id: space.id, name: space.name, description: space.description, icon: null,
    unread: this.platformConversations().filter(c => c.platform_id===space.id).reduce((n,c)=>n+c.unread_count,0),
    mentions: this.platformConversations().filter(c => c.platform_id===space.id).reduce((n,c)=>n+c.mention_unread_count,0),
  })));
  readonly platformBrowserStage=signal<'spaces'|'channels'>('spaces');
  selectPlatformFromPicker(id: string): void {
    this.selectedPlatformId.set(id);
    this.platformBrowserStage.set('channels');

    this.sidebarQuery.set('');
    const chat = this.selectedPlatformChats()[0];
    if (chat) this.openWorkspaceTarget(chat.id);
    else {this.selectedServerId.set(null);this.selectedChannelId.set(null);this.channels.set([]);this.resetTextChannelState();}
    if (this.isCompactVoiceWorkspaceViewport()) this.mobilePanel.set('servers');
  }
  previewPlatformVoiceChannel(channel: WorkspaceChannel): void {
    void this.selectChannel(channel, {connectVoice: false});
  }
  private readonly sectionSelection: Partial<Record<WorkspaceMode, string>> = {};
  readonly sectionTitle = computed(() => this.isChatsMode() ? 'Друзья' : this.isGroupsMode() ? 'Группы' : 'Площадки');
  readonly sectionDescription = computed(() => this.isChatsMode() ? 'Личные беседы и звонки' : this.isGroupsMode() ? 'Общение в своём кругу' : 'Сообщества и каналы');
  readonly sectionCreateLabel = computed(() => this.isChatsMode() ? 'Добавить друга' : this.isGroupsMode() ? 'Создать группу' : 'Создать площадку');
  readonly sidebarTextChannels = computed(() => this.textChannels().filter(c => this.matchesPlatformChannel(c)));
  readonly sidebarVoiceChannels = computed(() => this.voiceChannels().filter(c => this.matchesPlatformChannel(c)));
  openSectionCreate(): void {
    if (this.isPlatformsMode()) this.openCreatePlatformShortcut();
    else if (this.isGroupsMode()) this.openCreateGroupShortcut();
    else this.openCreateConversationModal('direct');
  }
  readonly conversationLinks = computed(() => this.conversations()
    .filter(c => !c.platform_id && c.kind === (this.isGroupsMode() ? 'group_chat' : 'direct') && c.title.toLocaleLowerCase('ru').includes(this.sidebarQuery().trim().toLocaleLowerCase('ru')))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned))
    .map(conversation => ({
    userId: this.conversationPeer(conversation)?.user_id, id: conversation.id, name: conversation.title, subtitle: this.conversationMetaLabel(conversation),
    pinned: !!conversation.pinned,
    icon: this.conversationIconUrl(conversation), group: conversation.kind === 'group_chat',
    online: conversation.kind === 'direct' ? this.conversationPeer(conversation)?.is_online : undefined,
    unread: this.conversationUnreadCount(conversation), mentions: this.conversationMentionUnreadCount(conversation),
  })));
  readonly quickLinks = computed<QuickLink[]>(() => {
    const query = this.globalSearchQuery().trim().toLocaleLowerCase('ru');
    const links: QuickLink[] = [
      ...this.conversations().map(c => ({id: c.id, label: c.title, detail: c.platform_id ? this.platformApi.platforms().find(p=>p.id===c.platform_id)?.name ?? 'Площадка' : c.kind === 'direct' ? 'Личная беседа' : 'Группа', spaceId: c.id})),
      ...this.channels().map(c => ({id: c.id, label: c.name, detail: this.activeServer()?.name ?? 'Канал', spaceId: this.selectedServerId()!, channelId: c.id})),
      ...this.globalSearchChannelResults().map(c => ({id: c.channel_id, label: c.name, detail: c.server_name, spaceId: c.server_id, channelId: c.channel_id})),
      ...this.conversationDirectory().filter(user => user.user_id !== this.currentUser()?.id && !this.conversations().some(c => c.kind === 'direct' && c.members.some(m => m.user_id === user.user_id)))
        .map(user => ({id: user.user_id, label: user.nick, detail: `Пользователь · ${this.formatPublicUserId(user.public_id)}`, spaceId: '', userPublicId: user.public_id})),
    ];
    return links.filter((link, index) => links.findIndex(other => other.id === link.id) === index
      && (!query || (link.label + ' ' + link.detail).toLocaleLowerCase('ru').includes(query))).slice(0, 30);
  });

  openQuickSwitch(): void {
    this.quickSwitchReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.clearGlobalSearch();
    this.quickSwitchOpen.set(true);
  }
  closeQuickSwitch(): void {
    this.quickSwitchOpen.set(false);
    this.clearGlobalSearch();
    this.quickSwitchReturnFocus?.focus();
  }
  openQuickLink(link: QuickLink): void {
    this.closeQuickSwitch();
    if (link.userPublicId) {
      this.openCreateConversationModal('direct');
      this.createConversationForm.directUserId = String(link.userPublicId);
      return;
    }
    this.openWorkspaceTarget(link.spaceId, link.channelId);
  }
  openHome(): void {
    const current = this.conversations().find(c => c.id === this.selectedServerId())
      ?? this.conversations().find(c => c.id === this.homeSpaceId) ?? this.conversations()[0];
    if (current) this.openWorkspaceTarget(current.id);
    else this.selectWorkspaceMode('chats');
  }
  openWorkspaceTarget(spaceId: string, channelId?: string): void {
    const conversation = this.conversations().find(c => c.id === spaceId);
    if (!conversation && !this.platformSpaces().some(s => s.id === spaceId)) return;
    if (conversation) this.homeSpaceId = conversation.id;
    this.applyWorkspaceMode(conversation?.platform_id ? 'platforms' : conversation ? conversation.kind === 'direct' ? 'chats' : 'groups' : 'platforms');
    if (conversation?.platform_id) this.selectedPlatformId.set(conversation.platform_id);
    const savedChannel = channelId ?? this.workspaceMemory.lastChannel(spaceId);
    if (savedChannel) this.pendingSearchNavigation.set({serverId: spaceId, channelId: savedChannel});
    if (this.selectedServerId() === spaceId && savedChannel) {
      const channel = this.channels().find(c => c.id === savedChannel);
      if (channel) {
        this.pendingSearchNavigation.set(null);
        void this.selectChannel(channel, {connectVoice: false});
        return;
      }
    }
    this.selectServer(spaceId);
  }
  private readWorkspaceUrl(): {spaceId: string; channelId: string} | undefined {
    const match = /^\/channels\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9-]+)\/?$/.exec(window.location.pathname);
    return match ? {spaceId: match[1], channelId: match[2]} : undefined;
  }
  private rememberChannelVisit(channelId: string): void {
    this.messageActionsTarget.set(null);
    if (this.pendingInviteCode() || this.pendingFriendInvite()) return;
    const spaceId = this.selectedServerId();
    if (!spaceId) return;
    this.workspaceMemory.visit(spaceId, channelId);
    this.messageDraft.set(this.workspaceMemory.channel(channelId).draft ?? '');
    this.pendingFiles.set([]);
    this.selectedReplyMessage.set(null);
    this.clearComposerMentionState();
    this.scheduleMessageTextareaResize();
    const url = `/channels/${spaceId}/${channelId}`;
    if (window.location.pathname !== url) {
      if (window.location.pathname === '/') window.history.replaceState({}, '', url);
      else window.history.pushState({}, '', url);
    }
  }
  private rememberMessagePosition(): void {
    clearTimeout(this.positionSaveTimer);
    const channelId = this.selectedChannelId();
    const list = this.messageListRef?.nativeElement;
    if (!channelId || !list || this.messagesLoading() || this.messagesLoadingMore()) return;
    const top = list.getBoundingClientRect().top;
    const row = Array.from(list.querySelectorAll<HTMLElement>('[data-message-id]')).find(row => row.getBoundingClientRect().bottom > top);
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    this.workspaceMemory.remember(channelId, {anchor: atBottom ? undefined : row?.dataset['messageId'], offset: row ? row.getBoundingClientRect().top - top : 0});
  }
  isCompactMessage(message: WorkspaceMessage, index: number): boolean {
    return !this.shouldShowUnreadDivider(message) && isMessageContinuation(message, this.messages()[index - 1]);
  }
  isMessageSeriesEnd(index: number): boolean {
    const next = this.messages()[index + 1];
    return !next || !this.isCompactMessage(next, index + 1);
  }
  jumpToLatest(): void {
    const channelId = this.selectedChannelId(), token = this.session()?.access_token;
    if (channelId && token) {
      this.workspaceMemory.remember(channelId, {anchor: undefined, offset: 0});
      this.loadMessagesForChannel(token, channelId);
    }
  }
  private readonly systemApi = inject(SystemApiService);
  private readonly authForm = inject(AuthFormStore);
  private readonly sessionStorage = inject(SessionStorageService);
  private readonly workspaceApi = inject(WorkspaceApiService);
  private readonly appEvents = inject(AppEventsService);
  private readonly browserPush = inject(BrowserPushService);
  private readonly directCall = inject(DirectCallService);
  private readonly voiceRoom = inject(VoiceRoomService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly attachmentPreviewUrls = signal<Record<string, string>>({});
  private readonly loadingAttachmentPreviewIds = new Set<string>();
  private authenticatedServicesStarted = false;
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
  private messageRefreshInFlight = false;
  private readonly pendingMessageIds = new Map<string, { signature: string; id: string }>();
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

    if (this.sideMenuOpen()) {
      event.preventDefault();
      event.stopPropagation();
      this.closeSideMenu();
      return;
    }

    if (this.callWindowMode() !== 'expanded' || !this.activeCallSurface()) {
      return;
    }

    event.preventDefault();
    if (this.callAudioSettingsOpen()) {
      this.callAudioSettingsOpen.set(false);
      return;
    }
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
    if (ref) queueMicrotask(() => ref.nativeElement.querySelector<HTMLButtonElement>('.call-media-fullscreen__back')?.focus({preventScroll:true}));
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
  readonly authError = this.authForm.error;
  readonly workspaceError = signal<string | null>(null);
  readonly messageError = signal<string | null>(null);
  readonly managementError = signal<string | null>(null);
  readonly managementSuccess = signal<string | null>(null);
  readonly pushFeedback = signal<{ tone: PushFeedbackTone; message: string } | null>(null);
  readonly authLoading = this.authForm.loading;
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
  readonly spaceInvitations = signal<FriendSpaceInvitation[]>([]);
  readonly spaceInviteBusy = signal(false);
  async respondSpaceInvitation(id: string, action: 'accept' | 'reject'): Promise<void> {
    const token = this.session()?.access_token;
    if (!token || this.spaceInviteBusy()) return;
    this.spaceInviteBusy.set(true);
    this.friendRequestsError.set(null);
    try {
      const result = await firstValueFrom(this.invitesApi.respond(token, id, action));
      if (this.session()?.access_token !== token) return;
      this.spaceInvitations.update(rows => rows.filter(row => row.id !== id));
      if (result.accepted && result.server_id && result.channel_id) {
        const refreshed = await firstValueFrom(forkJoin({
          servers: this.workspaceApi.getServers(token), conversations: this.workspaceApi.getConversations(token)
        }));
        if (this.session()?.access_token !== token) return;
        this.servers.set(this.mergeServersById(refreshed.servers));
        this.conversations.set(this.mergeConversationsById(refreshed.conversations));
        this.closeFriendRequestsModal();
        this.openWorkspaceTarget(result.server_id, result.channel_id);
      }
    } catch (error) {this.friendRequestsError.set(this.extractErrorMessage(error, 'Не удалось обработать приглашение'));}
    finally {this.spaceInviteBusy.set(false);}
  }
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
  readonly authMode = this.authForm.mode;
  readonly directCallScreenExpanded = signal(false);
  readonly callWindowMode = signal<CallWindowMode>('minimized');
  readonly callDockVolumeOpen = signal(false);
  readonly callAudioSettingsOpen = signal(false);
  readonly callMenuPage = signal<'more' | 'input' | 'output' | 'audio'>('more');
  readonly callParticipantId = signal<string | null>(null);
  readonly callParticipant = computed(() => this.activeCallVoiceParticipants().find(p => p.user_id === this.callParticipantId()) ?? null);
  readonly callDeviceChanging = signal(false);
  readonly settingsDeviceChanging = signal<'input' | 'output' | null>(null);
  readonly androidAudioRoutesSupported = !!window.kvaAndroid?.audioRoutes;
  readonly callDeviceNotice = computed(() => this.activeCallSurface()?.kind === 'direct' ? this.directCall.deviceNotice() : this.settingsNotice() || this.voiceError());
  readonly callInputDeviceId = computed(() => this.activeCallSurface()?.kind === 'direct' ? this.directCall.inputDeviceId() : this.voiceSettings().inputDeviceId);
  readonly callOutputDeviceId = computed(() => this.activeCallSurface()?.kind === 'direct' ? this.directCall.outputDeviceId() : this.voiceSettings().outputDeviceId);

  readonly callCameraDevices = signal<MediaDeviceInfo[]>([]);
  readonly callCameraDeviceId = computed(() => (this.activeCallSurface()?.kind === 'direct' ? this.directCall : this.voiceRoom).cameraDeviceId());
  async changeCallCamera(deviceId: string): Promise<void> {
    if(this.callDeviceChanging()) return;
    this.callDeviceChanging.set(true);
    try { await (this.activeCallSurface()?.kind === 'direct' ? this.directCall : this.voiceRoom).setCameraDevice(deviceId || null); }
    finally { this.callDeviceChanging.set(false); this.refreshVoiceDevices(); }
  }
  openCallMenu(page: 'more' | 'input' | 'output' | 'audio'): void {
    this.callMenuPage.set(page);
    this.callAudioSettingsOpen.set(true);
    this.refreshVoiceDevices();
  }

  async changeCallDevice(kind: 'input' | 'output', deviceId: string, control?: HTMLSelectElement): Promise<void> {
    if (this.callDeviceChanging() || !this.activeCallMediaControlsVisible()) return;
    this.callDeviceChanging.set(true);
    try {
      const service = this.activeCallSurface()?.kind === 'direct' ? this.directCall : this.voiceRoom;
      if (kind === 'input') await service.updateInputDevice(deviceId || null);
      else await service.updateOutputDevice(deviceId || null);
    } catch {
      this.setPushFeedback({tone: 'warning', message: 'Не удалось переключить устройство. Попробуйте ещё раз.'});
    } finally {
      this.callDeviceChanging.set(false);
      if (control?.isConnected) control.value = (kind === 'input' ? this.callInputDeviceId() : this.callOutputDeviceId()) ?? '';
    }
  }

  canManageCallParticipant(userId: string): boolean {
    const surface = this.activeCallSurface();
    const channel = this.channels().find(entry => entry.id === surface?.channelId);
    return surface?.kind === 'platform' && this.activeVoiceCallSnapshot()?.serverId === this.selectedServerId()
      && userId !== this.currentUser()?.id && !!this.groupMembers().find(member => member.userId === userId)
      && !!(this.currentUser()?.is_admin || this.canManageActiveGroup() || channel?.voice_access_role === 'owner');
  }

  manageCallParticipant(userId: string): void {
    const channelId = this.activeCallSurface()?.channelId;
    if (!channelId || !this.canManageCallParticipant(userId)) return;
    this.callParticipantId.set(null);
    this.minimizeCallWindow();
    this.openVoiceParticipantControls(userId, channelId);
  }
  readonly activeCallOutputMuted = computed(() => this.activeCallSurface()?.kind === 'direct'
    ? this.directCall.outputMuted() : this.voiceRoom.outputMuted());

  toggleActiveCallOutput(): void {
    if (this.activeCallSurface()?.kind === 'direct') this.directCall.toggleOutputMuted();
    else this.voiceRoom.toggleOutputMuted();
  }

  toggleCallAudioSettings(): void {
    this.openCallMenu('audio');
  }
  openCallAudioSettings(): void {
    this.openCallMenu('audio');
  }
  readonly activeCallWarning = computed(() => this.activeCallSurface()?.kind === 'direct'
    ? this.directCallError()
    : this.voiceError() || this.settingsNotice());
  readonly activeVoiceCallSnapshot = signal<VoiceCallSnapshot | null>(null);
  readonly fullscreenMedia = signal<FullscreenMediaState | null>(null);
  readonly fullscreenMediaControlsVisible = signal(true);

  readonly session = signal<AuthSessionResponse | null>(null);
  readonly shopOpen = signal(false);
  readonly inventoryMode = signal<'inventory' | 'admin' | null>(null);
  readonly inventoryUnread = signal(0);
  readonly wallpaperSuggestedItem=signal<string|null>(null);
  readonly wallpaperOpen = signal(false);
  readonly wallpaperRevision = signal(0);
  readonly wallpaperStyle = signal<WallpaperStyle>({image:'none',size:'auto'});

  refreshInventoryProfile(): void {
    this.wallpaperRevision.update(v=>v+1);
    const token = this.session()?.access_token;
    if (token) this.workspaceApi.getCurrentUser(token).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: user => this.applyCurrentUserProfile(user), error: () => {} });
  }
  readonly currentUser = signal<CurrentUserResponse | null>(null);
  readonly workspaceMode = signal<WorkspaceMode>('chats');
  readonly servers = this.workspaceState.servers;
  readonly conversations = this.workspaceState.conversations;
  readonly conversationDirectory = signal<ConversationDirectoryUser[]>([]);
  readonly channels = this.workspaceState.channels;
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
  readonly profileAvatarPreset = signal<string | null>(null);
  readonly profileAvatarChooserOpen = signal(false);
  private readonly profileFocusEffect = effect(cleanup => {
    if(!this.profileEditorOpen())return;
    const previous=document.activeElement as HTMLElement|null;
    const timer=setTimeout(()=>document.querySelector<HTMLButtonElement>('.profile-card .modal__header button')?.focus());
    cleanup(()=>{clearTimeout(timer);if(previous?.isConnected)previous.focus({preventScroll:true});});
  });
  readonly profileInventoryAvatar = signal<AvatarChoice|null>(null);
  private readonly profileHttp = inject(HttpClient);

  chooseProfileAvatar(choice: AvatarChoice): void {
    if (this.profileSaving()) return;
    this.clearPendingProfileAvatar();
    if(choice.catalog_id)this.profileInventoryAvatar.set(choice);
    else this.selectProfileAvatarPreset(choice.id);
    this.profileAvatarChooserOpen.set(false);
  }

  profileDialogKeydown(event: KeyboardEvent): void {
    event.stopPropagation();
    if(event.key==='Escape'){event.preventDefault();this.closeProfileEditor();return;}
    if(event.key!=='Tab')return;
    const buttons=Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const first=buttons[0],last=buttons.at(-1);
    if(event.shiftKey && document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}
  }
  readonly avatarPresets = [
    { id: 'frog', label: 'Лягушка' }, { id: 'cat', label: 'Кот' },
    { id: 'dog', label: 'Собака' }, { id: 'fox', label: 'Лиса' },
    { id: 'bear', label: 'Медведь' }, { id: 'wolf', label: 'Волк' },
    { id: 'panda', label: 'Панда' }, { id: 'rabbit', label: 'Заяц' },
    { id: 'raccoon', label: 'Енот' }, { id: 'owl', label: 'Сова' },
    { id: 'tiger', label: 'Тигр' }, { id: 'penguin', label: 'Пингвин' },
    { id: 'bat', label: 'Летучая мышь' }, { id: 'koala', label: 'Коала' },
    { id: 'elephant', label: 'Слон' }, { id: 'deer', label: 'Олень' },
    { id: 'capybara', label: 'Капибара' }, { id: 'monkey', label: 'Обезьяна' },
    { id: 'hedgehog', label: 'Ёж' }, { id: 'otter', label: 'Выдра' },
  ];
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
    () => this.friendNotices().length + this.spaceInvitations().length + this.pendingFriendRequestCount() + this.ownerVoiceRequests().length + this.conversationMentionTotalCount() + this.serverMentionTotalCount()
  );
  readonly friendRequestBadgeVisible = computed(() => this.notificationAlertCount() > 0);
  readonly isActiveGroupOwner = computed(() => {
    const activeServer = this.activeServer();
    return !!activeServer && activeServer.kind !== 'direct' && activeServer.member_role === 'owner';
  });
  readonly activeConversationPushEnabled = computed(() => this.activeConversation()?.push_enabled === true);


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
  readonly showLanding = computed(() => !this.isAuthenticated() && !window.kvaDesktop && window.location.pathname === '/' && !this.pendingInviteCode() && !this.pendingFriendInvite());
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
    this.conversations().filter((conversation) => conversation.kind === 'group_chat' && !conversation.platform_id)
  );
  readonly platformSpaces = computed<WorkspaceServer[]>(() =>
    this.mapConversationSpaces(this.platformConversations())
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

    return (!this.activeConversation()?.platform_id && currentUser.is_admin) || activeServer.member_role === 'owner' || activeServer.member_role === 'admin';
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

  readonly canEditActiveServerIcon = computed(() => this.canManageActiveGroup());
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
  readonly conferenceRosterOpen = signal(false);
  readonly conferenceCameraTiles = computed(() => this.buildVoiceVideoTiles(this.activeCallVoiceParticipants(), 'camera'));
  conferenceCamera(userId: string) { return this.conferenceCameraTiles().find(tile => tile.userId === userId); }
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
    const scene = surface?.channelId ? this.voiceVideoSceneForChannel(surface.channelId) : null;
    if (!scene?.stageTile) return scene;
    const screens = [scene.stageTile, ...scene.secondaryTiles.filter(tile => tile.source === 'screen-share')];
    const selected = screens.find(tile => tile.id === this.conferenceScreenId()) ?? scene.stageTile;
    return {...scene, stageTile: selected, secondaryTiles: [...screens.filter(tile => tile.id !== selected.id), ...scene.secondaryTiles.filter(tile => tile.source !== 'screen-share')]};
  });
  readonly conferenceScreenId = signal<string | null>(null);
  readonly conferenceScreens = computed(() => {
    const scene = this.activeCallVoiceVideoScene();
    return scene?.stageTile ? [scene.stageTile, ...scene.secondaryTiles.filter(tile => tile.source === 'screen-share')].sort((a,b)=>a.id.localeCompare(b.id)) : [];
  });
  readonly activeCallChatTarget = computed(() => {
    const call = this.activeCallSurface();
    if (!call) return null;
    if (call.kind === 'direct') {
      const peer = this.directCallPeer();
      const conversation = peer ? this.findDirectConversationByUserId(peer.user_id) : null;
      return conversation ? {serverId: conversation.id, mode: 'chats' as WorkspaceMode, channelId: null} : null;
    }
    const snapshot = this.activeVoiceCallSnapshot();
    const chat = this.conversations().find(c => c.id === snapshot?.serverId);
    if (snapshot && chat?.platform_id) return {serverId: snapshot.serverId, mode: 'platforms' as WorkspaceMode, channelId: chat.primary_channel_id};
    return snapshot ? {serverId: snapshot.serverId, mode: (call.kind === 'platform' ? 'platforms' : 'groups') as WorkspaceMode, channelId: call.kind === 'platform' ? snapshot.channel.id : null} : null;
  });

  openActiveCallChat(event?: Event): void {
    event?.stopPropagation();
    const target = this.activeCallChatTarget();
    if (!target) return;
    this.minimizeCallWindow(event);
    this.navigateToActiveCall(target);
  }

  private navigateToActiveCall(target: NonNullable<ReturnType<typeof this.activeCallChatTarget>>): void {
    this.workspaceMode.set(target.mode);
    const parent = this.conversations().find(c => c.id === target.serverId)?.platform_id;
    if(parent) this.selectedPlatformId.set(parent);
    this.closeMobilePanel();
    if (target.serverId !== this.selectedServerId()) {
      if (target.channelId) this.pendingSearchNavigation.set({serverId: target.serverId, channelId: target.channelId});
      this.selectServer(target.serverId);
    } else {
      const channel = target.channelId ? this.channels().find(c => c.id === target.channelId) : this.channels().find(c => c.type === 'text');
      if (channel && channel.id !== this.selectedChannelId()) void this.selectChannel(channel, {connectVoice: false});
    }
    this.voiceWorkspaceTab.set('chat');
  }
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
  readonly activeCallVolumeMin = computed(() => (this.activeCallSurface()?.kind === 'direct' ? 0 : 10));
  readonly activeCallVolumeMax = computed(() => 100);
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
  readonly activeCallCanOpenSettings = computed(() => this.activeCallSurface()?.kind === 'platform'
    && this.activeVoiceCallSnapshot()?.serverId === this.selectedServerId() && this.canOpenPlatformSettings());
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
  readonly effectiveProfileAvatarUrl = computed(() => {
    const item=this.profileInventoryAvatar();
    if(item?.catalog_id)return `${API_BASE_URL}/api/inventory/assets/${encodeURIComponent(item.catalog_id)}?preview=true`;
    if (this.profileAvatarPreset()) return this.avatarPresetUrl(this.profileAvatarPreset()!);
    if (this.profileAvatarRemove()) return this.avatarPresetUrl(this.currentUser()?.avatar_preset ?? 'frog');
    return this.profileAvatarPreviewUrl() ?? this.currentUserAvatarUrl();
  });
  readonly canSubmitProfile = computed(() => {
    const currentUser = this.currentUser();
    if (!currentUser || this.profileSaving()) {
      return false;
    }

    return (
      this.profileAvatarFile() !== null
      || this.profileInventoryAvatar() !== null
      || this.profileAvatarPreset() !== null
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
  readonly canManageGroupMembers = computed(() => !this.activeConversation()?.platform_id && this.canManageActiveGroup());

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
    const activity=inject(ActivityService);
    effect(()=>activity.setToken(this.session()?.access_token??null));
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.handleCallWindowKeydown);
      window.addEventListener('keydown', this.workspaceKeydown);
      window.addEventListener('popstate', this.workspacePopState);
      window.addEventListener('pagehide', this.saveWorkspacePosition);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('fullscreenchange', this.handleDocumentFullscreenChange);
      document.addEventListener('visibilitychange', this.saveHiddenPosition);
    }

    this.destroyRef.onDestroy(() => {
      clearTimeout(this.positionSaveTimer);
      if (typeof window !== 'undefined') {
        window.removeEventListener('keydown', this.handleCallWindowKeydown);
        window.removeEventListener('keydown', this.workspaceKeydown);
        window.removeEventListener('popstate', this.workspacePopState);
        window.removeEventListener('pagehide', this.saveWorkspacePosition);
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('fullscreenchange', this.handleDocumentFullscreenChange);
        document.removeEventListener('visibilitychange', this.saveHiddenPosition);
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
        this.callAudioSettingsOpen.set(false);
        this.callParticipantId.set(null);
        this.lastActiveCallSurfaceId = null;
        this.directCallScreenExpanded.set(false);
        this.callDockVolumeOpen.set(false);
        this.closeFullscreenMedia();
        return;
      }

      if (surfaceId !== this.lastActiveCallSurfaceId) {
        this.callAudioSettingsOpen.set(false);
        this.callParticipantId.set(null);
        this.lastActiveCallSurfaceId = surfaceId;
        this.conferenceRosterOpen.set(false);
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
      if (visibleChannel && visibleChannel.server_id === this.selectedServerId()) {
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
    const stopDesktopNotifications = window.kvaDesktop?.onNotificationOpen?.((target) => {
      if (/^\/(?:invite\/|channels\/|login(?:\?|$)|\?|$)/.test(target) && !target.startsWith('//')) {
        window.location.assign(target);
      } else if (target === 'call') { if (this.directCallState() === 'incoming') this.expandCallWindow(); }
      else this.handlePushConversationRequest(target);
    });
    if (stopDesktopNotifications) this.destroyRef.onDestroy(stopDesktopNotifications);
    this.browserPush.navigationRequests$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((conversationId) => this.handlePushConversationRequest(conversationId));
    this.appEvents.events$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => void this.handleAppEvent(event));
    this.setupPresenceActivityTracking();
    this.startPresenceKeepalive();
    this.loadHealth();
    this.previewPendingInvite();
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
    this.authForm.authenticated.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(session => this.handleAuthenticatedSession(session));
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
              this.pendingMessageIds.delete(channelId);
              const unchangedDraft = (this.workspaceMemory.channel(channelId).draft ?? '').trim() === payload.content.trim();
              if (unchangedDraft) this.workspaceMemory.remember(channelId, {draft: ''});
              if (this.selectedChannelId() !== channelId) { return; }
              if (unchangedDraft) this.messageDraft.set('');
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
          this.workspaceApi.markChannelRead(token, channelId, lastMessageId).pipe(catchError(() => {
            if (this.lastMarkedReadMessageIdByChannel.get(channelId) === lastMessageId) {
              this.lastMarkedReadMessageIdByChannel.delete(channelId);
            }
            return EMPTY;
          }))
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
        exhaustMap(({ token, avatarFile, removeAvatar, avatarPreset, successMessage, closeEditor }) =>
          this.workspaceApi.updateCurrentUserProfile(token, {
            avatarFile,
            removeAvatar,
            avatarPreset,
          }).pipe(
            tap((updatedUser) => {
              this.applyCurrentUserProfile(updatedUser);
              this.profileNotice.set(successMessage);
              this.profileError.set(null);
              if (closeEditor) {
                this.profileEditorOpen.set(false);
              }
              this.clearPendingProfileAvatar();
              this.profileAvatarRemove.set(false);
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


  openVoiceSettings(): void {
    this.closeMobilePanel();
    this.settingsPanelOpen.set(true);
    void this.voiceRoom.refreshDevices();
    void navigator.mediaDevices?.enumerateDevices().then(devices => this.callCameraDevices.set(devices.filter(d => d.kind === 'videoinput'))).catch(() => this.callCameraDevices.set([]));
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
    if(this.profileSaving())return;
    this.profileAvatarChooserOpen.set(false);
    this.profileEditorOpen.set(false);
    this.profileError.set(null);
    this.profileAvatarRemove.set(false);
    this.clearPendingProfileAvatar();
  }

  openProfileAvatarPicker(mode: 'instant' | 'editor' = 'instant'): void {
    if (mode === 'instant') {
      this.openProfileEditor();
      return;
    }
    if (!this.currentUser()?.is_avatar_admin) return;
    this.profileAvatarSelectionMode = mode;
    this.profileError.set(null);
    this.profileNotice.set(null);
    this.profileAvatarInputRef?.nativeElement.click();
  }

  async onProfileAvatarSelection(event: Event): Promise<void> {
    if (!this.currentUser()?.is_avatar_admin) return;
    const input = event.target as HTMLInputElement | null;
    const selectedFile = input?.files?.[0] ?? null;
    if (input) {
      input.value = '';
    }

    if (!selectedFile) {
      return;
    }

    try {
      const preparedFile = await prepareProfileAvatarFile(selectedFile);
      if (this.profileAvatarSelectionMode === 'editor') {
        this.profileAvatarPreset.set(null);
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
    if (!this.currentUser()?.has_uploaded_avatar && !this.profileAvatarFile()) {
      return;
    }

    this.profileAvatarRemove.set(true);
    this.clearPendingProfileAvatar();
  }

  avatarPresetUrl(id: string): string {
    return `${API_BASE_URL}/api/avatar-presets/${encodeURIComponent(id)}`;
  }

  selectProfileAvatarPreset(id: string): void {
    if (this.profileSaving()) return;
    this.clearPendingProfileAvatar();
    this.profileAvatarRemove.set(false);
    this.profileAvatarPreset.set(id);
    this.profileError.set(null);
  }

  isProfileAvatarPresetSelected(id: string): boolean {
    if (this.profileAvatarFile()) return false;
    if (this.profileAvatarPreset()) return this.profileAvatarPreset() === id;
    if (this.currentUser()?.avatar_item_id && !this.profileAvatarRemove()) return false;
    return (!this.currentUser()?.has_uploaded_avatar || this.profileAvatarRemove())
      && this.currentUser()?.avatar_preset === id;
  }

  async submitProfileChanges(): Promise<void> {
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
    const inventoryAvatar = this.profileInventoryAvatar();
    if(inventoryAvatar){
      try{
        await firstValueFrom(this.profileHttp.post(`${API_BASE_URL}/api/inventory/items/${encodeURIComponent(inventoryAvatar.id)}/equip`,{request_id:crypto.randomUUID()},{headers:{Authorization:'Bearer '+token}}));
        const updated=await firstValueFrom(this.workspaceApi.getCurrentUser(token));
        if(this.session()?.access_token!==token)return;
        this.applyCurrentUserProfile(updated);this.clearPendingProfileAvatar();this.profileEditorOpen.set(false);
      }catch(error){this.profileError.set(this.extractErrorMessage(error,'Не удалось сохранить аватар.'));}
      finally{this.profileSaving.set(false);}
      return;
    }
    this.profileUpdateTrigger$.next({
      token,
      avatarFile: this.profileAvatarFile(),
      avatarPreset: this.profileAvatarPreset(),
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

  readonly conversationInfoOpen = signal(false);
  readonly platformActionMenuOpen = signal(false);
  readonly channelActionTarget = signal<WorkspaceChannel | null>(null);
  closeWorkspaceActionMenus(): void {
    this.closeConversationActionMenu();
    this.channelActionTarget.set(null);
    this.platformActionMenuOpen.set(false);
  }
  readonly channelSettingsOnly = signal(false);
  readonly infoMemberQuery = signal('');
  readonly conversationInfoDescription = computed(() => this.servers().find(space => space.id === this.selectedServerId())?.description ?? (this.isPlatformsMode() ? this.activeServer()?.description : null));
  readonly infoMembers = computed(() => this.groupMembers().filter(member => member.nick.toLocaleLowerCase('ru').includes(this.infoMemberQuery().trim().toLocaleLowerCase('ru'))));
  private readonly closeStaleInfo = effect(() => {
    this.selectedServerId(); this.session();
    this.conversationInfoOpen.set(false);this.platformActionMenuOpen.set(false);this.channelActionTarget.set(null);this.infoMemberQuery.set('');
  });
  openConversationInfo(): void {
    if(!this.activeServer())return;
    this.memberFriendError.set('');
    this.closeConversationActionMenu();this.platformActionMenuOpen.set(false);this.channelActionTarget.set(null);
    this.infoMemberQuery.set('');this.conversationInfoOpen.set(true);
  }
  closeConversationInfo(): void { this.conversationInfoOpen.set(false); }
  openChannelActions(channel: WorkspaceChannel): void {
    this.closeConversationActionMenu();this.platformActionMenuOpen.set(false);this.channelActionTarget.set(channel);
  }
  openChannelSettings(channel: WorkspaceChannel): void {
    if(!this.canManagePlatformVoiceChannel(channel))return;
    this.channelActionTarget.set(null);this.closeConversationInfo();
    this.openPlatformSettingsModal();this.openPlatformVoiceChannelSettings(channel);this.channelSettingsOnly.set(true);
  }
  openChannelFromMenu(channel: WorkspaceChannel): void {
    this.channelActionTarget.set(null);
    if(channel.type==='voice')this.previewPlatformVoiceChannel(channel);else void this.selectChannel(channel);
  }

  readonly appearanceOpen = signal(false);

  toggleSideMenu(): void {
    if (this.callWindowExpanded()) this.minimizeCallWindow();
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
    this.workspaceMode.set('platforms');
    this.selectedPlatformId.set(null);
    this.platformBrowserStage.set('channels');
    this.mobilePanel.set('servers');
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
    this.closeBlockedServersModal();
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
    this.closeBlockedFriendsModal();
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

    if (!window.confirm(`Удалить ${this.displayNick(peer.nick)} из друзей?`)) return;
    this.closeConversationActionMenu();
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

    if (!window.confirm(`Заблокировать ${this.displayNick(peer.nick)}? Пользователь будет удалён из друзей.`)) return;
    this.closeConversationActionMenu();
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
    this.adminDirectoryOpen.set(false);
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
      const nextSpaceId = spaces.find(space => space.id === this.sectionSelection[mode])?.id ?? spaces[0]?.id ?? null;
      if (token && nextSpaceId) {
        const channelId = this.workspaceMemory.lastChannel(nextSpaceId);
        if (channelId) this.pendingSearchNavigation.set({serverId: nextSpaceId, channelId});
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
    const currentId = this.selectedServerId();
    if (currentId) this.sectionSelection[this.workspaceMode()] = currentId;
    if (mode !== this.workspaceMode()) this.sidebarQuery.set('');
    this.closeQuickCreateMenu();
    this.closeConversationActionMenu();
    this.closeGroupOwnershipModal();
    this.workspaceMode.set(mode);
  }

  openMobileWorkspaceMode(mode: WorkspaceMode): void {
    if (this.callWindowExpanded()) this.minimizeCallWindow();
    if (!this.isCompactVoiceWorkspaceViewport()) {
      this.selectWorkspaceMode(mode);
      return;
    }

    if(mode==='platforms'){this.closeSideMenu();this.closeFriendRequestsModal();this.selectWorkspaceMode(mode);this.platformBrowserStage.set('spaces');this.mobilePanel.set('servers');return;}
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
    if (this.callWindowExpanded()) this.minimizeCallWindow();
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
    if (this.callWindowExpanded()) this.minimizeCallWindow();
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
    return this.workspaceMode() === mode;
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
    this.channelSettingsOnly.set(false);
    this.platformActionMenuOpen.set(false);
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
    if (!this.canManageActiveGroup() || !this.activeServer()) {
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
    if(!window.confirm(`Удалить ${this.displayNick(member.nick)} из участников?`))return;
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
    if (this.sidebarQuery().trim()) return false;
    return section === 'text' ? this.platformTextChannelsCollapsed() : this.platformVoiceChannelsCollapsed();
  }

  togglePlatformChannelSection(section: 'text' | 'voice'): void {
    if (section === 'text') {
      this.platformTextChannelsCollapsed.update((collapsed) => !collapsed);
    } else {
      this.platformVoiceChannelsCollapsed.update((collapsed) => !collapsed);
    }
    const id = this.selectedServerId();
    if (id) this.platformSectionState.set(id, {
      text: this.platformTextChannelsCollapsed(), voice: this.platformVoiceChannelsCollapsed(),
    });
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

    if (!this.isActiveGroupOwner() && !window.confirm(action === 'leave' ? `Выйти из «${activeServer.name}»?` : `Заблокировать «${activeServer.name}» и выйти?`)) return;
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
    const parentId = this.conversations().find(c => c.id === channel.server_id)?.platform_id;
    const parent = this.platformApi.platforms().find(p => p.id === parentId);

    return {
      kind,
      serverId: channel.server_id,
      serverName: parent ? `${parent.name} · ${server?.name ?? 'Чат'}` : server?.name ?? (kind === 'platform' ? 'Площадка' : 'Группа'),
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
    const restoreKeyboardFocus = event instanceof KeyboardEvent ||
      (event instanceof MouseEvent && event.detail === 0) ||
      (!event && !!document.activeElement?.matches(':focus-visible'));
    this.callAudioSettingsOpen.set(false);
    this.callParticipantId.set(null);
    event?.stopPropagation();
    if (!this.activeCallSurface()) {
      return;
    }

    this.directCallScreenExpanded.set(false);
    this.callDockVolumeOpen.set(false);
    this.callWindowMode.set('minimized');
    if (restoreKeyboardFocus) {
      requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.call-tray__identity')?.focus({preventScroll: true}));
    }
  }

  expandCallWindow(event?: Event): void {
    event?.stopPropagation();
    if (!this.activeCallSurface()) {
      return;
    }

    const target = this.activeCallChatTarget();
    if (!target) return;
    this.navigateToActiveCall(target);
    this.closeMobilePanel();
    this.callDockVolumeOpen.set(false);
    this.callWindowMode.set('expanded');
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.conversation-head button[aria-label="Свернуть звонок"]')?.focus({preventScroll: true}));
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
    if (surface?.kind !== 'platform' || !surface.channelId || !this.activeCallCanOpenSettings()) {
      return;
    }

    this.minimizeCallWindow();
    this.openPlatformSettingsModal();
    this.platformVoiceSettingsChannelId.set(surface.channelId);
    const token = this.session()?.access_token;
    if (token) {
      void this.ensureVoiceChannelAccessLoaded(surface.channelId, true);
    }
  }

  directCallSurfaceStatusLabel(): string {
    const state = this.directCallState();
    if (state === 'connected') return 'Связь установлена';
    if (state === 'idle') {
      return '';
    }

    return this.directCallStatusLabel();
  }

  voiceCallStateLabel(): string {
    switch (this.voiceState()) {
      case 'connecting':
        return this.voiceRoom.reconnecting() ? 'Восстанавливаем связь…' : 'Подключаем…';
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

  onFullscreenPointerMove(event: PointerEvent): void {
    if (event.pointerType !== 'touch') this.showFullscreenMediaControls();
  }

  onFullscreenMediaKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    this.showFullscreenMediaControls();
    const buttons = this.callFullscreenLayerElement?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)');
    if (!buttons?.length) return;
    const first = buttons[0], last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();first.focus();
    }
  }

  toggleFullscreenMediaControls(): void {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && this.callFullscreenLayerElement?.contains(focused)) focused.blur();
    if (this.fullscreenMediaControlsVisible()) {
      this.clearFullscreenControlsHideTimer();
      this.fullscreenMediaControlsVisible.set(false);
    } else {
      this.showFullscreenMediaControls();
    }
  }

  onFullscreenStagePointerUp(event: PointerEvent): void {
    if (event.pointerType === 'touch') this.toggleFullscreenMediaControls();
    else this.showFullscreenMediaControls();
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
      const controls = this.callFullscreenLayerElement?.querySelector('.call-media-fullscreen__controls');
      const interacting = !!controls?.querySelector(':focus-visible') ||
        (window.matchMedia('(hover: hover)').matches && controls?.matches(':hover'));
      if (this.fullscreenMedia() && !interacting) {
        this.fullscreenMediaControlsVisible.set(false);
      }
    }, 3000);
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
    if (!token || !activeServer || channel.server_id !== activeServer.id || !this.canDeleteWorkspaceChannel(channel) || this.isDeletingChannel(channel.id)) {
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

    this.channelActionTarget.set(null);
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
    const channelId = this.selectedChannelId();
    if (channelId) this.workspaceMemory.remember(channelId, {draft: value});
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
        return file ? normalizeClipboardAttachmentFile(file, index) : null;
      })
      .filter((file): file is File => file !== null);

    this.addPendingFiles(pastedImages);
  }

  removePendingFile(index: number): void {
    this.pendingFiles.update((files) => files.filter((_, currentIndex) => currentIndex !== index));
    this.messageUploadOutcome.set('idle');
  }

  onMessageListScroll(): void {
    clearTimeout(this.positionSaveTimer);
    this.positionSaveTimer = setTimeout(() => this.rememberMessagePosition(), 300);
    const element = this.messageListRef?.nativeElement;
    if (!element) {
      return;
    }

    this.showJumpToLatest.set(element.scrollHeight - element.scrollTop - element.clientHeight > 120);
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
      clientMessageId: '',
    };
    const channelId = activeChannel.id;
    const signature = JSON.stringify([payload.content, payload.replyToMessageId, payload.files.map(file => [file.name, file.size, file.lastModified])]);
    const pending = this.pendingMessageIds.get(channelId);
    payload.clientMessageId = pending?.signature === signature ? pending.id : crypto.randomUUID();
    this.pendingMessageIds.set(channelId, { signature, id: payload.clientMessageId });

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

    this.onMessageDraftChange(nextDraft);
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
    return this.messageReactionOptions.find((option) => option.code === code)?.emoji ?? code;
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
    this.openWorkspaceTarget(connectedVoiceChannel.server_id, connectedVoiceChannel.id);
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
    void this.changeSettingsDevice('input', deviceId);
  }

  refreshVoiceDevices(): void {
    void this.voiceRoom.refreshDevices();
    void navigator.mediaDevices?.enumerateDevices().then(devices => this.callCameraDevices.set(devices.filter(d => d.kind === 'videoinput'))).catch(() => this.callCameraDevices.set([]));
  }

  changeOutputDevice(deviceId: string): void {
    void this.changeSettingsDevice('output', deviceId);
  }

  private async changeSettingsDevice(kind: 'input' | 'output', deviceId: string): Promise<void> {
    if (this.settingsDeviceChanging()) return;
    this.settingsDeviceChanging.set(kind);
    try {
      if (kind === 'input') await this.voiceRoom.updateInputDevice(deviceId || null);
      else await this.voiceRoom.updateOutputDevice(deviceId || null);
    } catch {
      this.voiceRoom.settingsNotice.set('Не удалось переключить устройство. Попробуйте ещё раз.');
    } finally { this.settingsDeviceChanging.set(null); }
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
    if (!this.canManageSelectedVoiceMember() || this.voiceOwnerActionLoading()) return;
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
    if (!this.canManageSelectedVoiceMember() || this.voiceOwnerActionLoading()) return;
    const token = this.session()?.access_token;
    const channelId = this.selectedVoiceMemberChannelId();
    const member = this.selectedMember();
    if (!token || !channelId || !member) {
      return;
    }

    this.voiceOwnerActionLoading.set(true);
    this.managementError.set(null);
    if (!window.confirm(`Отключить ${this.displayNick(member.nick)} от голосового канала?`)) {
      this.voiceOwnerActionLoading.set(false);
      return;
    }
    this.kickVoiceMemberTrigger$.next({ token, channelId, member });
  }

  toggleSelectedVoiceMemberOwnerMute(): void {
    if (this.voiceOwnerActionLoading()) return;
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
    this.platformApi.clear();
    this.selectedPlatformId.set(null);
    this.spaceInvitations.set([]);
    this.inviteManagerSpace.set(null);
    const token = this.session()?.access_token;
    if (token) {
      void fetch(`${API_BASE_URL}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, keepalive: true }).catch(() => undefined);
    }
    this.authenticatedServicesStarted = false;
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
    this.userCards.close();
    this.shopOpen.set(false);
    this.currentUser.set(null);
    this.pinError.set(null);
    this.pinPending.set([]);
    this.workspaceMode.set('chats');
    this.servers.set([]);
    this.conversations.set([]);
    this.conversationDirectory.set([]);
    this.incomingFriendRequests.set([]);
    this.friendNotices.set([]);
    this.memberFriendError.set('');
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
    this.appearanceOpen.set(false);
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
    this.closeGroupMembersPanel();
    this.loadServerWorkspace(token, serverId);
  }

  async selectChannel(channel: WorkspaceChannel, options: { connectVoice?: boolean; preserveMobilePanel?: boolean } = {}): Promise<void> {
    const shouldConnectVoice = options.connectVoice ?? true;
    const selectedChannelChanged = this.selectedChannelId() !== channel.id;
    this.schedulePresenceHeartbeat();
    if (!options.preserveMobilePanel) this.closeMobilePanel();
    this.closeChatFilesModal();
    if (selectedChannelChanged) {
      this.rememberMessagePosition();
      this.resetMessageSearchState();
    }
    this.selectedChannelId.set(channel.id);
    if (selectedChannelChanged) this.rememberChannelVisit(channel.id);
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

  toggleParticipantLocalMute(userId: string): void {
    if (userId !== this.currentUser()?.id) this.voiceRoom.toggleParticipantMuted(userId);
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
    if (!participant.is_self && this.isGroupVoiceParticipantLocallyMuted(participant)) {
      return 'Заглушён для вас';
    }
    if (participant.owner_muted) return 'Микрофон заблокирован владельцем';
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
    if (!token || !this.authenticatedServicesStarted) {
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
        error: (error) => {
          if ((error instanceof HttpErrorResponse && error.status === 401)) {
            this.expireSession(error);
            return;
          }

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
    if (!token || !this.authenticatedServicesStarted) {
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
        error: (error) => {
          if ((error instanceof HttpErrorResponse && error.status === 401)) {
            this.expireSession(error);
            return;
          }

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
    if(event.type==='platform_message_updated'){
      this.messages.update(rows=>rows.map(m=>m.id===event.message.id?event.message:m.reply_to?.id===event.message.id?{...m,reply_to:{...m.reply_to,content:event.message.content}}:m));
      if(this.selectedReplyMessage()?.id===event.message.id)this.selectedReplyMessage.set(null);
      return;
    }
    switch (event.type) {
      case 'ready':
        await this.resyncAfterAppEventsReconnect();
        return;
      case 'pong':
        return;
      case 'resync_required':
        await this.resyncAfterAppEventsReconnect();
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
          await this.platformApi.refresh(token).catch(() => {});
          await this.refreshServersList(token);
          await this.refreshConversationsList(token, event.reason === 'message_created');
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

    this.refreshInventoryProfile();
    await this.walletService.refresh();

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
    this.conversations.update(rows => rows.map(row => ({...row,
      members: row.members.map(member => member.user_id === event.user_id
        ? {...member, is_online: event.is_online} : member)
    })));
    this.conversationDirectory.update(rows => rows.map(row => row.user_id === event.user_id
      ? {...row, is_online: event.is_online} : row));
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
    const conversation = this.conversations().find(item => item.id === event.server_id);
    if (conversation?.push_enabled && this.platformNotificationsEnabled(conversation) && event.message.author.id !== this.currentUser()?.id) {
      void window.kvaDesktop?.notify?.({id: event.message.id, title: conversation.title, body: this.buildConversationListPreview(event.message), target: conversation.id});
    }
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
          this.workspaceState.bumpServerUnreadCount(event.server_id);
          if (mentionsCurrentUser) {
            this.workspaceState.bumpServerMentionUnreadCount(event.server_id);
            void this.refreshAttentionInboxIfOpen();
          }
        } else {
          this.workspaceState.bumpConversationUnreadCount(event.server_id);
          this.workspaceState.setConversationFirstUnreadMessageIdIfMissing(event.server_id, event.message.id);
          if (mentionsCurrentUser) {
            this.workspaceState.bumpConversationMentionUnreadCount(event.server_id);
            this.workspaceState.setConversationFirstMentionUnreadMessageIdIfMissing(event.server_id, event.message.id);
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
          this.workspaceState.bumpChannelUnreadCount(event.message.channel_id);
          this.workspaceState.bumpServerUnreadCount(event.server_id);
          this.workspaceState.setChannelFirstUnreadMessageIdIfMissing(event.message.channel_id, event.message.id);
          if (mentionsCurrentUser) {
            this.workspaceState.bumpChannelMentionUnreadCount(event.message.channel_id);
            this.workspaceState.bumpServerMentionUnreadCount(event.server_id);
            this.workspaceState.setChannelFirstMentionUnreadMessageIdIfMissing(event.message.channel_id, event.message.id);
            void this.refreshAttentionInboxIfOpen();
          }
        } else {
          this.workspaceState.bumpConversationUnreadCount(event.server_id);
          this.workspaceState.setConversationFirstUnreadMessageIdIfMissing(event.server_id, event.message.id);
          if (mentionsCurrentUser) {
            this.workspaceState.bumpConversationMentionUnreadCount(event.server_id);
            this.workspaceState.setConversationFirstMentionUnreadMessageIdIfMissing(event.server_id, event.message.id);
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

    if (!isOwnMessage && isNearBottom && document.visibilityState === 'visible') {
      this.markChannelAsRead(event.message.channel_id, event.message.id);
      return;
    }

    if (!isOwnMessage) {
      if (isWorkspaceServer) {
        this.workspaceState.bumpChannelUnreadCount(event.message.channel_id);
        this.workspaceState.bumpServerUnreadCount(event.server_id);
        this.workspaceState.setChannelFirstUnreadMessageIdIfMissing(event.message.channel_id, event.message.id);
        if (mentionsCurrentUser) {
          this.workspaceState.bumpChannelMentionUnreadCount(event.message.channel_id);
          this.workspaceState.bumpServerMentionUnreadCount(event.server_id);
          this.workspaceState.setChannelFirstMentionUnreadMessageIdIfMissing(event.message.channel_id, event.message.id);
          void this.refreshAttentionInboxIfOpen();
        }
      } else {
        this.workspaceState.bumpConversationUnreadCount(event.server_id);
        this.workspaceState.setConversationFirstUnreadMessageIdIfMissing(event.server_id, event.message.id);
        if (mentionsCurrentUser) {
          this.workspaceState.bumpConversationMentionUnreadCount(event.server_id);
          this.workspaceState.setConversationFirstMentionUnreadMessageIdIfMissing(event.server_id, event.message.id);
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
        this.workspaceState.setChannelUnreadCount(event.channel_id, 0);
        this.workspaceState.setChannelMentionUnreadCount(event.channel_id, 0);
        this.workspaceState.setChannelFirstUnreadMessageId(event.channel_id, null);
        if (channelUnreadCount > 0) {
          this.workspaceState.bumpServerUnreadCount(activeServer.id, -channelUnreadCount);
        }
        if (channelMentionUnreadCount > 0) {
          this.workspaceState.bumpServerMentionUnreadCount(activeServer.id, -channelMentionUnreadCount);
        }
      } else {
        this.workspaceState.setConversationUnreadCountByChannelId(event.channel_id, 0);
        this.workspaceState.setConversationMentionUnreadCountByChannelId(event.channel_id, 0);
        this.workspaceState.setConversationFirstUnreadMessageIdByChannelId(event.channel_id, null);
        this.workspaceState.setConversationFirstMentionUnreadMessageIdByChannelId(event.channel_id, null);
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

    const requestedUrl = this.readWorkspaceUrl();
    if (!this.selectedChannelId() && requestedUrl?.spaceId === this.selectedServerId()
      && !channels.some(channel => channel.id === requestedUrl.channelId)) {
      this.pendingSearchNavigation.set(null);
      this.workspaceError.set('Канал недоступен. Проверьте ссылку или попросите приглашение.');
      return;
    }

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
      ?? channels.find(channel => channel.type === 'text')?.id
      ?? (connectedVoiceChannelId && channels.some((channel) => channel.id === connectedVoiceChannelId)
        ? connectedVoiceChannelId
        : null)
      ?? channels[0]?.id
      ?? null;

    const selectedChannelChanged = nextSelectedChannelId !== this.selectedChannelId();
    this.selectedChannelId.set(nextSelectedChannelId);
    if (selectedChannelChanged && nextSelectedChannelId) this.rememberChannelVisit(nextSelectedChannelId);
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
    this.workspaceState.setServerUnreadCount(activeServer.id, unreadCount);
    this.workspaceState.setServerMentionUnreadCount(activeServer.id, mentionUnreadCount);
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

  private async refreshConversationsList(token: string, notifyDesktop = false): Promise<void> {
    const previousSelectedServerId = this.selectedServerId();

    this.workspaceApi
      .getConversations(token)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (conversations) => {
          if (notifyDesktop) {
            for (const item of conversations) {
              const previous = this.conversations().find(old => old.id === item.id);
              if (item.push_enabled && this.platformNotificationsEnabled(item) && item.unread_count > (previous?.unread_count ?? 0)) {
                void window.kvaDesktop?.notify?.({id: `${item.id}:${item.unread_count}:${Date.now()}`, title: item.title, body: item.subtitle || 'Новое сообщение', target: item.id});
              }
            }
          }
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
    try{
      const notices=await firstValueFrom(this.profileHttp.get<{id:string;user_id:string;nick:string;reason:string}[]>(API_BASE_URL+'/api/friends/notices',{headers:{Authorization:'Bearer '+token}}));
      if(token===this.session()?.access_token)this.friendNotices.set(notices);
    }catch{/* Existing request loading remains available if notices fail. */}
    this.invitesApi.inbox(token).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: rows => {if (this.session()?.access_token === token) this.spaceInvitations.set(rows);},
      error: () => {}
    });
    this.workspaceApi
      .getFriendRequests(token)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (overview) => {
          if(token!==this.session()?.access_token)return;
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
    this.userCards.revision.update(v=>v+1);
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
    this.workspaceMode.set(conversation.platform_id ? 'platforms' : conversation.kind === 'group_chat' ? 'groups' : 'chats');
    if(conversation.platform_id) this.selectedPlatformId.set(conversation.platform_id);

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
    const session = this.sessionStorage.read();
    if (!session) return;
    this.session.set(session);
    this.currentUser.set(session.user);
    this.bootstrapWorkspace(session.access_token, { startAuthenticatedServices: true });
  }

  private handleAuthenticatedSession(session: AuthSessionResponse): void {
    this.session.set(session);
    this.currentUser.set(session.user);
    this.persistSession(session);
    this.startAuthenticatedServices(session.access_token);
    this.schedulePresenceHeartbeat(true);
    this.authLoading.set(false);
    this.authError.set(null);
    this.managementError.set(null);
    this.managementSuccess.set(null);
    this.bootstrapWorkspace(session.access_token);
  }

  private startAuthenticatedServices(token: string): void {
    this.authenticatedServicesStarted = true;
    this.appEvents.start(token);
    this.directCall.start(token);
    void this.initializeBrowserPush(token);
    this.startVoiceJoinInboxPolling();
  }

  private expireSession(error?: unknown): void {
    if (!this.session()) {
      return;
    }

    const message = (error instanceof HttpErrorResponse && error.status === 401)
      ? 'Сессия устарела. Войдите снова.'
      : this.extractErrorMessage(error, 'Сессия устарела. Войдите снова.');
    this.logout();
    this.authError.set(message);
  }

  private isUnauthorizedError(error: unknown): boolean {
    return error instanceof HttpErrorResponse && error.status === 401;
  }

  private bootstrapWorkspace(
    token: string,
    options: { startAuthenticatedServices?: boolean } = {}
  ): void {
    void this.platformApi.refresh(token).catch(() => {});
    this.workspaceLoading.set(true);
    this.workspaceError.set(null);
    this.friendRequestsLoading.set(true);
    this.friendRequestsError.set(null);
    this.mobilePanel.set(this.isCompactVoiceWorkspaceViewport() ? 'servers' : null);
    this.voiceRoom.leave();

    this.workspaceApi
      .getCurrentUser(token)
      .pipe(
        switchMap(me => {
          const code = this.pendingPlatformInvite();
          if (!code) return of(me);
          return this.platformApi.request(token, 'POST', `/join/${code}`).pipe(
            tap(() => {this.pendingPlatformInvite.set(null);window.history.replaceState({}, '', '/');void this.platformApi.refresh(token);this.workspaceMode.set('platforms');}),
            map(() => me),
            catchError(error => {this.workspaceError.set(this.extractErrorMessage(error, 'Приглашение площадки недоступно'));this.pendingPlatformInvite.set(null);return of(me);})
          );
        }),
        switchMap(me => {
          const code = this.pendingInviteCode();
          if (!code) return of(me);
          this.inviteJoining.set(true); this.inviteError.set('');
          return this.invitesApi.join(token, code).pipe(
            tap(target => {
              this.pendingInviteCode.set(null); this.invitePreview.set(null);
              this.selectedServerId.set(null);
              window.history.replaceState({}, '', `/channels/${target.server_id}/${target.channel_id}`);
            }),
            map(() => me),
            catchError(error => {
              if (this.isUnauthorizedError(error)) return throwError(() => error);
              this.inviteError.set(this.extractErrorMessage(error, 'Не удалось вступить. Попробуйте ещё раз.'));
              return of(me);
            }),
            finalize(() => this.inviteJoining.set(false)),
          );
        }),
        switchMap((me) =>
          forkJoin({
            me: of(me),
            servers: this.workspaceApi.getServers(token),
            conversations: this.workspaceApi.getConversations(token)
          })
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: ({ me, servers, conversations }) => {
          this.currentUser.set(me);
          this.workspaceMemory.useUser(me.id);
          if (options.startAuthenticatedServices) {
            this.startAuthenticatedServices(token);
          }
          this.servers.set(this.mergeServersById(servers));
          const mergedConversations = this.mergeConversationsById(conversations);
          this.conversations.set(mergedConversations);
          if (this.pendingInviteCode()) {
            this.workspaceLoading.set(false);
            return;
          }
          this.tryOpenPendingPushConversation(token);
          this.schedulePresenceHeartbeat(true);
          void this.loadConversationDirectory(token);
          void this.refreshFriendRequests(token);

          const directSpaces = mergedConversations.filter((conversation) => conversation.kind === 'direct');
          const groupSpaces = mergedConversations.filter((conversation) => conversation.kind === 'group_chat' && !conversation.platform_id);
          const platformSpaces = this.mapConversationSpaces(mergedConversations.filter(c => !!c.platform_id));

          const requested = this.readWorkspaceUrl();
          if (requested && ![...this.conversationSpaces(), ...this.platformSpaces()].some(s => s.id === requested.spaceId)) {
            this.workspaceLoading.set(false);
            this.workspaceError.set('Канал недоступен. Проверьте ссылку или попросите приглашение.');
            return;
          }

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

          const remembered = this.readWorkspaceUrl() ?? this.workspaceMemory.last();
          if (!this.selectedServerId() && remembered && [...this.conversationSpaces(), ...this.platformSpaces()].some(s => s.id === remembered.spaceId)) {
            this.openWorkspaceTarget(remembered.spaceId, remembered.channelId);
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
          if (!this.isUnauthorizedError(error)) {
            this.workspaceLoading.set(false);
            this.workspaceError.set(this.extractErrorMessage(error, 'Не удалось загрузить чат. Обновите страницу, чтобы повторить.'));
            return;
          }
          this.stopVoicePresencePolling();
          this.stopMessageAutoRefreshPolling();
          this.stopVoiceJoinInboxPolling();
          this.appEvents.stop();
          this.directCall.stop();
          this.authenticatedServicesStarted = false;
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
          const invite = this.pendingInviteCode();
          if (invite) window.history.replaceState({}, '', `/invite/${encodeURIComponent(invite)}`);
        }
      });
  }

  private loadServerWorkspace(token: string, serverId: string): void {
    const platformId = this.conversations().find(c => c.id === serverId)?.platform_id;
    if(platformId) this.selectedPlatformId.set(platformId);
    const requestId = ++this.workspaceLoadId;
    this.rememberMessagePosition();
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
    this.channels.set([]);
    this.platformExpandedVoiceChannelId.set(null);
    this.platformTextChannelsCollapsed.set(this.platformSectionState.get(serverId)?.text ?? false);
    this.platformVoiceChannelsCollapsed.set(this.platformSectionState.get(serverId)?.voice ?? false);
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
          if (requestId !== this.workspaceLoadId || this.selectedServerId() !== serverId || this.session()?.access_token !== token) return;
          this.applyChannelsSnapshot(channels, token, previousSelectedChannelId);
          this.applyMembersSnapshot(members);
          this.applyVoicePresenceSnapshot(voicePresence);
          this.syncMessageAutoRefreshPolling();
          this.workspaceLoading.set(false);
        },
        error: (error) => {
          if (requestId !== this.workspaceLoadId || this.selectedServerId() !== serverId || this.session()?.access_token !== token) return;
          if ((error instanceof HttpErrorResponse && error.status === 401)) {
            this.expireSession(error);
            return;
          }

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
    return typeof window !== 'undefined' && window.matchMedia('(max-width: 980px)').matches;
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

    const saved = this.workspaceMemory.channel(channel.id);
    if (saved.anchor) return {focusMessageId: saved.anchor, focusKind: 'restore'};

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
    options: { focusMessageId?: string | null; limit?: number; focusKind?: MessageFocusKind; preserve?:boolean } = {},
  ): void {
    const requestId = ++this.messageLoadId;
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
      if(!options.preserve){this.messages.set([]);this.clearAttachmentPreviews();}
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
          if (requestId !== this.messageLoadId || this.selectedChannelId() !== channelId || this.session()?.access_token !== token) {
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
              if (options.focusKind === 'restore') {
                requestAnimationFrame(() => {
                  if (requestId !== this.messageLoadId || this.selectedChannelId() !== channelId || this.session()?.access_token !== token) return;
                  const list = this.messageListRef?.nativeElement;
                  const row = list?.querySelector<HTMLElement>(`[data-message-id="${focusMessageId}"]`);
                  if (list && row) list.scrollTop += row.getBoundingClientRect().top - list.getBoundingClientRect().top - (this.workspaceMemory.channel(channelId).offset ?? 0);
                });
              } else this.scrollMessageIntoView(focusMessageId);
            } else {
              this.scrollMessagesToBottom();
            }
            const latestMessage = page.items.length ? page.items[page.items.length - 1] : null;
            if (!focusMessageId && document.visibilityState === 'visible') {
              this.markChannelAsRead(channelId, latestMessage?.id ?? null);
            }
          }
        },
        error: (error) => {
          if (requestId !== this.messageLoadId || this.selectedChannelId() !== channelId || this.session()?.access_token !== token) return;
          if (options.focusKind === 'restore' && error instanceof HttpErrorResponse && error.status === 404) {
            this.workspaceMemory.remember(channelId, {anchor: undefined});
            this.loadMessagesForChannel(token, channelId);
            return;
          }
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

    if (this.attachmentAvailabilityLabel(attachment.id)) {
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

  private async refreshCurrentChannelMessages(): Promise<void> {
    const token = this.session()?.access_token;
    const channel = this.activeMessagingChannel();
    if (!token || !channel || this.workspaceLoading() || this.messagesLoading() || this.messagesLoadingMore() || this.messageRefreshInFlight) {
      return;
    }
    const channelId = channel.id;
    const list = this.messageListRef?.nativeElement;
    const nearBottom = !!list && list.scrollHeight - list.scrollTop - list.clientHeight <= 80;
    this.messageRefreshInFlight = true;
    try {
      const synchronized = await synchronizeMessages(this.messages(), (from, after) => firstValueFrom(
        this.workspaceApi.getMessages(token, channelId, 100, null, from, after).pipe(takeUntilDestroyed(this.destroyRef))
      ), () => this.selectedChannelId() === channelId && this.session()?.access_token === token);
      if (this.selectedChannelId() !== channelId || this.session()?.access_token !== token) { return; }
      this.messages.set(this.mergeMessagesChronologically([...this.messages(), ...synchronized]));
      this.preloadInlineImagePreviews(synchronized);
      if (nearBottom && document.visibilityState === 'visible') {
        this.scrollMessagesToBottom();
        const latest = this.messages().at(-1);
        this.markChannelAsRead(channelId, latest?.id ?? null);
      }
    } catch (error) {
      if ((error instanceof HttpErrorResponse && error.status === 401)) { this.logout(); }
    } finally {
      this.messageRefreshInFlight = false;
    }
  }

  private resetTextChannelState(): void {
    clearTimeout(this.positionSaveTimer);
    this.messageActionsTarget.set(null);
    this.messageActionsFocus = null;
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

      const maxHeight = typeof window !== 'undefined' && window.innerWidth <= 640 ? 120 : 144;
      textarea.style.height = '0px';

      const nextHeight = Math.min(Math.max(textarea.scrollHeight, 38), maxHeight);
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
      this.showJumpToLatest.set(false);
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
    if (!token || !channelId || !lastMessageId || document.visibilityState !== 'visible') {
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
      this.workspaceState.setChannelUnreadCount(channelId, 0);
      this.workspaceState.setChannelMentionUnreadCount(channelId, 0);
      this.workspaceState.setChannelFirstUnreadMessageId(channelId, null);
      this.workspaceState.setChannelFirstMentionUnreadMessageId(channelId, null);
      if (channelUnreadCount > 0) {
        this.workspaceState.bumpServerUnreadCount(activeServer.id, -channelUnreadCount);
      }
      if (channelMentionUnreadCount > 0) {
        this.workspaceState.bumpServerMentionUnreadCount(activeServer.id, -channelMentionUnreadCount);
      }
    } else {
      this.workspaceState.setConversationUnreadCountByChannelId(channelId, 0);
      this.workspaceState.setConversationMentionUnreadCountByChannelId(channelId, 0);
      this.workspaceState.setConversationFirstUnreadMessageIdByChannelId(channelId, null);
      this.workspaceState.setConversationFirstMentionUnreadMessageIdByChannelId(channelId, null);
    }
    this.markChannelReadTrigger$.next({ token, channelId, lastMessageId });
  }

  private buildUserAvatarUrl(userId: string | null, avatarUpdatedAt: string | null): string | null {
    if (!userId) {
      return null;
    }

    return `${API_BASE_URL}/api/users/${encodeURIComponent(userId)}/avatar?v=${encodeURIComponent(avatarUpdatedAt ?? 'default')}&motion=${!window.matchMedia('(prefers-reduced-motion: reduce)').matches}`;
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
    this.profileInventoryAvatar.set(null);
    this.profileAvatarPreset.set(null);
    this.profileAvatarFile.set(null);
    this.profileAvatarPreviewUrl.set(null);
    this.revokeProfileAvatarPreviewObjectUrl();
  }

  private setProfileAvatarPreview(file: File): void {
    this.revokeProfileAvatarPreviewObjectUrl();
    this.profileAvatarPreviewObjectUrl = URL.createObjectURL(file);
    this.profileAvatarPreviewUrl.set(this.profileAvatarPreviewObjectUrl);
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

  private persistSession(session: AuthSessionResponse): void {
    this.sessionStorage.write(session);
  }

  private clearStoredSession(): void {
    this.sessionStorage.clear();
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

      return fallback;
    }

    if (error instanceof Error && error.message.trim()) {
      return error.message;
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
    const content=message.content??'', mentions=message.mentioned_user_ids.join(','), context=this.mentionContext();
    const cached=this.segmentCache.get(message);
    if(cached&&cached.content===content&&cached.mentions===mentions&&cached.context===context)return cached.value;
    const value=this.buildMessageContentSegments(message);
    this.segmentCache.set(message,{content,mentions,context,value});return value;
  }

  private buildMessageContentSegments(message: WorkspaceMessage): MessageContentSegment[] {
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
    const query=this.messageSearchQuery();
    return this.highlightCache.get(JSON.stringify([query,text]),()=>this.buildTextHighlightChunks(text,query));
  }

  messageSearchPreviewChunks(result: WorkspaceMessageSearchResult): TextHighlightChunk[] {
    return this.messageTextHighlightChunks(this.messageSearchPreviewText(result));
  }

  messageSearchPreviewText(result: WorkspaceMessageSearchResult): string {
    return this.previewCache.get(JSON.stringify([result.content,this.messageSearchQuery()]),()=>this.buildMessageSearchPreviewText(result));
  }
  private buildMessageSearchPreviewText(result: WorkspaceMessageSearchResult): string {
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
    return this.openedMessageFocusKind() !== 'restore' && this.openedUnreadAnchorMessageId() === message.id;
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
        this.workspaceState.setConversationPushEnabled(conversation.id, true);
        this.setPushFeedback({
          tone: result.warning ? 'warning' : 'success',
          message: result.warning ?? 'Push-уведомления включены для этого чата'
        });
      } else {
        await this.browserPush.disableConversationPush(token, conversation.id);
        this.workspaceState.setConversationPushEnabled(conversation.id, false);
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
