import type { ClientErrorLog } from "../domain/clientErrorLog";

export type ClientErrorLogStore = {
  append: (log: ClientErrorLog) => Promise<void>;
  all: () => Promise<readonly ClientErrorLog[]>;
  recent: (options: { limit: number; componentName?: string }) => Promise<readonly ClientErrorLog[]>;
};

