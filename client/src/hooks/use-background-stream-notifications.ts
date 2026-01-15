/**
 * Background Stream Notifications Hook
 * 
 * Observa cuando un streaming completa en un chat que no es el activo
 * y dispara una notificación visual y sonora.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useConversationStreamRouter, StreamRun, StreamStatus } from '@/stores/conversationStreamRouter';
import { useToast } from '@/hooks/use-toast';

const NOTIFICATION_SOUND_URL = 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdGJ/mpqZkYKIl5SPl5ebmpiOcWl/j5OSkXxoYnOFk5WWjnxoXWx/k5iYk4Z0ZWZ2ipWXlI1/cWRpdouUl5SPhHFkZnKGkpWVkoN0ZGd0h5KVlZOEcWNndYmSlZWTg3FjZ3eKkpWVk4RxY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNld4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZ3eKkpWVk4RyY2d3ipKVlZOEcmNnd4qSlZWThHJjZw==';

let audioContext: AudioContext | null = null;
let notificationBuffer: AudioBuffer | null = null;

async function initAudio() {
  if (audioContext) return;
  
  try {
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    const response = await fetch(NOTIFICATION_SOUND_URL);
    const arrayBuffer = await response.arrayBuffer();
    notificationBuffer = await audioContext.decodeAudioData(arrayBuffer);
  } catch (error) {
    console.warn('[BackgroundNotification] Failed to init audio:', error);
  }
}

function playNotificationSound() {
  if (!audioContext || !notificationBuffer) {
    const audio = new Audio(NOTIFICATION_SOUND_URL);
    audio.volume = 0.5;
    audio.play().catch(() => {});
    return;
  }
  
  try {
    const source = audioContext.createBufferSource();
    source.buffer = notificationBuffer;
    
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 0.5;
    
    source.connect(gainNode);
    gainNode.connect(audioContext.destination);
    source.start();
  } catch (error) {
    console.warn('[BackgroundNotification] Failed to play sound:', error);
  }
}

interface Chat {
  id: string;
  title?: string;
}

export function useBackgroundStreamNotifications(
  chats: Chat[],
  activeChatId: string | null
) {
  const { toast } = useToast();
  const previousRunsRef = useRef<Map<string, StreamStatus>>(new Map());
  const hasInitAudio = useRef(false);
  
  const runs = useConversationStreamRouter(state => state.runs);
  
  useEffect(() => {
    if (!hasInitAudio.current) {
      initAudio();
      hasInitAudio.current = true;
    }
  }, []);
  
  useEffect(() => {
    runs.forEach((run, key) => {
      const previousStatus = previousRunsRef.current.get(key);
      
      if (
        run.status === 'completed' &&
        previousStatus !== 'completed' &&
        run.conversationId !== activeChatId
      ) {
        const chat = chats.find(c => c.id === run.conversationId);
        const chatTitle = chat?.title || 'Chat';
        
        playNotificationSound();
        
        toast({
          title: "Respuesta completada",
          description: `La respuesta en "${chatTitle.slice(0, 30)}${chatTitle.length > 30 ? '...' : ''}" está lista`,
          duration: 5000,
        });
        
        console.log('[BackgroundNotification] Stream completed in background chat:', run.conversationId);
      }
      
      if (
        run.status === 'failed' &&
        previousStatus !== 'failed' &&
        run.conversationId !== activeChatId
      ) {
        const chat = chats.find(c => c.id === run.conversationId);
        const chatTitle = chat?.title || 'Chat';
        
        toast({
          title: "Error en respuesta",
          description: `Hubo un error en "${chatTitle.slice(0, 30)}${chatTitle.length > 30 ? '...' : ''}"`,
          variant: "destructive",
          duration: 5000,
        });
      }
      
      previousRunsRef.current.set(key, run.status);
    });
  }, [runs, activeChatId, chats, toast]);
}
