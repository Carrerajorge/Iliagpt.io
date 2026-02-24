/**
 * Advanced Analytics Endpoints
 * Deep analytics, cohorts, funnels
 */

import { Router } from "express";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { cache } from "../../services/cacheService";

export const advancedAnalyticsRouter = Router();

// GET /api/admin/analytics/cohorts - User cohort analysis
advancedAnalyticsRouter.get("/cohorts", async (req, res) => {
  try {
    const { period = "week" } = req.query;
    
    const cacheKey = `analytics:cohorts:${period}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    // Get user cohorts by registration week/month
    const periodFormat = period === "month" ? "YYYY-MM" : "YYYY-WW";
    
    const result = await db.execute(sql`
      WITH cohorts AS (
        SELECT 
          id,
          to_char(created_at, ${periodFormat}) as cohort,
          created_at
        FROM users
        WHERE created_at > NOW() - INTERVAL '6 months'
      ),
      activity AS (
        SELECT 
          user_id,
          to_char(created_at, ${periodFormat}) as activity_period
        FROM chats
        WHERE created_at > NOW() - INTERVAL '6 months'
        GROUP BY user_id, to_char(created_at, ${periodFormat})
      )
      SELECT 
        c.cohort,
        COUNT(DISTINCT c.id) as cohort_size,
        COUNT(DISTINCT a.user_id) as active_users,
        ROUND(COUNT(DISTINCT a.user_id)::numeric / NULLIF(COUNT(DISTINCT c.id), 0) * 100, 2) as retention_rate
      FROM cohorts c
      LEFT JOIN activity a ON c.id = a.user_id
      GROUP BY c.cohort
      ORDER BY c.cohort DESC
      LIMIT 24
    `);

    const data = { cohorts: result.rows || [], period };
    cache.set(cacheKey, data, 300000); // 5 min cache
    
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/analytics/funnel - Conversion funnel
advancedAnalyticsRouter.get("/funnel", async (req, res) => {
  try {
    const cached = cache.get("analytics:funnel");
    if (cached) return res.json(cached);

    // Calculate funnel stages
    const [
      visitorsResult,
      signupsResult,
      firstChatResult,
      multiChatResult,
      paidResult
    ] = await Promise.all([
      // Visitors (estimated from page views in last 30 days)
      db.execute(sql`
        SELECT COUNT(*) as count FROM audit_logs 
        WHERE action = 'page_view' AND created_at > NOW() - INTERVAL '30 days'
      `),
      // Signups
      db.execute(sql`
        SELECT COUNT(*) as count FROM users 
        WHERE created_at > NOW() - INTERVAL '30 days'
      `),
      // Users who created at least 1 chat
      db.execute(sql`
        SELECT COUNT(DISTINCT user_id) as count FROM chats 
        WHERE created_at > NOW() - INTERVAL '30 days'
      `),
      // Users who created 5+ chats
      db.execute(sql`
        SELECT COUNT(*) as count FROM (
          SELECT user_id FROM chats 
          WHERE created_at > NOW() - INTERVAL '30 days'
          GROUP BY user_id HAVING COUNT(*) >= 5
        ) engaged
      `),
      // Paid users
      db.execute(sql`
        SELECT COUNT(DISTINCT user_id) as count FROM payments 
        WHERE created_at > NOW() - INTERVAL '30 days' AND status = 'completed'
      `)
    ]);

    const funnel = [
      { stage: "Visitors", count: parseInt(visitorsResult.rows?.[0]?.count || "1000"), color: "#3b82f6" },
      { stage: "Signups", count: parseInt(signupsResult.rows?.[0]?.count || "0"), color: "#8b5cf6" },
      { stage: "First Chat", count: parseInt(firstChatResult.rows?.[0]?.count || "0"), color: "#10b981" },
      { stage: "Engaged (5+ chats)", count: parseInt(multiChatResult.rows?.[0]?.count || "0"), color: "#f59e0b" },
      { stage: "Paid", count: parseInt(paidResult.rows?.[0]?.count || "0"), color: "#ef4444" }
    ];

    // Calculate conversion rates
    for (let i = 1; i < funnel.length; i++) {
      const prev = funnel[i - 1].count;
      const current = funnel[i].count;
      (funnel[i] as any).conversionRate = prev > 0 ? ((current / prev) * 100).toFixed(1) : "0";
    }

    cache.set("analytics:funnel", funnel, 300000);
    res.json(funnel);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/analytics/heatmap - Usage heatmap by hour/day
advancedAnalyticsRouter.get("/heatmap", async (req, res) => {
  try {
    const cached = cache.get("analytics:heatmap");
    if (cached) return res.json(cached);

    const result = await db.execute(sql`
      SELECT 
        EXTRACT(DOW FROM created_at) as day_of_week,
        EXTRACT(HOUR FROM created_at) as hour,
        COUNT(*) as activity_count
      FROM chats
      WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY EXTRACT(DOW FROM created_at), EXTRACT(HOUR FROM created_at)
      ORDER BY day_of_week, hour
    `);

    // Transform to heatmap format
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const heatmap: { day: string; hour: number; value: number }[] = [];

    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        const match = result.rows?.find((r: any) => 
          parseInt(r.day_of_week) === d && parseInt(r.hour) === h
        );
        heatmap.push({
          day: days[d],
          hour: h,
          value: parseInt(match?.activity_count || "0")
        });
      }
    }

    cache.set("analytics:heatmap", heatmap, 300000);
    res.json(heatmap);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/analytics/user-journey - User journey analysis
advancedAnalyticsRouter.get("/user-journey", async (req, res) => {
  try {
    const result = await db.execute(sql`
      WITH user_metrics AS (
        SELECT 
          u.id,
          u.created_at as signup_date,
          u.plan,
          COUNT(DISTINCT c.id) as total_chats,
          COUNT(DISTINCT DATE(c.created_at)) as active_days,
          MAX(c.created_at) as last_activity,
          MIN(c.created_at) as first_chat_date
        FROM users u
        LEFT JOIN chats c ON u.id = c.user_id
        WHERE u.created_at > NOW() - INTERVAL '90 days'
        GROUP BY u.id, u.created_at, u.plan
      )
      SELECT 
        plan,
        COUNT(*) as users,
        AVG(total_chats)::integer as avg_chats,
        AVG(active_days)::integer as avg_active_days,
        AVG(EXTRACT(EPOCH FROM (first_chat_date - signup_date)) / 3600)::integer as avg_hours_to_first_chat
      FROM user_metrics
      GROUP BY plan
    `);

    res.json(result.rows || []);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/analytics/revenue - Revenue analytics
advancedAnalyticsRouter.get("/revenue", async (req, res) => {
  try {
    const { period = "30d" } = req.query;
    // Map period to number of days (strictly validated — no sql.raw)
    const daysMap: Record<string, number> = {
      "7d": 7,
      "30d": 30,
      "90d": 90,
      "1y": 365,
    };
    const days = daysMap[period as string] || 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [totals, daily, byPlan] = await Promise.all([
      // Total revenue — parameterised
      db.execute(sql`
        SELECT
          SUM(amount::numeric) as total_revenue,
          COUNT(*) as total_transactions,
          AVG(amount::numeric) as avg_transaction
        FROM payments
        WHERE status = 'completed' AND created_at > ${since}
      `),
      // Daily revenue — parameterised
      db.execute(sql`
        SELECT
          DATE(created_at) as date,
          SUM(amount::numeric) as revenue,
          COUNT(*) as transactions
        FROM payments
        WHERE status = 'completed' AND created_at > ${since}
        GROUP BY DATE(created_at)
        ORDER BY date
      `),
      // Revenue by plan — parameterised
      db.execute(sql`
        SELECT
          COALESCE(description, 'unknown') as plan,
          SUM(amount::numeric) as revenue,
          COUNT(*) as transactions
        FROM payments
        WHERE status = 'completed' AND created_at > ${since}
        GROUP BY description
      `),
    ]);

    res.json({
      summary: totals.rows?.[0] || { total_revenue: 0, total_transactions: 0, avg_transaction: 0 },
      daily: daily.rows || [],
      byPlan: byPlan.rows || [],
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to fetch revenue analytics" });
  }
});

// GET /api/admin/analytics/ai-usage - AI model usage analytics
advancedAnalyticsRouter.get("/ai-usage", async (req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT 
        ai_model_used as model,
        COUNT(*) as chat_count,
        SUM(tokens_used) as total_tokens,
        AVG(tokens_used)::integer as avg_tokens_per_chat,
        COUNT(DISTINCT user_id) as unique_users
      FROM chats
      WHERE created_at > NOW() - INTERVAL '30 days'
      AND ai_model_used IS NOT NULL
      GROUP BY ai_model_used
      ORDER BY chat_count DESC
    `);

    res.json(result.rows || []);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/analytics/engagement - Engagement metrics
advancedAnalyticsRouter.get("/engagement", async (req, res) => {
  try {
    const [dau, wau, mau, avgSession] = await Promise.all([
      // Daily Active Users
      db.execute(sql`
        SELECT COUNT(DISTINCT user_id) as count FROM chats 
        WHERE created_at > NOW() - INTERVAL '1 day'
      `),
      // Weekly Active Users
      db.execute(sql`
        SELECT COUNT(DISTINCT user_id) as count FROM chats 
        WHERE created_at > NOW() - INTERVAL '7 days'
      `),
      // Monthly Active Users
      db.execute(sql`
        SELECT COUNT(DISTINCT user_id) as count FROM chats 
        WHERE created_at > NOW() - INTERVAL '30 days'
      `),
      // Average messages per session
      db.execute(sql`
        SELECT AVG(message_count)::integer as avg FROM chats 
        WHERE created_at > NOW() - INTERVAL '30 days' AND message_count > 0
      `)
    ]);

    const dauCount = parseInt(dau.rows?.[0]?.count || "0");
    const wauCount = parseInt(wau.rows?.[0]?.count || "0");
    const mauCount = parseInt(mau.rows?.[0]?.count || "0");

    res.json({
      dau: dauCount,
      wau: wauCount,
      mau: mauCount,
      dauWauRatio: wauCount > 0 ? ((dauCount / wauCount) * 100).toFixed(1) : 0,
      wauMauRatio: mauCount > 0 ? ((wauCount / mauCount) * 100).toFixed(1) : 0,
      avgMessagesPerChat: avgSession.rows?.[0]?.avg || 0
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
