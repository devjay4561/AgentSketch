import { createNode, emptyDocument, uid } from './model.ts';
import type { FlowDocument, FlowEdge, FlowNode, ShapeKind } from './types.ts';
import { SHAPE_THEMES } from './shape-themes.ts';
import { DEFAULT_CONNECTOR } from './style-defaults.ts';
import { PALETTE } from './theme.ts';
import { t } from './i18n.ts';

type TemplateName = 'blank' | 'launch' | 'simple';
const [slate, blue, teal, amber, violet] = SHAPE_THEMES;

/** Editable teaching examples only. */
export function createSample(which: TemplateName = 'launch'): FlowDocument {
  const doc = emptyDocument();
  if (which === 'blank') return doc;

  function node(kind: ShapeKind, x: number, y: number, text: string, style: Partial<FlowNode>): FlowNode {
    const item = { ...createNode(kind, x, y), text:t(text), ...style };
    doc.nodes.push(item);
    return item;
  }

  function edge(from: FlowNode, to: FlowNode, style: Partial<FlowEdge> = {}): void {
    const {label = '', ...appearance} = style;
    doc.edges.push({
      id: uid(), from: from.id, to: to.id, fromPort: 'right', toPort: 'left',
      label: t(label), ...DEFAULT_CONNECTOR, style: 'elbow', dashed: false, arrow: 'end', ...appearance,
    });
  }

  function heading(x: number, y: number, text: string, w: number, size: number, bold = false) {
    node('text', x-14, y, text, {w:w+14,h:size*1.45+12,fontSize:size,bold,color:bold&&size>20?PALETTE.ink:PALETTE.muted});
  }

  if (which === 'simple') {
    doc.title = t('간단한 업무 흐름');
    heading(0, 0, '처음부터 끝까지, 한눈에.', 880, 32, true);
    heading(0, 53, '도형을 움직이고, 글을 바꾸고, 필요한 단계를 더해 보세요.', 880, 17);
    heading(0, 121, '준비', 210, 16, true);
    heading(330, 121, '판단', 238, 16, true);
    heading(670, 121, '진행', 220, 16, true);
    const ready = node('round', 0, 211, '자료 준비', {w:210,h:88,fontSize:22,bold:true,...blue.solid});
    const check = node('diamond', 330, 165, '조건을\n충족했나요?', {w:238,h:180,fontSize:22,bold:true,...violet.solid});
    const proceed = node('round', 670, 211, '다음 단계 진행', {w:220,h:88,fontSize:22,bold:true,...teal.solid});
    const revise = node('note', 330, 438, '부족한 자료 보완', {w:238,h:68,fontSize:19,...amber.soft});
    edge(ready, check);
    edge(check, proceed, {label:'예',color:teal.solid.stroke});
    edge(check, revise, {fromPort:'bottom',toPort:'top',label:'아니요'});
    edge(revise, ready, {fromPort:'left',toPort:'bottom',dashed:true,label:'다시 확인',labelPosition:.39});
    doc.viewport = {x:50,y:35,zoom:.95};
    return doc;
  }

  doc.title = t('서비스 출시 준비 지도');
  heading(0, 0, '서비스 출시, 무엇이 먼저 필요할까요?', 1130, 34, true);
  heading(0, 55, '설명용 예시입니다. 실제 일정과 기준은 각 담당자와 확인하세요.', 1130, 18);
  heading(0, 121, '준비 자료 확인', 220, 16, true);
  heading(310, 121, '자료 연결 · 점검', 220, 16, true);
  heading(620, 121, '출시 범위 정리', 220, 16, true);
  heading(930, 121, '출시 준비', 220, 16, true);

  const sourceStyle = {w:220,h:72,fontSize:16,align:'left'} satisfies Partial<FlowNode>;
  const design = node('rect', 0, 165, '디자인 · 화면 시안\n최종 시안 / 접근성 검토', {...sourceStyle,...slate.soft});
  const feature = node('rect', 0, 259, '개발 · 기능 구현\n완료 이슈 / 변경 기록', {...sourceStyle,...blue.soft});
  const tests = node('rect', 0, 353, 'QA · 수동 점검\n주요 시나리오 / 회귀 점검', {...sourceStyle,...teal.soft});
  const support = node('rect', 0, 447, '지원 · 안내 문서\n자주 묻는 질문 / 사용안내', {...sourceStyle,...slate.soft});

  const mainStyle = {w:220,h:104,fontSize:18,bold:true};
  const quality = node('round', 310, 243, '품질 점검 결과\n자동 테스트 + 수동 점검', {...mainStyle,...blue.solid});
  const scope = node('round', 620, 243, '출시 범위 정리\n완료된 기능을 모아\n변경 내역을 확인합니다.', {...mainStyle,...teal.solid});
  const launch = node('round', 930, 243, '출시 준비\n자료와 선행 확인 정리', {...mainStyle,...amber.solid});
  const approval = node('round', 930, 442, '담당자 확인\n최종 검토 · 출시 결정', {...mainStyle,h:86,bold:false,...amber.soft});
  node('note', 620, 442, '설명도 함께 붙이세요\n화면 캡처는 Ctrl+V', {w:220,h:86,fontSize:17,...violet.soft});

  for (const [item, area] of [[design,'디자인'],[feature,'개발'],[tests,'QA'],[support,'지원']] as const) {
    item.details = {role:'resource',sourceSystem:t(area),status:'missing',notes:t('설명용 자료입니다. 실제 원본을 연결하고 내용을 직접 확인하세요.')};
  }
  for (const item of [quality,scope,launch,approval]) item.details = {role:'step',status:'missing',requirement:'all'};
  launch.details!.checklist = [{id:uid(),text:t('준비 자료와 점검 결과를 직접 확인'),done:false}];

  edge(design, scope, {toPort:'top'});
  edge(feature, quality);
  edge(tests, quality, {toPort:'bottom'});
  edge(support, scope, {toPort:'bottom',dashed:true,waypoints:[{x:730,y:416}]});
  edge(quality, scope, {color:blue.solid.stroke});
  edge(scope, launch, {color:teal.solid.stroke});
  edge(launch, approval, {fromPort:'bottom',toPort:'top',color:amber.soft.color,label:'내용 확인'});
  doc.viewport = {x:40,y:40,zoom:.8};
  return doc;
}
