import { useLocation } from "wouter";
import { useChats } from "@/hooks/use-chats";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, ArrowRight, Globe, Smartphone, Palette, Grid3x3, BarChart3, Play } from "lucide-react";
import { useState } from "react";

export default function ProjectsDashboard() {
  const [, setLocation] = useLocation();
  const { chats } = useChats();
  const { user } = useAuth();
  const [newProjectName, setNewProjectName] = useState("");

  const userName = user?.firstName || user?.email?.split("@")[0] || "User";
  const recentChats = chats.slice(0, 3);

  const quickStartOptions = [
    { icon: Globe, label: "Website", color: "bg-blue-500/10 text-blue-600" },
    { icon: Smartphone, label: "Mobile", color: "bg-purple-500/10 text-purple-600" },
    { icon: Palette, label: "Design", color: "bg-pink-500/10 text-pink-600" },
    { icon: Grid3x3, label: "Slides", color: "bg-orange-500/10 text-orange-600" },
    { icon: BarChart3, label: "Animation", color: "bg-emerald-500/10 text-emerald-600" },
  ];

  const handleCreateProject = () => {
    if (newProjectName.trim()) {
      // Create new chat with the project name
      setNewProjectName("");
    }
  };

  const handleSelectChat = (chatId: string) => {
    setLocation(`/chat/${chatId}`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-blue-500" />
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">IliaGPT</span>
          </div>
          <button className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            {userName}'s Workspace
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-12">
        {/* Welcome Section */}
        <div className="mb-12">
          <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2">
            Hi {userName}, what do you want to make?
          </h1>
          <p className="text-slate-600 dark:text-slate-400 mb-6">
            Create something amazing with IliaGPT
          </p>

          {/* Create Project Input */}
          <div className="flex gap-3 max-w-2xl">
            <Input
              placeholder="Describe your idea, Agent will bring it to life..."
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateProject()}
              className="h-12 text-base"
            />
            <Button
              onClick={handleCreateProject}
              className="h-12 px-6 bg-gradient-to-r from-violet-500 to-blue-500 hover:from-violet-600 hover:to-blue-600 text-white"
            >
              <Plus className="h-4 w-4 mr-2" />
              Plan
            </Button>
          </div>
        </div>

        {/* Quick Start Options */}
        <div className="mb-12">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wide">
              Quick start
            </h2>
            <a href="#" className="text-xs text-violet-600 dark:text-violet-400 hover:underline">
              Try an example prompt
              <ArrowRight className="h-3 w-3 inline ml-1" />
            </a>
          </div>

          {/* Carousel */}
          <div className="flex gap-4 overflow-x-auto pb-2">
            {quickStartOptions.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.label}
                  className={`flex flex-col items-center justify-center gap-3 px-6 py-8 rounded-xl border-2 border-slate-200 dark:border-slate-800 ${option.color} transition-all hover:border-slate-300 dark:hover:border-slate-700 flex-shrink-0 min-w-max`}
                >
                  <Icon className="h-6 w-6" />
                  <span className="text-sm font-medium">{option.label}</span>
                </button>
              );
            })}
          </div>

          {/* Example Prompts */}
          <div className="mt-6 flex flex-wrap gap-2">
            {["Quarterly review presentation", "Checkout flow prototype", "Startup analytics dashboard"].map(
              (prompt) => (
                <button
                  key={prompt}
                  className="text-xs px-4 py-2 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors"
                >
                  {prompt}
                </button>
              )
            )}
          </div>
        </div>

        {/* Recent Projects */}
        {recentChats.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Your recent Projects</h2>
              <button className="text-sm text-violet-600 dark:text-violet-400 hover:underline flex items-center gap-1">
                View All
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>

            {/* Projects Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {recentChats.map((chat) => (
                <button
                  key={chat.id}
                  onClick={() => handleSelectChat(chat.id)}
                  className="group relative bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 hover:shadow-lg hover:border-slate-300 dark:hover:border-slate-600 transition-all"
                >
                  {/* Project Icon/Color */}
                  <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-slate-300 to-slate-400 dark:from-slate-700 dark:to-slate-600 mb-4" />

                  {/* Project Title */}
                  <h3 className="font-medium text-slate-900 dark:text-white text-left line-clamp-2 mb-4">
                    {chat.title}
                  </h3>

                  {/* Project Meta */}
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        <Play className="h-3 w-3 inline mr-1" />
                        Published
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-500">
                        {new Date(chat.createdAt || Date.now()).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-opacity cursor-pointer" onClick={(e) => e.stopPropagation()}>
                      ⋮
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
