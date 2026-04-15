import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ChevronLeft, FileAudio } from "lucide-react";
import { AudioTranscriber } from "@/components/chat/AudioTranscriber";

export default function AudioTranscriberPage() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/")} className="text-zinc-400 hover:text-white">
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <div className="flex items-center gap-2">
          <FileAudio className="w-5 h-5 text-violet-400" />
          <h1 className="text-lg font-semibold">Transcriptor de Audio</h1>
        </div>
      </header>

      <div className="flex-1 max-w-2xl mx-auto w-full px-6 py-8">
        <AudioTranscriber
          onSendToChat={(text) => {
            // Navigate to chat with the transcribed text
            setLocation(`/chat?prefill=${encodeURIComponent(text)}`);
          }}
        />
      </div>
    </div>
  );
}
