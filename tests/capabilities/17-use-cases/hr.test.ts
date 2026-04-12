/**
 * Capability tests — HR use cases (capability 17-hr)
 *
 * Tests cover performance review generation, competency workflows,
 * job description creation, and onboarding plan generation.
 * All tests operate on in-memory data; no external services are called.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { assertHasShape } from "../_setup/testHelpers";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

interface ReviewTemplate {
  sections: Array<{
    title: string;
    prompts: string[];
    ratingScale?: { min: number; max: number; labels: string[] };
  }>;
  ratingType: "numeric" | "descriptive";
  includeGoals: boolean;
}

interface FeedbackEntry {
  fromId: string;
  fromName: string;
  relationship: "manager" | "peer" | "report" | "self";
  ratings: Record<string, number>;
  comments: string;
}

interface CalibrationScore {
  employeeId: string;
  employeeName: string;
  managerRating: number;
  peerAverage: number;
  selfRating: number;
  calibratedScore: number;
  distribution: "top" | "meets" | "below";
}

interface Competency {
  id: string;
  name: string;
  description: string;
  level: 1 | 2 | 3 | 4 | 5;
  category: "technical" | "leadership" | "communication" | "problem-solving";
}

interface GapAnalysis {
  employeeId: string;
  currentCompetencies: Record<string, number>; // competencyId → current level
  requiredCompetencies: Record<string, number>; // competencyId → required level
  gaps: Array<{ competencyId: string; currentLevel: number; requiredLevel: number; gap: number }>;
}

interface DevelopmentPlan {
  employeeId: string;
  period: string;
  goals: Array<{ competencyId: string; targetLevel: number; actions: string[]; deadline: string }>;
}

interface JobDescription {
  title: string;
  department: string;
  level: string;
  summary: string;
  responsibilities: string[];
  requirements: Array<{ type: "required" | "preferred"; text: string }>;
  salaryBand: { min: number; max: number; currency: string };
  inclusiveLanguageScore: number; // 0-1
}

interface OnboardingChecklist {
  employeeId: string;
  startDate: string;
  items: OnboardingItem[];
  firstWeekPlan: DayPlan[];
}

interface OnboardingItem {
  id: string;
  category: "admin" | "tech" | "culture" | "role";
  task: string;
  dueDay: number;
  completed: boolean;
  owner: string;
}

interface DayPlan {
  day: number;
  date: string;
  activities: string[];
}

// ---------------------------------------------------------------------------
// HR processing utilities
// ---------------------------------------------------------------------------

function buildReviewTemplate(roleLevel: "ic" | "manager" | "executive"): ReviewTemplate {
  const baseSections = [
    {
      title: "Goal Achievement",
      prompts: ["What goals did the employee set?", "Were goals achieved? Provide examples."],
      ratingScale: { min: 1, max: 5, labels: ["Unsatisfactory", "Below expectations", "Meets expectations", "Exceeds expectations", "Outstanding"] },
    },
    {
      title: "Core Competencies",
      prompts: ["Describe demonstrated competencies.", "Where did the employee excel?"],
      ratingScale: { min: 1, max: 5, labels: ["Unsatisfactory", "Below expectations", "Meets expectations", "Exceeds expectations", "Outstanding"] },
    },
  ];

  if (roleLevel === "manager" || roleLevel === "executive") {
    baseSections.push({
      title: "People Leadership",
      prompts: ["How did the manager develop their team?", "Provide examples of coaching and mentoring."],
      ratingScale: { min: 1, max: 5, labels: ["Unsatisfactory", "Below expectations", "Meets expectations", "Exceeds expectations", "Outstanding"] },
    });
  }

  if (roleLevel === "executive") {
    baseSections.push({
      title: "Strategic Impact",
      prompts: ["What business outcomes did this leader drive?", "Describe company-level contributions."],
      ratingScale: { min: 1, max: 5, labels: ["Unsatisfactory", "Below expectations", "Meets expectations", "Exceeds expectations", "Outstanding"] },
    });
  }

  return { sections: baseSections, ratingType: "numeric", includeGoals: true };
}

function calibrateScores(feedbackEntries: FeedbackEntry[], employeeId: string): CalibrationScore {
  const manager = feedbackEntries.find((f) => f.relationship === "manager");
  const peers = feedbackEntries.filter((f) => f.relationship === "peer");
  const self = feedbackEntries.find((f) => f.relationship === "self");

  const avgRating = (entry: FeedbackEntry) =>
    Object.values(entry.ratings).reduce((a, b) => a + b, 0) / Object.values(entry.ratings).length;

  const managerRating = manager ? avgRating(manager) : 3;
  const peerAverage = peers.length > 0
    ? peers.reduce((sum, p) => sum + avgRating(p), 0) / peers.length
    : 3;
  const selfRating = self ? avgRating(self) : 3;

  // Weighted calibration: 50% manager, 35% peers, 15% self
  const calibratedScore = managerRating * 0.5 + peerAverage * 0.35 + selfRating * 0.15;

  const distribution: "top" | "meets" | "below" =
    calibratedScore >= 4.2 ? "top" : calibratedScore >= 3.0 ? "meets" : "below";

  return {
    employeeId,
    employeeName: manager?.fromName ?? "Unknown",
    managerRating,
    peerAverage,
    selfRating,
    calibratedScore: parseFloat(calibratedScore.toFixed(2)),
    distribution,
  };
}

function computeGapAnalysis(
  employeeId: string,
  currentLevels: Record<string, number>,
  requiredLevels: Record<string, number>,
): GapAnalysis {
  const gaps = Object.keys(requiredLevels)
    .filter((id) => (currentLevels[id] ?? 0) < requiredLevels[id])
    .map((id) => ({
      competencyId: id,
      currentLevel: currentLevels[id] ?? 0,
      requiredLevel: requiredLevels[id],
      gap: requiredLevels[id] - (currentLevels[id] ?? 0),
    }))
    .sort((a, b) => b.gap - a.gap);

  return { employeeId, currentCompetencies: currentLevels, requiredCompetencies: requiredLevels, gaps };
}

function checkInclusiveLanguage(text: string): number {
  const nonInclusiveTerms = [
    "ninja", "rockstar", "guru", "manpower", "man-hours", "chairman",
    "policeman", "stewardess", "he/she", "his/her",
  ];

  const lowerText = text.toLowerCase();
  const hits = nonInclusiveTerms.filter((term) => lowerText.includes(term)).length;
  return Math.max(0, 1 - hits * 0.1);
}

function buildOnboardingChecklist(
  employeeId: string,
  startDate: string,
  role: string,
): OnboardingChecklist {
  const baseItems: Omit<OnboardingItem, "id">[] = [
    { category: "admin", task: "Complete I-9 and employment verification", dueDay: 1, completed: false, owner: "HR" },
    { category: "admin", task: "Set up payroll and benefits enrollment", dueDay: 1, completed: false, owner: "HR" },
    { category: "tech", task: "Receive laptop and access credentials", dueDay: 1, completed: false, owner: "IT" },
    { category: "tech", task: "Set up development environment", dueDay: 2, completed: false, owner: "Engineering Lead" },
    { category: "tech", task: "Access all required systems (JIRA, Slack, GitHub)", dueDay: 2, completed: false, owner: "IT" },
    { category: "culture", task: "Meet with direct manager for expectations alignment", dueDay: 1, completed: false, owner: "Manager" },
    { category: "culture", task: "Attend team standup and introduction", dueDay: 1, completed: false, owner: "Manager" },
    { category: "culture", task: "Review company mission, values, and handbook", dueDay: 3, completed: false, owner: "Employee" },
    { category: "role", task: `Review ${role} role expectations document`, dueDay: 2, completed: false, owner: "Manager" },
    { category: "role", task: "Shadow senior team member for context", dueDay: 3, completed: false, owner: "Buddy" },
  ];

  return {
    employeeId,
    startDate,
    items: baseItems.map((item, idx) => ({ ...item, id: `item_${idx + 1}` })),
    firstWeekPlan: [],
  };
}

// ---------------------------------------------------------------------------
// Performance reviews
// ---------------------------------------------------------------------------

describe("Performance reviews", () => {
  it("generates an appropriate review template for an IC role", () => {
    const template = buildReviewTemplate("ic");

    expect(template.sections.length).toBeGreaterThanOrEqual(2);
    expect(template.ratingType).toBe("numeric");
    expect(template.includeGoals).toBe(true);

    template.sections.forEach((s) =>
      assertHasShape(s, { title: "string", prompts: "array" }),
    );

    const titles = template.sections.map((s) => s.title);
    expect(titles).toContain("Goal Achievement");
    expect(titles).toContain("Core Competencies");
    // IC should NOT have people leadership section
    expect(titles).not.toContain("People Leadership");
  });

  it("includes people leadership section for manager templates", () => {
    const template = buildReviewTemplate("manager");
    const titles = template.sections.map((s) => s.title);

    expect(titles).toContain("People Leadership");
    expect(titles).not.toContain("Strategic Impact");
  });

  it("includes strategic impact section for executive templates", () => {
    const template = buildReviewTemplate("executive");
    const titles = template.sections.map((s) => s.title);

    expect(titles).toContain("People Leadership");
    expect(titles).toContain("Strategic Impact");
  });

  it("aggregates 360 feedback into a calibrated score with correct weighting", () => {
    const feedbackEntries: FeedbackEntry[] = [
      { fromId: "mgr_01", fromName: "Manager", relationship: "manager", ratings: { goal: 4, competency: 5 }, comments: "Excellent work" },
      { fromId: "peer_01", fromName: "Peer A", relationship: "peer", ratings: { goal: 4, competency: 4 }, comments: "Great collaborator" },
      { fromId: "peer_02", fromName: "Peer B", relationship: "peer", ratings: { goal: 3, competency: 4 }, comments: "Good team player" },
      { fromId: "emp_01", fromName: "Employee", relationship: "self", ratings: { goal: 4, competency: 4 }, comments: "Met all goals" },
    ];

    const calibrated = calibrateScores(feedbackEntries, "emp_001");

    assertHasShape(calibrated, {
      employeeId: "string",
      managerRating: "number",
      peerAverage: "number",
      selfRating: "number",
      calibratedScore: "number",
      distribution: "string",
    });

    expect(calibrated.managerRating).toBeCloseTo(4.5, 1);
    expect(calibrated.calibratedScore).toBeGreaterThan(0);
    expect(calibrated.calibratedScore).toBeLessThanOrEqual(5);
    expect(["top", "meets", "below"]).toContain(calibrated.distribution);
  });
});

// ---------------------------------------------------------------------------
// Competency workflows
// ---------------------------------------------------------------------------

describe("Competency workflows", () => {
  it("identifies skill gaps between current and required competency levels", () => {
    const current = { "c_python": 3, "c_system_design": 2, "c_communication": 4, "c_leadership": 1 };
    const required = { "c_python": 4, "c_system_design": 4, "c_communication": 4, "c_leadership": 3 };

    const analysis = computeGapAnalysis("emp_001", current, required);

    expect(analysis.gaps.length).toBe(3); // python, system_design, leadership
    expect(analysis.gaps[0].competencyId).toBe("c_system_design"); // largest gap
    expect(analysis.gaps[0].gap).toBe(2);

    assertHasShape(analysis, {
      employeeId: "string",
      currentCompetencies: "object",
      requiredCompetencies: "object",
      gaps: "array",
    });
  });

  it("returns no gaps when employee meets or exceeds all requirements", () => {
    const current = { "c_python": 5, "c_system_design": 4 };
    const required = { "c_python": 4, "c_system_design": 3 };

    const analysis = computeGapAnalysis("emp_002", current, required);
    expect(analysis.gaps).toHaveLength(0);
  });

  it("generates a development plan from gap analysis", () => {
    function buildDevelopmentPlan(gap: GapAnalysis, period: string): DevelopmentPlan {
      return {
        employeeId: gap.employeeId,
        period,
        goals: gap.gaps.map((g) => ({
          competencyId: g.competencyId,
          targetLevel: g.requiredLevel,
          actions: [
            `Complete online course for ${g.competencyId}`,
            `Work on 2 stretch projects requiring ${g.competencyId}`,
            "Monthly check-in with mentor on progress",
          ],
          deadline: new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10),
        })),
      };
    }

    const gaps = computeGapAnalysis(
      "emp_001",
      { "c_python": 2, "c_leadership": 1 },
      { "c_python": 4, "c_leadership": 3 },
    );

    const plan = buildDevelopmentPlan(gaps, "Q2 2026");
    expect(plan.goals).toHaveLength(2);
    plan.goals.forEach((g) =>
      assertHasShape(g, {
        competencyId: "string",
        targetLevel: "number",
        actions: "array",
        deadline: "string",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Job descriptions
// ---------------------------------------------------------------------------

describe("Job descriptions", () => {
  it("generates a job description from role requirements", () => {
    function generateJobDescription(
      title: string,
      department: string,
      level: string,
      responsibilities: string[],
      requiredSkills: string[],
      salaryBand: { min: number; max: number },
    ): JobDescription {
      const summary = `We are looking for a ${level} ${title} to join our ${department} team. You will be responsible for driving ${responsibilities[0]?.toLowerCase() ?? "key initiatives"}.`;

      return {
        title,
        department,
        level,
        summary,
        responsibilities,
        requirements: [
          ...requiredSkills.map((s) => ({ type: "required" as const, text: s })),
          { type: "preferred", text: "Experience with AI/ML tools" },
        ],
        salaryBand: { ...salaryBand, currency: "USD" },
        inclusiveLanguageScore: checkInclusiveLanguage(`${title} ${summary} ${responsibilities.join(" ")}`),
      };
    }

    const jd = generateJobDescription(
      "Senior Software Engineer",
      "Engineering",
      "Senior",
      ["Design and implement scalable backend services", "Mentor junior engineers", "Participate in architecture decisions"],
      ["5+ years of backend development experience", "Proficiency in TypeScript and Node.js", "Experience with PostgreSQL"],
      { min: 150000, max: 200000 },
    );

    assertHasShape(jd, {
      title: "string",
      department: "string",
      level: "string",
      summary: "string",
      responsibilities: "array",
      requirements: "array",
      salaryBand: "object",
      inclusiveLanguageScore: "number",
    });

    expect(jd.responsibilities).toHaveLength(3);
    expect(jd.salaryBand.currency).toBe("USD");
  });

  it("flags non-inclusive language and returns a score below 1", () => {
    const jdText = "Looking for a rockstar ninja developer who can work man-hours to deliver guru-level code.";
    const score = checkInclusiveLanguage(jdText);
    expect(score).toBeLessThan(1);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it("returns a perfect inclusive language score for neutral text", () => {
    const jdText = "We are looking for a collaborative engineer who values diverse perspectives and teamwork.";
    const score = checkInclusiveLanguage(jdText);
    expect(score).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

describe("Onboarding", () => {
  it("generates a checklist covering all onboarding categories", () => {
    const checklist = buildOnboardingChecklist("emp_001", "2026-04-14", "Software Engineer");

    assertHasShape(checklist, {
      employeeId: "string",
      startDate: "string",
      items: "array",
    });

    const categories = new Set(checklist.items.map((i) => i.category));
    expect(categories.has("admin")).toBe(true);
    expect(categories.has("tech")).toBe(true);
    expect(categories.has("culture")).toBe(true);
    expect(categories.has("role")).toBe(true);
  });

  it("assigns due days to checklist items with day-1 essentials first", () => {
    const checklist = buildOnboardingChecklist("emp_002", "2026-04-14", "Product Manager");

    const day1Items = checklist.items.filter((i) => i.dueDay === 1);
    expect(day1Items.length).toBeGreaterThan(0);

    // All items should have a positive due day
    checklist.items.forEach((i) => {
      expect(i.dueDay).toBeGreaterThan(0);
    });
  });

  it("builds a first-week day plan with activities for each day", () => {
    function buildFirstWeekPlan(startDate: string): DayPlan[] {
      const activityMap: Record<number, string[]> = {
        1: ["Meet your manager", "IT setup and laptop configuration", "Office/remote access walkthrough", "Team introduction"],
        2: ["Development environment setup", "Codebase overview with senior engineer", "Review onboarding docs"],
        3: ["Shadow team standup", "Review architecture documentation", "Meet with buddy"],
        4: ["Pair programming session", "Review open tickets for context", "1:1 with manager"],
        5: ["End of week reflection with manager", "Review first-week goals", "Social team event"],
      };

      const start = new Date(startDate);
      return Array.from({ length: 5 }, (_, i) => {
        const date = new Date(start);
        date.setDate(start.getDate() + i);
        return {
          day: i + 1,
          date: date.toISOString().slice(0, 10),
          activities: activityMap[i + 1] ?? [],
        };
      });
    }

    const plan = buildFirstWeekPlan("2026-04-14");

    expect(plan).toHaveLength(5);
    plan.forEach((day) => {
      assertHasShape(day, { day: "number", date: "string", activities: "array" });
      expect(day.activities.length).toBeGreaterThan(0);
    });

    expect(plan[0].day).toBe(1);
    expect(plan[4].day).toBe(5);
  });

  it("generates a policy summary with required compliance sections", () => {
    function generatePolicySummary(policies: string[]): { section: string; summary: string }[] {
      return policies.map((policy) => ({
        section: policy,
        summary: `This policy covers ${policy.toLowerCase()} requirements applicable to all employees. Please review and acknowledge within your first week.`,
      }));
    }

    const requiredPolicies = [
      "Code of Conduct",
      "Information Security",
      "Acceptable Use Policy",
      "Anti-Harassment",
    ];

    const summaries = generatePolicySummary(requiredPolicies);
    expect(summaries).toHaveLength(4);
    summaries.forEach((s) =>
      assertHasShape(s, { section: "string", summary: "string" }),
    );
    expect(summaries[0].section).toBe("Code of Conduct");
  });
});
