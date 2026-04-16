/**
 * macOS Native Notifications
 */

import { runOsascript, type OsascriptResult } from "./osascriptBridge";

export async function showNotification(
  message: string,
  options: {
    title?: string;
    subtitle?: string;
    sound?: string; // "default", "Basso", "Blow", "Bottle", "Frog", "Funk", "Glass", "Hero", "Morse", "Ping", "Pop", "Purr", "Sosumi", "Submarine", "Tink"
  } = {}
): Promise<OsascriptResult> {
  const title = (options.title || "ILIAGPT").replace(/"/g, '\\"');
  const subtitle = options.subtitle ? `subtitle "${options.subtitle.replace(/"/g, '\\"')}"` : "";
  const sound = options.sound ? `sound name "${options.sound}"` : 'sound name "default"';
  const safeMsg = message.replace(/"/g, '\\"');

  return runOsascript(
    `display notification "${safeMsg}" with title "${title}" ${subtitle} ${sound}`
  );
}

export async function showAlert(
  message: string,
  options: {
    title?: string;
    buttons?: string[];
    defaultButton?: string;
    icon?: "stop" | "note" | "caution";
  } = {}
): Promise<{ success: boolean; buttonReturned: string }> {
  const title = (options.title || "ILIAGPT").replace(/"/g, '\\"');
  const safeMsg = message.replace(/"/g, '\\"');
  const buttons = options.buttons?.length
    ? `buttons {${options.buttons.map((b) => `"${b.replace(/"/g, '\\"')}"`).join(", ")}}`
    : 'buttons {"OK"}';
  const defaultBtn = options.defaultButton
    ? `default button "${options.defaultButton.replace(/"/g, '\\"')}"`
    : "";
  const icon = options.icon ? `with icon ${options.icon}` : "";

  const r = await runOsascript(
    `display alert "${title}" message "${safeMsg}" ${buttons} ${defaultBtn} ${icon}`
  );

  const btnMatch = r.output.match(/button returned:(.+)/);
  return {
    success: r.success,
    buttonReturned: btnMatch?.[1]?.trim() || "OK",
  };
}

export async function showDialog(
  message: string,
  options: {
    title?: string;
    defaultAnswer?: string;
    buttons?: string[];
    icon?: "stop" | "note" | "caution";
    hiddenAnswer?: boolean;
  } = {}
): Promise<{ success: boolean; text: string; buttonReturned: string }> {
  const title = options.title ? `with title "${options.title.replace(/"/g, '\\"')}"` : "";
  const safeMsg = message.replace(/"/g, '\\"');
  const defaultAnswer = options.defaultAnswer !== undefined
    ? `default answer "${options.defaultAnswer.replace(/"/g, '\\"')}"`
    : "";
  const hidden = options.hiddenAnswer ? "with hidden answer" : "";
  const buttons = options.buttons?.length
    ? `buttons {${options.buttons.map((b) => `"${b.replace(/"/g, '\\"')}"`).join(", ")}}`
    : "";
  const icon = options.icon ? `with icon ${options.icon}` : "";

  const r = await runOsascript(
    `display dialog "${safeMsg}" ${defaultAnswer} ${buttons} ${title} ${icon} ${hidden}`
  );

  const btnMatch = r.output.match(/button returned:(.+?)(?:,|$)/);
  const textMatch = r.output.match(/text returned:(.+)/);

  return {
    success: r.success,
    text: textMatch?.[1]?.trim() || "",
    buttonReturned: btnMatch?.[1]?.trim() || "",
  };
}

export async function sayText(
  text: string,
  options: { voice?: string; rate?: number } = {}
): Promise<OsascriptResult> {
  const safe = text.replace(/"/g, '\\"');
  const voice = options.voice ? `using "${options.voice}"` : "";
  const rate = options.rate ? `speaking rate ${options.rate}` : "";
  return runOsascript(`say "${safe}" ${voice} ${rate}`);
}
