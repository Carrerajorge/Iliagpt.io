/**
 * Email Service - Generic email sending for IliaGPT
 * 
 * Supports:
 * - Resend API (RESEND_API_KEY)
 * - SMTP (EMAIL_SMTP_HOST, EMAIL_SMTP_USER, EMAIL_SMTP_PASS)
 * - Console logging fallback for development
 */

interface EmailOptions {
    to: string;
    subject: string;
    html: string;
    text?: string;
    from?: string;
}

interface EmailResult {
    success: boolean;
    messageId?: string;
    error?: string;
}

const APP_NAME = "IliaGPT";
const APP_URL = process.env.APP_URL || "https://iliagpt.com";
const DEFAULT_FROM = process.env.EMAIL_FROM || `${APP_NAME} <noreply@iliagpt.com>`;

/**
 * Send email using configured provider
 */
export async function sendEmail(options: EmailOptions): Promise<EmailResult> {
    const { to, subject, html, text, from = DEFAULT_FROM } = options;

    // Try Resend first
    if (process.env.RESEND_API_KEY) {
        return sendViaResend({ to, subject, html, text, from });
    }

    // Try SMTP
    if (process.env.EMAIL_SMTP_HOST) {
        return sendViaSMTP({ to, subject, html, text, from });
    }

    // Development fallback - log to console
    console.log(`\n📧 [EMAIL SERVICE - DEV MODE]`);
    console.log(`To: ${to}`);
    console.log(`From: ${from}`);
    console.log(`Subject: ${subject}`);
    console.log(`Body (text): ${text || html.substring(0, 200)}...`);
    console.log(`---\n`);

    return {
        success: true,
        messageId: `dev-${Date.now()}`
    };
}

/**
 * Send via Resend API
 */
async function sendViaResend(options: EmailOptions): Promise<EmailResult> {
    try {
        const response = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                from: options.from,
                to: options.to,
                subject: options.subject,
                html: options.html,
                text: options.text
            })
        });

        const data = await response.json();

        if (!response.ok) {
            return { success: false, error: data.message || "Resend API error" };
        }

        console.log(`📧 Email sent via Resend to ${options.to}`);
        return { success: true, messageId: data.id };

    } catch (error: any) {
        console.error(`❌ Resend error:`, error);
        return { success: false, error: error.message };
    }
}

/**
 * Send via SMTP (nodemailer)
 */
async function sendViaSMTP(options: EmailOptions): Promise<EmailResult> {
    try {
        const nodemailer = await import("nodemailer");

        const transporter = nodemailer.default.createTransport({
            host: process.env.EMAIL_SMTP_HOST,
            port: parseInt(process.env.EMAIL_SMTP_PORT || "587"),
            secure: process.env.EMAIL_SMTP_SECURE === "true",
            auth: {
                user: process.env.EMAIL_SMTP_USER,
                pass: process.env.EMAIL_SMTP_PASS
            }
        });

        const result = await transporter.sendMail({
            from: options.from,
            to: options.to,
            subject: options.subject,
            html: options.html,
            text: options.text
        });

        console.log(`📧 Email sent via SMTP to ${options.to}`);
        return { success: true, messageId: result.messageId };

    } catch (error: any) {
        console.error(`❌ SMTP error:`, error);
        return { success: false, error: error.message };
    }
}

// ============================================================================
// Email Templates
// ============================================================================

/**
 * Generate magic link email
 */
export function getMagicLinkEmailHTML(magicLinkUrl: string): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 20px; }
        .container { max-width: 500px; margin: 0 auto; }
        .header { text-align: center; padding: 30px 0; }
        .logo { font-size: 32px; font-weight: bold; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .content { background: #f8f9fa; padding: 30px; border-radius: 12px; }
        .button { display: block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white !important; text-decoration: none; padding: 14px 28px; border-radius: 8px; text-align: center; font-weight: 600; margin: 20px 0; }
        .footer { text-align: center; color: #666; font-size: 12px; margin-top: 30px; }
        .warning { color: #e74c3c; font-size: 13px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo">🤖 ${APP_NAME}</div>
        </div>
        <div class="content">
            <h2>Iniciar sesión</h2>
            <p>Haz clic en el siguiente botón para iniciar sesión en tu cuenta:</p>
            <a href="${magicLinkUrl}" class="button">Iniciar Sesión</a>
            <p class="warning">⚠️ Este enlace expira en 15 minutos y solo puede usarse una vez.</p>
            <p style="font-size: 13px; color: #666;">Si no solicitaste este enlace, puedes ignorar este correo.</p>
        </div>
        <div class="footer">
            <p>${APP_NAME} - Plataforma de IA Autónoma</p>
            <p><a href="${APP_URL}">${APP_URL}</a></p>
        </div>
    </div>
</body>
</html>`;
}

export function getMagicLinkEmailText(magicLinkUrl: string): string {
    return `
Iniciar sesión en ${APP_NAME}

Haz clic en el siguiente enlace para iniciar sesión:
${magicLinkUrl}

⚠️ Este enlace expira en 15 minutos y solo puede usarse una vez.

Si no solicitaste este enlace, puedes ignorar este correo.

---
${APP_NAME} - ${APP_URL}
`;
}

/**
 * Send magic link email
 */
export async function sendMagicLinkEmail(to: string, magicLinkUrl: string): Promise<EmailResult> {
    return sendEmail({
        to,
        subject: `🔐 Iniciar sesión en ${APP_NAME}`,
        html: getMagicLinkEmailHTML(magicLinkUrl),
        text: getMagicLinkEmailText(magicLinkUrl)
    });
}

/**
 * Send invoice/payment notification
 */
export async function sendPaymentEmail(to: string, options: {
    invoiceId: string;
    amount: number;
    currency?: string;
    status: "paid" | "pending" | "failed";
    invoiceUrl?: string;
}): Promise<EmailResult> {
    const { invoiceId, amount, currency = "USD", status, invoiceUrl } = options;
    
    const statusLabels: Record<string, { emoji: string; text: string; color: string }> = {
        paid: { emoji: "✅", text: "Pagado", color: "#27ae60" },
        pending: { emoji: "⏳", text: "Pendiente", color: "#f39c12" },
        failed: { emoji: "❌", text: "Fallido", color: "#e74c3c" }
    };
    
    const { emoji, text: statusText, color } = statusLabels[status] || statusLabels.pending;

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 20px; }
        .container { max-width: 500px; margin: 0 auto; }
        .header { text-align: center; padding: 20px 0; }
        .content { background: #f8f9fa; padding: 30px; border-radius: 12px; }
        .invoice-box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .amount { font-size: 32px; font-weight: bold; color: #333; }
        .status { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 14px; font-weight: 600; color: white; background: ${color}; }
        .button { display: block; background: #667eea; color: white !important; text-decoration: none; padding: 14px 28px; border-radius: 8px; text-align: center; font-weight: 600; margin: 20px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2>${emoji} Notificación de Pago</h2>
        </div>
        <div class="content">
            <div class="invoice-box">
                <p><strong>Factura:</strong> ${invoiceId}</p>
                <p class="amount">${currency} ${amount.toFixed(2)}</p>
                <span class="status">${statusText}</span>
            </div>
            ${invoiceUrl ? `<a href="${invoiceUrl}" class="button">Ver Factura</a>` : ""}
            <p style="font-size: 13px; color: #666;">Si tienes alguna pregunta, responde a este correo.</p>
        </div>
    </div>
</body>
</html>`;

    return sendEmail({
        to,
        subject: `${emoji} Factura ${invoiceId} - ${statusText}`,
        html,
        text: `Factura ${invoiceId}\nMonto: ${currency} ${amount.toFixed(2)}\nEstado: ${statusText}\n${invoiceUrl ? `Ver: ${invoiceUrl}` : ""}`
    });
}

// ============================================================================
// Workspace Invitation Emails
// ============================================================================

export function getWorkspaceInviteEmailHTML(options: {
    workspaceName: string;
    inviterName: string;
    roleName: string;
    magicLinkUrl: string;
    message?: string;
}): string {
    const { workspaceName, inviterName, roleName, magicLinkUrl, message } = options;
    const safeMessage = message ? message.replace(/</g, "&lt;").replace(/>/g, "&gt;") : "";

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 20px; }
        .container { max-width: 520px; margin: 0 auto; }
        .header { text-align: center; padding: 20px 0; }
        .content { background: #f8f9fa; padding: 28px; border-radius: 12px; }
        .button { display: block; background: #4f46e5; color: white !important; text-decoration: none; padding: 14px 28px; border-radius: 8px; text-align: center; font-weight: 600; margin: 20px 0; }
        .footer { text-align: center; color: #666; font-size: 12px; margin-top: 24px; }
        .tag { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 12px; background: #e5e7eb; }
        .note { font-size: 13px; color: #555; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2>Invitacion a ${APP_NAME}</h2>
        </div>
        <div class="content">
            <p><strong>${inviterName}</strong> te invito a unirte al espacio de trabajo <strong>${workspaceName}</strong>.</p>
            <p class="note">Rol asignado: <span class="tag">${roleName}</span></p>
            ${safeMessage ? `<p class="note">Mensaje: ${safeMessage}</p>` : ""}
            <a href="${magicLinkUrl}" class="button">Aceptar invitacion</a>
            <p class="note">Este enlace es valido por 15 minutos y solo puede usarse una vez.</p>
        </div>
        <div class="footer">
            <p>${APP_NAME} - ${APP_URL}</p>
        </div>
    </div>
</body>
</html>`;
}

export function getWorkspaceInviteEmailText(options: {
    workspaceName: string;
    inviterName: string;
    roleName: string;
    magicLinkUrl: string;
    message?: string;
}): string {
    const { workspaceName, inviterName, roleName, magicLinkUrl, message } = options;
    return `
Invitacion a ${APP_NAME}

${inviterName} te invito a unirte al espacio de trabajo ${workspaceName}.
Rol asignado: ${roleName}
${message ? `Mensaje: ${message}\n` : ""}Acepta la invitacion aqui:
${magicLinkUrl}

Este enlace es valido por 15 minutos y solo puede usarse una vez.

---
${APP_NAME} - ${APP_URL}
`;
}

export async function sendWorkspaceInviteEmail(
    to: string,
    options: {
        workspaceName: string;
        inviterName: string;
        roleName: string;
        magicLinkUrl: string;
        message?: string;
    }
): Promise<EmailResult> {
    return sendEmail({
        to,
        subject: `Invitacion a ${APP_NAME}`,
        html: getWorkspaceInviteEmailHTML(options),
        text: getWorkspaceInviteEmailText(options),
    });
}

export default {
    sendEmail,
    sendMagicLinkEmail,
    sendPaymentEmail,
    sendWorkspaceInviteEmail
};
