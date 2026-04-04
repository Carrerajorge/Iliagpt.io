// ─── CRDT Collaborative Document ──────────────────────────────────────────────
//
// Implements a simplified Logoot / sequence CRDT for collaborative text editing.
// Each character is identified by a globally unique ID so concurrent insertions
// and deletions can be merged idempotently without operational transform.

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CRDTCharacter {
  /** Globally unique identifier: `${userId}_${clock}_${counter}` */
  id: string;
  char: string;
  deleted: boolean;
  /** Lamport-style logical clock at insert time */
  clock: number;
  userId: string;
}

export interface CRDTOperation {
  type: 'INSERT' | 'DELETE';
  character: CRDTCharacter;
  /** Position in the visible (non-deleted) sequence where this char is inserted.
   *  Ignored for DELETE (we find by id). */
  position?: number;
}

export interface SerializedCRDTDocument {
  characters: CRDTCharacter[];
  clock: number;
}

// ─── ID counter (per-session) ─────────────────────────────────────────────────

let localCounter = 0;

function nextCounter(): number {
  return ++localCounter;
}

function generateId(userId: string, clock: number): string {
  return `${userId}_${clock}_${nextCounter()}`;
}

// ─── CRDTDocument ─────────────────────────────────────────────────────────────

export class CRDTDocument {
  /** All characters including deleted (tombstones) in document order */
  private chars: CRDTCharacter[] = [];

  /** Fast lookup by ID */
  private idIndex = new Map<string, number>(); // id → index in this.chars

  /** Logical clock (incremented on every local op) */
  private clock = 0;

  /** Local userId – used when creating operations */
  private localUserId: string;

  constructor(localUserId: string) {
    this.localUserId = localUserId;
  }

  // ─── Local Operations ────────────────────────────────────────────────────

  /**
   * Insert a character at the given visible position (0 = before first char).
   * Returns the operation that should be broadcast to peers.
   */
  insert(position: number, char: string): CRDTOperation {
    this.clock++;
    const character: CRDTCharacter = {
      id: generateId(this.localUserId, this.clock),
      char,
      deleted: false,
      clock: this.clock,
      userId: this.localUserId,
    };

    const rawIndex = this.visibleIndexToRaw(position);
    this.chars.splice(rawIndex, 0, character);
    this.rebuildIndex();

    return { type: 'INSERT', character, position };
  }

  /**
   * Delete the character at the given visible position.
   * Returns the operation to broadcast.
   */
  delete(position: number): CRDTOperation | null {
    const rawIndex = this.visibleIndexToRaw(position);
    if (rawIndex === -1 || rawIndex >= this.chars.length) return null;

    this.clock++;
    const character = this.chars[rawIndex];
    const tombstone: CRDTCharacter = {
      ...character,
      deleted: true,
      clock: this.clock,
    };
    this.chars[rawIndex] = tombstone;
    this.idIndex.set(tombstone.id, rawIndex);

    return { type: 'DELETE', character: tombstone };
  }

  // ─── Remote Operation Merge ───────────────────────────────────────────────

  /**
   * Idempotently apply a remote operation.
   * - INSERT: inserted if not already present; ignored if id already exists.
   * - DELETE: tombstones the character; ignored if already deleted.
   */
  merge(op: CRDTOperation): void {
    // Advance clock past remote clock
    if (op.character.clock > this.clock) {
      this.clock = op.character.clock;
    }

    if (op.type === 'INSERT') {
      this.mergeInsert(op);
    } else {
      this.mergeDelete(op);
    }
  }

  private mergeInsert(op: CRDTOperation): void {
    const { character } = op;

    // Idempotency: ignore if already present
    if (this.idIndex.has(character.id)) return;

    // Find insertion point: we use clock + userId to break ties deterministically
    // (higher clock = comes later; same clock: compare userId lexicographically)
    const insertAt = this.findInsertionIndex(character, op.position ?? 0);
    this.chars.splice(insertAt, 0, { ...character, deleted: false });
    this.rebuildIndex();
  }

  private mergeDelete(op: CRDTOperation): void {
    const { character } = op;
    const rawIdx = this.idIndex.get(character.id);
    if (rawIdx === undefined) {
      // Not found yet – store as a pending tombstone and insert it
      this.chars.push({ ...character, deleted: true });
      this.rebuildIndex();
      return;
    }
    if (this.chars[rawIdx].deleted) return; // Already deleted
    this.chars[rawIdx] = { ...this.chars[rawIdx], deleted: true };
  }

  /**
   * Determine where to splice a remote character.
   * We find the first existing character whose sort key is greater than
   * the incoming character's sort key.
   *
   * Sort key: (clock ASC, userId DESC) – gives a stable total order.
   */
  private findInsertionIndex(
    incoming: CRDTCharacter,
    hintPosition: number,
  ): number {
    // Start from the hinted visible position, but search from the corresponding raw index
    const startRaw = Math.min(
      this.visibleIndexToRaw(hintPosition),
      this.chars.length,
    );

    // Scan forward from hint
    for (let i = startRaw; i < this.chars.length; i++) {
      if (this.compareKeys(incoming, this.chars[i]) < 0) return i;
    }

    // Scan backward from hint if forward scan found nothing better
    for (let i = startRaw - 1; i >= 0; i--) {
      if (this.compareKeys(incoming, this.chars[i]) >= 0) return i + 1;
    }

    return this.chars.length;
  }

  private compareKeys(a: CRDTCharacter, b: CRDTCharacter): number {
    if (a.clock !== b.clock) return a.clock - b.clock;
    // Same clock: break tie by userId (lexicographic)
    return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
  }

  // ─── Utility ─────────────────────────────────────────────────────────────

  /** Convert a visible (non-deleted) position to raw array index. */
  private visibleIndexToRaw(visiblePos: number): number {
    let count = 0;
    for (let i = 0; i < this.chars.length; i++) {
      if (!this.chars[i].deleted) {
        if (count === visiblePos) return i;
        count++;
      }
    }
    // Position is past end – return length (append)
    return this.chars.length;
  }

  private rebuildIndex(): void {
    this.idIndex.clear();
    for (let i = 0; i < this.chars.length; i++) {
      this.idIndex.set(this.chars[i].id, i);
    }
  }

  // ─── Public Accessors ────────────────────────────────────────────────────

  toText(): string {
    return this.chars
      .filter((c) => !c.deleted)
      .map((c) => c.char)
      .join('');
  }

  length(): number {
    return this.chars.filter((c) => !c.deleted).length;
  }

  /**
   * Initialise a document from existing plain text.
   * Each character is assigned a sequential ID as if the local user wrote it.
   */
  static fromText(text: string, userId: string): CRDTDocument {
    const doc = new CRDTDocument(userId);
    for (let i = 0; i < text.length; i++) {
      doc.insert(i, text[i]);
    }
    return doc;
  }

  // ─── Serialization ───────────────────────────────────────────────────────

  serialize(): SerializedCRDTDocument {
    return {
      characters: this.chars.map((c) => ({ ...c })),
      clock: this.clock,
    };
  }

  static deserialize(
    data: SerializedCRDTDocument,
    localUserId: string,
  ): CRDTDocument {
    const doc = new CRDTDocument(localUserId);
    doc.chars = data.characters.map((c) => ({ ...c }));
    doc.clock = data.clock;
    doc.rebuildIndex.call(doc);
    return doc;
  }

  /** Produce a minimal diff between this document and another text string.
   *  Returns operations that, when applied, transform this doc to match target. */
  diffFrom(targetText: string): CRDTOperation[] {
    const currentText = this.toText();
    const ops: CRDTOperation[] = [];

    // Simple LCS-based diff (for short docs; use a proper diff lib for large docs)
    let i = 0;
    let j = 0;

    while (i < currentText.length || j < targetText.length) {
      if (i < currentText.length && j < targetText.length && currentText[i] === targetText[j]) {
        i++;
        j++;
      } else if (j < targetText.length && (i >= currentText.length || currentText[i] !== targetText[j])) {
        // Insert at j in the visible sequence
        const op = this.insert(j, targetText[j]);
        ops.push(op);
        j++;
        i++; // The visible text has shifted
      } else {
        // Delete at i in the visible sequence
        const op = this.delete(i);
        if (op) ops.push(op);
        // Don't advance i or j (the visible sequence shrinks)
      }
    }

    return ops;
  }

  /** Get all characters (including tombstones) for debugging. */
  getAllCharacters(): ReadonlyArray<CRDTCharacter> {
    return this.chars;
  }

  getClock(): number {
    return this.clock;
  }
}
