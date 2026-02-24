import "../config/load-env";
import { storage } from "../storage";
import { setupFts } from "../lib/fts";
import { db } from "../db";
import { users, chats, chatMessages } from "../../shared/schema";
import { eq } from "drizzle-orm";
import { Logger } from "../lib/logger";

async function runTest() {
    Logger.info("Starting Search Verification Test...");

    // Ensure FTS is set up
    await setupFts();

    // Create test user
    const uniqueId = Date.now().toString();
    const username = `test_user_${uniqueId}`;
    const [user] = await db.insert(users).values({
        username,
        password: "hashed_password",
        role: "user"
    }).returning();

    Logger.info(`Created test user: ${user.id}`);

    // Create test chat
    const [chat] = await db.insert(chats).values({
        userId: user.id,
        title: "Search Test Chat"
    }).returning();

    Logger.info(`Created test chat: ${chat.id}`);

    // Create test message with unique searchable content
    const uniqueKeyword = `AntigravitySearchToken${uniqueId}`;
    const content = `This is a test message containing the secret token: ${uniqueKeyword}. It should be found by FTS.`;

    await db.insert(chatMessages).values({
        chatId: chat.id,
        role: "user",
        content: content,
        status: "done"
    });

    Logger.info(`Inserted message with token: ${uniqueKeyword}`);

    // Allow FTS usage (no delay needed usually for pg triggers, but just in case)
    // await new Promise(r => setTimeout(r, 100));

    // Perform Search
    Logger.info("Executing search...");
    const results = await storage.searchMessages(user.id, uniqueKeyword);

    if (results.length > 0 && results[0].content.includes(uniqueKeyword)) {
        Logger.info("✅ SUCCESS: Found message using FTS search logic.");
        console.log("Search Result:", results[0]);
    } else {
        Logger.error("❌ FAILURE: Search did not return the expected message.");
        console.log("Results found:", results.length);
    }

    // Cleanup
    Logger.info("Cleaning up...");
    await db.delete(chatMessages).where(eq(chatMessages.chatId, chat.id));
    await db.delete(chats).where(eq(chats.id, chat.id));
    await db.delete(users).where(eq(users.id, user.id));

    process.exit(0);
}

runTest().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
