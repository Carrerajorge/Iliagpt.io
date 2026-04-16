/**
 * Google Drive Integration Service
 * Save and retrieve documents from Google Drive
 */

import { OAuth2Client } from 'google-auth-library';
import { google, drive_v3 } from 'googleapis';
import { Readable } from 'stream';

// OAuth configuration
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/google/callback';

// Scopes needed for Drive access
const SCOPES = [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/drive.metadata.readonly',
];

// User tokens store (in production, use database)
const userTokens = new Map<number, { accessToken: string; refreshToken: string }>();

/**
 * Create OAuth2 client with user tokens
 */
function getOAuth2Client(userId?: number): OAuth2Client {
    const client = new OAuth2Client(
        GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET,
        GOOGLE_REDIRECT_URI
    );

    if (userId) {
        const tokens = userTokens.get(userId);
        if (tokens) {
            client.setCredentials({
                access_token: tokens.accessToken,
                refresh_token: tokens.refreshToken,
            });
        }
    }

    return client;
}

/**
 * Get authorization URL for user to grant access
 */
export function getAuthUrl(state: string): string {
    const client = getOAuth2Client();
    return client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        state,
        prompt: 'consent',
    });
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCode(
    code: string,
    userId: number
): Promise<{ accessToken: string; refreshToken: string }> {
    const client = getOAuth2Client();
    const { tokens } = await client.getToken(code);

    const result = {
        accessToken: tokens.access_token || '',
        refreshToken: tokens.refresh_token || '',
    };

    userTokens.set(userId, result);
    return result;
}

/**
 * Revoke user's Google access
 */
export async function revokeAccess(userId: number): Promise<void> {
    const tokens = userTokens.get(userId);
    if (tokens) {
        try {
            const client = getOAuth2Client(userId);
            await client.revokeToken(tokens.accessToken);
        } catch (error) {
            console.error('Error revoking token:', error);
        }
        userTokens.delete(userId);
    }
}

/**
 * Check if user has Google Drive connected
 */
export function isConnected(userId: number): boolean {
    return userTokens.has(userId);
}

/**
 * Get Drive client for user
 */
function getDriveClient(userId: number): drive_v3.Drive {
    const auth = getOAuth2Client(userId);
    return google.drive({ version: 'v3', auth });
}

/**
 * Upload a file to Google Drive
 */
export async function uploadFile(
    userId: number,
    fileName: string,
    mimeType: string,
    data: Buffer | Readable,
    folderId?: string
): Promise<{ id: string; webViewLink: string; webContentLink: string }> {
    const drive = getDriveClient(userId);

    const fileMetadata: drive_v3.Schema$File = {
        name: fileName,
    };

    if (folderId) {
        fileMetadata.parents = [folderId];
    }

    const media = {
        mimeType,
        body: data instanceof Buffer ? Readable.from(data) : data,
    };

    const response = await drive.files.create({
        requestBody: fileMetadata,
        media,
        fields: 'id,webViewLink,webContentLink',
    });

    return {
        id: response.data.id || '',
        webViewLink: response.data.webViewLink || '',
        webContentLink: response.data.webContentLink || '',
    };
}

/**
 * Create a folder in Google Drive
 */
export async function createFolder(
    userId: number,
    folderName: string,
    parentId?: string
): Promise<{ id: string; webViewLink: string }> {
    const drive = getDriveClient(userId);

    const fileMetadata: drive_v3.Schema$File = {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
    };

    if (parentId) {
        fileMetadata.parents = [parentId];
    }

    const response = await drive.files.create({
        requestBody: fileMetadata,
        fields: 'id,webViewLink',
    });

    return {
        id: response.data.id || '',
        webViewLink: response.data.webViewLink || '',
    };
}

/**
 * Get or create ILIAGPT folder
 */
export async function getMichatFolder(userId: number): Promise<string> {
    const drive = getDriveClient(userId);

    // Search for existing ILIAGPT folder
    const response = await drive.files.list({
        q: "name='ILIAGPT' and mimeType='application/vnd.google-apps.folder' and trashed=false",
        fields: 'files(id)',
        pageSize: 1,
    });

    if (response.data.files && response.data.files.length > 0) {
        return response.data.files[0].id || '';
    }

    // Create new folder
    const folder = await createFolder(userId, 'ILIAGPT');
    return folder.id;
}

/**
 * List files in user's Drive
 */
export async function listFiles(
    userId: number,
    options: {
        folderId?: string;
        mimeType?: string;
        pageSize?: number;
        pageToken?: string;
    } = {}
): Promise<{
    files: Array<{ id: string; name: string; mimeType: string; modifiedTime: string }>;
    nextPageToken?: string;
}> {
    const drive = getDriveClient(userId);

    let query = 'trashed=false';
    if (options.folderId) {
        query += ` and '${options.folderId}' in parents`;
    }
    if (options.mimeType) {
        query += ` and mimeType='${options.mimeType}'`;
    }

    const response = await drive.files.list({
        q: query,
        fields: 'nextPageToken, files(id, name, mimeType, modifiedTime)',
        pageSize: options.pageSize || 20,
        pageToken: options.pageToken,
        orderBy: 'modifiedTime desc',
    });

    return {
        files: (response.data.files || []).map(file => ({
            id: file.id || '',
            name: file.name || '',
            mimeType: file.mimeType || '',
            modifiedTime: file.modifiedTime || '',
        })),
        nextPageToken: response.data.nextPageToken || undefined,
    };
}

/**
 * Download a file from Google Drive
 */
export async function downloadFile(userId: number, fileId: string): Promise<Buffer> {
    const drive = getDriveClient(userId);

    const response = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'arraybuffer' }
    );

    return Buffer.from(response.data as ArrayBuffer);
}

/**
 * Delete a file from Google Drive
 */
export async function deleteFile(userId: number, fileId: string): Promise<void> {
    const drive = getDriveClient(userId);
    await drive.files.delete({ fileId });
}

/**
 * Get file metadata
 */
export async function getFileMetadata(
    userId: number,
    fileId: string
): Promise<{ name: string; mimeType: string; size: number; webViewLink: string }> {
    const drive = getDriveClient(userId);

    const response = await drive.files.get({
        fileId,
        fields: 'name,mimeType,size,webViewLink',
    });

    return {
        name: response.data.name || '',
        mimeType: response.data.mimeType || '',
        size: parseInt(response.data.size || '0', 10),
        webViewLink: response.data.webViewLink || '',
    };
}

// ============================================
// EXPRESS ROUTER
// ============================================

import { Router } from 'express';

export function createGoogleDriveRouter() {
    const router = Router();

    // Start OAuth flow
    router.get('/auth', (req, res) => {
        const userId = (req as any).user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const state = Buffer.from(JSON.stringify({ userId })).toString('base64');
        const authUrl = getAuthUrl(state);
        res.json({ authUrl });
    });

    // OAuth callback
    router.get('/callback', async (req, res) => {
        try {
            const { code, state } = req.query;

            if (!code || !state) {
                return res.status(400).json({ error: 'Missing code or state' });
            }

            const { userId } = JSON.parse(Buffer.from(state as string, 'base64').toString());
            await exchangeCode(code as string, userId);

            res.redirect('/settings?googleDrive=connected');
        } catch (error: any) {
            console.error('Google OAuth error:', error);
            res.redirect('/settings?googleDrive=error');
        }
    });

    // Check connection status
    router.get('/status', (req, res) => {
        const userId = (req as any).user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        res.json({ connected: isConnected(userId) });
    });

    // Disconnect
    router.post('/disconnect', async (req, res) => {
        const userId = (req as any).user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        await revokeAccess(userId);
        res.json({ success: true });
    });

    // Upload file
    router.post('/upload', async (req, res) => {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            if (!isConnected(userId)) {
                return res.status(400).json({ error: 'Google Drive not connected' });
            }

            const { fileName, mimeType, data, folderId } = req.body;
            const buffer = Buffer.from(data, 'base64');

            // Get or create ILIAGPT folder
            const iliagptFolderId = folderId || await getMichatFolder(userId);

            const result = await uploadFile(userId, fileName, mimeType, buffer, iliagptFolderId);
            res.json(result);
        } catch (error: any) {
            console.error('Upload error:', error);
            res.status(500).json({ error: 'Upload failed', details: error.message });
        }
    });

    // List files
    router.get('/files', async (req, res) => {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            if (!isConnected(userId)) {
                return res.status(400).json({ error: 'Google Drive not connected' });
            }

            const { folderId, pageToken } = req.query;
            const result = await listFiles(userId, {
                folderId: folderId as string,
                pageToken: pageToken as string,
            });

            res.json(result);
        } catch (error: any) {
            res.status(500).json({ error: 'Failed to list files', details: error.message });
        }
    });

    return router;
}
