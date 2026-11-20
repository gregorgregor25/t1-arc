import type Ionicons from '@expo/vector-icons/Ionicons';

/**
 * The single Tarv1s header menu. It holds what used to be separate header
 * buttons and inline links, so nothing was removed: conversation history,
 * new conversation, notebook, export, report a response, and the two
 * settings that now live in Settings.
 */
export type TarvisHeaderMenuItemId =
  | 'history'
  | 'new-conversation'
  | 'notebook'
  | 'export'
  | 'report'
  | 'weekly-reviews'
  | 'settings';

export interface TarvisHeaderMenuItem {
  id: TarvisHeaderMenuItemId;
  label: string;
  detail: string;
  icon: keyof typeof Ionicons.glyphMap;
  disabled: boolean;
}

export interface TarvisHeaderMenuState {
  /** The conversation list is already open. */
  historyVisible: boolean;
  /** A conversation is on screen (not the Ask home). */
  conversationVisible: boolean;
  /** Answers in the conversation on screen. */
  exchangeCount: number;
  /** The notebook belongs to a known person and data mode. */
  notebookAvailable: boolean;
  /** An answer is being prepared. */
  working: boolean;
}

export function tarvisHeaderMenuItems(state: TarvisHeaderMenuState): TarvisHeaderMenuItem[] {
  const hasConversation = state.conversationVisible && state.exchangeCount > 0;
  const items: TarvisHeaderMenuItem[] = [];
  if (!state.historyVisible) {
    items.push({
      id: 'history',
      label: 'Conversation history',
      detail: 'Every conversation saved on this phone',
      icon: 'albums-outline',
      disabled: false,
    });
  }
  if (hasConversation) {
    items.push({
      id: 'new-conversation',
      label: 'New conversation',
      detail: 'Start again; this one stays in history',
      icon: 'create-outline',
      disabled: state.working,
    });
  }
  if (state.notebookAvailable) {
    items.push({
      id: 'notebook',
      label: 'My notebook',
      detail: 'Saved answers and appointment notes',
      icon: 'bookmark-outline',
      disabled: false,
    });
  }
  if (hasConversation) {
    items.push(
      {
        id: 'export',
        label: 'Export conversation',
        detail: 'Share this conversation as text',
        icon: 'share-outline',
        disabled: false,
      },
      {
        id: 'report',
        label: 'Report a response',
        detail: 'Tell us about the latest answer',
        icon: 'flag-outline',
        disabled: state.working,
      },
    );
  }
  items.push(
    {
      id: 'weekly-reviews',
      label: 'Weekly review reminder',
      detail: 'In Settings, Notifications and reminders',
      icon: 'calendar-outline',
      disabled: false,
    },
    {
      id: 'settings',
      label: 'Tarv1s settings',
      detail: 'Connection and privacy, in Settings',
      icon: 'settings-outline',
      disabled: false,
    },
  );
  return items;
}
