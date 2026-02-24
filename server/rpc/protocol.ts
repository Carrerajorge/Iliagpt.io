import { randomUUID } from 'crypto';

export interface RPCMessage {
    id: string;
    type: 'request' | 'response' | 'event' | 'stream' | 'error';
    method: string;
    channel?: 'control' | 'vision' | 'telemetry'; // T01-005 multiplexing
    params?: any;
    result?: any;
    error?: { code: number; message: string };
    timestamp: number;
    signature?: string;
}

export function serialize(msg: RPCMessage): string {
    return JSON.stringify(msg);
}

export function deserialize(data: string | Buffer): RPCMessage {
    return JSON.parse(data.toString());
}
