
import fs from "node:fs";



export type ShellId = "sh" | "ash" | "bash" | "powershell" | "cmd";



type ShellSpec = { id: ShellId; exec: string; label: string; };



function isExec(p: string) {

  try {

    fs.accessSync(p, fs.constants.X_OK);

    return true;

  } catch {

    return false;

  }

}



function platformCandidates(): ShellSpec[] {

  if (process.platform === "win32") {

    return [

      { id: "powershell", exec: "powershell.exe", label: "powershell" },

      { id: "cmd", exec: "cmd.exe", label: "cmd" },

    ];

  }



  // Linux (alpine/busybox): /bin/sh y /bin/ash existen; bash solo si lo instalas.

  return [

    { id: "sh", exec: "/bin/sh", label: "sh" },

    { id: "ash", exec: "/bin/ash", label: "ash" },

    { id: "bash", exec: "/bin/bash", label: "bash" },

  ];

}



export function listLocalShells(): ShellSpec[] {

  const cands = platformCandidates();

  // Solo filtramos rutas absolutas (en Windows dejamos exe por PATH)

  return cands.filter(s => (s.exec.startsWith("/") ? isExec(s.exec) : true));

}



export function resolveLocalShell(requested?: string) {

  const shells = listLocalShells();



  // Default seguro: sh si existe, si no el primero, si no /bin/sh

  const fallback =

    shells.find(s => s.id === "sh") ??

    shells[0] ??

    { id: "sh" as const, exec: "/bin/sh", label: "sh" };



  const req = (requested ?? "").trim().toLowerCase();



  const found = shells.find(s => s.id === req || s.exec.toLowerCase() === req);



  return {

    exec: (found ?? fallback).exec,

    id: (found ?? fallback).id,

    warning: found ? undefined : (requested ? `Shell '${requested}' no disponible. Usando ${fallback.exec}.` : undefined),

    shells,

    defaultShellId: fallback.id,

  };

}

