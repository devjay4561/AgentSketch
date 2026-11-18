import './style-presets-panel.css';
import { t } from './i18n.ts';
import { editableNodeIds } from './organization.ts';
import { boardShapeColors, isPresetShape, SHAPE_THEMES, SHAPE_TONES } from './shape-themes.ts';
import type { FlowDocument, FlowNode } from './types.ts';

export function mountStylePresetsPanel(panel: HTMLElement, host: {
  getDocument: () => FlowDocument;
  getSelection: () => FlowNode[];
  mutate: (action: () => void) => void;
  confirmBoardTheme: (family: string) => Promise<boolean>;
  tidyBoard: () => void;
}) {
  const grid = panel.querySelector<HTMLElement>('.shape-swatches')!;
  const applyBoard = panel.querySelector<HTMLButtonElement>('.shape-apply-board')!;
  const cardText = panel.querySelector<HTMLButtonElement>('.shape-card-text')!;
  panel.querySelector<HTMLButtonElement>('.shape-tidy-board')!.addEventListener('click', () => host.tidyBoard());
  const cardTargets = () => { const editable = editableNodeIds(host.getDocument()); return host.getSelection().filter(n => isPresetShape(n) && n.kind !== 'frame' && editable.has(n.id) && !n.textRuns?.length && (!n.contentMode || n.contentMode === 'text')); };
  cardText.addEventListener('click', () => {
    const nodes = cardTargets(); if (!nodes.length) return;
    const on = !nodes.every(n => n.textStyle === 'card');
    host.mutate(() => { for (const node of nodes) { if (on) node.textStyle = 'card'; else delete node.textStyle; } });
  });
  const swatches = SHAPE_TONES.flatMap(tone => SHAPE_THEMES.map(theme => ({theme,tone,colors:theme[tone]})));
  let chosen = swatches[0];
  panel.addEventListener('keydown', event => {
    if (event.target instanceof HTMLButtonElement && (event.key === ' ' || event.key === 'Enter')) event.stopPropagation();
  });
  const matches = (node: FlowNode, colors: Pick<FlowNode, 'fill' | 'stroke' | 'color'>) =>
    node.fill.toUpperCase() === colors.fill && node.stroke.toUpperCase() === colors.stroke && node.color.toUpperCase() === colors.color;
  const buttons = swatches.map(swatch => {
    const button = document.createElement('button');
    const name = t(swatch.tone === 'soft' ? '{0} 연한 색' : '{0} 진한 색', swatch.theme.name);
    button.type = 'button'; button.title = name; button.setAttribute('aria-label', name);
    button.style.setProperty('--swatch-fill', swatch.colors.fill);
    button.style.setProperty('--swatch-stroke', swatch.colors.stroke);
    button.style.setProperty('--swatch-ink', swatch.colors.color);
    button.addEventListener('click', () => {
      chosen = swatch;
      const editable = editableNodeIds(host.getDocument());
      const nodes = host.getSelection().filter(n => isPresetShape(n) && editable.has(n.id) && !matches(n,swatch.colors));
      if (nodes.length) host.mutate(() => { for (const node of nodes) Object.assign(node, swatch.colors); });
    });
    grid.append(button);
    return button;
  });

  applyBoard.addEventListener('click', async () => {
    const doc = host.getDocument(), {theme,tone} = chosen;
    if (!await host.confirmBoardTheme(theme.name) || host.getDocument() !== doc) return;
    const editable = editableNodeIds(doc, true);
    const changes = doc.nodes.filter(n => isPresetShape(n) && editable.has(n.id))
      .map(node => ({node,colors:boardShapeColors(node,theme,tone)})).filter(({node,colors}) => !matches(node,colors));
    if (changes.length) host.mutate(() => { for (const {node,colors} of changes) Object.assign(node,colors); });
  });

  return (nodes: FlowNode[]) => {
    const shapes = nodes.filter(isPresetShape);
    panel.hidden = !shapes.length;
    if (!shapes.length) return;
    const common = swatches.find(swatch => shapes.every(node => matches(node,swatch.colors)));
    if (common) chosen = common;
    const editable = editableNodeIds(host.getDocument());
    const canApply = shapes.some(node => editable.has(node.id));
    buttons.forEach((button,i) => {
      button.disabled = !canApply;
      button.setAttribute('aria-pressed', String(swatches[i] === common));
    });
    applyBoard.textContent = t('보드 전체에 적용 · {0}', chosen.theme.name);
    const cards = cardTargets();
    cardText.disabled = !cards.length;
    cardText.setAttribute('aria-pressed', String(!!cards.length && cards.every(n => n.textStyle === 'card')));
  };
}
