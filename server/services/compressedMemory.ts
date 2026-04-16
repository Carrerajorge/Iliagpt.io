import crypto from 'crypto';

export interface Atom {
  id: string;
  type: 'intent' | 'pattern' | 'correction' | 'preference' | 'outcome';
  signature: string;
  weight: number;
  decayRate: number;
  createdAt: number;
  lastActive: number;
  data: any;
}

export class CompressedMemory {
  private atoms: Map<string, Atom> = new Map();
  private readonly maxSize = 100000;
  private readonly defaultDecayRate = 0.95;

  createAtom(type: Atom['type'], data: any): Atom {
    const id = crypto.randomUUID().slice(0, 16);
    const signature = this.computeSignature(data);
    
    const existing = this.findBySignature(signature);
    if (existing) {
      existing.weight += 1;
      existing.lastActive = Date.now();
      return existing;
    }

    const atom: Atom = {
      id,
      type,
      signature,
      weight: 1,
      decayRate: this.defaultDecayRate,
      createdAt: Date.now(),
      lastActive: Date.now(),
      data
    };

    this.atoms.set(id, atom);
    this.enforceMaxSize();
    return atom;
  }

  getAtom(id: string): Atom | undefined {
    const atom = this.atoms.get(id);
    if (atom) {
      atom.lastActive = Date.now();
    }
    return atom;
  }

  findBySignature(signature: string): Atom | undefined {
    for (const atom of this.atoms.values()) {
      if (atom.signature === signature) return atom;
    }
    return undefined;
  }

  findByType(type: Atom['type']): Atom[] {
    return Array.from(this.atoms.values()).filter(a => a.type === type);
  }

  applyDecay(): number {
    let decayedCount = 0;
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;

    for (const [id, atom] of this.atoms) {
      const hoursSinceActive = (now - atom.lastActive) / hourMs;
      if (hoursSinceActive > 1) {
        atom.weight *= Math.pow(atom.decayRate, hoursSinceActive);
        decayedCount++;
      }
    }
    return decayedCount;
  }

  garbageCollect(minWeight: number = 0.1): number {
    let removed = 0;
    for (const [id, atom] of this.atoms) {
      if (atom.weight < minWeight) {
        this.atoms.delete(id);
        removed++;
      }
    }
    return removed;
  }

  getStats(): { totalAtoms: number; storageBytes: number; avgWeight: number; byType: Record<string, number> } {
    const atoms = Array.from(this.atoms.values());
    const totalWeight = atoms.reduce((sum, a) => sum + a.weight, 0);
    const byType: Record<string, number> = {};
    atoms.forEach(a => { byType[a.type] = (byType[a.type] || 0) + 1; });

    return {
      totalAtoms: atoms.length,
      storageBytes: JSON.stringify(atoms).length,
      avgWeight: atoms.length > 0 ? totalWeight / atoms.length : 0,
      byType
    };
  }

  private computeSignature(data: any): string {
    const json = JSON.stringify(data);
    return crypto.createHash('md5').update(json).digest('hex').slice(0, 16);
  }

  private enforceMaxSize(): void {
    if (this.atoms.size > this.maxSize) {
      const sorted = Array.from(this.atoms.entries())
        .sort((a, b) => a[1].weight - b[1].weight);
      const toRemove = sorted.slice(0, this.atoms.size - this.maxSize + 1000);
      toRemove.forEach(([id]) => this.atoms.delete(id));
    }
  }
}

export const compressedMemory = new CompressedMemory();
