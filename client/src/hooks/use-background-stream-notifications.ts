/**
 * Background Stream Notifications Hook
 * 
 * Observa cuando un streaming completa en un chat que no es el activo
 * y dispara una notificación visual y sonora.
 */

import { useEffect, useRef } from 'react';
import { useConversationStreamRouter, StreamStatus } from '@/stores/conversationStreamRouter';
import { useToast } from '@/hooks/use-toast';

let audioContext: AudioContext | null = null;
let audioInitialized = false;
let pendingSoundCount = 0;

function initAudioOnInteraction() {
  if (audioInitialized) return;
  
  const initAudio = () => {
    if (audioContext) return;
    try {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioInitialized = true;
      console.log('[BackgroundNotification] Audio context initialized');
      
      if (pendingSoundCount > 0) {
        console.log(`[BackgroundNotification] Playing ${pendingSoundCount} pending notification sounds`);
        for (let i = 0; i < pendingSoundCount; i++) {
          setTimeout(() => playNotificationSoundInternal(), i * 250);
        }
        pendingSoundCount = 0;
      }
    } catch (error) {
      console.warn('[BackgroundNotification] Failed to init audio:', error);
    }
  };
  
  const events = ['click', 'touchstart', 'keydown'];
  const handler = () => {
    initAudio();
    events.forEach(e => document.removeEventListener(e, handler));
  };
  
  events.forEach(e => document.addEventListener(e, handler, { once: true, passive: true }));
}

function playNotificationSoundInternal() {
  if (!audioContext) return;
  
  if (audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }
  
  try {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(400, audioContext.currentTime + 0.15);
    
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.2);
    
    console.log('[BackgroundNotification] Played notification sound');
  } catch (error) {
    console.warn('[BackgroundNotification] Failed to play sound:', error);
  }
}

function playNotificationSound() {
  if (!audioContext || !audioInitialized) {
    pendingSoundCount++;
    console.log('[BackgroundNotification] Audio not ready, queued sound (pending:', pendingSoundCount, ')');
    return;
  }
  
  playNotificationSoundInternal();
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
  
  const runs = useConversationStreamRouter(state => state.runs);
  
  useEffect(() => {
    initAudioOnInteraction();
  }, []);
  
  useEffect(() => {
    const currentKeys = new Set<string>();
    
    runs.forEach((run, key) => {
      currentKeys.add(key);
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
    
    previousRunsRef.current.forEach((_, key) => {
      if (!currentKeys.has(key)) {
        previousRunsRef.current.delete(key);
      }
    });
  }, [runs, activeChatId, chats, toast]);
}
