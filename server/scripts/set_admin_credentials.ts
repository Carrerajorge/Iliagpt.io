import { db } from "../db";
import { users } from "../../shared/schema";
import { hashPassword } from "../utils/password";
import { eq } from "drizzle-orm";

async function setAdminCredentials() {
    const email = "carrerajorge874@gmail.com";
    const passwordPlain = "202212";
    const hashedPassword = await hashPassword(passwordPlain);

    console.log(`Setting admin credentials for ${email}...`);

    try {
        const [existingUser] = await db
            .select()
            .from(users)
            .where(eq(users.email, email));

        if (existingUser) {
            console.log("User exists. Updating password and role...");
            await db
                .update(users)
                .set({
                    password: hashedPassword,
                    role: "admin",
                })
                .where(eq(users.id, existingUser.id));
            console.log("User updated successfully.");
        } else {
            console.log("User does not exist. Creating new admin user...");
            await db.insert(users).values({
                email,
                password: hashedPassword,
                username: email.split("@")[0],
                role: "admin",
                status: "active",
                authProvider: "email",
            });
            console.log("User created successfully.");
        }
    } catch (error) {
        console.error("Database operation failed:", error);
        process.exit(1);
    }

    // Allow some time for db operations to flush if needed, though await should suffice.
    console.log("Done.");
    process.exit(0);
}

setAdminCredentials().catch((err) => {
    console.error("Error setting admin credentials:", err);
    process.exit(1);
});
