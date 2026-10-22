export const TEXT_MESSAGE_LIMIT = 2000;
export const TEXT_PREVIEW_LIMIT = 1024 * 1024;
export const textLength = (text: string): number => Array.from(text).length;
const formats: Record<string, string> = {
  python:'py',py:'py',yaml:'yaml',yml:'yaml',json:'json',jsonc:'jsonc',log:'log',logs:'log',
  sql:'sql',bash:'sh',shell:'sh',sh:'sh',powershell:'ps1',ps1:'ps1',javascript:'js',js:'js',
  typescript:'ts',ts:'ts',xml:'xml',html:'html',css:'css',markdown:'md',md:'md',text:'txt',txt:'txt',
  toml:'toml',ini:'ini',dockerfile:'dockerfile',rust:'rs',go:'go',java:'java',cpp:'cpp',c:'c',csharp:'cs',
};
export function isTextFile(name: string): boolean {
  return /\.(md|markdown|txt|py|ya?ml|json[cl]?|log|sql|sh|bash|ps1|[cm]?js|jsx|ts|tsx|xml|html?|css|scss|toml|ini|conf|cfg|csv|rs|go|java|cpp|c|h|cs|dockerfile)$/i.test(name) || /^(Dockerfile|Makefile|\.env(?:\..+)?)$/i.test(name);
}
export function prepareTextFile(original: string): {name: string; content: string} {
  const fenced = /^```([\w+-]+)[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*(?:\r?\n)?$/.exec(original);
  if (fenced && formats[fenced[1].toLowerCase()]) return {name: `snippet.${formats[fenced[1].toLowerCase()]}`, content: fenced[2]};
  // Preserve mixed prose and code together, including unknown fenced languages.
  if (original.includes('```')) return {name:'message.md',content:original};
  const text=original.trim();let name='message.md';
  try { if (/^[\[{]/.test(text) && typeof JSON.parse(text)==='object') name='data.json'; } catch { /* Invalid JSON stays editable text. */ }
  if(name==='message.md'){
    if(/^#!.*\bpython[\d.]*/.test(text) || (/^(?:async )?def \w+\([^\n]*\):\s*$/m.test(text) && /^\s+\S/m.test(text))) name='snippet.py';
    else if(/^#!.*\b(?:ba|z|da)?sh\b/.test(text)) name='script.sh';
    else if(/^#requires\s+-version /im.test(text) || (/^param\s*\(/im.test(text)&&/\$\w+/.test(text))) name='script.ps1';
    else if((text.match(/^\[?\d{4}-\d\d-\d\d[^\n]*\b(?:INFO|WARN|ERROR|DEBUG|TRACE|FATAL)\b/gm)||[]).length>=2) name='output.log';
    else if(/^(?:SELECT\s+[\s\S]+\s+FROM\s+|CREATE\s+TABLE\s+|INSERT\s+INTO\s+)/i.test(text)&&/;\s*$/.test(text)) name='query.sql';
    else if(/^<\?xml\s/.test(text)) name='document.xml';
    else if(/^<!doctype html\b/i.test(text)) name='document.html';
    else if(/^(?:export\s+)?(?:interface|type)\s+\w+[\s\S]*[={]/m.test(text)&&/[;{}]/.test(text)) name='snippet.ts';
    else if(/^(?:import .* from ['"]|(?:export )?(?:const|let) \w+\s*=)/m.test(text)&&/(?:=>|function\s*\(|;\s*$)/m.test(text)) name='snippet.js';
    else if(((/^---\r?\n/.test(text) && (text.match(/^[\w.-]+:\s/gm)||[]).length>=2) || ((text.match(/^ *[\w.-]+:(?:[ \t]|$)/gm)||[]).length>=3 && /^\w[\w.-]*:\s*$/m.test(text))) && /^ +[\w.-]+:/m.test(text)) name='config.yaml';
    else if(/^[.#][\w-]+\s*\{/.test(text)&&/\b[\w-]+:\s*[^;{}]+;/.test(text)) name='style.css';
    else if(/^(?:Traceback \(most recent call last\):|\s*at \S+\s*\(|[\[{])/.test(text)) name='snippet.txt';
  }
  return {name,content:original};
}
export function safeTextFilename(name:string):string {
  return name.replace(/[\\/\x00-\x1f<>:"|?*]/g,'_').trim().slice(0,180);
}
