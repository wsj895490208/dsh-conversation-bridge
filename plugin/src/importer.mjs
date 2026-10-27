import { readFileSync } from 'node:fs';
import { hash, requireValue } from './util.mjs';

export const visibleTypes = new Set(['REQUEST', 'RESPONSE', 'FILE']);
export function fragments(node) { return node?.message?.fragments || []; }
export function chain(mapping, leaf) {
  const result = []; const seen = new Set(); let current = String(leaf);
  while (current !== null) {
    requireValue(mapping[current] && !seen.has(current), 'invalid_graph', '分支存在缺失节点或循环', { node: current });
    seen.add(current); result.push(current);
    const parent = mapping[current].parent; current = parent == null ? null : String(parent);
  }
  return result.reverse();
}
export function validateGraph(conversation) {
  const map = conversation.mapping;
  requireValue(map && typeof map === 'object' && !Array.isArray(map), 'invalid_export', '对话缺少 mapping');
  const roots = Object.keys(map).filter(k => map[k].parent == null);
  requireValue(roots.length === 1, 'invalid_graph', '每段对话必须恰有一个根节点');
  for (const [key, node] of Object.entries(map)) {
    requireValue(String(node.id) === key && Array.isArray(node.children), 'invalid_graph', '节点标识或 children 不合法', { node:key });
    if (node.parent != null) requireValue(map[String(node.parent)]?.children?.map(String).includes(key), 'invalid_graph', '父子引用不一致', { node:key });
    for (const child of node.children) requireValue(map[String(child)] && String(map[String(child)].parent) === key, 'invalid_graph', '子节点不存在或反向引用不一致', { node:key });
  }
  const visited = new Set(); const queue = [roots[0]];
  while (queue.length) { const key = queue.pop(); requireValue(!visited.has(key), 'invalid_graph', '存在循环或重复子引用'); visited.add(key); queue.push(...map[key].children.map(String)); }
  requireValue(visited.size === Object.keys(map).length, 'invalid_graph', '存在未连通节点');
  return map;
}
export function normalize(conversation, leaf) {
  const mapping = validateGraph(conversation);
  requireValue(mapping[String(leaf)] && mapping[String(leaf)].children.length === 0, 'invalid_leaf', '请选择完整分支的末节点');
  const path = chain(mapping,leaf); const messages = []; const attachments = new Map();
  for (const nodeId of path) {
    const node = mapping[nodeId]; const source = node.message;
    if (source == null) continue;
    const fs = fragments(node);
    const roles = new Set(fs.filter(f => ['REQUEST','RESPONSE'].includes(f.type)).map(f=> f.type));
    requireValue(roles.size < 2, 'mixed_roles', '单个节点同时含用户和助手正文，需人工检查', { node:nodeId });
    const visible = fs.filter(f => visibleTypes.has(f.type));
    if (!visible.length) continue;
    const role = roles.has('RESPONSE') ? 'assistant' : 'user';
    const text = visible.filter(f=>['REQUEST','RESPONSE'].includes(f.type)).map(f=> {
      requireValue(typeof f.content === 'string', 'invalid_content', '原文正文不是字符串', { node:nodeId }); return f.content;
    }).join('\n\n');
    for (const f of visible.filter(f=>f.type==='FILE')) for (const a of f.files || []) {
      requireValue(typeof a.file_id === 'string', 'invalid_attachment', '附件缺少标识');
      if (!attachments.has(a.file_id)) attachments.set(a.file_id, { ...a, nodes:[], status:'missing' });
      attachments.get(a.file_id).nodes.push(nodeId);
    }
    messages.push({ index:messages.length+1, nodeId, parentId:node.parent, role, time:source.inserted_at || null, model:source.model || 'deepseek-web-unknown', text, visible, thinking:fs.filter(f=>f.type==='THINK'), sourceFragments:fs });
  }
  requireValue(messages.length > 0, 'empty_branch', '该分支没有可导入消息');
  return { messages, attachments:[...attachments.values()], path, statistics: {
    graphNodes:Object.keys(mapping).length, pathNodes:path.length, messages:messages.length,
    userMessages:messages.filter(m=>m.role==='user').length, assistantMessages:messages.filter(m=>m.role==='assistant').length,
    textMessages:messages.filter(m=>m.text.length>0).length, textCharacters:messages.reduce((n,m)=>n+m.text.length,0),
    attachmentOnly:messages.filter(m=>m.role==='user'&&!m.text).length, attachments:attachments.size, leaf:String(leaf),
  } };
}
export function scanFile(path) {
  const bytes = readFileSync(path);
  requireValue(bytes.length <= 200*1024*1024, 'file_too_large', 'JSON 导出上限为200MiB');
  let all; try { all=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')); } catch { requireValue(false,'invalid_json','无法解析JSON导出'); }
  requireValue(Array.isArray(all), 'invalid_export', '导出应为对话数组');
  return { sha256:hash(bytes), bytes:bytes.length, conversations:all.map(c => {
    const map = validateGraph(c); const leaves = Object.keys(map).filter(k=>map[k].children.length===0);
    return { id:c.id, title:c.title || '(未命名)', createdAt:c.inserted_at, updatedAt:c.updated_at,
      nodes:Object.keys(map).length, currentNode:c.current_node || null,
      branches:leaves.map(leaf=> {
        const path = chain(map,leaf); const selected = path.filter(k=>map[k].message);
        const tail = selected.slice(-4).map(k=>({ node:k, text:fragments(map[k]).filter(f=>['REQUEST','RESPONSE'].includes(f.type)).map(f=>String(f.content)).join('\n').slice(-700) }));
        return { leaf, nodes:path.length, messages:selected.length, lastTime:map[leaf].message?.inserted_at, tail };
      }) };
  }) };
}
export function selectedFile(path, conversationId, leaf) {
  const all = JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,'')); const matches=all.filter(c=>c.id===conversationId);
  requireValue(matches.length===1,'conversation_not_found','无法唯一定位选中对话');
  return { conversation:matches[0], ...normalize(matches[0],leaf) };
}
export function messageBody(message) {
  return message.visible.map(f=>f.type==='FILE' ? (f.files||[]).map(a=>`[历史附件：${a.file_name}；ID=${a.file_id}；未取得本体时不得假装已读取]`).join('\n') : f.content).join('\n\n');
}
