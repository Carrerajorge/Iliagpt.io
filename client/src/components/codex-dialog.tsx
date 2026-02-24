import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Code, Terminal, Cpu, Database, Network, Globe, Shield, Zap } from "lucide-react";

interface CodexDialogProps {
    isOpen: boolean;
    onClose: () => void;
}

export function CodexDialog({ isOpen, onClose }: CodexDialogProps) {
    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-4xl max-h-[80vh] p-0 flex flex-col bg-slate-950 text-slate-50 border-slate-800">
                <DialogHeader className="px-6 py-4 border-b border-slate-800 bg-slate-950">
                    <DialogTitle className="flex items-center gap-2 text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                        <Code className="h-6 w-6 text-blue-400" />
                        Antigravity Codex
                    </DialogTitle>
                    <DialogDescription className="text-slate-400">
                        Advanced Agentic Core & Logic Repository
                    </DialogDescription>
                </DialogHeader>

                <ScrollArea className="flex-1 p-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-6">
                            <section className="space-y-3">
                                <h3 className="text-lg font-semibold flex items-center gap-2 text-blue-300">
                                    <Cpu className="h-5 w-5" />
                                    Core Architecture
                                </h3>
                                <p className="text-sm text-slate-300 leading-relaxed">
                                    The Antigravity engine is built on a recursive agentic loop that integrates:
                                </p>
                                <ul className="list-disc list-inside text-sm text-slate-400 space-y-1 ml-2">
                                    <li>Multi-modal Context Management (L0-L2 Caching)</li>
                                    <li>Hierarchical Task Network (HTN) Planning</li>
                                    <li>Real-time Code Execution Sandbox (Python/JS)</li>
                                    <li>Distributed State Management via Redis/Postgres</li>
                                </ul>
                            </section>

                            <section className="space-y-3">
                                <h3 className="text-lg font-semibold flex items-center gap-2 text-purple-300">
                                    <Terminal className="h-5 w-5" />
                                    Agent Capabilities
                                </h3>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                                        <div className="font-medium text-slate-200 mb-1">Executor Agent</div>
                                        <div className="text-xs text-slate-500">Autonomous code writing & validation</div>
                                    </div>
                                    <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                                        <div className="font-medium text-slate-200 mb-1">Planner Agent</div>
                                        <div className="text-xs text-slate-500">Step-by-step problem decomposition</div>
                                    </div>
                                    <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                                        <div className="font-medium text-slate-200 mb-1">Research Agent</div>
                                        <div className="text-xs text-slate-500">Deep web synthesis & citation</div>
                                    </div>
                                    <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                                        <div className="font-medium text-slate-200 mb-1">Verifier Agent</div>
                                        <div className="text-xs text-slate-500">Logic checking & security audit</div>
                                    </div>
                                </div>
                            </section>
                        </div>

                        <div className="space-y-6">
                            <section className="space-y-3">
                                <h3 className="text-lg font-semibold flex items-center gap-2 text-green-300">
                                    <Database className="h-5 w-5" />
                                    System Logic Source
                                </h3>
                                <div className="bg-slate-900 rounded-lg p-4 border border-slate-800 font-mono text-xs text-slate-300 overflow-x-auto">
                                    <pre>{`// Antigravity Core Logic Placeholder
class AgentOrchestrator {
  constructor(private context: Context) {}

  async plan(goal: string): Promise<Plan> {
    const strategy = await this.planner.analyze(goal);
    return strategy.decompose();
  }

  async execute(step: Task): Promise<Result> {
    const tool = this.registry.getTool(step.tool);
    return tool.run(step.params);
  }
}`}</pre>
                                </div>
                                <div className="flex gap-2">
                                    <Button variant="outline" className="flex-1 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white">
                                        <Globe className="h-4 w-4 mr-2" />
                                        View on GitHub
                                    </Button>
                                    <Button className="flex-1 bg-blue-600 hover:bg-blue-500 text-white">
                                        <Zap className="h-4 w-4 mr-2" />
                                        Activate Logic
                                    </Button>
                                </div>
                            </section>

                            <section className="space-y-3">
                                <h3 className="text-lg font-semibold flex items-center gap-2 text-orange-300">
                                    <Shield className="h-5 w-5" />
                                    Security Protocols
                                </h3>
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between text-sm p-2 bg-slate-900/50 rounded">
                                        <span className="text-slate-400">Sandbox Isolation</span>
                                        <span className="text-green-400 font-mono">ACTIVE</span>
                                    </div>
                                    <div className="flex items-center justify-between text-sm p-2 bg-slate-900/50 rounded">
                                        <span className="text-slate-400">Input Sanitization</span>
                                        <span className="text-green-400 font-mono">STRICT</span>
                                    </div>
                                    <div className="flex items-center justify-between text-sm p-2 bg-slate-900/50 rounded">
                                        <span className="text-slate-400">Rate Limiting</span>
                                        <span className="text-green-400 font-mono">DYNAMIC</span>
                                    </div>
                                </div>
                            </section>
                        </div>
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
}
