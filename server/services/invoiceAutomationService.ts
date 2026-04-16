import { db } from "../db";
import { invoices, notificationLogs, payments, users } from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";

import { sendPaymentEmail } from "./genericEmailService";
import { formatStripeAmountToMajorUnit } from "./paymentIngestionService";

type StripeInvoiceLite = {
  id: string;
  number?: string | null;
  subscription?: string | null;
  currency?: string | null;
  amount_paid?: number | null;
  amount_due?: number | null;
  paid?: boolean | null;
  status?: string | null;
  due_date?: number | null;
  created?: number | null;
  status_transitions?: { paid_at?: number | null } | null;
  hosted_invoice_url?: string | null;
  invoice_pdf?: string | null;
  customer_email?: string | null;
};

export type InvoiceEmailSendOutcome =
  | { status: "skipped"; reason: string }
  | { status: "sent"; messageId?: string }
  | { status: "failed"; error: string; retryCount: number; maxRetries: number };

export function getInvoiceEmailEventId(params: { userId: string; invoiceNumber: string }): string {
  const userId = String(params.userId || "").trim();
  const invoiceNumber = String(params.invoiceNumber || "").trim();
  return `invoice_email:${userId}:${invoiceNumber}`;
}

export async function recordStripeInvoicePaymentSucceeded(params: {
  userId: string;
  userEmail?: string | null;
  stripeInvoice: StripeInvoiceLite;
}): Promise<void> {
  const { userId, userEmail, stripeInvoice } = params;

  if (!userId) return;
  if (!stripeInvoice?.id) return;

  const invoiceNumber = String(stripeInvoice.number || stripeInvoice.id).trim();
  const currencyRaw = String(stripeInvoice.currency || "eur").trim();
  const currency = normalizeCurrency(currencyRaw);
  const amountMinor = pickAmountPaidMinor(stripeInvoice);
  const amount = formatStripeAmountToMajorUnit(amountMinor, currencyRaw);

  const paymentId = await findPaymentIdByStripeInvoiceId(stripeInvoice.id);

  const paidAt =
    unixSecondsToDate(stripeInvoice.status_transitions?.paid_at) ||
    unixSecondsToDate(stripeInvoice.created) ||
    new Date();
  const dueDate = unixSecondsToDate(stripeInvoice.due_date);
  const pdfPath = stripeInvoice.invoice_pdf || stripeInvoice.hosted_invoice_url || null;
  const createdAt = unixSecondsToDate(stripeInvoice.created) || new Date();

  await upsertInvoiceFromStripeInvoice({
    userId,
    paymentId,
    invoiceNumber,
    amount,
    amountMinor,
    currency,
    paidAt,
    dueDate,
    pdfPath,
    stripeInvoiceId: stripeInvoice.id,
    stripeHostedInvoiceUrl: stripeInvoice.hosted_invoice_url || null,
    stripeInvoicePdfUrl: stripeInvoice.invoice_pdf || null,
    createdAt,
  });

  const recipientEmail = await resolveRecipientEmail({
    userId,
    explicitEmail: userEmail,
    stripeInvoice,
  });
  if (!recipientEmail) return;

  const invoiceUrl = stripeInvoice.hosted_invoice_url || stripeInvoice.invoice_pdf || undefined;

  const eventId = getInvoiceEmailEventId({ userId, invoiceNumber });

  const outcome = await sendInvoiceEmailIdempotent({
    eventId,
    userId,
    to: recipientEmail,
    invoiceIdForDisplay: invoiceNumber,
    amount,
    currency,
    status: "paid",
    invoiceUrl,
  });

  // Make Stripe retry the webhook so we can try again on transient email failures.
  if (outcome.status === "failed" && outcome.retryCount < outcome.maxRetries) {
    throw new Error(outcome.error);
  }
}

export async function sendInvoiceEmailIdempotent(params: {
  eventId: string;
  userId: string;
  to: string;
  invoiceIdForDisplay: string;
  amount: string;
  currency: string;
  status: "paid" | "pending" | "failed";
  invoiceUrl?: string;
}): Promise<InvoiceEmailSendOutcome> {
  const { eventId, userId, to, invoiceIdForDisplay, amount, currency, status, invoiceUrl } = params;

  const maxRetries = 3;
  const pendingStaleMs = 10 * 60 * 1000;

  const payload = {
    to,
    invoiceId: invoiceIdForDisplay,
    amount,
    currency,
    status,
    invoiceUrl: invoiceUrl || null,
  };

  const decision = await db.transaction(async (tx) => {
    const now = new Date();

    const [inserted] = await tx
      .insert(notificationLogs)
      .values({
        eventId,
        userId,
        eventTypeId: "invoice.sent",
        channel: "email",
        status: "pending",
        providerResponse: { payload },
        createdAt: now,
      })
      .onConflictDoNothing({
        target: [notificationLogs.eventId, notificationLogs.channel],
      })
      .returning();

    if (inserted) {
      return { shouldSend: true as const, logId: inserted.id, retryCount: 0 };
    }

    const [existing] = await tx
      .select()
      .from(notificationLogs)
      .where(and(eq(notificationLogs.eventId, eventId), eq(notificationLogs.channel, "email")))
      .for("update");

    if (!existing) {
      // Extremely unlikely: conflict occurred but row isn't visible. Skip sending.
      return { shouldSend: false as const, logId: "", retryCount: 0, reason: "missing_log_row" as const };
    }

    const existingStatus = String(existing.status || "").toLowerCase().trim();
    const retries = existing.retryCount || 0;

    if (existingStatus === "sent" || existingStatus === "delivered") {
      return { shouldSend: false as const, logId: existing.id, retryCount: retries, reason: "already_sent" as const };
    }

    if (existingStatus === "pending") {
      const createdAtMs = existing.createdAt ? new Date(existing.createdAt).getTime() : 0;
      const isStale = createdAtMs > 0 && Date.now() - createdAtMs > pendingStaleMs;
      if (!isStale) {
        return { shouldSend: false as const, logId: existing.id, retryCount: retries, reason: "in_flight" as const };
      }
    }

    if (retries >= maxRetries) {
      return { shouldSend: false as const, logId: existing.id, retryCount: retries, reason: "max_retries" as const };
    }

    await tx
      .update(notificationLogs)
      .set({
        status: "pending",
        errorMessage: null,
        providerResponse: sql`jsonb_set(COALESCE(${notificationLogs.providerResponse}, '{}'::jsonb), '{payload}', ${JSON.stringify(payload)}::jsonb, true)`,
      })
      .where(eq(notificationLogs.id, existing.id));

    return { shouldSend: true as const, logId: existing.id, retryCount: retries };
  });

  if (!decision.shouldSend) {
    return { status: "skipped", reason: (decision as any).reason || "already_sent_or_in_flight" };
  }

  const emailResult = await sendPaymentEmail(to, {
    invoiceId: invoiceIdForDisplay,
    amount,
    currency,
    status,
    invoiceUrl,
  });

  if (emailResult.success) {
    await db
      .update(notificationLogs)
      .set({
        status: "sent",
        providerResponse: { payload, messageId: emailResult.messageId },
        errorMessage: null,
        sentAt: new Date(),
      })
      .where(eq(notificationLogs.id, decision.logId));

    return { status: "sent", messageId: emailResult.messageId };
  }

  const errorMessage = emailResult.error || "Failed to send invoice email";

  await db
    .update(notificationLogs)
    .set({
      status: "failed",
      errorMessage,
      providerResponse: { payload, error: errorMessage },
      retryCount: sql<number>`COALESCE(${notificationLogs.retryCount}, 0) + 1`,
    })
    .where(eq(notificationLogs.id, decision.logId));

  return {
    status: "failed",
    error: errorMessage,
    retryCount: (decision.retryCount || 0) + 1,
    maxRetries,
  };
}

async function findPaymentIdByStripeInvoiceId(stripeInvoiceId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(eq(payments.stripePaymentId, stripeInvoiceId))
    .limit(1);

  return row?.id || null;
}

async function upsertInvoiceFromStripeInvoice(params: {
  userId: string;
  paymentId: string | null;
  invoiceNumber: string;
  amount: string;
  amountMinor: number;
  currency: string;
  paidAt: Date;
  dueDate: Date | null;
  pdfPath: string | null;
  stripeInvoiceId: string;
  stripeHostedInvoiceUrl: string | null;
  stripeInvoicePdfUrl: string | null;
  createdAt: Date;
}): Promise<void> {
  const { userId, paymentId, invoiceNumber, amount, amountMinor, currency, paidAt, dueDate, pdfPath, stripeInvoiceId, stripeHostedInvoiceUrl, stripeInvoicePdfUrl, createdAt } = params;

  const values = {
    userId,
    paymentId,
    source: "stripe",
    invoiceNumber,
    amount,
    amountValue: amount,
    amountMinor,
    currency,
    status: "paid",
    dueDate,
    paidAt,
    pdfPath,
    stripeInvoiceId,
    stripeHostedInvoiceUrl,
    stripeInvoicePdfUrl,
    createdAt,
  } as const;

  try {
    await db
      .insert(invoices)
      .values(values)
      .onConflictDoUpdate({
        target: [invoices.userId, invoices.invoiceNumber],
        set: {
          paymentId,
          amount,
          amountValue: amount,
          amountMinor,
          currency,
          status: "paid",
          dueDate,
          paidAt,
          pdfPath,
          stripeInvoiceId,
          stripeHostedInvoiceUrl,
          stripeInvoicePdfUrl,
        },
      });
    return;
  } catch (error) {
    // Fallback if the unique index is missing or conflict target isn't available.
    const [existing] = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.userId, userId), eq(invoices.invoiceNumber, invoiceNumber)))
      .limit(1);

    if (existing) {
      await db
        .update(invoices)
        .set({
          paymentId,
          amount,
          amountValue: amount,
          amountMinor,
          currency,
          status: "paid",
          dueDate,
          paidAt,
          pdfPath,
          stripeInvoiceId,
          stripeHostedInvoiceUrl,
          stripeInvoicePdfUrl,
        })
        .where(eq(invoices.id, existing.id));
      return;
    }

    await db.insert(invoices).values(values);
  }
}

async function resolveRecipientEmail(params: {
  userId: string;
  explicitEmail?: string | null;
  stripeInvoice: StripeInvoiceLite;
}): Promise<string | null> {
  const { userId, explicitEmail, stripeInvoice } = params;

  const byParams = String(explicitEmail || stripeInvoice.customer_email || "").trim();
  if (byParams) return byParams;

  const [row] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const email = String(row?.email || "").trim();
  return email || null;
}

function normalizeCurrency(currency: string | null | undefined): string {
  const cur = String(currency || "EUR").trim();
  return cur ? cur.toUpperCase() : "EUR";
}

function pickAmountPaidMinor(invoice: StripeInvoiceLite): number {
  const paid = invoice.amount_paid;
  if (typeof paid === "number" && Number.isFinite(paid)) return paid;

  const due = invoice.amount_due;
  if (typeof due === "number" && Number.isFinite(due)) return due;

  return 0;
}

function unixSecondsToDate(unixSeconds: number | null | undefined): Date | null {
  if (typeof unixSeconds !== "number" || !Number.isFinite(unixSeconds) || unixSeconds <= 0) return null;
  return new Date(unixSeconds * 1000);
}
