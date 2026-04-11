/**
 * Model save/load — JSON serialization of Transformer weights.
 *
 * The paper doesn't specify a serialization format; the reference code
 * (`tensor2tensor`) uses TensorFlow checkpoints. In this pure-TypeScript
 * module we use a compact JSON format that:
 *
 *   - Preserves Float64 precision (encodes every tensor as number[])
 *   - Embeds shape metadata so round-trip is bit-exact
 *   - Is self-describing (includes the config) so models can be moved
 *     between machines / Docker containers without side channels
 *
 * For the paper's full base model (~65M params) the JSON is ~1GB — not
 * a great format for production ML workflows but perfect for the
 * platform's tiny-config pedagogical runs and the test suite.
 */

import { type Matrix, zeros } from "./matrix";
import type { MultiHeadWeights } from "./attention";
import type { FFNWeights } from "./feedForward";
import type { EncoderLayerWeights, DecoderLayerWeights, TransformerWeights, TransformerConfig } from "./transformer";
import type { EmbeddingTable } from "./encoding";

// ---------------------------------------------------------------------------
// Primitive serialization
// ---------------------------------------------------------------------------

interface MatrixJSON {
  rows: number;
  cols: number;
  data: number[];
}

function matrixToJSON(m: Matrix): MatrixJSON {
  return { rows: m.rows, cols: m.cols, data: Array.from(m.data) };
}

function matrixFromJSON(json: MatrixJSON): Matrix {
  if (!Number.isInteger(json.rows) || !Number.isInteger(json.cols)) {
    throw new Error(`matrixFromJSON: invalid shape ${json.rows}x${json.cols}`);
  }
  if (json.data.length !== json.rows * json.cols) {
    throw new Error(
      `matrixFromJSON: data length ${json.data.length} != ${json.rows * json.cols}`,
    );
  }
  const m = zeros(json.rows, json.cols);
  for (let i = 0; i < json.data.length; i++) m.data[i] = json.data[i];
  return m;
}

// ---------------------------------------------------------------------------
// Multi-head and FFN
// ---------------------------------------------------------------------------

interface MultiHeadJSON {
  WQ: MatrixJSON[];
  WK: MatrixJSON[];
  WV: MatrixJSON[];
  WO: MatrixJSON;
}

function multiHeadToJSON(w: MultiHeadWeights): MultiHeadJSON {
  return {
    WQ: w.WQ.map(matrixToJSON),
    WK: w.WK.map(matrixToJSON),
    WV: w.WV.map(matrixToJSON),
    WO: matrixToJSON(w.WO),
  };
}

function multiHeadFromJSON(json: MultiHeadJSON): MultiHeadWeights {
  return {
    WQ: json.WQ.map(matrixFromJSON),
    WK: json.WK.map(matrixFromJSON),
    WV: json.WV.map(matrixFromJSON),
    WO: matrixFromJSON(json.WO),
  };
}

interface FFNJSON {
  W1: MatrixJSON;
  b1: MatrixJSON;
  W2: MatrixJSON;
  b2: MatrixJSON;
}

function ffnToJSON(w: FFNWeights): FFNJSON {
  return {
    W1: matrixToJSON(w.W1),
    b1: matrixToJSON(w.b1),
    W2: matrixToJSON(w.W2),
    b2: matrixToJSON(w.b2),
  };
}

function ffnFromJSON(json: FFNJSON): FFNWeights {
  return {
    W1: matrixFromJSON(json.W1),
    b1: matrixFromJSON(json.b1),
    W2: matrixFromJSON(json.W2),
    b2: matrixFromJSON(json.b2),
  };
}

// ---------------------------------------------------------------------------
// Encoder / decoder layers
// ---------------------------------------------------------------------------

interface EncoderLayerJSON {
  selfAttn: MultiHeadJSON;
  ffn: FFNJSON;
}

interface DecoderLayerJSON {
  maskedSelfAttn: MultiHeadJSON;
  crossAttn: MultiHeadJSON;
  ffn: FFNJSON;
}

function encoderLayerToJSON(w: EncoderLayerWeights): EncoderLayerJSON {
  return { selfAttn: multiHeadToJSON(w.selfAttn), ffn: ffnToJSON(w.ffn) };
}

function encoderLayerFromJSON(json: EncoderLayerJSON): EncoderLayerWeights {
  return { selfAttn: multiHeadFromJSON(json.selfAttn), ffn: ffnFromJSON(json.ffn) };
}

function decoderLayerToJSON(w: DecoderLayerWeights): DecoderLayerJSON {
  return {
    maskedSelfAttn: multiHeadToJSON(w.maskedSelfAttn),
    crossAttn: multiHeadToJSON(w.crossAttn),
    ffn: ffnToJSON(w.ffn),
  };
}

function decoderLayerFromJSON(json: DecoderLayerJSON): DecoderLayerWeights {
  return {
    maskedSelfAttn: multiHeadFromJSON(json.maskedSelfAttn),
    crossAttn: multiHeadFromJSON(json.crossAttn),
    ffn: ffnFromJSON(json.ffn),
  };
}

// ---------------------------------------------------------------------------
// Embedding table
// ---------------------------------------------------------------------------

interface EmbeddingTableJSON {
  weights: MatrixJSON;
  vocabSize: number;
  dModel: number;
}

export function embeddingTableToJSON(table: EmbeddingTable): EmbeddingTableJSON {
  return {
    weights: matrixToJSON(table.weights),
    vocabSize: table.vocabSize,
    dModel: table.dModel,
  };
}

export function embeddingTableFromJSON(json: EmbeddingTableJSON): EmbeddingTable {
  return {
    weights: matrixFromJSON(json.weights),
    vocabSize: json.vocabSize,
    dModel: json.dModel,
  };
}

// ---------------------------------------------------------------------------
// Full transformer
// ---------------------------------------------------------------------------

export interface TransformerCheckpointJSON {
  /** Format version tag — bump when breaking changes happen. */
  version: 1;
  /** The TransformerConfig used to train/init the model. */
  config: TransformerConfig;
  /** Per-layer encoder weights. */
  encoder: EncoderLayerJSON[];
  /** Per-layer decoder weights. */
  decoder: DecoderLayerJSON[];
  /** Optional shared embedding table. */
  embeddingTable?: EmbeddingTableJSON;
  /** Arbitrary metadata (name, step count, loss, BLEU, etc.). */
  metadata?: Record<string, unknown>;
}

export interface TransformerCheckpointInput {
  config: TransformerConfig;
  weights: TransformerWeights;
  embeddingTable?: EmbeddingTable;
  metadata?: Record<string, unknown>;
}

/** Serialize a Transformer into a plain JSON object. */
export function checkpointToJSON(input: TransformerCheckpointInput): TransformerCheckpointJSON {
  return {
    version: 1,
    config: input.config,
    encoder: input.weights.encoder.map(encoderLayerToJSON),
    decoder: input.weights.decoder.map(decoderLayerToJSON),
    embeddingTable: input.embeddingTable ? embeddingTableToJSON(input.embeddingTable) : undefined,
    metadata: input.metadata,
  };
}

/** Serialize a Transformer into a JSON string. Convenience wrapper. */
export function checkpointToString(input: TransformerCheckpointInput, pretty = false): string {
  return JSON.stringify(checkpointToJSON(input), null, pretty ? 2 : undefined);
}

/** Parse a Transformer checkpoint from a JSON object. */
export function checkpointFromJSON(json: TransformerCheckpointJSON): {
  config: TransformerConfig;
  weights: TransformerWeights;
  embeddingTable?: EmbeddingTable;
  metadata?: Record<string, unknown>;
} {
  if (json.version !== 1) {
    throw new Error(`checkpointFromJSON: unsupported version ${json.version}`);
  }
  return {
    config: json.config,
    weights: {
      encoder: json.encoder.map(encoderLayerFromJSON),
      decoder: json.decoder.map(decoderLayerFromJSON),
    },
    embeddingTable: json.embeddingTable ? embeddingTableFromJSON(json.embeddingTable) : undefined,
    metadata: json.metadata,
  };
}

/** Parse a Transformer checkpoint from a JSON string. */
export function checkpointFromString(jsonString: string): ReturnType<typeof checkpointFromJSON> {
  return checkpointFromJSON(JSON.parse(jsonString) as TransformerCheckpointJSON);
}
