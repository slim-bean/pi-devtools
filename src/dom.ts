import type { Locator } from "playwright-core";

/**
 * Read-only structural outline, not HTML serialization or a composed/visible-text
 * tree. Walk light DOM and open shadow roots once each; do not expand slot assignments
 * or enter frames. Keep work and output bounded even on huge/deep pages.
 */
export async function inspectShadowDOM(locator: Locator, maxChars: number, timeout: number): Promise<string> {
  const budget = Number.isFinite(maxChars) ? Math.max(1, Math.min(50_000, Math.floor(maxChars))) : 20_000;
  return locator.evaluate((root, { budget }) => {
    const lines: string[] = [];
    let chars = 0;
    let visited = 0;
    let stopped = false;
    let truncated = false;

    // Object methods survive tsx/esbuild serialization without injected __name helpers.
    const visitor = {
      line(depth: number, text: string): void {
        if (stopped) return;
        const value = `${"  ".repeat(depth)}${text}\n`;
        const remaining = budget - chars;
        lines.push(value.slice(0, remaining));
        chars += Math.min(value.length, remaining);
        if (value.length > remaining) stopped = truncated = true;
      },

      short(value: string): string {
        return value.length > 500 ? `${value.slice(0, 500)}…[value truncated]` : value;
      },

      walk(node: Node, depth: number): void {
        if (stopped) return;
        if (++visited > 5000) {
          stopped = truncated = true;
          return;
        }
        if (depth > 40) {
          visitor.line(depth, "[depth limit; descendants omitted]");
          truncated = true;
          return;
        }
        if (node.nodeType === Node.TEXT_NODE) {
          const text = visitor.short(node.nodeValue ?? "").replace(/\s+/g, " ").trim();
          if (text) visitor.line(depth, JSON.stringify(text));
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const element = node as Element;
        // Never clone custom elements: cloning can invoke their constructors.
        let attrs = "";
        for (let i = 0; i < Math.min(element.attributes.length, 30); i++) {
          const attr = element.attributes[i];
          attrs += ` ${attr.name}=${JSON.stringify(visitor.short(attr.value))}`;
        }
        if (element.attributes.length > 30) attrs += " [attributes omitted]";
        visitor.line(depth, `<${element.localName}${attrs}>`);
        if (stopped) return;
        if (["script", "style", "template"].includes(element.localName)) {
          visitor.line(depth + 1, "[contents omitted]");
          return;
        }
        if (element.shadowRoot) {
          visitor.line(depth + 1, "#shadow-root (open)");
          for (let child = element.shadowRoot.firstChild; child && !stopped; child = child.nextSibling) {
            visitor.walk(child, depth + 2);
          }
        }
        for (let child = element.firstChild; child && !stopped; child = child.nextSibling) {
          visitor.walk(child, depth + 1);
        }
      },
    };

    visitor.walk(root, 0);
    return lines.join("").trimEnd() + (truncated
      ? "\n[shadow outline truncated: character, node (5000), or depth (40) limit; narrow the selector]"
      : "");
  }, { budget }, { timeout });
}
