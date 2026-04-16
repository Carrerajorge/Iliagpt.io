type EventCallback = (data: any) => void;

interface BroadcastMessage {
  type: string;
  senderId: string;
  payload: any;
}

export class TabCoordinator {
  private channel: BroadcastChannel;
  private tabId: string;
  private _isLeader: boolean = false;
  private leaderId: string = '';
  private listeners: Map<string, EventCallback[]> = new Map();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private lastHeartbeats: Map<string, number> = new Map();

  constructor(channelName = 'excel-processing-channel') {
    this.channel = new BroadcastChannel(channelName);
    this.tabId = this._generateTabId();

    this._setupListeners();
    this._startHeartbeat();
    this._electLeader();
  }

  get isLeader(): boolean {
    return this._isLeader;
  }

  private _generateTabId(): string {
    return `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private _setupListeners(): void {
    this.channel.onmessage = (event: MessageEvent<BroadcastMessage>) => {
      const { type, senderId, payload } = event.data;

      if (senderId === this.tabId) return;

      switch (type) {
        case 'HEARTBEAT':
          this.lastHeartbeats.set(senderId, Date.now());
          break;
        case 'LEADER_ELECTION':
          this._handleLeaderElection(senderId, payload);
          break;
        case 'TASK_CLAIMED':
          this._emit('taskClaimed', payload);
          break;
        case 'TASK_COMPLETED':
          this._emit('taskCompleted', payload);
          break;
        case 'STATE_SYNC':
          this._emit('stateSync', payload);
          break;
      }

      this._emit('message', { type, senderId, payload });
    };
  }

  private _startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this._broadcast('HEARTBEAT', { timestamp: Date.now() });
      this._cleanupDeadTabs();
    }, 2000);
  }

  private _cleanupDeadTabs(): void {
    const now = Date.now();
    const timeout = 5000;

    Array.from(this.lastHeartbeats.entries()).forEach(([tabId, lastSeen]) => {
      if (now - lastSeen > timeout) {
        this.lastHeartbeats.delete(tabId);
        
        if (tabId === this.leaderId) {
          this._electLeader();
        }
      }
    });
  }

  private _electLeader(): void {
    const allTabs = [this.tabId, ...Array.from(this.lastHeartbeats.keys())].sort();
    const newLeader = allTabs[0];
    
    const wasLeader = this._isLeader;
    this._isLeader = newLeader === this.tabId;
    this.leaderId = newLeader;

    if (this._isLeader && !wasLeader) {
      console.log('👑 Esta pestaña es ahora el líder');
      this._emit('becameLeader', undefined);
    } else if (!this._isLeader && wasLeader) {
      console.log('👤 Esta pestaña ya no es el líder');
      this._emit('lostLeadership', undefined);
    }

    this._broadcast('LEADER_ELECTION', { leaderId: this.leaderId });
  }

  private _handleLeaderElection(_senderId: string, payload: { leaderId: string }): void {
    if (payload.leaderId) {
      this.leaderId = payload.leaderId;
      this._isLeader = this.leaderId === this.tabId;
    }
  }

  private _broadcast(type: string, payload: any): void {
    this.channel.postMessage({
      type,
      senderId: this.tabId,
      payload
    });
  }

  private _emit(event: string, data: any): void {
    const listeners = this.listeners.get(event) || [];
    listeners.forEach(callback => callback(data));
  }

  on(event: string, callback: EventCallback): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  off(event: string, callback: EventCallback): void {
    const listeners = this.listeners.get(event) || [];
    const index = listeners.indexOf(callback);
    if (index > -1) {
      listeners.splice(index, 1);
    }
  }

  broadcast(type: string, payload: any): void {
    this._broadcast(type, payload);
  }

  claimTask(taskId: number): void {
    this._broadcast('TASK_CLAIMED', { taskId, claimedBy: this.tabId });
  }

  reportCompletion(taskId: number, result: any): void {
    this._broadcast('TASK_COMPLETED', { taskId, result, completedBy: this.tabId });
  }

  syncState(state: any): void {
    this._broadcast('STATE_SYNC', state);
  }

  getActiveTabs(): string[] {
    return [this.tabId, ...Array.from(this.lastHeartbeats.keys())];
  }

  destroy(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    this.channel.close();
  }
}
