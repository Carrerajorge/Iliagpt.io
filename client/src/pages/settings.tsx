import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { SettingsDialog } from "@/components/settings-dialog";

export default function SettingsPage() {
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(true);

  useEffect(() => {
    setOpen(true);
  }, []);

  return (
    <SettingsDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setLocation("/");
      }}
    />
  );
}

