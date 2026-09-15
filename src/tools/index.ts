import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { DevtoolsSession } from "../session";
import { registerConsole } from "./console";
import { registerDom } from "./dom";
import { registerEval } from "./eval";
import { registerInteract } from "./interact";
import { registerNavigate } from "./navigate";
import { registerNetwork } from "./network";
import { registerScreenshot } from "./screenshot";
import type { ToolRegistrar } from "./shared";
import { registerTabs } from "./tabs";
import { registerWait } from "./wait";

/** Registration order is the order tools appear in the system prompt. */
const REGISTRARS: ToolRegistrar[] = [
  registerNavigate,
  registerTabs,
  registerConsole,
  registerNetwork,
  registerEval,
  registerDom,
  registerScreenshot,
  registerInteract,
  registerWait,
];

export function registerTools(pi: ExtensionAPI, session: DevtoolsSession): void {
  for (const register of REGISTRARS) register(pi, session);
}
