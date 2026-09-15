import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { formatDimensionNote, resizeImage } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { whereAmI } from "../format";
import {
  ACTION_TIMEOUT_MS,
  explain,
  withAbort,
  type ImageContent,
  type TextContent,
  type ToolRegistrar,
} from "./shared";

/** Keep screenshots within what vision models handle well and what a tool result should cost. */
const MAX_DIM = 1568;
const MAX_BYTES = 3 * 1024 * 1024;

const parameters = Type.Object({
  fullPage: Type.Optional(Type.Boolean({ description: "Capture the whole scrollable page, not just the viewport (default false)." })),
  selector: Type.Optional(
    Type.String({ description: "Capture only this element (CSS or Playwright selector). Overrides fullPage." }),
  ),
  path: Type.Optional(
    Type.String({ description: "Also save the PNG here (absolute, or relative to the working directory)." }),
  ),
});

export const registerScreenshot: ToolRegistrar = (pi, session) => {
  pi.registerTool({
    name: "browser_screenshot",
    label: "Browser Screenshot",
    description:
      "Screenshot the current tab (viewport, full page, or one element) and return it as an image. " +
      "Captured at CSS-pixel scale and downsized if large. Use for layout, styling and 'what does the " +
      "user actually see' questions; use browser_dom or browser_eval to read text and state.",
    promptSnippet: "Screenshot the live page or an element (returned as an image)",
    parameters,
    async execute(_id, params, signal, _onUpdate, ctx) {
      const page = await session.getPage();
      let png: Buffer;
      try {
        const shot = params.selector
          ? page.locator(params.selector).first().screenshot({ type: "png", scale: "css", timeout: ACTION_TIMEOUT_MS })
          : page.screenshot({ type: "png", scale: "css", fullPage: params.fullPage ?? false, timeout: ACTION_TIMEOUT_MS });
        png = await withAbort(shot, signal);
      } catch (e) {
        throw explain(e);
      }

      const notes = [`Screenshot of ${await whereAmI(page)}`];
      if (params.selector) notes.push(`element: ${params.selector}`);
      else if (params.fullPage) notes.push("full page");

      if (params.path) {
        const abs = resolve(ctx.cwd, params.path);
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, png);
        notes.push(`saved to ${abs}`);
      }

      let data = png.toString("base64");
      let mimeType = "image/png";
      const resized = await resizeImage(new Uint8Array(png), mimeType, {
        maxWidth: MAX_DIM,
        maxHeight: MAX_DIM,
        maxBytes: MAX_BYTES,
      }).catch(() => null);
      if (resized) {
        data = resized.data;
        mimeType = resized.mimeType;
        const dim = formatDimensionNote(resized);
        notes.push(dim ?? `${resized.width}x${resized.height}px`);
      }

      const content: Array<TextContent | ImageContent> = [
        { type: "text", text: notes.join("\n") },
        { type: "image", data, mimeType },
      ];
      return { content, details: { bytes: png.length, path: params.path ?? null } };
    },
  });
};
