import { getStripeClient } from "../stripeClient";
import {
  getStripeCustomerIdFromInvoice,
  resolveUserIdFromStripeCustomerId,
  upsertPaymentFromStripeInvoice,
} from "./paymentIngestionService";

export type StripePaymentsSyncProgress = {
  fetched: number;
  paid: number;
  synced: number;
  created: number;
  updated: number;
  matchedUsers: number;
  unmatchedUsers: number;
  errors: number;
  cursor: string | null;
  maxInvoices: number;
};

export type StripePaymentsSyncResult = {
  success: true;
  window: {
    dateFrom: string;
    dateTo: string;
  };
  fetched: number;
  paid: number;
  synced: number;
  created: number;
  updated: number;
  matchedUsers: number;
  unmatchedUsers: number;
  errors: number;
  unmatchedInvoiceIds: string[];
  hasMore: boolean;
  nextCursor: string | null;
};

export async function syncStripePaidInvoicesToPayments(params: {
  maxInvoices: number;
  startingAfter?: string;
  fromDate: Date;
  toDate: Date;
  onProgress?: (p: StripePaymentsSyncProgress) => void | Promise<void>;
}): Promise<StripePaymentsSyncResult> {
  const maxInvoices = Math.min(2000, Math.max(1, Number(params.maxInvoices) || 200));
  const startingAfter = typeof params.startingAfter === "string" && params.startingAfter.trim()
    ? params.startingAfter.trim()
    : undefined;

  const fromDate = params.fromDate;
  const toDate = params.toDate;
  if (fromDate > toDate) {
    throw new Error("`dateFrom` must be before `dateTo`");
  }

  const createdFilter = {
    gte: Math.floor(fromDate.getTime() / 1000),
    lte: Math.floor(toDate.getTime() / 1000),
  };

  const stripe = getStripeClient();

  const userCache = new Map<string, string | null>();

  let fetched = 0;
  let paid = 0;
  let synced = 0;
  let created = 0;
  let updated = 0;
  let matchedUsers = 0;
  let unmatchedUsers = 0;
  let errors = 0;
  const unmatchedInvoiceIds: string[] = [];

  let cursor: string | undefined = startingAfter;
  let stripeHasMore = false;
  let brokeEarly = false;

  const emitProgress = async () => {
    if (!params.onProgress) return;
    await params.onProgress({
      fetched,
      paid,
      synced,
      created,
      updated,
      matchedUsers,
      unmatchedUsers,
      errors,
      cursor: cursor || null,
      maxInvoices,
    });
  };

  while (synced < maxInvoices) {
    const pageLimit = Math.min(100, maxInvoices - synced);

    let result: any;
    try {
      result = await stripe.invoices.list({
        limit: pageLimit,
        ...(cursor ? { starting_after: cursor } : {}),
        created: createdFilter,
        status: "paid",
      } as any);
    } catch {
      // Fallback for API versions that don't accept `status` as list param.
      result = await stripe.invoices.list({
        limit: pageLimit,
        ...(cursor ? { starting_after: cursor } : {}),
        created: createdFilter,
      } as any);
    }

    const invoices = (result?.data || []) as any[];
    fetched += invoices.length;
    stripeHasMore = !!result?.has_more;

    if (invoices.length === 0) {
      stripeHasMore = false;
      break;
    }

    let lastInvoiceId: string | undefined;

    for (let i = 0; i < invoices.length; i += 1) {
      const invoice = invoices[i];
      if (typeof invoice?.id === "string") lastInvoiceId = invoice.id;

      const isPaid = invoice?.status === "paid" || invoice?.paid === true;
      if (!isPaid) continue;

      paid += 1;

      const metadataUserId = typeof invoice?.metadata?.userId === "string" ? invoice.metadata.userId : null;
      const stripeCustomerId = getStripeCustomerIdFromInvoice(invoice);

      let userId: string | null = metadataUserId;
      if (!userId) {
        if (stripeCustomerId && userCache.has(stripeCustomerId)) {
          userId = userCache.get(stripeCustomerId)!;
        } else {
          userId = await resolveUserIdFromStripeCustomerId(stripeCustomerId);
          if (stripeCustomerId) userCache.set(stripeCustomerId, userId);
        }
      }

      if (userId) {
        matchedUsers += 1;
      } else {
        unmatchedUsers += 1;
        if (typeof invoice?.id === "string" && unmatchedInvoiceIds.length < 25) {
          unmatchedInvoiceIds.push(invoice.id);
        }
      }

      try {
        const r = await upsertPaymentFromStripeInvoice({
          invoice,
          status: "completed",
          userId,
          plan: null,
        });
        synced += 1;
        if (r.created) created += 1;
        else updated += 1;
      } catch {
        errors += 1;
      }

      if (synced >= maxInvoices) {
        if (i < invoices.length - 1) {
          brokeEarly = true;
        }
        break;
      }
    }

    if (lastInvoiceId) cursor = lastInvoiceId;

    await emitProgress();

    if (synced >= maxInvoices) break;
    if (!stripeHasMore || !cursor) break;
  }

  const hasMore = (stripeHasMore || brokeEarly) && !!cursor;
  const nextCursor = hasMore && cursor ? cursor : null;

  return {
    success: true,
    window: {
      dateFrom: fromDate.toISOString(),
      dateTo: toDate.toISOString(),
    },
    fetched,
    paid,
    synced,
    created,
    updated,
    matchedUsers,
    unmatchedUsers,
    errors,
    unmatchedInvoiceIds,
    hasMore,
    nextCursor,
  };
}

