import type { Locator } from '@playwright/test';

/**
 * Derive a durable, human-reviewable selector for the element the model
 * picked. Runs deterministically in the page: the LLM only chooses the
 * element; it never writes the selector that gets committed.
 *
 * Priority: test-id attribute > #id > stable attributes > :nth-of-type path.
 * Every candidate is verified unique before being returned.
 */
export async function deriveDurableSelector(
  locator: Locator,
  testIdAttribute: string,
): Promise<string | null> {
  try {
    return await locator.evaluate(
      (el: Element, tia: string) => {
        const doc = el.ownerDocument;
        const unique = (sel: string): boolean => {
          try {
            return doc.querySelectorAll(sel).length === 1;
          } catch {
            return false;
          }
        };
        const quote = (v: string): string =>
          '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
        const tag = el.tagName.toLowerCase();

        const tid = el.getAttribute(tia);
        if (tid !== null) {
          const sel = `[${tia}=${quote(tid)}]`;
          if (unique(sel)) return sel;
        }

        if (el.id) {
          const sel = `#${CSS.escape(el.id)}`;
          if (unique(sel)) return sel;
        }

        for (const attr of ['name', 'aria-label', 'placeholder', 'title', 'alt', 'href', 'for']) {
          const v = el.getAttribute(attr);
          if (v) {
            const sel = `${tag}[${attr}=${quote(v)}]`;
            if (unique(sel)) return sel;
          }
        }

        // Structural fallback: shortest unique :nth-of-type path from el upwards.
        const parts: string[] = [];
        let node: Element | null = el;
        while (node && node.nodeType === 1) {
          let part = node.tagName.toLowerCase();
          const id: string = node.id;
          if (id) {
            parts.unshift(`#${CSS.escape(id)}`);
          } else {
            const parent: Element | null = node.parentElement;
            if (parent) {
              const same = Array.prototype.filter.call(
                parent.children,
                (c: Element) => c.tagName === node!.tagName,
              );
              if (same.length > 1) {
                part += `:nth-of-type(${Array.prototype.indexOf.call(same, node) + 1})`;
              }
            }
            parts.unshift(part);
          }
          const candidate = parts.join(' > ');
          if (unique(candidate)) return candidate;
          if (id) break;
          node = node.parentElement;
        }
        const fallback = parts.join(' > ');
        return unique(fallback) ? fallback : null;
      },
      testIdAttribute,
    );
  } catch {
    return null;
  }
}
