import { IliagptError } from "../errors";
import type { ServiceRegistry as IServiceRegistry } from "../types";

export class ServiceRegistry implements IServiceRegistry {
  private services = new Map<string, unknown>();
  private factories = new Map<string, () => unknown>();
  private singletons = new Set<string>();

  set<T>(key: string, value: T): void {
    this.services.set(key, value);
  }

  get<T>(key: string): T {
    if (this.services.has(key)) {
      return this.services.get(key) as T;
    }

    if (this.factories.has(key)) {
      const factory = this.factories.get(key)!;
      const instance = factory() as T;
      
      if (this.singletons.has(key)) {
        this.services.set(key, instance);
      }
      
      return instance;
    }

    throw new IliagptError("E_INTERNAL", `Service not registered: ${key}`, { service: key });
  }

  has(key: string): boolean {
    return this.services.has(key) || this.factories.has(key);
  }

  registerFactory<T>(key: string, factory: () => T, singleton: boolean = true): void {
    this.factories.set(key, factory);
    if (singleton) {
      this.singletons.add(key);
    }
  }

  remove(key: string): boolean {
    const hadService = this.services.delete(key);
    const hadFactory = this.factories.delete(key);
    this.singletons.delete(key);
    return hadService || hadFactory;
  }

  clear(): void {
    this.services.clear();
    this.factories.clear();
    this.singletons.clear();
  }

  listServices(): string[] {
    const serviceKeys = Array.from(this.services.keys());
    const factoryKeys = Array.from(this.factories.keys());
    return Array.from(new Set([...serviceKeys, ...factoryKeys]));
  }

  snapshot(): Record<string, { type: "instance" | "factory"; singleton: boolean }> {
    const result: Record<string, { type: "instance" | "factory"; singleton: boolean }> = {};
    
    for (const key of Array.from(this.services.keys())) {
      result[key] = { type: "instance", singleton: true };
    }
    
    for (const key of Array.from(this.factories.keys())) {
      if (!this.services.has(key)) {
        result[key] = { type: "factory", singleton: this.singletons.has(key) };
      }
    }
    
    return result;
  }
}

export const globalServiceRegistry = new ServiceRegistry();
