type MockReqOptions = {
  method?: string;
  path?: string;
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
  user?: { id?: string } & Record<string, unknown>;
};

export function createMockReq(options: MockReqOptions = {}) {
  return {
    method: options.method ?? "GET",
    path: options.path ?? "/",
    params: options.params ?? {},
    query: options.query ?? {},
    body: options.body ?? {},
    headers: options.headers ?? {},
    user: options.user,
    get(name: string) {
      return this.headers[name.toLowerCase()] ?? this.headers[name];
    },
  };
}

export function createMockRes() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    send(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
  };
}
