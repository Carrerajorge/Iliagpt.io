import { Router, Request, Response } from 'express';
import { storage } from '../storage';
import crypto from 'crypto';

const router = Router();

const OUTLOOK_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'https://graph.microsoft.com/Mail.Read',
  'https://graph.microsoft.com/Mail.Send',
  'https://graph.microsoft.com/Calendars.ReadWrite',
];

const OUTLOOK_MAIL_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'https://graph.microsoft.com/Mail.Read',
  'https://graph.microsoft.com/Mail.Send',
];

const OUTLOOK_CALENDAR_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'https://graph.microsoft.com/Calendars.ReadWrite',
  'https://graph.microsoft.com/Calendars.Read',
];

const pendingStates = new Map<
  string,
  { userId: string; expiresAt: number; type: 'outlook' | 'outlook_calendar' }
>();

function getRedirectUri(type: 'outlook' | 'outlook_calendar'): string {
  const path =
    type === 'outlook'
      ? '/api/oauth/microsoft/outlook/callback'
      : '/api/oauth/microsoft/calendar/callback';

  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}${path}`;
  } else if (process.env.REPLIT_DOMAINS) {
    const primaryDomain = process.env.REPLIT_DOMAINS.split(',')[0].trim();
    return `https://${primaryDomain}${path}`;
  } else if (process.env.BASE_URL) {
    return `${process.env.BASE_URL}${path}`;
  }
  return `http://localhost:5000${path}`;
}

function getMicrosoftAuthUrl(
  type: 'outlook' | 'outlook_calendar',
  state: string
): string {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const redirectUri = getRedirectUri(type);
  const scopes =
    type === 'outlook' ? OUTLOOK_MAIL_SCOPES : OUTLOOK_CALENDAR_SCOPES;

  const params = new URLSearchParams({
    client_id: clientId || '',
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: scopes.join(' '),
    state,
    response_mode: 'query',
    prompt: 'consent',
  });

  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
}

async function exchangeCodeForTokens(
  code: string,
  type: 'outlook' | 'outlook_calendar'
): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
}> {
  const redirectUri = getRedirectUri(type);
  const scopes =
    type === 'outlook' ? OUTLOOK_MAIL_SCOPES : OUTLOOK_CALENDAR_SCOPES;

  const body = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID || '',
    client_secret: process.env.MICROSOFT_CLIENT_SECRET || '',
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    scope: scopes.join(' '),
  });

  const res = await fetch(
    'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    }
  );

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(
      `Token exchange failed: ${(errorData as any).error_description || res.statusText}`
    );
  }

  return res.json() as any;
}

async function getMicrosoftUserInfo(
  accessToken: string
): Promise<{ email: string; displayName: string }> {
  const res = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error('Failed to fetch Microsoft user info');
  }

  const data = (await res.json()) as any;
  return {
    email: data.mail || data.userPrincipalName || '',
    displayName: data.displayName || '',
  };
}

// ─── Outlook Mail routes ─────────────────────────────────────────────

// Start OAuth for Outlook Mail
router.get('/outlook/start', async (req: Request, res: Response) => {
  const user = (req as any).user;
  const userId = user?.claims?.sub;

  console.log(
    '[Outlook OAuth] Start mail - user:',
    user ? 'present' : 'missing',
    'userId:',
    userId
  );

  if (!userId) {
    res.redirect('/?auth_required=outlook');
    return;
  }

  if (!process.env.MICROSOFT_CLIENT_ID) {
    res.redirect('/?outlook_error=not_configured');
    return;
  }

  const state = crypto.randomBytes(32).toString('hex');
  pendingStates.set(state, {
    userId,
    expiresAt: Date.now() + 10 * 60 * 1000,
    type: 'outlook',
  });

  const authUrl = getMicrosoftAuthUrl('outlook', state);
  res.redirect(authUrl);
});

// JSON endpoint for Outlook Mail
router.get('/outlook/start-json', async (req: Request, res: Response) => {
  const user = (req as any).user;
  const userId = user?.claims?.sub;

  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  if (!process.env.MICROSOFT_CLIENT_ID) {
    res.status(503).json({ error: 'Microsoft OAuth not configured' });
    return;
  }

  const state = crypto.randomBytes(32).toString('hex');
  pendingStates.set(state, {
    userId,
    expiresAt: Date.now() + 10 * 60 * 1000,
    type: 'outlook',
  });

  const authUrl = getMicrosoftAuthUrl('outlook', state);
  res.json({ authUrl });
});

// Callback for Outlook Mail
router.get('/outlook/callback', async (req: Request, res: Response) => {
  const { code, state, error: oauthError } = req.query;

  if (oauthError) {
    res.redirect(
      '/?outlook_error=' + encodeURIComponent(String(oauthError))
    );
    return;
  }

  if (!code || !state) {
    res.redirect('/?outlook_error=missing_params');
    return;
  }

  const pending = pendingStates.get(String(state));
  if (!pending || pending.expiresAt < Date.now()) {
    pendingStates.delete(String(state));
    res.redirect('/?outlook_error=invalid_state');
    return;
  }

  pendingStates.delete(String(state));

  try {
    const tokens = await exchangeCodeForTokens(
      String(code),
      'outlook'
    );
    const userInfo = await getMicrosoftUserInfo(tokens.access_token);

    const existing = await storage.getIntegrationAccountByProvider(
      pending.userId,
      'outlook'
    );

    if (existing) {
      await storage.updateIntegrationAccount(existing.id, {
        status: 'active' as any,
        email: userInfo.email,
        displayName: userInfo.displayName,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || undefined,
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        metadata: {
          connectedVia: 'oauth2',
          scopes: OUTLOOK_MAIL_SCOPES,
          connectedAt: new Date().toISOString(),
        },
      } as any);
    } else {
      await storage.createIntegrationAccount({
        userId: pending.userId,
        providerId: 'outlook',
        email: userInfo.email,
        displayName: userInfo.displayName,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || '',
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        status: 'active',
        isDefault: 'true',
        metadata: {
          connectedVia: 'oauth2',
          scopes: OUTLOOK_MAIL_SCOPES,
          connectedAt: new Date().toISOString(),
        },
      } as any);
    }

    // Auto-enable
    const policy = await storage.getIntegrationPolicy(pending.userId);
    const enabledApps = Array.from(
      new Set([...(policy?.enabledApps || []), 'outlook'])
    );
    await storage.upsertIntegrationPolicy(pending.userId, { enabledApps });

    console.log(
      `[Outlook OAuth] Successfully connected ${userInfo.email} for user ${pending.userId}`
    );
    res.redirect('/profile?outlook_connected=true');
  } catch (error: any) {
    console.error('[Outlook OAuth] Callback error:', error);
    res.redirect(
      '/?outlook_error=' + encodeURIComponent(error.message)
    );
  }
});

// Status for Outlook Mail
router.get('/outlook/status', async (req: Request, res: Response) => {
  const user = (req as any).user;
  const userId = user?.claims?.sub;

  if (!userId) {
    res.json({ connected: false });
    return;
  }

  try {
    const account = await storage.getIntegrationAccountByProvider(
      userId,
      'outlook'
    );

    if (!account || account.status !== 'active') {
      res.json({ connected: false });
      return;
    }

    res.json({
      connected: true,
      email: account.email,
      displayName: account.displayName,
    });
  } catch (error: any) {
    console.error('[Outlook OAuth] Status check error:', error);
    res.json({ connected: false, error: error.message });
  }
});

// Disconnect Outlook Mail
router.post('/outlook/disconnect', async (req: Request, res: Response) => {
  const user = (req as any).user;
  const userId = user?.claims?.sub;

  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const account = await storage.getIntegrationAccountByProvider(
      userId,
      'outlook'
    );

    if (account) {
      await storage.updateIntegrationAccount(account.id, {
        status: 'disconnected' as any,
      } as any);
    }

    const policy = await storage.getIntegrationPolicy(userId);
    if (policy?.enabledApps) {
      const enabledApps = policy.enabledApps.filter(
        (id) => id !== 'outlook'
      );
      await storage.upsertIntegrationPolicy(userId, { enabledApps });
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('[Outlook OAuth] Disconnect error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Outlook Calendar routes ─────────────────────────────────────────

// Start OAuth for Outlook Calendar
router.get('/calendar/start', async (req: Request, res: Response) => {
  const user = (req as any).user;
  const userId = user?.claims?.sub;

  console.log(
    '[Outlook Calendar OAuth] Start - user:',
    user ? 'present' : 'missing',
    'userId:',
    userId
  );

  if (!userId) {
    res.redirect('/?auth_required=outlook_calendar');
    return;
  }

  if (!process.env.MICROSOFT_CLIENT_ID) {
    res.redirect('/?outlook_calendar_error=not_configured');
    return;
  }

  const state = crypto.randomBytes(32).toString('hex');
  pendingStates.set(state, {
    userId,
    expiresAt: Date.now() + 10 * 60 * 1000,
    type: 'outlook_calendar',
  });

  const authUrl = getMicrosoftAuthUrl('outlook_calendar', state);
  res.redirect(authUrl);
});

// JSON endpoint for Outlook Calendar
router.get('/calendar/start-json', async (req: Request, res: Response) => {
  const user = (req as any).user;
  const userId = user?.claims?.sub;

  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  if (!process.env.MICROSOFT_CLIENT_ID) {
    res.status(503).json({ error: 'Microsoft OAuth not configured' });
    return;
  }

  const state = crypto.randomBytes(32).toString('hex');
  pendingStates.set(state, {
    userId,
    expiresAt: Date.now() + 10 * 60 * 1000,
    type: 'outlook_calendar',
  });

  const authUrl = getMicrosoftAuthUrl('outlook_calendar', state);
  res.json({ authUrl });
});

// Callback for Outlook Calendar
router.get('/calendar/callback', async (req: Request, res: Response) => {
  const { code, state, error: oauthError } = req.query;

  if (oauthError) {
    res.redirect(
      '/?outlook_calendar_error=' +
        encodeURIComponent(String(oauthError))
    );
    return;
  }

  if (!code || !state) {
    res.redirect('/?outlook_calendar_error=missing_params');
    return;
  }

  const pending = pendingStates.get(String(state));
  if (!pending || pending.expiresAt < Date.now()) {
    pendingStates.delete(String(state));
    res.redirect('/?outlook_calendar_error=invalid_state');
    return;
  }

  pendingStates.delete(String(state));

  try {
    const tokens = await exchangeCodeForTokens(
      String(code),
      'outlook_calendar'
    );
    const userInfo = await getMicrosoftUserInfo(tokens.access_token);

    const existing = await storage.getIntegrationAccountByProvider(
      pending.userId,
      'outlook_calendar'
    );

    if (existing) {
      await storage.updateIntegrationAccount(existing.id, {
        status: 'active' as any,
        email: userInfo.email,
        displayName: userInfo.displayName,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || undefined,
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        metadata: {
          connectedVia: 'oauth2',
          scopes: OUTLOOK_CALENDAR_SCOPES,
          connectedAt: new Date().toISOString(),
        },
      } as any);
    } else {
      await storage.createIntegrationAccount({
        userId: pending.userId,
        providerId: 'outlook_calendar',
        email: userInfo.email,
        displayName: userInfo.displayName,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || '',
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        status: 'active',
        isDefault: 'true',
        metadata: {
          connectedVia: 'oauth2',
          scopes: OUTLOOK_CALENDAR_SCOPES,
          connectedAt: new Date().toISOString(),
        },
      } as any);
    }

    // Auto-enable
    const policy = await storage.getIntegrationPolicy(pending.userId);
    const enabledApps = Array.from(
      new Set([...(policy?.enabledApps || []), 'outlook_calendar'])
    );
    await storage.upsertIntegrationPolicy(pending.userId, { enabledApps });

    console.log(
      `[Outlook Calendar OAuth] Successfully connected ${userInfo.email} for user ${pending.userId}`
    );
    res.redirect('/profile?outlook_calendar_connected=true');
  } catch (error: any) {
    console.error('[Outlook Calendar OAuth] Callback error:', error);
    res.redirect(
      '/?outlook_calendar_error=' + encodeURIComponent(error.message)
    );
  }
});

// Status for Outlook Calendar
router.get('/calendar/status', async (req: Request, res: Response) => {
  const user = (req as any).user;
  const userId = user?.claims?.sub;

  if (!userId) {
    res.json({ connected: false });
    return;
  }

  try {
    const account = await storage.getIntegrationAccountByProvider(
      userId,
      'outlook_calendar'
    );

    if (!account || account.status !== 'active') {
      res.json({ connected: false });
      return;
    }

    res.json({
      connected: true,
      email: account.email,
      displayName: account.displayName,
    });
  } catch (error: any) {
    console.error(
      '[Outlook Calendar OAuth] Status check error:',
      error
    );
    res.json({ connected: false, error: error.message });
  }
});

// Disconnect Outlook Calendar
router.post('/calendar/disconnect', async (req: Request, res: Response) => {
  const user = (req as any).user;
  const userId = user?.claims?.sub;

  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const account = await storage.getIntegrationAccountByProvider(
      userId,
      'outlook_calendar'
    );

    if (account) {
      await storage.updateIntegrationAccount(account.id, {
        status: 'disconnected' as any,
      } as any);
    }

    const policy = await storage.getIntegrationPolicy(userId);
    if (policy?.enabledApps) {
      const enabledApps = policy.enabledApps.filter(
        (id) => id !== 'outlook_calendar'
      );
      await storage.upsertIntegrationPolicy(userId, { enabledApps });
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error(
      '[Outlook Calendar OAuth] Disconnect error:',
      error
    );
    res.status(500).json({ error: error.message });
  }
});

// Clean up expired states
setInterval(() => {
  const now = Date.now();
  const entries = Array.from(pendingStates.entries());
  for (const [state, data] of entries) {
    if (data.expiresAt < now) {
      pendingStates.delete(state);
    }
  }
}, 60000);

export default router;
