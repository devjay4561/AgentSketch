import { createNode, emptyDocument, uid } from './model.ts';
import type { FlowDocument, FlowEdge, FlowNode, ShapeKind } from './types.ts';
import { PALETTE } from './theme.ts';

type TemplateName = 'blank' | 'launch' | 'simple';

/** Editable teaching examples only. These are not executable business rules. */
export function createSample(which: TemplateName = 'launch'): FlowDocument {
  const doc = emptyDocument();
  if (which === 'blank') return doc;

  function node(kind: ShapeKind, x: number, y: number, text: string, style: Partial<FlowNode> = {}): FlowNode {
    const item = { ...createNode(kind, x, y), text, ...style };
    doc.nodes.push(item);
    return item;
  }

  function edge(from: FlowNode, to: FlowNode, style: Partial<FlowEdge> = {}): void {
    doc.edges.push({
      id: uid(), from: from.id, to: to.id, fromPort: 'right', toPort: 'left',
      label: '', color: PALETTE.line, width: 2, style: 'elbow', dashed: false, arrow: 'end',
      ...style,
    });
  }

  if (which === 'simple') {
    doc.title = '간단한 업무 흐름';
    node('text', 90, 70, '처음부터 끝까지, 한눈에.', {
      w: 900, h: 55, fontSize: 32, bold: true, align: 'left', color: PALETTE.ink,
    });
    node('text', 90, 128, '도형을 움직이고, 글을 바꾸고, 필요한 단계를 더해 보세요.', {
      w: 900, h: 40, fontSize: 17, align: 'left', color: PALETTE.muted,
    });
    const ready = node('round', 90, 285, '자료 준비', {
      w: 200, h: 100, fill: '#EDF2F8', stroke: '#9AA9BB', color: '#344256', fontSize: 22, bold: true,
    });
    const check = node('diamond', 390, 245, '조건을\n충족했나요?', {
      w: 220, h: 180, fill: PALETTE.note, stroke: PALETTE.noteBorder, color: '#91451A', fontSize: 20, bold: true,
    });
    const proceed = node('round', 760, 285, '다음 단계 진행', {
      w: 240, h: 100, fill: PALETTE.accent, stroke: PALETTE.accentText, color: PALETTE.ink, fontSize: 22, bold: true,
    });
    const revise = node('note', 390, 560, '부족한 자료 보완', {
      w: 220, h: 100, fill: '#FFE9D6', stroke: '#E7B38F', color: '#7C2D12', fontSize: 19,
    });
    edge(ready, check);
    edge(check, proceed, { label: '예', color: PALETTE.accentText });
    edge(check, revise, { fromPort: 'bottom', toPort: 'top', label: '아니요', color: PALETTE.line });
    edge(revise, ready, { fromPort: 'left', toPort: 'bottom', dashed: true, label: '다시 확인' });
    doc.viewport = { x: 50, y: 25, zoom: 0.9 };
    return doc;
  }

  doc.title = '서비스 출시 준비 지도';
  node('text', 50, 35, '서비스 출시, 무엇이 먼저 필요할까요?', {
    w: 1330, h: 62, fontSize: 32, bold: true, align: 'left', color: PALETTE.ink,
  });
  node('text', 50, 102, '설명용 예시입니다. 실제 일정과 기준은 각 담당자와 확인하세요.', {
    w: 1330, h: 38, fontSize: 17, align: 'left', color: PALETTE.muted,
  });

  const stageStyle = { w: 260, h: 34, fontSize: 16, bold: true, align: 'left' as const, color: PALETTE.muted };
  node('text', 50, 160, '준비 자료 확인', stageStyle);
  node('text', 410, 160, '자료 연결 · 점검', { ...stageStyle, w: 650 });
  node('text', 1160, 160, '출시 준비', { ...stageStyle, color: PALETTE.accentText });

  const sourceStyle = { w: 240, h: 76, fontSize: 17, align: 'left' as const, strokeWidth: 1.5 };
  const slate = { fill: '#F1F5F9', stroke: '#9AA9BB', color: '#344256' };
  const blue = { fill: '#EBF3FF', stroke: '#89A5CC', color: '#344D71' };
  const gray = { fill: '#EEF0F7', stroke: '#A0A9BF', color: '#48536A' };
  const design = node('round', 50, 215, '디자인 · 화면 시안\n최종 시안 / 접근성 검토', { ...sourceStyle, ...slate });
  const feature = node('round', 50, 315, '개발 · 기능 구현\n완료 이슈 / 변경 기록', { ...sourceStyle, ...blue });
  const autoTest = node('round', 50, 415, '개발 · 자동 테스트\n단위 / 통합 테스트 결과', { ...sourceStyle, ...blue });
  const manualTest = node('round', 50, 515, 'QA · 수동 점검\n주요 시나리오 / 회귀 점검', { ...sourceStyle, ...gray });
  const marketing = node('round', 50, 615, '마케팅 · 홍보 자료\n소개 문구 / 스크린샷', { ...sourceStyle, ...blue });
  const support = node('round', 50, 715, '지원 · 안내 문서\n자주 묻는 질문 / 사용안내', { ...sourceStyle, ...slate });

  const quality = node('round', 420, 430, '품질 점검 결과\n자동 테스트 + 수동 점검', {
    w: 255, h: 112, fill: PALETTE.note, stroke: PALETTE.noteBorder, color: '#91451A', fontSize: 18, bold: false,
  });
  const scope = node('round', 800, 305, '출시 범위 정리\n완료된 기능을 모아\n변경 내역을 확인합니다.', {
    w: 245, h: 145, fill: '#FFFFFF', stroke: '#98A8BF', color: '#344256', fontSize: 19, bold: false,
  });
  const launch = node('round', 1160, 340, '출시 준비\n자료와 선행 확인을\n한곳에 정리합니다.', {
    w: 240, h: 145, fill: PALETTE.accent, stroke: PALETTE.accentText, color: PALETTE.ink, fontSize: 21, bold: true,
  });
  const approval = node('round', 1160, 610, '담당자 확인\n최종 검토 · 출시 결정', {
    w: 240, h: 100, fill: '#FFF3EB', stroke: '#E7B38F', color: '#91451A', fontSize: 18,
  });
  for (const [item, system] of [[design, '디자인'], [feature, '개발'], [autoTest, '개발'], [manualTest, 'QA'], [marketing, '마케팅'], [support, '지원']] as const) {
    item.details = { role: 'resource', sourceSystem: system, status: 'missing', notes: '설명용 자료입니다. 실제 원본을 연결하고 내용을 직접 확인하세요.' };
  }
  for (const item of [quality, scope, launch, approval]) item.details = { role: 'step', status: 'missing', requirement: 'all' };
  launch.details!.checklist = [{ id: uid(), text: '준비 자료와 점검 결과를 직접 확인', done: false }];
  node('note', 800, 605, '설명도 함께 붙이세요\n\n화면 캡처는 Ctrl+V\n이미지 위에 글을 쓰고\n연결선으로 관계를 표현하세요.', {
    w: 260, h: 185, fill: PALETTE.note, stroke: PALETTE.noteBorder, color: '#7C2D12', fontSize: 17, align: 'left',
  });

  edge(design, scope, { color: '#8798AE', toPort: 'top' });
  edge(feature, scope, { color: '#819BC0' });
  edge(autoTest, quality, { color: '#819BC0', toPort: 'top' });
  edge(manualTest, quality, { color: '#8B97AF', toPort: 'bottom' });
  edge(marketing, scope, { color: '#819BC0', toPort: 'bottom', dashed: true });
  edge(quality, scope, { color: '#D58A57', toPort: 'bottom' });
  edge(scope, launch, { color: PALETTE.accent, width: 2.5 });
  edge(support, launch, { color: '#8798AE', toPort: 'bottom', dashed: true });
  edge(launch, approval, { fromPort: 'bottom', toPort: 'top', color: PALETTE.accentText, label: '내용 확인' });
  doc.viewport = { x: 30, y: 35, zoom: 0.72 };
  return doc;
}
