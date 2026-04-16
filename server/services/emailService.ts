import { Resend } from 'resend';

let connectionSettings: any;

async function getCredentials() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=resend',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  if (!connectionSettings || (!connectionSettings.settings.api_key)) {
    throw new Error('Resend not connected');
  }
  return {apiKey: connectionSettings.settings.api_key, fromEmail: connectionSettings.settings.from_email};
}

async function getResendClient() {
  const { apiKey, fromEmail } = await getCredentials();
  return {
    client: new Resend(apiKey),
    fromEmail
  };
}

interface ShareNotificationParams {
  toEmail: string;
  chatTitle: string;
  chatId: string;
  role: string;
  inviterEmail: string;
}

export async function sendShareNotificationEmail(params: ShareNotificationParams): Promise<void> {
  const { toEmail, chatTitle, chatId, role, inviterEmail } = params;
  
  const roleLabels: Record<string, string> = {
    owner: "propietario",
    editor: "editor",
    viewer: "visualizador"
  };
  
  const roleLabel = roleLabels[role] || role;
  const baseUrl = process.env.REPLIT_DEV_DOMAIN 
    ? `https://${process.env.REPLIT_DEV_DOMAIN}` 
    : 'https://siragpt.app';
  const shareUrl = `${baseUrl}/chat/${chatId}`;
  
  const subject = `${inviterEmail} te ha compartido una conversación en iliagpt`;
  
  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
    .button { display: inline-block; background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 20px; }
    .info { background: white; padding: 15px; border-radius: 8px; margin: 15px 0; }
    .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🤖 iliagpt</h1>
      <p>Tienes una nueva invitación</p>
    </div>
    <div class="content">
      <p>¡Hola!</p>
      <p><strong>${inviterEmail}</strong> te ha invitado a participar en una conversación.</p>
      
      <div class="info">
        <p>📝 <strong>Conversación:</strong> "${chatTitle}"</p>
        <p>👤 <strong>Tu rol:</strong> ${roleLabel}</p>
      </div>
      
      <p>Haz clic en el siguiente botón para acceder:</p>
      <a href="${shareUrl}" class="button">Ver conversación</a>
      
      <div class="footer">
        <p>iliagpt - Tu asistente de IA</p>
      </div>
    </div>
  </div>
</body>
</html>
`;

  const textBody = `
¡Hola!

${inviterEmail} te ha invitado a participar en una conversación en iliagpt.

📝 Conversación: "${chatTitle}"
👤 Tu rol: ${roleLabel}
🔗 Enlace: ${shareUrl}

Haz clic en el enlace para acceder a la conversación.

---
iliagpt - Tu asistente de IA
`;

  try {
    const { client, fromEmail } = await getResendClient();
    
    const result = await client.emails.send({
      from: fromEmail || 'iliagpt <noreply@resend.dev>',
      to: toEmail,
      subject: subject,
      html: htmlBody,
      text: textBody,
    });
    
    console.log(`📧 Email sent successfully to ${toEmail}:`, result);
  } catch (error) {
    console.error(`❌ Failed to send email to ${toEmail}:`, error);
    throw error;
  }
}
