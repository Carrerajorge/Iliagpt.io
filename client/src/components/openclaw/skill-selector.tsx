import { memo, useState, useEffect } from "react";
import { ChevronDown, Cpu } from "lucide-react";

interface Skill {
  id: string;
  name: string;
  description?: string;
}

interface SkillSelectorProps {
  onSelect: (skillId: string | null) => void;
  selected?: string | null;
}

export const SkillSelector = memo(function SkillSelector({ onSelect, selected }: SkillSelectorProps) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/openclaw/skills").then(r => r.json()).then(setSkills).catch(() => {});
  }, []);

  if (!skills.length) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1 text-xs rounded-md bg-muted hover:bg-muted/80 text-muted-foreground"
      >
        <Cpu size={12} />
        {selected ? skills.find(s => s.id === selected)?.name || "Skill" : "Auto"}
        <ChevronDown size={10} />
      </button>
      {open && (
        <div className="absolute bottom-full mb-1 left-0 z-50 bg-popover border rounded-md shadow-lg py-1 min-w-[160px]">
          <button onClick={() => { onSelect(null); setOpen(false); }} className="w-full px-3 py-1.5 text-left text-xs hover:bg-accent">
            Auto (detect)
          </button>
          {skills.map(skill => (
            <button key={skill.id} onClick={() => { onSelect(skill.id); setOpen(false); }}
              className={`w-full px-3 py-1.5 text-left text-xs hover:bg-accent ${selected === skill.id ? "bg-accent/50" : ""}`}>
              {skill.name}
              {skill.description && <span className="block text-[10px] text-muted-foreground">{skill.description}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
