import type { FlowDocument, FlowEdge, FlowNode } from './types.ts';
import type { NodeDetails } from './workspace-types.ts';

export type ReadinessStatus = 'ready' | 'blocked' | 'stale' | 'cycle' | 'untracked';
export interface NodeReadiness {
  nodeId: string;
  status: ReadinessStatus;
  ready: boolean;
  /** Human-readable reasons; readiness is separate from manually recorded completion. */
  reasons: string[];
  /** Immediate unsatisfied inputs, or this node for its own evidence problem. */
  blockers: string[];
  manualStatus?: NodeDetails['status'];
}
export interface WorkflowIssue { nodeId: string; code: string; message: string }
export interface WorkflowAnalysis {
  nodes: Map<string, NodeReadiness>;
  summary: { total: number; tracked: number; ready: number; blocked: number; stale: number; cycle: number; untracked: number; resources: number; steps: number };
  issues: WorkflowIssue[];
}

const blocking = (edge: FlowEdge) => edge.relation !== 'optional' && edge.relation !== 'reference';
const nonempty = (value: string | undefined) => Boolean(value?.trim());
const validDate = (value: string | undefined) => nonempty(value) && Number.isFinite(Date.parse(value!));

/** Literal string comparison only. No expressions, coercion or evaluation. The
 * caller supplies the node named by edge.condition.nodeId. */
export function evaluateEdgeCondition(edge: FlowEdge, node: FlowNode | undefined): 'active'|'inactive'|'unknown' {
  const condition = edge.condition;
  if (!condition) return 'active';
  if (!node || node.id !== condition.nodeId || typeof condition.value !== 'string'
    || !['equals','notEquals'].includes(condition.operator)) return 'unknown';
  const fields = node.details?.customFields;
  const value = condition.field === 'status' ? node.details?.status
    : fields && Object.hasOwn(fields,condition.field) ? fields[condition.field] : undefined;
  if (typeof value !== 'string') return 'unknown';
  const equal = value === condition.value;
  return (condition.operator === 'equals' ? equal : !equal) ? 'active' : 'inactive';
}

/**
 * Evaluate the local document only. This never opens a source or verifies its contents.
 * Missing relation means required; optional/reference edges never gate readiness.
 * Under "all", every required/output input and at least one alternative input must
 * be ready. Under "any", one blocking input is enough. Cycles require review even
 * when an alternative outside the cycle exists. A step's readiness describes its
 * prerequisites, not completion of the step itself.
 * A false conditional edge is excluded. An unknown blocking condition always
 * blocks the target, even under "any"; optional/reference conditions never gate.
 *
 * O(nodes + edges) retained data: no transitive closure, recursive traversal, timers,
 * source polling, or persistent per-document analysis cache.
 */
export function analyzeWorkflow(doc: FlowDocument, now: Date | string | number = Date.now()): WorkflowAnalysis {
  const timestamp = now instanceof Date ? now.getTime() : typeof now === 'string' ? Date.parse(now) : now;
  if (!Number.isFinite(timestamp)) throw new Error('자료 확인 기준 시간이 올바르지 않습니다.');
  const indices = new Map(doc.nodes.map((node, index) => [node.id, index]));
  const attachmentIds = new Set(doc.workspace?.attachments?.map(attachment => attachment.id) ?? []);
  const count = doc.nodes.length;
  const outgoing: number[][] = Array.from({length: count}, () => []);
  const incoming: {from: number; edge: FlowEdge}[][] = Array.from({length: count}, () => []);
  const missing = new Map<number, string[]>();
  const unknownConditions = new Map<number, {nodeId:string;field:string}[]>();
  const waived = new Uint8Array(count);
  const result: WorkflowAnalysis = {
    nodes: new Map(), issues: [],
    summary: {total: count, tracked: 0, ready: 0, blocked: 0, stale: 0, cycle: 0, untracked: 0, resources: 0, steps: 0},
  };
  for (const edge of doc.edges) {
    if (!blocking(edge)) continue;
    const from = indices.get(edge.from), to = indices.get(edge.to);
    if (to === undefined) continue;
    const conditionNode = edge.condition ? indices.get(edge.condition.nodeId) : undefined;
    const conditionState = evaluateEdgeCondition(edge, conditionNode === undefined ? undefined : doc.nodes[conditionNode]);
    if (conditionState === 'inactive') { waived[to] = 1; continue; }
    if (conditionState === 'unknown') {
      const list = unknownConditions.get(to) ?? [];
      list.push({nodeId:edge.condition!.nodeId,field:edge.condition!.field});
      unknownConditions.set(to,list);
    }
    if (from === undefined) {
      const list = missing.get(to) ?? []; list.push(edge.from); missing.set(to, list); continue;
    }
    outgoing[from].push(to); incoming[to].push({from, edge});
  }

  // Iterative Kosaraju: long dependency chains must not overflow the JS call stack.
  const seen = new Uint8Array(count), order: number[] = [];
  for (let start = 0; start < count; start++) {
    if (seen[start]) continue;
    seen[start] = 1;
    const stack: {id: number; next: number}[] = [{id:start,next:0}];
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (top.next === outgoing[top.id].length) { order.push(top.id); stack.pop(); continue; }
      const target = outgoing[top.id][top.next++];
      if (!seen[target]) { seen[target] = 1; stack.push({id:target,next:0}); }
    }
  }
  const component = new Int32Array(count).fill(-1), cyclic = new Uint8Array(count);
  let componentId = 0;
  for (let q = order.length - 1; q >= 0; q--) {
    const start = order[q]; if (component[start] !== -1) continue;
    const members: number[] = [], stack = [start]; component[start] = componentId;
    while (stack.length) {
      const current = stack.pop()!; members.push(current);
      for (const {from} of incoming[current]) if (component[from] === -1) { component[from] = componentId; stack.push(from); }
    }
    if (members.length > 1 || outgoing[start].includes(start)) for (const member of members) cyclic[member] = 1;
    componentId++;
  }

  function issue(nodeId: string, code: string, message: string) { result.issues.push({nodeId,code,message}); return message; }
  function conditionReasons(index: number) {
    return (unknownConditions.get(index) ?? []).map(condition => issue(doc.nodes[index].id,'condition-missing',`조건 필드 '${condition.field}'를 확인할 수 없습니다. 조건 요소와 입력값을 확인하세요.`));
  }
  function commit(node: FlowNode, status: ReadinessStatus, reasons: string[], blockers: string[] = []) {
    result.nodes.set(node.id, {nodeId: node.id, status, ready: status === 'ready', reasons, blockers: [...new Set(blockers)], ...(node.details?.status ? {manualStatus:node.details.status} : {})});
    result.summary[status]++;
    if (status !== 'untracked') result.summary.tracked++;
    if (node.details?.role === 'resource') result.summary.resources++;
    else if (node.details?.role === 'step' || status !== 'untracked') result.summary.steps++;
  }
  for (let i = 0; i < count; i++) if (cyclic[i]) {
    const node = doc.nodes[i];
    commit(node,'cycle',[issue(node.id,'cycle','선행 조건이 순환합니다. 조건 연결을 검토하세요.'),...conditionReasons(i)],[node.id]);
  }

  // Cycle nodes already have a result. Evaluate the remaining acyclic graph.
  const indegree = new Int32Array(count);
  const queue: number[] = [];
  for (let i = 0; i < count; i++) {
    if (cyclic[i]) continue;
    indegree[i] = incoming[i].reduce((n, input) => n + (cyclic[input.from] ? 0 : 1), 0);
    if (!indegree[i]) queue.push(i);
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi], node = doc.nodes[i], details = node.details;
    evaluate(node, details, incoming[i], missing.get(i) ?? [],i);
    for (const target of outgoing[i]) if (!cyclic[target] && --indegree[target] === 0) queue.push(target);
  }
  return result;

  function evaluate(node: FlowNode, details: NodeDetails | undefined, inputs: {from:number;edge:FlowEdge}[], missingIds: string[], index: number) {
    const unknownReasons = conditionReasons(index);
    const unknownIds = (unknownConditions.get(index) ?? []).map(condition=>condition.nodeId);
    const staleReasons: string[] = [];
    if (details?.status === 'stale') staleReasons.push(issue(node.id,'stale','자료를 다시 확인해야 합니다.'));
    if (details?.version && details.verifiedVersion && details.version !== details.verifiedVersion)
      staleReasons.push(issue(node.id,'version-changed','현재 버전이 확인한 버전과 다릅니다.'));
    if (details?.sourceFingerprint && details.verifiedSourceFingerprint && details.sourceFingerprint !== details.verifiedSourceFingerprint)
      staleReasons.push(issue(node.id,'source-changed','원본 자료가 확인 이후 변경되었습니다.'));
    if (details?.dueAt) {
      const deadline = /^\d{4}-\d{2}-\d{2}$/.test(details.dueAt) ? Date.parse(`${details.dueAt}T23:59:59.999`) : Date.parse(details.dueAt);
      if (!Number.isFinite(deadline)) staleReasons.push(issue(node.id,'invalid-expiry','재확인 기한의 날짜가 올바르지 않습니다.'));
      else if (deadline < timestamp) staleReasons.push(issue(node.id,'expired','재확인 기한이 지났습니다.'));
    }
    if (details?.reviewIntervalDays && validDate(details.checkedAt)
      && Date.parse(details.checkedAt!) + details.reviewIntervalDays * 86_400_000 < timestamp) {
      staleReasons.push(issue(node.id,'review-expired','설정한 재확인 주기가 지났습니다.'));
    }
    if (staleReasons.length) { commit(node,'stale',[...staleReasons,...unknownReasons],[node.id,...unknownIds]); return; }

    const reasons: string[] = [...unknownReasons], blockers: string[] = [...unknownIds];
    const incomplete = details?.checklist?.filter(item => !item.done).length ?? 0;
    if (incomplete) { reasons.push(issue(node.id,'checklist',`확인 목록 ${incomplete}개가 남아 있습니다.`)); blockers.push(node.id); }
    if (missingIds.length) { reasons.push(issue(node.id,'missing-input','존재하지 않는 선행 요소가 연결되어 있습니다.')); blockers.push(...missingIds); }

    if (details?.role === 'resource') {
      if (!nonempty(details.source) && !details.attachmentIds?.some(id => attachmentIds.has(id))) reasons.push(issue(node.id,'missing-source','자료의 원본 위치나 첨부 파일을 등록하세요.'));
      if (details.status !== 'verified') reasons.push(issue(node.id,'unverified', details.status === 'missing' || !details.status ? '자료를 확보하고 확인해야 합니다.' : '확보한 자료의 내용 확인이 필요합니다.'));
      else {
        if (!nonempty(details.checkedBy) || !validDate(details.checkedAt)) reasons.push(issue(node.id,'missing-confirmation','확인자와 확인일을 기록하세요.'));
        else if (Date.parse(details.checkedAt!) > timestamp + 60_000) reasons.push(issue(node.id,'future-confirmation','확인일이 현재보다 미래입니다.'));
        if (details.version && !details.verifiedVersion) reasons.push(issue(node.id,'missing-confirmed-version','확인한 자료 버전을 기록하세요.'));
        if (details.sourceFingerprint && !details.verifiedSourceFingerprint) reasons.push(issue(node.id,'missing-confirmed-source','원본 변경 정보를 확인한 뒤 확인 완료를 다시 기록하세요.'));
      }
      if (reasons.length) blockers.push(node.id);
    }

    const failed = (input: {from:number;edge:FlowEdge}) => !result.nodes.get(doc.nodes[input.from].id)?.ready;
    if (inputs.length) {
      const all = details?.requirement !== 'any';
      const required = inputs.filter(input => input.edge.relation !== 'alternative');
      const alternatives = inputs.filter(input => input.edge.relation === 'alternative');
      const unmet = all
        ? [...required.filter(failed), ...(alternatives.length && alternatives.every(failed) ? alternatives : [])]
        : inputs.every(failed) ? inputs : [];
      if (unmet.length) {
        reasons.push(issue(node.id,'blocked-inputs', all ? '필수 선행 조건 또는 대체 조건이 충족되지 않았습니다.' : '충족된 선행 조건이 하나 이상 필요합니다.'));
        blockers.push(...unmet.map(input => doc.nodes[input.from].id));
      }
    }

    if (reasons.length) { commit(node,'blocked',reasons,blockers); return; }
    if (details?.role === 'resource') { commit(node,'ready',['기록된 자료 확인 조건이 충족되었습니다. 원본 내용은 사용자가 확인한 기록을 기준으로 합니다.']); return; }
    if (inputs.length) { commit(node,'ready',['선행 조건이 충족되었습니다. 이 단계의 완료 여부는 별도 확인하세요.']); return; }
    if (waived[index]) { commit(node,'ready',['현재 조건에서 필요한 선행 자료가 없습니다. 이 단계의 완료 여부는 별도 확인하세요.']); return; }
    if (details?.status === 'verified') { commit(node,'ready',['선행 조건이 없는 단계로, 사용자가 확인 완료로 기록했습니다.']); return; }
    if (details?.status) { commit(node,'blocked',[issue(node.id,'unverified','시작 단계의 확인이 필요합니다.')],[node.id]); return; }
    commit(node,'untracked',['자료 또는 절차의 확인 기준을 아직 설정하지 않았습니다.']);
  }
}

/** Return reachable existing nodes, excluding the origin. Reference links and
 * conditional field providers are included, regardless of current activation,
 * so a later condition change can reveal its affected steps. These are tracing
 * relationships, not additional readiness or cycle constraints. */
export function traceNodes(doc: FlowDocument, id: string, direction: 'upstream'|'downstream'): Set<string> {
  const valid = new Set(doc.nodes.map(node => node.id));
  if (!valid.has(id)) return new Set();
  const adjacency = new Map<string, string[]>();
  const add = (source:string,target:string) => {
    if (!valid.has(source) || !valid.has(target)) return;
    const from = direction === 'upstream' ? target : source, to = direction === 'upstream' ? source : target;
    const list = adjacency.get(from) ?? []; list.push(to); adjacency.set(from,list);
  };
  for (const edge of doc.edges) {
    add(edge.from,edge.to);
    if (edge.condition) add(edge.condition.nodeId,edge.to);
  }
  const visited = new Set([id]), stack = [id];
  while (stack.length) for (const to of adjacency.get(stack.pop()!) ?? []) if (!visited.has(to)) { visited.add(to); stack.push(to); }
  visited.delete(id); return visited;
}
