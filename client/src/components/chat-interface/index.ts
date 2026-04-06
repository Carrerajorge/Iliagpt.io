/**
 * Chat Interface Module - Index
 * Re-exports all components and hooks
 */

// Types
export * from './types';

// Hooks
export { useChatState } from './useChatState';

// Components
export { StreamingIndicator } from './StreamingIndicator';
export { ChatHeader } from './ChatHeader';
export { AvatarWithFallback } from './AvatarWithFallback';
export { BotIcon } from './BotIcon';
export {
  ChatModals,
  ImageLightbox,
  FileAttachmentPreviewModal,
  UploadedImagePreviewModal,
  ScreenReaderAnnouncer,
  type ChatModalsProps
} from './ChatModals';

// Utilities
export * from './utils';
export * from './uncertaintyDetector';
