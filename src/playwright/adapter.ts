import type { Page } from '@playwright/test';
import type { AnchorAdapter, HealProposal } from '../core/types.js';
import { deriveDurableSelector } from './derive.js';

export interface PlaywrightAdapterOptions {
  /** How long to wait for a selector before treating it as broken (ms). */
  resolveTimeout: number;
  /** Attribute used as the first choice for durable selectors. */
  testIdAttribute: string;
}

export class PlaywrightAdapter implements AnchorAdapter {
  constructor(
    private readonly page: Page,
    private readonly opts: PlaywrightAdapterOptions,
  ) {}

  async tryResolve(selector: string): Promise<boolean> {
    try {
      await this.page
        .locator(selector)
        .first()
        .waitFor({ state: 'attached', timeout: this.opts.resolveTimeout });
      return true;
    } catch {
      // TimeoutError (nothing attached) and invalid-selector errors both
      // mean "this selector is not usable right now".
      return false;
    }
  }

  async capture(): Promise<string> {
    // mode:'ai' (1.59+) emits [ref=eN] markers the model can point at.
    return this.page.locator('body').ariaSnapshot({ mode: 'ai' });
  }

  async materialize(proposal: HealProposal): Promise<string | null> {
    if (proposal.ref) {
      // Refs are scoped to the snapshot we just took — resolve transiently,
      // then derive a durable selector we can commit.
      const transient = this.page.locator(`aria-ref=${proposal.ref}`);
      try {
        if ((await transient.count()) === 0) return null;
      } catch {
        return null;
      }
      const durable = await deriveDurableSelector(transient.first(), this.opts.testIdAttribute);
      if (durable && (await this.tryResolve(durable))) return durable;
      return null;
    }
    if (proposal.selector) {
      if (await this.tryResolve(proposal.selector)) return proposal.selector;
    }
    return null;
  }
}
