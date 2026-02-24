// Gmail Router - API endpoints for Gmail integration
import { Router, Request, Response } from "express";
import {
  checkGmailConnection,
  checkGmailConnectionForUser,
  searchEmails,
  searchEmailsForUser,
  getEmailThread,
  getEmailThreadForUser,
  sendReply,
  sendEmailForUser,
  getLabels,
  getLabelsForUser,
  markAsRead,
  markEmailAsReadForUser,
  markAsUnread,
  markEmailAsUnreadForUser
} from "../services/gmailService";

// Helper to extract userId from Passport session
function getUserId(req: Request): string | undefined {
  const user = (req as any).user;
  return user?.claims?.sub || user?.id;
}

export function createGmailRouter() {
  const router = Router();

  router.get("/status", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      
      if (userId) {
        const status = await checkGmailConnectionForUser(userId);
        res.json(status);
      } else {
        const status = await checkGmailConnection();
        res.json(status);
      }
    } catch (error: any) {
      console.error("[Gmail] Status check error:", error);
      res.json({ connected: false, error: error.message });
    }
  });

  router.get("/search", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { q, maxResults, labelIds, pageToken } = req.query;
      
      const query = typeof q === 'string' ? q : '';
      const max = typeof maxResults === 'string' ? parseInt(maxResults, 10) : 20;
      const labels = typeof labelIds === 'string' ? labelIds.split(',') : undefined;
      const token = typeof pageToken === 'string' ? pageToken : undefined;

      const result = userId 
        ? await searchEmailsForUser(userId, query, max, labels, token)
        : await searchEmails(query, max, labels, token);
      
      res.json({ emails: result.emails, nextPageToken: result.nextPageToken });
    } catch (error: any) {
      console.error("[Gmail] Search error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/threads/:threadId", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { threadId } = req.params;
      
      if (!threadId) {
        return res.status(400).json({ error: "Thread ID required" });
      }

      const thread = userId
        ? await getEmailThreadForUser(userId, threadId)
        : await getEmailThread(threadId);
      
      if (!thread) {
        return res.status(404).json({ error: "Thread not found" });
      }

      res.json(thread);
    } catch (error: any) {
      console.error("[Gmail] Thread fetch error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/reply", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { threadId, to, subject, body } = req.body;
      
      if (!threadId || !to || !body) {
        return res.status(400).json({ 
          error: "Missing required fields: threadId, to, body" 
        });
      }

      const result = userId
        ? await sendEmailForUser(userId, to, subject || '', body, threadId)
        : await sendReply(threadId, to, subject || '', body);
      
      if (result.success) {
        res.json({ success: true, messageId: result.messageId });
      } else {
        res.status(500).json({ success: false, error: result.error });
      }
    } catch (error: any) {
      console.error("[Gmail] Reply error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/send", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { to, subject, body, threadId } = req.body;
      
      if (!to || !body) {
        return res.status(400).json({ 
          error: "Missing required fields: to, body" 
        });
      }

      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const result = await sendEmailForUser(userId, to, subject || '', body, threadId);
      
      if (result.success) {
        res.json({ success: true, messageId: result.messageId });
      } else {
        res.status(500).json({ success: false, error: result.error });
      }
    } catch (error: any) {
      console.error("[Gmail] Send error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/labels", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const labels = userId 
        ? await getLabelsForUser(userId)
        : await getLabels();
      res.json({ labels });
    } catch (error: any) {
      console.error("[Gmail] Labels fetch error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/messages/:messageId/read", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { messageId } = req.params;
      const success = userId
        ? await markEmailAsReadForUser(userId, messageId)
        : await markAsRead(messageId);
      res.json({ success });
    } catch (error: any) {
      console.error("[Gmail] Mark read error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/messages/:messageId/unread", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { messageId } = req.params;
      const success = userId
        ? await markEmailAsUnreadForUser(userId, messageId)
        : await markAsUnread(messageId);
      res.json({ success });
    } catch (error: any) {
      console.error("[Gmail] Mark unread error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/connect", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      
      if (userId) {
        const status = await checkGmailConnectionForUser(userId);
        if (status.connected) {
          const returnUrl = req.query.return_url || '/';
          res.redirect(`${returnUrl}?gmail_connected=true`);
        } else {
          res.redirect('/api/oauth/google/gmail/start');
        }
      } else {
        const status = await checkGmailConnection();
        if (status.connected) {
          const returnUrl = req.query.return_url || '/';
          res.redirect(`${returnUrl}?gmail_connected=true`);
        } else {
          res.status(400).json({ 
            error: "Gmail no está configurado",
            message: "Gmail necesita ser conectado a través del panel de integraciones de Replit" 
          });
        }
      }
    } catch (error: any) {
      res.status(400).json({ 
        error: "Gmail no está conectado",
        message: "Gmail necesita ser conectado a través del panel de integraciones de Replit",
        details: error.message
      });
    }
  });

  router.post("/disconnect", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    
    if (userId) {
      res.redirect(307, '/api/oauth/google/gmail/disconnect');
    } else {
      const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
      if (hostname) {
        res.json({ 
          success: true, 
          disconnectUrl: `https://${hostname}/connectors/google-mail/disconnect`,
          message: "Para desconectar Gmail, visita la URL de desconexión" 
        });
      } else {
        res.json({ success: false, message: "Connector not available" });
      }
    }
  });

  return router;
}
