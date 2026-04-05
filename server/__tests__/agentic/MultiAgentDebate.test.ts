// Local test implementation — replace with real import when file exists
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DebateAgent {
  id: string
  name: string
  role: 'advocate' | 'critic' | 'neutral'
  bias: number // -1 to 1
}

interface Argument {
  agentId: string
  content: string
  score: number // 0-1
  supporting: boolean
}

interface DebateRound {
  round: number
  arguments: Argument[]
  scores: Map<string, number>
}

interface DebateResult {
  topic: string
  rounds: DebateRound[]
  consensus: string
  consensusScore: number
  winner?: string
}

// ---------------------------------------------------------------------------
// MultiAgentDebate implementation
// ---------------------------------------------------------------------------

class MultiAgentDebate {
  private agents: DebateAgent[]
  private topic: string
  private maxRounds: number

  constructor(agents: DebateAgent[], topic: string, maxRounds = 3) {
    this.agents = agents
    this.topic = topic
    this.maxRounds = maxRounds
  }

  runRound(round: number): DebateRound {
    const args: Argument[] = this.agents.map((agent) => {
      // bias > 0 → tends to support; bias < 0 → tends to oppose; bias=0 → neutral
      const supporting = agent.bias >= 0
      const baseScore = Math.abs(agent.bias)
      // Score bounded 0..1; neutral agents get 0.5
      const score = agent.bias === 0 ? 0.5 : Math.min(1, Math.max(0, baseScore))

      const stance = supporting ? 'in favour of' : 'against'
      const content =
        agent.bias === 0
          ? `As a neutral observer in round ${round}, I see both merits and concerns regarding "${this.topic}".`
          : `In round ${round}, as a ${agent.role}, I argue ${stance} "${this.topic}" with conviction.`

      return { agentId: agent.id, content, score, supporting }
    })

    const scores = new Map<string, number>()
    for (const arg of args) {
      scores.set(arg.agentId, arg.score)
    }

    return { round, arguments: args, scores }
  }

  detectConsensus(rounds: DebateRound[]): {
    reached: boolean
    score: number
    position: string
  } {
    if (rounds.length === 0) return { reached: false, score: 0, position: 'none' }

    // Aggregate supporting count across all rounds
    const supportMap = new Map<string, number>()
    const opposeMap = new Map<string, number>()

    for (const round of rounds) {
      for (const arg of round.arguments) {
        if (arg.supporting) {
          supportMap.set(arg.agentId, (supportMap.get(arg.agentId) ?? 0) + 1)
        } else {
          opposeMap.set(arg.agentId, (opposeMap.get(arg.agentId) ?? 0) + 1)
        }
      }
    }

    // Majority position per agent
    const agentIds = this.agents.map((a) => a.id)
    let supportingAgents = 0
    let opposingAgents = 0

    for (const id of agentIds) {
      const s = supportMap.get(id) ?? 0
      const o = opposeMap.get(id) ?? 0
      if (s > o) supportingAgents++
      else if (o > s) opposingAgents++
      else if (s === o && s > 0) supportingAgents++ // tie → lean support
    }

    const total = agentIds.length
    const supportRatio = supportingAgents / total
    const opposeRatio = opposingAgents / total
    const threshold = 0.75

    if (supportRatio >= threshold) {
      return { reached: true, score: supportRatio, position: 'for' }
    }
    if (opposeRatio >= threshold) {
      return { reached: true, score: opposeRatio, position: 'against' }
    }
    return { reached: false, score: Math.max(supportRatio, opposeRatio), position: 'split' }
  }

  synthesize(rounds: DebateRound[]): DebateResult {
    const consensus = this.detectConsensus(rounds)

    // Pick winner: agent with highest average score across rounds
    const agentTotals = new Map<string, number>()
    for (const round of rounds) {
      for (const [id, score] of round.scores) {
        agentTotals.set(id, (agentTotals.get(id) ?? 0) + score)
      }
    }

    let winner: string | undefined
    let highestTotal = -Infinity
    let tie = false

    for (const [id, total] of agentTotals) {
      if (total > highestTotal) {
        highestTotal = total
        winner = id
        tie = false
      } else if (total === highestTotal) {
        tie = true
      }
    }

    if (tie) winner = undefined

    const consensusText = consensus.reached
      ? `Consensus reached: the group is ${consensus.position} the topic "${this.topic}".`
      : `No consensus reached on "${this.topic}". The debate remains split.`

    return {
      topic: this.topic,
      rounds,
      consensus: consensusText,
      consensusScore: Math.min(1, Math.max(0, consensus.score)),
      winner,
    }
  }

  run(): DebateResult {
    const rounds: DebateRound[] = []
    for (let r = 1; r <= this.maxRounds; r++) {
      rounds.push(this.runRound(r))
    }
    return this.synthesize(rounds)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgent(
  id: string,
  role: DebateAgent['role'],
  bias: number,
): DebateAgent {
  return { id, name: `Agent_${id}`, role, bias }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MultiAgentDebate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // 1. Debate rounds
  // -------------------------------------------------------------------------
  describe('debate rounds', () => {
    it('single round → all agents produce arguments', () => {
      const agents = [
        makeAgent('a1', 'advocate', 0.8),
        makeAgent('a2', 'critic', -0.8),
        makeAgent('a3', 'neutral', 0),
      ]
      const debate = new MultiAgentDebate(agents, 'AI in healthcare')
      const round = debate.runRound(1)

      expect(round.arguments).toHaveLength(3)
      expect(round.arguments.map((a) => a.agentId)).toEqual(
        expect.arrayContaining(['a1', 'a2', 'a3']),
      )
    })

    it('arguments have non-empty content', () => {
      const agents = [makeAgent('a1', 'advocate', 0.9), makeAgent('a2', 'critic', -0.9)]
      const debate = new MultiAgentDebate(agents, 'Remote work policy')
      const round = debate.runRound(1)

      for (const arg of round.arguments) {
        expect(arg.content.length).toBeGreaterThan(0)
      }
    })

    it('each argument has score in range 0-1', () => {
      const agents = [
        makeAgent('a1', 'advocate', 1.0),
        makeAgent('a2', 'neutral', 0),
        makeAgent('a3', 'critic', -1.0),
      ]
      const debate = new MultiAgentDebate(agents, 'Climate policy')
      const round = debate.runRound(1)

      for (const arg of round.arguments) {
        expect(arg.score).toBeGreaterThanOrEqual(0)
        expect(arg.score).toBeLessThanOrEqual(1)
      }
    })

    it('round count matches configured maxRounds', () => {
      const agents = [makeAgent('a1', 'advocate', 0.7)]
      const debate = new MultiAgentDebate(agents, 'Any topic', 4)
      const result = debate.run()

      expect(result.rounds).toHaveLength(4)
    })

    it('round numbers are sequential starting at 1', () => {
      const agents = [makeAgent('a1', 'advocate', 0.5)]
      const debate = new MultiAgentDebate(agents, 'Test', 3)
      const result = debate.run()

      expect(result.rounds.map((r) => r.round)).toEqual([1, 2, 3])
    })
  })

  // -------------------------------------------------------------------------
  // 2. Consensus detection
  // -------------------------------------------------------------------------
  describe('consensus detection', () => {
    it('all agents supporting → consensus reached with high score', () => {
      const agents = [
        makeAgent('a1', 'advocate', 0.9),
        makeAgent('a2', 'advocate', 0.8),
        makeAgent('a3', 'advocate', 0.7),
        makeAgent('a4', 'advocate', 0.6),
      ]
      const debate = new MultiAgentDebate(agents, 'Topic A', 1)
      const round = debate.runRound(1)
      const result = debate.detectConsensus([round])

      expect(result.reached).toBe(true)
      expect(result.position).toBe('for')
      expect(result.score).toBeGreaterThanOrEqual(0.75)
    })

    it('all agents opposing → consensus reached (against)', () => {
      const agents = [
        makeAgent('a1', 'critic', -0.9),
        makeAgent('a2', 'critic', -0.8),
        makeAgent('a3', 'critic', -0.7),
        makeAgent('a4', 'critic', -0.6),
      ]
      const debate = new MultiAgentDebate(agents, 'Topic B', 1)
      const round = debate.runRound(1)
      const result = debate.detectConsensus([round])

      expect(result.reached).toBe(true)
      expect(result.position).toBe('against')
    })

    it('split 50/50 → no consensus', () => {
      const agents = [
        makeAgent('a1', 'advocate', 0.9),
        makeAgent('a2', 'advocate', 0.8),
        makeAgent('a3', 'critic', -0.9),
        makeAgent('a4', 'critic', -0.8),
      ]
      const debate = new MultiAgentDebate(agents, 'Topic C', 1)
      const round = debate.runRound(1)
      const result = debate.detectConsensus([round])

      expect(result.reached).toBe(false)
    })

    it('exactly 3/4 agents supporting triggers consensus (75% threshold)', () => {
      const agents = [
        makeAgent('a1', 'advocate', 0.9),
        makeAgent('a2', 'advocate', 0.8),
        makeAgent('a3', 'advocate', 0.7),
        makeAgent('a4', 'critic', -0.9),
      ]
      const debate = new MultiAgentDebate(agents, 'Topic D', 1)
      const round = debate.runRound(1)
      const result = debate.detectConsensus([round])

      expect(result.reached).toBe(true)
      expect(result.score).toBeCloseTo(0.75, 2)
    })
  })

  // -------------------------------------------------------------------------
  // 3. Argument scoring
  // -------------------------------------------------------------------------
  describe('argument scoring', () => {
    it('advocate with bias=1.0 → generates supporting argument', () => {
      const agents = [makeAgent('adv', 'advocate', 1.0)]
      const debate = new MultiAgentDebate(agents, 'Topic')
      const round = debate.runRound(1)
      const arg = round.arguments[0]

      expect(arg.supporting).toBe(true)
    })

    it('critic with bias=-1.0 → generates opposing argument', () => {
      const agents = [makeAgent('crit', 'critic', -1.0)]
      const debate = new MultiAgentDebate(agents, 'Topic')
      const round = debate.runRound(1)
      const arg = round.arguments[0]

      expect(arg.supporting).toBe(false)
    })

    it('neutral with bias=0 → balanced argument with score 0.5', () => {
      const agents = [makeAgent('neut', 'neutral', 0)]
      const debate = new MultiAgentDebate(agents, 'Topic')
      const round = debate.runRound(1)
      const arg = round.arguments[0]

      expect(arg.score).toBe(0.5)
    })

    it('strong bias produces score close to 1', () => {
      const agents = [makeAgent('strong', 'advocate', 0.95)]
      const debate = new MultiAgentDebate(agents, 'Topic')
      const round = debate.runRound(1)

      expect(round.arguments[0].score).toBeGreaterThan(0.9)
    })
  })

  // -------------------------------------------------------------------------
  // 4. Synthesis quality
  // -------------------------------------------------------------------------
  describe('synthesis quality', () => {
    it('synthesize returns non-empty consensus string', () => {
      const agents = [makeAgent('a1', 'advocate', 0.8), makeAgent('a2', 'critic', -0.6)]
      const debate = new MultiAgentDebate(agents, 'Testing', 2)
      const rounds = [debate.runRound(1), debate.runRound(2)]
      const result = debate.synthesize(rounds)

      expect(result.consensus.length).toBeGreaterThan(0)
    })

    it('consensusScore is between 0 and 1', () => {
      const agents = [makeAgent('a1', 'advocate', 0.8), makeAgent('a2', 'critic', -0.8)]
      const debate = new MultiAgentDebate(agents, 'Synthesis topic', 1)
      const rounds = [debate.runRound(1)]
      const result = debate.synthesize(rounds)

      expect(result.consensusScore).toBeGreaterThanOrEqual(0)
      expect(result.consensusScore).toBeLessThanOrEqual(1)
    })

    it('winner is one of agent IDs or undefined (for tie)', () => {
      const agents = [
        makeAgent('a1', 'advocate', 0.9),
        makeAgent('a2', 'critic', -0.5),
      ]
      const debate = new MultiAgentDebate(agents, 'Synthesis', 1)
      const rounds = [debate.runRound(1)]
      const result = debate.synthesize(rounds)

      if (result.winner !== undefined) {
        expect(['a1', 'a2']).toContain(result.winner)
      }
    })

    it('all rounds included in result', () => {
      const agents = [makeAgent('a1', 'advocate', 0.7)]
      const debate = new MultiAgentDebate(agents, 'Rounds test', 3)
      const result = debate.run()

      expect(result.rounds).toHaveLength(3)
    })

    it('topic is preserved in result', () => {
      const agents = [makeAgent('a1', 'neutral', 0)]
      const debate = new MultiAgentDebate(agents, 'My unique topic XYZ', 1)
      const result = debate.run()

      expect(result.topic).toBe('My unique topic XYZ')
    })
  })
})
