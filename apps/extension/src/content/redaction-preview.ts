import { RedactionPlanSchema } from '@tasktwin/privacy-engine';

const PREVIEW_ROOT_ATTRIBUTE = 'data-tasktwin-redaction-preview';
const PREVIEW_REGION_ATTRIBUTE = 'data-tasktwin-redaction-region';

export class RedactionPreviewRenderer {
  private root: HTMLDivElement | null = null;

  constructor(private readonly document: Document) {}

  show(plan: unknown): void {
    const validatedPlan = RedactionPlanSchema.parse(plan);
    this.clear();

    if (validatedPlan.regions.length === 0) {
      return;
    }

    const root = this.document.createElement('div');
    root.setAttribute(PREVIEW_ROOT_ATTRIBUTE, 'true');
    root.setAttribute('aria-hidden', 'true');
    Object.assign(root.style, {
      inset: '0',
      overflow: 'hidden',
      pointerEvents: 'none',
      position: 'fixed',
      zIndex: '2147483647',
    });

    for (const region of validatedPlan.regions) {
      const overlay = this.document.createElement('div');
      overlay.setAttribute(PREVIEW_REGION_ATTRIBUTE, region.id);
      Object.assign(overlay.style, {
        background: 'rgba(30, 41, 59, 0.72)',
        height: `${region.height}px`,
        left: `${region.x}px`,
        pointerEvents: 'none',
        position: 'absolute',
        top: `${region.y}px`,
        width: `${region.width}px`,
      });
      root.append(overlay);
    }

    this.document.documentElement.append(root);
    this.root = root;
  }

  clear(): void {
    this.root?.remove();
    this.root = null;
  }
}
