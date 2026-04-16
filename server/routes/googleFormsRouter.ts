import { Router, Request, Response } from "express";
import { storage } from "../storage";
import {
  getAuthUrl,
  parseStateParam,
  exchangeCodeForTokens,
  getUserInfo,
  revokeTokens,
  refreshAccessToken,
  generateFormStructure,
  createGoogleForm,
  generateGoogleForm,
} from "../services/googleFormsService";

const PROVIDER_ID = "google-forms";

export function createGoogleFormsRouter(): Router {
  const router = Router();

  router.get("/status", async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.claims?.sub;
      
      if (!userId) {
        return res.json({
          connected: false,
          message: "Usuario no autenticado",
        });
      }
      
      const account = await storage.getIntegrationAccountByProvider(userId, PROVIDER_ID);
      
      if (!account) {
        return res.json({
          connected: false,
        });
      }
      
      const isExpired = account.tokenExpiresAt && new Date(account.tokenExpiresAt) < new Date();
      
      res.json({
        connected: true,
        displayName: account.displayName,
        email: account.email,
        avatarUrl: account.avatarUrl,
        tokenExpired: isExpired,
        status: account.status,
      });
    } catch (error: any) {
      console.error("Error checking Google Forms status:", error);
      res.status(500).json({
        error: "Error al verificar el estado de conexión",
        details: error.message,
      });
    }
  });

  router.get("/connect", async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.claims?.sub;
      
      if (!userId) {
        return res.status(401).json({
          error: "Usuario no autenticado",
        });
      }
      
      const host = req.get("host") || req.headers.host || "localhost:5000";
      const authUrl = getAuthUrl(userId, host);
      res.redirect(authUrl);
    } catch (error: any) {
      console.error("Error generating OAuth URL:", error);
      res.status(500).json({
        error: "Error al generar URL de autenticación",
        details: error.message,
      });
    }
  });

  router.get("/callback", async (req: Request, res: Response) => {
    try {
      const { code, state, error: oauthError } = req.query;
      
      if (oauthError) {
        console.error("OAuth error:", oauthError);
        return res.redirect("/?error=oauth_denied");
      }
      
      if (!code || typeof code !== "string") {
        return res.redirect("/?error=no_code");
      }
      
      let userId = (req as any).user?.claims?.sub;
      let host = req.get("host") || req.headers.host || "localhost:5000";
      
      if (state && typeof state === "string") {
        const stateData = parseStateParam(state);
        if (stateData) {
          if (!userId) {
            userId = stateData.userId;
          }
          if (stateData.host) {
            host = stateData.host;
          }
        }
      }
      
      if (!userId) {
        return res.redirect("/?error=auth_failed&message=Could not identify user");
      }
      
      const tokens = await exchangeCodeForTokens(code, host);
      const userInfo = await getUserInfo(tokens.accessToken);
      
      const existingAccount = await storage.getIntegrationAccountByProvider(userId, PROVIDER_ID);
      
      if (existingAccount) {
        await storage.updateIntegrationAccount(existingAccount.id, {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken || existingAccount.refreshToken,
          tokenExpiresAt: tokens.expiresAt,
          externalUserId: userInfo.id,
          displayName: userInfo.name,
          email: userInfo.email,
          avatarUrl: userInfo.picture,
          status: "active",
          scopes: "forms.body,drive.file",
          updatedAt: new Date(),
        });
      } else {
        const provider = await storage.getIntegrationProvider(PROVIDER_ID);
        if (!provider) {
          await storage.createIntegrationProvider({
            id: PROVIDER_ID,
            name: "Google Forms",
            description: "Create and manage Google Forms",
            authType: "oauth2",
            category: "productivity",
            isActive: "true",
          });
        }
        
        await storage.createIntegrationAccount({
          userId,
          providerId: PROVIDER_ID,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          tokenExpiresAt: tokens.expiresAt,
          externalUserId: userInfo.id,
          displayName: userInfo.name,
          email: userInfo.email,
          avatarUrl: userInfo.picture,
          status: "active",
          scopes: "forms.body,drive.file",
        });
      }
      
      res.redirect("/?google_forms_connected=true");
    } catch (error: any) {
      console.error("Error in OAuth callback:", error);
      res.redirect(`/?error=oauth_failed&message=${encodeURIComponent(error.message)}`);
    }
  });

  router.post("/disconnect", async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.claims?.sub;
      
      if (!userId) {
        return res.status(401).json({
          error: "Usuario no autenticado",
        });
      }
      
      const account = await storage.getIntegrationAccountByProvider(userId, PROVIDER_ID);
      
      if (!account) {
        return res.status(404).json({
          error: "No hay cuenta de Google Forms conectada",
        });
      }
      
      if (account.accessToken) {
        try {
          await revokeTokens(account.accessToken);
        } catch (revokeError) {
          console.warn("Failed to revoke tokens (may already be revoked):", revokeError);
        }
      }
      
      await storage.deleteIntegrationAccount(account.id);
      
      res.json({
        success: true,
        message: "Cuenta de Google Forms desconectada",
      });
    } catch (error: any) {
      console.error("Error disconnecting Google Forms:", error);
      res.status(500).json({
        error: "Error al desconectar cuenta",
        details: error.message,
      });
    }
  });

  router.post("/create", async (req: Request, res: Response) => {
    try {
      const { prompt, title } = req.body;
      
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({
          error: "Se requiere una descripción del formulario",
        });
      }
      
      const userId = (req as any).user?.claims?.sub;
      
      if (!userId) {
        return res.status(401).json({
          error: "Usuario no autenticado",
        });
      }
      
      const account = await storage.getIntegrationAccountByProvider(userId, PROVIDER_ID);
      
      if (!account || !account.accessToken) {
        return res.status(403).json({
          error: "No hay cuenta de Google Forms conectada",
          needsAuth: true,
        });
      }
      
      let accessToken = account.accessToken;
      
      if (account.tokenExpiresAt && new Date(account.tokenExpiresAt) < new Date()) {
        if (!account.refreshToken) {
          return res.status(403).json({
            error: "Token expirado. Por favor, reconecte su cuenta de Google",
            needsAuth: true,
          });
        }
        
        try {
          const newTokens = await refreshAccessToken(account.refreshToken);
          await storage.updateIntegrationAccount(account.id, {
            accessToken: newTokens.accessToken,
            refreshToken: newTokens.refreshToken,
            tokenExpiresAt: newTokens.expiresAt,
            updatedAt: new Date(),
          });
          accessToken = newTokens.accessToken;
        } catch (refreshError) {
          console.error("Failed to refresh token:", refreshError);
          return res.status(403).json({
            error: "No se pudo renovar el token. Por favor, reconecte su cuenta de Google",
            needsAuth: true,
          });
        }
      }
      
      const formStructure = await generateFormStructure(prompt, title);
      const form = await createGoogleForm(accessToken, formStructure);
      
      res.json({
        success: true,
        formId: form.formId,
        title: form.title,
        description: form.description,
        questions: form.questions,
        responderUrl: form.responderUrl,
        editUrl: form.editUrl,
      });
    } catch (error: any) {
      console.error("Error creating Google Form:", error);
      
      if (error.code === 401 || error.message?.includes("invalid_grant")) {
        return res.status(403).json({
          error: "Token de acceso inválido. Por favor, reconecte su cuenta de Google",
          needsAuth: true,
        });
      }
      
      res.status(500).json({
        error: "Error al crear el formulario",
        details: error.message,
      });
    }
  });

  router.post("/generate", async (req: Request, res: Response) => {
    try {
      const { prompt, title } = req.body;

      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ 
          error: "Se requiere una descripción del formulario" 
        });
      }

      const form = await generateGoogleForm(prompt, title);

      res.json({
        success: true,
        formId: form.formId,
        title: form.title,
        description: form.description,
        questions: form.questions,
        responderUrl: form.responderUrl,
        editUrl: form.editUrl
      });
    } catch (error: any) {
      console.error("Error generating Google Form:", error);
      res.status(500).json({ 
        error: "Error al generar el formulario",
        details: error.message 
      });
    }
  });

  return router;
}
