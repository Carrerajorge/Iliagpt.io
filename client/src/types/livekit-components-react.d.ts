declare module "@livekit/components-react" {
  import type { ComponentType, ReactNode } from "react";

  export const LiveKitRoom: ComponentType<{
    video?: boolean;
    audio?: boolean;
    token?: string;
    serverUrl?: string;
    onDisconnected?: () => void;
    className?: string;
    children?: ReactNode;
  }>;

  export const VideoConference: ComponentType<Record<string, never>>;
  export const RoomAudioRenderer: ComponentType<Record<string, never>>;
}

declare module "@livekit/components-styles" {}
