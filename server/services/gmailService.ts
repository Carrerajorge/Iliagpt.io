// Gmail Service - Custom OAuth Integration
// Uses custom OAuth tokens from database for user-specific Gmail access

import { google, gmail_v1 } from 'googleapis';
import { storage } from '../storage';
import type { GmailOAuthToken } from '@shared/schema';
import { recordConnectorUsage } from '../lib/connectorMetrics';
import { sanitizePlainText } from '../lib/textSanitizers';

let connectionSettings: any;

/**
 * @deprecated Use getGmailClientForUser instead for user-specific connections
 */
async function getAccessToken(): Promise<string> {
  if (connectionSettings && connectionSettings.settings?.expires_at && 
      new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  const response = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=google-mail',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  );

  const data = await response.json();
  connectionSettings = data.items?.[0];

  const accessToken = connectionSettings?.settings?.access_token || 
                      connectionSettings?.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('Gmail not connected');
  }
  return accessToken;
}

/**
 * @deprecated Use getGmailClientForUser instead for user-specific connections
 */
async function getGmailClient(): Promise<gmail_v1.Gmail> {
  const accessToken = await getAccessToken();

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({
    access_token: accessToken
  });

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

async function getGmailClientForUser(userId: string): Promise<gmail_v1.Gmail> {
  const token = await storage.getGmailOAuthToken(userId);
  
  if (!token) {
    throw new Error('Gmail not connected for this user');
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  const isExpired = new Date(token.expiresAt).getTime() <= Date.now();
  
  if (isExpired && token.refreshToken) {
    oauth2Client.setCredentials({
      refresh_token: token.refreshToken
    });

    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      
      await storage.updateGmailOAuthToken(userId, {
        accessToken: credentials.access_token!,
        expiresAt: new Date(credentials.expiry_date!)
      });

      oauth2Client.setCredentials(credentials);
    } catch (error: any) {
      const errorMsg = error?.message || String(error);
      const isInvalidClient = errorMsg.includes('invalid_client');
      const isInvalidGrant = errorMsg.includes('invalid_grant');
      
      if (isInvalidClient) {
        console.warn('[Gmail OAuth] Client credentials invalid - check GOOGLE_CLIENT_ID/SECRET configuration');
      } else if (isInvalidGrant) {
        console.warn('[Gmail OAuth] Refresh token revoked or expired for user:', userId);
        await storage.deleteGmailOAuthToken(userId);
      } else {
        console.warn('[Gmail OAuth] Token refresh failed:', errorMsg.substring(0, 100));
      }
      
      throw new Error('Gmail connection expired. Please reconnect your Gmail account.');
    }
  } else {
    oauth2Client.setCredentials({
      access_token: token.accessToken,
      refresh_token: token.refreshToken
    });
  }

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

export interface GmailConnectionStatus {
  connected: boolean;
  email?: string;
  displayName?: string;
}

export interface SourceMetadata {
  provider: 'gmail';
  accountId?: string;
  accountEmail?: string;
  mailbox: string;
  messageId: string;
  threadId: string;
  labels: string[];
  permalink: string;
}

export interface EmailSummary {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  fromEmail: string;
  to: string;
  date: string;
  snippet: string;
  labels: string[];
  isUnread: boolean;
  source: SourceMetadata;
}

export interface EmailThread {
  id: string;
  subject: string;
  messages: EmailMessage[];
  labels: string[];
}

export interface EmailMessage {
  id: string;
  from: string;
  fromEmail: string;
  to: string;
  date: string;
  subject: string;
  body: string;
  bodyHtml?: string;
  snippet: string;
  source: SourceMetadata;
}

/**
 * @deprecated Use checkGmailConnectionForUser instead
 */
export async function checkGmailConnection(): Promise<GmailConnectionStatus> {
  try {
    const gmail = await getGmailClient();
    const labels = await gmail.users.labels.list({ userId: 'me' });
    
    if (labels.data.labels && labels.data.labels.length > 0) {
      return {
        connected: true
      };
    }
    return { connected: false };
  } catch (error: any) {
    console.log("[Gmail] Connection check failed:", error.message);
    return { connected: false };
  }
}

export async function checkGmailConnectionForUser(userId: string): Promise<GmailConnectionStatus> {
  try {
    const token = await storage.getGmailOAuthToken(userId);
    
    if (!token) {
      return { connected: false };
    }

    const gmail = await getGmailClientForUser(userId);
    const labels = await gmail.users.labels.list({ userId: 'me' });
    
    if (labels.data.labels && labels.data.labels.length > 0) {
      return {
        connected: true,
        email: token.accountEmail
      };
    }
    return { connected: false };
  } catch (error: any) {
    console.log("[Gmail] Connection check failed for user:", error.message);
    return { connected: false };
  }
}

function parseEmailAddress(header: string): { name: string; email: string } {
  const match = header.match(/^(?:"?([^"]*)"?\s)?<?([^>]+@[^>]+)>?$/);
  if (match) {
    return { name: match[1] || match[2], email: match[2] };
  }
  return { name: header, email: header };
}

function getHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  return headers?.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
}

function decodeBase64(data: string): string {
  try {
    return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): { text: string; html: string } {
  if (!payload) return { text: '', html: '' };

  let text = '';
  let html = '';

  if (payload.body?.data) {
    const decoded = decodeBase64(payload.body.data);
    if (payload.mimeType === 'text/plain') {
      text = decoded;
    } else if (payload.mimeType === 'text/html') {
      html = decoded;
    }
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      const extracted = extractBody(part);
      if (extracted.text) text = extracted.text;
      if (extracted.html) html = extracted.html;
    }
  }

  return { text, html };
}

export interface SearchEmailsResult {
  emails: EmailSummary[];
  nextPageToken?: string;
}

async function searchEmailsInternal(
  gmail: gmail_v1.Gmail,
  query: string = '',
  maxResults: number = 20,
  labelIds?: string[],
  pageToken?: string
): Promise<SearchEmailsResult> {
  const startTime = Date.now();
  const listParams: gmail_v1.Params$Resource$Users$Messages$List = {
    userId: 'me',
    maxResults,
    q: query || undefined,
    labelIds: labelIds,
    pageToken: pageToken || undefined
  };

  let response;
  try {
    response = await gmail.users.messages.list(listParams);
    recordConnectorUsage("gmail", Date.now() - startTime, true);
  } catch (error) {
    recordConnectorUsage("gmail", Date.now() - startTime, false);
    throw error;
  }
  const messages = response.data.messages || [];
  const nextPageToken = response.data.nextPageToken || undefined;

  const emailSummaries: EmailSummary[] = [];

  for (const msg of messages.slice(0, maxResults)) {
    try {
      const fullMsg = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id!,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Subject', 'Date']
      });

      const headers = fullMsg.data.payload?.headers;
      const fromHeader = getHeader(headers, 'From');
      const fromParsed = parseEmailAddress(fromHeader);
      const labels = fullMsg.data.labelIds || [];

      const messageId = msg.id!;
      const threadId = msg.threadId || msg.id!;
      
      emailSummaries.push({
        id: messageId,
        threadId,
        subject: getHeader(headers, 'Subject') || '(Sin asunto)',
        from: fromParsed.name,
        fromEmail: fromParsed.email,
        to: getHeader(headers, 'To'),
        date: getHeader(headers, 'Date'),
        snippet: fullMsg.data.snippet || '',
        labels,
        isUnread: labels.includes('UNREAD'),
        source: {
          provider: 'gmail',
          mailbox: 'INBOX',
          messageId,
          threadId,
          labels,
          permalink: `https://mail.google.com/mail/u/0/#all/${messageId}`
        }
      });
    } catch (error) {
      console.error(`[Gmail] Error fetching message ${msg.id}:`, error);
    }
  }

  return { emails: emailSummaries, nextPageToken };
}

/**
 * @deprecated Use searchEmailsForUser instead
 */
export async function searchEmails(
  query: string = '',
  maxResults: number = 20,
  labelIds?: string[],
  pageToken?: string
): Promise<SearchEmailsResult> {
  const gmail = await getGmailClient();
  return searchEmailsInternal(gmail, query, maxResults, labelIds, pageToken);
}

export async function searchEmailsForUser(
  userId: string,
  query: string = '',
  maxResults: number = 20,
  labelIds?: string[],
  pageToken?: string
): Promise<SearchEmailsResult> {
  const gmail = await getGmailClientForUser(userId);
  return searchEmailsInternal(gmail, query, maxResults, labelIds, pageToken);
}

async function getEmailThreadInternal(gmail: gmail_v1.Gmail, threadId: string): Promise<EmailThread | null> {
  const startTime = Date.now();
  try {
    const thread = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'full'
    });
    recordConnectorUsage("gmail", Date.now() - startTime, true);

    const messages: EmailMessage[] = [];
    let threadSubject = '';
    const threadLabels = new Set<string>();

    for (const msg of thread.data.messages || []) {
      const headers = msg.payload?.headers;
      const fromHeader = getHeader(headers, 'From');
      const fromParsed = parseEmailAddress(fromHeader);
      const subject = getHeader(headers, 'Subject');
      
      if (!threadSubject) threadSubject = subject;
      
      (msg.labelIds || []).forEach(l => threadLabels.add(l));
      
      const body = extractBody(msg.payload);

      const messageId = msg.id!;
      const msgLabels = msg.labelIds || [];
      
      messages.push({
        id: messageId,
        from: fromParsed.name,
        fromEmail: fromParsed.email,
        to: getHeader(headers, 'To'),
        date: getHeader(headers, 'Date'),
        subject,
        body: body.text || sanitizePlainText(body.html, { maxLen: 20000, collapseWs: true }),
        bodyHtml: body.html || undefined,
        snippet: msg.snippet || '',
        source: {
          provider: 'gmail',
          mailbox: 'INBOX',
          messageId,
          threadId,
          labels: msgLabels,
          permalink: `https://mail.google.com/mail/u/0/#all/${messageId}`
        }
      });
    }

    return {
      id: threadId,
      subject: threadSubject || '(Sin asunto)',
      messages,
      labels: Array.from(threadLabels)
    };
  } catch (error: any) {
    recordConnectorUsage("gmail", Date.now() - startTime, false);
    console.error(`[Gmail] Error fetching thread ${threadId}:`, error);
    return null;
  }
}

/**
 * @deprecated Use getEmailThreadForUser instead
 */
export async function getEmailThread(threadId: string): Promise<EmailThread | null> {
  const gmail = await getGmailClient();
  return getEmailThreadInternal(gmail, threadId);
}

export async function getEmailThreadForUser(userId: string, threadId: string): Promise<EmailThread | null> {
  const gmail = await getGmailClientForUser(userId);
  return getEmailThreadInternal(gmail, threadId);
}

async function sendEmailInternal(
  gmail: gmail_v1.Gmail,
  to: string,
  subject: string,
  body: string,
  threadId?: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const startTime = Date.now();
  try {
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const from = profile.data.emailAddress;

    const emailSubject = threadId && !subject.startsWith('Re:') ? `Re: ${subject}` : subject;
    
    const emailLines = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${emailSubject}`,
      `Content-Type: text/plain; charset=utf-8`,
      '',
      body
    ];

    const rawMessage = Buffer.from(emailLines.join('\r\n'))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: rawMessage,
        threadId: threadId || undefined
      }
    });

    recordConnectorUsage("gmail", Date.now() - startTime, true);
    return { success: true, messageId: response.data.id || undefined };
  } catch (error: any) {
    recordConnectorUsage("gmail", Date.now() - startTime, false);
    console.error('[Gmail] Error sending email:', error);
    return { success: false, error: error.message };
  }
}

/**
 * @deprecated Use sendEmailForUser instead
 */
export async function sendReply(
  threadId: string,
  to: string,
  subject: string,
  body: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const gmail = await getGmailClient();
  return sendEmailInternal(gmail, to, subject, body, threadId);
}

export async function sendEmailForUser(
  userId: string,
  to: string,
  subject: string,
  body: string,
  threadId?: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const gmail = await getGmailClientForUser(userId);
  return sendEmailInternal(gmail, to, subject, body, threadId);
}

async function getLabelsInternal(gmail: gmail_v1.Gmail): Promise<Array<{ id: string; name: string; type: string }>> {
  const startTime = Date.now();
  try {
    const response = await gmail.users.labels.list({ userId: 'me' });
    recordConnectorUsage("gmail", Date.now() - startTime, true);
    
    return (response.data.labels || []).map(label => ({
      id: label.id!,
      name: label.name!,
      type: label.type || 'user'
    }));
  } catch (error: any) {
    recordConnectorUsage("gmail", Date.now() - startTime, false);
    console.error('[Gmail] Error fetching labels:', error);
    return [];
  }
}

/**
 * @deprecated Use getLabelsForUser instead
 */
export async function getLabels(): Promise<Array<{ id: string; name: string; type: string }>> {
  const gmail = await getGmailClient();
  return getLabelsInternal(gmail);
}

export async function getLabelsForUser(userId: string): Promise<Array<{ id: string; name: string; type: string }>> {
  const gmail = await getGmailClientForUser(userId);
  return getLabelsInternal(gmail);
}

async function markAsReadInternal(gmail: gmail_v1.Gmail, messageId: string): Promise<boolean> {
  try {
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        removeLabelIds: ['UNREAD']
      }
    });
    return true;
  } catch (error: any) {
    console.error('[Gmail] Error marking as read:', error);
    return false;
  }
}

/**
 * @deprecated Use markEmailAsReadForUser instead
 */
export async function markAsRead(messageId: string): Promise<boolean> {
  const gmail = await getGmailClient();
  return markAsReadInternal(gmail, messageId);
}

export async function markEmailAsReadForUser(userId: string, messageId: string): Promise<boolean> {
  const gmail = await getGmailClientForUser(userId);
  return markAsReadInternal(gmail, messageId);
}

async function markAsUnreadInternal(gmail: gmail_v1.Gmail, messageId: string): Promise<boolean> {
  try {
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        addLabelIds: ['UNREAD']
      }
    });
    return true;
  } catch (error: any) {
    console.error('[Gmail] Error marking as unread:', error);
    return false;
  }
}

/**
 * @deprecated Use markEmailAsUnreadForUser instead
 */
export async function markAsUnread(messageId: string): Promise<boolean> {
  const gmail = await getGmailClient();
  return markAsUnreadInternal(gmail, messageId);
}

export async function markEmailAsUnreadForUser(userId: string, messageId: string): Promise<boolean> {
  const gmail = await getGmailClientForUser(userId);
  return markAsUnreadInternal(gmail, messageId);
}
