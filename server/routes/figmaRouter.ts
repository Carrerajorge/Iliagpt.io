import { Router } from "express";
import { figmaService } from "../services/figmaService";

export function createFigmaRouter() {
  const router = Router();

  router.get("/api/auth/figma", (req, res) => {
    const clientId = process.env.FIGMA_CLIENT_ID;
    if (!clientId) {
      return res.status(500).json({ error: "Figma OAuth not configured" });
    }
    
    const state = Math.random().toString(36).substring(7);
    const host = req.get('host');
    const protocol = host?.includes('replit') ? 'https' : req.protocol;
    const redirectUri = `${protocol}://${host}/api/auth/figma/callback`;
    
    console.log("Starting Figma OAuth with redirect_uri:", redirectUri);
    
    const authUrl = `https://www.figma.com/oauth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=file_content:read&state=${state}&response_type=code`;
    
    res.redirect(authUrl);
  });

  router.get("/api/auth/figma/callback", async (req, res) => {
    console.log("Figma OAuth callback received:", req.query);
    const { code, state, error, error_description } = req.query;
    
    if (error) {
      console.error("Figma OAuth error from Figma:", error, error_description);
      return res.redirect(`/?figma_error=${encodeURIComponent(error as string)}`);
    }
    
    if (!code) {
      console.error("No code received from Figma");
      return res.redirect("/?figma_error=no_code");
    }
    
    const clientId = process.env.FIGMA_CLIENT_ID;
    const clientSecret = process.env.FIGMA_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      console.error("Figma OAuth not configured");
      return res.redirect("/?figma_error=not_configured");
    }
    
    try {
      const host = req.get('host');
      const protocol = host?.includes('replit') ? 'https' : req.protocol;
      const redirectUri = `${protocol}://${host}/api/auth/figma/callback`;
      
      console.log("Exchanging code for token with redirect_uri:", redirectUri);
      
      const tokenResponse = await fetch("https://api.figma.com/v1/oauth/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          code: code as string,
          grant_type: "authorization_code",
        }),
      });
      
      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error("Figma token exchange failed:", errorText);
        return res.redirect("/?figma_error=token_exchange_failed");
      }
      
      const tokenData = await tokenResponse.json();
      console.log("Figma token received successfully");
      const { access_token } = tokenData;
      
      figmaService.setAccessToken(access_token);
      
      res.redirect("/?figma_connected=true");
    } catch (error: any) {
      console.error("Figma OAuth error:", error);
      res.redirect("/?figma_error=server_error");
    }
  });

  router.post("/api/figma/connect", async (req, res) => {
    try {
      const { accessToken } = req.body;
      if (!accessToken) {
        return res.status(400).json({ error: "Access token is required" });
      }
      
      figmaService.setAccessToken(accessToken);
      
      try {
        res.json({ success: true, message: "Figma connected successfully" });
      } catch (error: any) {
        res.status(401).json({ error: "Invalid Figma access token" });
      }
    } catch (error: any) {
      console.error("Error connecting to Figma:", error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/api/figma/status", (req, res) => {
    const token = figmaService.getAccessToken();
    res.json({ connected: !!token });
  });

  router.post("/api/figma/disconnect", (req, res) => {
    figmaService.setAccessToken("");
    res.json({ success: true });
  });

  router.get("/api/figma/file/:fileKey", async (req, res) => {
    try {
      const { fileKey } = req.params;
      const fileData = await figmaService.getFile(fileKey);
      res.json(fileData);
    } catch (error: any) {
      console.error("Error fetching Figma file:", error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/api/figma/file/:fileKey/tokens", async (req, res) => {
    try {
      const { fileKey } = req.params;
      const fileData = await figmaService.getFile(fileKey);
      const tokens = figmaService.extractDesignTokens(fileData);
      res.json({ tokens });
    } catch (error: any) {
      console.error("Error extracting design tokens:", error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/api/figma/code", async (req, res) => {
    try {
      const { fileKey, nodeId } = req.body;
      if (!fileKey) {
        return res.status(400).json({ error: "File key is required" });
      }
      
      const codeContext = await figmaService.getDesignContext(fileKey, nodeId);
      res.json(codeContext);
    } catch (error: any) {
      console.error("Error generating code from Figma:", error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/api/figma/parse-url", (req, res) => {
    try {
      const { url } = req.body;
      if (!url) {
        return res.status(400).json({ error: "URL is required" });
      }
      
      const parsed = figmaService.parseFileUrl(url);
      if (!parsed) {
        return res.status(400).json({ error: "Invalid Figma URL" });
      }
      
      res.json(parsed);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/api/figma/images/:fileKey", async (req, res) => {
    try {
      const { fileKey } = req.params;
      const { nodeIds, format = "png", scale = "2" } = req.query;
      
      if (!nodeIds || typeof nodeIds !== "string") {
        return res.status(400).json({ error: "Node IDs are required" });
      }
      
      const ids = nodeIds.split(",");
      const images = await figmaService.getImages(
        fileKey, 
        ids, 
        format as "png" | "svg" | "jpg",
        parseInt(scale as string)
      );
      res.json({ images });
    } catch (error: any) {
      console.error("Error fetching Figma images:", error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
