import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import { storage } from '../storage';
import crypto from 'crypto';

const router = Router();

const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
];

const pendingStates = new Map<string, { userId: string; expiresAt: number }>();

function getOAuth2Client() {
  let redirectUri: string;

  if (process.env.REPLIT_DEV_DOMAIN) {
    redirectUri = `https://${process.env.REPLIT_DEV_DOMAIN}/api/oauth/google/calendar/callback`;
  } else if (process.env.REPLIT_DOMAINS) {
    const primaryDomain = process.env.REPLIT_DOMAINS.split(',')[0].trim();
    redirectUri = `https://${primaryDomain}/api/oauth/google/calendar/callback`;
  } else if (process.env.BASE_URL) {
    redirectUri = `${process.env.BASE_URL}/api/oauth/google/calendar/callback`;
  } else {
    redirectUri = 'http://localhost:5000/api/oauth/google/calendar/callback';
  }

  console.log('[Calendar OAuth] Using redirect URI:', redirectUri);

  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );
}

// Start OAuth flow (browser redirect)
router.get('/start', async (req: Request, res: Response) => {
  const user = (req as any).user;
  const userId = user?.claims?.sub;

  console.log('[Calendar OAuth] Start - user:', user ? 'present' : 'missing', 'userId:', userId);

  if (!userId) {
    res.redirect('/?auth_required=calendar');
    return;
  }

  const state = crypto.randomBytes(32).toString('hex');
  pendingStates.set(state, {
    userId,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });

  const oauth2Client = getOAuth2Client();
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: CALENDAR_SCOPES,
    state,
    prompt: 'consent',
  });

  res.redirect(authUrl);
});

// JSON endpoint for programmatic access
router.get('/start-json', async (req: Request, res: Response) => {
  const user = (req as any).user;
  const userId = user?.claims?.sub;

  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const state = crypto.randomBytes(32).toString('hex');
  pendingStates.set(state, {
    userId,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });

  const oauth2Client = getOAuth2Client();
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: CALENDAR_SCOPES,
    state,
    prompt: 'consent',
  });

  res.json({ authUrl });
});

// OAuth callback
router.get('/callback', async (req: Request, res: Response) => {
  const { code, state, error } = req.query;

  if (error) {
    res.redirect('/?calendar_error=' + encodeURIComponent(String(error)));
    return;
  }

  if (!code || !state) {
    res.redirect('/?calendar_error=missing_params');
    return;
  }

  const pending = pendingStates.get(String(state));
  if (!pending || pending.expiresAt < Date.now()) {
    pendingStates.delete(String(state));
    res.redirect('/?calendar_error=invalid_state');
    return;
  }

  pendingStates.delete(String(state));

  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(String(code));

    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email;

    if (!email) {
      res.redirect('/?calendar_error=no_email');
      return;
    }

    // Store the calendar connection in integration_accounts
    const existing = await storage.getIntegrationAccountByProvider(
      pending.userId,
      'google_calendar'
    );

    if (existing) {
      await storage.updateIntegrationAccount(existing.id, {
        status: 'active' as any,
        email,
        displayName: userInfo.data.name || email,
        accessToken: tokens.access_token || undefined,
        refreshToken: tokens.refresh_token || undefined,
        tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
        metadata: {
          connectedVia: 'oauth2',
          scopes: CALENDAR_SCOPES,
          connectedAt: new Date().toISOString(),
        },
      } as any);
    } else {
      await storage.createIntegrationAccount({
        userId: pending.userId,
        providerId: 'google_calendar',
        email,
        displayName: userInfo.data.name || email,
        accessToken: tokens.access_token || '',
        refreshToken: tokens.refresh_token || '',
        tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
        status: 'active',
        isDefault: 'true',
        metadata: {
          connectedVia: 'oauth2',
          scopes: CALENDAR_SCOPES,
          connectedAt: new Date().toISOString(),
        },
      } as any);
    }

    // Auto-enable in policy
    const policy = await storage.getIntegrationPolicy(pending.userId);
    const enabledApps = Array.from(
      new Set([...(policy?.enabledApps || []), 'google_calendar'])
    );
    await storage.upsertIntegrationPolicy(pending.userId, { enabledApps });

    console.log(
      `[Calendar OAuth] Successfully connected ${email} for user ${pending.userId}`
    );
    res.redirect('/profile?calendar_connected=true');
  } catch (error: any) {
    console.error('[Calendar OAuth] Callback error:', error);
    res.redirect(
      '/?calendar_error=' + encodeURIComponent(error.message)
    );
  }
});

// Status check
router.get('/status', async (req: Request, res: Response) => {
  const user = (req as any).user;
  const userId = user?.claims?.sub;

  if (!userId) {
    res.json({ connected: false });
    return;
  }

  try {
    const account = await storage.getIntegrationAccountByProvider(
      userId,
      'google_calendar'
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
    console.error('[Calendar OAuth] Status check error:', error);
    res.json({ connected: false, error: error.message });
  }
});

// Disconnect
router.post('/disconnect', async (req: Request, res: Response) => {
  const user = (req as any).user;
  const userId = user?.claims?.sub;

  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const account = await storage.getIntegrationAccountByProvider(
      userId,
      'google_calendar'
    );

    if (account) {
      // Revoke token if possible
      if (account.accessToken) {
        try {
          const oauth2Client = new google.auth.OAuth2();
          oauth2Client.setCredentials({
            access_token: account.accessToken,
          });
          await oauth2Client.revokeCredentials();
        } catch {
          console.log(
            '[Calendar OAuth] Token revocation failed (may already be revoked)'
          );
        }
      }

      await storage.updateIntegrationAccount(account.id, {
        status: 'disconnected' as any,
      } as any);
    }

    // Remove from enabled apps
    const policy = await storage.getIntegrationPolicy(userId);
    if (policy?.enabledApps) {
      const enabledApps = policy.enabledApps.filter(
        (id) => id !== 'google_calendar'
      );
      await storage.upsertIntegrationPolicy(userId, { enabledApps });
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('[Calendar OAuth] Disconnect error:', error);
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
