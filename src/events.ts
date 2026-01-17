/**
 * Einheitliches internes Event-Modell für Shield
 * Alle Telegram-Updates werden auf dieses Modell gemappt
 */

// Strikte Event-Typen als Enum (keine Fantasie-Strings)
export enum ShieldEventType {
  JOIN = 'JOIN',
  LEAVE = 'LEAVE',
  MESSAGE = 'MESSAGE',
}

export enum ShieldEventSource {
  CHAT_MEMBER = 'chat_member',
  NEW_CHAT_MEMBERS = 'new_chat_members',
  LEFT_CHAT_MEMBER = 'left_chat_member',
  MESSAGE = 'message',
}

export interface ShieldEvent {
  type: ShieldEventType;
  userId: number;
  chatId: string;
  source: ShieldEventSource;
  timestamp: number;
  isBot: boolean;
  isAdmin: boolean;
  isTeamMember: boolean;
  userInfo?: {
    username?: string;
    firstName?: string;
    lastName?: string;
  };
}

/**
 * Erstellt einen Join-Event aus Telegram-Update
 */
export function createJoinEvent(
  userId: number,
  chatId: string,
  source: ShieldEventSource,
  userInfo: { username?: string; firstName?: string; lastName?: string; isBot?: boolean },
  isAdmin: boolean,
  isTeamMember: boolean
): ShieldEvent {
  return {
    type: ShieldEventType.JOIN,
    userId,
    chatId,
    source,
    timestamp: Date.now(),
    isBot: userInfo.isBot || false,
    isAdmin,
    isTeamMember,
    userInfo: {
      username: userInfo.username,
      firstName: userInfo.firstName,
      lastName: userInfo.lastName,
    },
  };
}

/**
 * Loggt ein ShieldEvent (einfache Konsolen-Ausgabe)
 */
export function logEvent(event: ShieldEvent, isManaged: boolean, reason?: string): void {
  const reasonStr = reason ? ` reason=${reason}` : '';
  console.log(
    `[${event.type}] user=${event.userId} chat=${event.chatId} source=${event.source} managed=${isManaged}${reasonStr}`
  );
}
