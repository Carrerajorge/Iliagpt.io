import { customType } from "drizzle-orm/pg-core";

export const vector = customType<{ data: number[]; driverData: string }>({
    dataType() {
        return "vector(1536)";
    },
    toDriver(value: number[]): string {
        return `[${value.join(",")}]`;
    },
    fromDriver(value: string): number[] {
        return value.slice(1, -1).split(",").map(Number);
    },
});
